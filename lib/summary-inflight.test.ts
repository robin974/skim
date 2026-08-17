import { describe, it, expect, vi } from 'vitest';
import { createSummaryInFlight } from './summary-inflight';

/** A promise the test resolves when it chooses: simulates a generation still in flight. */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('createSummaryInFlight', () => {
  it('runs the task when nothing is in flight', async () => {
    const inFlight = createSummaryInFlight();
    const task = vi.fn(async () => {});

    await expect(inFlight.run('v1', task)).resolves.toBe(true);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('ignores a second request for the same video until the first finishes', async () => {
    const inFlight = createSummaryInFlight();
    const first = deferred();
    const task = vi.fn(() => first.promise);

    const running = inFlight.run('v1', task);
    await expect(inFlight.run('v1', task)).resolves.toBe(false);
    await expect(inFlight.run('v1', task)).resolves.toBe(false);
    expect(task).toHaveBeenCalledTimes(1);

    first.resolve();
    await expect(running).resolves.toBe(true);
  });

  it('never lets two different videos block each other', async () => {
    const inFlight = createSummaryInFlight();
    const first = deferred();
    const taskA = vi.fn(() => first.promise);
    const taskB = vi.fn(async () => {});

    const runningA = inFlight.run('v1', taskA);
    await expect(inFlight.run('v2', taskB)).resolves.toBe(true);
    expect(taskB).toHaveBeenCalledTimes(1);

    first.resolve();
    await runningA;
  });

  it('allows the same video to run again once finished', async () => {
    const inFlight = createSummaryInFlight();
    const task = vi.fn(async () => {});

    await inFlight.run('v1', task);
    await expect(inFlight.run('v1', task)).resolves.toBe(true);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it(
    // Without the `finally`, a video would stay blocked until the service worker
    // dies — far worse than the double click this guard fixes.
    'releases the video even when the task rejects, and lets the rejection through',
    async () => {
      const inFlight = createSummaryInFlight();
      const boom = new Error('generation failed');

      await expect(inFlight.run('v1', async () => { throw boom; })).rejects.toBe(boom);
      expect(inFlight.isRunning('v1')).toBe(false);

      const task = vi.fn(async () => {});
      await expect(inFlight.run('v1', task)).resolves.toBe(true);
      expect(task).toHaveBeenCalledTimes(1);
    },
  );

  it('isRunning reflects the state during and after a generation', async () => {
    const inFlight = createSummaryInFlight();
    const first = deferred();

    expect(inFlight.isRunning('v1')).toBe(false);
    const running = inFlight.run('v1', () => first.promise);
    expect(inFlight.isRunning('v1')).toBe(true);
    expect(inFlight.isRunning('v2')).toBe(false);

    first.resolve();
    await running;
    expect(inFlight.isRunning('v1')).toBe(false);
  });
});
