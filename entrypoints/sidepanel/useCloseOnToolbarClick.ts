// Closes this panel when the toolbar icon of ITS window is clicked, which is
// what makes that icon a toggle. See lib/panel-toggle.ts: the service worker
// cannot tell which window a panel occupies, so it broadcasts the click and the
// panel recognises its own.
import { useEffect } from 'react';
import { closesPanelOf } from '@/lib/panel-toggle';

/**
 * The window is read once, at mount: a document lives in the window that hosts
 * it and never moves. Until that read lands the panel closes on nothing, which
 * is also what keeps the click that OPENED this panel from closing it right
 * away.
 *
 * `window.close()` unloads the document, and the panel goes with it — the panel
 * has no state of its own to lose (see useSummary.ts).
 */
export function useCloseOnToolbarClick(): void {
  useEffect(() => {
    let windowId: number | null = null;
    chrome.windows.getCurrent()
      .then((w) => { windowId = w.id ?? null; })
      .catch(() => {});

    const onMessage = (msg: unknown) => {
      if (closesPanelOf(msg, windowId)) window.close();
    };

    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);
}
