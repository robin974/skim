// The extension's core: transcript, provider call, persistence.
//
// Only the boundaries a test needs to replace are injected (emit, ask, storage
// access, fetch). The provider, groupSegments and withRetry stay direct
// imports: tests must exercise the REAL adapters and the REAL SSE parsing, not
// stand-ins.
import { getProvider } from '@/lib/llm';
import { streamChat, withRetry } from '@/lib/llm/stream';
import type { ChatTurn } from '@/lib/llm/types';
import { groupSegments } from '@/lib/transcript';
import {
  activeKey, activeModel, activePrompt, languageName, LANGUAGE_INSTRUCTION, resolveEffort,
} from '@/lib/settings';
import type { Settings } from '@/lib/settings';
import type { Conversation, ConversationDraft, ConversationStatus } from '@/lib/conversations';
import { createThrottledPersist } from '@/lib/throttled-persist';
import type { PendingResume } from '@/lib/pending-resume';
import type {
  ErrorCode, Msg, PanelBroadcast, StreamEvent, StreamTarget, SummaryMeta, TranscriptResult, VideoMeta,
} from '@/lib/messages';

/** Target of every StreamEvent runSummary emits: never a follow-up answer. */
const SUMMARY_TARGET: StreamTarget = { kind: 'summary' };

/**
 * Throttle interval for incremental persistence. One second: short enough that a
 * panel closed and reopened mid-stream never finds text more than a second old,
 * and long enough to bring ~333 AWAITED writes (measured on a 61-minute summary,
 * see fixtures/README.md) down to a handful that the reading loop never awaits.
 * The last chunk always reaches storage immediately regardless — see flush() in
 * lib/throttled-persist.ts.
 */
const PERSIST_INTERVAL_MS = 1000;

export type OrchestratorDeps = {
  emit: (ev: PanelBroadcast) => void;
  ask: <T>(msg: Msg) => Promise<T | undefined>;
  getSettings: () => Promise<Settings>;
  /** The conversation stored for this video, if any: what a second summarise re-displays instead of regenerating. */
  getConversation: (videoId: string) => Promise<Conversation | null>;
  saveConversation: (c: ConversationDraft) => Promise<void>;
  /**
   * Writes ONLY the conversation tail (last turn + status), never the head —
   * meta and the user turn that carries the transcript (StoredHead,
   * lib/conversations.ts). This is what the streaming loop calls per chunk,
   * throttled. Without it every chunk would go through `saveConversation` and
   * reserialise the whole transcript: 150+ seconds measured for a summary the
   * model produces in under a second.
   */
  saveConversationTail: (
    videoId: string, turn: ChatTurn, status: ConversationStatus, provenance?: SummaryMeta | null,
  ) => Promise<void>;
  /**
   * The YouTube tab the request came from, when known. Used only to remember
   * where to restart the summary if it fails for lack of a key.
   */
  tabId?: number;
  /** Stores {videoId, tabId} before the 'no-key' error, for the resume after configuration. */
  rememberPendingResume: (pending: PendingResume) => Promise<void>;
  /** Injected all the way down to the streaming calls: tests supply a fake. */
  fetchImpl?: typeof fetch;
};

/**
 * Human duration in the summary's language ("61 minutes", "61 minutos").
 * Intl.NumberFormat({style: 'unit'}) does this with no label table to maintain,
 * as languageName() already does for the language name itself.
 *
 * Returns an empty string when the data is unreliable (no metadata, duration 0
 * or NaN) rather than "0 minutes" or "NaN minutes": the prompt's length budget
 * is indexed on this value, and a wrong duration skews it more surely than a
 * missing one, which the prompt handles.
 */
function formatDuration(seconds: number | undefined, locale: string): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '';
  const minutes = Math.max(1, Math.round(seconds / 60));
  try {
    return new Intl.NumberFormat(locale || undefined, {
      style: 'unit', unit: 'minute', unitDisplay: 'long',
    }).format(minutes);
  } catch {
    return `${minutes} minutes`;
  }
}

/**
 * Distinguishes the three transcript failures rather than lumping them under one
 * generic 'no-transcript'. That conflation once pointed debugging at "this video
 * has no subtitles" when the real cause was a selector bug in the extension.
 *  - `ask` returned nothing at all (no content script reachable): we know
 *    nothing about the page, so the generic 'no-transcript' stands.
 *  - 'no-panel' / 'no-segments': YouTube's transcript panel could not be opened
 *    or read → 'transcript-unavailable'.
 *  - 'incomplete': it was read but does not cover the whole video, and we refuse
 *    to summarise truncated text → 'transcript-incomplete'.
 */
function transcriptFailure(
  tr: TranscriptResult | undefined,
): { code: ErrorCode; message: string } {
  if (tr?.ok === false && tr.reason === 'incomplete') {
    // 'incomplete' does NOT mean "the subtitles do not cover the whole video":
    // a silent ending produces exactly that on a complete transcript, and is
    // accepted (see withIntegrityRetry, lib/transcript.ts). What reaches here is
    // a read nothing can be concluded from — a list still changing on every
    // attempt, or a video duration still unknown.
    return {
      code: 'transcript-incomplete',
      message: 'The transcript could not be read stably: the page had not finished loading it.',
    };
  }
  if (tr?.ok === false) {
    return {
      code: 'transcript-unavailable',
      message: "Could not open or read YouTube's transcript panel.",
    };
  }
  // No content script answered: we know NOTHING about the page, and therefore
  // nothing about this video's subtitles. The message says so rather than
  // asserting an absence no observation supports.
  return {
    code: 'no-transcript',
    message: "This video's page could not be read: no tab displays it, or the page is not ready.",
  };
}

/**
 * Substitutes every prompt placeholder EXCEPT `{transcript}`, which the caller
 * fills in with the grouped transcript once it has one.
 *
 * replaceAll everywhere, never replace: the prompt is user-editable, and nothing
 * stops someone reusing a placeholder twice. `String.replace('{x}', …)` would
 * substitute only the first occurrence and leave a literal placeholder in the
 * prompt sent to the model.
 *
 * languageName() turns the stored locale CODE ("fr") into a name the model reads
 * ("français"). This is what decides the language the summary is written in —
 * not the language of the prompt itself. Substituting the raw code yields an
 * absurd instruction ("... in fr."), invisible while the browser language
 * matches the transcript's and wrong as soon as they differ.
 *
 * LANGUAGE_INSTRUCTION is appended to EVERY prompt (see the block's comment,
 * lib/settings.ts): the output language is a setting, and no prompt takes it
 * over. The substitution below still fills a {language} left in a profile
 * stored while the options page offered the token — that prompt states its
 * language twice rather than shipping a literal placeholder to the model.
 */
function buildPrompt(settings: Settings, meta: VideoMeta | undefined): string {
  const duree = formatDuration(meta?.durationSeconds, settings.language);

  const prompt = `${activePrompt(settings)}\n\n${LANGUAGE_INSTRUCTION}`
    .replaceAll('{language}', languageName(settings.language))
    .replaceAll('{title}', meta?.title ?? '')
    .replaceAll('{channel}', meta?.channel ?? '')
    .replaceAll('{description}', meta?.description ?? '');

  // `duree` is '' when the duration is unreliable (see formatDuration), so an
  // unknown duration substitutes nothing rather than "NaN minutes" — the same
  // treatment as the other missing metadata above.
  return prompt.replaceAll('{duration}', duree);
}

/**
 * `regenerate` is the panel's regenerate button, for the displayed video only.
 * It generates even when a finished conversation exists, and replaces it.
 */
export async function runSummary(videoId: string, deps: OrchestratorDeps, regenerate = false): Promise<void> {
  const {
    emit, ask, getSettings, getConversation, saveConversation, saveConversationTail,
    rememberPendingResume, tabId, fetchImpl,
  } = deps;

  // First, before any check: this event is what switches the panel to this
  // video. An error emitted before it would be filtered out panel-side as
  // belonging to another video, and the click would look like it did nothing.
  emit({ type: 'STATE', videoId, target: SUMMARY_TARGET, status: 'loading' });

  // Summarising a video already summarised in this session re-displays it
  // rather than paying for the same summary twice. The stored conversation is
  // the whole display — summary, follow-up questions and provenance — so the
  // panel reloads it wholesale (RESTORE, lib/messages.ts) instead of receiving
  // the summary alone, which would drop the questions already asked from the
  // screen while leaving them in the history sent to the model.
  //
  // BEFORE the key check below, deliberately: nothing is sent, so nothing needs
  // a key. Only a 'done' conversation qualifies — an interrupted or failed one
  // has nothing worth restoring, and regenerating is exactly what is wanted
  // there. An empty summary likewise: the panel renders nothing for it, not even
  // the regenerate button, which would leave the user stuck.
  //
  // turns[1], the summary itself, NOT the last turn: after a follow-up the last
  // turn is an answer, and this test is about what the panel shows as the
  // summary (see hydrateFromConversation, lib/panel-reducer.ts).
  if (!regenerate) {
    const stored = await getConversation(videoId);
    if (stored?.status === 'done' && (stored.turns[1]?.text ?? '') !== '') {
      emit({ type: 'RESTORE', videoId });
      return;
    }
  }

  const settings = await getSettings();
  const provider = getProvider(settings.provider);
  const key = activeKey(settings);
  if (!key) {
    // Stored BEFORE the error is emitted, so the options page can restart this
    // summary once the key validates, without the user hunting for their
    // YouTube tab. With no known tabId there is nothing reliable to store.
    if (tabId != null) await rememberPendingResume({ videoId, tabId });
    emit({ type: 'ERROR', videoId, target: SUMMARY_TARGET, code: 'no-key', message: 'No key configured' });
    return;
  }

  const tr = await ask<TranscriptResult>({ type: 'GET_TRANSCRIPT', videoId });
  // The transcript IS the input: there is no second way to reach a video's
  // content. Failing here, before the metadata round-trip and before announcing
  // a stream, spares the panel a 'streaming' state it would have to take back.
  if (!tr?.ok) {
    emit({ type: 'ERROR', videoId, target: SUMMARY_TARGET, ...transcriptFailure(tr) });
    return;
  }

  // Metadata improves attribution: without the channel name and description the
  // model cannot name a creator who never says their own name. Missing metadata
  // degrades quality without blocking.
  const meta = await ask<VideoMeta>({ type: 'GET_META', videoId });

  const prompt = buildPrompt(settings, meta);

  emit({ type: 'STATE', videoId, target: SUMMARY_TARGET, status: 'streaming' });

  // Persists a partial conversation as the stream runs: the user turn (prompt
  // and transcript included) AND the assistant turn as accumulated so far. That
  // user turn is what lets runAsk() answer a follow-up without ever re-reading
  // or re-sending the transcript.
  //
  // Written as the stream runs rather than only at the end, so a panel closed
  // and reopened mid-stream restores "the text as it stands" instead of nothing.
  // status stays 'streaming' until this function writes the final version
  // ('done') or records a failure ('error'), so a reopened panel never presents
  // partial text as finished.
  //
  // Neither awaited per chunk nor reserialising the transcript per chunk — the
  // two faults measured at 150+ seconds for a summary the model produces in
  // under a second. `makeTailPersist` builds a throttled persister (at most one
  // write per second, never awaited by the reading loop) whose first write alone
  // carries the full head through `saveConversation`; every later write touches
  // only the tail. If the stream ends before that first write — an answer
  // shorter than the throttle interval — flush() plays that role, sending head
  // and tail together in one call.
  //
  // `provenance` is only ever set on the terminal write: it is not known before
  // the generation ends, and a summary still streaming has none to announce.
  function makeTailPersist(userTurn: ChatTurn) {
    let headWritten = false;
    type Payload = { text: string; status: ConversationStatus; provenance?: SummaryMeta };
    return createThrottledPersist<Payload>(async ({ text, status, provenance }) => {
      // The TERMINAL write goes through saveConversation too, head included,
      // even though one was already written. The panel can forget a conversation
      // while its summary is still being generated — closing its tab IS deleting
      // it (see lib/session-tabs.ts) — and a tail written alone would then land
      // beside no head: a summary paid for, finished, and impossible to display.
      // Rewriting the head costs one more serialisation of the transcript, ONCE
      // per generation. What this split forbids is paying that per chunk.
      if (!headWritten || status !== 'streaming') {
        headWritten = true;
        await saveConversation({
          videoId,
          meta: meta ?? null,
          status,
          provenance: provenance ?? null,
          turns: [userTurn, { role: 'assistant', text }],
        });
      } else {
        await saveConversationTail(videoId, { role: 'assistant', text }, status, provenance ?? null);
      }
    }, PERSIST_INTERVAL_MS);
  }

  let full = '';
  // One instant captured for the whole generation, carried by the SummaryMeta
  // the panel displays AND by the copy persisted with the conversation: the two
  // MUST carry exactly the same date, never two Date.now() calls that could
  // differ by milliseconds.
  const producedAt = Date.now();
  const modelName = activeModel(settings);
  const userTurn: ChatTurn = {
    role: 'user', text: prompt.replaceAll('{transcript}', groupSegments(tr.segments)),
  };
  const tailPersist = makeTailPersist(userTurn);
  // Reported in summaryMeta below: the fallback does not hide, it surfaces in
  // the provenance shown under the summary (see streamChat, lib/llm/stream.ts).
  //
  // Deliberately scoped OUTSIDE the withRetry closure and re-read on EVERY
  // attempt. streamChat's "only once" guarantee holds for ONE call. If the
  // fallback clears the 400 but the parameter-less request then fails on a
  // retryable error, withRetry replays the whole closure — and without this
  // memory each attempt would resend the parameter already known to be
  // refused, take another 400, and fall back again: up to 8 requests for one
  // summary instead of 4, half of them doomed. Once raised, the flag stays
  // raised for the rest of the generation.
  let effortDropped = false;
  try {
    await withRetry(async () => {
      full = '';
      for await (const chunk of streamChat(
        provider,
        {
          model: modelName,
          turns: [userTurn],
          // undefined once the fallback has happened: see effortDropped above.
          effort: effortDropped ? undefined : resolveEffort(settings),
        },
        // customBaseUrl only means something for the 'custom' provider, the
        // only one whose defaultBaseUrl is empty. Passing it to any other
        // provider would leak a custom endpoint left in settings: try a custom
        // endpoint, switch back to OpenRouter, and the requests would still go
        // to the old endpoint. undefined lets each provider fall back to its
        // own defaultBaseUrl.
        { apiKey: key, baseUrl: settings.provider === 'custom' ? settings.customBaseUrl : undefined },
        fetchImpl,
        undefined,
        { onEffortDropped: () => { effortDropped = true; } },
      )) {
        full += chunk;
        emit({ type: 'CHUNK', videoId, target: SUMMARY_TARGET, text: chunk });
        // Never awaited: awaiting here is what made the reading loop wait on
        // storage for every chunk.
        tailPersist.update({ text: full, status: 'streaming' });
      }
    });
  } catch (e) {
    await tailPersist.flush({ text: full, status: 'error' }).catch(() => {});
    throw e;
  }
  const summaryMeta: SummaryMeta = {
    producedAt, provider: provider.label, model: modelName,
    ...(effortDropped ? { effortDropped: true } : {}),
  };
  // Persisted with the conversation, not only emitted: a panel reopened later,
  // or a second summarise of this video, restores the line under the summary
  // instead of showing it bare.
  await tailPersist.flush({ text: full, status: 'done', provenance: summaryMeta });
  emit({ type: 'STATE', videoId, target: SUMMARY_TARGET, status: 'done', meta: summaryMeta });
}

export type AskDeps = {
  emit: (ev: StreamEvent) => void;
  getSettings: () => Promise<Settings>;
  getConversation: (videoId: string) => Promise<Conversation | null>;
  saveConversation: (c: ConversationDraft) => Promise<void>;
  /** Injected all the way down to the streaming calls: tests supply a fake. */
  fetchImpl?: typeof fetch;
};

/**
 * Follow-up question. When a conversation exists, NEVER re-ask the content
 * script for the transcript: the user turn runSummary saved already carries the
 * full prompt, transcript included, and re-reading it would send it a second
 * time in the same request — doubling the payload while adding nothing the model
 * does not already know. `conversation.turns` is reused as is, question
 * appended.
 *
 * With no conversation there is nothing to answer from, and nothing displayed
 * either: the panel only ever shows a summary it restored from one (see
 * hydrateFromConversation, lib/panel-reducer.ts).
 *
 * Does not catch `withRetry`'s failure itself, unlike its early
 * 'no-conversation'/'no-key' errors, which it emits directly. As with
 * runSummary, the caller (entrypoints/background.ts) converts an escaping
 * exception into an ERROR event — one place translating LLMError → StreamEvent
 * rather than one per orchestration function.
 */
export async function runAsk(
  videoId: string, question: string, questionId: string, deps: AskDeps,
): Promise<void> {
  const { emit, getSettings, getConversation, saveConversation, fetchImpl } = deps;
  const target: StreamTarget = { kind: 'answer', questionId };

  const conversation = await getConversation(videoId);
  if (!conversation) {
    emit({
      type: 'ERROR', videoId, target,
      code: 'no-conversation', message: 'No summary has been generated for this video yet.',
    });
    return;
  }

  const settings = await getSettings();
  const provider = getProvider(settings.provider);
  const key = activeKey(settings);
  if (!key) {
    emit({ type: 'ERROR', videoId, target, code: 'no-key', message: 'No key configured' });
    return;
  }

  // No 'loading' here, deliberately: that status switches and RESETS the panel
  // onto a new video (see lib/panel-reducer.ts) — right for a new summary,
  // catastrophic for a follow-up on the SAME video, which would erase the
  // summary displayed above. 'streaming' directly: this path has nothing like a
  // transcript read to announce.
  emit({ type: 'STATE', videoId, target, status: 'streaming' });

  const questionTurn: ChatTurn = { role: 'user', text: question };
  const turns: ChatTurn[] = [...conversation.turns, questionTurn];

  let full = '';
  // Same cross-attempt memory as runSummary, for the same reason: streamChat's
  // "retry once" guarantee holds for ONE call, and a 400 on the effort parameter
  // followed by a 503 on the fallback request replays the whole closure. Without
  // this flag each attempt would resend the level already known to be refused.
  //
  // Nothing to report here, unlike runSummary: a follow-up answer has no
  // displayed provenance, so the flag is ONLY cross-attempt memory.
  let effortDropped = false;
  await withRetry(async () => {
    full = '';
    for await (const chunk of streamChat(
      provider,
      {
        model: activeModel(settings),
        turns,
        effort: effortDropped ? undefined : resolveEffort(settings),
      },
      { apiKey: key, baseUrl: settings.provider === 'custom' ? settings.customBaseUrl : undefined },
      fetchImpl,
      undefined,
      { onEffortDropped: () => { effortDropped = true; } },
    )) {
      full += chunk;
      emit({ type: 'CHUNK', videoId, target, text: chunk });
    }
  });

  await saveConversation({
    ...conversation,
    status: 'done',
    turns: [...conversation.turns, questionTurn, { role: 'assistant', text: full }],
  });

  emit({ type: 'STATE', videoId, target, status: 'done' });
}
