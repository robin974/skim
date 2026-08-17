// Pure reducer for the side panel.
import type { StreamEvent, ErrorCode, SummaryMeta } from './messages';
import type { Conversation } from './conversations';

export type AnswerStatus = 'streaming' | 'done' | 'error';

/**
 * A follow-up question and its answer, displayed under the summary.
 * `questionId` links this entry to the StreamEvents that concern it (see
 * StreamTarget, lib/messages.ts) — never inferred from a position in the array,
 * which breaks as soon as two questions are in flight at once.
 */
export type Answer = {
  questionId: string;
  question: string;
  status: AnswerStatus;
  text: string;
  error: { code: ErrorCode; message: string } | null;
};

export type UiState = {
  status: 'idle' | 'loading' | 'streaming' | 'done' | 'error';
  text: string;
  error: { code: ErrorCode; message: string } | null;
  videoId: string | null;
  /** Follow-up conversation for the displayed video, in the order asked. */
  answers: Answer[];
  /**
   * Provenance of the displayed summary — see SummaryMeta (lib/messages.ts).
   * `null` while the summary is still running: provenance is settled only once
   * it ends, whether it arrives on the 'done' STATE or with the conversation the
   * panel rehydrated from.
   */
  meta: SummaryMeta | null;
};

export const initialUiState: UiState = {
  status: 'idle', text: '', error: null, videoId: null, answers: [], meta: null,
};

/**
 * Panel-local action: the user has just posted a question, BEFORE any reply from
 * the service worker. Not a StreamEvent — nothing like it travels through
 * chrome.runtime.onMessage — but the same reducer handles it, because it creates
 * the conversation entry that StreamEvents targeting `questionId` will fill in.
 *
 * The caller mints that questionId (crypto.randomUUID()) and passes it verbatim
 * in the ASK message, which is what lets answer events find the right entry
 * without ever guessing from panel state.
 */
export type AskSubmitted = { type: 'ASK_SUBMITTED'; videoId: string; questionId: string; question: string };

/**
 * Panel-local too: the asynchronous result of a rehydration (GET_STATE).
 *
 * Routed through THIS reducer rather than a separate `useState` to get a total
 * order with StreamEvents already in flight. React processes dispatches in
 * arrival order, so when a live event precedes the resolution of GET_STATE, the
 * `state.videoId === null` guard below wins and the now-stale rehydration is
 * ignored instead of overwriting fresher state.
 */
export type Hydrated = {
  type: 'HYDRATED';
  state: UiState;
  /**
   * Applies this rehydration even over something already displayed. Set ONLY
   * for the one a RESTORE asks for (see RestoreEvent, lib/messages.ts): the
   * service worker has just established that this video's stored conversation is
   * what must be shown, which the mount-time read — older than any event that
   * beat it — never can.
   */
  force?: boolean;
};

/**
 * Panel-local too: the user has just clicked "regenerate", BEFORE any reply from
 * the service worker. Handled exactly like a 'loading' STATE — same full reset
 * of text, error, follow-up conversation AND provenance.
 *
 * Dispatched synchronously rather than waiting for the REAL 'loading' STATE
 * runSummary is about to emit: without it, canRegenerate() would stay `true` for
 * the whole round trip to the service worker, leaving a real window in which a
 * double click starts two parallel regenerations of the same video. The real
 * 'loading' STATE that follows applies the same transition again, with no side
 * effect.
 */
export type RegenerateSubmitted = { type: 'REGENERATE_SUBMITTED'; videoId: string };

export type PanelAction = StreamEvent | AskSubmitted | Hydrated | RegenerateSubmitted;

/**
 * Drives panel state from the StreamEvents the service worker emits, plus the
 * local actions above.
 *
 * Three subtleties of the contract:
 *
 * - Early orchestration failures ('no-key', 'no-transcript' — see
 *   orchestrator.ts) emit an ERROR without ever emitting a `status:'error'`
 *   STATE first. An ERROR MUST therefore always move status to 'error' (or the
 *   matching answer entry to 'error'), whatever the current state.
 *
 * - The panel is global to the window, not to a video: an event for another
 *   video can arrive while this one is displayed. Only a `status:'loading'`
 *   STATE changes the displayed video (and resets text, error AND follow-up
 *   conversation); every other event whose videoId differs from the known one is
 *   ignored rather than corrupting the current display. While no video is known
 *   yet (videoId === null, just after the panel opens), the first event to
 *   arrive — including an ERROR with no prior STATE — fixes the displayed video.
 *
 * - The `target` discriminant (StreamTarget) separates summary events from
 *   follow-up answer events, and MUST NOT be inferred from panel state: such an
 *   inference breaks as soon as an answer is still streaming when a new question
 *   is posted. An event whose questionId matches no known entry is ignored
 *   without touching state.
 */
export function reduceStreamEvent(state: UiState, action: PanelAction): UiState {
  if (action.type === 'HYDRATED') {
    // Applies only if NOTHING has happened since mount: beyond that, a live
    // event is strictly fresher than a storage read started before it. `force`
    // is the exception, and the only one — see Hydrated above.
    return action.force === true || state.videoId === null ? action.state : state;
  }

  if (action.type === 'ASK_SUBMITTED') {
    if (state.videoId !== action.videoId) return state;
    const entry: Answer = {
      questionId: action.questionId, question: action.question, status: 'streaming', text: '', error: null,
    };
    return { ...state, answers: [...state.answers, entry] };
  }

  if (action.type === 'REGENERATE_SUBMITTED') {
    // Same guard as ASK_SUBMITTED: ignored if the displayed video changed
    // between the click and this action. It should not happen — the button only
    // exists for the current video — but the check is free.
    if (state.videoId !== action.videoId) return state;
    return resetForLoading(action.videoId);
  }

  const ev = action;

  if (ev.type === 'STATE' && ev.status === 'loading') {
    return resetForLoading(ev.videoId);
  }

  if (state.videoId !== null && ev.videoId !== state.videoId) {
    return state;
  }

  if (ev.target.kind === 'answer') {
    return { ...state, videoId: ev.videoId, answers: applyToAnswer(state.answers, ev.target.questionId, ev) };
  }

  // ev.target.kind === 'summary'
  if (ev.type === 'STATE') {
    // `ev.meta ?? state.meta`: only the final 'done' STATE carries `meta`. An
    // intermediate 'streaming' STATE has none and MUST NOT erase provenance
    // already known.
    return { ...state, status: ev.status, videoId: ev.videoId, meta: ev.meta ?? state.meta };
  }

  if (ev.type === 'CHUNK') {
    return { ...state, text: state.text + ev.text, videoId: ev.videoId };
  }

  // ev.type === 'ERROR'
  return {
    ...state,
    status: 'error',
    error: { code: ev.code, message: ev.message },
    videoId: ev.videoId,
  };
}

/** Full reset to a video's 'loading' state — shared by STATE 'loading' and REGENERATE_SUBMITTED. */
function resetForLoading(videoId: string): UiState {
  return { status: 'loading', text: '', error: null, videoId, answers: [], meta: null };
}

/**
 * The regenerate button is actionable ONLY when a summary is fully displayed and
 * no stream is running: never while the summary itself loads or generates, and
 * never while a follow-up answer is still generating. A second summary started
 * in parallel would interleave its CHUNKs with an existing stream's.
 *
 * The panel consumes this for the button's `disabled` attribute. React rendering
 * is outside the test glob, so this function is the only place the rule can be
 * verified.
 */
export function canRegenerate(state: UiState): boolean {
  return state.status === 'done' && state.videoId !== null
    && !state.answers.some((a) => a.status === 'streaming');
}

function applyToAnswer(answers: Answer[], questionId: string, ev: StreamEvent): Answer[] {
  return answers.map((a): Answer => {
    if (a.questionId !== questionId) return a;

    if (ev.type === 'CHUNK') return { ...a, text: a.text + ev.text };

    if (ev.type === 'ERROR') return { ...a, status: 'error', error: { code: ev.code, message: ev.message } };

    // ev.type === 'STATE': 'loading' should never target an answer (see runAsk,
    // lib/orchestrator.ts). Treated as 'streaming' rather than failing on an
    // unexpected status.
    const status: AnswerStatus = ev.status === 'done' || ev.status === 'error' ? ev.status : 'streaming';
    return { ...a, status };
  });
}

/**
 * Rebuilds panel state from a persisted Conversation (lib/conversations.ts) when
 * the panel mounts. The panel document is destroyed on close; nothing survives
 * on the React side.
 *
 * turns[0] is ALWAYS the initial summary's user turn — the full prompt sent to
 * the model, transcript included. An implementation detail, never displayed.
 * turns[1] is the summary itself. Following turns alternate question and answer
 * for each completed follow-up: runAsk only saves once the answer is complete,
 * so no unanswered question can appear here. An incomplete trailing pair would
 * mean a corrupted conversation, and is ignored rather than crashing.
 *
 * NEVER tries to reattach to a live stream: conversation.status becomes the
 * displayed status directly. For 'streaming' that is honestly the text as of the
 * last write — possibly finished since, possibly not — never presented as
 * complete. For 'error', a generic message rather than a fabricated one: the
 * precise cause is not persisted.
 *
 * `meta` comes from the conversation itself, which carries the provenance of the
 * summary it holds (lib/conversations.ts). A summary restored after the panel
 * was closed therefore keeps ITS date, provider and model — never the settings
 * in force at the moment it is redisplayed.
 */
export function hydrateFromConversation(conversation: Conversation | null, videoId: string): UiState {
  if (!conversation) return { ...initialUiState, videoId };

  const [, summaryTurn, ...rest] = conversation.turns;
  const text = summaryTurn?.text ?? '';

  const answers: Answer[] = [];
  for (let i = 0; i + 1 < rest.length; i += 2) {
    const question = rest[i];
    const reply = rest[i + 1];
    if (!question || !reply) break;
    answers.push({
      questionId: `restored-${i}`, question: question.text, status: 'done', text: reply.text, error: null,
    });
  }

  if (conversation.status === 'error') {
    return {
      status: 'error',
      text,
      error: { code: 'unknown', message: 'The previous generation was interrupted before it finished.' },
      videoId,
      answers,
      // No provenance on a failed generation: nothing settled to describe. The
      // conversation carries none either (see runSummary, lib/orchestrator.ts).
      meta: null,
    };
  }

  return {
    status: conversation.status,
    text,
    error: null,
    videoId,
    answers,
    meta: conversation.provenance,
  };
}
