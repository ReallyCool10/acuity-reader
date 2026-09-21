import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parseEpub } from './epub';

async function buildFixtureEpub(): Promise<Uint8Array> {
  const zip = new JSZip();

  zip.file('mimetype', 'application/epub+zip');

  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );

  // Chapter 1 is written to the zip FIRST
  const chap1Content = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter 1</title></head>
  <body>
    <h1>Chapter 1: Chronological First</h1>
    <p>This is the first chapter written into the zip archive. It has plenty of words to pass the chapter threshold.</p>
  </body>
</html>`;

  // Chapter 2 is written to the zip SECOND, contains a <script> tag and a known phrase
  const chap2Content = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter 2</title></head>
  <body>
    <h1>Chapter 2: Spine Priority</h1>
    <script>alert('evil script injection');</script>
    <p>Here is the critical known phrase that must be discovered in the extracted text. This chapter comes first in the spine.</p>
  </body>
</html>`;

  zip.file('EPUB/chap1.xhtml', chap1Content);
  zip.file('EPUB/chap2.xhtml', chap2Content);

  // EPUB 3 Navigation Document
  zip.file(
    'EPUB/nav.xhtml',
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a href="chap2.xhtml">Chapter Two Title</a></li>
        <li><a href="chap1.xhtml">Chapter One Title</a></li>
      </ol>
    </nav>
  </body>
</html>`
  );

  // OPF Package Document:
  // - Deliberately orders chap2 BEFORE chap1 in <spine>
  // - Uses namespaced dc:title and dc:creator
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Acuity Test Book</dc:title>
    <dc:creator>Jane Doe Tester</dc:creator>
    <dc:identifier id="uid">urn:uuid:test-12345</dc:identifier>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chap1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chap2" href="chap2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chap2"/>
    <itemref idref="chap1"/>
  </spine>
</package>`;

  zip.file('EPUB/content.opf', opf);

  return zip.generateAsync({ type: 'uint8array' });
}

describe('src/lib/epub - parseEpub', () => {
  it('chapters come back in spine order, not zip order', async () => {
    const data = await buildFixtureEpub();
    const book = await parseEpub(data);

    expect(book.chapters).toHaveLength(2);
    // chap2 was in the spine first, even though chap1 was added to zip first
    expect(book.chapters[0].href).toBe('EPUB/chap2.xhtml');
    expect(book.chapters[0].title).toBe('Chapter Two Title');

    expect(book.chapters[1].href).toBe('EPUB/chap1.xhtml');
    expect(book.chapters[1].title).toBe('Chapter One Title');
  });

  it('chapter text is non-empty and contains a known phrase', async () => {
    const data = await buildFixtureEpub();
    const book = await parseEpub(data);

    const firstSpineChap = book.chapters[0];
    expect(firstSpineChap.text.length).toBeGreaterThan(0);
    expect(firstSpineChap.text).toContain('critical known phrase');
  });

  it('<script> is stripped', async () => {
    const data = await buildFixtureEpub();
    const book = await parseEpub(data);

    const firstSpineChap = book.chapters[0];
    expect(firstSpineChap.html).not.toContain('<script');
    expect(firstSpineChap.html).not.toContain('evil script injection');
    expect(firstSpineChap.text).not.toContain('evil script injection');
  });

  it('dc:title / dc:creator read through the namespace', async () => {
    const data = await buildFixtureEpub();
    const book = await parseEpub(data);

    expect(book.title).toBe('Acuity Test Book');
    expect(book.author).toBe('Jane Doe Tester');
  });

  it('a non-EPUB archive rejects', async () => {
    const nonEpubZip = new JSZip();
    nonEpubZip.file('random.txt', 'This is not an EPUB file.');
    const data = await nonEpubZip.generateAsync({ type: 'uint8array' });

    await expect(parseEpub(data)).rejects.toThrow(/Not a valid EPUB/);
  });
});
