import type { EpubChapter } from './epub';

/**
 * URLs inside an EPUB, and following its links.
 *
 * `parseEpub` rewrites each link to another part of the book so that it cannot
 * navigate the app's page, recording its target in `data-book-target` as an
 * archive path plus an optional fragment. The reader resolves that here.
 */

/**
 * The scheme a browser would read from a URL attribute, lower-cased, or null for
 * a relative URL. Browsers ignore ASCII whitespace and control characters here,
 * so `java&#9;script:` is still javascript.
 */
export function schemeOf(value: string): string | null {
  // Runs on every attribute in a book, so it stops at the first character that
  // cannot be part of a scheme rather than normalising the whole value.
  let scheme = '';
  for (const ch of value) {
    if (ch <= ' ' || ch === '\u007f') continue;
    if (ch === ':') return /^[a-z]/.test(scheme) ? scheme : null;
    if (!/[a-z0-9+.-]/i.test(ch)) return null;
    scheme += ch.toLowerCase();
  }
  return null;
}

/**
 * decodeURIComponent that decodes each run of escapes on its own, leaving a
 * malformed one (such as a bare `%`) as written instead of throwing.
 */
export function safeDecode(value: string): string {
  return value.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

export interface BookTarget {
  path: string;
  /** Element id within the chapter, decoded; empty for the top of the chapter. */
  fragment: string;
}

export function parseBookTarget(target: string): BookTarget {
  const hashAt = target.indexOf('#');
  if (hashAt === -1) return { path: target, fragment: '' };
  return { path: target.slice(0, hashAt), fragment: safeDecode(target.slice(hashAt + 1)) };
}

/**
 * Index of the chapter at `path`, or -1 when the book has no such chapter (one
 * the reader skipped as an empty page, say). Books disagree with themselves on
 * percent-encoding and case, so both are forgiven, an exact match first.
 */
export function findChapterIndex(chapters: EpubChapter[], path: string): number {
  const wanted = safeDecode(path);
  const exact = chapters.findIndex((chapter) => safeDecode(chapter.href) === wanted);
  if (exact !== -1) return exact;
  const lower = wanted.toLowerCase();
  return chapters.findIndex((chapter) => safeDecode(chapter.href).toLowerCase() === lower);
}

/** The element a fragment names within a chapter: by id, or an older `<a name>` anchor. */
export function findFragment(container: Element | null, fragment: string): Element | null {
  if (!container || !fragment) return null;
  for (const el of Array.from(container.querySelectorAll('[id], a[name]'))) {
    if (el.id === fragment || el.getAttribute('name') === fragment) return el;
  }
  return null;
}

/**
 * Scroll `scroller` so `target` sits a little below its top edge. Moves only the
 * reader's own scroll area, unlike `scrollIntoView`, which also scrolls every
 * scrollable ancestor.
 */
export function scrollToElement(scroller: HTMLElement, target: Element, margin = 24): void {
  const offset = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  scroller.scrollTop += offset - margin;
}
