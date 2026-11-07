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
| Read-aloud narration with word-by-word highlighting | Working — **see [Privacy](#privacy)**, the default voices are online |
| Offline natural voice (Kokoro), switchable with the online voices | Working — optional 92 MB download; word highlighting is estimated, so slightly less exact than online |
| Bookmarks, with navigation | Working |
| Sleep timer | Working |
| Companion pairing of text and audio editions | Working (matched on normalised title) |
| Progress persistence, per title and per format | Working |
| Finished status (automatic at the end, or by hand) and reading history | Working — history is recorded; there is no screen to browse it yet |
| Removing titles, and getting their progress back when they return | Working (Settings, Library folders, Removed titles) |
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

### Cover thumbnails

Shelves show covers a few hundred pixels tall, but cover files are often 1,500–2,500 pixels
tall, and decoding them at full size left empty slots behind a fast scroll. Shelves therefore
request `acuity://thumb/<path>`. A Web Worker in the renderer shrinks each cover to fit 600 pixels
in the background, off every UI thread, and the main process keeps the result in a `thumbs`
folder in `userData`, keyed by the cover's path, size and modification time. A cover without a
thumbnail yet is served at full size, and thumbnails for covers no longer in the library are
deleted at startup. Deleting the folder is safe; it is rebuilt.

### Where covers come from

In order: an image beside the book with the same name (`Dune.jpg` next to `Dune.epub`); the art
embedded in an audiobook; for an EPUB, the cover the book itself declares in its package document
(never simply the first image in the archive, which is often a publisher's logo); a `cover.jpg`
or `folder.jpg` in a folder holding a single work; and, for a PDF with none of these, its first
page, drawn in the background. EPUB covers chosen by earlier versions are corrected on the next
**Rescan library**.

A folder that cannot be reached when you rescan (an unplugged drive, an offline network share)
keeps the books its last scan found, with their progress and dates, until it is back.

### Data

Library state is a single JSON document, `acuity_library.json`, in Electron's `userData`
directory. Writes are debounced in the main process and committed atomically via
write-to-temp-then-rename, so an interrupted write cannot truncate the library.

Reader data is kept in this one central file rather than beside each book. Writing into the
books' folders would fail on read-only or network locations, scatter files through your library,
and, if written into the book file itself, change the file's size, which is part of how a title is
recognised. The file holds:

| Key | What it holds |
|:--|:--|
| `items` | The titles on the shelf now |
| `progress` | Position, percentage, when each title was started and finished |
| `bookmarks`, `collections` | As named |
| `history` | Reading and listening sessions (start, end, percentage before and after), the most recent 2,000 |
| `catalog` | Every title the library has held, including removed ones and those in disconnected folders |

All of these are keyed by a title's ID, which is derived from its title, author and file size, not
its path, so moving or renaming a folder does not lose anything. Removing a title or a folder takes
it off the shelf only: its progress, bookmarks and history stay in the file. When it comes back
(restored from **Removed titles**, or its folder added again) it has them again. A copy with a
different file size, a re-download for example, gets a different ID; if exactly one absent title
in the catalogue has the same title, author and format, the copy takes over its data.

View preferences (typeface, theme, volume, playback rate, sort order) live in `localStorage`;
they are per-install chrome rather than user content.

### EPUB pipeline

`src/lib/epub.ts` reads the archive in **spine order** taken from the OPF package document —
not zip entry order, which is arbitrary and interleaves front matter with chapters. Chapter
markup is sanitised (scripts, styles, inline event handlers, script URLs and anything that would
load from outside the book removed, remote images included) and embedded images are rewritten to
blob URLs drawn from inside the archive. Links to other parts of the book are rewritten for the
reader to follow (footnotes scroll within the chapter; links to another chapter open it at the
target); web and mail links open in the default browser or mail client. The window itself never
navigates away from the app.

---

## Privacy

Acuity is a local application: your library is never uploaded, and the app has no account,
telemetry or analytics. Apart from the online voices below, it makes no network requests: its
fonts are bundled, and books are shown without anything they would load from the web.

**One feature is an exception, and it is on by default.** Read-aloud offers three engines, chosen
with the **Online / Offline** switch in the reader's appearance menu:

| Voice | Where synthesis happens | What leaves your machine |
|:--|:--|:--|
| **Online — Microsoft** (default) | Microsoft's servers | The text currently being read aloud |
| **Offline — Kokoro** (optional download) | This device | Nothing |
| **Basic system voice** | This device | Nothing |

The online voices sound the most natural, which is why they are the default, but choosing them
means the passage being narrated is transmitted to a Microsoft speech endpoint over a WebSocket.
If you are reading anything you would not send to a third party, switch to **Offline**. The
choice is remembered, and each side remembers its own voice.

If the online service cannot be reached or refuses a request, narration carries on with the
offline voice if it is installed, otherwise the basic system voice, and the reader shows a notice
saying why; the failure is also written to the app's error log. Narration never falls back the
other way: an offline voice never sends text online.

About the online engine:

- It talks to the endpoint that Microsoft Edge's own Read Aloud uses. That interface is
  undocumented and not intended for third-party clients, so it may change or stop working without
  notice (in November 2026 it began requiring a new form of request token, which the app now
  sends). The fallbacks exist partly for that reason.
- It requires an internet connection.
- While the Online side of the voice menu is open, the app fetches the list of available voices
  from the same service (no book text is sent). Opening a book does not contact it.

About the offline engine:

- [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) (82M-parameter model, Apache-2.0), run with
  ONNX Runtime in a background process, so it cannot slow or crash the window. It uses a few
  hundred MB of memory while reading and is stopped after a few idle minutes.
- The model is a one-time 92 MB download from Hugging Face, made only when you press **Download**
  (in the voice menu, or Settings › Read Aloud), from a pinned revision and checked against its
  SHA-256. Settings › Read Aloud removes it. The English voices (US and UK) ship with the app.
- It runs faster than real time on a recent PC's processor and needs no graphics card; speech
  starts after the first short sentence is ready.
- Kokoro reports no word timings, so the highlight is estimated within each sentence and can run
  slightly ahead or behind; each sentence starts in step.
- Licensing note for anyone redistributing the app: the `phonemizer` package that converts text
  to phonemes for Kokoro compiles in eSpeak NG, which is GPL-3.0, although the package itself is
  labelled Apache-2.0.

The bundled MCP server communicates over **stdio only** — it opens no network port and is reachable
solely by a local process that launches it.

Changes made through the MCP server (progress, bookmarks, collections) appear in the app while it
is open, and are merged with the app's own changes rather than saved over.

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 22.22.2 or newer on the 22 line, or 24.15 or newer (see
  `engines` in `package.json`). On Node 20 the test runner cannot start.

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
paths relative to themselves, so the repository can live anywhere. They run the built app, so run
`npm run build` before the first launch.

### Updating

Quit Acuity first. Closing the window quits it, but if it was hidden with the tray icon it is
still running: right-click the tray icon and choose **Quit Acuity**. Then, in the checkout:

```bash
git pull
npm install       # picks up new or changed dependencies
npm run build
```

Launch it again with `run.vbs`, `AcuityReader.cmd` or `npm start`. If you installed it with the
setup program instead, run `npm run dist` after `npm install` and run the new installer from
`dist-packages/`; it installs over the old version.

Your library, reading progress, bookmarks and collections live in `%APPDATA%\Acuity Reader`, not
in the checkout or the install folder, so updating never touches them.

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
