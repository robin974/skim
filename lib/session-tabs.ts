// The panel's tab bar, decided here and drawn in entrypoints/sidepanel.
//
// The bar is DERIVED from what the session has stored (lib/conversations.ts) and
// from the video the active Chrome tab displays. There is no tab state to
// persist and none to keep in step: closing a tab IS deleting a conversation,
// and the bar redraws from what is left.
import type { ConversationSummary } from './conversations';
import type { VideoMeta } from './messages';

/** The video displayed in the active tab — the shape useCurrentVideo returns. */
export type CurrentVideo = { id: string; title: string };

export type SessionTab = {
  videoId: string;
  /**
   * What the tab shows. The stored metadata's title, else the active tab's, else
   * the video id: an identifier is ugly, but it is the video, where an invented
   * title would name something that does not exist.
   */
  title: string;
  /**
   * Channel and duration for the line under the heading, `null` when nothing was
   * stored. A pinned tab has none — its video has never been read, so the panel
   * knows nothing about it beyond the tab's own title.
   */
  meta: VideoMeta | null;
  /** The summary is still being written: the tab shows a pulsing dot in place of its thumbnail. */
  generating: boolean;
  /**
   * When the conversation was first written, which is what orders the bar and
   * what the menu counts the elapsed seconds from. `0` on a pinned tab: nothing
   * has been created for it, and nothing reads this until something is.
   */
  createdAt: number;
  /**
   * The video displayed in the active YouTube tab, with no summary in this
   * session. At most one, always last, and it is the only tab closing everything
   * leaves standing — nothing is cached for it to forget.
   */
  pinned: boolean;
};

/**
 * The whole bar, oldest summary first, with the pinned tab last when there is
 * one.
 *
 * Order comes from `createdAt` and nothing else, so a generation still running
 * sits where it started rather than jumping to the end when it finishes. Ties
 * break on the video id: two conversations stamped in the same millisecond MUST
 * NOT swap places between two renders.
 *
 * A video the session has already summarised is a strip tab, never a pinned one,
 * even while it is the one being watched: it has a summary, which is what a
 * strip tab means. That is also why opening a video already summarised cannot
 * create a second tab for it.
 */
export function buildSessionTabs(
  conversations: readonly ConversationSummary[],
  current: CurrentVideo | null,
): SessionTab[] {
  const strip = [...conversations]
    .sort((a, b) => a.createdAt - b.createdAt || a.videoId.localeCompare(b.videoId))
    .map((c): SessionTab => ({
      videoId: c.videoId,
      title: c.meta?.title?.trim() || c.videoId,
      meta: c.meta,
      generating: c.status === 'streaming',
      createdAt: c.createdAt,
      pinned: false,
    }));

  if (current === null || strip.some((t) => t.videoId === current.id)) return strip;

  return [...strip, {
    videoId: current.id,
    title: current.title.trim() || current.id,
    meta: null,
    generating: false,
    createdAt: 0,
    pinned: true,
  }];
}

/**
 * The tab to display, given what the user last chose and what the bar now holds.
 *
 * The chosen tab survives as long as it exists. When it does not — closed from
 * the menu, or gone because the session was cleared — the pinned tab wins over
 * the last summary: it is the video actually in front of the user. `null` only
 * when the bar is empty, which is the panel's empty screen.
 *
 * Called on every rebuild rather than only on close, so the selection cannot
 * outlive its tab whatever removed it.
 */
export function resolveSelection(tabs: readonly SessionTab[], selected: string | null): string | null {
  if (selected !== null && tabs.some((t) => t.videoId === selected)) return selected;
  return tabs.find((t) => t.pinned)?.videoId ?? tabs.at(-1)?.videoId ?? null;
}

/**
 * The tab to activate after closing one: the NEXT tab, else the previous.
 *
 * "Next" is read from the position the closed tab held, so closing the last tab
 * falls back to the one before it and closing any other moves right. The pinned
 * tab is a candidate like any other — it sits at the end of the same list.
 *
 * Closing a tab that is not the displayed one changes nothing: `selected` is
 * returned untouched.
 */
export function neighbourAfterClose(
  tabs: readonly SessionTab[], closedId: string, selected: string | null,
): string | null {
  if (selected !== closedId) return selected;

  const index = tabs.findIndex((t) => t.videoId === closedId);
  if (index < 0) return selected;

  const remaining = tabs.filter((t) => t.videoId !== closedId);
  return remaining[index]?.videoId ?? remaining[index - 1]?.videoId ?? null;
}

/**
 * The videos "close all tabs" forgets: every summary, and only summaries.
 *
 * The pinned tab survives because there is nothing cached for it — it describes
 * the Chrome tab, not a summary — so closing it would mean closing a YouTube
 * tab the user never asked to close.
 */
export function closableTabs(tabs: readonly SessionTab[]): string[] {
  return tabs.filter((t) => !t.pinned).map((t) => t.videoId);
}
