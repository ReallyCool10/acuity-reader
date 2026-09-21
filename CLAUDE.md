# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**Acuity Reader** — a Windows desktop e-book and audiobook player. Electron main process +
preload bridge, React 19 + TypeScript renderer, Vite, Tailwind CSS v4 over a CSS
custom-property token layer.

This repository is unrelated to the other repositories that may be checked out alongside it in
the same container. Ignore their `CLAUDE.md` files; they describe different products.

## Shell: Electron, not Tauri

`package.json` builds and runs **Electron**. A `src-tauri/` scaffold exists but nothing builds
or runs it. Do not add features there, and do not follow it as a guide to how the app works.
If the split is ever resolved, update `README.md` in the same change.

## Commands

```bash
npm run dev         # Vite dev server + Electron
npm run typecheck   # renderer (tsconfig.json) AND main process (tsconfig.node.json)
npm run build       # typecheck, then build renderer + main + preload
npm start           # run the built app
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

There is no test framework here yet. When adding one, prefer Vitest with a DOM environment. The
highest-value targets are `src/lib/epub.ts`, `src/lib/narration.ts` and the path-containment
logic in `electron/main.ts`.

## Commit messages

Conventional Commits: `type(scope): description` (`feat`, `fix`, `docs`, `refactor`, `test`,
`chore`).
