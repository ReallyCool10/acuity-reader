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

/** A two-chapter book; chapter bodies are padded past the empty-page threshold. */
async function buildBook(
  chapters: Record<string, string>,
  manifestHref: (name: string) => string = (name) => name
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
  );
  const names = Object.keys(chapters);
  for (const name of names) {
    zip.file(
      `OEBPS/${name}`,
      `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Plenty of words here so this page counts as a chapter.</p>${chapters[name]}</body></html>`
    );
  }
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest>${names
      .map((n, i) => `<item id="c${i}" href="${manifestHref(n)}" media-type="application/xhtml+xml"/>`)
      .join('')}</manifest><spine>${names.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`
  );
  return zip.generateAsync({ type: 'uint8array' });
}

async function chapterBody(markup: string): Promise<HTMLElement> {
  const book = await parseEpub(await buildBook({ 'one.xhtml': markup }));
  const host = document.createElement('div');
  host.innerHTML = book.chapters[0].html;
  return host;
}

describe('src/lib/epub - sanitising chapter markup', () => {
  it.each([
    ['a plain javascript: link', '<a href="javascript:alert(1)">x</a>'],
    ['a tab inside the scheme', '<a href="java&#9;script:alert(1)">x</a>'],
    ['a leading control character', '<a href="&#1;javascript:alert(1)">x</a>'],
    ['mixed case and a newline', '<a href="JaVa&#10;ScRiPt:alert(1)">x</a>'],
    ['an SVG link through xlink:href', '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>'],
    ['vbscript', '<a href="vbscript:msgbox(1)">x</a>'],
  ])('removes %s', async (_label, markup) => {
    const body = await chapterBody(markup);
    expect(body.innerHTML.toLowerCase()).not.toMatch(/script\s*:/);
  });

  it('removes SVG animation, which could set a link’s target after sanitising', async () => {
    const body = await chapterBody(
      '<svg><a><animate attributeName="href" to="javascript:alert(1)"/><set attributeName="href" to="x"/><text>x</text></a></svg>'
    );
    expect(body.querySelector('animate, set')).toBeNull();
    expect(body.innerHTML).not.toContain('alert');
  });

  it('removes event handler attributes and an SVG <use> of another document', async () => {
    const body = await chapterBody(
      '<p onclick="alert(1)" id="kept">x</p><svg><use href="other.svg#icon"/><use href="#local"/></svg>'
    );
    expect(body.querySelector('#kept')?.hasAttribute('onclick')).toBe(false);
    expect(body.innerHTML).not.toContain('other.svg');
    expect(body.querySelector('use[href="#local"]')).not.toBeNull();
  });

  it('loads nothing from outside the book: remote images, srcset, style url() and background', async () => {
    const body = await chapterBody(
      '<img id="remote" src="https://tracker.example/pixel.gif" alt="Remote"/>' +
        '<img id="share" src="//host/share/x.png"/>' +
        '<img id="inline" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" srcset="https://x.example/2x.png 2x"/>' +
        '<p id="styled" style="font-style: italic; background-image: url(https://x.example/bg.png)">x</p>' +
        '<table background="https://x.example/t.png"><tr><td>x</td></tr></table>' +
        '<svg><rect id="filled" fill="url(#gradient)"/><rect id="filtered" filter="url(https://x.example/f.svg#f)"/></svg>'
    );
    expect(body.querySelector('#remote')).toBeNull();
    expect(body.querySelector('#share')).toBeNull();
    expect(body.querySelector('#inline')?.hasAttribute('srcset')).toBe(false);
    expect(body.querySelector('#inline')?.getAttribute('src')).toMatch(/^data:/);
    expect(body.querySelector('#styled')?.getAttribute('style')).toBe('font-style: italic');
    expect(body.querySelector('table')?.hasAttribute('background')).toBe(false);
    expect(body.querySelector('#filled')?.getAttribute('fill')).toBe('url(#gradient)');
    expect(body.querySelector('#filtered')?.hasAttribute('filter')).toBe(false);
    expect(body.innerHTML).not.toContain('example');
  });

  it('shows <noscript> fallback content as ordinary markup', async () => {
    const body = await chapterBody('<noscript><p class="fallback">Shown without scripts.</p></noscript>');
    expect(body.querySelector('noscript')).toBeNull();
    expect(body.querySelector('p.fallback')?.textContent).toBe('Shown without scripts.');
  });
});

describe('src/lib/epub - links inside a book', () => {
  it('rewrites a link to another chapter so it records its target instead of navigating', async () => {
    const book = await parseEpub(
      await buildBook({ 'one.xhtml': '<a href="two.xhtml#later">Go</a>', 'two.xhtml': '<p id="later">Later</p>' })
    );
    const host = document.createElement('div');
    host.innerHTML = book.chapters[0].html;
    const link = host.querySelector('a');

    expect(link?.getAttribute('data-book-target')).toBe('OEBPS/two.xhtml#later');
    expect(link?.getAttribute('href')).toBe('#');
  });

  it('points a fragment-only link at its own chapter', async () => {
    const body = await chapterBody('<a href="#note-1">1</a><aside id="note-1">A note</aside>');
    expect(body.querySelector('a')?.getAttribute('data-book-target')).toBe('OEBPS/one.xhtml#note-1');
  });

  it('opens web and mail links outside the app and disables other schemes', async () => {
    const body = await chapterBody(
      '<a id="web" href="https://example.com">w</a><a id="mail" href="mailto:a@example.com">m</a><a id="file" href="file:///C:/x" target="_top">f</a>'
    );
    expect(body.querySelector('#web')?.getAttribute('target')).toBe('_blank');
    expect(body.querySelector('#mail')?.getAttribute('target')).toBe('_blank');
    expect(body.querySelector('#file')?.hasAttribute('href')).toBe(false);
    expect(body.querySelector('#file')?.hasAttribute('target')).toBe(false);
  });

  it('opens a book whose manifest has a bare percent sign it did not encode', async () => {
    // The lookup falls back to decoding the href, which throws on a lone '%'.
    const book = await parseEpub(await buildBook({ 'Ch 100%.xhtml': '<p>Full marks</p>' }, (n) => n.replace(' ', '%20')));
    expect(book.chapters).toHaveLength(1);
  });
});
