/**
 * In-book full-text search utilities for Acuity Reader.
 * Supports token extraction, contextual snippets, and non-destructive
 * CSS Custom Highlight API rendering.
 */

export interface SearchResultItem {
  id: string;
  locationIndex: number;
  locationLabel: string;
  snippetBefore: string;
  matchedText: string;
  snippetAfter: string;
  textOffset: number;
}

const SEARCH_MATCH_HIGHLIGHT = 'acuity-search-match';
const SEARCH_ACTIVE_HIGHLIGHT = 'acuity-search-active';

/** Escape special regex characters in a query string. */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Searches within a plain text string for all occurrences of `query`,
 * extracting surrounding snippet context for each match.
 *
 * @param text The full text of the chapter or page
 * @param query The search query string
 * @param locationIndex Index of the chapter or page
 * @param locationLabel Display label (e.g., "Chapter 3: The Gathering" or "Page 42")
 * @param maxMatches Safety cap on number of matches to return per block
 */
export function searchInText(
  text: string,
  query: string,
  locationIndex: number,
  locationLabel: string,
  maxMatches = 100
): SearchResultItem[] {
  const cleanQuery = query.trim();
  if (!cleanQuery || !text) return [];

  const results: SearchResultItem[] = [];
  const regex = new RegExp(escapeRegExp(cleanQuery), 'gi');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null && results.length < maxMatches) {
    const textOffset = match.index;
    const matchedText = match[0];

    // Contextual snippet window (~35 chars before, ~45 chars after)
    const snippetStart = Math.max(0, textOffset - 35);
    const snippetEnd = Math.min(text.length, textOffset + matchedText.length + 45);

    let snippetBefore = text.slice(snippetStart, textOffset);
    let snippetAfter = text.slice(textOffset + matchedText.length, snippetEnd);

    // Add ellipses if snippet doesn't reach text boundary
    if (snippetStart > 0) {
      const firstSpace = snippetBefore.indexOf(' ');
      if (firstSpace > 0 && firstSpace < 15) {
        snippetBefore = '…' + snippetBefore.slice(firstSpace);
      } else {
        snippetBefore = '…' + snippetBefore;
      }
    }

    if (snippetEnd < text.length) {
      const lastSpace = snippetAfter.lastIndexOf(' ');
      if (lastSpace > 10) {
        snippetAfter = snippetAfter.slice(0, lastSpace) + '…';
      } else {
        snippetAfter = snippetAfter + '…';
      }
    }

    results.push({
      id: `match-${locationIndex}-${textOffset}`,
      locationIndex,
      locationLabel,
      snippetBefore,
      matchedText,
      snippetAfter,
      textOffset,
    });

    // Guard against zero-length infinite regex loops
    if (regex.lastIndex === match.index) {
      regex.lastIndex++;
    }
  }

  return results;
}

/**
 * Finds text nodes within a container and locates a range matching the target text.
 * Scrolls the found range into view and paints an active highlight.
 */
export function highlightAndScrollToMatch(
  container: HTMLElement,
  matchedText: string,
  textOffset?: number
): Range | null {
  if (!container || !matchedText) return null;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let currentNode = walker.nextNode();
  let accumulatedOffset = 0;
  let targetRange: Range | null = null;

  const targetLower = matchedText.toLowerCase();

  while (currentNode) {
    const nodeText = currentNode.nodeValue ?? '';
    const nodeLength = nodeText.length;

    // Check if the match falls into or starts within this node
    const nodeLower = nodeText.toLowerCase();
    const matchIndex = nodeLower.indexOf(targetLower);

    if (matchIndex !== -1) {
      // If a specific global textOffset was provided, verify proximity
      if (textOffset === undefined || Math.abs(accumulatedOffset + matchIndex - textOffset) < 150) {
        targetRange = document.createRange();
        targetRange.setStart(currentNode, matchIndex);
        targetRange.setEnd(currentNode, matchIndex + matchedText.length);
        break;
      }
    }

    accumulatedOffset += nodeLength;
    currentNode = walker.nextNode();
  }

  if (targetRange) {
    // Apply CSS Custom Highlight API if available
    if (typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined') {
      try {
        CSS.highlights.set(SEARCH_ACTIVE_HIGHLIGHT, new Highlight(targetRange));
      } catch {
        // Fallback gracefully
      }
    }

    // Scroll into view
    const rect = targetRange.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      const el = targetRange.commonAncestorContainer.parentElement;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  return targetRange;
}

/** Clears all in-reader search highlights. */
export function clearSearchHighlights(): void {
  if (typeof CSS !== 'undefined' && 'highlights' in CSS) {
    CSS.highlights.delete(SEARCH_MATCH_HIGHLIGHT);
    CSS.highlights.delete(SEARCH_ACTIVE_HIGHLIGHT);
  }
}
