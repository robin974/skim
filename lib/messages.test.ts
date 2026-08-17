import { describe, it, expect } from 'vitest';
import type { Msg, TranscriptResult } from './messages';

describe('message contract', () => {
  it('a failed TranscriptResult carries a reason', () => {
    const r: TranscriptResult = { ok: false, reason: 'no-panel' };
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no-panel');
  });

  it('a SUMMARIZE message may omit the metadata', () => {
    const m: Msg = { type: 'SUMMARIZE', videoId: 'abc123' };
    expect(m.type).toBe('SUMMARIZE');
  });

  // The panel's regenerate button reuses SUMMARIZE with this flag rather than a
  // new message type — see runSummary (lib/orchestrator.ts) for what it changes.
  it('a SUMMARIZE message may carry the regenerate flag', () => {
    const m: Msg = { type: 'SUMMARIZE', videoId: 'abc123', regenerate: true };
    expect(m.type).toBe('SUMMARIZE');
    if (m.type === 'SUMMARIZE') expect(m.regenerate).toBe(true);
  });
});
