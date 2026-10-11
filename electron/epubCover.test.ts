import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { findEpubCover } from './epubCover';

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

/** An EPUB whose OPF has this manifest/guide/spine, plus the listed files. */
async function epub(opfBody: string, files: Record<string, string> = {}, metadata = ''): Promise<JSZip> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', CONTAINER);
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title>${metadata}</metadata>
      ${opfBody}
    </package>`
  );
  for (const [name, contents] of Object.entries(files)) zip.file(name, contents);
  // Round-trip so entries look as they do when read from disk.
  return JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));
}

const coverName = async (zip: JSZip) => (await findEpubCover(zip))?.entry.name ?? null;

/** Images the old filename guess would have picked first. */
const DECOYS = {
  'OEBPS/images/discover.jpg': 'x',
  'OEBPS/images/back-cover.jpg': 'x',
  'OEBPS/images/publisher-logo.png': 'x',
};
const DECOY_ITEMS = `
  <item id="discover" href="images/discover.jpg" media-type="image/jpeg"/>
  <item id="back" href="images/back-cover.jpg" media-type="image/jpeg"/>
  <item id="logo" href="images/publisher-logo.png" media-type="image/png"/>`;

describe('electron/epubCover', () => {
  it('uses the EPUB 3 cover-image property', async () => {
    const zip = await epub(
      `<manifest>${DECOY_ITEMS}<item id="art" href="images/front.jpg" media-type="image/jpeg" properties="cover-image"/></manifest>`,
      { ...DECOYS, 'OEBPS/images/front.jpg': 'x' }
    );
    expect(await coverName(zip)).toBe('OEBPS/images/front.jpg');
  });

  it('uses the EPUB 2 cover meta, by id or by path', async () => {
    const byId = await epub(
      `<manifest>${DECOY_ITEMS}<item id="img1" href="art/a.png" media-type="image/png"/></manifest>`,
      { ...DECOYS, 'OEBPS/art/a.png': 'x' },
      '<meta content="img1" name="cover"/>'
    );
    expect(await coverName(byId)).toBe('OEBPS/art/a.png');

    const byPath = await epub(
      `<manifest><item id="img1" href="art/a%20b.png" media-type="image/png"/></manifest>`,
      { 'OEBPS/art/a b.png': 'x' },
      '<meta name="cover" content="art/a b.png"/>'
    );
    expect(await coverName(byPath)).toBe('OEBPS/art/a b.png');
  });

  it('follows the guide to the cover page and takes the image on it', async () => {
    const zip = await epub(
      `<manifest>${DECOY_ITEMS}<item id="cp" href="text/titlepage.xhtml" media-type="application/xhtml+xml"/></manifest>
       <guide><reference type="cover" title="Cover" href="text/titlepage.xhtml"/></guide>`,
      {
        ...DECOYS,
        'OEBPS/text/titlepage.xhtml':
          '<html><body><svg xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="../images/jacket.jpeg"/></svg></body></html>',
        'OEBPS/images/jacket.jpeg': 'x',
      }
    );
    expect(await coverName(zip)).toBe('OEBPS/images/jacket.jpeg');
  });

  it('falls back to an image named as a front cover, never discover.jpg or a back cover', async () => {
    const zip = await epub(
      `<manifest>${DECOY_ITEMS}<item id="i9" href="images/Front_Cover.JPG" media-type="image/jpeg"/></manifest>`,
      { ...DECOYS, 'OEBPS/images/Front_Cover.JPG': 'x' }
    );
    const cover = await findEpubCover(zip);
    expect(cover?.entry.name).toBe('OEBPS/images/Front_Cover.JPG');
    expect(cover?.extension).toBe('.jpg');
  });

  it('falls back to the image on the first page of the reading order', async () => {
    const zip = await epub(
      `<manifest>${DECOY_ITEMS}
         <item id="p1" href="p1.xhtml" media-type="application/xhtml+xml"/>
         <item id="p2" href="p2.xhtml" media-type="application/xhtml+xml"/>
       </manifest>
       <spine><itemref idref="p1"/><itemref idref="p2"/></spine>`,
      {
        ...DECOYS,
        'OEBPS/p1.xhtml': '<html><body><img src="images/first-page.webp" alt=""/></body></html>',
        'OEBPS/p2.xhtml': '<html><body><img src="images/publisher-logo.png"/></body></html>',
        'OEBPS/images/first-page.webp': 'x',
      }
    );
    expect(await coverName(zip)).toBe('OEBPS/images/first-page.webp');
  });

  it('declines rather than pick an arbitrary image', async () => {
    const zip = await epub(
      `<manifest>${DECOY_ITEMS}<item id="p1" href="p1.xhtml" media-type="application/xhtml+xml"/></manifest>
       <spine><itemref idref="p1"/></spine>`,
      { ...DECOYS, 'OEBPS/p1.xhtml': '<html><body><p>Chapter one</p></body></html>' }
    );
    expect(await coverName(zip)).toBeNull();
  });

  it('returns nothing for an archive without a package document', async () => {
    const zip = new JSZip();
    zip.file('images/cover.jpg', 'x');
    expect(await coverName(zip)).toBeNull();
  });
});
