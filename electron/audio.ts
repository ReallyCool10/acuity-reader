import fs from 'node:fs';
import type { AudioChapter } from '../src/types';
export { findSiblingTracks, getFilename } from '../src/lib/playlist';

/**
 * Normalizes chapters parsed from music-metadata format.chapters.
 */
export function parseAudioChapters(
  rawChapters?: Array<{
    title?: string;
    start?: number;
    offset?: number;
    timeScale?: number;
  }>,
  sampleRate?: number,
  duration?: number
): AudioChapter[] {
  if (!rawChapters || rawChapters.length === 0) return [];

  const chapters: AudioChapter[] = [];

  for (let i = 0; i < rawChapters.length; i++) {
    const raw = rawChapters[i];
    let startTime = 0;

    if (typeof raw.start === 'number' && typeof raw.timeScale === 'number' && raw.timeScale > 0) {
      startTime = raw.start / raw.timeScale;
    } else if (typeof raw.offset === 'number') {
      if (sampleRate && raw.offset > sampleRate) {
        startTime = raw.offset / sampleRate;
      } else if (raw.offset > 1000 && duration && raw.offset / 1000 <= duration + 5) {
        startTime = raw.offset / 1000;
      } else {
        startTime = raw.offset;
      }
    }

    const title = raw.title?.trim() || `Chapter ${i + 1}`;
    chapters.push({
      id: `chap-${i + 1}-${Math.round(startTime)}`,
      title,
      startTime: Math.max(0, Math.round(startTime * 100) / 100),
    });
  }

  chapters.sort((a, b) => a.startTime - b.startTime);

  // Calculate chapter durations and end times.
  for (let i = 0; i < chapters.length; i++) {
    const nextStart = chapters[i + 1]?.startTime;
    if (typeof nextStart === 'number') {
      chapters[i].endTime = nextStart;
    } else if (typeof duration === 'number' && duration > chapters[i].startTime) {
      chapters[i].endTime = duration;
    }
  }

  return chapters;
}

/**
 * Parses QuickTime/Nero 'chpl' (Chapter List) atom from an MP4/M4B atom payload buffer.
 */
export function parseChplBuffer(buffer: Buffer): AudioChapter[] {
  const chplIndex = buffer.indexOf(Buffer.from('chpl'));
  if (chplIndex === -1 || chplIndex + 8 > buffer.length) return [];

  let offset = chplIndex + 4; // Skip 'chpl' fourcc
  const version = buffer.readUInt8(offset);
  offset += 4; // Skip version (1 byte) + flags (3 bytes)

  let chapterCount: number;
  if (version === 1) {
    offset += 1; // 1 byte reserved
    if (offset + 4 > buffer.length) return [];
    chapterCount = buffer.readUInt32BE(offset);
    offset += 4;
  } else {
    if (offset + 1 > buffer.length) return [];
    chapterCount = buffer.readUInt8(offset);
    offset += 1;
  }

  if (chapterCount <= 0 || chapterCount > 1000) return [];

  const chapters: AudioChapter[] = [];

  for (let i = 0; i < chapterCount; i++) {
    if (offset + 9 > buffer.length) break;

    // 64-bit integer timestamp in 10,000,000 units per second (100-nanosecond intervals)
    const timestampBig = buffer.readBigUInt64BE(offset);
    offset += 8;

    const titleLen = buffer.readUInt8(offset);
    offset += 1;

    if (offset + titleLen > buffer.length) break;
    const title = buffer.toString('utf8', offset, offset + titleLen).trim();
    offset += titleLen;

    const startTime = Number(timestampBig) / 10_000_000;

    chapters.push({
      id: `chpl-${i + 1}-${Math.round(startTime)}`,
      title: title || `Chapter ${i + 1}`,
      startTime: Math.max(0, Math.round(startTime * 100) / 100),
    });
  }

  chapters.sort((a, b) => a.startTime - b.startTime);

  for (let i = 0; i < chapters.length; i++) {
    const nextStart = chapters[i + 1]?.startTime;
    if (typeof nextStart === 'number') {
      chapters[i].endTime = nextStart;
    }
  }

  return chapters;
}

/**
 * Scans an M4B/MP4 file for a 'chpl' atom if present.
 */
export async function extractChplFromFile(filePath: string): Promise<AudioChapter[]> {
  try {
    const fd = await fs.promises.open(filePath, 'r');
    try {
      const stats = await fd.stat();
      const readSize = Math.min(stats.size, 1024 * 1024 * 2); // Read up to first 2MB
      const buffer = Buffer.alloc(readSize);
      await fd.read(buffer, 0, readSize, 0);

      const chapters = parseChplBuffer(buffer);
      if (chapters.length > 0) return chapters;

      // If moov is at the end of the file, read last 2MB
      if (stats.size > readSize) {
        const tailOffset = Math.max(0, stats.size - readSize);
        await fd.read(buffer, 0, readSize, tailOffset);
        return parseChplBuffer(buffer);
      }

      return [];
    } finally {
      await fd.close();
    }
  } catch {
    return [];
  }
}
