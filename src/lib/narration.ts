/**
 * Narration support: map spoken character offsets back onto the rendered DOM so
 * the word being read can be highlighted.
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
 * Paint the word being spoken.
 *
 * Uses the CSS Custom Highlight API, which styles a Range without touching the
 * DOM - wrapping words in spans instead would rewrite the book's markup on
 * every word and collapse any selection the reader had made.
 * Returns the highlighted range so the caller can keep it in view.
 */
export function highlightWord(map: NarrationMap, start: number, end: number): Range | null {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return null;
  if (end <= start) return null;

  const range = rangeFor(map, start, Math.min(end, map.text.length));
  if (!range) return null;

  CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range));
  return range;
}

/*
 * Word boundaries: letters and digits, with apostrophes and hyphens allowed
 * inside a word so "don't", "o'clock" and "well-known" stay whole. Leading and
 * trailing punctuation is left out of the highlight.
 */
const WORD_PATTERN = /[\p{L}\p{N}](?:[\p{L}\p{N}\u2019'-]*[\p{L}\p{N}])?/gu;

/** The span of the first word starting at or after `index`, or null if none remains. */
export function wordAt(text: string, index: number): { start: number; end: number } | null {
  WORD_PATTERN.lastIndex = Math.max(0, index);
  const match = WORD_PATTERN.exec(text);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

/** A word in a synthesised chunk, located in the chunk's text and in the audio. */
export interface TimedWord {
  /** Character offsets within the chunk text. */
  start: number;
  end: number;
  /** When the word is spoken, in milliseconds from the start of the chunk's audio. */
  offsetMs: number;
}

export interface SpeechBoundary {
  type: 'word' | 'sentence';
  offsetMs: number;
  text: string;
}

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

/** Undo the escaping applied when the text was wrapped in SSML for synthesis. */
function decodeXmlEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity] ?? entity);
}

/**
 * Locate each spoken word from the speech service in the chunk's text.
 *
 * The service reports the text of each word it spoke, but not where in the
 * input that word sits, so words are found by searching forwards from the
 * previous match. Two rules keep the highlight from wandering:
 *
 * - It never searches backwards. The old matcher retried from the start of the
 *   text on a miss, so an unmatched common word ("the") could jump the
 *   highlight back several sentences.
 * - It only accepts a match close to where the previous word ended. A word the
 *   service rendered differently from the text would otherwise latch onto a
 *   later occurrence and skip ahead. The window widens after consecutive
 *   misses, so alignment recovers instead of stalling.
 *
 * Unmatched words are dropped; the highlight simply stays on the previous word.
 * If the service sent no word boundaries at all, sentence boundaries are used
 * so narration still shows some position.
 */
export function alignWordBoundaries(chunkText: string, boundaries: SpeechBoundary[]): TimedWord[] {
  const hasWords = boundaries.some((b) => b.type === 'word');
  const spoken = boundaries
    .filter((b) => (hasWords ? b.type === 'word' : b.type === 'sentence') && b.text)
    .sort((a, b) => a.offsetMs - b.offsetMs);

  const lowerText = chunkText.toLowerCase();
  const timed: TimedWord[] = [];
  let cursor = 0;
  let consecutiveMisses = 0;

  for (const boundary of spoken) {
    const token = decodeXmlEntities(boundary.text).trim();
    if (!token) continue;

    const window = 40 + token.length * 2 + consecutiveMisses * 60;
    let index = chunkText.indexOf(token, cursor);
    if (index === -1 || index - cursor > window) {
      index = lowerText.indexOf(token.toLowerCase(), cursor);
    }

    if (index === -1 || index - cursor > window) {
      consecutiveMisses += 1;
      continue;
    }

    timed.push({ start: index, end: index + token.length, offsetMs: boundary.offsetMs });
    cursor = index + token.length;
    consecutiveMisses = 0;
  }

  return timed;
}

/**
 * Index of the word being spoken at `timeMs`: the last word that has started.
 * Words are ordered by start time, so this is a binary search; it runs on every
 * animation frame during playback. Returns -1 before the first word.
 */
export function findWordIndexAt(words: TimedWord[], timeMs: number): number {
  let low = 0;
  let high = words.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (words[mid].offsetMs <= timeMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
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

