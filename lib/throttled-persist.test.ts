// Exercises the throttle/coalescing mechanics in isolation, with a fake `write`
// entirely under the test's control — independent of chrome.storage and of real
// SSE reading. See lib/orchestrator.test.ts for the end-to-end use.
import { describe, it, expect, vi } from 'vitest';
import { createThrottledPersist } from './throttled-persist';

describe('createThrottledPersist', () => {
  it('many close-together values produce FAR fewer writes than update() calls', async () => {
    vi.useFakeTimers();
    try {
      const write = vi.fn<(v: string) => Promise<void>>(async () => {});
      const p = createThrottledPersist(write, 1000);

      // 300 close-together updates, like a real stream's chunks — none awaited by
      // the caller.
      for (let i = 0; i < 300; i++) p.update(`value-${i}`);

      // Nothing written yet: the throttle waits out the interval before its very
      // first write.
      expect(write).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000);

      // One write for 300 updates, and it carries the LAST value, never an
      // intermediate one abandoned along the way.
      expect(write).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith('value-299');
    } finally {
      vi.useRealTimers();
    }
  });

  it('flush() always writes the most recent value immediately, even inside a throttle window', async () => {
    vi.useFakeTimers();
    try {
      const write = vi.fn<(v: string) => Promise<void>>(async () => {});
      const p = createThrottledPersist(write, 1000);

      p.update('intermediate');
      // Less than a second after update(): the throttle would not have written on
      // its own yet. flush() MUST NOT wait out the interval — a throttle that
      // lost the very last value would be worse than the bug it fixes.
      await vi.advanceTimersByTimeAsync(200);
      expect(write).not.toHaveBeenCalled();

      await p.flush('final-value');

      expect(write).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith('final-value');

      // flush() cancels the timer the first update() scheduled: advancing past
      // the original interval MUST NOT fire a ghost write of the abandoned
      // intermediate value.
      await vi.advanceTimersByTimeAsync(2000);
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it(
    'a write still in flight when the next interval falls due does NOT trigger a second write: '
    + 'values arriving during it coalesce into a single follow-up write',
    async () => {
      vi.useFakeTimers();
      try {
        const resolvers: Array<() => void> = [];
        const write = vi.fn<(v: string) => Promise<void>>(
          () => new Promise<void>((resolve) => { resolvers.push(() => resolve()); }),
        );
        const p = createThrottledPersist(write, 1000);

        p.update('v1');
        await vi.advanceTimersByTimeAsync(1000);
        expect(write).toHaveBeenCalledTimes(1); // v1's write started, never resolved yet

        // While it is in flight several new values arrive and time advances well
        // past the interval — several ticks would have fired if each triggered
        // its own write.
        p.update('v2');
        await vi.advanceTimersByTimeAsync(1000);
        p.update('v3');
        await vi.advanceTimersByTimeAsync(1000);

        // Still ONE write in flight: nothing was queued.
        expect(write).toHaveBeenCalledTimes(1);

        // The in-flight write settles: exactly one FOLLOW-UP write fires, carrying
        // the last value (v3), never v2.
        resolvers[0]?.();
        await vi.advanceTimersByTimeAsync(1000);

        expect(write).toHaveBeenCalledTimes(2);
        expect(write).toHaveBeenNthCalledWith(2, 'v3');

        resolvers[1]?.();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('an incremental write error is never fatal, and never an unhandled rejection', async () => {
    vi.useFakeTimers();
    try {
      const write = vi.fn<(v: string) => Promise<void>>(async () => { throw new Error('storage unavailable'); });
      const p = createThrottledPersist(write, 1000);

      p.update('value');
      // The test not failing on an unhandled rejection is the point here.
      await vi.advanceTimersByTimeAsync(1000);

      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flush() does NOT swallow the last write\'s error: the caller decides', async () => {
    const write = vi.fn<(v: string) => Promise<void>>(async () => { throw new Error('final failure'); });
    const p = createThrottledPersist(write, 1000);

    await expect(p.flush('value')).rejects.toThrow('final failure');
  });
});
