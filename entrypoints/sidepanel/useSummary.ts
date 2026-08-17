import { useCallback, useEffect, useReducer, useState } from 'react';
import type { RestoreEvent, StreamEvent, Msg } from '@/lib/messages';
import type { Conversation } from '@/lib/conversations';
import {
  initialUiState, reduceStreamEvent, hydrateFromConversation, canRegenerate, type UiState,
} from '@/lib/panel-reducer';
import { currentTabVideo } from './useCurrentVideo';

export type { UiState };

const STREAM_EVENT_TYPES: ReadonlySet<StreamEvent['type']> = new Set(['STATE', 'CHUNK', 'ERROR']);

/**
 * chrome.runtime.onMessage receives EVERY message broadcast in the extension,
 * not only the service worker's StreamEvents — the content script broadcasts
 * 'SUMMARIZE' too. Sort before trusting the message's shape.
 */
function isStreamEvent(msg: unknown): msg is StreamEvent {
  if (typeof msg !== 'object' || msg === null || !('type' in msg)) return false;
  const type = (msg as { type: unknown }).type;
  return typeof type === 'string' && STREAM_EVENT_TYPES.has(type as StreamEvent['type']);
}

/** Same sorting, for the one broadcast that is not a StreamEvent (lib/messages.ts). */
function isRestore(msg: unknown): msg is RestoreEvent {
  return typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'RESTORE';
}

export type UseSummary = {
  state: UiState;
  /**
   * Has rehydration at mount finished, whatever its outcome? Used ONLY to hold
   * back the idle prompt until it is known whether anything can be restored:
   * `initialUiState` carries status 'idle', indistinguishable from a proven
   * "nothing to show". Without this flag, opening the panel over an
   * already-summarised video flashes that prompt for the length of a round trip
   * to a possibly sleeping service worker.
   */
  hydrated: boolean;
  /** Posts a follow-up question for the displayed video. No-op on an empty question or with no video displayed. */
  askQuestion: (question: string) => void;
  /**
   * Restarts the displayed video's summary, replacing the stored conversation
   * instead of re-displaying it. No-op when canRegenerate() refuses. The guard is
   * applied HERE as well as through the button's `disabled` attribute, so it
   * stays correct if this hook is ever called by something other than a click on
   * a disabled button.
   */
  regenerateSummary: () => void;
  /**
   * Starts a video's summary FROM the panel — the idle button and the errors'
   * retry button.
   *
   * The caller passes the id rather than this deducing it: the idle button means
   * the ACTIVE tab's video (useCurrentVideo), a retry means the one that just
   * failed (state.videoId), and the two can differ if the user changed tabs.
   * Guessing would one day summarise a video they were not watching.
   */
  summarize: (videoId: string) => void;
  /**
   * Displays another of the session's videos — a click in the tab bar, or the
   * panel following the video the active tab moved to.
   *
   * Rebuilds the whole display from that video's stored conversation, and wins
   * over what is on screen: choosing a tab IS the instruction to show it. A
   * running generation is not interrupted by this and not lost — it lives in the
   * service worker, and its own tab keeps showing it.
   *
   * `null` empties the panel: the last tab has just been closed, and what it
   * displayed goes with it.
   *
   * A no-op on the video already displayed, which is what makes it safe to call
   * from an effect: without that guard, following the active tab would replay a
   * storage read over a stream that has already started and erase it.
   */
  selectVideo: (videoId: string | null) => void;
};

/**
 * The side panel's document is unloaded when it closes: nothing survives on the
 * React side. Two sources feed the displayed state:
 *  - StreamEvents broadcast live by the service worker;
 *  - an ASYNCHRONOUS rehydration (GET_STATE) of the stored conversation, which
 *    never tries to reattach to a live stream (see hydrateFromConversation,
 *    lib/panel-reducer.ts). It runs at mount, and again on a RESTORE.
 *
 * Both go through the SAME reducer, which guarantees that a live event already
 * handled by the time rehydration resolves is never overwritten (HYDRATED action,
 * `videoId === null` guard).
 */
export function useSummary(): UseSummary {
  const [state, dispatch] = useReducer(reduceStreamEvent, initialUiState);
  const [hydrated, setHydrated] = useState(false);

  /**
   * Rebuilds the whole display from the stored conversation. `force` is for the
   * rehydration a RESTORE triggers, which must win over what is displayed; the
   * one at mount stays subordinate to any live event (see Hydrated,
   * lib/panel-reducer.ts).
   */
  const rehydrate = useCallback(async (videoId: string, force: boolean) => {
    const conversation = (await chrome.runtime
      .sendMessage({ type: 'GET_STATE', videoId } satisfies Msg)
      .catch(() => null)) as Conversation | null;
    dispatch({ type: 'HYDRATED', state: hydrateFromConversation(conversation, videoId), force });
  }, []);

  useEffect(() => {
    const onMessage = (msg: unknown) => {
      if (isStreamEvent(msg)) {
        dispatch(msg);
        return;
      }
      // Nothing was generated: this video already has a finished conversation,
      // and the service worker says to show it. Reading it here rather than
      // receiving it keeps the transcript it carries out of the message (see
      // RestoreEvent, lib/messages.ts).
      if (isRestore(msg)) rehydrate(msg.videoId, true).catch(console.error);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [rehydrate]);

  useEffect(() => {
    (async () => {
      try {
        const videoId = (await currentTabVideo())?.id ?? null;
        // Off YouTube: nothing to restore, but rehydration really is finished —
        // this is exactly the case where the prompt should show.
        if (videoId === null) return;
        await rehydrate(videoId, false);
      } finally {
        // `finally`: both an early return and an unforeseen error must release
        // the display. A panel stuck forever on nothing would be worse than the
        // flashing prompt this flag removes.
        setHydrated(true);
      }
    })();
  }, [rehydrate]);

  const askQuestion = useCallback((question: string) => {
    const trimmed = question.trim();
    const videoId = state.videoId;
    if (trimmed === '' || videoId === null) return;

    const questionId = crypto.randomUUID();
    // Dispatched BEFORE sending: this creates the conversation entry the
    // answer's StreamEvents (targeting this questionId) will fill in.
    dispatch({ type: 'ASK_SUBMITTED', videoId, questionId, question: trimmed });

    chrome.runtime
      .sendMessage({ type: 'ASK', videoId, question: trimmed, questionId } satisfies Msg)
      .catch(() => {});
  }, [state.videoId]);

  const regenerateSummary = useCallback(() => {
    const videoId = state.videoId;
    if (videoId === null || !canRegenerate(state)) return;

    // Dispatched BEFORE sending, exactly like ASK_SUBMITTED: flips the displayed
    // state — and therefore canRegenerate — without waiting for the round trip
    // to the service worker.
    dispatch({ type: 'REGENERATE_SUBMITTED', videoId });

    // No sidePanel.open() expected here: the panel is already open, since it is
    // what shows this button. background.ts only calls it when the message comes
    // from a tab.
    chrome.runtime
      .sendMessage({ type: 'SUMMARIZE', videoId, regenerate: true } satisfies Msg)
      .catch(() => {});
  }, [state]);

  const summarize = useCallback((videoId: string) => {
    // No local dispatch first, unlike regenerateSummary: there is nothing to
    // neutralise immediately. The idle button exists only when the panel shows
    // NOTHING, and retry only on an error — two states with no stream running.
    // The service worker's 'loading' STATE is therefore enough to flip the
    // display, and the open panel is certain to hear it.
    //
    // This message leaves an extension page, so `sender.tab` is always absent —
    // which is also what triggers the video tab lookup (lib/video-tab.ts).
    chrome.runtime
      .sendMessage({ type: 'SUMMARIZE', videoId } satisfies Msg)
      .catch(() => {});
  }, []);

  const selectVideo = useCallback((videoId: string | null) => {
    if (videoId === state.videoId) return;
    // `null` is the empty bar: the last tab has just been closed, and what it
    // displayed must go with it. Nothing to read from storage — the whole point
    // is that there is nothing left there.
    if (videoId === null) {
      dispatch({ type: 'HYDRATED', state: initialUiState, force: true });
      return;
    }
    // `force`: a rehydration at mount stays subordinate to any live event, but
    // this one is a decision taken now, over whatever is displayed (see
    // Hydrated, lib/panel-reducer.ts).
    rehydrate(videoId, true).catch(console.error);
  }, [rehydrate, state.videoId]);

  return { state, hydrated, askQuestion, regenerateSummary, summarize, selectVideo };
}
