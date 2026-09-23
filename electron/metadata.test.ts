import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import JSZip from 'jszip';
import {
  cleanTitleString,
  cleanTitle,
  decodePdfDocString,
  decodePdfHexString,
  readPdfMetadata,
  readEpubMetadata,
} from './metadata';

describe('electron/metadata', () => {
  describe('cleanTitleString', () => {
    it('strips shadow library domains and website tags in parentheses', () => {
      expect(cleanTitleString('Sherlock Holmes (zblibrary.sk1lib.sk, z-lib.sk)')).toBe('Sherlock Holmes');
      expect(cleanTitleString('The Way of Kings (z-lib.org)')).toBe('The Way of Kings');
      expect(cleanTitleString('Foundation [libgen.li]')).toBe('Foundation');
      expect(cleanTitleString('Dune (oceanofpdf.com)')).toBe('Dune');
      expect(cleanTitleString('1984 (annas-archive.org)')).toBe('1984');
    });

    it('strips publication years and edition markers in parentheses/brackets', () => {
      expect(cleanTitleString('The Great Gatsby (2011 etc.)')).toBe('The Great Gatsby');
      expect(cleanTitleString('The Great Gatsby (2011, Penguin Classics)')).toBe('The Great Gatsby');
      expect(cleanTitleString('The Hobbit [1998]')).toBe('The Hobbit');
      expect(cleanTitleString('Clean Code (2nd edition)')).toBe('Clean Code');
      expect(cleanTitleString('Design Patterns (revised ed.)')).toBe('Design Patterns');
    });

    it('cleans combined shadow tags, years, and malformed trailing artifacts', () => {
      expect(cleanTitleString('The Adventures of Sherlock Holmes (2011 etc.) (zblibrary.sk1lib.sk, z-lib.sk)')).toBe(
        'The Adventures of Sherlock Holmes'
      );
      expect(cleanTitleString('The Adventures of Sherlock Holmes 2011 etc.)')).toBe(
        'The Adventures of Sherlock Holmes'
      );
      expect(cleanTitleString('The Adventures of Sherlock Holmes - 2011 etc.) (z-lib.sk)')).toBe(
        'The Adventures of Sherlock Holmes'
      );
    });

    it('preserves legitimate non-tag parentheses', () => {
      expect(cleanTitleString('The Lord of the Rings (Part 1)')).toBe('The Lord of the Rings (Part 1)');
      expect(cleanTitleString('Hamlet (Annotated Edition)')).toBe('Hamlet (Annotated Edition)');
    });
  });

  describe('cleanTitle', () => {
    it('handles files with shadow tags after a trailing dash without inverting author and title', () => {
      const res = cleanTitle('The Adventures of Sherlock Holmes - 2011 etc.) (zblibrary.sk1lib.sk, z-lib.sk).pdf');
      expect(res.title).toBe('The Adventures of Sherlock Holmes');
      expect(res.author).toBe('');
    });

    it('parses "Author - Title" format correctly with shadow tags stripped', () => {
      const res = cleanTitle(
        'Arthur Conan Doyle - The Adventures of Sherlock Holmes (2011 etc.) (zblibrary.sk1lib.sk, z-lib.sk).pdf'
      );
      expect(res.author).toBe('Arthur Conan Doyle');
      expect(res.title).toBe('The Adventures of Sherlock Holmes');
    });

    it('parses "Title (Author)" format with tags stripped', () => {
      const res = cleanTitle(
        'The Adventures of Sherlock Holmes (Arthur Conan Doyle) (2011, Penguin) (z-lib.sk).pdf'
      );
      expect(res.title).toBe('The Adventures of Sherlock Holmes');
      expect(res.author).toBe('Arthur Conan Doyle');
    });

    it('strips leading track numbers from audio tracks', () => {
      const res = cleanTitle('01 - Brandon Sanderson - The Way of Kings.m4b');
      expect(res.author).toBe('Brandon Sanderson');
      expect(res.title).toBe('The Way of Kings');
    });
  });

  describe('decodePdfDocString & decodePdfHexString', () => {
    it('decodes escaped parentheses in PDF doc strings', () => {
      expect(decodePdfDocString('Book Title \\(Special Edition\\)')).toBe('Book Title (Special Edition)');
    });

    it('decodes UTF-16BE hex strings', () => {
      // FEFF004100630075006900740079 -> 'Acuity'
      expect(decodePdfHexString('FEFF004100630075006900740079')).toBe('Acuity');
    });
  });

  describe('readPdfMetadata', () => {
    it('extracts title and author from a PDF Info dictionary', async () => {
      const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pdf-test-'));
      const pdfPath = path.join(tmpDir, 'test.pdf');
      const samplePdf = Buffer.from(
        '%PDF-1.4\n1 0 obj\n<< /Title (The Adventures of Sherlock Holmes) /Author (Arthur Conan Doyle) >>\nendobj\ntrailer\n<< /Info 1 0 R >>\n%%EOF'
      );
      await fs.promises.writeFile(pdfPath, samplePdf);

      const meta = await readPdfMetadata(pdfPath);
      expect(meta.title).toBe('The Adventures of Sherlock Holmes');
      expect(meta.author).toBe('Arthur Conan Doyle');

      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });

    it('extracts title and author from an XMP packet in a PDF', async () => {
      const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pdf-test-'));
      const pdfPath = path.join(tmpDir, 'test-xmp.pdf');
      const samplePdf = Buffer.from(
        '%PDF-1.7\n<x:xmpmeta><rdf:RDF><rdf:Description><dc:title><rdf:Alt><rdf:li>Foundation</rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>Isaac Asimov</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>\n%%EOF'
      );
      await fs.promises.writeFile(pdfPath, samplePdf);

      const meta = await readPdfMetadata(pdfPath);
      expect(meta.title).toBe('Foundation');
      expect(meta.author).toBe('Isaac Asimov');

      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });

    it('returns empty object when file does not exist', async () => {
      const meta = await readPdfMetadata('C:/nonexistent/file.pdf');
      expect(meta).toEqual({});
    });
  });

  describe('readEpubMetadata', () => {
    it('reads title and author from an EPUB package document', async () => {
      const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'epub-test-'));
      const epubPath = path.join(tmpDir, 'test.epub');

      const zip = new JSZip();
      zip.file(
        'META-INF/container.xml',
        '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
      );
      zip.file(
        'OEBPS/content.opf',
        '<?xml version="1.0"?><package version="3.0" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Dune (z-lib.org)</dc:title><dc:creator>Frank Herbert</dc:creator></metadata></package>'
      );

      const content = await zip.generateAsync({ type: 'nodebuffer' });
      await fs.promises.writeFile(epubPath, content);

      const meta = await readEpubMetadata(epubPath);
      expect(meta.title).toBe('Dune');
      expect(meta.author).toBe('Frank Herbert');

      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });
  });
});
