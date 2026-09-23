import fs from 'node:fs';
import JSZip from 'jszip';

export { cleanTitleString, cleanTitle } from '../src/lib/metadata';
import { cleanTitleString } from '../src/lib/metadata';

export function decodePdfDocString(str: string): string {
  if (str.startsWith('\xfe\xff')) {
    let out = '';
    for (let i = 2; i < str.length - 1; i += 2) {
      out += String.fromCharCode((str.charCodeAt(i) << 8) | str.charCodeAt(i + 1));
    }
    return out.trim();
  }
  return str.replace(/\\\)/g, ')').replace(/\\\(/g, '(').replace(/\\\\/g, '\\').trim();
}

export function decodePdfHexString(hex: string): string {
  if (hex.toUpperCase().startsWith('FEFF')) {
    let out = '';
    for (let i = 4; i < hex.length - 3; i += 4) {
      out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    }
    return out.trim();
  }
  let out = '';
  for (let i = 0; i < hex.length - 1; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return out.trim();
}

/**
 * Lightweight, fast parser for PDF document metadata (Info dictionary and XMP packet).
 * Reads the head and tail of the file to extract Title and Author without loading the
 * full PDF rendering pipeline.
 */
export async function readPdfMetadata(filePath: string): Promise<{ title?: string; author?: string }> {
  try {
    const stats = await fs.promises.stat(filePath);
    const size = stats.size;
    let buffer: Buffer;
    if (size <= 256 * 1024) {
      buffer = await fs.promises.readFile(filePath);
    } else {
      const fd = await fs.promises.open(filePath, 'r');
      try {
        const head = Buffer.alloc(128 * 1024);
        await fd.read(head, 0, 128 * 1024, 0);
        const tail = Buffer.alloc(128 * 1024);
        await fd.read(tail, 0, 128 * 1024, Math.max(0, size - 128 * 1024));
        buffer = Buffer.concat([head, tail]);
      } finally {
        await fd.close();
      }
    }

    const text = buffer.toString('latin1');
    let title: string | undefined;
    let author: string | undefined;

    // 1. Try XMP packet: <dc:title> and <dc:creator>
    const xmpTitleMatch = text.match(/<dc:title>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i);
    if (xmpTitleMatch && xmpTitleMatch[1]) {
      const clean = xmpTitleMatch[1].replace(/<[^>]+>/g, '').trim();
      if (clean && clean.toLowerCase() !== 'untitled') {
        title = cleanTitleString(clean);
      }
    }

    const xmpAuthorMatch = text.match(/<dc:creator>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i);
    if (xmpAuthorMatch && xmpAuthorMatch[1]) {
      const clean = xmpAuthorMatch[1].replace(/<[^>]+>/g, '').trim();
      if (clean) author = clean;
    }

    // 2. Info dictionary: /Title (...) and /Author (...)
    if (!title) {
      const m = text.match(/\/Title\s*(?:\(([\s\S]*?)\)|<([0-9a-fA-F]+)>)/);
      if (m) {
        const raw = m[1] !== undefined ? decodePdfDocString(m[1]) : decodePdfHexString(m[2]);
        if (raw && raw.toLowerCase() !== 'untitled') {
          title = cleanTitleString(raw);
        }
      }
    }

    if (!author) {
      const m = text.match(/\/Author\s*(?:\(([\s\S]*?)\)|<([0-9a-fA-F]+)>)/);
      if (m) {
        const raw = m[1] !== undefined ? decodePdfDocString(m[1]) : decodePdfHexString(m[2]);
        if (raw) author = raw;
      }
    }

    return { title: title || undefined, author: author || undefined };
  } catch {
    return {};
  }
}

/**
 * Reads real title and author from an EPUB package document (OPF),
 * with case-insensitive and percent-decoded entry resolution.
 */
export async function readEpubMetadata(filePath: string): Promise<{ title?: string; author?: string }> {
  try {
    const zip = await JSZip.loadAsync(await fs.promises.readFile(filePath));

    // Case-insensitive container.xml entry search
    const containerFile =
      zip.file('META-INF/container.xml') ||
      Object.values(zip.files).find((f) => !f.dir && f.name.toLowerCase() === 'meta-inf/container.xml');
    if (!containerFile) return {};

    const containerXml = await containerFile.async('text');
    const opfPath = containerXml.match(/full-path="([^"]+)"/)?.[1];
    if (!opfPath) return {};

    const decodedOpf = decodeURIComponent(opfPath);
    const opfFile =
      zip.file(opfPath) ||
      zip.file(decodedOpf) ||
      Object.values(zip.files).find(
        (f) => !f.dir && decodeURIComponent(f.name).toLowerCase() === decodedOpf.toLowerCase()
      );
    if (!opfFile) return {};

    const opf = await opfFile.async('text');
    const pick = (field: string) =>
      opf
        .match(new RegExp(`<(?:dc:)?${field}[^>]*>([\\s\\S]*?)</(?:dc:)?${field}>`, 'i'))?.[1]
        ?.replace(/<[^>]+>/g, '')
        .trim();

    const rawTitle = pick('title');
    const rawAuthor = pick('creator');

    return {
      title: rawTitle ? cleanTitleString(rawTitle) : undefined,
      author: rawAuthor || undefined,
    };
  } catch {
    return {};
  }
}
