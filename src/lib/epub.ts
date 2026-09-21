import JSZip from 'jszip';

export interface EpubChapter {
  id: string;
  href: string;
  title: string;
  /** Sanitised, display-ready HTML with in-archive images resolved to blob URLs. */
  html: string;
  /** Flattened plain text, used for narration and for word-count estimates. */
  text: string;
  words: number;
}

export interface EpubBook {
  title: string;
  author: string;
  chapters: EpubChapter[];
  /** Blob URLs minted for embedded images; callers must revoke these on unmount. */
  objectUrls: string[];
}

const XML = 'application/xml';
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION',
  'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI',
  'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TR', 'UL',
]);

/** Tags removed outright — scripts, styling and anything that can load remote content. */
const STRIP_TAGS = 'script, style, link, meta, iframe, object, embed, form, input, button, audio, video, base';

/**
 * Resolve an EPUB-relative href against the directory holding the document that
 * referenced it. EPUB paths are always POSIX-style and always relative to the
 * archive root once resolved, so this deliberately avoids the URL API (which
 * would require a synthetic origin and re-encode characters we need verbatim).
 */
export function resolveHref(baseDir: string, href: string): string {
  const clean = href.split('#')[0];
  if (!clean) return '';
  const segments = (baseDir ? baseDir.split('/').filter(Boolean) : []).concat(clean.split('/'));
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return out.join('/');
}

function dirOf(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx === -1 ? '' : filePath.slice(0, idx);
}

/**
 * JSZip keys are case- and encoding-sensitive, but real-world EPUBs frequently
 * disagree with their own manifest on both counts. Fall back to a percent-decoded,
 * case-insensitive lookup before giving up on an entry.
 */
function findEntry(zip: JSZip, path: string): JSZip.JSZipObject | null {
  const direct = zip.file(path);
  if (direct) return direct;

  const decoded = decodeURIComponent(path);
  const viaDecoded = zip.file(decoded);
  if (viaDecoded) return viaDecoded;

  const target = decoded.toLowerCase();
  for (const entry of Object.values(zip.files)) {
    if (!entry.dir && decodeURIComponent(entry.name).toLowerCase() === target) return entry;
  }
  return null;
}

function parseXml(source: string): Document | null {
  const doc = new DOMParser().parseFromString(source, XML);
  return doc.querySelector('parsererror') ? null : doc;
}

/** EPUB 3 nav documents and EPUB 2 NCX files both map a spine href to a human label. */
async function readTocLabels(zip: JSZip, opfDoc: Document, opfDir: string): Promise<Map<string, string>> {
  const labels = new Map<string, string>();

  const navItem = Array.from(opfDoc.querySelectorAll('manifest > item')).find((item) =>
    (item.getAttribute('properties') || '').split(/\s+/).includes('nav')
  );

  if (navItem) {
    const navPath = resolveHref(opfDir, navItem.getAttribute('href') || '');
    const entry = findEntry(zip, navPath);
    if (entry) {
      const navDoc = new DOMParser().parseFromString(await entry.async('text'), 'text/html');
      for (const anchor of Array.from(navDoc.querySelectorAll('nav a[href]'))) {
        const href = resolveHref(dirOf(navPath), anchor.getAttribute('href') || '');
        const label = anchor.textContent?.trim();
        if (href && label && !labels.has(href)) labels.set(href, label);
      }
    }
  }

  if (labels.size === 0) {
    const ncxItem = opfDoc.querySelector('manifest > item[media-type="application/x-dtbncx+xml"]');
    if (ncxItem) {
      const ncxPath = resolveHref(opfDir, ncxItem.getAttribute('href') || '');
      const entry = findEntry(zip, ncxPath);
      if (entry) {
        const ncxDoc = parseXml(await entry.async('text'));
        for (const point of Array.from(ncxDoc?.querySelectorAll('navPoint') || [])) {
          const src = point.querySelector('content')?.getAttribute('src') || '';
          const href = resolveHref(dirOf(ncxPath), src);
          const label = point.querySelector('navLabel > text')?.textContent?.trim();
          if (href && label && !labels.has(href)) labels.set(href, label);
        }
      }
    }
  }

  return labels;
}

/**
 * Strip anything executable or remote-loading, then repoint in-archive images at
 * blob URLs. Returns the minted URLs so the caller can revoke them.
 */
async function sanitiseChapter(
  zip: JSZip,
  doc: Document,
  chapterDir: string,
  imageCache: Map<string, string>
): Promise<string> {
  doc.body?.querySelectorAll(STRIP_TAGS).forEach((el) => el.remove());

  for (const el of Array.from(doc.body?.querySelectorAll('*') || [])) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'src') && value.startsWith('javascript:')) {
        el.removeAttribute(attr.name);
      }
    }
  }

  const images = Array.from(doc.body?.querySelectorAll('img[src], image') || []);
  for (const img of images) {
    const isSvgImage = img.tagName.toLowerCase() === 'image';
    const raw = isSvgImage
      ? img.getAttribute('xlink:href') || img.getAttribute('href')
      : img.getAttribute('src');
    if (!raw || /^(https?:|data:|blob:)/i.test(raw)) continue;

    const path = resolveHref(chapterDir, raw);
    let url = imageCache.get(path);
    if (!url) {
      const entry = findEntry(zip, path);
      if (!entry) {
        img.remove();
        continue;
      }
      url = URL.createObjectURL(await entry.async('blob'));
      imageCache.set(path, url);
    }

    if (isSvgImage) img.setAttribute('href', url);
    else img.setAttribute('src', url);
  }

  // External links would navigate the reader away from the app; neutralise them.
  for (const anchor of Array.from(doc.body?.querySelectorAll('a[href]') || [])) {
    if (/^https?:/i.test(anchor.getAttribute('href') || '')) {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    }
  }

  return doc.body?.innerHTML ?? '';
}

/**
 * Flatten an element to text with paragraph breaks preserved.
 *
 * `innerText` is unavailable here: it is defined in terms of rendered layout, and
 * a DOMParser document is never attached to a view, so it returns null. Walking
 * the tree and inserting breaks at block boundaries is the portable equivalent.
 */
export function extractText(root: Element | null): string {
  if (!root) return '';
  let out = '';

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue?.replace(/\s+/g, ' ') ?? '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE') return;
    if (tag === 'BR') {
      out += '\n';
      return;
    }
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock && out && !out.endsWith('\n\n')) out += '\n\n';
    el.childNodes.forEach(walk);
    if (isBlock && out && !out.endsWith('\n\n')) out += '\n\n';
  };

  root.childNodes.forEach(walk);
  return out.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * Read a Dublin Core field from the OPF metadata block.
 *
 * These elements are namespaced (`dc:title`, `dc:creator`), and a colon is not a
 * legal CSS identifier, so `querySelector('dc:title')` throws rather than missing.
 * Matching on `localName` sidesteps prefix and namespace variation entirely.
 */
function readDublinCore(opfDoc: Document, field: string): string {
  const metadata = Array.from(opfDoc.documentElement.children).find(
    (el) => el.localName.toLowerCase() === 'metadata'
  );
  if (!metadata) return '';
  const match = Array.from(metadata.children).find(
    (el) => el.localName.toLowerCase() === field
  );
  return match?.textContent?.trim() || '';
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Parse an EPUB in spine order.
 *
 * Reading order comes from the OPF spine, not from the archive's own entry order
 * — zip ordering is arbitrary and routinely interleaves front matter, notes and
 * chapters, so anything that iterates `zip.files` presents the book scrambled.
 */
export async function parseEpub(data: ArrayBuffer | Uint8Array): Promise<EpubBook> {
  const zip = await JSZip.loadAsync(data);

  const containerEntry = findEntry(zip, 'META-INF/container.xml');
  if (!containerEntry) throw new Error('Not a valid EPUB: META-INF/container.xml is missing.');

  const containerDoc = parseXml(await containerEntry.async('text'));
  const opfPath = containerDoc?.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('Not a valid EPUB: the container declares no package document.');

  const opfEntry = findEntry(zip, opfPath);
  if (!opfEntry) throw new Error(`Not a valid EPUB: package document "${opfPath}" is missing.`);

  const opfDoc = parseXml(await opfEntry.async('text'));
  if (!opfDoc) throw new Error('Not a valid EPUB: the package document could not be parsed.');

  const opfDir = dirOf(opfPath);

  const manifest = new Map<string, { href: string; type: string }>();
  for (const item of Array.from(opfDoc.querySelectorAll('manifest > item'))) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) {
      manifest.set(id, { href, type: item.getAttribute('media-type') || '' });
    }
  }

  const tocLabels = await readTocLabels(zip, opfDoc, opfDir);
  const imageCache = new Map<string, string>();
  const chapters: EpubChapter[] = [];

  const startTime = typeof performance !== 'undefined' ? performance.now() : 0;
  let lastYieldTime = startTime;

  const spineRefs = Array.from(opfDoc.querySelectorAll('spine > itemref'));
  for (const ref of spineRefs) {
    // linear="no" marks ancillary material (covers, ads); keep it out of reading order.
    if (ref.getAttribute('linear') === 'no') continue;

    const entryMeta = manifest.get(ref.getAttribute('idref') || '');
    if (!entryMeta || !/x?html/i.test(entryMeta.type)) continue;

    const chapterPath = resolveHref(opfDir, entryMeta.href);
    const entry = findEntry(zip, chapterPath);
    if (!entry) continue;

    // Yield control to the event loop if parsing has taken more than 50ms,
    // keeping the renderer thread responsive and preventing UI freeze on large books.
    if (startTime && performance.now() - lastYieldTime > 50) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      lastYieldTime = performance.now();
    }

    const doc = new DOMParser().parseFromString(await entry.async('text'), 'text/html');
    const html = await sanitiseChapter(zip, doc, dirOf(chapterPath), imageCache);
    const text = extractText(doc.body);
    if (countWords(text) < 8) continue; // skip empty separator pages
    const heading = doc.querySelector('h1, h2, h3, h4')?.textContent?.trim();

    chapters.push({
      id: chapterPath,
      href: chapterPath,
      title: tocLabels.get(chapterPath) || heading || `Chapter ${chapters.length + 1}`,
      html,
      text,
      words: countWords(text),
    });
  }

  if (chapters.length === 0) {
    throw new Error('This EPUB contains no readable chapters.');
  }

  const metaTitle = readDublinCore(opfDoc, 'title');
  const metaAuthor = readDublinCore(opfDoc, 'creator');

  if (startTime) {
    const elapsed = Math.round(performance.now() - startTime);
    if (elapsed > 300) {
      console.info(`[Epub] Parsed "${metaTitle || 'EPUB'}" (${chapters.length} chapters) in ${elapsed}ms`);
    }
  }

  return {
    title: metaTitle || '',
    author: metaAuthor || '',
    chapters,
    objectUrls: Array.from(imageCache.values()),
  };
}
