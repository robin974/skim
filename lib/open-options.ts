// Opens the options page, optionally ON A GIVEN TAB.
//
// `chrome.runtime.openOptionsPage()` takes no argument: it opens the page as
// is, and reuses an already-open options tab instead of stacking a second one.
// It stays the primitive of choice when there is nothing particular to show.
// The hand-built URL is reserved for the one case it cannot cover: targeting a
// tab through the hash (see lib/options-tabs.ts), which panel errors need in
// order to land on the setting at fault.
//
// That path therefore redoes by hand what openOptionsPage did for free — look
// for an open options tab before creating one. Without it, every click on
// "open settings" would stack another identical tab.
import { hashForTab, type OptionsTab } from './options-tabs';

/**
 * Never rejects: called from click handlers that cannot await a promise. A
 * failure to open is logged, never propagated — there is nothing better to
 * offer the user at that point.
 */
export function openOptions(tab?: OptionsTab): void {
  const opening = tab === undefined ? chrome.runtime.openOptionsPage() : openOnTab(tab);
  opening.catch(console.error);
}

async function openOnTab(tab: OptionsTab): Promise<void> {
  const base = chrome.runtime.getURL('options.html');
  const url = `${base}${hashForTab(tab)}`;

  // `chrome.tabs.query({})` with no filter needs no permission; a `url` filter
  // would require "tabs". Tabs whose URL stays hidden are ignored — same
  // reasoning as lib/video-tab.ts.
  const existing = (await chrome.tabs.query({}).catch(() => []))
    .find((t) => t.id != null && t.url?.startsWith(base));

  if (existing?.id != null) {
    // A URL differing only by its fragment does not reload the page: it is a
    // same-document navigation, and it fires `hashchange` — the event the
    // options page listens to in order to switch tabs (see
    // entrypoints/options/App.tsx). The open tab jumps to the right place
    // without losing what was typed in it.
    await chrome.tabs.update(existing.id, { url, active: true });
    if (existing.windowId != null) {
      // The tab may live in another window, possibly in the background:
      // activating it without focusing its window would leave the user staring
      // at a screen that did not move.
      await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
    }
    return;
  }

  await chrome.tabs.create({ url });
}
