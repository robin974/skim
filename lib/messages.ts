/**
 * Metadata is not decorative: it measurably improves the summary. Channel name
 * and description let the model attribute claims to whoever made them, even
 * when the speaker never says their own name.
 */
export type VideoMeta = {
  videoId: string;
  title: string;
  channel: string;
  description: string;
  durationSeconds: number;
};

export type RawSegment = { timestamp: string; text: string };

export type TranscriptResult =
  | { ok: true; segments: RawSegment[]; language: string | null }
  | { ok: false; reason: 'no-panel' | 'no-segments' | 'incomplete' };

export type Msg =
  | {
      type: 'SUMMARIZE';
      videoId: string;
      meta?: VideoMeta;
      /**
       * Generate even when this video already has a finished conversation,
       * replacing it (see runSummary, lib/orchestrator.ts). Absent or `false` is
       * the normal path, which re-displays what exists instead.
       */
      regenerate?: boolean;
    }
  // questionId is minted by the panel (crypto.randomUUID()) BEFORE sending, so
  // the answer's StreamEvents carry their own link back to the displayed
  // conversation entry instead of the panel guessing the pairing from its state.
  | { type: 'ASK'; videoId: string; question: string; questionId: string }
  | { type: 'GET_TRANSCRIPT'; videoId: string }
  | { type: 'GET_META'; videoId: string }
  | { type: 'SEEK'; videoId: string; seconds: number }
  | { type: 'GET_STATE'; videoId: string | null }
  // Sent by the options page once a key validates and a resume was pending
  // (lib/pending-resume.ts). Unlike SUMMARIZE this MUST NOT call
  // sidePanel.open(): no user gesture on the YouTube tab carries the call, and
  // the panel is already open — it is what showed the 'no-key' error.
  | { type: 'RESUME_SUMMARY'; videoId: string; tabId: number };

/**
 * Which stream a CHUNK/STATE/ERROR belongs to: the video summary, or one
 * follow-up answer (identified by its questionId, see Msg/ASK above).
 *
 * Two streams can be in flight for the same video, so the panel MUST NOT infer
 * the owner from its own state — the discriminant travels with the event.
 */
export type StreamTarget = { kind: 'summary' } | { kind: 'answer'; questionId: string };

/**
 * What actually produced a finished summary. Carried by the `status:'done'`
 * STATE that targets the summary itself, and stored with the conversation
 * (lib/conversations.ts) so a re-displayed summary keeps ITS provenance. Never
 * read back from current settings: settings can change between generation and
 * display.
 *
 * `model` may be an empty string — `activeModel` falls back to the provider's
 * defaultModel, which the 'custom' provider does not have (lib/settings.ts).
 * The provenance line then names the provider alone rather than an empty
 * parenthesis (see describeSummaryProvenance, lib/summary-meta.ts).
 */
export type SummaryMeta = {
  producedAt: number;
  provider: string;
  model: string;
  /** The effort parameter was rejected (400) and the request replayed without it. See streamChat, lib/llm/stream.ts. */
  effortDropped?: boolean;
};

/**
 * Broadcast INSTEAD of a generation when a summary is asked for a video that
 * already has a finished conversation in this session (see runSummary,
 * lib/orchestrator.ts). The panel reloads that conversation through GET_STATE.
 *
 * Carries nothing but the video: the conversation holds the whole prompt,
 * transcript included — 35 to 82 KB measured, see fixtures/README.md — and the
 * panel can read it from storage itself. Sending it through chrome.runtime
 * would pay that cost twice for the same display.
 */
export type RestoreEvent = { type: 'RESTORE'; videoId: string };

/**
 * Broadcast on a click on the toolbar icon. The panel of THAT window closes
 * itself; a panel of any other window ignores it. The service worker cannot do
 * the closing itself — see lib/panel-toggle.ts.
 */
export type ClosePanelEvent = { type: 'CLOSE_PANEL'; windowId: number };

/** Everything the service worker broadcasts to the panel. */
export type PanelBroadcast = StreamEvent | RestoreEvent | ClosePanelEvent;

export type StreamEvent =
  | {
      type: 'STATE'; videoId: string; target: StreamTarget; status: 'loading' | 'streaming' | 'done' | 'error';
      /** Only on the `status:'done'` STATE that ends a summary (target.kind === 'summary'). */
      meta?: SummaryMeta;
    }
  | { type: 'CHUNK'; videoId: string; target: StreamTarget; text: string }
  // `message` is diagnostic only. The panel renders the plan resolved from
  // `code` (see ERROR_PLANS, lib/panel-errors.ts), never this string.
  | { type: 'ERROR'; videoId: string; target: StreamTarget; code: ErrorCode; message: string };

export type ErrorCode =
  | 'no-key' | 'invalid-key' | 'quota' | 'overloaded'
  | 'offline' | 'not-public' | 'too-long' | 'no-transcript'
  // 'transcript-unavailable': YouTube's transcript panel could not be opened or
  // read (covers TranscriptResult 'no-panel' and 'no-segments').
  // 'transcript-incomplete': it was read, but does not cover the whole video.
  // Summarising truncated text would produce a wrong summary that nothing marks
  // as wrong, so we refuse instead.
  | 'transcript-unavailable' | 'transcript-incomplete'
  // A follow-up question (ASK) for a video with no stored summary
  // (lib/conversations.ts): no history to load, so nothing to send the model.
  // Distinct from 'no-transcript' — subtitles are not the problem here.
  | 'no-conversation' | 'unknown';
