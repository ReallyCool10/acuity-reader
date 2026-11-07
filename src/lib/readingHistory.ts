import type { ProgressItem, ReadingSession } from '../types';

/*
 * Reading status and history.
 *
 * Status lives on the progress entry (`startedAt`, `finishedAt`), so it
 * travels with the item ID like everything else. History is a capped list of
 * sessions in the library file: each progress update extends the item's
 * latest session if it is recent, or starts a new one. Readers and the player
 * report progress about once a second, so this stays cheap per update.
 */

/** At or beyond this percentage a title counts as finished. Matches the Continue shelf's ceiling. */
export const FINISHED_PERCENT = 98;

/** Updates further apart than this belong to different sessions. */
export const SESSION_GAP_MS = 10 * 60 * 1000;

/** Oldest sessions are dropped beyond this, so the library file stays small. */
export const MAX_SESSIONS = 2000;

/** How far back to look for the item's open session; several titles may interleave. */
const SESSION_LOOKBACK = 25;

export type ReadStatus = 'unread' | 'reading' | 'finished';

export function readStatus(progress: ProgressItem | undefined): ReadStatus {
  if (!progress) return 'unread';
  if (progress.finishedAt) return 'finished';
  return progress.percent > 1 ? 'reading' : 'unread';
}

/**
 * The next progress entry for an update from a reader or the player. Keeps when
 * the title was started and finished, and records finishing the first time the
 * end is reached.
 */
export function nextProgress(
  previous: ProgressItem | undefined,
  update: Omit<ProgressItem, 'lastPlayed' | 'startedAt' | 'finishedAt'>,
  now: number = Date.now()
): ProgressItem {
  const finishedAt = previous?.finishedAt ?? (update.percent >= FINISHED_PERCENT ? now : undefined);
  return {
    ...update,
    lastPlayed: now,
    startedAt: previous?.startedAt ?? previous?.lastPlayed ?? now,
    ...(finishedAt !== undefined ? { finishedAt } : {}),
  };
}

/** Mark a title finished or not. Its position is kept either way. */
export function setFinished(
  previous: ProgressItem | undefined,
  itemId: string,
  finished: boolean,
  now: number = Date.now()
): ProgressItem {
  if (finished) {
    return {
      ...(previous ?? { id: itemId, percent: 100, lastPlayed: now }),
      id: itemId,
      startedAt: previous?.startedAt ?? previous?.lastPlayed ?? now,
      finishedAt: now,
    };
  }
  const next: ProgressItem = { ...(previous ?? { id: itemId, percent: 0, lastPlayed: now }), id: itemId };
  delete next.finishedAt;
  return next;
}

/** Extend the item's current session, or start a new one. */
export function recordSession(
  history: ReadingSession[] | undefined,
  itemId: string,
  percent: number,
  previousPercent: number | undefined,
  now: number = Date.now()
): ReadingSession[] {
  const sessions = history ?? [];
  const floor = Math.max(0, sessions.length - SESSION_LOOKBACK);
  for (let i = sessions.length - 1; i >= floor; i--) {
    const session = sessions[i];
    if (session.itemId !== itemId) continue;
    if (now - session.endedAt > SESSION_GAP_MS) break;
    const next = sessions.slice();
    next[i] = { ...session, endedAt: now, endPercent: percent };
    return next;
  }

  const started: ReadingSession = {
    itemId,
    startedAt: now,
    endedAt: now,
    startPercent: previousPercent ?? percent,
    endPercent: percent,
  };
  const next = [...sessions, started];
  return next.length > MAX_SESSIONS ? next.slice(next.length - MAX_SESSIONS) : next;
}

/** Total time spent in a title's sessions, in milliseconds. */
export function timeSpentMs(history: ReadingSession[] | undefined, itemId: string): number {
  return (history ?? []).reduce(
    (total, session) => (session.itemId === itemId ? total + (session.endedAt - session.startedAt) : total),
    0
  );
}
