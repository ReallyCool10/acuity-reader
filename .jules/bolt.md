# Bolt's Performance Journal

## 2025-05-18 - Pre-index Sort Keys and Hoist Intl.Collator for Library Sorting
**Learning:** In Acuity Reader, `library.progress` updates roughly ~4x per second during playback, causing `visibleItems` and `continueItems` in `src/App.tsx` to recalculate. Inside `visibleItems`, `new Intl.Collator(...)` was instantiated on every recalculation (which has significant ICU collation table setup overhead). Additionally, the default `'recent'` sort comparator invoked `resolveAudiobookProgress()` repeatedly inside the $O(N \log N)$ comparator, redundantly checking constituent tracks and progress maps.
**Action:** Always pre-calculate derived sorting keys (such as `lastPlayed` timestamps via `resolveAudiobookProgress`) into an $O(N)$ lookup Map or object before calling `.sort()`, and keep `Intl.Collator` instances at module level to reuse ICU collation instances across renders.
