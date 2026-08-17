import {
  readVideoId, readSegments, readDuration, findTranscriptButton, readVideoMeta, findActionBar,
  findTranscriptPanel, isInCurrentActionBar, readActionButtonMetrics, SELECTORS,
  findExpandedTranscriptPanel, findTranscriptCloseButton, isTranscriptControl,
} from '@/lib/youtube-dom';
import { withIntegrityRetry } from '@/lib/transcript';
import { decideActionBarWatch } from '@/lib/action-bar-watch';
import {
  planTranscriptAccess, withUserTakeover, shouldYieldToUser, stealthCss,
  STEALTH_CLASS, STEALTH_STYLE_ID, type TranscriptAccessPlan,
} from '@/lib/transcript-stealth';
import type { Msg, TranscriptResult } from '@/lib/messages';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',

  main() {
    watchForActionBar();
    // YouTube is a SPA: the URL changes without a reload, and the new video
    // needs a fresh injection attempt.
    document.addEventListener('yt-navigate-finish', () => {
      // A stealth session still in flight belongs to the video being LEFT, so
      // release it without closing anything (`close: false`). The new page's
      // panel, if any, is not ours, and closing it would be exactly the
      // unrequested action this mechanism exists to avoid. What MUST be
      // guaranteed is never leaving the stealth style on the next page.
      void endStealth({ close: false });
      watchForActionBar();
    });

    chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
      if (msg.type === 'GET_TRANSCRIPT') {
        (async () => {
          try {
            const { result, finish } = await extractTranscript();
            // The response goes out BEFORE cleanup, deliberately: closing the
            // panel and removing the stealth style cost ~600 ms (measured
            // 2026-08-12 on a ~2.2 s full cycle) that would otherwise sit
            // entirely on the generation's critical path — the service worker
            // waits for this response to build the prompt. Nothing in the
            // cleanup can change the result already read.
            sendResponse(result);
            void finish();
          } catch {
            // Without this net an unexpected exception would never answer, and
            // `ask()` would wait service-worker side until its own timeout.
            // 'no-segments' is the honest reason: the panel could not be read.
            sendResponse({ ok: false, reason: 'no-segments' } satisfies TranscriptResult);
          }
        })();
        return true; // keeps the message channel open
      }
      if (msg.type === 'GET_META') {
        sendResponse(readVideoMeta(document, msg.videoId));
        return true;
      }
      if (msg.type === 'SEEK') {
        // The video this tab shows MUST be the one the timestamp belongs to.
        // The panel displays one tab of the session at a time and that need not
        // be the video playing here (see lib/session-tabs.ts): without this
        // check, a timestamp read in one summary would scrub a different video,
        // and answering `ok` would suppress the "open it in a new tab" fallback
        // that is the right answer here.
        const showing = readVideoId(location.href);
        const v = showing === msg.videoId ? document.querySelector<HTMLVideoElement>(SELECTORS.video) : null;
        if (v) { v.currentTime = msg.seconds; v.play?.(); }
        sendResponse({ ok: Boolean(v) }); // never report success with no player
        return true;
      }
      return false;
    });
  },
});

const BTN_ID = 'ai-recap-btn';
const BTN_CLASS = 'ai-recap-btn';
const STYLE_ID = 'ai-recap-style';

const LABEL = '✦ Résumer';
const ARIA_LABEL = 'Résumer cette vidéo avec l’IA';

/**
 * Injects a stylesheet scoped to `.${BTN_CLASS}`, once per page. A `<style>` a
 * content script injects into the HOST page is not subject to the manifest V3
 * CSP that forbids inline `<style>` in the EXTENSION's own pages, which is what
 * makes :hover/:active expressible here where `btn.style.cssText` could not.
 *
 * `flex: 0 0 auto` and `white-space: nowrap` are defensive, not corrective. The
 * action bar is a flex container and its `ytd-menu-renderer` parent carries
 * `overflow-x: auto` (measured 2026-08-13), so on a narrow window YouTube lets
 * its buttons compress and the row scroll. Our button's height is pinned to its
 * neighbours' (see readActionButtonMetrics), and a label breaking onto two lines
 * or a compressed width would both be illegible there.
 */
function ensureStylesInjected() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${BTN_CLASS} {
      margin-left: 8px;
      padding: 0 16px;
      border: none;
      background: linear-gradient(135deg, #4f7cff, #9b5cff);
      color: #fff;
      font-weight: 500;
      cursor: pointer;
      transition: transform .12s ease, box-shadow .12s ease;
      box-shadow: 0 1px 3px rgba(0, 0, 0, .2);
      flex: 0 0 auto;
      white-space: nowrap;
    }
    .${BTN_CLASS}:hover {
      box-shadow: 0 2px 8px rgba(79, 124, 255, .5);
      transform: translateY(-1px);
    }
    .${BTN_CLASS}:active {
      transform: translateY(0);
      box-shadow: 0 1px 2px rgba(0, 0, 0, .25);
    }
  `;
  document.head.appendChild(style);
}

/**
 * How long to observe before giving up: a page with no action bar MUST NOT be
 * watched indefinitely.
 *
 * The window has to cover more than the first injection — YouTube can rebuild
 * the bar later (subscription state, like counter, membership badge), and those
 * fragments do not necessarily land within the same few milliseconds as
 * `yt-navigate-finish`.
 *
 * The button carries no visual busy state, on purpose: the guard against a
 * second run lives in the service worker (lib/summary-inflight.ts), the only
 * point every request crosses. If a visual state is ever reintroduced here, it
 * MUST NOT change the button's WIDTH — a wider label shifts YouTube's
 * neighbouring buttons on every click.
 */
const WATCH_TIMEOUT_MS = 45_000;

/**
 * Cap on consecutive re-injections within one observation (applied by
 * `decideActionBarWatch`, lib/action-bar-watch.ts).
 *
 * A legitimate rebuild by YouTube was observed happening at most once or twice
 * after a navigation; 5 leaves 2-3× that margin while bounding a runaway loop —
 * YouTube rebuilding continuously, or a conflict with another script — to a
 * handful of `requestAnimationFrame` frames instead of letting it burn CPU for
 * the whole watch window.
 */
const MAX_REINJECTIONS = 5;

let watchObserver: MutationObserver | null = null;
let watchTimeoutId: ReturnType<typeof setTimeout> | null = null;
let reinjectionCount = 0;

function stopWatching() {
  watchObserver?.disconnect();
  watchObserver = null;
  if (watchTimeoutId !== null) {
    clearTimeout(watchTimeoutId);
    watchTimeoutId = null;
  }
}

/**
 * YouTube builds its action bar in JavaScript after `document_idle`, and a plain
 * reload does not fire `yt-navigate-finish`, so a single injection attempt fails
 * almost every time on first load. The DOM is observed and the attempt retried,
 * throttled by requestAnimationFrame — YouTube produces mutations continuously —
 * and cut off after `WATCH_TIMEOUT_MS`.
 *
 * Observation does NOT stop at the first successful injection. On an internal
 * navigation the old action bar, or an incomplete shell of the new one, is often
 * already present at `yt-navigate-finish`: the immediate attempt below succeeds,
 * then YouTube finishes rebuilding the bar and wipes out the button placed too
 * early. Stopping there left nothing watching, so the button only came back
 * after a full reload.
 *
 * Injection is a maintained STATE, not an event settled once: the observer stays
 * active after a success, and every mutation batch goes through
 * `maintainButton()`, which re-asks the question via `decideActionBarWatch`
 * (lib/action-bar-watch.ts, tested without a browser).
 */
function watchForActionBar() {
  stopWatching(); // an SPA navigation changes video: start from a clean state
  reinjectionCount = 0;
  injectButton(); // immediate attempt: often enough for no perceptible delay

  let scheduled = false;
  const attempt = () => {
    scheduled = false;
    maintainButton();
  };

  watchObserver = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(attempt);
  });
  watchObserver.observe(document.documentElement, { childList: true, subtree: true });

  watchTimeoutId = setTimeout(stopWatching, WATCH_TIMEOUT_MS);
}

/**
 * Builds the "✦ Résumer" button and appends it to `bar`. Shared by
 * `injectButton` (first placement) and `maintainButton` (replacement after
 * YouTube wiped or invalidated it): both need exactly the same element with the
 * same click handler.
 */
function buildButton(bar: HTMLElement): void {
  ensureStylesInjected();

  // Adopts height, radius, size AND font family from a SIBLING button already
  // in this bar rather than guessing fixed pixels: YouTube changes these metrics
  // without notice. The blue-purple gradient and the weight stay ours on purpose
  // (see ensureStylesInjected) — the button must read as OURS placed among
  // YouTube's, not as one more YouTube button.
  //
  // `fontFamily` cannot be obtained by inheritance: a `<button>` does not
  // receive its parent's font, and browsers impose their own form font until a
  // rule says otherwise.
  const metrics = readActionButtonMetrics(document);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = BTN_ID;
  btn.className = BTN_CLASS;
  btn.style.height = metrics.height;
  btn.style.borderRadius = metrics.borderRadius;
  btn.style.fontSize = metrics.fontSize;
  btn.style.fontFamily = metrics.fontFamily;
  btn.setAttribute('aria-label', ARIA_LABEL);
  btn.replaceChildren(document.createTextNode(LABEL));

  btn.addEventListener('click', () => {
    // The id is re-read AT CLICK time rather than captured at injection. If
    // YouTube mutates its action bar in place instead of destroying it, the
    // BTN_ID guard lets the old button survive, and its closure would summarise
    // the previous video with nothing to signal it.
    const current = readVideoId(location.href);
    if (!current) return;

    // Nothing changes on the button here, deliberately: no label change, no
    // `disabled`. A second click during a generation therefore comes through and
    // sends another SUMMARIZE — the service worker ignores it
    // (lib/summary-inflight.ts) after reopening the panel anyway.
    //
    // Sent synchronously: the user gesture must survive as far as
    // sidePanel.open() in the service worker, and `readVideoId` is synchronous,
    // so the gesture stays intact. The .catch() only attaches a handler to the
    // promise already emitted; it adds no waiting.
    chrome.runtime.sendMessage({ type: 'SUMMARIZE', videoId: current } satisfies Msg)
      .catch(() => {});
  });

  bar.appendChild(btn);
}

/** True if the button is in the DOM when this returns — already there, or just injected. */
function injectButton(): boolean {
  const existing = document.getElementById(BTN_ID);
  if (existing) {
    // An existing button is not enough: after an SPA navigation YouTube can
    // keep the PREVIOUS page's injected button alive, hidden, in its old action
    // bar. Returning early would report success for a button invisible on the
    // current page. The existing one is trusted only if it still lives INSIDE
    // the bar `findActionBar` resolves now.
    if (isInCurrentActionBar(existing, document)) return true;
    existing.remove();
  }
  const bar = findActionBar(document);
  const videoId = readVideoId(location.href);
  if (!bar || !videoId) return false;

  buildButton(bar);
  return true;
}

/**
 * Called on every mutation batch (throttled by requestAnimationFrame, see
 * `watchForActionBar`) for as long as observation lasts. Unlike `injectButton`,
 * which runs once at the start of a cycle, this runs continuously and puts the
 * button back when YouTube wipes it or leaves it stale.
 *
 * Hot path: an id lookup plus the containment check (`isInCurrentActionBar`,
 * which resolves the bar itself) covers the vast majority of batches, where
 * nothing concerns our button, and stops before any EXTRA selector resolution.
 * `findActionBar` runs a second time only on the rare path where something must
 * actually change.
 */
function maintainButton() {
  const existing = document.getElementById(BTN_ID);
  const buttonInCurrentBar = existing !== null && isInCurrentActionBar(existing, document);
  if (buttonInCurrentBar) return; // hot path: see above

  const bar = findActionBar(document);
  const decision = decideActionBarWatch({
    buttonExists: existing !== null,
    buttonInCurrentBar,
    barResolved: bar !== null,
    reinjectionCount,
    maxReinjections: MAX_REINJECTIONS,
  });

  if (decision.type === 'none') return;
  if (decision.type === 'give-up') {
    stopWatching();
    return;
  }

  const videoId = readVideoId(location.href);
  // `decision.type` is 'inject' / 'remove-and-inject' only when `barResolved`
  // was true, so `bar` is guaranteed non-null here — rechecked so TypeScript
  // knows it too, since that guarantee does not cross the pure function call.
  // `videoId` is not covered by the decision: a page with no usable video id
  // MUST NOT get a button, whatever the bar's state.
  if (!bar || !videoId) return;

  if (decision.type === 'remove-and-inject') existing?.remove();

  buildButton(bar);
  reinjectionCount += 1;
}

/**
 * How long the panel gets to close before the stealth style is removed. Order
 * matters: close THEN reveal. The reverse would show, for the length of the
 * closing animation, exactly the panel we went to such lengths never to show.
 * 600 ms is the value measured 2026-08-12 for a complete close.
 */
const CLOSE_SETTLE_MS = 600;

/**
 * Absolute ceiling on stealth mode. Last-resort safety net: if `finish()` is
 * never called — an unforeseen exception, a tab frozen mid-read — the style MUST
 * NOT stay applied indefinitely, since a permanently open and invisible panel
 * would be worse than the original defect. 15 s is over double the worst
 * plausible cycle (~6 s: open, read loop, three integrity attempts).
 */
const STEALTH_TIMEOUT_MS = 15_000;

type StealthSession = { end: (opts?: { close?: boolean }) => Promise<void> };

let stealth: StealthSession | null = null;

/**
 * Injects the stealth stylesheet, once per page. Like `ensureStylesInjected` it
 * lives in the HOST page and therefore escapes the manifest V3 CSP that would
 * forbid an inline `<style>` in the extension's own pages.
 */
function ensureStealthStyleInjected() {
  if (document.getElementById(STEALTH_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STEALTH_STYLE_ID;
  style.textContent = stealthCss();
  document.head.appendChild(style);
}

/**
 * Enters stealth mode and returns the means to leave it.
 *
 * The style is applied BEFORE the caller clicks the transcript button, and its
 * injection is synchronous: no intermediate frame is possible between the panel
 * opening and its hiding.
 *
 * Carries GUARD 2 (see `withUserTakeover`, lib/transcript-stealth.ts): a user
 * click on any transcript control during the stealth window releases the panel —
 * immediate reveal, and no automatic close. The listener runs in the CAPTURE
 * phase on the document: YouTube stops its own click events on its components,
 * so a bubbling listener would not see them all.
 */
function beginStealth(plan: TranscriptAccessPlan): StealthSession {
  ensureStealthStyleInjected();
  document.documentElement.classList.add(STEALTH_CLASS);

  let current = plan;
  let ended = false;

  const reveal = () => document.documentElement.classList.remove(STEALTH_CLASS);

  const onUserClick = (e: Event) => {
    // `e.isTrusted` is essential: without it the `btn.click()` the extension
    // itself emits to OPEN the panel trips this guard and cancels stealth at the
    // very moment it starts (measured end-to-end 2026-08-12, see
    // shouldYieldToUser).
    if (!shouldYieldToUser({ trusted: e.isTrusted, onTranscriptControl: isTranscriptControl(e.target) })) return;
    current = withUserTakeover(current);
    reveal();
    document.removeEventListener('click', onUserClick, true);
  };
  document.addEventListener('click', onUserClick, true);

  const end = async ({ close = true }: { close?: boolean } = {}) => {
    if (ended) return; // idempotent: `finish()`, the timeout and a navigation can all call this
    ended = true;
    clearTimeout(timeoutId);
    document.removeEventListener('click', onUserClick, true);

    // `current.closeAfter` dropped to false if the user took over: never close a
    // panel that became theirs again.
    if (close && current.closeAfter) {
      findTranscriptCloseButton(document)?.click();
      await sleep(CLOSE_SETTLE_MS);
    }
    reveal();
    if (stealth === session) stealth = null;
  };

  const timeoutId = setTimeout(() => void end(), STEALTH_TIMEOUT_MS);
  const session: StealthSession = { end };
  stealth = session;
  return session;
}

/** Ends the current stealth session, if there is one. No-op otherwise. */
function endStealth(opts?: { close?: boolean }): Promise<void> {
  return stealth?.end(opts) ?? Promise.resolve();
}

/**
 * What `extractTranscript` returns: the result, readable immediately, and the
 * cleanup to run AFTER answering (see the GET_TRANSCRIPT listener). Separating
 * the two is what takes closing the panel off the generation's critical path.
 */
type Extraction = { result: TranscriptResult; finish: () => Promise<void> };

/**
 * Opens the native panel if needed, reads the segments, and refuses to return an
 * incomplete transcript. A summary built on a truncated transcript would be
 * wrong with no way for the user to notice.
 *
 * Opening happens in stealth mode when the extension is the one opening: the
 * user asked for a summary, not for a transcript. The two guards bounding that
 * mode live in lib/transcript-stealth.ts.
 */
async function extractTranscript(): Promise<Extraction> {
  // Decided BEFORE any action: once we have opened the panel, "was it already
  // open?" has no observable answer left.
  const plan = planTranscriptAccess(findExpandedTranscriptPanel(document) !== null);
  const session = plan.stealth ? beginStealth(plan) : null;
  const finish = () => session?.end() ?? Promise.resolve();

  try {
    return await readTranscriptInto(finish);
  } catch (err) {
    void finish(); // never leave the stealth style applied on an exception
    throw err;
  }
}

/** The read itself. Separated so `finish` covers ALL of its exits. */
async function readTranscriptInto(finish: () => Promise<void>): Promise<Extraction> {
  if (readSegments(document).length === 0) {
    const btn = findTranscriptButton(document);
    if (!btn) return { result: { ok: false, reason: 'no-panel' }, finish };
    btn.click();
    for (let i = 0; i < 20 && readSegments(document).length === 0; i++) await sleep(150);
  }

  if (readSegments(document).length === 0) return { result: { ok: false, reason: 'no-segments' }, finish };

  // Safety net: the 2026-08-11 measurement shows no virtualisation, but YouTube
  // can change its mind. The read — segments AND duration — is redone on EVERY
  // attempt through `read()`, not once before the loop: `<video>.duration` can be
  // `NaN` while the player initialises (`readDuration` then returns 0), and a
  // frozen duration would fail the integrity check on every attempt even when the
  // transcript is in fact complete.
  //
  // `withIntegrityRetry` renders the verdict, not the caller: "read in full"
  // cannot be deduced from the final read alone — it takes knowing whether the
  // read stopped moving between attempts, which only the loop observes.
  const { segments, complete } = await withIntegrityRetry(
    () => ({ segments: readSegments(document), duration: readDuration(document) }),
    async () => {
      // With no matching container, nothing scrolls: the read will not move on
      // its own and the integrity check decides on what it observes. A truncated
      // transcript MUST NEVER be accepted silently.
      const panel = findTranscriptPanel(document);
      panel?.scrollTo({ top: panel.scrollHeight });
      await sleep(400);
    },
  );

  if (!complete) return { result: { ok: false, reason: 'incomplete' }, finish };

  const lang = document.documentElement.lang || null;
  return { result: { ok: true, segments, language: lang }, finish };
}
