## 2026-10-17 - Pre-indexing library items for collection member resolution
**Learning:** Functions like `resolveCollectionMembers` and `getUnresolvedMemberCount` that resolve library items by ID or path rebuild `Map` and `Set` lookups on each call. When mapping over $C$ collections in UI grids, this leads to $O(C \times N)$ redundant Map/Set allocations per render.
**Action:** Pass a memoized `LibraryLookups` object created via `createLibraryLookups` when resolving collection members across multiple collection components.
