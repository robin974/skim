import { describe, it, expect } from 'vitest';
import { decideActionBarWatch, type ActionBarWatchState } from './action-bar-watch';

/** Baseline: button present and valid, nothing to do. Each test changes only what it exercises. */
const base: ActionBarWatchState = {
  buttonExists: true,
  buttonInCurrentBar: true,
  barResolved: true,
  reinjectionCount: 0,
  maxReinjections: 5,
};

describe('decideActionBarWatch', () => {
  it('button present in the current bar: nothing to do', () => {
    expect(decideActionBarWatch(base)).toEqual({ type: 'none' });
  });

  it(
    // The exact bug: an injection already succeeded once, then YouTube wiped
    // the button while rebuilding the bar. The next mutation batch must put it
    // back rather than consider the matter settled.
    'button gone after a successful injection, bar resolved: re-injects',
    () => {
      const state: ActionBarWatchState = { ...base, buttonExists: false, buttonInCurrentBar: false };
      expect(decideActionBarWatch(state)).toEqual({ type: 'inject' });
    },
  );

  it(
    // A stale subtree from an earlier SPA navigation can carry a button with the
    // same id, outside the bar `findActionBar` resolves now. It must be removed
    // before the right one goes back, not simply joined by a second.
    'button present but attached to a stale bar: removes then re-injects',
    () => {
      const state: ActionBarWatchState = { ...base, buttonInCurrentBar: false };
      expect(decideActionBarWatch(state)).toEqual({ type: 'remove-and-inject' });
    },
  );

  it('no bar resolved and no button: nothing to do, there is nowhere to anchor', () => {
    const state: ActionBarWatchState = {
      ...base, buttonExists: false, buttonInCurrentBar: false, barResolved: false,
    };
    expect(decideActionBarWatch(state)).toEqual({ type: 'none' });
  });

  it('no bar resolved with a stale button present: nothing to do either', () => {
    const state: ActionBarWatchState = { ...base, buttonInCurrentBar: false, barResolved: false };
    expect(decideActionBarWatch(state)).toEqual({ type: 'none' });
  });

  describe('re-injection cap', () => {
    it('below the cap: re-injects normally', () => {
      const state: ActionBarWatchState = {
        ...base, buttonExists: false, buttonInCurrentBar: false, reinjectionCount: 4, maxReinjections: 5,
      };
      expect(decideActionBarWatch(state)).toEqual({ type: 'inject' });
    });

    it('at the cap: gives up instead of re-injecting, avoiding a CPU-burning loop', () => {
      const state: ActionBarWatchState = {
        ...base, buttonExists: false, buttonInCurrentBar: false, reinjectionCount: 5, maxReinjections: 5,
      };
      expect(decideActionBarWatch(state)).toEqual({ type: 'give-up' });
    });

    it('past the cap: still gives up', () => {
      const state: ActionBarWatchState = {
        ...base, buttonExists: false, buttonInCurrentBar: false, reinjectionCount: 9, maxReinjections: 5,
      };
      expect(decideActionBarWatch(state)).toEqual({ type: 'give-up' });
    });

    it('applies the cap to the stale-button case too', () => {
      const state: ActionBarWatchState = {
        ...base, buttonInCurrentBar: false, reinjectionCount: 5, maxReinjections: 5,
      };
      expect(decideActionBarWatch(state)).toEqual({ type: 'give-up' });
    });
  });

  it(
    // The in-flight guard lives in the service worker (lib/summary-inflight.ts,
    // tested there), so a replaced button has no state to restore: the decision
    // depends on the DOM alone.
    'a replacement carries no state to restore, whatever the context',
    () => {
      const state: ActionBarWatchState = { ...base, buttonExists: false, buttonInCurrentBar: false };
      expect(decideActionBarWatch(state)).toEqual({ type: 'inject' });
      expect(decideActionBarWatch({ ...base, buttonInCurrentBar: false })).toEqual({ type: 'remove-and-inject' });
    },
  );
});
