// Resuming a summary after configuration. Once a key validates, the options
// page calls this: if a summary was waiting on a key, it restarts on its own,
// without the user hunting for their YouTube tab and clicking again.
import { takePendingResume } from '@/lib/pending-resume';
import type { Msg } from '@/lib/messages';

/** No-op when no resume is pending. */
export async function resumePendingSummaryIfAny(): Promise<void> {
  const pending = await takePendingResume();
  if (!pending) return;

  const msg: Msg = { type: 'RESUME_SUMMARY', videoId: pending.videoId, tabId: pending.tabId };
  // Fire and forget: the panel, already open, shows the rest through the usual
  // StreamEvents. There is nothing useful to do here if the send fails.
  await chrome.runtime.sendMessage(msg).catch(() => {});
}
