import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  listBooks,
  getBook,
  getReadingProgress,
  updateReadingProgress,
  listBookmarks,
  addBookmark,
  deleteBookmark,
  getLibraryStats,
} from './storage';
import {
  getEpubChapterList,
  readEpubChapterText,
  searchEpubBook,
  getPdfInfo,
  readPdfPageText,
  searchPdfBook,
} from './content';

/**
 * Factory function creating a fully configured Acuity MCP Server instance.
 */
export function createAcuityMcpServer(customStoragePath?: string): McpServer {
  const server = new McpServer({
    name: 'acuity-mcp-server',
    version: '1.0.0',
  });

  /* ------------------------------------------------------------- RESOURCES */

  // Resource 1: acuity://library - All library items
  server.resource(
    'library',
    'acuity://library',
    async (uri) => {
      const stats = await getLibraryStats(customStoragePath);
      const { books } = await listBooks({ limit: 500 }, customStoragePath);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                stats,
                totalItems: books.length,
                books,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // Resource 2: acuity://progress - Reading & playback progress
  server.resource(
    'progress',
    'acuity://progress',
    async (uri) => {
      const progress = await getReadingProgress(undefined, customStoragePath);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                activeCount: progress.length,
                progress,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // Resource 3: acuity://bookmarks - All saved bookmarks, excerpts, and notes
  server.resource(
    'bookmarks',
    'acuity://bookmarks',
    async (uri) => {
      const bookmarks = await listBookmarks(undefined, customStoragePath);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                totalBookmarks: bookmarks.length,
                bookmarks,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // Resource 4: acuity://stats - Summary statistics
  server.resource(
    'stats',
    'acuity://stats',
    async (uri) => {
      const stats = await getLibraryStats(customStoragePath);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(stats, null, 2),
          },
        ],
      };
    }
  );

  /* ----------------------------------------------------------------- TOOLS */

  // Tool 1: list_books
  server.tool(
    'list_books',
    'List, search, and filter books and audiobooks in the user’s Acuity library.',
    {
      query: z.string().optional().describe('Keyword searching title, author, directory, or filename'),
      mediaType: z.enum(['all', 'book', 'audio']).optional().default('all').describe('Filter by media type ("book", "audio", or "all")'),
      format: z.string().optional().describe('Filter by format (e.g. "epub", "pdf", "m4b", "mp3")'),
      inProgressOnly: z.boolean().optional().default(false).describe('Only return books currently being read or listened to'),
      limit: z.number().int().min(1).max(200).optional().default(50).describe('Max items to return (default: 50)'),
    },
    async ({ query, mediaType, format, inProgressOnly, limit }) => {
      try {
        const result = await listBooks({ query, mediaType, format, inProgressOnly, limit }, customStoragePath);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to list books: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // Tool 2: get_book
  server.tool(
    'get_book',
    'Get full details, reading progress, and bookmarks for a specific book or audiobook by ID or title.',
    {
      book: z.string().describe('Book ID (e.g. "097a880d8e4eddf6") or full/partial title'),
    },
    async ({ book }) => {
      try {
        const details = await getBook(book, customStoragePath);
        if (!details) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Book not found matching "${book}". Try using list_books to search by title or author.` }],
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(details, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to get book: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // Tool 3: get_reading_progress
  server.tool(
    'get_reading_progress',
    'Get reading or listening progress for a specific book, or across the whole library sorted by most recently read.',
    {
      bookId: z.string().optional().describe('Optional book ID to get progress for, or leave blank to get all active progress'),
    },
    async ({ bookId }) => {
      try {
        const progress = await getReadingProgress(bookId, customStoragePath);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(progress, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to get progress: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // Tool 4: update_reading_progress
  server.tool(
    'update_reading_progress',
    'Update reading or audio progress for a book in Acuity Reader.',
    {
      bookId: z.string().describe('ID of the book to update'),
      percent: z.number().min(0).max(100).describe('Completion percentage from 0 to 100'),
      chapterIndex: z.number().int().min(0).optional().describe('0-based chapter index or page number'),
      currentTime: z.number().min(0).optional().describe('Playback position in seconds (for audiobooks)'),
    },
    async ({ bookId, percent, chapterIndex, currentTime }) => {
      try {
        const updated = await updateReadingProgress(bookId, { percent, chapterIndex, currentTime }, customStoragePath);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: true, updatedProgress: updated }, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to update progress: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // Tool 5: list_bookmarks
  server.tool(
    'list_bookmarks',
    'List bookmarks, excerpts, and notes for a specific book, or across the entire library.',
    {
      bookId: z.string().optional().describe('Optional book ID to filter bookmarks by'),
    },
    async ({ bookId }) => {
      try {
        const bookmarks = await listBookmarks(bookId, customStoragePath);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(bookmarks, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to list bookmarks: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // Tool 6: add_bookmark
  server.tool(
    'add_bookmark',
    'Add a new bookmark, note, or excerpt to a book in Acuity Reader.',
    {
      bookId: z.string().describe('ID of the book to add bookmark to'),
      position: z.number().int().min(0).describe('0-based chapter index (EPUB) or page number (PDF) or audio timestamp in seconds'),
      label: z.string().optional().describe('Label or title for this bookmark (e.g. "Chapter 3 Summary" or "Important Quote")'),
      excerpt: z.string().optional().describe('Quoted text or passage from the book'),
      note: z.string().optional().describe('Personal note, analysis, or comment'),
    },
    async ({ bookId, position, label, excerpt, note }) => {
      try {
        const bookmark = await addBookmark(bookId, { position, label, excerpt, note }, customStoragePath);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: true, createdBookmark: bookmark }, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to add bookmark: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // Tool 7: delete_bookmark
  server.tool(
    'delete_bookmark',
    'Delete a bookmark from a book in Acuity Reader.',
    {
      bookId: z.string().describe('ID of the book'),
      bookmarkId: z.string().describe('ID of the bookmark to remove'),
    },
    async ({ bookId, bookmarkId }) => {
      try {
        const deleted = await deleteBookmark(bookId, bookmarkId, customStoragePath);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: deleted }, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to delete bookmark: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // Tool 8: get_table_of_contents
  server.tool(
    'get_table_of_contents',
    'Inspect the table of contents / chapter list of an EPUB or PDF book.',
    {
      book: z.string().describe('Book ID or title'),
    },
    async ({ book }) => {
      try {
        const itemWithContext = await getBook(book, customStoragePath);
        if (!itemWithContext) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Book not found matching "${book}".` }],
          };
        }

        const { book: item } = itemWithContext;
        const fmt = item.format.toLowerCase();

        if (fmt === 'epub') {
          const toc = await getEpubChapterList(item.filePath);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(toc, null, 2),
              },
            ],
          };
        } else if (fmt === 'pdf') {
          const info = await getPdfInfo(item.filePath);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(info, null, 2),
              },
            ],
          };
        } else {
          return {
            isError: true,
            content: [{ type: 'text', text: `Format "${fmt}" is an audio file or does not support table of contents extraction.` }],
          };
        }
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to read table of contents: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // Tool 9: read_book_content
  server.tool(
    'read_book_content',
    'Read plain-text chapter content (EPUB) or page content (PDF) from a book in the library.',
    {
      book: z.string().describe('Book ID or title'),
      chapterIndex: z.number().int().min(0).optional().describe('0-based chapter index for EPUB books (defaults to current reading progress or chapter 0)'),
      pageNumber: z.number().int().min(1).optional().describe('1-based page number for PDF books (defaults to 1)'),
      maxCharacters: z.number().int().min(500).max(50000).optional().default(8000).describe('Max character count to return (default: 8000)'),
    },
    async ({ book, chapterIndex, pageNumber, maxCharacters }) => {
      try {
        const itemWithContext = await getBook(book, customStoragePath);
        if (!itemWithContext) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Book not found matching "${book}".` }],
          };
        }

        const { book: item, progress } = itemWithContext;
        const fmt = item.format.toLowerCase();

        if (fmt === 'epub') {
          const targetIndex = chapterIndex !== undefined ? chapterIndex : progress?.chapterIndex ?? 0;
          const chapterData = await readEpubChapterText(item.filePath, targetIndex, maxCharacters);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(chapterData, null, 2),
              },
            ],
          };
        } else if (fmt === 'pdf') {
          const targetPage = pageNumber !== undefined ? pageNumber : (progress?.chapterIndex ?? 0) + 1;
          const pageData = await readPdfPageText(item.filePath, targetPage, maxCharacters);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(pageData, null, 2),
              },
            ],
          };
        } else {
          return {
            isError: true,
            content: [{ type: 'text', text: `Format "${fmt}" does not support reading text content.` }],
          };
        }
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to read book content: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // Tool 10: search_book_content
  server.tool(
    'search_book_content',
    'Perform full-text search across all chapters of an EPUB or pages of a PDF book and return matched snippets.',
    {
      book: z.string().describe('Book ID or title'),
      query: z.string().min(1).describe('The search query or phrase to find in the book'),
      maxMatches: z.number().int().min(1).max(50).optional().default(20).describe('Max matches to return (default: 20)'),
    },
    async ({ book, query, maxMatches }) => {
      try {
        const itemWithContext = await getBook(book, customStoragePath);
        if (!itemWithContext) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Book not found matching "${book}".` }],
          };
        }

        const { book: item } = itemWithContext;
        const fmt = item.format.toLowerCase();

        if (fmt === 'epub') {
          const results = await searchEpubBook(item.filePath, query, maxMatches);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(results, null, 2),
              },
            ],
          };
        } else if (fmt === 'pdf') {
          const results = await searchPdfBook(item.filePath, query, maxMatches);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(results, null, 2),
              },
            ],
          };
        } else {
          return {
            isError: true,
            content: [{ type: 'text', text: `Full-text search is not supported on format "${fmt}".` }],
          };
        }
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Search failed: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  return server;
}
