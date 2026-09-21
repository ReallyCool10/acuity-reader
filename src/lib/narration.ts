/**
 * Narration support: map spoken character offsets back onto the rendered DOM so
 * the sentence being read can be highlighted.
 *
 * The text handed to the speech engine is built *from* the rendered nodes rather
 * than from the parser's plain-text copy. That guarantees offsets line up: any
 * divergence in whitespace handling between the two would drift the highlight
 * further out of step with every paragraph.
 */

interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

export interface NarrationMap {
  text: string;
  segments: TextSegment[];
}

const HIGHLIGHT_NAME = 'acuity-narration';

export function buildNarrationMap(container: HTMLElement): NarrationMap {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      // Skip text inside elements that are not part of the prose.
      const parent = (node.parentElement?.tagName || '').toUpperCase();
      if (parent === 'SCRIPT' || parent === 'STYLE') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const segments: TextSegment[] = [];
  let text = '';

  let current = walker.nextNode() as Text | null;
  while (current) {
    const value = current.nodeValue ?? '';
    const start = text.length;
    text += value;
    segments.push({ node: current, start, end: text.length });
    current = walker.nextNode() as Text | null;
  }

  return { text, segments };
}

/** Expand a character offset to the sentence containing it. */
export function sentenceBoundsAt(text: string, index: number): { start: number; end: number } {
  const terminators = /[.!?]["')\]]?\s|\n\n/g;

  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = terminators.exec(text)) !== null) {
    const boundary = match.index + match[0].length;
    if (boundary > index) {
      return { start, end: Math.min(text.length, boundary) };
    }
    start = boundary;
  }
  return { start, end: text.length };
}

function rangeFor(map: NarrationMap, start: number, end: number): Range | null {
  const startSeg = map.segments.find((s) => start >= s.start && start < s.end);
  const endSeg = map.segments.find((s) => end > s.start && end <= s.end);
  if (!startSeg || !endSeg) return null;

  const range = document.createRange();
  range.setStart(startSeg.node, start - startSeg.start);
  range.setEnd(endSeg.node, Math.min(end - endSeg.start, endSeg.node.length));
  return range;
}

/**
 * Paint the active sentence.
 *
 * Uses the CSS Custom Highlight API, which styles a Range without touching the
 * DOM — wrapping sentences in spans instead would rewrite the book's markup on
 * every boundary event and collapse any selection the reader had made.
 * Returns the highlighted range so the caller can scroll it into view.
 */
export function highlightSentence(map: NarrationMap, charIndex: number): Range | null {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return null;

  const { start, end } = sentenceBoundsAt(map.text, charIndex);
  const range = rangeFor(map, start, end);
  if (!range) return null;

  CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range));
  return range;
}

export function clearHighlight(): void {
  if (typeof CSS !== 'undefined' && 'highlights' in CSS) {
    CSS.highlights.delete(HIGHLIGHT_NAME);
  }
}

export function isHighlightSupported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
}
