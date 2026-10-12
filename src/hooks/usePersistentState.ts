import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * State mirrored into localStorage, for lightweight view preferences (typeface,
 * volume, sort order). Library data belongs in the main-process store instead —
 * this is for things that are per-install UI chrome, not user content.
 */
export function usePersistentState<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can be unavailable or full; preferences are not worth failing over.
    }
  }, [key, value]);

  return [value, setValue as (value: T | ((prev: T) => T)) => void];
}

/**
 * Call `fn` at most once per `intervalMs`: the first call runs at once, later
 * ones within the interval collapse into one trailing call with the latest
 * arguments.
 *
 * A call still waiting when the component unmounts, or when the window is
 * closed, is made rather than dropped. It is usually the last thing worth
 * saving: the reading position just before a book was closed, or a change made
 * a moment before quitting. (Closing the window does not unmount React, so
 * `pagehide` covers that case.)
 */
export function useThrottledCallback<Args extends unknown[]>(
  fn: (...args: Args) => void,
  intervalMs: number
): (...args: Args) => void {
  const fnRef = useRef(fn);
  const lastRun = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Args | null>(null);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  const run = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    lastRun.current = Date.now();
    const next = pending.current;
    pending.current = null;
    if (next) fnRef.current(...next);
  }, []);

  const call = useCallback(
    (...args: Args) => {
      pending.current = args;
      const elapsed = Date.now() - lastRun.current;
      if (elapsed >= intervalMs) run();
      else if (!timer.current) timer.current = setTimeout(run, intervalMs - elapsed);
    },
    [intervalMs, run]
  );

  const flush = useCallback(() => {
    if (pending.current) run();
  }, [run]);

  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  return call;
}
