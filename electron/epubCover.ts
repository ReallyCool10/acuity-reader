import path from 'node:path';
import type JSZip from 'jszip';

/**
 * Finds the cover image an EPUB declares.
 *
 * The scanner used to take the first file whose name contained "cover", or
 * failing that the first image in the archive. That matched discover.jpg,
 * back-cover.jpg and recovery-chart.png, and the archive's first image is often
 * a publisher's logo. This follows the book's own declarations instead, in the
 * order reading systems use:
 *
 * 1. EPUB 3: the manifest item with properties="cover-image"
 * 2. EPUB 2: <meta name="cover" content="item id">
 * 3. the <guide> cover page, and the image on it
 * 4. a manifest image named as a front cover (cover.jpg, front_cover.png)
 * 5. the image on the first page of the reading order, which is usually the cover
 *
 * It never falls back to an arbitrary image: no cover (a generated jacket) is
 * better than the wrong one.
 */

const IMAGE_EXTENSION = /\.(jpe?g|png|webp|gif)$/i;
const IMAGE_MEDIA_TYPE = /^image\/(jpeg|png|webp|gif)$/i;
/** "cover" as a word or prefix: cover.jpg, front_cover.png, CoverImage.jpg; not discover or uncovered. */
const NAMED_AS_COVER = /(^|[^a-z])cover/i;
const BACK_COVER = /back/i;

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string[];
}

export interface EpubCover {
  entry: JSZip.JSZipObject;
  /** The image's file extension, lower-cased, with its dot. */
  extension: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, name: string) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

/** The attributes of one start tag, keyed by lower-cased local name (`xlink:href` becomes `href`). */
function attributesOf(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const [, name, double, single] of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[name.slice(name.indexOf(':') + 1).toLowerCase()] = decodeEntities(double ?? single ?? '');
  }
  return attributes;
}

/** Every start tag with this local name, namespace prefix or not. */
function tagsNamed(xml: string, name: string): Record<string, string>[] {
  return [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>`, 'gi'))].map(([tag]) => attributesOf(tag));
}

/** Resolve an href found in `fromFile` to a path inside the archive. */
function resolveHref(fromFile: string, href: string): string {
  let target = href.split('#')[0].split('?')[0];
  try {
    target = decodeURIComponent(target);
  } catch {
    // Keep it as written.
  }
  const joined = target.startsWith('/') ? target.slice(1) : path.posix.join(path.posix.dirname(fromFile), target);
  return path.posix.normalize(joined).replace(/^(\.\/)+/, '');
}

function findEntry(zip: JSZip, zipPath: string): JSZip.JSZipObject | null {
  const exact = zip.file(zipPath);
  if (exact) return exact;
  const wanted = zipPath.toLowerCase();
  return Object.values(zip.files).find((f) => !f.dir && f.name.toLowerCase() === wanted) ?? null;
}

async function readText(zip: JSZip, zipPath: string): Promise<string | null> {
  const entry = findEntry(zip, zipPath);
  return entry ? entry.async('text') : null;
}

const isImage = (item: ManifestItem) => IMAGE_MEDIA_TYPE.test(item.mediaType) || IMAGE_EXTENSION.test(item.href);

/** The first raster image an XHTML page shows, as an archive path. */
async function imageOnPage(zip: JSZip, pagePath: string): Promise<string | null> {
  const page = await readText(zip, pagePath);
  if (!page) return null;
  for (const name of ['img', 'image']) {
    for (const attributes of tagsNamed(page, name)) {
      const href = attributes.src ?? attributes.href;
      if (href && IMAGE_EXTENSION.test(href.split(/[?#]/)[0])) return resolveHref(pagePath, href);
    }
  }
  return null;
}

async function coverPath(zip: JSZip): Promise<string | null> {
  const container = await readText(zip, 'META-INF/container.xml');
  const opfPath = container && tagsNamed(container, 'rootfile')[0]?.['full-path'];
  const opf = opfPath ? await readText(zip, opfPath) : null;
  if (!opfPath || !opf) return null;

  const manifest: ManifestItem[] = tagsNamed(opf, 'item')
    .filter((a) => a.href)
    .map((a) => ({
      id: a.id ?? '',
      href: resolveHref(opfPath, a.href),
      mediaType: a['media-type'] ?? '',
      properties: (a.properties ?? '').split(/\s+/),
    }));
  const images = manifest.filter(isImage);

  const declared = images.find((item) => item.properties.includes('cover-image'));
  if (declared) return declared.href;

  const coverMeta = tagsNamed(opf, 'meta').find((a) => a.name?.toLowerCase() === 'cover')?.content;
  if (coverMeta) {
    const byId = images.find((item) => item.id === coverMeta);
    // Some books give the image's path rather than its id.
    const byHref = images.find((item) => item.href === resolveHref(opfPath, coverMeta));
    if (byId ?? byHref) return (byId ?? byHref)!.href;
  }

  const guideCover = tagsNamed(opf, 'reference').find((a) => a.type?.toLowerCase() === 'cover')?.href;
  if (guideCover) {
    const target = resolveHref(opfPath, guideCover);
    if (IMAGE_EXTENSION.test(target)) return target;
    const onPage = await imageOnPage(zip, target);
    if (onPage) return onPage;
  }

  const named = images.find((item) => {
    const name = path.posix.basename(item.href).replace(IMAGE_EXTENSION, '');
    return (NAMED_AS_COVER.test(item.id) || NAMED_AS_COVER.test(name)) && !BACK_COVER.test(`${item.id} ${name}`);
  });
  if (named) return named.href;

  const firstPageId = tagsNamed(opf, 'itemref')[0]?.idref;
  const firstPage = manifest.find((item) => item.id === firstPageId);
  return firstPage ? imageOnPage(zip, firstPage.href) : null;
}

export async function findEpubCover(zip: JSZip): Promise<EpubCover | null> {
  const found = await coverPath(zip);
  const entry = found ? findEntry(zip, found) : null;
  const extension = entry?.name.match(IMAGE_EXTENSION)?.[0].toLowerCase();
  return entry && extension ? { entry, extension } : null;
}
