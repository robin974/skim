import type { RawSegment, VideoMeta } from './messages';

/**
 * ⚠️ The ONLY place in the project holding YouTube selectors.
 *
 * Validated 2026-08-11: `ytd-transcript-segment-renderer` worked first try on a
 * 15-minute video (584 segments) and a 1-hour one (1170), with no virtualisation
 * and no scrolling needed.
 *
 * Same day, YouTube rolled out a new transcript panel generation, the
 * "view-model" one. On the page measured that day the old
 * `engagement-panel-searchable-transcript` was HIDDEN and the active panel was
 * `PAmodern_transcript_view`, built from `<transcript-segment-view-model>`,
 * where `ytd-transcript-segment-renderer` matches nothing. The rollout is
 * PARTIAL — observed, not announced — and other accounts still see the old
 * panel. Both generations therefore live here. Remove the old one
 * (`segment` / `segmentTimestamp` / `segmentText`) only after live measurements
 * confirm it is gone.
 */
export const SELECTORS = {
  /** Old transcript panel generation. */
  segment: 'ytd-transcript-segment-renderer',
  segmentTimestamp: '[class*="timestamp"]',
  segmentText: '[class*="segment-text"], yt-formatted-string',
  /**
   * New "view-model" generation, captured 2026-08-11. The text lives in a
   * `[role="text"]` span; a SIBLING `div.…TimestampA11yLabel` (not a child, in
   * the captured DOM) carries an accessibility label like "0 seconde" — see
   * `readSegmentsModern` for the defensive exclusion, kept even though the
   * current capture does not nest it.
   */
  segmentModern: 'transcript-segment-view-model',
  segmentTimestampModern: '.ytwTranscriptSegmentViewModelTimestamp',
  segmentTextModern: '[role="text"]',
  segmentA11yLabelModern: '.ytwTranscriptSegmentViewModelTimestampA11yLabel',
  video: 'video',
  /** Candidates from most precise to broadest. The first VISIBLE one wins. */
  actionBarCandidates: [
    'ytd-watch-metadata #actions #top-level-buttons-computed',
    'ytd-watch-metadata #top-level-buttons-computed',
    '#actions-inner #top-level-buttons-computed',
    'ytd-watch-metadata #actions',
    '#actions-inner',
  ] as const,
  /**
   * A dedicated container that exists ONLY to hold the "show transcript" button:
   * 2 instances on the page measured 2026-08-11, where `ytd-transcript-renderer`
   * found none. Looking for a button inside it is unambiguous and independent of
   * the interface language.
   */
  transcriptSection: 'ytd-video-description-transcript-section-renderer',
  /**
   * Candidates from most precise to broadest, first VISIBLE wins — same scheme as
   * `actionBarCandidates`. The first three target the "view-model" generation and
   * its real scroll container, confirmed live 2026-08-11: a scrollable
   * `div.ytSectionListRendererContents` inside
   * `ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]`.
   *
   * Same-day measurement: 190 segments before scrolling to the bottom AND 190
   * after — this generation does not appear to virtualise. The scroll fallback in
   * entrypoints/youtube.content.ts therefore stays a fallback, not the nominal
   * path. It stays, though: one video on one day guarantees nothing.
   */
  transcriptPanelCandidates: [
    'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"] div.ytSectionListRendererContents',
    'div.ytSectionListRendererContents',
    'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]',
    'ytd-transcript-segment-list-renderer',
    'ytd-transcript-renderer',
    '#segments-container',
    'ytd-engagement-panel-section-list-renderer[target-id*="transcript"]',
  ] as const,
  /**
   * The transcript panel identified by its STATE rather than its content, across
   * both generations: "transcript" appears in `engagement-panel-searchable-transcript`
   * (old) as well as `PAmodern_transcript_view` (new). Used by stealth mode
   * (lib/transcript-stealth.ts) and by `findExpandedTranscriptPanel`.
   *
   * Distinct from `transcriptPanelCandidates`, which looks for the SCROLLABLE
   * container (often a descendant) and keeps the first VISIBLE one. Here we want
   * the element carrying the `visibility` attribute whether it is displayed or
   * not — precisely what stealth mode makes undecidable by eye.
   */
  transcriptPanelStateful: 'ytd-engagement-panel-section-list-renderer[target-id*="transcript"]',
  /**
   * Container of the engagement panels in the right-hand column. Measured
   * 2026-08-12: it goes from 0 to 883 px tall when the transcript opens, pushing
   * the suggested videos down. Stealth mode returns it to zero height to cancel
   * that shift.
   */
  engagementPanelsContainer: '#panels',
  title: 'h1.ytd-watch-metadata yt-formatted-string, h1.ytd-watch-metadata',
  channel: 'ytd-channel-name a, ytd-channel-name #text',
  /**
   * A SIBLING button already in the action bar (share, download, …), used to
   * ADOPT its metrics rather than guess fixed pixels — see
   * `readActionButtonMetrics`. Same pattern as `transcriptButtonCandidates`: a
   * `<button>` or `<tp-yt-paper-button>` can live in the light DOM even under a
   * Polymer/Lit component (`yt-button-shape`).
   *
   * The first one found INSIDE the action bar wins. The "first visible among
   * candidates" scheme is unnecessary here: `findActionBar` already resolved a
   * single visible container, so any button it holds is visible too.
   */
  actionBarButtonCandidates: 'button, tp-yt-paper-button, yt-button-shape button',
  description: '#description-inline-expander, ytd-text-inline-expander',
  transcriptButtonCandidates: 'button, tp-yt-paper-button',
  /**
   * Container for the WATCHED video's metadata. Candidates from most precise to
   * broadest, first VISIBLE wins, scanning EVERY match of each selector.
   *
   * Every SUGGESTED video in the right-hand column carries its own
   * `ytd-channel-name`, and since YouTube is a SPA, a stale subtree from an
   * earlier internal navigation can carry another, hidden one. `SELECTORS.channel`
   * alone, queried over the whole document, therefore picks the first match in
   * DOM order — not necessarily the watched video's. Observed live 2026-08-12: on
   * a video from the "Ruben Tech" channel, `readVideoMeta` returned "franceinfo",
   * a suggested channel appearing before `ytd-watch-metadata` in the DOM.
   */
  metadataContainerCandidates: [
    'ytd-watch-metadata',
    '#above-the-fold',
    'ytd-watch-flexy #primary-inner',
  ] as const,
} as const;

/** Past this, the description adds noise rather than context. */
const MAX_DESCRIPTION = 1000;

/** Labels of the "show transcript" button, across interface languages. */
const TRANSCRIPT_LABELS = /transcription|transcript|transkript|trascrizione|transcripción/i;
/**
 * Labels of a CLOSING control. Captured 2026-08-11: "Fermer la transcription"
 * matches `TRANSCRIPT_LABELS` too, since it contains the word "transcription".
 * Testing the label alone therefore cannot tell an action from its opposite, and
 * without this exclusion a page where the close button comes first would have
 * the extension click "close" instead of "open".
 */
const CLOSE_LABELS = /fermer|close|schließen|chiudi|cerrar|masquer|hide/i;
/** An explicit opening verb: resolves the ambiguity of the bare "transcript" label. */
const SHOW_VERBS = /afficher|show|voir|open|anzeigen|mostra|mostrar/i;
/**
 * The bare word "transcript", with no verb, is itself ambiguous: captured
 * 2026-08-11, a generic header button carries that label alone and is not the
 * opening control. Used only as a last resort, when no candidate carries an
 * opening verb.
 */
const BARE_TRANSCRIPT_LABEL = /^(transcription|transcript|transkript|trascrizione|transcripción)$/i;

export function readVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
    const v = u.searchParams.get('v');
    if (v) return v;
    const short = u.pathname.match(/^\/shorts\/([^/?]+)/);
    return short?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Normalises text pulled from the DOM: any whitespace run — including the
 * non-breaking space U+00A0, which YouTube inserts liberally in the new panel
 * generation — becomes a single ASCII space, with a final `trim()`.
 *
 * JavaScript's `\s` already covers U+00A0, so no explicit non-breaking character
 * is needed in the class. The replace collapses INTERNAL runs as well as leading
 * and trailing ones; `String.trim()` alone would only touch the latter.
 *
 * The file's only whitespace normalisation, shared with `labelOf` below: a
 * button label can carry the same runs as a transcript segment.
 */
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * An element's text, excluding every descendant matching `excludeSelector`.
 *
 * Used for the new generation's `[role="text"]` span. The accessibility label
 * (`…TimestampA11yLabel`, like "0 seconde") is a SIBLING of that span in the
 * 2026-08-11 capture, so `textEl.textContent` already excludes it — but the
 * exclusion is explicit here in case a page variant nests it. A `textContent`
 * taken on the WHOLE segment would include it for certain; this function makes
 * that mistake structurally impossible rather than merely discouraged.
 */
function textExcluding(el: Element, excludeSelector: string): string {
  const clone = el.cloneNode(true) as Element;
  for (const n of clone.querySelectorAll(excludeSelector)) n.remove();
  return clone.textContent ?? '';
}

/**
 * Root to read segments from: the panel `findTranscriptPanel(doc)` resolves, but
 * ONLY if it holds at least one segment of either generation — otherwise `doc`
 * itself.
 *
 * Reading the whole document is wrong because YouTube is a SPA that keeps the
 * previous page's transcript panel hidden in the DOM after an internal
 * navigation. A stale panel and a live one each carry the full set of segments,
 * so an unscoped read adds them together and doubles every line sent to the
 * model. Measured 2026-08-12 on `fixtures/transcript--dktveTxvbQ.json`: 922
 * segments extracted for 458 distinct timestamps, each EXACTLY twice with
 * identical text — the signature of a two-panel document, not a content bug.
 *
 * Scoping the read introduced a second failure. `transcriptPanelCandidates`
 * ranks the unscoped `div.ytSectionListRendererContents` second, and YouTube
 * reuses that class for OTHER engagement panels (chapters, comments): if one of
 * those is visible, `findTranscriptPanel` can return it instead of the real
 * transcript panel. When it only drove scrolling, a wrong-but-non-null answer
 * merely scrolled the wrong node; now that it also bounds the READ, it returns
 * `[]` while the transcript exists elsewhere in the document — showing
 * `transcript-unavailable` on a video whose transcript works.
 *
 * Hence the containment check below. Reordering the candidates would not be
 * enough, since a non-transcript panel could always match a more precise
 * candidate in future; only verifying that the resolved panel REALLY contains a
 * segment is robust to YouTube reusing a class again.
 *
 * Falls back to `doc` when nothing resolves, or when the resolved panel holds no
 * segment: a doubled transcript (caught by the dedup below) beats an empty one.
 */
function readRoot(doc: Document): Document | HTMLElement {
  const panel = findTranscriptPanel(doc);
  if (!panel) return doc;
  const hasSegments =
    panel.querySelector(SELECTORS.segmentModern) !== null ||
    panel.querySelector(SELECTORS.segment) !== null;
  return hasSegments ? panel : doc;
}

/** New "view-model" generation. See the `SELECTORS` comment. */
function readSegmentsModern(root: Document | HTMLElement): RawSegment[] {
  const out: RawSegment[] = [];
  for (const el of root.querySelectorAll(SELECTORS.segmentModern)) {
    const timestampEl = el.querySelector(SELECTORS.segmentTimestampModern);
    const textEl = el.querySelector(SELECTORS.segmentTextModern);
    if (!timestampEl || !textEl) continue;
    const timestamp = normalizeWhitespace(timestampEl.textContent ?? '');
    const text = normalizeWhitespace(textExcluding(textEl, SELECTORS.segmentA11yLabelModern));
    if (timestamp && text) out.push({ timestamp, text });
  }
  return out;
}

/** Old generation. */
function readSegmentsLegacy(root: Document | HTMLElement): RawSegment[] {
  const out: RawSegment[] = [];
  for (const el of root.querySelectorAll(SELECTORS.segment)) {
    const timestampEl = el.querySelector(SELECTORS.segmentTimestamp);
    const textEl = el.querySelector(SELECTORS.segmentText);
    if (!timestampEl || !textEl) continue;
    const timestamp = normalizeWhitespace(timestampEl.textContent ?? '');
    const text = normalizeWhitespace(textEl.textContent ?? '');
    if (timestamp && text) out.push({ timestamp, text });
  }
  return out;
}

/**
 * Safety net: drops a segment whose (timestamp, text) PAIR was already seen,
 * preserving order of appearance.
 *
 * Deduplicating on the timestamp ALONE would be a distinct bug, not a
 * simplification: two genuinely different segments can share a timestamp when
 * both start within the same second, and dropping one would silently lose part
 * of the transcript. Only an identical pair is certainly a duplicate.
 *
 * Comparison runs on strings already normalised by `normalizeWhitespace`, so two
 * copies of a segment differing only by a non-breaking space are recognised as
 * the same pair.
 */
function dedupeSegments(segments: RawSegment[]): RawSegment[] {
  const seen = new Set<string>();
  const out: RawSegment[] = [];
  for (const s of segments) {
    // JSON.stringify rather than concatenation with a separator: a timestamp
    // and a text straddling a naive delimiter would otherwise produce the same
    // key for two genuinely different pairs.
    const key = JSON.stringify([s.timestamp, s.text]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Tries the new generation first, falls back to the old one when it finds
 * nothing. NEVER merge the two results: on a transitioning page where both
 * panels exist in the DOM, merging doubles every transcript line.
 *
 * The read is bounded to a single panel by `readRoot`, and the result goes
 * through `dedupeSegments` as a safety net — including on the whole-document
 * fallback, where two panels can still coexist.
 */
export function readSegments(doc: Document): RawSegment[] {
  const root = readRoot(doc);
  const modern = readSegmentsModern(root);
  if (modern.length > 0) return dedupeSegments(modern);
  return dedupeSegments(readSegmentsLegacy(root));
}

export function readDuration(doc: Document): number {
  const v = doc.querySelector<HTMLVideoElement>(SELECTORS.video);
  return v && Number.isFinite(v.duration) ? v.duration : 0;
}

const textOf = (root: Document | Element, sel: string) =>
  normalizeWhitespace(root.querySelector(sel)?.textContent ?? '');

/**
 * The WATCHED video's metadata container, or null. Same scheme as
 * `findActionBar` / `findTranscriptPanel`: candidates ordered from most precise
 * to broadest, scanning EVERY match of each selector and keeping the first
 * VISIBLE one — a stale subtree left by an earlier SPA navigation is hidden, the
 * live container is not.
 */
export function findMetadataContainer(doc: Document): HTMLElement | null {
  return firstVisibleMatch(doc, SELECTORS.metadataContainerCandidates);
}

/**
 * Metadata improves attribution: the model can name the creator from the channel
 * name and description even when they never say it out loud. MUST NOT throw — a
 * changed YouTube DOM should degrade quality, not break the summary.
 *
 * `title`, `channel` and `description` are read INSIDE `findMetadataContainer`,
 * not across the document: `SELECTORS.channel` matches one `ytd-channel-name`
 * per SUGGESTED video as well as the watched one (see
 * `metadataContainerCandidates`). Falls back to `doc` when the container does not
 * resolve: degraded metadata beats none.
 *
 * `durationSeconds` still reads the `<video>` across the whole document — the
 * player is not inside the metadata container.
 */
export function readVideoMeta(doc: Document, videoId: string): VideoMeta {
  const root = findMetadataContainer(doc) ?? doc;
  return {
    videoId,
    title: textOf(root, SELECTORS.title),
    channel: textOf(root, SELECTORS.channel),
    description: textOf(root, SELECTORS.description).slice(0, MAX_DESCRIPTION),
    durationSeconds: readDuration(doc),
  };
}

/**
 * jsdom computes no layout: `offsetParent` is always `null` there, even for a
 * perfectly visible element, so a test requiring `offsetParent !== null` would
 * fail systematically. jsdom deliberately exposes "jsdom" in its user agent to
 * allow this detection, so the requirement applies only where layout is really
 * computed.
 */
function hasLayoutEngine(doc: Document): boolean {
  const ua = doc.defaultView?.navigator.userAgent ?? '';
  return !ua.includes('jsdom');
}

/**
 * An element present in the DOM is not necessarily displayed: YouTube keeps
 * hidden menus and templates alive. Rejects:
 *  - any detached element;
 *  - any `[hidden]` or `[aria-hidden="true"]` ancestor;
 *  - any ancestor with inline `display: none`;
 *  - in a real browser only, any element without `offsetParent` — collapsed, or
 *    descended from an ancestor hidden by an external CSS rule the checks above
 *    cannot see.
 * The last check means nothing under jsdom (see `hasLayoutEngine`).
 */
function isVisible(el: HTMLElement, doc: Document): boolean {
  if (!el.isConnected) return false;
  if (el.closest('[hidden], [aria-hidden="true"]')) return false;

  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (node.style.display === 'none') return false;
  }

  if (hasLayoutEngine(doc) && el.offsetParent === null) return false;

  return true;
}

/**
 * Shared by `findMetadataContainer`, `findActionBar` and `findTranscriptPanel`:
 * walks candidate selectors from most precise to broadest and returns the first
 * VISIBLE element, scanning EVERY match of EACH selector before moving on. That
 * last part is what survives a stale subtree hidden by SPA navigation under the
 * same selector as the live one (see `findActionBar`).
 *
 * MUST NOT be reused for `findTranscriptButton`. This function requires
 * `isVisible` because its three callers return an ANCHOR POINT — a container
 * something is attached to, or read from — where a hidden candidate is a real
 * defect. `findTranscriptButton` returns a PROGRAMMATIC CLICK TARGET, and
 * `.click()` works regardless of visibility, so requiring `isVisible` there
 * would wrongly reject a real, clickable button.
 */
function firstVisibleMatch(
  doc: Document,
  candidates: readonly string[],
): HTMLElement | null {
  for (const selector of candidates) {
    for (const el of doc.querySelectorAll<HTMLElement>(selector)) {
      if (isVisible(el, doc)) return el;
    }
  }
  return null;
}

/**
 * The video page's action bar, or null.
 *
 * `#top-level-buttons-computed` alone matches ~23 elements on a YouTube page
 * (comments, suggestions, menus): an unconstrained querySelector would attach
 * the button to a hidden menu, invisible with nothing to signal it. A precise
 * anchor AND a displayed element are both required.
 *
 * EVERY match of each selector is scanned, not just the first. After an internal
 * navigation YouTube keeps the previous page hidden in the DOM, so SEVERAL
 * `ytd-watch-metadata` exist — the old hidden one first in document order, the
 * new visible one after. With a plain `querySelector`, the first (hidden) match
 * abandoned that selector entirely without ever trying the second, and the
 * button only reappeared after a reload. Selector order stays the primary
 * preference; the scan happens within one selector.
 *
 * `isVisible` applies HERE and not in `findTranscriptButton` because this
 * function returns a container the injected button is ATTACHED to. A hidden
 * container means a hidden button, with nothing to tell the user.
 * `findTranscriptButton` returns something `.click()` is called on, and
 * `HTMLElement.click()` is a direct DOM call that fires regardless of
 * visibility. Requiring visibility there rejects a real, clickable button merely
 * because it lives in a collapsed section — measured 2026-08-12 with the
 * description collapsed: real button, `offsetParent === null`, hidden ancestor,
 * height 0. Do NOT harmonise the two functions.
 */
export function findActionBar(doc: Document): HTMLElement | null {
  return firstVisibleMatch(doc, SELECTORS.actionBarCandidates);
}

export type ActionButtonMetrics = {
  height: string;
  /**
   * UNIFORM radius, never the sibling's raw value: the first button in the bar
   * is the left half of a segmented control. See `uniformRadius`.
   */
  borderRadius: string;
  fontSize: string;
  /**
   * The sibling's font family. Unlike the other three this does not fix an
   * approximate alignment but a plain mismatch: a `<button>` does not inherit
   * its parent's font, and browsers impose their own form font until a rule says
   * otherwise. Without it the injected button renders in a visibly different
   * font from the YouTube buttons beside it.
   */
  fontFamily: string;
};

/**
 * Fallback used when no sibling button is found or readable. An honest fallback
 * has to stay plausible against YouTube's real action bar, not arbitrary. Same
 * requirement for `fontFamily`: YouTube's font stack as it stands today, not
 * `inherit` — a `<button>` precisely does not inherit, so `inherit` would only
 * restate the browser default while dressing it as a choice.
 */
export const DEFAULT_ACTION_BUTTON_METRICS: ActionButtonMetrics = {
  height: '36px',
  borderRadius: '18px',
  fontSize: '14px',
  fontFamily: '"Roboto", "Arial", sans-serif',
};

/**
 * Reduces a `border-radius` to a UNIFORM value: the largest pixel radius it
 * contains. `null` when none is usable.
 *
 * Measured live 2026-08-13 on a real YouTube page: the first sibling
 * `actionBarButtonCandidates` finds is the like button, the LEFT half of the
 * like/dislike segmented control. Its computed radius is `20px 0px 0px 20px` —
 * rounded left, SQUARE right, because it continues into the right half. Copied
 * as is, it gave the injected standalone button a perfectly vertical right edge.
 *
 * So the page's value is still ADOPTED — this module never guesses pixels — but
 * only its SCALE is kept, not its shape. The shape belongs to the sibling's role
 * in a group, not to ours.
 *
 * `px` lengths only: a percentage radius (a circular icon button) does not
 * translate into a usable length for a button of a different width, and the full
 * fallback beats an invented conversion.
 */
function uniformRadius(borderRadius: string): string | null {
  const lengths = [...borderRadius.matchAll(/(-?[\d.]+)px/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n));
  if (lengths.length === 0) return null;
  return `${Math.max(...lengths)}px`;
}

/**
 * Reads height, radius, font size and font family from a SIBLING button already
 * in the action bar, so the injected button matches the page's REAL metrics
 * instead of hardcoded values. YouTube can change those metrics without notice,
 * and this project has been caught out by DOM assumptions before.
 *
 * Falls back to `DEFAULT_ACTION_BUTTON_METRICS` when no action bar resolves, when
 * it holds no sibling button, or when a read value is empty — `getComputedStyle`
 * can return an empty string before layout is computed. The sibling's visibility
 * is NOT checked: `findActionBar` already guarantees its container is visible.
 *
 * Adopts ONLY these four metrics. Colour, gradient and weight stay the
 * extension's on purpose: the button must read as OURS placed among YouTube's,
 * not as one more YouTube button. A font family is not a brand colour — two
 * different fonts side by side in one bar read as a defect, not a signature.
 *
 * Testable under jsdom: `doc.defaultView.getComputedStyle` faithfully reflects an
 * inline style even with no layout engine, so a test only needs to inject a
 * sibling button carrying one.
 */
export function readActionButtonMetrics(doc: Document): ActionButtonMetrics {
  const bar = findActionBar(doc);
  const view = doc.defaultView;
  if (!bar || !view) return DEFAULT_ACTION_BUTTON_METRICS;

  const sibling = bar.querySelector<HTMLElement>(SELECTORS.actionBarButtonCandidates);
  if (!sibling) return DEFAULT_ACTION_BUTTON_METRICS;

  const { height, borderRadius, fontSize, fontFamily } = view.getComputedStyle(sibling);
  // 'auto' can come back under jsdom for an element with no explicit height and
  // no computed layout. A real browser never returns it for a CONNECTED element
  // (CSSOM always resolves a pixel length), so treating it as invalid covers both
  // the test case and a real page whose layout is not computed yet.
  //
  // All or nothing, `fontFamily` included: mixing read values with fallback ones
  // would size the button from the page while writing it in a guessed font —
  // less predictable than the full fallback, and harder to diagnose.
  const radius = uniformRadius(borderRadius);
  if (!height || height === '0px' || height === 'auto' || !radius || !fontSize || !fontFamily) {
    return DEFAULT_ACTION_BUTTON_METRICS;
  }
  return { height, borderRadius: radius, fontSize, fontFamily };
}

/**
 * A button already in the DOM is only valid if it still lives INSIDE the action
 * bar `findActionBar` resolves now. After an SPA navigation YouTube can leave the
 * previous page's injected button alive in a hidden bar, and without this check
 * `injectButton()` would report success for a button invisible on the current
 * page.
 */
export function isInCurrentActionBar(btn: HTMLElement, doc: Document): boolean {
  const bar = findActionBar(doc);
  return bar !== null && bar.contains(btn);
}

/** An element's accessible label: its `aria-label` and its text, normalised. */
function labelOf(el: HTMLElement): string {
  return normalizeWhitespace(`${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`);
}

/**
 * Picks the best candidate from an already-filtered list (connected, never a
 * close control): a label carrying an explicit opening verb always wins, else a
 * non-bare label, else the first in encounter order.
 */
function pickBestTranscriptCandidate(
  candidates: { el: HTMLElement; label: string }[],
): HTMLElement | null {
  const withVerb = candidates.find((c) => SHOW_VERBS.test(c.label));
  if (withVerb) return withVerb.el;

  const nonBare = candidates.find((c) => !BARE_TRANSCRIPT_LABEL.test(c.label));
  if (nonBare) return nonBare.el;

  return candidates[0]?.el ?? null;
}

/**
 * The "show transcript" button, or null.
 *
 * Label text alone is not enough. On the page measured 2026-08-11 the first
 * element matching `TRANSCRIPT_LABELS` was a generic header button labelled just
 * "Transcription" — not the opening control — and "Fermer la transcription" on
 * the same page matched the SAME pattern, since it also contains the word.
 * Matching an action by its label cannot tell it from its opposite, and breaks
 * as soon as DOM order or interface language changes. Do NOT "simplify" this
 * into a querySelector by text: that is the bug this code fixes.
 *
 * The dedicated semantic container (`transcriptSection`) comes first: it exists
 * only to hold this button, so it is unambiguous and language-independent. The
 * label sweep is a fallback, with close controls excluded and a preference for a
 * candidate carrying an explicit opening verb.
 *
 * Like `findActionBar` and `findTranscriptPanel`, EVERY match of
 * `transcriptSection` is scanned (and every button of each), not just the first:
 * after an SPA navigation a stale hidden section can precede the live one and
 * may carry only a close button.
 *
 * `isVisible` is deliberately NOT required here. This returns something the
 * caller calls `.click()` on, and `HTMLElement.click()` is a direct DOM call
 * that fires regardless of visibility. Measured 2026-08-12 with the description
 * collapsed: the button is real and clickable (`offsetParent === null`, hidden
 * ancestor, height 0, but `isConnected === true`), and requiring visibility
 * wrongly rejected it, stopping the extension from opening the transcript. Only
 * `isConnected` is kept — clicking a detached node does nothing useful.
 */
export function findTranscriptButton(doc: Document): HTMLElement | null {
  const structural: { el: HTMLElement; label: string }[] = [];
  for (const section of doc.querySelectorAll<HTMLElement>(SELECTORS.transcriptSection)) {
    for (const btn of section.querySelectorAll<HTMLElement>('button')) {
      if (!btn.isConnected) continue;
      const label = labelOf(btn);
      if (CLOSE_LABELS.test(label)) continue; // never a close control
      structural.push({ el: btn, label });
    }
  }
  const structuralPick = pickBestTranscriptCandidate(structural);
  if (structuralPick) return structuralPick;

  const usable: { el: HTMLElement; label: string }[] = [];
  for (const b of doc.querySelectorAll<HTMLElement>(SELECTORS.transcriptButtonCandidates)) {
    if (!b.isConnected) continue;
    const label = labelOf(b);
    if (CLOSE_LABELS.test(label)) continue; // never a close control
    if (!TRANSCRIPT_LABELS.test(label)) continue;
    usable.push({ el: b, label });
  }

  return pickBestTranscriptCandidate(usable);
}

/**
 * The transcript's scrollable container, or null.
 *
 * `ytd-transcript-renderer` alone matched 0 elements on the page measured
 * 2026-08-11, so the scroll fallback in entrypoints/youtube.content.ts never
 * scrolled anything. Candidates ordered from most precise to broadest, same
 * scheme as `findActionBar`, including the scan of EVERY match of each selector.
 */
export function findTranscriptPanel(doc: Document): HTMLElement | null {
  return firstVisibleMatch(doc, SELECTORS.transcriptPanelCandidates);
}

/**
 * Value of an expanded engagement panel's `visibility` attribute. Captured
 * 2026-08-12 on both panel generations.
 */
const EXPANDED = 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED';

/**
 * The EXPANDED transcript panel, or null — the answer to "has the user already
 * opened the transcript themselves?" (see `planTranscriptAccess`,
 * lib/transcript-stealth.ts).
 *
 * Deliberately based on the `visibility` ATTRIBUTE rather than `isVisible()`:
 * during stealth mode the panel is fully expanded while invisible to the eye
 * (`opacity: 0`). A visual criterion would answer "closed" for an open panel, and
 * the extension would open a second one or refuse to close its own. YouTube's
 * declared state is the only reliable source here; appearance is precisely what
 * this code manipulates.
 */
export function findExpandedTranscriptPanel(doc: Document): HTMLElement | null {
  return doc.querySelector<HTMLElement>(`${SELECTORS.transcriptPanelStateful}[visibility="${EXPANDED}"]`);
}

/**
 * The close control OF the expanded transcript panel, or null. Searched inside
 * that panel rather than across the document: every engagement panel carries its
 * own, and `CLOSE_LABELS` alone does not say which. Captured 2026-08-12:
 * `aria-label="Fermer"`.
 */
export function findTranscriptCloseButton(doc: Document): HTMLElement | null {
  const panel = findExpandedTranscriptPanel(doc);
  if (!panel) return null;
  for (const btn of panel.querySelectorAll<HTMLElement>('button')) {
    if (btn.isConnected && CLOSE_LABELS.test(labelOf(btn))) return btn;
  }
  return null;
}

/**
 * Does this click target a transcript control? Feeds the "user takes over" guard
 * (see `withUserTakeover`, lib/transcript-stealth.ts): during the stealth window
 * such a click must reveal the panel immediately.
 *
 * Three paths, because there is no single transcript button: the one in the
 * section under the description, the panel's own interior (including its close
 * button), and the "show transcript" entry of the "…" menu, which is a Polymer
 * menu item rather than a `<button>`.
 *
 * `CLOSE_LABELS` is NOT excluded here, unlike in `findTranscriptButton`: clicking
 * "close transcript" is also a takeover — it says the user is acting on this
 * panel, which is enough to release it. The two functions answer different
 * questions and MUST NOT be harmonised.
 */
export function isTranscriptControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(SELECTORS.transcriptSection)) return true;
  if (target.closest(SELECTORS.transcriptPanelStateful)) return true;

  const control = target.closest<HTMLElement>(
    'button, tp-yt-paper-button, tp-yt-paper-item, ytd-menu-service-item-renderer',
  );
  return control !== null && TRANSCRIPT_LABELS.test(labelOf(control));
}
