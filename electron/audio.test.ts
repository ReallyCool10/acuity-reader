import { describe, it, expect } from 'vitest';
import { findSiblingTracks, parseAudioChapters, parseChplBuffer } from './audio';
import type { MediaItem } from '../src/types';

describe('electron/audio', () => {
  describe('findSiblingTracks', () => {
    const makeItem = (
      id: string,
      title: string,
      filePath: string,
      dirName: string,
      trackNumber?: number,
      discNumber?: number,
      album?: string
    ): MediaItem => ({
      id,
      title,
      author: 'Brandon Sanderson',
      filePath,
      mediaType: 'audio',
      format: 'mp3',
      fileSize: 1000,
      dateAdded: 100,
      dirName,
      trackNumber,
      discNumber,
      album,
    });

    it('identifies next and previous tracks in the same directory using track number', () => {
      const t1 = makeItem('1', 'Chapter 1', 'C:/Audio/Dune/01.mp3', 'Dune', 1);
      const t2 = makeItem('2', 'Chapter 2', 'C:/Audio/Dune/02.mp3', 'Dune', 2);
      const t3 = makeItem('3', 'Chapter 3', 'C:/Audio/Dune/03.mp3', 'Dune', 3);
      const all = [t3, t1, t2];

      const res1 = findSiblingTracks(t1, all);
      expect(res1.prevItem).toBeNull();
      expect(res1.nextItem?.id).toBe('2');

      const res2 = findSiblingTracks(t2, all);
      expect(res2.prevItem?.id).toBe('1');
      expect(res2.nextItem?.id).toBe('3');

      const res3 = findSiblingTracks(t3, all);
      expect(res3.prevItem?.id).toBe('2');
      expect(res3.nextItem).toBeNull();
    });

    it('sorts multi-disc audiobooks by discNumber then trackNumber', () => {
      const d1t1 = makeItem('d1t1', 'Track 1', 'C:/Audio/Book/d1_01.mp3', 'Book', 1, 1);
      const d1t2 = makeItem('d1t2', 'Track 2', 'C:/Audio/Book/d1_02.mp3', 'Book', 2, 1);
      const d2t1 = makeItem('d2t1', 'Track 1', 'C:/Audio/Book/d2_01.mp3', 'Book', 1, 2);

      const res = findSiblingTracks(d1t2, [d2t1, d1t1, d1t2]);
      expect(res.prevItem?.id).toBe('d1t1');
      expect(res.nextItem?.id).toBe('d2t1');
    });

    it('uses natural filename sort when track numbers are absent', () => {
      const p1 = makeItem('p1', 'Part 1', 'C:/Audio/Book/Part 1.m4a', 'Book');
      const p2 = makeItem('p2', 'Part 2', 'C:/Audio/Book/Part 2.m4a', 'Book');
      const p10 = makeItem('p10', 'Part 10', 'C:/Audio/Book/Part 10.m4a', 'Book');

      const res = findSiblingTracks(p2, [p10, p1, p2]);
      expect(res.prevItem?.id).toBe('p1');
      expect(res.nextItem?.id).toBe('p10');
    });

    it('ignores non-audio items or items in other folders', () => {
      const t1 = makeItem('1', 'Chapter 1', 'C:/Audio/Dune/01.mp3', 'Dune', 1);
      const otherBook: MediaItem = {
        ...t1,
        id: 'ebook',
        filePath: 'C:/Audio/Dune/Dune.epub',
        mediaType: 'book',
      };
      const unrelated = makeItem('other', 'Other', 'C:/Audio/Hobbit/01.mp3', 'Hobbit', 1);

      const res = findSiblingTracks(t1, [t1, otherBook, unrelated]);
      expect(res.prevItem).toBeNull();
      expect(res.nextItem).toBeNull();
      expect(res.playlist).toHaveLength(1);
    });
  });

  describe('parseAudioChapters', () => {
    it('maps raw format.chapters with timeScale to seconds', () => {
      const raw = [
        { title: 'Intro', start: 0, timeScale: 1000 },
        { title: 'Chapter 1', start: 150000, timeScale: 1000 },
        { title: 'Chapter 2', start: 420000, timeScale: 1000 },
      ];

      const chapters = parseAudioChapters(raw, 44100, 600);
      expect(chapters).toHaveLength(3);
      expect(chapters[0].title).toBe('Intro');
      expect(chapters[0].startTime).toBe(0);
      expect(chapters[0].endTime).toBe(150);

      expect(chapters[1].title).toBe('Chapter 1');
      expect(chapters[1].startTime).toBe(150);
      expect(chapters[1].endTime).toBe(420);

      expect(chapters[2].title).toBe('Chapter 2');
      expect(chapters[2].startTime).toBe(420);
      expect(chapters[2].endTime).toBe(600);
    });

    it('handles empty or undefined chapters safely', () => {
      expect(parseAudioChapters(undefined)).toEqual([]);
      expect(parseAudioChapters([])).toEqual([]);
    });
  });

  describe('parseChplBuffer', () => {
    it('extracts chapters correctly from a synthesized Nero chpl atom buffer', () => {
      // Build a minimal synthetic chpl atom buffer
      // 4 bytes: tag 'chpl'
      // 1 byte: version 1
      // 3 bytes: flags
      // 1 byte: reserved
      // 4 bytes: chapter count (2)
      // Chapter 1: 8 bytes timestamp (0), 1 byte len (7), 'Intro\0\0'
      // Chapter 2: 8 bytes timestamp (30 * 10,000,000 = 300,000,000), 1 byte len (9), 'Chapter 1'
      const buf = Buffer.alloc(128);
      let offset = 0;

      buf.write('chpl', offset, 'ascii');
      offset += 4;
      buf.writeUInt8(1, offset); // version 1
      offset += 4; // version + 3 flags
      buf.writeUInt8(0, offset); // reserved
      offset += 1;
      buf.writeUInt32BE(2, offset); // count = 2
      offset += 4;

      // Chap 1: offset 0
      buf.writeBigUInt64BE(0n, offset);
      offset += 8;
      buf.writeUInt8(5, offset);
      offset += 1;
      buf.write('Intro', offset, 'utf8');
      offset += 5;

      // Chap 2: offset 30 seconds = 300,000,000 units
      buf.writeBigUInt64BE(300_000_000n, offset);
      offset += 8;
      buf.writeUInt8(9, offset);
      offset += 1;
      buf.write('Chapter 1', offset, 'utf8');

      const chapters = parseChplBuffer(buf);
      expect(chapters).toHaveLength(2);
      expect(chapters[0].title).toBe('Intro');
      expect(chapters[0].startTime).toBe(0);
      expect(chapters[0].endTime).toBe(30);

      expect(chapters[1].title).toBe('Chapter 1');
      expect(chapters[1].startTime).toBe(30);
    });

    it('returns empty array when buffer does not contain chpl tag', () => {
      const dummy = Buffer.from('some random mp4 file without chapters');
      expect(parseChplBuffer(dummy)).toEqual([]);
    });
  });
});
