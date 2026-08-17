// Resuming a summary after configuration: when runSummary fails for lack of a
// key, remember WHAT to restart and WHERE (the original YouTube tab), so the
// options page can restart it without the user hunting down their tab and
// clicking again.
//
// chrome.storage.session rather than .local: this only means something for the
// current browsing session — the tab may already be closed — and MUST NOT
// survive a browser restart.
export type PendingResume = { videoId: string; tabId: number };

const KEY = 'pendingResume';

export async function rememberPendingResume(pending: PendingResume): Promise<void> {
  await chrome.storage.session.set({ [KEY]: pending });
}

/** Reads the pending entry, then deletes it: a resume MUST fire only once. */
export async function takePendingResume(): Promise<PendingResume | null> {
  const raw = await chrome.storage.session.get(KEY);
  const pending = (raw[KEY] as PendingResume | undefined) ?? null;
  if (pending) await chrome.storage.session.remove(KEY);
  return pending;
}
