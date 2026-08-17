// Prevents two concurrent generations for the SAME video.
//
// The guard lives in the service worker rather than in the injected button's
// UI. The button is not the only trigger — "Regenerate" in the panel,
// RESUME_SUMMARY once a key is configured — and two YouTube tabs showing the
// same video share no UI state. The worker is the one point every request
// crosses.

/**
 * Registry of in-flight generations, keyed by videoId.
 *
 * Per video, not one global flag: two tabs can show two different videos, and a
 * summary running for one is no reason to refuse the other.
 *
 * Deliberately not persisted. Chrome kills the service worker after ~30s idle
 * and this state dies with it, which is correct — no worker, no generation in
 * flight. A persisted registry would outlive the worker and block a video that
 * nothing is working on.
 */
export type SummaryInFlight = {
  /** Is a generation running for this video? */
  isRunning: (videoId: string) => boolean;
  /**
   * Runs `task` for `videoId`, unless one is already running for that same
   * video — in which case nothing starts. Returns `true` when the task ran,
   * `false` when the request was dropped.
   *
   * Resolves only once the task settles: the message listener MUST NOT answer
   * before the work is done.
   */
  run: (videoId: string, task: () => Promise<void>) => Promise<boolean>;
};

export function createSummaryInFlight(): SummaryInFlight {
  const running = new Set<string>();

  return {
    isRunning: (videoId) => running.has(videoId),

    async run(videoId, task) {
      if (running.has(videoId)) return false;
      running.add(videoId);
      try {
        await task();
      } finally {
        // `finally`, never a bare `await`: startSummary already turns every
        // exception into an ERROR event, but relying on that bets that no
        // future path ever lets a rejection escape. A video blocked until the
        // service worker dies would be worse than the bug this guard fixes.
        running.delete(videoId);
      }
      return true;
    },
  };
}
