// Finds the tab displaying a given video, from a list of tabs
// (chrome.tabs.query).
//
// Reading a transcript needs the CONTENT script, and reaching a content script
// needs a `tabId` — chrome.runtime.sendMessage never reaches one. The service
// worker gets that `tabId` from `sender.tab`, which is only set for messages
// sent BY a content script: the "✦ Résumer" button injected under the video.
// Anything sent from an extension page — the panel's "Regenerate", a follow-up
// question, a resume from the options page — carries no tab. Without this
// lookup the request leaves with no recipient, no transcript is ever read, and
// the summary fails as if the video had no subtitles.
//
// Choosing among several candidate tabs does not need to be clever: the
// transcript depends on the VIDEO, not on the tab showing it. Preferring the
// active tab only targets the one the user is actually watching, the most
// likely to be fully loaded; it does not yield different content.
import { readVideoId } from './youtube-dom';

/**
 * The subset of `chrome.tabs.Tab` actually used. `url` is optional on the
 * platform side: Chrome only fills it for tabs covered by a host permission
 * (here `https://*.youtube.com/*`, see wxt.config.ts) or by the "tabs"
 * permission, which this project does not request. Tabs whose URL stays hidden
 * are therefore ignored — by construction they are never YouTube tabs.
 */
export type TabLike = { id?: number; url?: string; active?: boolean; title?: string; windowId?: number };

/**
 * The video title, taken from the TAB TITLE.
 *
 * This route rather than a round trip to the content script (GET_META): the
 * panel already queries chrome.tabs to identify the displayed video (see
 * useSummary.ts), and `title` arrives in the same response with no extra
 * permission — Chrome fills it for tabs covered by a host permission, exactly
 * like `url`. One more message to a possibly dormant content script, for
 * information already in hand, would be pure waste.
 *
 * Strips two decorations YouTube adds itself: the leading notification counter
 * ("(3)") and the trailing " - YouTube". Returns an empty string when nothing
 * useful remains, so the caller shows its button untitled rather than quoting
 * an empty title.
 */
export function videoTitleFromTab(tabTitle: string | undefined): string {
  if (!tabTitle) return '';
  return tabTitle
    .replace(/^\(\d+\)\s*/, '')
    // The `^|separator` alternation covers both real forms: a video title
    // ("Title - YouTube") and a page not loaded yet ("YouTube" alone, before
    // the video title arrives). The separator is REQUIRED anywhere but at the
    // start, so a title legitimately ending in that word keeps it.
    .replace(/(^|\s*[-–]\s*)YouTube\s*$/, '')
    .trim();
}

/**
 * `id` of the tab displaying `videoId`, or `undefined` if none does.
 *
 * Prefers an active tab when several match (see the module header: a
 * reliability preference, not a content one). Ignores tabs with no usable id —
 * `chrome.tabs.TAB_ID_NONE` (-1) marks a context that is not a tab, and no
 * message can reach it.
 */
export function findVideoTabId(videoId: string, tabs: readonly TabLike[]): number | undefined {
  let firstMatch: number | undefined;

  for (const tab of tabs) {
    const { id, url } = tab;
    if (id == null || id < 0 || url == null) continue;
    if (readVideoId(url) !== videoId) continue;
    if (tab.active === true) return id;
    firstMatch ??= id;
  }

  return firstMatch;
}
