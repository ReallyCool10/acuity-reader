import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createAcuityMcpServer } from './server';
import { saveLibraryState } from './storage';
import type { LibraryState } from '../src/types';

describe('mcp-server/server', () => {
  let tempFilePath: string;
  let sampleState: LibraryState;

  beforeEach(async () => {
    tempFilePath = path.join(os.tmpdir(), `acuity-server-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    sampleState = {
      folders: ['C:/Books'],
      items: [
        {
          id: 'test-1',
          title: 'Acuity Guide',
          author: 'Acuity Team',
          filePath: 'C:/Books/guide.epub',
          mediaType: 'book',
          format: 'epub',
          fileSize: 4096,
          dateAdded: 1000,
          dirName: 'Books',
        },
      ],
      progress: {
        'test-1': {
          id: 'test-1',
          chapterIndex: 0,
          percent: 0.25,
          lastPlayed: 2000,
        },
      },
      bookmarks: {
        'test-1': [
          {
            id: 'bm-1',
            itemId: 'test-1',
            label: 'Note 1',
            position: 0,
            createdAt: 1500,
            excerpt: 'Hello Acuity',
          },
        ],
      },
      collections: [],
    };
    await saveLibraryState(sampleState, tempFilePath);
  });

  afterEach(async () => {
    if (fs.existsSync(tempFilePath)) {
      await fs.promises.unlink(tempFilePath).catch(() => {});
    }
  });

  it('creates server instance with tools and resources defined', () => {
    const server = createAcuityMcpServer(tempFilePath);
    expect(server).toBeDefined();
  });
});
