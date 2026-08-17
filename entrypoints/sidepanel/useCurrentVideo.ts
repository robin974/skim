// What YouTube is showing right now: the video in the active tab — id AND title
// — and every video some tab has open.
//
// The panel is global to the WINDOW, not to a tab: it stays open when the user
// switches tabs. Since the panel can START a summary itself, one read at mount
// is not enough — its button must mean the video actually in front of the user
// at click time, not the one that was there when the panel opened.
import { useEffect, useState } from 'react';
import { readVideoId } from '@/lib/youtube-dom';
import { videoTitleFromTab } from '@/lib/video-tab';

export type CurrentVideo = { id: string; title: string };

export type YoutubeTabs = {
  /** The video in the active tab of this window. `null` off YouTube. */
  current: CurrentVideo | null;
  /**
   * Every video a tab is displaying, this window's and the others'. What the
   * title under the panel's icon reads to say whether clicking it will reach an
   * existing tab or open one (see lib/open-video.ts).
   */
  openVideoIds: ReadonlySet<string>;
};

/**
 * `null` off YouTube, or when the active tab cannot be determined.
 *
 * `readVideoId` is pure — it parses a URL, touches no DOM — and is the same
 * helper the content script uses, never duplicated here.
 */
export async function currentTabVideo(): Promise<CurrentVideo | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  const tab = tabs[0];
  const id = tab?.url ? readVideoId(tab.url) : null;
  return id === null ? null : { id, title: videoTitleFromTab(tab?.title) };
}

/** Every video some tab is showing. Only YouTube tabs have a readable URL — see TabLike, lib/video-tab.ts. */
async function openVideos(): Promise<Set<string>> {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  const ids = new Set<string>();
  for (const tab of tabs) {
    const id = tab.url ? readVideoId(tab.url) : null;
    if (id !== null) ids.add(id);
  }
  return ids;
}

/**
 * Follows the window's active tab: re-reads when another tab is activated, when
 * one closes, and on any notable change to the displayed one — navigating from
 * one video to another (YouTube is a single-page app, the tab is never reloaded)
 * or a title arriving late.
 *
 * None of these events needs an extra permission: without the "tabs" permission
 * they carry only ids. The `chrome.tabs.query` that follows supplies URL and
 * title, and only for tabs covered by a host permission — exactly the YouTube
 * tabs (see TabLike, lib/video-tab.ts).
 *
 * Both values are kept BY VALUE, not by identity: onUpdated fires for a great
 * many changes that leave the answer identical, and a fresh object each time
 * would re-render the whole panel — tab bar included — for nothing.
 */
export function useYoutubeTabs(): YoutubeTabs {
  const [current, setCurrent] = useState<CurrentVideo | null>(null);
  const [openVideoIds, setOpenVideoIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      Promise.all([currentTabVideo(), openVideos()])
        .then(([video, ids]) => {
          if (cancelled) return;
          setCurrent((prev) => (prev?.id === video?.id && prev?.title === video?.title ? prev : video));
          setOpenVideoIds((prev) => (sameIds(prev, ids) ? prev : ids));
        })
        .catch(() => {});
    };

    refresh();

    const onActivated = () => refresh();
    const onRemoved = () => refresh();
    // Filtered: onUpdated fires for every crumb of loading state, on ALL tabs.
    // Only three signals can change the answer — a new URL, a new title, a page
    // finishing its load.
    const onUpdated = (_id: number, change: chrome.tabs.OnUpdatedInfo) => {
      if (change.url !== undefined || change.title !== undefined || change.status === 'complete') refresh();
    };

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      cancelled = true;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  return { current, openVideoIds };
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}
