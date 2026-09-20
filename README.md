# Acuity Reader

A minimalist, distraction-free desktop e-book and audiobook player for Windows (with macOS and mobile portability in mind). 

Acuity brings text reading and spoken audio together under one roof, recognizing that knowledge and insight can be absorbed through multiple sensory modalities.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Mobile-lightgrey.svg)
![Architecture](https://img.shields.io/badge/engine-Tauri%20v2%20%2B%20React%20%2B%20Rust-orange.svg)

---

## Features

- **Unified Media Support:** Natively handles `.m4b`, `.mp3`, `.m4a` (audiobooks) alongside `.epub` and `.pdf` (e-books & documents).
- **Automated Library Scanning:** Point Acuity to any folder on your machine. The scanner automatically indexes, categorizes, and extracts covers/metadata without requiring rigid folder structures.
- **Companion Pairing:** Automatically links companion audiobooks and text editions of the same title, allowing seamless switching between reading and listening.
- **Persistent Progress & Bookmarks:** Independent, synchronized progress and bookmarking for all formats.
- **Minimalist, Content-First UI:** Zero clutter, no banners, and no redundant controls. Fast filtering (`All`, `Books`, `Audio`) and instant search.
- **Audiobook Controls:** Chapter navigation (M4B chapters & ID3 chapter frames), variable playback speed (`0.75x` – `3.0x`), skip buttons, and auto-save.
- **Zen Reading View:** Clean typography, reflowable EPUB reading, PDF vector zoom/scrolling, customizable dark/sepia/light modes.
- **Read-Aloud Narration:** Built-in Text-to-Speech (TTS) integration with synchronized sentence-level highlighting.

---

## Tech Stack

- **Shell:** [Tauri v2](https://v2.tauri.app/) (Rust + Windows WebView2)
- **Frontend:** React, TypeScript, Tailwind CSS
- **EPUB Engine:** [foliate-js](https://github.com/johnfactotum/foliate-js)
- **PDF Engine:** [pdf.js](https://mozilla.github.io/pdf.js/)
- **Audio & Tag Parsing:** Web Audio API & `music-metadata` / `lofty`
- **Database:** Local SQLite database for library indexing, progress, and bookmarks

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+ recommended)
- [Rust](https://www.rust-lang.org/tools/install) (`rustup` with MSVC toolchain on Windows)

### Installation

```bash
# Clone the repository
git clone https://github.com/ReallyCool10/acuity-reader.git
cd acuity-reader

# Install dependencies
npm install

# Run the desktop app in development mode
npm run tauri dev
```

---

## License

This project is licensed under the [MIT License](LICENSE).
