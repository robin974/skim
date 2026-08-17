import type { RawSegment } from './messages';

/**
 * Coverage threshold. A last timestamp beyond 95% of the duration proves on its
 * own that the transcript was read in full. Below it, the threshold proves
 * NOTHING (see coversToEnd and withIntegrityRetry).
 */
export const INTEGRITY_RATIO = 0.95;

/**
 * How many consecutive identical readings count as proof that the page finished
 * loading its transcript (see withIntegrityRetry). Two, not one: a single
 * identical reading can land in a rendering lull — a long list still expanding,
 * a network response not yet in — and pass an unfinished read off as a complete
 * one.
 */
const STABLE_READINGS_REQUIRED = 2;

/** Accepts "m:ss" and "h:mm:ss", with optional brackets and spaces. */
export function parseTimestamp(input: string): number {
  const parts = input.replace(/[[\]\s]/g, '').split(':');
  if (parts.length < 2 || parts.length > 3) return NaN;

  // Digits only, never Number.isFinite. Number() turns "1e2" into 100, "0x10"
  // into 16, "-5" into -5 and "" into 0: a corrupted timestamp would then yield
  // a plausible number instead of NaN, and flip coversToEnd() to true on missing
  // information — exactly what the invariant forbids.
  if (!parts.every((p) => /^\d+$/.test(p))) return NaN;

  const nums = parts.map(Number);
  // [m, s]    → (0×60 + m)×60 + s
  // [h, m, s] → ((0×60 + h)×60 + m)×60 + s
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/**
 * Does the transcript reach the end of the timeline?
 *
 * This is NOT "the transcript is complete". A video ending without speech —
 * credits, music, a silent shot — has no subtitles over its last minute, so a
 * fully read transcript still stops well before the end. `false` therefore means
 * no more than "coverage alone cannot conclude"; `withIntegrityRetry` then
 * decides on another criterion.
 *
 * `true`, on the other hand, concludes: subtitles that run to the end cannot
 * come from a read truncated at the start.
 */
export function coversToEnd(segments: RawSegment[], durationSeconds: number): boolean {
  if (segments.length === 0 || !durationSeconds || durationSeconds <= 0) return false;
  const last = segments.at(-1);
  if (!last) return false;
  const lastSeconds = parseTimestamp(last.timestamp);
  if (Number.isNaN(lastSeconds)) return false;
  return lastSeconds >= durationSeconds * INTEGRITY_RATIO;
}

export type IntegrityReading = { segments: RawSegment[]; duration: number };

/** The retained reading, with the integrity verdict that goes with it (see withIntegrityRetry). */
export type IntegrityOutcome = IntegrityReading & { complete: boolean };

/** Two readings differing in neither segment count nor last timestamp: nothing appeared in between. */
function sameReading(a: IntegrityReading, b: IntegrityReading): boolean {
  return a.segments.length === b.segments.length
    && a.segments.at(-1)?.timestamp === b.segments.at(-1)?.timestamp;
}

/** A reading a verdict can rest on: at least one segment, and a genuinely known duration. */
function isUsable({ segments, duration }: IntegrityReading): boolean {
  return segments.length > 0 && duration > 0;
}

/**
 * Integrity safety net: calls `retry()` (the action that may reveal the rest of
 * the transcript, such as scrolling the panel), reads again through `read()`, up
 * to `maxAttempts` times, and returns the retained reading with its verdict.
 *
 * A summary built on a truncated transcript would be wrong with nothing marking
 * it as wrong — the worst defect this product can have. But the question this
 * code can answer is not "do the subtitles cover the whole video?": that is a
 * property of the VIDEO, and no amount of retrying makes subtitles appear over
 * silence. It is "have we read everything the page holds?" — a property of our
 * READ, the only one observable here.
 *
 * Hence two ways to conclude, in this order:
 *  - coverage suffices (`coversToEnd`): subtitles running to the end cannot come
 *    from a truncated read. The normal path, with no `retry()` at all, so it
 *    costs nothing for the vast majority of videos;
 *  - the reading stops moving: `retry()` scrolled to the bottom and two
 *    consecutive re-reads revealed nothing new (STABLE_READINGS_REQUIRED). The
 *    page has nothing left to give; what is missing at the end is missing
 *    because nobody speaks, not because we read badly.
 *
 * The coverage criterion ALONE rejected every video ending on more than 5% of
 * silence — 30 seconds of credits on a 10-minute video was enough — asserting a
 * truncation it had not observed. That is the bug the second path fixes.
 *
 * What stays rejected, and must: a reading that still changes on every attempt
 * (page still loading), and a duration that stays unknown (`isUsable`) —
 * `<video>.duration` is `NaN` while the player initialises, and `readDuration()`
 * then returns 0. Never conclude on missing information: without a known
 * duration, even a perfectly stable reading is refused.
 *
 * `read()` is called WHOLE on every attempt, segments and duration, rather than
 * freezing the duration before the loop: a duration captured too early stayed at
 * 0 and permanently rejected complete transcripts.
 */
export async function withIntegrityRetry(
  read: () => IntegrityReading,
  retry: () => Promise<void>,
  maxAttempts = 3,
): Promise<IntegrityOutcome> {
  let current = read();
  if (coversToEnd(current.segments, current.duration)) return { ...current, complete: true };

  let stableReadings = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await retry();
    const next = read();

    if (coversToEnd(next.segments, next.duration)) return { ...next, complete: true };

    stableReadings = sameReading(current, next) ? stableReadings + 1 : 0;
    current = next;

    if (stableReadings >= STABLE_READINGS_REQUIRED && isUsable(current)) {
      return { ...current, complete: true };
    }
  }

  return { ...current, complete: false };
}

/**
 * YouTube's raw segments last 1 to 2 seconds and cut sentences in half. Grouping
 * them into windows cuts timestamp overhead and gives the model continuous text.
 */
export function groupSegments(segments: RawSegment[], windowSeconds = 10): string {
  const blocks: { stamp: string; parts: string[] }[] = [];
  let anchor = -Infinity;

  for (const s of segments) {
    const text = s.text.trim();
    if (!text) continue;
    const t = parseTimestamp(s.timestamp);
    if (Number.isNaN(t)) continue;

    const current = blocks.at(-1);
    if (t - anchor >= windowSeconds || !current) {
      blocks.push({ stamp: s.timestamp.replace(/[[\]\s]/g, ''), parts: [text] });
      anchor = t;
    } else {
      current.parts.push(text);
    }
  }

  return blocks.map((b) => `[${b.stamp}] ${b.parts.join(' ')}`).join('\n');
}
