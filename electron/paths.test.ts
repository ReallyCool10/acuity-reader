import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { isAllowedPath, registerAllowedRoot, clearAllowedRoots } from './paths';

describe('electron/paths - isAllowedPath', () => {
  beforeEach(() => {
    clearAllowedRoots();
  });

  it('/books allowed → /books/a.epub passes', () => {
    const root = path.resolve('/books');
    registerAllowedRoot(root);

    const bookFile = path.resolve('/books/a.epub');
    expect(isAllowedPath(bookFile)).toBe(true);

    const nestedBook = path.resolve('/books/scifi/dune.epub');
    expect(isAllowedPath(nestedBook)).toBe(true);
  });

  it('/books allowed → /books-private/secret.epub rejects (prefix-vs-boundary regression)', () => {
    const root = path.resolve('/books');
    registerAllowedRoot(root);

    const privateFile = path.resolve('/books-private/secret.epub');
    expect(isAllowedPath(privateFile)).toBe(false);
  });

  it('.. traversal rejects', () => {
    const root = path.resolve('/books');
    registerAllowedRoot(root);

    const traversalTarget = path.join(root, '..', 'secret.epub');
    expect(isAllowedPath(traversalTarget)).toBe(false);

    const deepTraversal = path.join(root, 'sub', '..', '..', 'secret.epub');
    expect(isAllowedPath(deepTraversal)).toBe(false);
  });
});
