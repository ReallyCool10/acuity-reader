import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { searchInText, type SearchResultItem } from '../src/lib/search';

/**
 * Convert HTML or XML strings to readable plain text by stripping tags and unescaping entities.
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

function resolveHref(baseDir: string, href: string): string {
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

function findZipEntry(zip: JSZip, targetPath: string): JSZip.JSZipObject | null {
  const direct = zip.file(targetPath);
  if (direct) return direct;

  const decoded = decodeURIComponent(targetPath);
  const viaDecoded = zip.file(decoded);
  if (viaDecoded) return viaDecoded;

  const targetLower = decoded.toLowerCase();
  for (const entry of Object.values(zip.files)) {
    if (!entry.dir && decodeURIComponent(entry.name).toLowerCase() === targetLower) {
      return entry;
    }
  }
  return null;
}

export interface ChapterTocEntry {
  index: number;
  title: string;
  href: string;
  wordCountEstimate?: number;
}

interface ParsedEpubMeta {
  title: string;
  author: string;
  spineHrefs: string[];
  tocLabels: Map<string, string>;
}

async function parseEpubStructure(zip: JSZip): Promise<ParsedEpubMeta> {
  const containerEntry = findZipEntry(zip, 'META-INF/container.xml');
  if (!containerEntry) throw new Error('Invalid EPUB: META-INF/container.xml missing');

  const containerXml = await containerEntry.async('text');
  const opfMatch = containerXml.match(/full-path=["']([^"']+)["']/i);
  if (!opfMatch) throw new Error('Invalid EPUB: rootfile not found in container.xml');

  const opfPath = opfMatch[1];
  const opfEntry = findZipEntry(zip, opfPath);
  if (!opfEntry) throw new Error(`Invalid EPUB: OPF file not found at ${opfPath}`);

  const opfText = await opfEntry.async('text');
  const opfDir = dirOf(opfPath);

  // Extract title and author
  const titleMatch = opfText.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
  const title = titleMatch ? titleMatch[1].trim() : 'Unknown Title';

  const authorMatch = opfText.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);
  const author = authorMatch ? authorMatch[1].trim() : 'Unknown Author';

  // Extract manifest items: id -> href
  const manifestMap = new Map<string, string>();
  const itemRegex = /<item\b[^>]*\bid=["']([^"']+)["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(opfText)) !== null) {
    manifestMap.set(match[1], resolveHref(opfDir, match[2]));
  }
  if (manifestMap.size === 0) {
    // Reverse attribute order check
    const itemRegexRev = /<item\b[^>]*\bhref=["']([^"']+)["'][^>]*\bid=["']([^"']+)["'][^>]*>/gi;
    while ((match = itemRegexRev.exec(opfText)) !== null) {
      manifestMap.set(match[2], resolveHref(opfDir, match[1]));
    }
  }

  // Extract spine itemrefs
  const spineHrefs: string[] = [];
  const spineRegex = /<itemref\b[^>]*\bidref=["']([^"']+)["'][^>]*>/gi;
  while ((match = spineRegex.exec(opfText)) !== null) {
    const idref = match[1];
    const href = manifestMap.get(idref);
    if (href) spineHrefs.push(href);
  }

  // Extract TOC labels from NCX or Nav
  const tocLabels = new Map<string, string>();

  // Check NCX
  const ncxTagMatch = opfText.match(/<item\b[^>]*\bmedia-type=["']application\/x-dtbncx\+xml["'][^>]*>/i);
  if (ncxTagMatch) {
    const hrefMatch = ncxTagMatch[0].match(/\bhref=["']([^"']+)["']/i);
    if (hrefMatch) {
      const ncxPath = resolveHref(opfDir, hrefMatch[1]);
      const ncxEntry = findZipEntry(zip, ncxPath);
      if (ncxEntry) {
        const ncxText = await ncxEntry.async('text');
        const navPointRegex = /<navPoint[\s\S]*?<navLabel>\s*<text>([\s\S]*?)<\/text>\s*<\/navLabel>\s*<content\b[^>]*src=["']([^"']+)["']/gi;
        let npMatch: RegExpExecArray | null;
        while ((npMatch = navPointRegex.exec(ncxText)) !== null) {
          const label = npMatch[1].trim();
          const src = resolveHref(dirOf(ncxPath), npMatch[2]);
          if (src && label && !tocLabels.has(src)) {
            tocLabels.set(src, label);
          }
        }
      }
    }
  }

  // Check EPUB3 Nav
  const navTagMatch = opfText.match(/<item\b[^>]*\bproperties=["'][^"']*\bnav\b[^"']*["'][^>]*>/i);
  if (navTagMatch) {
    const hrefMatch = navTagMatch[0].match(/\bhref=["']([^"']+)["']/i);
    if (hrefMatch) {
      const navPath = resolveHref(opfDir, hrefMatch[1]);
      const navEntry = findZipEntry(zip, navPath);
      if (navEntry) {
        const navText = await navEntry.async('text');
        const aRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let aMatch: RegExpExecArray | null;
        while ((aMatch = aRegex.exec(navText)) !== null) {
          const src = resolveHref(dirOf(navPath), aMatch[1]);
          const label = htmlToPlainText(aMatch[2]).trim();
          if (src && label && !tocLabels.has(src)) {
            tocLabels.set(src, label);
          }
        }
      }
    }
  }

  return {
    title,
    author,
    spineHrefs,
    tocLabels,
  };
}

/**
 * Get table of contents / chapter list for an EPUB.
 */
export async function getEpubChapterList(filePath: string): Promise<{ title: string; author: string; chapters: ChapterTocEntry[] }> {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const buf = await fs.promises.readFile(filePath);
  const zip = await JSZip.loadAsync(buf);
  const meta = await parseEpubStructure(zip);

  const chapters: ChapterTocEntry[] = meta.spineHrefs.map((href, idx) => {
    const label = meta.tocLabels.get(href) || meta.tocLabels.get(href.split('#')[0]) || `Chapter ${idx + 1}`;
    return {
      index: idx,
      title: label,
      href,
    };
  });

  return {
    title: meta.title,
    author: meta.author,
    chapters,
  };
}

/**
 * Read the text content of a specific EPUB chapter.
 */
export async function readEpubChapterText(
  filePath: string,
  chapterIndex: number,
  maxCharacters = 10000
): Promise<{ title: string; chapterTitle: string; chapterIndex: number; totalChapters: number; text: string; truncated: boolean }> {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const buf = await fs.promises.readFile(filePath);
  const zip = await JSZip.loadAsync(buf);
  const meta = await parseEpubStructure(zip);

  if (chapterIndex < 0 || chapterIndex >= meta.spineHrefs.length) {
    throw new Error(`Invalid chapterIndex: ${chapterIndex}. Total chapters: ${meta.spineHrefs.length}`);
  }

  const href = meta.spineHrefs[chapterIndex];
  const entry = findZipEntry(zip, href);
  if (!entry) throw new Error(`Chapter entry not found in EPUB archive: ${href}`);

  const rawHtml = await entry.async('text');
  const plainText = htmlToPlainText(rawHtml);
  const chapterTitle = meta.tocLabels.get(href) || `Chapter ${chapterIndex + 1}`;

  const truncated = plainText.length > maxCharacters;
  const returnedText = truncated ? plainText.slice(0, maxCharacters) + '\n\n[... Chapter text truncated ...]' : plainText;

  return {
    title: meta.title,
    chapterTitle,
    chapterIndex,
    totalChapters: meta.spineHrefs.length,
    text: returnedText,
    truncated,
  };
}

/**
 * Search full text inside an EPUB book and return snippets.
 */
export async function searchEpubBook(
  filePath: string,
  query: string,
  maxMatches = 25
): Promise<{ title: string; query: string; totalMatches: number; matches: SearchResultItem[] }> {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const buf = await fs.promises.readFile(filePath);
  const zip = await JSZip.loadAsync(buf);
  const meta = await parseEpubStructure(zip);

  const allMatches: SearchResultItem[] = [];

  for (let idx = 0; idx < meta.spineHrefs.length; idx++) {
    const href = meta.spineHrefs[idx];
    const entry = findZipEntry(zip, href);
    if (!entry) continue;

    const rawHtml = await entry.async('text');
    const plainText = htmlToPlainText(rawHtml);
    const chapterLabel = meta.tocLabels.get(href) || `Chapter ${idx + 1}`;

    const chapterMatches = searchInText(plainText, query, idx, chapterLabel, maxMatches);
    allMatches.push(...chapterMatches);

    if (allMatches.length >= maxMatches) break;
  }

  return {
    title: meta.title,
    query,
    totalMatches: allMatches.length,
    matches: allMatches.slice(0, maxMatches),
  };
}

/**
 * Extract outline and metadata from a PDF.
 */
export async function getPdfInfo(filePath: string): Promise<{ title?: string; numPages: number; outline: Array<{ title: string; pageNumber: number }> }> {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const data = new Uint8Array(await fs.promises.readFile(filePath));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

  let title: string | undefined;
  try {
    const meta = await doc.getMetadata();
    const info = meta?.info as Record<string, unknown> | undefined;
    if (typeof info?.Title === 'string' && info.Title.trim()) {
      title = info.Title.trim();
    }
  } catch {
    // ignore
  }

  const outline: Array<{ title: string; pageNumber: number }> = [];
  try {
    const rawOutline = await doc.getOutline();
    if (rawOutline && Array.isArray(rawOutline)) {
      for (const item of rawOutline) {
        if (!item.title) continue;
        let pageNum = 1;
        if (typeof item.dest === 'string') {
          const destIdx = await doc.getPageIndex({ num: 0, gen: 0 }).catch(() => 0);
          pageNum = destIdx + 1;
        } else if (Array.isArray(item.dest) && item.dest[0] && typeof item.dest[0] === 'object') {
          try {
            const pageIndex = await doc.getPageIndex(item.dest[0]);
            pageNum = pageIndex + 1;
          } catch {
            pageNum = 1;
          }
        }
        outline.push({ title: item.title, pageNumber: pageNum });
      }
    }
  } catch {
    // outline reading fallback
  }

  return {
    title: title || path.basename(filePath, path.extname(filePath)),
    numPages: doc.numPages,
    outline,
  };
}

/**
 * Read the text of a single PDF page.
 */
export async function readPdfPageText(
  filePath: string,
  pageNumber: number,
  maxCharacters = 10000
): Promise<{ title?: string; pageNumber: number; numPages: number; text: string; truncated: boolean }> {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const data = new Uint8Array(await fs.promises.readFile(filePath));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

  if (pageNumber < 1 || pageNumber > doc.numPages) {
    throw new Error(`Invalid pageNumber: ${pageNumber}. Document has ${doc.numPages} pages.`);
  }

  const page = await doc.getPage(pageNumber);
  const textContent = await page.getTextContent();
  const text = textContent.items
    .map((item) => ('str' in item ? (item as { str: string }).str : ''))
    .join(' ')
    .replace(/[ \t]+/g, ' ')
    .trim();

  const truncated = text.length > maxCharacters;
  const returnedText = truncated ? text.slice(0, maxCharacters) + '\n\n[... Page text truncated ...]' : text;

  return {
    pageNumber,
    numPages: doc.numPages,
    text: returnedText,
    truncated,
  };
}

/**
 * Search full text across PDF pages and return snippets.
 */
export async function searchPdfBook(
  filePath: string,
  query: string,
  maxMatches = 25
): Promise<{ query: string; totalMatches: number; matches: SearchResultItem[] }> {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const data = new Uint8Array(await fs.promises.readFile(filePath));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

  const allMatches: SearchResultItem[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ('str' in item ? (item as { str: string }).str : ''))
      .join(' ')
      .trim();

    if (pageText) {
      const pageMatches = searchInText(pageText, query, pageNum, `Page ${pageNum}`, maxMatches);
      allMatches.push(...pageMatches);
      if (allMatches.length >= maxMatches) break;
    }
  }

  return {
    query,
    totalMatches: allMatches.length,
    matches: allMatches.slice(0, maxMatches),
  };
}
