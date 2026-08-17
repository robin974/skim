// Decides whether YouTube's native transcript panel must be opened WITHOUT the
// user seeing it, and whether it must be closed afterwards.
//
// Reading a transcript requires opening that panel. Left visible, the user sees
// an action they never asked for — they asked for a summary, not a transcript —
// and the right-hand column reorganises in front of them.
//
// ⚠️ MEASURED 2026-08-12, do not rediscover. The obvious way to hide the panel,
// moving it off-screen (`left: -20000px`), DOES NOT WORK: YouTube only loads the
// panel's content once it becomes GENUINELY visible on screen. Measured live on
// https://www.youtube.com/watch?v=-dktveTxvbQ, cold reload:
//
//   - panel expanded off-screen → 0 segments after 10 s of waiting;
//   - removing that one style, with no new click → 922 segments in 1.2 s.
//
// Hence the shape `stealthCss()` uses: the panel stays IN the viewport, in its
// natural place, and is made invisible by `opacity: 0` alone. It leaves the flow
// (`position: absolute` plus a zero-height container) so suggested videos do not
// shift. Same measurement on that shape: 461 unique segments in 1.34 s, with the
// `#panels` and first-suggestion boxes pixel-identical before and after.
//
// Do NOT "optimise" this CSS into an off-screen move, `display: none`,
// `visibility: hidden` or a zero-sized container. The failure would be SILENT —
// empty transcript, so a refused summary — and the test on `stealthCss` exists
// to catch exactly that.

import { SELECTORS } from './youtube-dom';

/** Set on `<html>`: this is what activates the rules in `stealthCss()`. */
export const STEALTH_CLASS = 'ai-recap-stealth';

/** Id of the `<style>` injected into the host page (once per page). */
export const STEALTH_STYLE_ID = 'ai-recap-stealth-style';

/**
 * Dimensions forced on the hidden panel. An EXPLICIT size is required: out of
 * the flow, the panel no longer inherits its column's width and its content
 * could size it to 0 × 0 — and an element with no area is never "visible on
 * screen" in YouTube's sense, which brings back the silent failure described
 * above. These are the values measured on 2026-08-12; they need not match the
 * real panel, only be non-zero and plausible.
 */
export const STEALTH_PANEL_WIDTH_PX = 402;
export const STEALTH_PANEL_HEIGHT_PX = 600;

/**
 * The stealth stylesheet, entirely scoped to `html.STEALTH_CLASS`: removing the
 * class undoes everything, with no inline styles to unwind element by element.
 * YouTube can replace the panel between setting and clearing, and an inline
 * style would then be lost — the panel would reappear mid-read.
 *
 * Selectors come from `SELECTORS`: lib/youtube-dom.ts is the ONLY place in the
 * project that declares YouTube selectors (see its header).
 */
export function stealthCss(): string {
  return `
html.${STEALTH_CLASS} ${SELECTORS.engagementPanelsContainer} {
  position: relative !important;
  height: 0 !important;
  overflow: visible !important;
}
html.${STEALTH_CLASS} ${SELECTORS.transcriptPanelStateful} {
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  width: ${STEALTH_PANEL_WIDTH_PX}px !important;
  height: ${STEALTH_PANEL_HEIGHT_PX}px !important;
  opacity: 0 !important;
  pointer-events: none !important;
}`;
}

export type TranscriptAccessPlan = {
  /** Hide the panel for the whole read. */
  stealth: boolean;
  /** Close it once the read is done. */
  closeAfter: boolean;
};

/**
 * GUARD 1 — "the panel was already open".
 *
 * If the user expanded the transcript themselves before clicking "✦ Résumer",
 * the extension MUST NOT touch it: not hide it (it would vanish in front of
 * them, the exact mirror of the defect being fixed) and not close it afterwards
 * (they did not open it for us). Stealth applies only to a panel the extension
 * opens ITSELF.
 *
 * Deliberate corollary: `closeAfter` is never `true` unless `stealth` is too —
 * we close only what we opened.
 */
export function planTranscriptAccess(panelAlreadyOpen: boolean): TranscriptAccessPlan {
  if (panelAlreadyOpen) return { stealth: false, closeAfter: false };
  return { stealth: true, closeAfter: true };
}

/**
 * GUARD 2 — "the user takes over".
 *
 * During the stealth window (~1.5 to 2 s measured) the user may click a
 * transcript control themselves. They would get an open but invisible panel: the
 * opposite of the point, and far more confusing than the original defect. From
 * that moment the panel is no longer ours — reveal it immediately, and above all
 * do not close it: its visibility becomes the user's business alone.
 *
 * The reveal happens in the CAPTURE phase, so BEFORE YouTube handles the click.
 * MEASURED 2026-08-12 with the panel already expanded, second click on "show
 * transcript": the panel stays expanded (10 samples over 3 s, `#panels` steady at
 * 883 px). That button is NOT a toggle, so capture-then-YouTube gives the right
 * result: the panel becomes visible and stays visible.
 *
 * The other conceivable control, "close transcript", is out of reach while
 * hidden: `pointer-events: none` lets clicks pass through the invisible panel.
 * Only the button under the description and the "…" menu entry remain reachable,
 * and both are OPENING actions.
 */
export function withUserTakeover(_plan: TranscriptAccessPlan): TranscriptAccessPlan {
  return { stealth: false, closeAfter: false };
}

/**
 * Should this click hand the panel back to the user? Two conditions, and the
 * second one is what a naive version misses.
 *
 * The extension ITSELF clicks that control to open the panel (`btn.click()`, see
 * readTranscriptInto). A guard looking only at "does this click land on a
 * transcript control?" sees its own synthetic click travel the capture phase and
 * hands the panel back at the very instant it opens it — stealth style injected
 * then class removed within the same millisecond, panel expanded full size, and
 * never closed since `closeAfter` had just dropped to false. Stealth cancelled
 * itself every single time. Measured end-to-end in the browser on 2026-08-12.
 *
 * `trusted` (`Event.isTrusted`) is the exact discriminant, not a workaround: the
 * question is "did the USER just act?", and `isTrusted` is precisely what
 * separates a real gesture from a click emitted by code. A "this one is mine"
 * flag around `btn.click()` would work today and break at the next programmatic
 * click added elsewhere.
 *
 * Accepted trade-off: an accessibility tool or another extension opening the
 * transcript through a synthetic click would not take the panel from us. That is
 * the lesser evil — the alternative makes the feature inoperative.
 */
export function shouldYieldToUser(event: { trusted: boolean; onTranscriptControl: boolean }): boolean {
  return event.trusted && event.onTranscriptControl;
}
