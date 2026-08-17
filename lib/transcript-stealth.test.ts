import { describe, it, expect } from 'vitest';
import {
  planTranscriptAccess, withUserTakeover, shouldYieldToUser, stealthCss,
  STEALTH_CLASS, STEALTH_PANEL_WIDTH_PX, STEALTH_PANEL_HEIGHT_PX,
} from './transcript-stealth';

describe('shouldYieldToUser', () => {
  it('releases the panel on a real user click aimed at the transcript', () => {
    expect(shouldYieldToUser({ trusted: true, onTranscriptControl: true })).toBe(true);
  });

  // ⚠️ REGRESSION MEASURED 2026-08-12 end-to-end. Without this condition the
  // `btn.click()` the extension emits to OPEN the panel tripped the guard:
  // stealth cancelled the instant it began, panel expanded full size and never
  // closed. The feature was entirely inoperative while every unit test passed.
  it("does NOT release on the extension's own programmatic click", () => {
    expect(shouldYieldToUser({ trusted: false, onTranscriptControl: true })).toBe(false);
  });

  it('ignores a real click that is not aimed at the transcript', () => {
    expect(shouldYieldToUser({ trusted: true, onTranscriptControl: false })).toBe(false);
  });
});

describe('planTranscriptAccess', () => {
  it('opens in stealth and closes afterwards when the panel was closed', () => {
    expect(planTranscriptAccess(false)).toEqual({ stealth: true, closeAfter: true });
  });

  it('touches nothing when the user already opened the transcript', () => {
    // Hiding it would make it vanish in front of them; closing it would take
    // away a panel they did not open for us. Either way the extension would
    // perform an unrequested action — the very defect stealth mode fixes.
    expect(planTranscriptAccess(true)).toEqual({ stealth: false, closeAfter: false });
  });

  it('never closes a panel it did not open', () => {
    for (const alreadyOpen of [true, false]) {
      const plan = planTranscriptAccess(alreadyOpen);
      if (plan.closeAfter) expect(plan.stealth).toBe(true);
    }
  });
});

describe('withUserTakeover', () => {
  it('reveals the panel and cancels the automatic close', () => {
    expect(withUserTakeover({ stealth: true, closeAfter: true }))
      .toEqual({ stealth: false, closeAfter: false });
  });
});

describe('stealthCss', () => {
  const css = stealthCss();

  // ⚠️ This block locks a MEASUREMENT, not a style preference. Measured
  // 2026-08-12: a panel hidden off-screen NEVER fills — YouTube only loads its
  // content once the panel is genuinely visible on screen (0 segments after 10 s
  // off-screen; 922 segments 1.2 s after removing that one style, with no new
  // click). Any "simplification" towards an off-screen move, display:none or
  // visibility:hidden would break extraction SILENTLY.
  it('never moves the panel off-screen', () => {
    expect(css).not.toMatch(/-\d+px/);
  });

  it('uses neither display:none nor visibility:hidden', () => {
    expect(css).not.toMatch(/display\s*:\s*none/);
    expect(css).not.toMatch(/visibility\s*:\s*hidden/);
  });

  it('hides through opacity alone', () => {
    expect(css).toMatch(/opacity\s*:\s*0/);
  });

  it('gives the panel a non-zero area', () => {
    // An element with no area is never "visible on screen" in YouTube's sense,
    // which brings back the same silent failure as moving it off-screen.
    expect(STEALTH_PANEL_WIDTH_PX).toBeGreaterThan(0);
    expect(STEALTH_PANEL_HEIGHT_PX).toBeGreaterThan(0);
    expect(css).toContain(`width: ${STEALTH_PANEL_WIDTH_PX}px`);
    expect(css).toContain(`height: ${STEALTH_PANEL_HEIGHT_PX}px`);
  });

  it('lets clicks pass through to the suggestions column', () => {
    expect(css).toMatch(/pointer-events\s*:\s*none/);
  });

  it('scopes every rule under the class, so removing it undoes everything', () => {
    const selectors = css.split('}').map((b) => (b.split('{')[0] ?? '').trim()).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(0);
    for (const sel of selectors) expect(sel).toContain(`html.${STEALTH_CLASS}`);
  });
});
