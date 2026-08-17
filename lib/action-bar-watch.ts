// Decides, for each observed batch of DOM mutations, whether the injected
// summarise button should be left alone, removed and re-injected, simply
// injected, or whether observation should stop.
//
// Injecting the button is a STATE TO MAINTAIN, not a one-shot event. On an
// internal navigation (clicking a suggested video), YouTube's old action bar is
// often still present when `yt-navigate-finish` fires: the immediate injection
// succeeds, then YouTube finishes rebuilding the bar for the new video and wipes
// the button out. Stopping observation on first success therefore loses the
// button until a full page reload — a reloaded page builds its bar once and
// never rebuilds it.

/**
 * Hot-path input (see `maintainButton`, entrypoints/youtube.content.ts). An id
 * lookup (`buttonExists`) plus the containment check (`buttonInCurrentBar`)
 * cover the vast majority of mutation batches, where nothing concerns our
 * button. `barResolved` and the cap fields cost an EXTRA bar resolution only on
 * the rare path where something must actually change.
 */
export type ActionBarWatchState = {
  /** Does an element carrying the button's id currently exist in the DOM? */
  buttonExists: boolean;
  /**
   * Does that element live INSIDE the action bar `findActionBar` resolves now?
   * Meaningless when `buttonExists` is false — pass `false` by convention, this
   * module does not re-examine it.
   */
  buttonInCurrentBar: boolean;
  /** Could an action bar be resolved on the current page? */
  barResolved: boolean;
  /** Re-injections already performed since THIS observation started. */
  reinjectionCount: number;
  /** Cap on consecutive re-injections before giving up. */
  maxReinjections: number;
};

export type ActionBarWatchAction =
  | { type: 'none' }
  | { type: 'inject' }
  | { type: 'remove-and-inject' }
  | { type: 'give-up' };

/**
 * The very first injection happens outside this module (the synchronous call at
 * the start of `watchForActionBar`), so it is not a RE-injection and does not
 * count here. The cap only bites from the first time the button must be put back
 * after disappearing or going stale.
 *
 * Without that cap, a page where YouTube rebuilt the bar in a loop would
 * re-inject in a loop, at the pace of the content script's
 * `requestAnimationFrame` throttle — frequent enough to weigh on the CPU if
 * never bounded.
 */
export function decideActionBarWatch(state: ActionBarWatchState): ActionBarWatchAction {
  const { buttonExists, buttonInCurrentBar, barResolved, reinjectionCount, maxReinjections } = state;

  if (buttonExists && buttonInCurrentBar) return { type: 'none' };

  // Nothing to do — and nothing to remove — while no bar is resolved: there is
  // nowhere to put a new button. The next mutation batch tries again;
  // `WATCH_TIMEOUT_MS` in the content script bounds how long we keep trying.
  if (!barResolved) return { type: 'none' };

  if (reinjectionCount >= maxReinjections) return { type: 'give-up' };

  if (buttonExists) return { type: 'remove-and-inject' };
  return { type: 'inject' };
}
