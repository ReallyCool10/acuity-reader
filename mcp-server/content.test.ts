import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import JSZip from 'jszip';
import {
  htmlToPlainText,
  getEpubChapterList,
  readEpubChapterText,
  searchEpubBook,
} from './content';

async function createMockEpubFile(targetPath: string): Promise<void> {
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

  const chap1 = `<?xml version="1.0" encoding="utf-8"?>
<html>
  <body>
    <h1>Chapter 1: The Beginning</h1>
    <p>In the beginning there was a reader with clear vision and high acuity.</p>
  </body>
</html>`;

  const chap2 = `<?xml version="1.0" encoding="utf-8"?>
<html>
  <body>
    <h1>Chapter 2: Deep Exploration</h1>
    <p>Knowledge is stored in digital pages waiting to be indexed and searched by artificial intelligence agents.</p>
  </body>
</html>`;

  zip.file('EPUB/chap1.xhtml', chap1);
  zip.file('EPUB/chap2.xhtml', chap2);

  zip.file(
    'EPUB/nav.xhtml',
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a href="chap1.xhtml">First Steps</a></li>
        <li><a href="chap2.xhtml">Deep Dive</a></li>
      </ol>
    </nav>
  </body>
</html>`
  );

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Acuity Chronicles</dc:title>
    <dc:creator>Ada Lovelace</dc:creator>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>
    <item id="ch1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chap2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`;

  zip.file('EPUB/content.opf', opf);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  await fs.promises.writeFile(targetPath, buffer);
}

describe('mcp-server/content', () => {
  let tempEpubPath: string;

  beforeEach(async () => {
    tempEpubPath = path.join(os.tmpdir(), `test-epub-${Date.now()}-${Math.random().toString(36).slice(2)}.epub`);
    await createMockEpubFile(tempEpubPath);
  });

  afterEach(async () => {
    if (fs.existsSync(tempEpubPath)) {
      await fs.promises.unlink(tempEpubPath).catch(() => {});
    }
  });

  it('converts dirty HTML to clean plain text', () => {
    const html = '<div><h1>Title</h1><p>Line 1 &amp; Line 2.<br/>Line 3 &quot;quoted&quot;.</p></div>';
    const text = htmlToPlainText(html);
    expect(text).toContain('Title');
    expect(text).toContain('Line 1 & Line 2.');
    expect(text).toContain('Line 3 "quoted".');
  });

  it('reads EPUB chapter list and metadata', async () => {
    const result = await getEpubChapterList(tempEpubPath);
    expect(result.title).toBe('Acuity Chronicles');
    expect(result.author).toBe('Ada Lovelace');
    expect(result.chapters.length).toBe(2);
    expect(result.chapters[0].title).toBe('First Steps');
    expect(result.chapters[1].title).toBe('Deep Dive');
  });

  it('reads specific EPUB chapter text', async () => {
    const chapter0 = await readEpubChapterText(tempEpubPath, 0);
    expect(chapter0.title).toBe('Acuity Chronicles');
    expect(chapter0.chapterTitle).toBe('First Steps');
    expect(chapter0.text).toContain('In the beginning there was a reader with clear vision and high acuity.');

    const chapter1 = await readEpubChapterText(tempEpubPath, 1);
    expect(chapter1.chapterTitle).toBe('Deep Dive');
    expect(chapter1.text).toContain('Knowledge is stored in digital pages');
  });

  it('searches full-text inside EPUB chapters', async () => {
    const searchRes = await searchEpubBook(tempEpubPath, 'intelligence');
    expect(searchRes.totalMatches).toBe(1);
    expect(searchRes.matches[0].locationLabel).toBe('Deep Dive');
    expect(searchRes.matches[0].matchedText).toBe('intelligence');
    expect(searchRes.matches[0].snippetBefore).toContain('artificial');
    expect(searchRes.matches[0].snippetAfter).toContain('agents');
  });
});
