import { describe, expect, it } from 'vitest';
import {
  FINISHED_PERCENT,
  MAX_SESSIONS,
  SESSION_GAP_MS,
  nextProgress,
  readStatus,
  recordSession,
  setFinished,
  timeSpentMs,
} from './readingHistory';

describe('reading status', () => {
  it('records when a title was started, and keeps it', () => {
    const first = nextProgress(undefined, { id: 'a', percent: 5 }, 1000);
    expect(first).toMatchObject({ startedAt: 1000, lastPlayed: 1000 });
    expect(nextProgress(first, { id: 'a', percent: 10 }, 2000)).toMatchObject({ startedAt: 1000, lastPlayed: 2000 });
  });

  it('treats the last time played as the start of a title read before this was recorded', () => {
    expect(nextProgress({ id: 'a', percent: 30, lastPlayed: 50 }, { id: 'a', percent: 31 }, 2000).startedAt).toBe(50);
  });

  it('marks a title finished when the end is reached, and does not forget it on a re-read', () => {
    const finished = nextProgress({ id: 'a', percent: 90, lastPlayed: 1 }, { id: 'a', percent: FINISHED_PERCENT }, 3000);
    expect(finished.finishedAt).toBe(3000);
    expect(readStatus(finished)).toBe('finished');
    expect(nextProgress(finished, { id: 'a', percent: 2 }, 4000).finishedAt).toBe(3000);
  });

  it('can be marked finished or not by hand, keeping the position', () => {
    const reading = { id: 'a', percent: 40, lastPlayed: 1, chapterIndex: 4 };
    const finished = setFinished(reading, 'a', true, 5000);
    expect(finished).toMatchObject({ percent: 40, chapterIndex: 4, finishedAt: 5000 });
    const notFinished = setFinished(finished, 'a', false);
    expect(notFinished.finishedAt).toBeUndefined();
    expect(readStatus(notFinished)).toBe('reading');
    expect(readStatus(setFinished(undefined, 'b', true, 1))).toBe('finished');
  });

  it('calls a title unread until it is past the first percent', () => {
    expect(readStatus(undefined)).toBe('unread');
    expect(readStatus({ id: 'a', percent: 0.5, lastPlayed: 1 })).toBe('unread');
    expect(readStatus({ id: 'a', percent: 12, lastPlayed: 1 })).toBe('reading');
  });
});

describe('reading history', () => {
  it('extends the current session while updates keep coming', () => {
    let history = recordSession(undefined, 'a', 10, 8, 1000);
    history = recordSession(history, 'a', 12, 10, 61_000);
    expect(history).toEqual([{ itemId: 'a', startedAt: 1000, endedAt: 61_000, startPercent: 8, endPercent: 12 }]);
    expect(timeSpentMs(history, 'a')).toBe(60_000);
  });

  it('starts a new session after a break', () => {
    let history = recordSession(undefined, 'a', 10, 8, 1000);
    history = recordSession(history, 'a', 11, 10, 1000 + SESSION_GAP_MS + 1);
    expect(history).toHaveLength(2);
    expect(history[1].startPercent).toBe(10);
  });

  it('keeps separate sessions for titles used at the same time', () => {
    let history = recordSession(undefined, 'book', 10, 10, 1000);
    history = recordSession(history, 'audio', 50, 50, 2000);
    history = recordSession(history, 'book', 11, 10, 3000);
    expect(history.map((s) => [s.itemId, s.endedAt])).toEqual([
      ['book', 3000],
      ['audio', 2000],
    ]);
  });

  it('drops the oldest sessions beyond the cap', () => {
    let history = Array.from({ length: MAX_SESSIONS }, (_, i) => ({
      itemId: `x${i}`,
      startedAt: i,
      endedAt: i,
      startPercent: 0,
      endPercent: 1,
    }));
    history = recordSession(history, 'new', 1, 0, 10_000_000);
    expect(history).toHaveLength(MAX_SESSIONS);
    expect(history[0].itemId).toBe('x1');
    expect(history[history.length - 1].itemId).toBe('new');
  });
});
