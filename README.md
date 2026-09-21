# Acuity Reader

A minimalist, distraction-free desktop e-book and audiobook player for Windows.

Acuity brings text reading and spoken audio together under one roof, recognising that knowledge
and insight can be absorbed through multiple sensory modalities.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)
![Engine](https://img.shields.io/badge/engine-Electron%20%2B%20React%20%2B%20TypeScript-orange.svg)

---

## Status

Early development. This table is the honest state of each feature, so the rest of the document
can be read as description rather than aspiration.

| Feature | State |
|:--|:--|
| Library scanning, cover and metadata extraction | Working |
| Audiobook playback (`.m4b`, `.mp3`, `.m4a`, `.aac`, `.flac`, `.ogg`, `.opus`) | Working |
| Seeking within large audiobooks | Working (HTTP range streaming) |
| EPUB reading, spine-ordered with embedded images | Working |
| Read-aloud narration with sentence highlighting | Working (system TTS voices) |
| Companion pairing of text and audio editions | Working (matched on normalised title) |
| Progress persistence, per title and per format | Working |
| Bookmarks | Captured and stored; **no UI yet to browse or jump to them** |
| PDF reading | **Not implemented** — PDFs are indexed, but open to an explanatory notice |
| M4B chapter markers / ID3 chapter frames | **Not implemented** — navigation is by timeline only |
| SQLite library index | **Not implemented** — state is a JSON file in `userData` |
| macOS / mobile builds | **Not implemented** — Windows only today |

---

## Architecture

**Electron** (main process + preload bridge) with a **React 19 + TypeScript** renderer, built by
**Vite** and styled with **Tailwind CSS v4** over a CSS custom-property token layer.

> **Note on `src-tauri/`**
> The repository also contains a Tauri v2 scaffold. It is **not** the shipping shell — nothing
> builds or runs it, and `package.json` targets Electron. It is retained only as a possible future
> direction. Treat Electron as the real application until that is resolved one way or the other.

### Local file access

The renderer never loads `file://` URLs. Local media is requested through a custom `acuity://`
scheme registered in the main process, which resolves each request against the user's registered
library folders and refuses anything outside them. That is what allows Chromium's `webSecurity`
to remain enabled while still streaming audio and covers off local disk.

The handler implements HTTP range requests, without which `<audio>` cannot seek inside a
multi-hundred-megabyte `.m4b` — it can only stream from the beginning.

### Data

Library state (folders, indexed items, progress, bookmarks) is a single JSON document in
Electron's `userData` directory. Writes are debounced in the main process and committed
atomically via write-to-temp-then-rename, so an interrupted write cannot truncate the library.

View preferences (typeface, theme, volume, playback rate, sort order) live in `localStorage`;
they are per-install chrome rather than user content.

### EPUB pipeline

`src/lib/epub.ts` reads the archive in **spine order** taken from the OPF package document —
not zip entry order, which is arbitrary and interleaves front matter with chapters. Chapter
markup is sanitised (scripts, styles, remote resources and inline event handlers removed) and
embedded images are rewritten to blob URLs drawn from inside the archive.

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer

### Install and run

```bash
git clone https://github.com/ReallyCool10/acuity-reader.git
cd acuity-reader
npm install

# Renderer dev server + Electron
npm run dev

# Type-check renderer and main process
npm run typecheck

# Production build
npm run build
npm start
```

On Windows, `AcuityReader.cmd` and `run.vbs` launch an installed checkout directly; both resolve
paths relative to themselves, so the repository can live anywhere.

---

## Keyboard

| Key | Action |
|:--|:--|
| `Ctrl`/`Cmd` + `F` | Focus search |
| `Space` | Play / pause (when the reader is closed) |
| `←` / `→` | Previous / next chapter (in the reader) |
| `Esc` | Close the reader, or clear focus from search |

---

## Testing

There is **no test framework in this repository yet**. The EPUB parser and narration mapping are
the most fragile parts of the codebase and currently have no automated protection. Adding Vitest
with a DOM environment is the recommended next step; the parser's pure helpers (`resolveHref`,
`extractText`, `sentenceBoundsAt`) are written to be directly unit-testable.

---

## License

[MIT](LICENSE).
