import { describe, it, expect } from 'vitest';
import { parseTimestamp, formatTimestamp, coversToEnd, groupSegments, withIntegrityRetry } from './transcript';
import type { RawSegment } from './messages';

describe('parseTimestamp', () => {
  it('lit le format m:ss', () => expect(parseTimestamp('0:00')).toBe(0));
  it('lit les minutes et secondes', () => expect(parseTimestamp('12:04')).toBe(724));
  it('lit le format h:mm:ss', () => expect(parseTimestamp('1:00:21')).toBe(3621));
  it('tolerates spaces and brackets', () => expect(parseTimestamp(' [2:30] ')).toBe(150));
  it('returns NaN on unreadable input', () => expect(parseTimestamp('abc')).toBeNaN());
  // Number() would turn these into plausible numbers, enough to flip
  // coversToEnd() to true on a corrupted transcript.
  it('rejette la notation scientifique', () => expect(parseTimestamp('1e2:00')).toBeNaN());
  it('rejects hexadecimal', () => expect(parseTimestamp('0x10:00')).toBeNaN());
  it('rejects negative values', () => expect(parseTimestamp('-5:00')).toBeNaN());
  it('rejette les parties vides', () => {
    expect(parseTimestamp('::')).toBeNaN();
    expect(parseTimestamp('5:')).toBeNaN();
    expect(parseTimestamp(':30')).toBeNaN();
  });
});

describe('formatTimestamp', () => {
  it('formate sous une heure', () => expect(formatTimestamp(724)).toBe('12:04'));
  it('formats past one hour', () => expect(formatTimestamp(3621)).toBe('1:00:21'));
});

const seg = (t: string, text: string): RawSegment => ({ timestamp: t, text });

// `coversToEnd` answers ONE question: do the subtitles run to the end of the
// timeline? `false` does not mean truncated — a silent ending produces exactly
// that on a complete transcript. `withIntegrityRetry` decides in that case.
describe('coversToEnd', () => {
  // Measured 2026-08-11: last segment at 1:00:21 on a 61-minute video.
  it('accepts the measured real case', () => {
    expect(coversToEnd([seg('0:00', 'a'), seg('1:00:21', 'b')], 3660)).toBe(true);
  });
  it('draws no conclusion from a transcript stopping halfway', () => {
    expect(coversToEnd([seg('0:00', 'a'), seg('30:00', 'b')], 3660)).toBe(false);
  });
  it('accepte exactement au seuil de 95 %', () => {
    expect(coversToEnd([seg('95:00', 'x')], 6000)).toBe(true);
  });
  it('draws no conclusion just below the threshold', () => {
    expect(coversToEnd([seg('94:00', 'x')], 6000)).toBe(false);
  });
  it('draws no conclusion from an empty list', () => expect(coversToEnd([], 600)).toBe(false));
  it('never concludes on a zero or unknown duration', () => {
    expect(coversToEnd([seg('0:10', 'x')], 0)).toBe(false);
  });

  it(
    // Guarantees that `readSegments`' deduplication (lib/youtube-dom.ts) cannot
    // break this guard: `coversToEnd` reads only the LAST timestamp, never
    // `segments.length`. One segment carrying the right last timestamp must
    // therefore suffice exactly like a long list ending on the same one.
    'depends only on the last timestamp, never on the segment count',
    () => {
      const lastTimestamp = seg('1:00:21', 'b');
      const many = [seg('0:00', 'a'), seg('0:00', 'a'), lastTimestamp, lastTimestamp, lastTimestamp];
      const one = [lastTimestamp];

      // Same verdict despite very different segment counts (5 vs 1): only the
      // last timestamp matters.
      expect(coversToEnd(many, 3660)).toBe(true);
      expect(coversToEnd(one, 3660)).toBe(true);

      // Conversely, a long list does not rescue an insufficient last timestamp:
      // quantity never compensates.
      const manyButTruncated = [seg('0:00', 'a'), seg('0:01', 'b'), seg('0:02', 'c'), seg('30:00', 'd')];
      expect(coversToEnd(manyButTruncated, 3660)).toBe(false);
    },
  );
});

describe('withIntegrityRetry', () => {
  it(
    // A regression found 2026-08-12: the duration was read ONCE before the retry
    // loop. `<video>.duration` is often `NaN` — so `readDuration()` returns 0 —
    // while the player initialises, and a duration frozen at 0 fails the integrity
    // check on every attempt even when the transcript is in fact complete. Here
    // `read()` simulates that sequence: unknown duration (0) on the first read,
    // valid afterwards. This test would fail against an implementation that reads
    // the duration once, before the loop.
    'becomes complete when the duration was unknown (0) on the first read and valid afterwards',
    async () => {
      const segments = [seg('0:00', 'a'), seg('0:59', 'b')]; // dernier timestamp : 59 s
      let calls = 0;
      const read = () => {
        calls += 1;
        return { segments, duration: calls === 1 ? 0 : 60 }; // 59 >= 60*0.95=57 once the duration is known
      };
      let retries = 0;
      const retry = async () => {
        retries += 1;
      };

      const result = await withIntegrityRetry(read, retry);

      expect(result.complete).toBe(true);
      expect(calls).toBeGreaterThanOrEqual(2); // the duration really was re-read after the first failure
      expect(retries).toBe(1); // one attempt sufficed once the duration was known
    },
  );

  it(
    // The bug fixed: a video with a silent ending — credits, music, a wordless
    // shot — has no subtitles over its last minute. Its transcript is complete
    // all the same, nothing will ever add to it, and the coverage threshold
    // alone rejected it as truncated. Here the read stops moving despite the
    // retries: that is the proof everything was read.
    'silent ending: a read that stops moving is complete, even far below the coverage threshold',
    async () => {
      const segments = [seg('0:00', 'a'), seg('7:30', 'b')]; // 450 s of 600 s: 75%, well below 95%
      const read = () => ({ segments, duration: 600 });
      let retries = 0;
      const retry = async () => {
        retries += 1;
      };

      const result = await withIntegrityRetry(read, retry);

      expect(result.complete).toBe(true);
      expect(result.segments).toEqual(segments);
      expect(retries).toBe(2); // STABLE_READINGS_REQUIRED: two identical re-reads, not one
    },
  );

  it(
    // The second path must not become a back door: while the read still changes,
    // the page has not finished loading and nothing supports claiming everything
    // was read. Attempts exhausted means refusal.
    'a read still changing on every attempt stays incomplete',
    async () => {
      let calls = 0;
      // Every read brings one more segment, indefinitely.
      const read = () => {
        calls += 1;
        return {
          segments: Array.from({ length: calls }, (_, i) => seg(`0:0${i}`, `s${i}`)),
          duration: 600,
        };
      };
      let retries = 0;
      const retry = async () => {
        retries += 1;
      };

      const result = await withIntegrityRetry(read, retry);

      expect(result.complete).toBe(false);
      expect(retries).toBe(3); // the default maxAttempts, fully exhausted
    },
  );

  it(
    // One identical re-read is not enough: it can land in a rendering lull. Here
    // the read repeats once (stable = 1), then changes (counter reset), then
    // repeats once more — never twice in a row before attempts run out.
    'does not conclude on one identical re-read: the stability counter resets whenever the read changes',
    async () => {
      const early = [seg('0:00', 'a')];
      const later = [seg('0:00', 'a'), seg('1:00', 'b')];
      let calls = 0;
      const read = () => {
        calls += 1;
        return { segments: calls <= 2 ? early : later, duration: 600 };
      };
      let retries = 0;
      const retry = async () => {
        retries += 1;
      };

      const result = await withIntegrityRetry(read, retry);

      expect(result.complete).toBe(false);
      expect(retries).toBe(3);
    },
  );

  it(
    // What scrolling is meant to produce: the retry reveals the rest of the list,
    // which then covers the end of the video.
    'concludes through coverage when a retry reveals the rest of the transcript',
    async () => {
      let calls = 0;
      const read = () => {
        calls += 1;
        return {
          segments: calls === 1 ? [seg('0:00', 'a')] : [seg('0:00', 'a'), seg('9:55', 'b')],
          duration: 600,
        };
      };
      let retries = 0;
      const retry = async () => {
        retries += 1;
      };

      const result = await withIntegrityRetry(read, retry);

      expect(result.complete).toBe(true);
      expect(retries).toBe(1);
    },
  );

  it('fails closed when the duration stays unknown (0) after every attempt', async () => {
    // Even a perfectly stable read cannot conclude without a known duration:
    // never accept a read on missing information.
    const segments = [seg('0:00', 'a'), seg('0:59', 'b')];
    const read = () => ({ segments, duration: 0 }); // never becomes known
    let retries = 0;
    const retry = async () => {
      retries += 1;
    };

    const result = await withIntegrityRetry(read, retry);

    expect(result.complete).toBe(false);
    expect(retries).toBe(3);
  });

  it('fails closed on an empty but stable list: never a summary built on nothing', async () => {
    const read = () => ({ segments: [], duration: 600 });
    let retries = 0;
    const retry = async () => {
      retries += 1;
    };

    const result = await withIntegrityRetry(read, retry);

    expect(result.complete).toBe(false);
    expect(retries).toBe(3);
  });

  it("never calls retry() when the first read already covers the end", async () => {
    const segments = [seg('1:00:21', 'b')];
    const read = () => ({ segments, duration: 3660 });
    let retries = 0;
    const retry = async () => {
      retries += 1;
    };

    const result = await withIntegrityRetry(read, retry);

    expect(result.complete).toBe(true);
    expect(retries).toBe(0);
  });
});

describe('groupSegments', () => {
  it('groups within a 10 s window under a single timestamp', () => {
    const out = groupSegments(
      [seg('0:00', 'Il se passe'), seg('0:02', 'un truc'), seg('0:04', 'bizarre')],
      10,
    );
    expect(out).toBe('[0:00] Il se passe un truc bizarre');
  });

  it('opens a new block past the window', () => {
    const out = groupSegments([seg('0:00', 'un'), seg('0:12', 'deux')], 10);
    expect(out.split('\n')).toEqual(['[0:00] un', '[0:12] deux']);
  });

  it('ignore les segments vides', () => {
    expect(groupSegments([seg('0:00', 'a'), seg('0:01', '  ')], 10)).toBe('[0:00] a');
  });

  it('returns an empty string for empty input', () => {
    expect(groupSegments([], 10)).toBe('');
  });
});
