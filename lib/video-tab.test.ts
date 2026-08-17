import { describe, it, expect } from 'vitest';
import { findVideoTabId, videoTitleFromTab, type TabLike } from './video-tab';

const watch = (id: string) => `https://www.youtube.com/watch?v=${id}`;

describe('findVideoTabId', () => {
  it('finds the tab displaying the requested video', () => {
    const tabs: TabLike[] = [
      { id: 1, url: 'https://example.com/' },
      { id: 2, url: watch('v1') },
    ];
    expect(findVideoTabId('v1', tabs)).toBe(2);
  });

  it('returns undefined when no tab shows this video, never a random tab', () => {
    const tabs: TabLike[] = [
      { id: 1, url: watch('autre') },
      { id: 2, url: 'https://www.youtube.com/' },
    ];
    expect(findVideoTabId('v1', tabs)).toBeUndefined();
  });

  it('returns undefined for an empty list', () => {
    expect(findVideoTabId('v1', [])).toBeUndefined();
  });

  // A reliability preference, not a content one: two tabs on the same video
  // would return the same transcript, but the active tab is the one the user is
  // really watching, so the one most surely loaded.
  it('prefers the active tab when several show the same video, whatever its rank', () => {
    const tabs: TabLike[] = [
      { id: 1, url: watch('v1') },
      { id: 2, url: watch('v1'), active: true },
    ];
    expect(findVideoTabId('v1', tabs)).toBe(2);
  });

  it('takes the first match when several tabs match and none is active', () => {
    const tabs: TabLike[] = [
      { id: 7, url: watch('v1') },
      { id: 8, url: watch('v1') },
    ];
    expect(findVideoTabId('v1', tabs)).toBe(7);
  });

  it('does not let an active tab on ANOTHER video win over a real match', () => {
    const tabs: TabLike[] = [
      { id: 1, url: watch('autre'), active: true },
      { id: 2, url: watch('v1') },
    ];
    expect(findVideoTabId('v1', tabs)).toBe(2);
  });

  // `url` is only filled for tabs covered by a host permission: those whose URL
  // stays hidden are never YouTube tabs by construction. Ignoring them is
  // correct, and must not throw.
  it('ignores tabs with no readable URL and no id, without throwing', () => {
    const tabs: TabLike[] = [
      {},
      { id: 3 },
      { url: watch('v1') },
      { id: 4, url: watch('v1') },
    ];
    expect(findVideoTabId('v1', tabs)).toBe(4);
  });

  // chrome.tabs.TAB_ID_NONE marks a context that is not a tab, which
  // chrome.tabs.sendMessage cannot reach by definition.
  it('ignores an id of -1 (TAB_ID_NONE) even when the URL matches', () => {
    const tabs: TabLike[] = [
      { id: -1, url: watch('v1'), active: true },
      { id: 9, url: watch('v1') },
    ];
    expect(findVideoTabId('v1', tabs)).toBe(9);
  });

  // The same URL forms readVideoId (youtube-dom.ts) recognises, reused rather
  // than duplicated: a tab on a Short or a youtu.be link does show the video.
  it('recognises the /shorts/ and youtu.be forms, like readVideoId', () => {
    expect(findVideoTabId('v1', [{ id: 5, url: 'https://www.youtube.com/shorts/v1' }])).toBe(5);
    expect(findVideoTabId('v1', [{ id: 6, url: 'https://youtu.be/v1' }])).toBe(6);
  });

  it('still matches a tab whose URL carries a timestamp', () => {
    expect(findVideoTabId('v1', [{ id: 2, url: `${watch('v1')}&t=42s` }])).toBe(2);
  });
});

// The idle panel shows this title above its summarise button: a button saying
// "this video" without saying which asks the user to trust a panel that shows
// nothing.
describe('videoTitleFromTab', () => {
  it('strips the " - YouTube" suffix the site appends', () => {
    expect(videoTitleFromTab('SpaceX : 500 vols du Falcon 9 - YouTube'))
      .toBe('SpaceX : 500 vols du Falcon 9');
  });

  it('strips the leading notification counter', () => {
    expect(videoTitleFromTab('(3) SpaceX : 500 vols du Falcon 9 - YouTube'))
      .toBe('SpaceX : 500 vols du Falcon 9');
  });

  it('accepts the en dash YouTube uses in some locales', () => {
    expect(videoTitleFromTab('Un titre – YouTube')).toBe('Un titre');
  });

  // A title containing " - YouTube" anywhere but at the end MUST NOT be
  // truncated: the end-of-string anchor is what protects it.
  it("leaves a \"YouTube\" in the middle of the title alone", () => {
    expect(videoTitleFromTab('Pourquoi - YouTube a changé son algorithme - YouTube'))
      .toBe('Pourquoi - YouTube a changé son algorithme');
  });

  // The caller then shows the button untitled rather than an empty card.
  it('returns an empty string when nothing useful remains', () => {
    expect(videoTitleFromTab(undefined)).toBe('');
    expect(videoTitleFromTab('YouTube')).toBe('');
    expect(videoTitleFromTab('   ')).toBe('');
  });
});
