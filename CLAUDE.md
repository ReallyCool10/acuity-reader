# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**Acuity Reader** — a Windows desktop e-book and audiobook player. Electron main process +
preload bridge, React 19 + TypeScript renderer, Vite, Tailwind CSS v4 over a CSS
custom-property token layer.

This repository is unrelated to the other repositories that may be checked out alongside it in
the same container. Ignore their `CLAUDE.md` files; they describe different products.

## Shell

**Electron.** The former `src-tauri/` scaffold has been removed; there is one shell.

## Commands

```bash
npm run dev         # Vite dev server + Electron
npm run typecheck   # renderer (tsconfig.json) AND main process (tsconfig.node.json)
npm run lint        # ESLint, including react-hooks rules
npm test            # Vitest (jsdom)
npm run build       # typecheck, build renderer + main + preload + MCP, assert CSS bundle
npm start           # run the built app
npm run dist        # electron-builder, Windows
```

Both tsconfigs must be checked. `tsconfig.json` covers `src/` only; `electron/` is covered by
`tsconfig.node.json`. Checking just one leaves half the codebase unverified.

## Architecture rules

1. **No `file://` in the renderer.** Local media is served through the `acuity://` scheme
   registered in `electron/main.ts`, which validates every path against the user's registered
   library folders. This is what lets `webSecurity` stay enabled — do not disable it.
   A folder becomes readable only when the user picks it (`dialog:pickFolder`) or it is in the
   saved library. Never register a folder because the renderer asked (`scanner:scanFolder`,
   `storage:save`): script in the page could then read any file on the machine.
2. **Path containment is checked with `path.relative`, not string prefixes.** A prefix test
   treats `/books-private` as inside `/books`.
3. **Range requests are required** in the media handler. Without them `<audio>` cannot seek
   within large `.m4b` files.
4. **Library writes are debounced and atomic** (temp file + rename) in the main process.
   `timeupdate` fires roughly 4×/sec; never write the library synchronously on each one.
5. **EPUB reading order comes from the OPF spine**, never from `zip.files` iteration order.
6. **`innerText` does not work on `DOMParser` documents** — it is defined in terms of rendered
   layout and returns null for a document that was never attached to a view. Use the tree walk in
   `extractText`. A regression here silently produces empty chapters.
7. **Chapter HTML must stay sanitised** before it reaches `dangerouslySetInnerHTML`. Sanitisation
   lives in `parseEpub`; do not render EPUB markup that has not been through it. Script in the
   renderer can reach the preload bridge, so a sanitiser miss is serious. URL schemes are read
   with `schemeOf`, which ignores whitespace and control characters as browsers do
   (`java&#9;script:` is javascript); never test a URL attribute with a plain prefix check.
   Links inside a book must not navigate the page: `parseEpub` rewrites them to
   `data-book-target` and the reader follows them. The main process also refuses every
   navigation of the window (`will-navigate`).
8. **Blob URLs minted for embedded images must be revoked** when the reader unmounts.
9. **Modules under `electron/` must not import `electron` at module scope** unless they genuinely
   need the app object at import time. A static `import { app } from 'electron'` forces anything
   importing that module - including a unit test of pure logic - to resolve the Electron binary.
   Inject host values instead, as `mcpSetup.configureMcpRuntime` does.
10. **Read-aloud has two engines, and the default one is online.** Microsoft's neural voices
    transmit the text being narrated to a Microsoft endpoint; the system voice does not. Any
    change to engine selection, defaults or fallback must keep the disclosure in the reader's
    voice picker and the Privacy section of `README.md` accurate.
11. **Item IDs must not depend on anything that routinely changes.** Progress, bookmarks and
    collection members are all keyed by item ID, so an ID change orphans all three silently.
    Multi-file audiobook IDs (`computeAudiobookGroupId`) are derived from the raw album tag or
    folder plus author - never the track list or the cleaned display title. If an ID scheme must
    change, record the old ID in `legacyIds` so `migrateLegacyItemIds` can move the references.
12. **`ProgressItem.percent` is 0-100 everywhere.** The Continue shelf only shows items above 1,
    so a value on a 0-1 scale silently hides the books a user is part-way through.
13. **Online narration speed is applied once, by the speech service.** Microsoft synthesises the
    audio at the chosen rate, so that audio must play at `playbackRate = 1`. Setting
    `playbackRate` as well squares the speed (1.5x plays at 2.25x). A speed change restarts
    narration from the current word rather than speeding up the clip in place.
14. **Narration highlights the word being spoken.** Timings come from the speech service's word
    boundaries, matched to the text by `alignWordBoundaries` (forward-only, never back to the start
    of the text), and the audio position is checked on animation frames. The engine reports each
    word once; keep per-word work in the reader cheap.
15. **Shelves load cover thumbnails, made off the UI thread.** Grid, shelf and list covers use
    `coverThumbUrl` (`acuity://thumb/...`); only the full-screen player and system media controls
    use the full-size `coverUrl`. Thumbnails are made by the renderer's Web Worker
    (`src/lib/thumbnails.ts`) and stored by `electron/thumbnails.ts`. Do not decode images with
    `nativeImage` in the main process for this: it is synchronous and runs on the UI thread that
    moves and paints the window (measured at 43-166 ms per cover), and it cannot read WebP.
16. **Covers come from what a book declares.** EPUB covers are found by `findEpubCover`
    (`electron/epubCover.ts`): the OPF's cover-image property, cover meta, guide or first page,
    never the first image in the archive. PDFs without art get page 1 drawn by
    `src/lib/pdfCovers.ts`.
17. **PDFs are opened by byte range.** The reader and PDF covers use `openPdfByRanges`
    (`src/lib/pdf.ts`), which reads only the ranges pdf.js asks for over IPC (`file:readRange`), so
    opening a large scanned book does not copy the whole file. Script in the renderer cannot read
    `acuity://` responses: the page's origin is `file://`, so CORS blocks fetch/XHR (images and
    media elements are unaffected).
18. **The library file has two writers.** The MCP server edits `acuity_library.json` directly
    (progress, bookmarks, collections). The main process notices another process's write (stamp
    check before every write, plus a watch) and sends it to the renderer, which merges it with
    `mergeExternalLibraryChanges` against the last saved state and saves again. Every save carries
    the renderer's `libraryGeneration`; saves from before a merge are dropped. Never write the
    library from a state that has not merged the latest outside edit.

## UI conventions

- Design tokens live in `src/styles/tokens.css`. Use them rather than hardcoding colour, radius,
  shadow, duration or easing. A single shared easing curve is the main reason the interface
  reads as coherent.
- `src/App.css` must stay imported from `src/main.tsx`. Without that import Vite emits no CSS
  bundle and every utility class in the app silently does nothing.
- Anything clickable is a real `<button>` with an accessible name. Cards are buttons, not
  `<div onClick>`. A button may not contain another button, so a control drawn on a book cover
  (such as "Add to collection") sits outside the card's open button, in the `.cover-frame`
  overlay that mirrors the cover's box.
- Covers are never cropped or padded to a fixed shape. Each card reserves the same shelf slot and
  the cover stands at the bottom of it at its own shape (`--cover-aspect`, clamped by
  `MIN_COVER_ASPECT`/`MAX_COVER_ASPECT` in `src/lib/coverArt.ts`), so every book shares one
  shelf line. Render cover art through `CoverArt` with `useCoverShape`: a cover stays hidden
  until its image is decoded and then fades in, with no placeholder frame; an image already in
  memory shows on the first paint, and an item without art shows its generated jacket at once.
- Honour `prefers-reduced-motion`; the token layer already collapses durations.
- Do not reintroduce magic pixel offsets for the Windows caption buttons — use the
  `env(titlebar-area-*)` variables with a fallback.

## Code quality

TypeScript strict mode. Prefer explicit types over `any`. Fix hook dependency warnings by
stabilising references with `useCallback`/`useMemo` or by capturing one-shot values in refs —
do not silence them with `eslint-disable`.

Do not commit `// TODO: implement` stubs, and do not present an unfinished feature in production
UI as though it works. If a format or capability is unsupported, say so in the UI and in the
README status table.

## Testing

Vitest in a jsdom environment; `src/test/setup.ts` stubs the jsdom gaps (`URL.createObjectURL`,
`ResizeObserver`, `scrollIntoView`). Tests sit beside their source.

`npm run build` asserts a CSS bundle was emitted - keep that check. It guards the failure mode
where the stylesheet is not imported, every utility class silently does nothing, and the build
still succeeds.

Note that `react-hooks/set-state-in-effect` is deliberately a warning rather than an error; see
the comment in `eslint.config.js`. Do not silence hook warnings with inline disables - an
`eslint-disable` for `exhaustive-deps` previously concealed a genuine callback cycle.

## Commit messages

Conventional Commits: `type(scope): description` (`feat`, `fix`, `docs`, `refactor`, `test`,
`chore`).
