/**
 * Rendered PDF pages kept for instant redisplay when scrolled back to, limited
 * by memory rather than by count.
 *
 * The reader used to keep 25 pages. A page drawn fit-to-width at 2x display
 * scaling is around 20 MB, so that could hold half a gigabyte. This keeps the
 * most recently used pages within a pixel budget and frees the rest at once.
 */

/** About 96 MB of RGBA pixels: a dozen or so full pages at typical sizes. */
export const PAGE_CACHE_BUDGET_PIXELS = 24 * 1024 * 1024;

interface Sized {
  width: number;
  height: number;
}

export class PixelBudgetCache<T extends Sized> {
  private readonly entries = new Map<string, T>();
  private readonly budget: number;
  private readonly release: (value: T) => void;
  private pixels = 0;

  constructor(budget = PAGE_CACHE_BUDGET_PIXELS, release: (value: T) => void = () => {}) {
    this.budget = budget;
    this.release = release;
  }

  /** The cached value, now counted as the most recently used. */
  get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: T): void {
    this.delete(key);
    const size = value.width * value.height;
    if (size > this.budget) return;
    for (const [oldest] of this.entries) {
      if (this.pixels + size <= this.budget) break;
      this.delete(oldest);
    }
    this.entries.set(key, value);
    this.pixels += size;
  }

  clear(): void {
    for (const key of [...this.entries.keys()]) this.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }

  private delete(key: string): void {
    const value = this.entries.get(key);
    if (!value) return;
    this.entries.delete(key);
    this.pixels -= value.width * value.height;
    this.release(value);
  }
}

/** Free a canvas's pixels now rather than whenever it is garbage collected. */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}
