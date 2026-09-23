import type { Collection, CollectionKind, MediaItem } from '../types';

export type { Collection, CollectionKind };

export interface CollectionWorkItem {
  /** Primary representative media item for this work */
  primaryItem: MediaItem;
  /** Paired or direct book edition (EPUB or PDF) if available in library */
  bookItem?: MediaItem;
  /** Paired or direct audio edition (M4B, MP3, etc.) if available in library */
  audioItem?: MediaItem;
  /** True if both a book edition and an audio edition are paired in this work */
  isDual: boolean;
  /** All stable member IDs from the collection that resolved to this work */
  memberIds: string[];
  /** 1-based order in the collection (surfaced when kind === 'series') */
  orderIndex: number;
}

export interface SeriesSuggestion {
  name: string;
  kind: 'series';
  memberIds: string[];
  reason: string;
  booksCount: number;
  audioCount: number;
}

/**
 * Generate a unique, collision-resistant collection ID.
 */
export function generateCollectionId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 9);
  return `col_${timestamp}_${randomPart}`;
}

/**
 * Create a new collection.
 * Deduplicates initial memberIds while preserving order.
 */
export function createCollection(
  name: string,
  kind: CollectionKind = 'series',
  memberIds: string[] = [],
  description?: string
): Collection {
  const trimmedName = name.trim();
  const uniqueMemberIds = Array.from(new Set(memberIds));
  const now = Date.now();

  return {
    id: generateCollectionId(),
    name: trimmedName,
    kind,
    description: description?.trim() || undefined,
    memberIds: uniqueMemberIds,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Update an existing collection's properties, bumping its updatedAt timestamp.
 */
export function updateCollection(
  collection: Collection,
  patch: Partial<Pick<Collection, 'name' | 'kind' | 'description' | 'memberIds'>>
): Collection {
  const updated: Collection = {
    ...collection,
    updatedAt: Date.now(),
  };

  if (patch.name !== undefined) {
    updated.name = patch.name.trim();
  }
  if (patch.kind !== undefined) {
    updated.kind = patch.kind;
  }
  if (patch.description !== undefined) {
    updated.description = patch.description.trim() || undefined;
  }
  if (patch.memberIds !== undefined) {
    updated.memberIds = Array.from(new Set(patch.memberIds));
  }

  return updated;
}

/**
 * Add a member item ID to a collection.
 * Appends to the end of memberIds if not already present.
 */
export function addMemberToCollection(collection: Collection, itemId: string): Collection {
  if (collection.memberIds.includes(itemId)) {
    return collection;
  }
  return {
    ...collection,
    memberIds: [...collection.memberIds, itemId],
    updatedAt: Date.now(),
  };
}

/**
 * Remove a member item ID from a collection.
 */
export function removeMemberFromCollection(collection: Collection, itemId: string): Collection {
  if (!collection.memberIds.includes(itemId)) {
    return collection;
  }
  return {
    ...collection,
    memberIds: collection.memberIds.filter((id) => id !== itemId),
    updatedAt: Date.now(),
  };
}

/**
 * Reorder collection members.
 * Preserves any unmentioned member IDs (e.g. offline items) at the end.
 */
export function reorderCollectionMembers(collection: Collection, orderedIds: string[]): Collection {
  const existingSet = new Set(collection.memberIds);
  const newOrder: string[] = [];

  for (const id of orderedIds) {
    if (existingSet.has(id) && !newOrder.includes(id)) {
      newOrder.push(id);
    }
  }

  // Append any existing IDs that were not explicitly in orderedIds
  for (const id of collection.memberIds) {
    if (!newOrder.includes(id)) {
      newOrder.push(id);
    }
  }

  return {
    ...collection,
    memberIds: newOrder,
    updatedAt: Date.now(),
  };
}

/**
 * Move a member one step up or down in the collection ordering.
 */
export function moveMemberInCollection(
  collection: Collection,
  itemId: string,
  direction: 'up' | 'down'
): Collection {
  const index = collection.memberIds.indexOf(itemId);
  if (index === -1) return collection;

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= collection.memberIds.length) {
    return collection;
  }

  const newMembers = [...collection.memberIds];
  const [removed] = newMembers.splice(index, 1);
  newMembers.splice(targetIndex, 0, removed);

  return {
    ...collection,
    memberIds: newMembers,
    updatedAt: Date.now(),
  };
}

/**
 * Derived reverse lookup: get all collections that contain the specified item.
 * Optionally matches against a companion item ID so a paired work matches both editions.
 */
export function getCollectionsForItem(
  collections: Collection[],
  itemId: string,
  companionItemId?: string
): Collection[] {
  return collections.filter(
    (col) =>
      col.memberIds.includes(itemId) ||
      (companionItemId !== undefined && col.memberIds.includes(companionItemId))
  );
}

/**
 * Build a lookup map of itemId -> Collection[] for efficient rendering across the library.
 */
export function buildItemCollectionsMap(collections: Collection[]): Map<string, Collection[]> {
  const map = new Map<string, Collection[]>();
  for (const col of collections) {
    for (const memberId of col.memberIds) {
      const existing = map.get(memberId);
      if (existing) {
        existing.push(col);
      } else {
        map.set(memberId, [col]);
      }
    }
  }
  return map;
}

/**
 * Resolve a collection's member IDs into displayable work items.
 *
 * Rules:
 * 1. Filtering unresolvable IDs: Items missing from the library (e.g. unplugged drive)
 *    are filtered out at display time without modifying the underlying collection.memberIds.
 * 2. Companion deduplication: If a collection contains both audio and text editions of the
 *    same work (or if an added item is paired with a companion in the library), they are
 *    unified into a single CollectionWorkItem with both bookItem and audioItem populated,
 *    allowing unified Read + Listen presentation.
 * 3. Ordering: Preserves the order in collection.memberIds based on first appearance.
 */
export function resolveCollectionMembers(
  collection: Collection,
  libraryItems: MediaItem[]
): CollectionWorkItem[] {
  const itemById = new Map<string, MediaItem>();
  const itemByPath = new Map<string, MediaItem>();

  for (const item of libraryItems) {
    itemById.set(item.id, item);
    itemByPath.set(item.filePath, item);
  }

  const workItems: CollectionWorkItem[] = [];
  // Tracks companion group keys already added to workItems: workKey -> index in workItems
  const seenWorkKeyToIndex = new Map<string, number>();

  function getWorkKey(item: MediaItem): string {
    if (item.companionPath) {
      const paths = [item.filePath, item.companionPath].sort();
      return `work::${paths.join('::')}`;
    }
    return `item::${item.filePath}`;
  }

  for (const memberId of collection.memberIds) {
    const item = itemById.get(memberId);
    if (!item) {
      // Missing / offline item: preserved in collection.memberIds, omitted from display
      continue;
    }

    const workKey = getWorkKey(item);
    const existingIndex = seenWorkKeyToIndex.get(workKey);

    if (existingIndex !== undefined) {
      // Already emitted as a work group; attach memberId and complete book/audio pointers
      const existing = workItems[existingIndex];
      if (!existing.memberIds.includes(memberId)) {
        existing.memberIds.push(memberId);
      }
      if (item.mediaType === 'book' && !existing.bookItem) {
        existing.bookItem = item;
      } else if (item.mediaType === 'audio' && !existing.audioItem) {
        existing.audioItem = item;
      }
      existing.isDual = Boolean(existing.bookItem && existing.audioItem);
      continue;
    }

    // Resolve companion item from library if paired
    let companion: MediaItem | undefined;
    if (item.companionPath) {
      companion = itemByPath.get(item.companionPath);
    }

    const bookItem =
      item.mediaType === 'book' ? item : companion?.mediaType === 'book' ? companion : undefined;
    const audioItem =
      item.mediaType === 'audio' ? item : companion?.mediaType === 'audio' ? companion : undefined;

    const workItem: CollectionWorkItem = {
      primaryItem: item,
      bookItem,
      audioItem,
      isDual: Boolean(bookItem && audioItem),
      memberIds: [memberId],
      orderIndex: workItems.length + 1,
    };

    seenWorkKeyToIndex.set(workKey, workItems.length);
    workItems.push(workItem);
  }

  return workItems;
}

/**
 * Return the count of member IDs that cannot be resolved in the current library (e.g. offline drives).
 */
export function getUnresolvedMemberCount(
  collection: Collection,
  libraryItems: MediaItem[]
): number {
  const existingIds = new Set(libraryItems.map((item) => item.id));
  return collection.memberIds.filter((id) => !existingIds.has(id)).length;
}

interface ParsedSeriesHint {
  seriesName: string;
  volumeNumber: number;
}

/**
 * Extract series title and volume number from a book or audiobook title.
 */
export function parseSeriesHintFromTitle(title: string): ParsedSeriesHint | null {
  const trimmed = title.trim();

  // Pattern 1: Title (Series Name #1) or Title (Series Name, Book 1)
  const parenMatch = trimmed.match(/\(([^)]+?)(?:,|\s+)(?:Book|Vol\.?|Volume|Part|#)\s*(\d+(?:\.\d+)?)\)$/i);
  if (parenMatch) {
    const seriesName = parenMatch[1].trim();
    const volumeNumber = parseFloat(parenMatch[2]);
    if (seriesName && !Number.isNaN(volumeNumber)) {
      return { seriesName, volumeNumber };
    }
  }

  // Pattern 2: Series Name, Book 1: Subtitle OR Series Name: Book 1 - Subtitle OR Series Name, Book 1
  const commaMatch = trimmed.match(
    /^(.*?)(?:,\s*|:\s*|\s*[-–—]\s+)(?:Book|Vol\.?|Volume|Part|#)\s*(\d+(?:\.\d+)?)(?:\s*[:\-–—]\s*(.*))?$/i
  );
  if (commaMatch) {
    const seriesName = commaMatch[1].trim();
    const volumeNumber = parseFloat(commaMatch[2]);
    if (seriesName && !Number.isNaN(volumeNumber)) {
      return { seriesName, volumeNumber };
    }
  }

  // Pattern 3: Series Name #1 Subtitle
  const hashMatch = trimmed.match(/^(.*?)\s+#(\d+(?:\.\d+)?)(?:\s*[:\-–—]\s*(.*))?$/i);
  if (hashMatch) {
    const seriesName = hashMatch[1].trim();
    const volumeNumber = parseFloat(hashMatch[2]);
    if (seriesName && !Number.isNaN(volumeNumber)) {
      return { seriesName, volumeNumber };
    }
  }

  return null;
}

/**
 * Detect candidate series collections from metadata in libraryItems.
 * Only returns suggestions not already represented in existingCollections.
 */
export function detectSeriesSuggestions(
  libraryItems: MediaItem[],
  existingCollections: Collection[] = []
): SeriesSuggestion[] {
  const existingNames = new Set(
    existingCollections.map((col) => col.name.trim().toLowerCase())
  );

  interface CandidateItem {
    item: MediaItem;
    volumeNumber: number;
  }

  const seriesCandidates = new Map<string, { seriesName: string; candidates: CandidateItem[] }>();

  // 1. Group by parsed title hints
  for (const item of libraryItems) {
    const hint = parseSeriesHintFromTitle(item.title);
    if (hint) {
      const normKey = `${hint.seriesName.toLowerCase()}:::${(item.author || '').toLowerCase()}`;
      if (!seriesCandidates.has(normKey)) {
        seriesCandidates.set(normKey, { seriesName: hint.seriesName, candidates: [] });
      }
      seriesCandidates.get(normKey)!.candidates.push({
        item,
        volumeNumber: hint.volumeNumber,
      });
    }
  }

  // 2. Also group by album when album is shared by 2+ items with different titles
  const albumGroups = new Map<string, MediaItem[]>();
  for (const item of libraryItems) {
    if (item.album && item.album.trim() && item.album.trim().toLowerCase() !== item.title.trim().toLowerCase()) {
      const normKey = `${item.album.trim().toLowerCase()}:::${(item.author || '').toLowerCase()}`;
      if (!albumGroups.has(normKey)) {
        albumGroups.set(normKey, []);
      }
      albumGroups.get(normKey)!.push(item);
    }
  }

  for (const [, items] of albumGroups) {
    // Only consider albums with at least 2 distinct works
    if (items.length >= 2) {
      const albumName = items[0].album!.trim();
      const normKey = `album::${albumName.toLowerCase()}:::${(items[0].author || '').toLowerCase()}`;
      if (!seriesCandidates.has(normKey)) {
        const candidates = items.map((item, index) => ({
          item,
          volumeNumber: item.discNumber ?? item.trackNumber ?? index + 1,
        }));
        seriesCandidates.set(normKey, { seriesName: albumName, candidates });
      }
    }
  }

  const suggestions: SeriesSuggestion[] = [];

  for (const [, { seriesName, candidates }] of seriesCandidates) {
    if (existingNames.has(seriesName.toLowerCase())) {
      continue;
    }

    // Dedupe companion works so each distinct work contributes once to the member list
    const seenWorkPaths = new Set<string>();
    const uniqueCandidates: CandidateItem[] = [];

    for (const c of candidates) {
      const workKey = c.item.companionPath
        ? [c.item.filePath, c.item.companionPath].sort().join('::')
        : c.item.filePath;
      if (!seenWorkPaths.has(workKey)) {
        seenWorkPaths.add(workKey);
        uniqueCandidates.push(c);
      }
    }

    if (uniqueCandidates.length < 2) {
      continue;
    }

    // Sort by detected volume number, then track/disc, then title
    uniqueCandidates.sort((a, b) => {
      if (a.volumeNumber !== b.volumeNumber) {
        return a.volumeNumber - b.volumeNumber;
      }
      return a.item.title.localeCompare(b.item.title, undefined, { numeric: true });
    });

    const memberIds = uniqueCandidates.map((c) => c.item.id);
    const booksCount = uniqueCandidates.filter((c) => c.item.mediaType === 'book').length;
    const audioCount = uniqueCandidates.filter((c) => c.item.mediaType === 'audio').length;

    suggestions.push({
      name: seriesName,
      kind: 'series',
      memberIds,
      reason: `Found ${uniqueCandidates.length} works matching "${seriesName}"`,
      booksCount,
      audioCount,
    });
  }

  return suggestions;
}
