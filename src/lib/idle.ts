/**
 * Resolve when the renderer next has idle time (or after `timeout` ms at the
 * latest), so background work waits for what is on screen to finish first.
 */
export function whenIdle(timeout = 2000): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout });
    else setTimeout(resolve, 0);
  });
}
