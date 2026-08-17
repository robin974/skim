// Reaches the video a summary was made from: the tab already showing it, or a
// new one.
//
// Same path as the timestamps under a summary (see seek, SummaryView.tsx), and
// the same permission story: `chrome.tabs.query({})` needs none, and Chrome
// fills `url` only for tabs covered by a host permission — exactly the YouTube
// tabs (see TabLike, lib/video-tab.ts). Nothing here needs "tabs".
import { findVideoTabId, type TabLike } from './video-tab';

/**
 * Never rejects: called from a click handler that cannot await a promise. A
 * failure to open is logged, never propagated.
 */
export function openVideo(videoId: string): void {
  reach(videoId).catch(console.error);
}

async function reach(videoId: string): Promise<void> {
  const tabs = await chrome.tabs.query({}).catch((): TabLike[] => []);
  const tabId = findVideoTabId(videoId, tabs);

  if (tabId === undefined) {
    await chrome.tabs.create({ url: watchUrl(videoId) });
    return;
  }

  await chrome.tabs.update(tabId, { active: true });
  // The tab may live in another window, possibly behind this one: activating it
  // without focusing its window would leave the user staring at a screen that
  // did not move.
  const windowId = tabs.find((t) => t.id === tabId)?.windowId;
  if (windowId != null) await chrome.windows.update(windowId, { focused: true }).catch(() => {});
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
