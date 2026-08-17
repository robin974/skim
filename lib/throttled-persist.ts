// Reading a stream and persisting it are independent concerns; coupling them
// holds stream throughput hostage to storage latency. The streaming loop used to
// `await persist(...)` on EVERY chunk — roughly 333 chunks for a 61-minute
// summary, each one also rewriting the whole transcript (35 to 82 KB measured on
// this project's fixtures, see fixtures/README.md). That is ~28 MB serialised
// across 333 AWAITED writes, to produce a few thousand characters the model
// answers in under a second.
//
// This module covers the "never await, never rewrite on every chunk" half:
// `update()` never blocks the caller and writes at most once per interval;
// `flush()` guarantees that a terminal state ('done'/'error') ALWAYS reaches
// storage, with the most recent value, even when it lands inside a throttle
// window that would otherwise drop it. The other half — not reserialising the
// transcript on every incremental write — lives in lib/conversations.ts
// (saveConversationTail); orchestrator.ts assembles the two.
export type ThrottledPersist<T> = {
  /**
   * Schedules a write of `value`, at most once per interval. Never awaited by
   * the caller (no return value): that is exactly what keeps the reading loop
   * independent of storage speed.
   *
   * Several calls in quick succession schedule ONE write, that of the LAST call
   * — intermediate values exist only to be replaced. If a write is still in
   * flight when the next interval would fall due, no second write is queued:
   * the most recent value is coalesced into a single follow-up write, fired as
   * soon as the current one settles.
   */
  update: (value: T) => void;
  /**
   * Writes `value` immediately, bypassing the throttle. Reserved for terminal
   * states ('done'/'error'): they MUST always reach storage, including when the
   * last chunk lands inside a throttle window that would otherwise drop its
   * update. A throttle that loses the very last value would be worse than the
   * bug it fixes.
   *
   * Cancels any scheduled-but-unfired write (obsolete against this final
   * value), awaits any write already in flight (never two concurrent writes),
   * then writes. NEVER swallows the error of that last write: the caller
   * decides what it means (see orchestrator.ts).
   */
  flush: (value: T) => Promise<void>;
};

/**
 * `intervalMs`: see PERSIST_INTERVAL_MS in orchestrator.ts for the value in use
 * and why. This module stays agnostic of it, and is reusable for any other
 * stream needing the same throttle.
 */
export function createThrottledPersist<T>(
  write: (value: T) => Promise<void>,
  intervalMs: number,
): ThrottledPersist<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  // Wrapped in an object rather than `T | undefined`, to tell "nothing pending"
  // from "pending, value undefined" should T ever allow it.
  let pending: { value: T } | null = null;

  const runPending = () => {
    timer = null;
    if (pending === null) return;
    const { value } = pending;
    pending = null;
    inFlight = (async () => {
      try {
        await write(value);
      } catch {
        // An incremental write is never fatal to the stream that triggered it.
        // Only flush() lets an error escape, on the very last write.
      } finally {
        inFlight = null;
        // A newer value arrived DURING this write: one follow-up write, never
        // one per interval missed while storage was slow — coalesce, not queue.
        if (pending !== null) timer = setTimeout(runPending, intervalMs);
      }
    })();
  };

  return {
    update(value: T) {
      pending = { value };
      // An already-scheduled timer picks this value up when it fires (it reads
      // `pending` then, not when it was scheduled), and a write already in
      // flight schedules a new timer from its own `finally` if needed. Either
      // way, scheduling one here would duplicate.
      if (timer === null && inFlight === null) {
        timer = setTimeout(runPending, intervalMs);
      }
    },
    async flush(value: T) {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
      if (inFlight !== null) await inFlight;
      await write(value);
    },
  };
}
