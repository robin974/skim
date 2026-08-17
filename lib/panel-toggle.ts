// A click on the toolbar icon opens the panel, and closes it when the panel it
// finds in that window is Skim's.
//
// The service worker cannot decide that alone. Chrome offers no "is my panel
// open in this window?": runtime.getContexts() does list the SIDE_PANEL
// documents, but reports windowId -1 for every one of them, so an extension
// with panels in two windows cannot tell them apart. The panel, on the other
// hand, knows its own window. So the click is broadcast and each panel answers
// for itself — the one whose window matches closes, the others ignore it.
//
// Closing is window.close() from the panel, not sidePanel.close(): the panel IS
// a document, unloading it closes the panel, and that needs neither Chrome 141
// nor a Chromium fork's side panel to reimplement the newest API.
//
// The service worker broadcasts and opens in the SAME turn, with nothing
// awaited between: sidePanel.open() is refused without the user gesture, and
// the gesture does not survive the first await (the trap the SUMMARIZE path
// pays for too, entrypoints/background.ts). The two calls do not race. Opening
// a panel that is already there changes nothing, and the close that may follow
// takes a full round trip through the panel's document, so it always lands
// after.
import type { ClosePanelEvent } from './messages';

/**
 * Whether this broadcast asks the panel of `windowId` to close.
 *
 * An unknown `windowId` never closes anything. The panel reads its window
 * asynchronously at mount, and a panel that has just opened — the very panel a
 * click was opening — MUST NOT take that click's own request for itself.
 */
export function closesPanelOf(msg: unknown, windowId: number | null): boolean {
  if (windowId == null || typeof msg !== 'object' || msg === null) return false;
  const { type, windowId: target } = msg as Partial<ClosePanelEvent>;
  return type === 'CLOSE_PANEL' && target === windowId;
}
