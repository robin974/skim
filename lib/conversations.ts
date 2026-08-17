import type { VideoMeta, SummaryMeta } from './messages';
import type { ChatTurn } from '@/lib/llm/types';

/**
 * Last known status of this conversation, written by the orchestrator alongside
 * `turns`. Used ONLY when the panel reopens (GET_STATE), to decide how to
 * present restored text:
 *  - 'streaming': the last known assistant turn was still being generated when
 *    it was written. The reopened panel does NOT try to reattach to the real
 *    stream; it shows the text as in progress, honestly unsure of the rest.
 *  - 'done': generation finished successfully.
 *  - 'error': generation failed after this partial text (see orchestrator.ts).
 *    Distinct from 'streaming' so nothing implies a resumption that will never
 *    come.
 */
export type ConversationStatus = 'streaming' | 'done' | 'error';

export type Conversation = {
  videoId: string;
  meta: VideoMeta | null;
  turns: ChatTurn[];
  status: ConversationStatus;
  /**
   * What produced the summary, for the line under it (see
   * describeSummaryProvenance, lib/summary-meta.ts). `null` until the generation
   * ends — a streaming or failed summary has no settled provenance to announce —
   * and on a conversation written before this field existed.
   */
  provenance: SummaryMeta | null;
  /**
   * When this conversation FIRST appeared in the session, which is what orders
   * the panel's tabs (oldest to the left, see lib/session-tabs.ts). Nothing else
   * dates a conversation before it ends: `provenance` is null for the whole
   * generation, and it is a running generation that most needs a tab.
   *
   * `0` on a conversation written before this field existed — older than
   * anything this session can stamp, which is exactly where it sorts.
   */
  createdAt: number;
};

/**
 * What a writer supplies: everything a reader gets EXCEPT the creation date,
 * which belongs to storage. `saveConversation` stamps it on the first write and
 * carries it over on every later one, so no caller has to remember whether the
 * conversation it is rewriting already existed — and a regenerated summary keeps
 * its tab where the user left it instead of jumping to the end of the bar.
 */
export type ConversationDraft = Omit<Conversation, 'createdAt'>;

const CONV = (id: string) => `conv:${id}`;
const TAIL = (id: string) => `conv:${id}:tail`;
/**
 * Suggested follow-ups, written by a second model call this extension no longer
 * makes. Kept as a name for one reason: a session opened before that call was
 * removed still carries the key, and deleteConversation is what clears it.
 */
const QUICK = (id: string) => `conv:${id}:quick`;

/** `conv:<id>`, and not `conv:<id>:tail` or `conv:<id>:quick`. */
const HEAD_KEY = /^conv:([^:]+)$/;

/**
 * Stored "head" of a conversation: everything that does NOT change during a
 * stream — metadata and every turn EXCEPT the last.
 *
 * A summary's user turn carries the whole prompt, transcript included (35 to
 * 82 KB measured on this project's fixtures, see fixtures/README.md).
 * Reserialising it on every chunk measured 150+ seconds for a summary the model
 * produces in under a second. This split exists so the head is written ONCE per
 * generation; see saveConversationTail for the part that changes per chunk.
 *
 * `status` is deliberately NOT here: it changes with every chunk, so it lives
 * next to the text that changes with it (StoredTail). Its presence also marks
 * the legacy shape — see isLegacyConversation.
 */
type StoredHead = {
  videoId: string;
  meta: VideoMeta | null;
  turns: ChatTurn[];
  /** See Conversation.createdAt. Absent on a head written before the field existed. */
  createdAt?: number;
};

/**
 * Stored form of the part that changes on every chunk: the LAST turn (the
 * assistant's answer as it accumulates) and its status. Its own storage key
 * (TAIL, distinct from CONV), so writing it never touches the key holding the
 * transcript.
 *
 * `provenance` rides here rather than in the head for the same reason as
 * `status`: it is only known once the generation ends, and the terminal write
 * that carries it is a tail write. Storing it in the head would cost a second
 * write of the transcript per summary.
 */
type StoredTail = { turn: ChatTurn; status: ConversationStatus; provenance?: SummaryMeta | null };

/**
 * A conversation written before the head/tail split lives entirely under
 * CONV(id), `status` included, with no TAIL key. The current head shape NEVER
 * carries `status`, so that field identifies the old shape. It is returned
 * untouched: a session opened before the split MUST keep loading, otherwise a
 * still-open tab silently loses its running summary.
 */
function isLegacyConversation(v: unknown): v is Omit<Conversation, 'provenance' | 'createdAt'> {
  return typeof v === 'object' && v !== null && 'status' in v;
}

/**
 * Rebuilds the Conversation as every caller knows it (GET_STATE, runAsk). The
 * head/tail split in storage is internal to this module and never exposed.
 */
export async function getConversation(videoId: string): Promise<Conversation | null> {
  const r = await chrome.storage.session.get<Record<string, unknown>>([CONV(videoId), TAIL(videoId)]);
  const stored = r[CONV(videoId)];
  if (stored === undefined) return null;
  if (isLegacyConversation(stored)) return { ...stored, provenance: null, createdAt: 0 };

  const head = stored as StoredHead;
  const tailEntry = r[TAIL(videoId)] as StoredTail | undefined;
  const turns = tailEntry ? [...head.turns, tailEntry.turn] : head.turns;
  return {
    videoId: head.videoId,
    meta: head.meta,
    createdAt: head.createdAt ?? 0,
    // The head is always written together with its tail (saveConversation, or
    // saveConversationTail after an initial saveConversation), so a missing tail
    // should not happen in normal use. Default to 'done' rather than throw: a
    // head without a tail has no assistant text to show as in progress anyway.
    status: tailEntry?.status ?? 'done',
    provenance: tailEntry?.provenance ?? null,
    turns,
  };
}

/**
 * Writes the WHOLE conversation: splits `turns` into head (all but the last
 * turn) and tail (the last turn, with the status), in a single storage call.
 *
 * As expensive per call as before the split — the head carries the user turn,
 * transcript included — but the streaming loop no longer calls it on every
 * chunk (see saveConversationTail), only once per generation.
 *
 * Reads the current head first, for `createdAt` alone: the date belongs to the
 * conversation's first appearance, not to the write in hand (see
 * ConversationDraft). One extra read of in-memory session storage, once per
 * generation and once per answered question — nowhere near the streaming loop
 * this split was made for.
 */
export async function saveConversation(c: ConversationDraft): Promise<void> {
  const existing = (await chrome.storage.session.get<Record<string, unknown>>(CONV(c.videoId)))[CONV(c.videoId)];
  const head: StoredHead = {
    videoId: c.videoId,
    meta: c.meta,
    turns: c.turns.slice(0, -1),
    createdAt: readCreatedAt(existing) ?? Date.now(),
  };
  const lastTurn = c.turns.at(-1);
  const items: Record<string, unknown> = { [CONV(c.videoId)]: head };
  if (lastTurn !== undefined) {
    items[TAIL(c.videoId)] = {
      turn: lastTurn, status: c.status, provenance: c.provenance,
    } satisfies StoredTail;
  }
  await chrome.storage.session.set(items);
}

/** The stamp already on a stored head, or `undefined` when there is none to keep. */
function readCreatedAt(stored: unknown): number | undefined {
  if (typeof stored !== 'object' || stored === null) return undefined;
  const value = (stored as { createdAt?: unknown }).createdAt;
  return typeof value === 'number' ? value : undefined;
}

/**
 * Writes ONLY the tail (last turn + status + provenance), never the head. This
 * is what runSummary's streaming loop calls on every chunk (throttled, see
 * lib/throttled-persist.ts): it never reserialises the transcript-bearing user
 * turn, which is what makes it cheap to call hundreds of times per summary.
 *
 * Assumes an earlier saveConversation already wrote the head for this video.
 * The caller MUST guarantee that — see orchestrator.ts, which writes head and
 * tail together on a stream's first write, then switches to this function.
 */
export async function saveConversationTail(
  videoId: string, turn: ChatTurn, status: ConversationStatus, provenance: SummaryMeta | null = null,
): Promise<void> {
  await chrome.storage.session.set({ [TAIL(videoId)]: { turn, status, provenance } satisfies StoredTail });
}

/**
 * What the panel's tab bar needs about one conversation, and nothing else: no
 * turns, and therefore no transcript. Listing the session must not deserialise
 * 35 to 82 KB per video (see StoredHead) to draw a row of titles.
 */
export type ConversationSummary = {
  videoId: string;
  meta: VideoMeta | null;
  createdAt: number;
  status: ConversationStatus;
};

/**
 * Every conversation of the session, in no particular order — ordering is the
 * tab bar's decision (see lib/session-tabs.ts).
 *
 * One `get(null)` rather than a query per video: nothing else records which
 * videos this session has summarised, so the keys ARE the list. Heads are
 * recognised by their key shape (HEAD_KEY) and paired with their tail for the
 * status, which is what tells a running generation from a finished summary.
 *
 * A head with no tail reads as 'done', exactly as getConversation does, and for
 * the same reason: it has no assistant text to present as in progress.
 */
export async function listConversations(): Promise<ConversationSummary[]> {
  const all = await chrome.storage.session.get<Record<string, unknown>>(null);
  const conversations: ConversationSummary[] = [];

  for (const [key, stored] of Object.entries(all)) {
    const videoId = HEAD_KEY.exec(key)?.[1];
    if (videoId === undefined) continue;
    const tail = all[TAIL(videoId)] as StoredTail | undefined;
    conversations.push({
      videoId,
      meta: (stored as StoredHead).meta ?? null,
      createdAt: readCreatedAt(stored) ?? 0,
      // A legacy conversation carries its status in the head and has no tail
      // (see isLegacyConversation); reading the head first covers it.
      status: (stored as { status?: ConversationStatus }).status ?? tail?.status ?? 'done',
    });
  }

  return conversations;
}

/**
 * What a changed `chrome.storage.session` key belongs to, or `null` for a key
 * that is not part of a conversation.
 *
 * Exported so a listener can tell a NEW conversation from a chunk of one that
 * already exists WITHOUT re-reading the area. That distinction is worth a
 * function: `listConversations` reads every value, transcripts included, and the
 * streaming loop writes a tail up to once a second. Re-listing on each of those
 * would pay 35 to 82 KB per stored video, per second, to learn nothing (see
 * StoredHead).
 */
export function readConversationKey(key: string): { kind: 'head' | 'tail'; videoId: string } | null {
  const head = HEAD_KEY.exec(key)?.[1];
  if (head !== undefined) return { kind: 'head', videoId: head };

  const tail = /^conv:([^:]+):tail$/.exec(key)?.[1];
  return tail === undefined ? null : { kind: 'tail', videoId: tail };
}

/** The status carried by a tail as chrome.storage hands it to a listener, if it is one. */
export function readTailStatus(value: unknown): ConversationStatus | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const status = (value as { status?: unknown }).status;
  return status === 'streaming' || status === 'done' || status === 'error' ? status : undefined;
}

/**
 * Forgets a conversation whole — head, tail, and the suggestions key sessions
 * older than this build may still carry (see QUICK).
 *
 * This IS what closing a tab does: the bar is derived from what is stored, so
 * there is no separate tab state to keep in step. One `remove` call for the
 * three keys, so no listener ever observes a half-deleted conversation.
 */
export async function deleteConversation(videoId: string): Promise<void> {
  await chrome.storage.session.remove([CONV(videoId), TAIL(videoId), QUICK(videoId)]);
}

/**
 * Removes the summary cache earlier versions kept in `chrome.storage.local`
 * under the 'cache' key, for up to 30 days.
 *
 * Summaries now live in `chrome.storage.session` alone and are gone when the
 * browser closes. Leaving that entry behind would keep months of summaries on
 * disk with nothing left in the interface to show or clear them, which is the
 * opposite of what removing the cache was for. Called on install AND on update
 * (see background.ts): only an update can find one.
 */
export async function dropLegacyCache(): Promise<void> {
  await chrome.storage.local.remove('cache');
}
