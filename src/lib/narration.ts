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

const BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'BLOCKQUOTE', 'PRE', 'DIV', 'SECTION',
  'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE',
  'TR', 'TH', 'TD', 'DT', 'DD', 'FIGURE', 'FIGCAPTION'
]);

const TERMINAL_PUNCTUATION = /[.!?…:;]["')\]]?$/;

function getClosestBlock(node: Node, container: HTMLElement): HTMLElement | null {
  let el = node.parentElement;
  while (el && el !== container) {
    if (BLOCK_TAGS.has(el.tagName.toUpperCase())) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

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
  let prevBlock: HTMLElement | null = null;
  let prevNode: Text | null = null;

  let current = walker.nextNode() as Text | null;
  while (current) {
    const value = current.nodeValue ?? '';
    const currBlock = getClosestBlock(current, container);

    if (prevNode !== null) {
      if (currBlock !== prevBlock) {
        // Crossed a block boundary (e.g. heading -> paragraph, or paragraph -> paragraph)
        const trimmedEnd = text.trimEnd();
        if (trimmedEnd.length > 0 && !TERMINAL_PUNCTUATION.test(trimmedEnd)) {
          // If previous heading or block lacked terminal punctuation, add a period to avoid run-on sentence
          text += '.';
        }
        text += '\n\n';
      } else {
        // Same block: ensure whitespace between adjacent inline tags if needed
        if (!/\s$/.test(text) && !/^\s/.test(value)) {
          text += ' ';
        }
      }
    }

    const start = text.length;
    text += value;
    segments.push({ node: current, start, end: text.length });

    prevBlock = currBlock;
    prevNode = current;
    current = walker.nextNode() as Text | null;
  }

  const trimmed = text.trimEnd();
  if (trimmed.length > 0 && !TERMINAL_PUNCTUATION.test(trimmed)) {
    text += '.';
  }

  return { text, segments };
}

/** Expand a character offset to the sentence containing it. */
export function sentenceBoundsAt(text: string, index: number): { start: number; end: number } {
  const terminators = /[.!?…]["')\]]?\s|\n\n+/g;

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

export function rangeFor(map: NarrationMap, start: number, end: number): Range | null {
  if (map.segments.length === 0) return null;

  // Find first segment that overlaps or starts after [start, end)
  const startSeg = map.segments.find((s) => s.end > start) ?? map.segments[0];
  // Find last segment that overlaps [start, end)
  let endSeg: TextSegment | null = null;
  for (let i = map.segments.length - 1; i >= 0; i--) {
    if (map.segments[i].start < end) {
      endSeg = map.segments[i];
      break;
    }
  }
  if (!endSeg) {
    endSeg = startSeg;
  }

  const range = document.createRange();
  const startOffset = Math.max(0, Math.min(startSeg.node.length, start - startSeg.start));
  const endOffset = Math.max(0, Math.min(endSeg.node.length, end - endSeg.start));

  try {
    range.setStart(startSeg.node, startOffset);
    range.setEnd(endSeg.node, endOffset);
    return range;
  } catch {
    return null;
  }
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

export interface NarrationChunk {
  text: string;
  startChar: number;
  endChar: number;
}

/**
 * Splits chapter prose into natural sentence/paragraph chunks for fast-starting,
 * pre-buffered neural synthesis.
 */
export function splitNarrationChunks(text: string, maxLen: number = 700, offset: number = 0): NarrationChunk[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const chunks: NarrationChunk[] = [];
  const terminators = /[.!?…]["')\]]?\s|\n\n+/g;
  let chunkStart = 0;
  let lastBoundary = 0;
  let match: RegExpExecArray | null;

  while ((match = terminators.exec(text)) !== null) {
    const boundary = match.index + match[0].length;
    if (boundary - chunkStart > maxLen && lastBoundary > chunkStart) {
      const chunkText = text.slice(chunkStart, lastBoundary).trim();
      if (chunkText) {
        chunks.push({
          text: chunkText,
          startChar: chunkStart + offset,
          endChar: lastBoundary + offset,
        });
      }
      chunkStart = lastBoundary;
    }
    lastBoundary = boundary;
  }

  const remaining = text.slice(chunkStart).trim();
  if (remaining) {
    chunks.push({
      text: remaining,
      startChar: chunkStart + offset,
      endChar: text.length + offset,
    });
  }

  return chunks;
}

/**
 * Converts a base64 audio string (e.g. MP3) into an object URL for HTMLAudioElement.
 */
export function base64ToBlobUrl(base64: string, mimeType: string = 'audio/mp3'): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  return URL.createObjectURL(blob);
}

export const FALLBACK_VOICE_CHOICES: { name: string; label: string }[] = [
  { name: 'en-US-JennyNeural', label: 'Jenny (US) — Natural, Warm ★' },
  { name: 'en-US-GuyNeural', label: 'Guy (US) — Natural, Conversational ★' },
  { name: 'en-US-AriaNeural', label: 'Aria (US) — Crisp, Clear ★' },
  { name: 'en-GB-SoniaNeural', label: 'Sonia (UK) — Melodic, British ★' },
  { name: 'en-GB-RyanNeural', label: 'Ryan (UK) — Articulate, British ★' },
  { name: 'en-AU-WilliamMultilingualNeural', label: 'William (AU) — Australian' },
  { name: 'en-CA-ClaraNeural', label: 'Clara (CA) — Canadian' },
  { name: 'en-IE-EmilyNeural', label: 'Emily (IE) — Irish' },
];

