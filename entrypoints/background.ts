import { getSettings } from '@/lib/settings';
import {
  saveConversation, saveConversationTail, getConversation, dropLegacyCache,
} from '@/lib/conversations';
import { runSummary, runAsk } from '@/lib/orchestrator';
import { rememberPendingResume } from '@/lib/pending-resume';
import { createSummaryInFlight } from '@/lib/summary-inflight';
import { findVideoTabId } from '@/lib/video-tab';
import { LLMError } from '@/lib/llm/types';
import type { Msg, PanelBroadcast, StreamTarget } from '@/lib/messages';
import { formatVersionName, type BuildInfo } from '@/lib/build-info';

export default defineBackground({
  main() {
    // Build provenance: one line, already there when the console is opened for
    // some other reason — it answers "which build is running?" without going
    // through chrome://extensions. Same values and formatting as version_name in
    // the manifest; no key and no setting enters this. A release logs its
    // version alone, the whole of what it knows about itself.
    const manifest = chrome.runtime.getManifest();
    const buildInfo: BuildInfo = __BUILD_RELEASE__
      ? { kind: 'release', version: manifest.version }
      : {
          kind: 'dev', version: manifest.version,
          sha: __BUILD_SHA__, branch: __BUILD_BRANCH__, dirty: __BUILD_DIRTY__, timestamp: __BUILD_TIME__,
        };
    console.info(`${manifest.name} — build ${formatVersionName(buildInfo)}`);

    // The toolbar icon toggles the panel of its window: the request to close
    // goes to the panel, which is the only context that knows which window it
    // sits in, and the open follows in the same turn because the user gesture
    // does not survive an await. Neither call is conditional, and they do not
    // race — lib/panel-toggle.ts holds the whole reasoning.
    //
    // Works only because the manifest defines NO default_popup: with one, this
    // event never fires.
    chrome.action.onClicked.addListener((tab) => {
      const { windowId } = tab;
      if (windowId == null) return;

      emit({ type: 'CLOSE_PANEL', windowId });
      chrome.sidePanel.open({ windowId }).catch(console.error);
    });

    // The panel never opens by itself: only on the action click, or on the
    // SUMMARIZE message from the button injected on the video page.
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error);

    chrome.runtime.onInstalled.addListener((details) => {
      // One-off cleanup of the summary cache earlier versions kept on disk. See
      // dropLegacyCache (lib/conversations.ts): summaries no longer outlive the
      // browser session, so nothing in the interface could show or clear it.
      dropLegacyCache().catch(console.error);

      // Discoverability: a new user MUST NOT meet the extension through a
      // "no key configured" error. Opening the settings on error already exists,
      // but assumes they first clicked the button in vain.
      if (details.reason === 'install') {
        chrome.runtime.openOptionsPage().catch(console.error);
      }
    });

    chrome.runtime.onMessage.addListener((msg: Msg, sender, sendResponse) => {
      if (msg.type === 'SUMMARIZE') {
        // ⚠️ CRITICAL ORDER — open() BEFORE any await. The user gesture does not
        // survive the first asynchronous break, and the failure would be silent.
        //
        // `!msg.regenerate`: the panel's regenerate button also sends a
        // SUMMARIZE, but from the ALREADY OPEN panel, never from a gesture on
        // the YouTube tab. `sender.tab` is never set for a message sent by an
        // extension page anyway, so `windowId` would already be undefined here;
        // this explicit guard documents the invariant rather than resting on
        // that platform detail.
        //
        // That same absent `sender.tab` also leaves the request with no tab to
        // ask for the transcript: startSummary then finds the video's tab (see
        // lib/video-tab.ts) instead of leaving with no recipient.
        //
        // Deliberately BEFORE the in-flight guard below, and not conditioned on
        // it: a click during a running generation must still (re)open the panel.
        // That is the user's only gesture for getting back a panel they just
        // closed, and refusing it because a summary is already running would
        // mean a dead button for the whole generation.
        const windowId = sender.tab?.windowId;
        if (windowId != null && !msg.regenerate) chrome.sidePanel.open({ windowId }).catch(console.error);

        (async () => {
          // Repeated clicks during a generation restart nothing: the request is
          // simply dropped (see lib/summary-inflight.ts).
          await inFlight.run(
            msg.videoId,
            () => startSummary(msg.videoId, sender.tab?.id, msg.regenerate ?? false),
          );
          sendResponse({ ok: true });
        })();
        return true;
      }

      if (msg.type === 'RESUME_SUMMARY') {
        // Resume after configuration: NO sidePanel.open() here. This message
        // comes from the options page with no user gesture on the YouTube tab,
        // so the call would fail. The panel is already open in this scenario —
        // it is what showed the 'no-key' error that led to the resume.
        const { videoId, tabId } = msg;

        (async () => {
          // Same guard as SUMMARIZE. This path is in practice always free — a
          // resume follows a generation that stopped on 'no-key' — but a resume
          // fired twice, from two settings tabs or a double click, MUST NOT
          // start two generations any more than a double click on the button.
          await inFlight.run(videoId, () => startSummary(videoId, tabId));
          sendResponse({ ok: true });
        })();
        return true;
      }

      if (msg.type === 'ASK') {
        // No sidePanel.open() here, deliberately: unlike SUMMARIZE, this message
        // leaves the side panel itself — necessarily open, since it shows the
        // question field — and not a gesture on the YouTube tab. There is
        // neither a need nor a valid user gesture to carry the call.
        const { videoId, question, questionId } = msg;

        (async () => {
          await startAsk(videoId, question, questionId);
          sendResponse({ ok: true });
        })();
        return true;
      }

      if (msg.type === 'GET_STATE') {
        // Rehydration when the panel opens: its document is destroyed on close
        // and nothing survives on the React side. The panel determines the
        // current video itself and passes its videoId here; with no known video
        // there is nothing to load.
        //
        // Also what a RESTORE sends the panel back for (see runSummary,
        // lib/orchestrator.ts): one path to rebuild the display, whatever
        // triggered it.
        (async () => {
          if (msg.videoId == null) { sendResponse(null); return; }
          sendResponse(await getConversation(msg.videoId));
        })();
        return true;
      }

      return false;
    });
  },
});

/**
 * Registry of in-flight generations (lib/summary-inflight.ts). At module level
 * rather than inside `main()`: the message listeners reach it, and the service
 * worker is reinitialised whole when Chrome kills it anyway.
 */
const inFlight = createSummaryInFlight();

/**
 * Builds the function that queries the content script of the tab showing this
 * video (GET_TRANSCRIPT, GET_META).
 *
 * `senderTabId` comes from `sender.tab`, which exists only for a message sent by
 * a CONTENT script — the injected button under the video. Anything leaving the
 * side panel or the options page is an extension page with no tab attached, and
 * without this lookup the request would go nowhere, failing as if the video had
 * no subtitles (see lib/video-tab.ts).
 *
 * `chrome.tabs.query({})` needs no extra permission: only the URLs of tabs
 * covered by a host permission are filled in, which is exactly enough to
 * recognise a YouTube tab.
 */
async function makeAsk(videoId: string, senderTabId: number | undefined) {
  const tabId = senderTabId ?? findVideoTabId(videoId, await chrome.tabs.query({}).catch(() => []));
  const ask = <T,>(m: Msg): Promise<T | undefined> =>
    tabId != null ? chrome.tabs.sendMessage(tabId, m).catch(() => undefined) : Promise.resolve(undefined);
  return { tabId, ask };
}

/**
 * Shared core of both summary triggers (SUMMARIZE, RESUME_SUMMARY): builds `ask`
 * from the known or recovered `tabId`, calls `runSummary`, and turns any
 * exception into an ERROR event rather than letting it become an unhandled
 * rejection.
 *
 * `regenerate` passes through to runSummary unchanged. RESUME_SUMMARY never
 * sets it — a resume is a normal run, never a regeneration.
 */
function startSummary(videoId: string, senderTabId: number | undefined, regenerate = false): Promise<void> {
  return (async () => {
    const { tabId, ask } = await makeAsk(videoId, senderTabId);

    try {
      await runSummary(videoId, {
        emit, ask, getSettings, getConversation, saveConversation, saveConversationTail,
        tabId, rememberPendingResume,
      }, regenerate);
    } catch (e) {
      emit({
        type: 'ERROR', videoId, target: { kind: 'summary' },
        code: e instanceof LLMError ? e.code : 'unknown',
        message: e instanceof Error ? e.message : 'Unknown error',
      });
    }
  })();
}

/**
 * Mirror of startSummary for a follow-up question: builds the StreamTarget every
 * event of that answer shares, calls runAsk, and turns any escaping exception
 * into an ERROR.
 *
 * No content script access here, unlike startSummary: a follow-up rests entirely
 * on the stored conversation, whose first turn already carries the transcript
 * (see runAsk, lib/orchestrator.ts).
 *
 * Unlike startSummary, no in-flight guard: two follow-up questions asked back to
 * back are two legitimate, distinct requests, each with its own questionId —
 * nothing like the same summary triggered twice.
 */
function startAsk(videoId: string, question: string, questionId: string): Promise<void> {
  const target: StreamTarget = { kind: 'answer', questionId };

  return (async () => {
    try {
      await runAsk(videoId, question, questionId, {
        emit, getSettings, getConversation, saveConversation,
      });
    } catch (e) {
      emit({
        type: 'ERROR', videoId, target,
        code: e instanceof LLMError ? e.code : 'unknown',
        message: e instanceof Error ? e.message : 'Unknown error',
      });
    }
  })();
}

function emit(ev: PanelBroadcast) {
  // The panel may be closed: no recipient is not an error.
  chrome.runtime.sendMessage(ev).catch(() => {});
}
