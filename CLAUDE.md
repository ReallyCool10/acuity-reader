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
   lives in `parseEpub`; do not render EPUB markup that has not been through it.
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

## UI conventions

- Design tokens live in `src/styles/tokens.css`. Use them rather than hardcoding colour, radius,
  shadow, duration or easing. A single shared easing curve is the main reason the interface
  reads as coherent.
- `src/App.css` must stay imported from `src/main.tsx`. Without that import Vite emits no CSS
  bundle and every utility class in the app silently does nothing.
- Anything clickable is a real `<button>` with an accessible name. Cards are buttons, not
  `<div onClick>`.
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
