import { describe, it, expect } from 'vitest';
import { PixelBudgetCache } from './pageCache';

const page = (width: number, height: number) => ({ width, height });

describe('src/lib/pageCache - PixelBudgetCache', () => {
  it('evicts the least recently used pages to stay within its pixel budget', () => {
    const released: string[] = [];
    const cache = new PixelBudgetCache<{ width: number; height: number; name?: string }>(300, (v) =>
      released.push(v.name ?? '?')
    );
    cache.set('p1', { ...page(10, 10), name: 'p1' });
    cache.set('p2', { ...page(10, 10), name: 'p2' });
    cache.set('p3', { ...page(10, 10), name: 'p3' });
    cache.get('p1'); // p1 is now the most recent; p2 the oldest

    cache.set('p4', { ...page(10, 10), name: 'p4' });

    expect(cache.get('p2')).toBeUndefined();
    expect(cache.get('p1')).toBeDefined();
    expect(cache.size).toBe(3);
    expect(released).toEqual(['p2']);
  });

  it('makes room for one large page by evicting several small ones', () => {
    const cache = new PixelBudgetCache(1000);
    for (let i = 0; i < 10; i++) cache.set(`small-${i}`, page(10, 10));
    cache.set('large', page(20, 25));
    expect(cache.get('large')).toBeDefined();
    expect(cache.size).toBe(6);
  });

  it('does not cache a page larger than the whole budget', () => {
    const cache = new PixelBudgetCache(100);
    cache.set('kept', page(5, 5));
    cache.set('huge', page(20, 20));
    expect(cache.get('huge')).toBeUndefined();
    expect(cache.get('kept')).toBeDefined();
  });

  it('replaces a page re-rendered under the same key without double counting it', () => {
    const cache = new PixelBudgetCache(200);
    cache.set('p1', page(10, 10));
    cache.set('p1', page(10, 10));
    cache.set('p2', page(10, 10));
    expect(cache.size).toBe(2);
  });
});
