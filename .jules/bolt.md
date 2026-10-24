## 2026-10-24 - Fast-path checking for track progress resolution
**Learning:** `resolveAudiobookProgress` is called repeatedly for every item on every render, search filter, and sorting pass, as well as on every audio playback progress update. Checking if `progressMap` is empty via an early `for...in` loop prevents $O(\text{tracks})$ property lookups when no constituent progress is present.
**Action:** Always provide an $O(1)$ fast path check before initiating collection/array iterations in frequently called library helper functions.
