import { describe, it, expect } from 'vitest';
import { pairCompanions, type PairableItem } from './pairing';

describe('electron/pairing - pairCompanions', () => {
  it('pairs audio and book sharing the same folder and stem', () => {
    const items: PairableItem[] = [
      {
        filePath: 'C:\\Library\\Dune\\Dune.m4b',
        mediaType: 'audio',
        format: 'm4b',
        title: 'Dune',
        author: 'Frank Herbert',
        dirName: 'Dune',
      },
      {
        filePath: 'C:\\Library\\Dune\\Dune.epub',
        mediaType: 'book',
        format: 'epub',
        title: 'Dune',
        author: 'Frank Herbert',
        dirName: 'Dune',
      },
    ];

    pairCompanions(items);

    expect(items[0].companionPath).toBe(items[1].filePath);
    expect(items[0].companionType).toBe('epub');
    expect(items[1].companionPath).toBe(items[0].filePath);
    expect(items[1].companionType).toBe('m4b');
  });

  it('pairs audio and book across different folders when title AND author match', () => {
    const items: PairableItem[] = [
      {
        filePath: '/audio/Austen/Persuasion.m4b',
        mediaType: 'audio',
        format: 'm4b',
        title: 'Persuasion',
        author: 'Jane Austen',
        dirName: 'Austen',
      },
      {
        filePath: '/ebooks/Classics/Persuasion.epub',
        mediaType: 'book',
        format: 'epub',
        title: 'Persuasion',
        author: 'Jane Austen',
        dirName: 'Classics',
      },
    ];

    pairCompanions(items);

    expect(items[0].companionPath).toBe(items[1].filePath);
    expect(items[1].companionPath).toBe(items[0].filePath);
  });

  it('does NOT pair books with identical titles by DIFFERENT authors', () => {
    const items: PairableItem[] = [
      {
        filePath: '/audio/Persuasion.m4b',
        mediaType: 'audio',
        format: 'm4b',
        title: 'Persuasion',
        author: 'Jane Austen',
        dirName: 'audio',
      },
      {
        filePath: '/ebooks/Persuasion.epub',
        mediaType: 'book',
        format: 'epub',
        title: 'Persuasion',
        author: 'Different Author',
        dirName: 'ebooks',
      },
    ];

    pairCompanions(items);

    expect(items[0].companionPath).toBeUndefined();
    expect(items[1].companionPath).toBeUndefined();
  });

  it('pairs all audio and book items in a multi-item matched group', () => {
    const items: PairableItem[] = [
      {
        filePath: '/audio/BookPart1.m4b',
        mediaType: 'audio',
        format: 'm4b',
        title: 'Great Book',
        author: 'Famous Author',
        dirName: 'audio',
      },
      {
        filePath: '/audio/BookPart2.m4b',
        mediaType: 'audio',
        format: 'm4b',
        title: 'Great Book',
        author: 'Famous Author',
        dirName: 'audio',
      },
      {
        filePath: '/ebooks/GreatBook.epub',
        mediaType: 'book',
        format: 'epub',
        title: 'Great Book',
        author: 'Famous Author',
        dirName: 'ebooks',
      },
    ];

    pairCompanions(items);

    // Both audio parts should be linked to the book
    expect(items[0].companionPath).toBe(items[2].filePath);
    expect(items[1].companionPath).toBe(items[2].filePath);

    // The book should be linked to audio
    expect(items[2].companionPath).toBe(items[0].filePath);
  });
});
