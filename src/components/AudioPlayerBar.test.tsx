import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPlayerBar } from './AudioPlayerBar';
import type { Bookmark, MediaItem } from '../types';

const mockItem: MediaItem = {
  id: 'test-audio-1',
  title: 'Great Audiobook',
  author: 'Jane Doe',
  filePath: 'C:/Audio/Great Audiobook.m4b',
  mediaType: 'audio',
  format: 'm4b',
  fileSize: 10485760,
  dateAdded: Date.now(),
  dirName: 'C:/Audio',
  durationSeconds: 3600,
};

const mockBookmarks: Bookmark[] = [
  {
    id: 'bm-1',
    itemId: 'test-audio-1',
    label: 'Chapter 2 opening',
    createdAt: Date.now(),
    position: 450,
  },
  {
    id: 'bm-2',
    itemId: 'test-audio-1',
    label: 'Key argument',
    createdAt: Date.now(),
    position: 1200,
  },
];

describe('AudioPlayerBar', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders track title, author, and audio controls', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <AudioPlayerBar
          item={mockItem}
          initialTime={100}
          onClose={vi.fn()}
          onProgressUpdate={vi.fn()}
          onAddBookmark={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain('Great Audiobook');
    expect(container.textContent).toContain('Jane Doe');
    await act(async () => {
      root.unmount();
    });
  });

  it('displays bookmark badge and shows bookmarks menu when clicked', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <AudioPlayerBar
          item={mockItem}
          bookmarks={mockBookmarks}
          onClose={vi.fn()}
          onProgressUpdate={vi.fn()}
          onAddBookmark={vi.fn()}
        />
      );
    });

    const bookmarkBtn = container.querySelector('button[aria-label="Bookmarks"]') as HTMLButtonElement | null;
    expect(bookmarkBtn).toBeDefined();
    expect(bookmarkBtn?.textContent).toContain('2');

    // Open bookmarks popover
    await act(async () => {
      bookmarkBtn?.click();
    });

    expect(container.textContent).toContain('Bookmarks (2)');
    expect(container.textContent).toContain('Chapter 2 opening');
    expect(container.textContent).toContain('Key argument');
    await act(async () => {
      root.unmount();
    });
  });

  it('displays sleep timer menu with options when clicked', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <AudioPlayerBar
          item={mockItem}
          onClose={vi.fn()}
          onProgressUpdate={vi.fn()}
          onAddBookmark={vi.fn()}
        />
      );
    });

    const sleepBtn = container.querySelector('button[aria-label="Set sleep timer"]') as HTMLButtonElement | null;
    expect(sleepBtn).toBeDefined();

    await act(async () => {
      sleepBtn?.click();
    });

    expect(container.textContent).toContain('Sleep timer');
    expect(container.textContent).toContain('15 minutes');
    expect(container.textContent).toContain('30 minutes');
    expect(container.textContent).toContain('60 minutes');
    await act(async () => {
      root.unmount();
    });
  });

  it('invokes onNextTrack when next track button is clicked', async () => {
    const root = createRoot(container);
    const onNextTrack = vi.fn();
    await act(async () => {
      root.render(
        <AudioPlayerBar
          item={mockItem}
          hasNextTrack={true}
          onNextTrack={onNextTrack}
          onClose={vi.fn()}
          onProgressUpdate={vi.fn()}
          onAddBookmark={vi.fn()}
        />
      );
    });

    const nextBtn = container.querySelector('button[aria-label="Next track"]') as HTMLButtonElement | null;
    expect(nextBtn).toBeDefined();
    expect(nextBtn?.disabled).toBe(false);

    await act(async () => {
      nextBtn?.click();
    });

    expect(onNextTrack).toHaveBeenCalledTimes(1);
    await act(async () => {
      root.unmount();
    });
  });

  it('renders chapters badge, active chapter subtitle, and allows jumping to a chapter', async () => {
    const itemWithChapters: MediaItem = {
      ...mockItem,
      chapters: [
        { id: 'ch-1', title: 'Prologue: The Fall', startTime: 0, endTime: 300 },
        { id: 'ch-2', title: 'Chapter 1: Awakenings', startTime: 300, endTime: 900 },
      ],
    };

    const root = createRoot(container);
    await act(async () => {
      root.render(
        <AudioPlayerBar
          item={itemWithChapters}
          initialTime={350}
          onClose={vi.fn()}
          onProgressUpdate={vi.fn()}
          onAddBookmark={vi.fn()}
        />
      );
    });

    // Subtitle shows Chapter 1: Awakenings because currentTime is 350
    expect(container.textContent).toContain('Chapter 1: Awakenings');

    const chapBtn = container.querySelector('button[aria-label="Chapters"]') as HTMLButtonElement | null;
    expect(chapBtn).not.toBeNull();

    await act(async () => {
      chapBtn?.click();
    });

    expect(container.textContent).toContain('Chapters (2)');
    expect(container.textContent).toContain('1. Prologue: The Fall');
    expect(container.textContent).toContain('2. Chapter 1: Awakenings');

    await act(async () => {
      root.unmount();
    });
  });

  it('auto-advances to next track when track playback ends', async () => {
    const root = createRoot(container);
    const onNextTrack = vi.fn();
    await act(async () => {
      root.render(
        <AudioPlayerBar
          item={mockItem}
          hasNextTrack={true}
          onNextTrack={onNextTrack}
          onClose={vi.fn()}
          onProgressUpdate={vi.fn()}
          onAddBookmark={vi.fn()}
        />
      );
    });

    const audioElement = container.querySelector('audio') as HTMLAudioElement;
    expect(audioElement).toBeDefined();

    await act(async () => {
      audioElement.dispatchEvent(new Event('ended'));
    });

    expect(onNextTrack).toHaveBeenCalledTimes(1);
    await act(async () => {
      root.unmount();
    });
  });

  it('synchronizes with Windows SMTC via navigator.mediaSession', async () => {
    const mockSetActionHandler = vi.fn();
    const mockSetPositionState = vi.fn();

    class MockMediaMetadata {
      title: string;
      artist: string;
      album: string;
      artwork: Array<{ src: string }>;
      constructor(init: { title: string; artist: string; album: string; artwork: Array<{ src: string }> }) {
        this.title = init.title;
        this.artist = init.artist;
        this.album = init.album;
        this.artwork = init.artwork;
      }
    }

    // @ts-expect-error Mocking MediaMetadata in jsdom
    globalThis.MediaMetadata = MockMediaMetadata;

    const mockMediaSession = {
      metadata: null as unknown,
      playbackState: 'none',
      setActionHandler: mockSetActionHandler,
      setPositionState: mockSetPositionState,
    };

    Object.defineProperty(navigator, 'mediaSession', {
      value: mockMediaSession,
      configurable: true,
      writable: true,
    });

    const root = createRoot(container);
    await act(async () => {
      root.render(
        <AudioPlayerBar
          item={mockItem}
          initialTime={100}
          onClose={vi.fn()}
          onProgressUpdate={vi.fn()}
          onAddBookmark={vi.fn()}
        />
      );
    });

    expect(mockMediaSession.metadata).toBeDefined();
    const metadata = mockMediaSession.metadata as { title: string; artist: string };
    expect(metadata.title).toBe('Great Audiobook');
    expect(metadata.artist).toBe('Jane Doe');

    expect(mockSetActionHandler).toHaveBeenCalledWith('play', expect.any(Function));
    expect(mockSetActionHandler).toHaveBeenCalledWith('pause', expect.any(Function));
    expect(mockSetActionHandler).toHaveBeenCalledWith('seekbackward', expect.any(Function));
    expect(mockSetActionHandler).toHaveBeenCalledWith('seekforward', expect.any(Function));
    expect(mockSetActionHandler).toHaveBeenCalledWith('seekto', expect.any(Function));

    await act(async () => {
      root.unmount();
    });
  });

  it('renders full-screen mode with cover artwork and allows minimizing', async () => {
    const itemWithCover: MediaItem = {
      ...mockItem,
      id: 'test-audio-cover',
      coverUrl: 'C:/Audio/cover.jpg',
    };
    const onFullScreenChange = vi.fn();
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AudioPlayerBar
          item={itemWithCover}
          isFullScreen={true}
          onFullScreenChange={onFullScreenChange}
          onClose={vi.fn()}
          onProgressUpdate={vi.fn()}
          onAddBookmark={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain('Great Audiobook');
    expect(container.textContent).toContain('Jane Doe');
    expect(container.textContent).not.toContain('Audiobook Player');

    const coverImg = container.querySelector('img[alt="Great Audiobook"]');
    expect(coverImg).toBeDefined();

    const minimizeBtn = container.querySelector('button[aria-label="Minimize player to bar (Esc)"]') as HTMLButtonElement | null;
    expect(minimizeBtn).toBeDefined();

    await act(async () => {
      minimizeBtn?.click();
    });

    expect(onFullScreenChange).toHaveBeenCalledWith(false);

    await act(async () => {
      root.unmount();
    });
  });

  it('renders clean procedural cloth jacket fallback when no cover image exists', async () => {
    const itemNoCover: MediaItem = {
      ...mockItem,
      id: 'test-audio-nocover',
      coverUrl: undefined,
    };
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AudioPlayerBar
          item={itemNoCover}
          isFullScreen={true}
          onClose={vi.fn()}
          onProgressUpdate={vi.fn()}
          onAddBookmark={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain('Audiobook');
    expect(container.textContent).toContain('Great Audiobook');
    expect(container.textContent).toContain('Jane Doe');
    expect(container.textContent).not.toContain('Audiobook Player');

    // No img element rendered when coverUrl is undefined
    const coverImg = container.querySelector('img');
    expect(coverImg).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('switches to fallback jacket if cover image fails to load', async () => {
    const itemBadCover: MediaItem = {
      ...mockItem,
      id: 'test-audio-badcover',
      coverUrl: 'C:/Audio/nonexistent.jpg',
    };
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AudioPlayerBar
          item={itemBadCover}
          isFullScreen={true}
          onClose={vi.fn()}
          onProgressUpdate={vi.fn()}
          onAddBookmark={vi.fn()}
        />
      );
    });

    const img = container.querySelector('img');
    expect(img).toBeDefined();

    await act(async () => {
      img?.dispatchEvent(new Event('error'));
    });

    // Fallback jacket should now be shown
    expect(container.textContent).toContain('Audiobook');
    expect(container.textContent).toContain('Great Audiobook');
    expect(container.querySelector('img')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('minimizes full-screen mode when Escape key is pressed', async () => {
    const onFullScreenChange = vi.fn();
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AudioPlayerBar
          item={mockItem}
          isFullScreen={true}
          onFullScreenChange={onFullScreenChange}
          onClose={vi.fn()}
          onProgressUpdate={vi.fn()}
          onAddBookmark={vi.fn()}
        />
      );
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onFullScreenChange).toHaveBeenCalledWith(false);

    await act(async () => {
      root.unmount();
    });
  });

  it('expands to full-screen mode when maximize button is clicked in minimized bottom bar', async () => {
    const onFullScreenChange = vi.fn();
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AudioPlayerBar
          item={mockItem}
          isFullScreen={false}
          onFullScreenChange={onFullScreenChange}
          onClose={vi.fn()}
          onProgressUpdate={vi.fn()}
          onAddBookmark={vi.fn()}
        />
      );
    });

    const expandBtn = container.querySelector('button[aria-label="Expand to full screen"]') as HTMLButtonElement | null;
    expect(expandBtn).toBeDefined();

    await act(async () => {
      expandBtn?.click();
    });

    expect(onFullScreenChange).toHaveBeenCalledWith(true);

    await act(async () => {
      root.unmount();
    });
  });

  it('supports multi-track audiobooks: calculates duration, initial track seek, and auto-advancement', async () => {
    const multiTrackItem: MediaItem = {
      id: 'multi-part-1',
      title: 'The Hobbit',
      author: 'J.R.R. Tolkien',
      filePath: 'C:/Audiobooks/The Hobbit/01 - An Unexpected Party.mp3',
      mediaType: 'audio',
      format: 'mp3',
      fileSize: 50000000,
      dateAdded: Date.now(),
      dirName: 'The Hobbit',
      durationSeconds: 1800,
      tracks: [
        {
          id: 'track-1',
          title: '01 - An Unexpected Party',
          filePath: 'C:/Audiobooks/The Hobbit/01 - An Unexpected Party.mp3',
          durationSeconds: 1000,
          offsetSeconds: 0,
        },
        {
          id: 'track-2',
          title: '02 - Roast Mutton',
          filePath: 'C:/Audiobooks/The Hobbit/02 - Roast Mutton.mp3',
          durationSeconds: 800,
          offsetSeconds: 1000,
        },
      ],
      chapters: [
        { id: 'chap-1', title: '01 - An Unexpected Party', startTime: 0, endTime: 1000 },
        { id: 'chap-2', title: '02 - Roast Mutton', startTime: 1000, endTime: 1800 },
      ],
    };

    const root = createRoot(container);

    // 1. Initial render at time 1200 (should resolve to Track 2!)
    await act(async () => {
      root.render(
        <AudioPlayerBar
          item={multiTrackItem}
          initialTime={1200}
          onClose={vi.fn()}
          onProgressUpdate={vi.fn()}
          onAddBookmark={vi.fn()}
        />
      );
    });

    const audio = container.querySelector('audio') as HTMLAudioElement;
    expect(audio).toBeDefined();
    // Audio src should point to track 2
    expect(decodeURIComponent(audio.src)).toContain('02 - Roast Mutton.mp3');

    // 2. Fire onEnded -> should stay at track 2 since it's the last track
    await act(async () => {
      audio.dispatchEvent(new Event('ended'));
    });

    await act(async () => {
      root.unmount();
    });

    // 3. Render at start (time 0) -> should point to Track 1, and onEnded advances to Track 2
    const root2 = createRoot(container);
    await act(async () => {
      root2.render(
        <AudioPlayerBar
          item={multiTrackItem}
          initialTime={0}
          onClose={vi.fn()}
          onProgressUpdate={vi.fn()}
          onAddBookmark={vi.fn()}
        />
      );
    });

    const audio2 = container.querySelector('audio') as HTMLAudioElement;
    expect(decodeURIComponent(audio2.src)).toContain('01 - An Unexpected Party.mp3');

    // Fire onEnded on track 1 -> advances to track 2
    await act(async () => {
      audio2.dispatchEvent(new Event('ended'));
    });

    expect(decodeURIComponent(audio2.src)).toContain('02 - Roast Mutton.mp3');

    await act(async () => {
      root2.unmount();
    });
  });
});

