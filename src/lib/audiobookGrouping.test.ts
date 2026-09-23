import { describe, expect, it } from 'vitest';
import type { MediaItem, ProgressItem } from '../types';
import {
  getDirectory,
  getFilename,
  getGlobalTime,
  getTrackForTime,
  groupMultiFileAudiobooks,
  hashString,
  resolveAudiobookProgress,
} from './audiobookGrouping';

describe('audiobookGrouping', () => {
  it('extracts filename and directory correctly across slash types', () => {
    expect(getFilename('C:/Books/Dune/01 - Chapter.mp3')).toBe('01 - Chapter.mp3');
    expect(getFilename('C:\\Books\\Dune\\01 - Chapter.mp3')).toBe('01 - Chapter.mp3');
    expect(getDirectory('C:/Books/Dune/01 - Chapter.mp3')).toBe('C:/Books/Dune');
    expect(getDirectory('C:\\Books\\Dune\\01 - Chapter.mp3')).toBe('C:\\Books\\Dune');
  });

  it('generates consistent deterministic hash string', () => {
    const h1 = hashString('audiobook:dune|frank herbert');
    const h2 = hashString('audiobook:dune|frank herbert');
    const h3 = hashString('audiobook:dune|brian herbert');
    expect(h1).toHaveLength(16);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });

  it('groups multi-track audio files by album tag and calculates cumulative duration', () => {
    const track1: MediaItem = {
      id: 'trk-1',
      title: 'Track 1',
      author: 'Frank Herbert',
      filePath: 'C:/Audio/Dune/01.mp3',
      mediaType: 'audio',
      format: 'mp3',
      fileSize: 1000,
      dateAdded: 100,
      dirName: 'Dune',
      album: 'Dune',
      trackNumber: 1,
      durationSeconds: 600, // 10 min
    };

    const track2: MediaItem = {
      id: 'trk-2',
      title: 'Track 2',
      author: 'Frank Herbert',
      filePath: 'C:/Audio/Dune/02.mp3',
      mediaType: 'audio',
      format: 'mp3',
      fileSize: 2000,
      dateAdded: 200,
      dirName: 'Dune',
      album: 'Dune',
      trackNumber: 2,
      durationSeconds: 900, // 15 min
    };

    const singleBook: MediaItem = {
      id: 'standalone-pdf',
      title: 'Manual.pdf',
      author: 'System',
      filePath: 'C:/Docs/Manual.pdf',
      mediaType: 'book',
      format: 'pdf',
      fileSize: 500,
      dateAdded: 50,
      dirName: 'Docs',
    };

    const grouped = groupMultiFileAudiobooks([track1, track2, singleBook]);

    // Should result in 2 items: 1 composite audiobook + 1 PDF
    expect(grouped).toHaveLength(2);

    const audioBook = grouped.find((i) => i.mediaType === 'audio')!;
    expect(audioBook).toBeDefined();
    expect(audioBook.title).toBe('Dune');
    expect(audioBook.author).toBe('Frank Herbert');
    expect(audioBook.durationSeconds).toBe(1500); // 600 + 900
    expect(audioBook.fileSize).toBe(3000);
    expect(audioBook.tracks).toHaveLength(2);

    // Track 1 offsets
    expect(audioBook.tracks![0].offsetSeconds).toBe(0);
    expect(audioBook.tracks![0].durationSeconds).toBe(600);

    // Track 2 offsets
    expect(audioBook.tracks![1].offsetSeconds).toBe(600);
    expect(audioBook.tracks![1].durationSeconds).toBe(900);

    // Chapters synthesized for each track
    expect(audioBook.chapters).toHaveLength(2);
    expect(audioBook.chapters![0].startTime).toBe(0);
    expect(audioBook.chapters![0].endTime).toBe(600);
    expect(audioBook.chapters![1].startTime).toBe(600);
    expect(audioBook.chapters![1].endTime).toBe(1500);
  });

  it('groups numbered track files in dedicated folder without album tag', () => {
    const track1: MediaItem = {
      id: 't-1',
      title: '01 - Prologue',
      author: 'J.R.R. Tolkien',
      filePath: 'C:/Books/The Hobbit/01 - Prologue.m4a',
      mediaType: 'audio',
      format: 'm4a',
      fileSize: 1000,
      dateAdded: 100,
      dirName: 'The Hobbit',
      durationSeconds: 300,
    };

    const track2: MediaItem = {
      id: 't-2',
      title: '02 - An Unexpected Party',
      author: 'J.R.R. Tolkien',
      filePath: 'C:/Books/The Hobbit/02 - An Unexpected Party.m4a',
      mediaType: 'audio',
      format: 'm4a',
      fileSize: 1500,
      dateAdded: 110,
      dirName: 'The Hobbit',
      durationSeconds: 400,
    };

    const grouped = groupMultiFileAudiobooks([track1, track2]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].tracks).toHaveLength(2);
    expect(grouped[0].durationSeconds).toBe(700);
    expect(grouped[0].title).toBe('The Hobbit');
  });

  it('preserves embedded track chapters and shifts start/end times by track offset', () => {
    const track1: MediaItem = {
      id: 't-1',
      title: 'Part 1',
      author: 'Author',
      filePath: 'C:/Audio/Book/Part1.mp3',
      mediaType: 'audio',
      format: 'mp3',
      fileSize: 1000,
      dateAdded: 100,
      dirName: 'Book',
      album: 'Big Book',
      durationSeconds: 500,
      chapters: [
        { id: 'c1', title: 'Chapter 1', startTime: 0, endTime: 250 },
        { id: 'c2', title: 'Chapter 2', startTime: 250, endTime: 500 },
      ],
    };

    const track2: MediaItem = {
      id: 't-2',
      title: 'Part 2',
      author: 'Author',
      filePath: 'C:/Audio/Book/Part2.mp3',
      mediaType: 'audio',
      format: 'mp3',
      fileSize: 1000,
      dateAdded: 100,
      dirName: 'Book',
      album: 'Big Book',
      durationSeconds: 500,
      chapters: [{ id: 'c3', title: 'Chapter 3', startTime: 0, endTime: 500 }],
    };

    const grouped = groupMultiFileAudiobooks([track1, track2]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].chapters).toHaveLength(3);

    // Chapter 1
    expect(grouped[0].chapters![0].startTime).toBe(0);
    expect(grouped[0].chapters![0].endTime).toBe(250);

    // Chapter 2
    expect(grouped[0].chapters![1].startTime).toBe(250);
    expect(grouped[0].chapters![1].endTime).toBe(500);

    // Chapter 3 shifted by 500s offset of track 2
    expect(grouped[0].chapters![2].startTime).toBe(500);
    expect(grouped[0].chapters![2].endTime).toBe(1000);
  });

  it('does NOT group disparate standalone audio files in a common downloads directory', () => {
    const book1: MediaItem = {
      id: 'dune-standalone',
      title: 'Dune',
      author: 'Frank Herbert',
      filePath: 'C:/Downloads/Dune.m4b',
      mediaType: 'audio',
      format: 'm4b',
      fileSize: 50000,
      dateAdded: 100,
      dirName: 'Downloads',
    };

    const book2: MediaItem = {
      id: 'hobbit-standalone',
      title: 'The Hobbit',
      author: 'J.R.R. Tolkien',
      filePath: 'C:/Downloads/The Hobbit.m4b',
      mediaType: 'audio',
      format: 'm4b',
      fileSize: 40000,
      dateAdded: 110,
      dirName: 'Downloads',
    };

    const grouped = groupMultiFileAudiobooks([book1, book2]);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].id).toBe('dune-standalone');
    expect(grouped[1].id).toBe('hobbit-standalone');
  });

  it('maps global time to track index and local track time with getTrackForTime', () => {
    const tracks = [
      {
        id: '1',
        title: 'Track 1',
        filePath: '/1.mp3',
        durationSeconds: 100,
        offsetSeconds: 0,
      },
      {
        id: '2',
        title: 'Track 2',
        filePath: '/2.mp3',
        durationSeconds: 200,
        offsetSeconds: 100,
      },
      {
        id: '3',
        title: 'Track 3',
        filePath: '/3.mp3',
        durationSeconds: 150,
        offsetSeconds: 300,
      },
    ];

    // Timestamp 50s -> Track 1 at 50s
    const res1 = getTrackForTime(tracks, 50);
    expect(res1.trackIndex).toBe(0);
    expect(res1.localTime).toBe(50);

    // Timestamp 100s -> Track 2 at 0s
    const res2 = getTrackForTime(tracks, 100);
    expect(res2.trackIndex).toBe(1);
    expect(res2.localTime).toBe(0);

    // Timestamp 250s -> Track 2 at 150s
    const res3 = getTrackForTime(tracks, 250);
    expect(res3.trackIndex).toBe(1);
    expect(res3.localTime).toBe(150);

    // Timestamp 350s -> Track 3 at 50s
    const res4 = getTrackForTime(tracks, 350);
    expect(res4.trackIndex).toBe(2);
    expect(res4.localTime).toBe(50);

    // Timestamp beyond duration -> clamped to last track end
    const res5 = getTrackForTime(tracks, 500);
    expect(res5.trackIndex).toBe(2);
    expect(res5.localTime).toBe(150);

    // Global time calculation test
    expect(getGlobalTime(tracks, 1, 150)).toBe(250);
    expect(getGlobalTime(tracks, 2, 50)).toBe(350);
  });

  it('resolves legacy or constituent track progress seamlessly to global progress', () => {
    const compositeBook: MediaItem = {
      id: 'composite-book-id',
      title: 'Epic Novel',
      author: 'Author',
      filePath: 'C:/Audio/Epic/01.mp3',
      mediaType: 'audio',
      format: 'mp3',
      fileSize: 10000,
      dateAdded: 100,
      dirName: 'Epic',
      durationSeconds: 3000,
      tracks: [
        {
          id: 'track-1-id',
          title: 'Part 1',
          filePath: 'C:/Audio/Epic/01.mp3',
          durationSeconds: 1000,
          offsetSeconds: 0,
        },
        {
          id: 'track-2-id',
          title: 'Part 2',
          filePath: 'C:/Audio/Epic/02.mp3',
          durationSeconds: 1000,
          offsetSeconds: 1000,
        },
        {
          id: 'track-3-id',
          title: 'Part 3',
          filePath: 'C:/Audio/Epic/03.mp3',
          durationSeconds: 1000,
          offsetSeconds: 2000,
        },
      ],
    };

    // Case 1: Progress already saved against composite ID
    const progressMap1: Record<string, ProgressItem> = {
      'composite-book-id': {
        id: 'composite-book-id',
        currentTime: 1500,
        duration: 3000,
        percent: 0.5,
        lastPlayed: 500,
      },
    };
    const resolved1 = resolveAudiobookProgress(compositeBook, progressMap1);
    expect(resolved1?.currentTime).toBe(1500);

    // Case 2: Progress only exists for constituent track 2 at 250s
    const progressMap2: Record<string, ProgressItem> = {
      'track-2-id': {
        id: 'track-2-id',
        currentTime: 250,
        duration: 1000,
        percent: 0.25,
        lastPlayed: 600,
      },
    };
    const resolved2 = resolveAudiobookProgress(compositeBook, progressMap2);
    expect(resolved2).toBeDefined();
    // Global time: Track 2 offset (1000s) + local time (250s) = 1250s
    expect(resolved2?.currentTime).toBe(1250);
    expect(resolved2?.duration).toBe(3000);
    expect(resolved2?.percent).toBeCloseTo(1250 / 3000);
    expect(resolved2?.lastPlayed).toBe(600);
  });
});
