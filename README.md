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
| Continuous play across multi-file audiobooks | Working |
| M4B chapter markers | Working |
| EPUB reading, spine-ordered with embedded images | Working |
| PDF reading, with outline, zoom and continuous scroll | Working |
| In-book full-text search | Working |
| Read-aloud narration with sentence highlighting | Working — **see [Privacy](#privacy)**, the default voices are online |
| Bookmarks, with navigation | Working |
| Sleep timer | Working |
| Companion pairing of text and audio editions | Working (matched on normalised title) |
| Progress persistence, per title and per format | Working |
| MCP server for AI access to the library | Working (stdio transport) |
| SQLite library index | **Not implemented** — state is a JSON file in `userData` |
| macOS / mobile builds | **Not implemented** — Windows only today |

---

## Architecture

**Electron** (main process + preload bridge) with a **React 19 + TypeScript** renderer, built by
**Vite** and styled with **Tailwind CSS v4** over a CSS custom-property token layer.

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

## Privacy

Acuity is a local application: your library is never uploaded, and the app has no account,
telemetry or analytics.

**One feature is an exception, and it is on by default.** Read-aloud offers two engines:

| Voice | Where synthesis happens | What leaves your machine |
|:--|:--|:--|
| **Online — Microsoft** (default) | Microsoft's servers | The text currently being read aloud |
| **System voice** | This device | Nothing |

The online voices sound considerably better, which is why they are the default, but choosing them
means the passage being narrated is transmitted to a Microsoft speech endpoint over a WebSocket.
If you are reading anything you would not send to a third party, pick **System voice** in the
reader's appearance menu. The choice is remembered, and narration falls back to the system voice
automatically whenever the online service is unreachable.

Two further caveats about the online engine:

- It talks to the endpoint that Microsoft Edge's own Read Aloud uses. That interface is
  undocumented and not intended for third-party clients, so it may change or stop working without
  notice. The fallback to the system voice exists partly for that reason.
- It requires an internet connection. The system voice does not.

The bundled MCP server communicates over **stdio only** — it opens no network port and is reachable
solely by a local process that launches it.

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

```bash
npm test          # Vitest, single run
npm run test:watch
npm run lint
```

Vitest runs in a jsdom environment. The suite covers the EPUB parser, PDF helpers, narration
offset mapping, in-book search, path containment, stable-ID migration, companion pairing and the
React components.

`npm run build` additionally asserts that a CSS bundle was emitted. That check exists because the
stylesheet was once not imported at all, so every utility class in the app silently did nothing
while the build still reported success.

---

## License

[MIT](LICENSE).
