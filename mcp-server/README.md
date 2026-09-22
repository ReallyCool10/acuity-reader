# Acuity MCP Server

A Model Context Protocol (MCP) server that connects your AI tools (Claude Desktop, Antigravity, Cursor, etc.) directly to your **Acuity Reader** library, reading progress, bookmarks, notes, and book contents.

---

## Capabilities

### Resources

- `acuity://library` - Full index of all books and audiobooks in the library.
- `acuity://progress` - Current reading and listening progress, ordered by most recently accessed.
- `acuity://bookmarks` - All user bookmarks, quotes, notes, and excerpts.
- `acuity://stats` - High-level metrics: total items, formats count (EPUB/PDF/audio), active reading count, and indexed folders.

### Tools

1. **`list_books`**: Search and filter books by title, author, folder, media type (`book` or `audio`), format (`epub`, `pdf`, etc.), or reading status (`inProgressOnly`).
2. **`get_book`**: Look up a book's full metadata, reading progress, and saved bookmarks using its ID or title.
3. **`get_reading_progress`**: Retrieve progress for a single book or the whole library sorted by most recently read.
4. **`get_currently_reading`**: Fast helper to get only active in-progress books and audiobooks, with latest notes, companion links, and formatted timestamps.
5. **`update_reading_progress`**: Update chapter index, completion percent (0-100%), or audio timestamp.
6. **`list_bookmarks`**: Retrieve bookmarks and excerpts, filtered by book or across the entire collection.
7. **`add_bookmark`**: Save a new bookmark, note, quote, or excerpt to a book at a specific location.
8. **`update_bookmark`**: Edit the label, note, or quote of an existing bookmark.
9. **`delete_bookmark`**: Delete a bookmark by ID.
10. **`get_table_of_contents`**: Inspect chapter outlines of EPUB or PDF books with titles and chapter numbers.
11. **`read_book_content`**: Read the clean plain-text content of an EPUB chapter or PDF page. Supports reading single chapters/pages or a continuous range (`endChapterIndex` / `endPageNumber`).
12. **`search_book_content`**: Perform in-book full-text search across EPUB chapters or PDF pages and receive matched snippets with surrounding context.
13. **`get_library_stats`**: Get overall library metrics (book/audio counts, format breakdown, in-progress count, bookmarks total).
14. **`export_reading_summary`**: Generate a ready-to-share Markdown digest with ASCII progress bars, active reads, recent bookmarks, and quotes.

---

## Configuration

### Claude Desktop (`%APPDATA%\Claude\claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "acuity-reader": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": [
        "C:/Users/MarkNewman/acuity-reader/dist-mcp/index.js"
      ]
    }
  }
}
```

### Antigravity (`~/.gemini/config/mcp_config.json`)

```json
{
  "mcpServers": {
    "acuity-reader": {
      "command": "node",
      "args": [
        "C:\\Users\\MarkNewman\\acuity-reader\\dist-mcp\\index.js"
      ]
    }
  }
}
```

---

## Building and Testing

```bash
# Run unit tests
npm test

# Build MCP server bundle
npm run build:mcp

# Launch MCP server manually
npm run mcp
```
