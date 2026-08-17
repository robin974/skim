// lib/session-tabs.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildSessionTabs, resolveSelection, neighbourAfterClose, closableTabs, type SessionTab,
} from './session-tabs';
import type { ConversationSummary } from './conversations';
import type { VideoMeta } from './messages';

function meta(overrides: Partial<VideoMeta> = {}): VideoMeta {
  return {
    videoId: 'v1', title: 'Titre', channel: 'Chaîne', description: '', durationSeconds: 600, ...overrides,
  };
}

function stored(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return { videoId: 'v1', meta: meta(), createdAt: 1000, status: 'done', ...overrides };
}

function tab(overrides: Partial<SessionTab> = {}): SessionTab {
  return {
    videoId: 'v1', title: 'Titre', meta: null, generating: false, createdAt: 1000, pinned: false, ...overrides,
  };
}

describe('buildSessionTabs — the strip', () => {
  it('draws one tab per stored conversation', () => {
    const tabs = buildSessionTabs([
      stored({ videoId: 'a', meta: meta({ videoId: 'a', title: 'A' }) }),
      stored({ videoId: 'b', meta: meta({ videoId: 'b', title: 'B' }), createdAt: 2000 }),
    ], null);

    expect(tabs.map((t) => t.title)).toEqual(['A', 'B']);
  });

  it('orders them oldest first', () => {
    const tabs = buildSessionTabs([
      stored({ videoId: 'recent', createdAt: 3000 }),
      stored({ videoId: 'ancien', createdAt: 1000 }),
      stored({ videoId: 'milieu', createdAt: 2000 }),
    ], null);

    expect(tabs.map((t) => t.videoId)).toEqual(['ancien', 'milieu', 'recent']);
  });

  // A running generation is dated at its START, so it keeps its place instead of
  // jumping to the end of the bar the moment it finishes.
  it('places a running generation by its creation date, not at the end', () => {
    const tabs = buildSessionTabs([
      stored({ videoId: 'apres', createdAt: 3000 }),
      stored({ videoId: 'encours', createdAt: 2000, status: 'streaming' }),
      stored({ videoId: 'avant', createdAt: 1000 }),
    ], null);

    expect(tabs.map((t) => t.videoId)).toEqual(['avant', 'encours', 'apres']);
    expect(tabs.find((t) => t.videoId === 'encours')?.generating).toBe(true);
  });

  // Two renders of the same session MUST NOT reorder the bar under the pointer.
  it('breaks a tie on the video id rather than leaving the order to the sort', () => {
    const tabs = buildSessionTabs([
      stored({ videoId: 'zz', createdAt: 1000 }),
      stored({ videoId: 'aa', createdAt: 1000 }),
    ], null);

    expect(tabs.map((t) => t.videoId)).toEqual(['aa', 'zz']);
  });

  it('marks a finished summary as not generating', () => {
    expect(buildSessionTabs([stored({ status: 'done' })], null)[0]?.generating).toBe(false);
  });

  // A conversation written before its metadata arrived, or by a version that
  // stored none: the id is the video, an invented title would not be.
  it('falls back to the video id when nothing usable was stored as a title', () => {
    expect(buildSessionTabs([stored({ videoId: 'dQw4', meta: null })], null)[0]?.title).toBe('dQw4');
    expect(buildSessionTabs([stored({ videoId: 'dQw4', meta: meta({ title: '  ' }) })], null)[0]?.title)
      .toBe('dQw4');
  });
});

describe('buildSessionTabs — the pinned tab', () => {
  it('adds the displayed video at the end when it has no summary', () => {
    const tabs = buildSessionTabs([stored({ videoId: 'a' })], { id: 'watching', title: 'En train de regarder' });

    expect(tabs.map((t) => t.videoId)).toEqual(['a', 'watching']);
    expect(tabs.at(-1)).toMatchObject({ pinned: true, title: 'En train de regarder', meta: null, createdAt: 0 });
  });

  // "Il n'existe jamais qu'un seul onglet épinglé : ouvrir une autre vidéo le
  // renomme au lieu d'en créer un second." There is one current video, so there
  // is one pinned tab — renaming it is what rebuilding the bar does.
  it('never draws more than one, whatever the video shown', () => {
    const first = buildSessionTabs([], { id: 'v1', title: 'Première' });
    const second = buildSessionTabs([], { id: 'v2', title: 'Seconde' });

    expect(first.filter((t) => t.pinned)).toHaveLength(1);
    expect(second.filter((t) => t.pinned)).toHaveLength(1);
    expect(second[0]?.title).toBe('Seconde');
  });

  // Opening a video already summarised in this session activates ITS tab; it
  // must not also appear as the video being watched.
  it('draws none when the displayed video already has a summary', () => {
    const tabs = buildSessionTabs([stored({ videoId: 'a' })], { id: 'a', title: 'A' });

    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.pinned).toBe(false);
  });

  it('draws none off YouTube', () => {
    expect(buildSessionTabs([stored({ videoId: 'a' })], null).some((t) => t.pinned)).toBe(false);
  });

  it('falls back to the video id when the tab title is not readable yet', () => {
    expect(buildSessionTabs([], { id: 'dQw4', title: '' })[0]?.title).toBe('dQw4');
  });

  // A video never summarised leaves no trace: the bar is empty again as soon as
  // the user leaves it.
  it('leaves the bar empty when nothing is stored and no video is displayed', () => {
    expect(buildSessionTabs([], null)).toEqual([]);
  });
});

describe('resolveSelection', () => {
  const tabs = [tab({ videoId: 'a' }), tab({ videoId: 'b' }), tab({ videoId: 'watching', pinned: true })];

  it('keeps the chosen tab while it exists', () => {
    expect(resolveSelection(tabs, 'a')).toBe('a');
  });

  // Its tab was closed from the menu, or the session was cleared: the video in
  // front of the user is the better answer than the last summary.
  it('falls back to the pinned tab when the chosen one is gone', () => {
    expect(resolveSelection(tabs, 'disparu')).toBe('watching');
  });

  it('falls back to the most recent summary when there is no pinned tab', () => {
    expect(resolveSelection([tab({ videoId: 'a' }), tab({ videoId: 'b' })], null)).toBe('b');
  });

  it('selects nothing on an empty bar', () => {
    expect(resolveSelection([], 'a')).toBeNull();
  });
});

describe('neighbourAfterClose', () => {
  const tabs = [tab({ videoId: 'a' }), tab({ videoId: 'b' }), tab({ videoId: 'c' })];

  it('moves to the next tab', () => {
    expect(neighbourAfterClose(tabs, 'b', 'b')).toBe('c');
  });

  it('moves to the previous one when the last tab is closed', () => {
    expect(neighbourAfterClose(tabs, 'c', 'c')).toBe('b');
  });

  it('leaves nothing selected when the only tab is closed', () => {
    expect(neighbourAfterClose([tab({ videoId: 'a' })], 'a', 'a')).toBeNull();
  });

  // Closing a tab from the menu, or through its cross while another is
  // displayed: what is on screen must not move.
  it('keeps the displayed tab when another one is closed', () => {
    expect(neighbourAfterClose(tabs, 'a', 'c')).toBe('c');
  });

  // The pinned tab sits at the end of the same list, so it is a neighbour like
  // any other.
  it('can land on the pinned tab', () => {
    const withPinned = [tab({ videoId: 'a' }), tab({ videoId: 'watching', pinned: true })];
    expect(neighbourAfterClose(withPinned, 'a', 'a')).toBe('watching');
  });
});

describe('closableTabs', () => {
  it('names every summary of the session', () => {
    expect(closableTabs([tab({ videoId: 'a' }), tab({ videoId: 'b' })])).toEqual(['a', 'b']);
  });

  // Nothing is cached for the pinned tab, so there is nothing to forget — and
  // closing it would close a Chrome tab nobody asked to close.
  it('never names the pinned tab', () => {
    const tabs = [tab({ videoId: 'a' }), tab({ videoId: 'watching', pinned: true })];
    expect(closableTabs(tabs)).toEqual(['a']);
  });
});
