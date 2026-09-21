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
 * Returns a stable callback that runs at most once per `intervalMs`, always
 * firing a trailing call so the final value is never dropped.
 *
 * Used for progress persistence: `timeupdate` fires roughly four times a second,
 * and writing the whole library on every tick pins the disk during playback.
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

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return useCallback(
    (...args: Args) => {
      pending.current = args;
      const elapsed = Date.now() - lastRun.current;

      const run = () => {
        lastRun.current = Date.now();
        timer.current = null;
        const next = pending.current;
        pending.current = null;
        if (next) fnRef.current(...next);
      };

      if (elapsed >= intervalMs) run();
      else if (!timer.current) timer.current = setTimeout(run, intervalMs - elapsed);
    },
    [intervalMs]
  );
}
