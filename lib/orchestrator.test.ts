// runSummary is the extension's core: transcript, provider call, Gemini video
// fallback, persistence. These tests exercise the REAL provider adapters
// and the REAL SSE parsing (lib/llm/stream.ts) — only the network boundary
// (fetchImpl) and the storage/chrome accesses are doubled.
import { describe, it, expect, vi, type Mock } from 'vitest';
import { runSummary, runAsk, type OrchestratorDeps, type AskDeps } from './orchestrator';
import {
  DEFAULT_SETTINGS, DEFAULT_PROMPT, effortKey, type Settings,
} from './settings';
import { getProvider } from './llm';
import { PROMPT_TOKENS } from './prompt-tokens';
import type { Msg, PanelBroadcast, StreamTarget, TranscriptResult, VideoMeta } from './messages';
import type { Conversation } from './conversations';

const SUMMARY: StreamTarget = { kind: 'summary' };

const baseSettings: Settings = {
  ...DEFAULT_SETTINGS,
  provider: 'openrouter',
  apiKeys: { openrouter: 'sk-or-test' },
  language: 'fr',
};

/**
 * Settings whose ACTIVE profile carries this prompt. buildPrompt reads
 * activePrompt() (lib/settings.ts), so a prompt under test has to be a profile:
 * the single `prompt` setting no longer exists, and the shipped profile is built
 * on read from DEFAULT_PROMPT.
 */
function withPrompt(prompt: string): Pick<Settings, 'profiles' | 'activeProfileId'> {
  return { profiles: [{ id: 'p', name: 'Profil de test', prompt }], activeProfileId: 'p' };
}

const okTranscript: TranscriptResult = {
  ok: true,
  language: 'fr',
  segments: [
    { timestamp: '0:00', text: 'Bonjour' },
    { timestamp: '0:05', text: 'le monde' },
  ],
};

const noTranscript: TranscriptResult = { ok: false, reason: 'no-panel' };

const fakeMeta: VideoMeta = {
  videoId: 'v1',
  title: 'Titre',
  channel: 'Chaîne',
  description: 'Description',
  durationSeconds: 120,
};

/**
 * A conversation as runSummary leaves it in storage.session: the prompt turn
 * (transcript included), the summary, and the provenance of that summary.
 */
function storedConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    videoId: 'v1',
    meta: fakeMeta,
    status: 'done',
    provenance: { producedAt: 5000, provider: 'OpenRouter', model: 'un-modèle' },
    createdAt: 1000,
    turns: [
      { role: 'user', text: 'Résume cette vidéo. Transcript : [0:00] Bonjour le monde.' },
      { role: 'assistant', text: 'Résumé déjà généré dans cette session.' },
    ],
    ...overrides,
  };
}

/** An SSE response in the OpenAI-compatible format. */
function sseOpenAI(chunks: string[]): Response {
  const body = chunks
    .map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`)
    .join('');
  return new Response(body, { status: 200 });
}

/**
 * An SSE response whose body is pushed chunk by chunk, under the test's explicit
 * control. Unlike sseOpenAI() above, whose whole body is available at once in an
 * in-memory Response, this leaves room to advance fake timers BETWEEN two chunks
 * — necessary for tests that must observe an intermediate stream state.
 */
function controlledSSEStream(): { response: Response; push: (chunk: string) => void; close: () => void } {
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
  });
  const encoder = new TextEncoder();
  return {
    response: new Response(stream, { status: 200 }),
    push: (chunk: string) => {
      const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`;
      controllerRef?.enqueue(encoder.encode(payload));
    },
    close: () => controllerRef?.close(),
  };
}

/** Stand-in for ask: answers by message type, as the content script would. */
function fakeAsk(responses: { transcript?: TranscriptResult; meta?: VideoMeta }): OrchestratorDeps['ask'] {
  return async <T,>(msg: Msg): Promise<T | undefined> => {
    if (msg.type === 'GET_TRANSCRIPT') return responses.transcript as T | undefined;
    if (msg.type === 'GET_META') return responses.meta as T | undefined;
    return undefined;
  };
}

/** Always a vi.fn<typeof fetch>() in these tests: never the real fetch. */
type FetchMock = Mock<typeof fetch>;

type DepsOverrides = Partial<Omit<OrchestratorDeps, 'fetchImpl'>> & {
  settings: Settings;
  fetchImpl?: FetchMock;
};

function makeDeps(overrides: DepsOverrides) {
  const emit = vi.fn();
  const fetchImpl: FetchMock = overrides.fetchImpl ?? vi.fn<typeof fetch>();
  const saveConversation = overrides.saveConversation ?? vi.fn<OrchestratorDeps['saveConversation']>(async () => {});
  const saveConversationTail =
    overrides.saveConversationTail ?? vi.fn<OrchestratorDeps['saveConversationTail']>(async () => {});
  const getConversation = overrides.getConversation ?? (async () => null);
  const ask = overrides.ask ?? (async () => undefined);
  const rememberPendingResume =
    overrides.rememberPendingResume ?? vi.fn<OrchestratorDeps['rememberPendingResume']>(async () => {});

  const deps: OrchestratorDeps = {
    emit,
    ask,
    getSettings: async () => overrides.settings,
    getConversation,
    saveConversation,
    saveConversationTail,
    tabId: overrides.tabId,
    rememberPendingResume,
    fetchImpl,
  };
  return { deps, emit, fetchImpl, saveConversation, saveConversationTail, rememberPendingResume };
}

describe('runSummary — the loading STATE is always the very first event emitted', () => {
  // THE test that matters: it must fail if the emission order is inverted in
  // lib/orchestrator.ts.
  const scenarios: { name: string; overrides: DepsOverrides }[] = [
    {
      name: 'aucune clé configurée',
      overrides: { settings: { ...baseSettings, apiKeys: {} } },
    },
    {
      name: 'conversation déjà en session',
      overrides: {
        settings: baseSettings,
        getConversation: async () => storedConversation(),
      },
    },
    {
      name: 'voie transcript',
      overrides: {
        settings: baseSettings,
        ask: fakeAsk({ transcript: okTranscript, meta: fakeMeta }),
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(sseOpenAI(['Bon', 'jour'])),
      },
    },
    {
      name: 'pas de transcript',
      overrides: {
        settings: baseSettings,
        ask: fakeAsk({ transcript: noTranscript, meta: fakeMeta }),
      },
    },
  ];

  it.each(scenarios)('$name', async ({ overrides }) => {
    const { deps, emit } = makeDeps(overrides);
    await runSummary('v1', deps);

    expect(emit.mock.calls.length).toBeGreaterThan(0);
    const first = emit.mock.calls[0]?.[0] as PanelBroadcast | undefined;
    expect(first).toEqual({ type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'loading' });
  });
});

describe('runSummary', () => {
  it("emits loading then a 'no-key' ERROR with no fetch, when there is no key", async () => {
    const { deps, emit, fetchImpl } = makeDeps({ settings: { ...baseSettings, apiKeys: {} } });
    await runSummary('v1', deps);

    const events = emit.mock.calls.map((c) => c[0] as PanelBroadcast);
    expect(events).toEqual([
      { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'loading' },
      { type: 'ERROR', videoId: 'v1', target: SUMMARY, code: 'no-key', message: 'No key configured' },
    ]);
    expect(fetchImpl.mock.calls.length).toBe(0);
  });

  it(
    'video already summarised in this session: loading then RESTORE — no fetch, no write, '
    + 'and the summary is never re-emitted chunk by chunk',
    async () => {
      const { deps, emit, fetchImpl, saveConversation, saveConversationTail } = makeDeps({
        settings: baseSettings,
        getConversation: async () => storedConversation(),
      });
      await runSummary('v1', deps);

      const events = emit.mock.calls.map((c) => c[0] as PanelBroadcast);
      // No CHUNK and no 'done' STATE: the panel rebuilds the WHOLE display from
      // the stored conversation, questions already asked included, which those
      // events cannot carry (see RestoreEvent, lib/messages.ts).
      expect(events).toEqual([
        { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'loading' },
        { type: 'RESTORE', videoId: 'v1' },
      ]);
      expect(fetchImpl.mock.calls.length).toBe(0);
      expect(saveConversation).not.toHaveBeenCalled();
      expect(saveConversationTail).not.toHaveBeenCalled();
    },
  );

  it('restores with no key configured: nothing is sent, so nothing needs a key', async () => {
    const { deps, emit } = makeDeps({
      settings: { ...baseSettings, apiKeys: {} },
      getConversation: async () => storedConversation(),
    });
    await runSummary('v1', deps);

    const events = emit.mock.calls.map((c) => c[0] as PanelBroadcast);
    expect(events.at(-1)).toEqual({ type: 'RESTORE', videoId: 'v1' });
    expect(events.some((e) => e.type === 'ERROR')).toBe(false);
  });

  it('regenerates instead of restoring an interrupted conversation, which has nothing worth showing', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseOpenAI(['Bon', 'jour']));
    const { deps, emit } = makeDeps({
      settings: baseSettings,
      getConversation: async () => storedConversation({ status: 'streaming' }),
      ask: fakeAsk({ transcript: okTranscript, meta: fakeMeta }),
      fetchImpl,
    });
    await runSummary('v1', deps);

    const events = emit.mock.calls.map((c) => c[0] as PanelBroadcast);
    expect(events.some((e) => e.type === 'RESTORE')).toBe(false);
    expect(fetchImpl.mock.calls.length).toBe(1);
  });

  it('restores a conversation that already carries follow-up questions, judging it on the summary turn', async () => {
    const { deps, emit, fetchImpl } = makeDeps({
      settings: baseSettings,
      getConversation: async () => storedConversation({
        turns: [
          { role: 'user', text: 'Résume cette vidéo. Transcript : [0:00] Bonjour le monde.' },
          { role: 'assistant', text: 'Résumé déjà généré.' },
          { role: 'user', text: 'Et le budget ?' },
          { role: 'assistant', text: '3M€.' },
        ],
      }),
    });
    await runSummary('v1', deps);

    expect(emit.mock.calls.map((c) => c[0] as PanelBroadcast).at(-1)).toEqual({ type: 'RESTORE', videoId: 'v1' });
    expect(fetchImpl.mock.calls.length).toBe(0);
  });

  it('regenerates rather than restore an EMPTY summary, which the panel renders as nothing at all', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseOpenAI(['Bon', 'jour']));
    const { deps, emit } = makeDeps({
      settings: baseSettings,
      getConversation: async () => storedConversation({
        turns: [{ role: 'user', text: 'Résume.' }, { role: 'assistant', text: '' }],
      }),
      ask: fakeAsk({ transcript: okTranscript, meta: fakeMeta }),
      fetchImpl,
    });
    await runSummary('v1', deps);

    expect(emit.mock.calls.map((c) => c[0] as PanelBroadcast).some((e) => e.type === 'RESTORE')).toBe(false);
    expect(fetchImpl.mock.calls.length).toBe(1);
  });

  it('emits the received CHUNKs and saves the conversation with both turns, on the transcript path', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseOpenAI(['Bon', 'jour']));
    const saveConversation = vi.fn<OrchestratorDeps['saveConversation']>(async () => {});
    const saveConversationTail = vi.fn<OrchestratorDeps['saveConversationTail']>(async () => {});
    const { deps, emit } = makeDeps({
      settings: baseSettings,
      ask: fakeAsk({ transcript: okTranscript, meta: fakeMeta }),
      fetchImpl,
      saveConversation,
      saveConversationTail,
    });
    await runSummary('v1', deps);

    const events = emit.mock.calls.map((c) => c[0] as PanelBroadcast);
    const chunks = events
      .filter((e) => e.type === 'CHUNK')
      .map((e) => (e.type === 'CHUNK' ? e.text : ''));
    expect(chunks).toEqual(['Bon', 'jour']);
    const openrouter = getProvider('openrouter');
    expect(events.at(-1)).toEqual({
      type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'done',
      meta: {
        producedAt: expect.any(Number),
        provider: openrouter.label, model: openrouter.defaultModel,
      },
    });

    // Both chunks arrive well within the throttle interval (1 s, see
    // PERSIST_INTERVAL_MS in lib/orchestrator.ts), so no incremental write fires
    // during the loop itself. The ONLY write of this whole generation is flush()'s
    // at the end of the stream, carrying head AND tail in one call: an answer
    // shorter than the throttle interval must never cost more than one write.
    expect(saveConversation).toHaveBeenCalledTimes(1);
    expect(saveConversationTail).not.toHaveBeenCalled();
    const last = saveConversation.mock.calls.at(-1)?.[0] as Conversation | undefined;
    expect(last?.status).toBe('done');
    expect(last?.turns).toHaveLength(2);
    expect(last?.turns[0]?.role).toBe('user');
    // The user turn carries the grouped transcript, substituted into the prompt.
    expect(last?.turns[0]?.text).toContain('[0:00] Bonjour le monde');
    // The final text written is COMPLETE — both chunks accumulated — never an
    // intermediate one abandoned along the way.
    expect(last?.turns[1]).toEqual({ role: 'assistant', text: 'Bonjour' });
  });

  // Past the throttle interval, incremental persistence must fire, marked
  // 'streaming', and touch only the tail — a head reserialisation per chunk is
  // the fault this split exists to prevent (150+ s measured).
  //
  // The TERMINAL write is the deliberate exception: it goes through
  // saveConversation, head included, so a conversation forgotten mid-generation
  // — closing its tab deletes it, see lib/session-tabs.ts — does not end up a
  // tail beside no head, i.e. a summary paid for and impossible to display.
  //
  // Uses controlledSSEStream rather than sseOpenAI so a fake timer advance can be
  // slipped in BETWEEN two chunks: with a fully in-memory response, nothing would
  // guarantee the stream does not finish before the first advance.
  it(
    "a stream outlasting the throttle interval writes the tail alone as it goes, "
    + 'and rewrites the head once at the end',
    async () => {
      const { response, push, close } = controlledSSEStream();
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
      const saveConversation = vi.fn<OrchestratorDeps['saveConversation']>(async () => {});
      const saveConversationTail = vi.fn<OrchestratorDeps['saveConversationTail']>(async () => {});
      const { deps } = makeDeps({
        settings: baseSettings,
        ask: fakeAsk({ transcript: okTranscript, meta: fakeMeta }),
        fetchImpl,
        saveConversation,
        saveConversationTail,
      });

      vi.useFakeTimers();
      try {
        const promise = runSummary('v1', deps);
        await vi.advanceTimersByTimeAsync(0); // lets fetchImpl resolve; the reader waits on its first read()

        push('Bon');
        // Lets the first chunk be read, triggering the throttle's very first
        // update(), which schedules a write at +1000 ms.
        await vi.advanceTimersByTimeAsync(0);
        // Still no write: less than one interval has elapsed.
        expect(saveConversation).not.toHaveBeenCalled();

        // Advances past the interval WHILE the stream is still open, before the
        // second chunk is pushed: that is the write that must happen, marked
        // 'streaming'.
        await vi.advanceTimersByTimeAsync(1000);

        // The stream's FIRST write carries the head, since none exists yet.
        expect(saveConversation).toHaveBeenCalledTimes(1);
        const first = saveConversation.mock.calls[0]?.[0] as Conversation | undefined;
        expect(first?.status).toBe('streaming');
        expect(first?.turns[1]).toEqual({ role: 'assistant', text: 'Bon' });
        // Le socle porte bien le tour utilisateur, transcript inclus.
        expect(first?.turns[0]?.text).toContain('[0:00] Bonjour le monde');

        // A second chunk, a second interval: THIS write is the incremental one,
        // and it must not go near the head again.
        push('jour');
        await vi.advanceTimersByTimeAsync(1000);

        expect(saveConversation).toHaveBeenCalledTimes(1);
        expect(saveConversationTail).toHaveBeenCalledTimes(1);
        expect(saveConversationTail.mock.calls[0]?.[1]).toEqual({ role: 'assistant', text: 'Bonjour' });
        expect(saveConversationTail.mock.calls[0]?.[2]).toBe('streaming');

        close();
        await vi.runAllTimersAsync();
        await promise;
      } finally {
        vi.useRealTimers();
      }

      // The terminal flush() rewrites the head beside the tail, and carries the
      // COMPLETE text ('Bonjour', not just 'Bon') with status 'done'.
      expect(saveConversation).toHaveBeenCalledTimes(2);
      const last = saveConversation.mock.calls.at(-1)?.[0] as Conversation | undefined;
      expect(last?.status).toBe('done');
      expect(last?.turns[1]).toEqual({ role: 'assistant', text: 'Bonjour' });
      expect(last?.turns[0]?.text).toContain('[0:00] Bonjour le monde');

      // Twice for a whole generation, and never once per chunk: the incremental
      // writes above stayed on the tail.
      expect(saveConversationTail).toHaveBeenCalledTimes(1);
    },
  );

  // The orchestrator is the only place that knows both what settings.efforts
  // holds (through resolveEffort, lib/settings.ts) AND which provider and model
  // will receive the request. These two tests are therefore the end-to-end proof
  // — setting to real HTTP body — that the per-provider unit tests cannot give
  // on their own.
  it("sends reasoning.enabled:false to OpenRouter with no level stored for the active model, since DEFAULT_EFFORT is 'off'", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseOpenAI(['Bon', 'jour']));
    const { deps } = makeDeps({
      settings: baseSettings, // baseSettings inherits DEFAULT_SETTINGS.efforts === {}
      ask: fakeAsk({ transcript: okTranscript, meta: fakeMeta }),
      fetchImpl,
    });
    await runSummary('v1', deps);

    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.reasoning).toEqual({ enabled: false });
  });

  it("sends reasoning.effort to OpenRouter when 'high' is set for the active model", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseOpenAI(['Bon', 'jour']));
    const { deps } = makeDeps({
      settings: {
        ...baseSettings,
        efforts: { [effortKey('openrouter', 'anthropic/claude-sonnet-4.5')]: 'high' },
      },
      ask: fakeAsk({ transcript: okTranscript, meta: fakeMeta }),
      fetchImpl,
    });
    await runSummary('v1', deps);

    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.reasoning).toEqual({ effort: 'high' });
  });

  // The three transcript failure reasons used to be flattened onto the generic
  // 'no-transcript' code, which pointed debugging at a missing key while the real
  // cause was a selector bug in the extension itself.
  const transcriptFailureScenarios: {
    name: string;
    reason: 'no-panel' | 'no-segments' | 'incomplete';
    expectedCode: 'transcript-unavailable' | 'transcript-incomplete';
  }[] = [
    { name: 'no-panel', reason: 'no-panel', expectedCode: 'transcript-unavailable' },
    { name: 'no-segments', reason: 'no-segments', expectedCode: 'transcript-unavailable' },
    { name: 'incomplete', reason: 'incomplete', expectedCode: 'transcript-incomplete' },
  ];

  it.each(transcriptFailureScenarios)(
    "no transcript ($reason): ERROR '$expectedCode', no fetch",
    async ({ reason, expectedCode }) => {
      const { deps, emit, fetchImpl } = makeDeps({
        settings: baseSettings,
        ask: fakeAsk({ transcript: { ok: false, reason }, meta: fakeMeta }),
      });
      await runSummary('v1', deps);

      const events = emit.mock.calls.map((c) => c[0] as PanelBroadcast);
      expect(events[0]).toEqual({ type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'loading' });
      // No 'streaming' in between: nothing is announced that the next event has
      // to take back.
      expect(events).toHaveLength(2);
      const last = events.at(-1);
      expect(last?.type).toBe('ERROR');
      expect(last).toMatchObject({ type: 'ERROR', videoId: 'v1', target: SUMMARY, code: expectedCode });
      expect(fetchImpl.mock.calls.length).toBe(0);
    },
  );

  it("emits the generic 'no-transcript' ERROR when ask returns nothing at all", async () => {
    const { deps, emit, fetchImpl } = makeDeps({
      settings: baseSettings,
      ask: async () => undefined,
    });
    await runSummary('v1', deps);

    const events = emit.mock.calls.map((c) => c[0] as PanelBroadcast);
    expect(events).toEqual([
      { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'loading' },
      {
        type: 'ERROR', videoId: 'v1', target: SUMMARY, code: 'no-transcript',
        // Describes what is OBSERVED — no answer from the page — never an absence
        // of subtitles, which this path precisely cannot
        // constater (voir transcriptFailure).
        message: "This video's page could not be read: no tab displays it, or the page is not ready.",
      },
    ]);
    expect(fetchImpl.mock.calls.length).toBe(0);
  });

});

// runSummary's streaming loop used to `await persist(...)` on EVERY chunk, so
// the stream WAITED on storage before reading the next one. On a 61-minute
// summary (~333 chunks, an 80-86 KB transcript per write — see
// fixtures/README.md and fixtures/transcript-uRdFqlO12Mk.json), that is the loop
// that measured 150+ seconds for a summary the model produces in under a second.
// This pins the bug precisely: with deliberately slow storage, never resolved
// during the observed window, EVERY chunk must still be read and emitted —
// reading the stream must NEVER depend on persistence speed.
//
// Replayed against the pre-fix implementation, this fails: only the very first
// CHUNK is emitted and then nothing, the loop stuck on the first
// `await persist(...)`, waiting on a write that never completes within the
// observed window.
describe('runSummary — reading the stream must never wait on persistence', () => {
  it(
    'with deliberately slow storage that never resolves, every chunk is read and emitted '
    + 'without waiting on a single write',
    async () => {
      const manyChunks = Array.from({ length: 20 }, (_, i) => `frag${i}-`);
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseOpenAI(manyChunks));

      // Neither resolved nor rejected throughout the window this test observes —
      // le pire cas plausible pour chrome.storage.session (lent, voire
      // temporairement indisponible).
      const neverResolves = new Promise<void>(() => {});
      const saveConversation = vi.fn<OrchestratorDeps['saveConversation']>(async () => { await neverResolves; });
      const saveConversationTail =
        vi.fn<OrchestratorDeps['saveConversationTail']>(async () => { await neverResolves; });

      const { deps, emit } = makeDeps({
        settings: baseSettings,
        ask: fakeAsk({ transcript: okTranscript, meta: fakeMeta }),
        fetchImpl,
        saveConversation,
        saveConversationTail,
      });

      // Deliberately NOT awaited here: under the old code this promise would
      // never resolve, persist() being stuck on neverResolves, and an
      // `await runSummary(...)` would time the test out instead of producing a
      // readable assertion about what was actually read.
      const done = runSummary('v1', deps);

      // Lets the reading loop run to completion: every `await fetchImpl(...)` and
      // `await reader.read()` is a genuine suspension point resolved by real
      // microtasks, but NOTHING in the loop itself depends on `neverResolves`. A
      // short real delay is more than enough to exhaust everything that CAN
      // progress.
      await new Promise((resolve) => { setTimeout(resolve, 30); });

      const chunkTexts = emit.mock.calls
        .map((c) => c[0] as PanelBroadcast)
        .filter((e) => e.type === 'CHUNK')
        .map((e) => (e.type === 'CHUNK' ? e.text : ''));

      // The point that matters: EVERY chunk was emitted while the persistence
      // write triggered at the very end of the stream is necessarily still
      // waiting on `neverResolves`.
      expect(chunkTexts).toEqual(manyChunks);

      // Corollary: the final 'done' STATE, emitted only AFTER the flush, has NOT
      // arrived — proof that what was just observed is a finished read with
      // persistence still blocked, not a run that happened to complete.
      const stateEvents = emit.mock.calls
        .map((c) => c[0] as PanelBroadcast)
        .filter((e) => e.type === 'STATE');
      expect(stateEvents.some((e) => e.status === 'done')).toBe(false);

      // `done` stays deliberately pending here, since neverResolves never
      // resolves: there is nothing more to await, and the test stops on the
      // assertions above. `void` documents that the missing await is deliberate,
      // not an oversight.
      void done;
    },
  );
});

// The provenance (date, provider, model) must reach the panel through
// the final 'done' STATE, never by the panel reading current settings (see
// SummaryMeta, lib/messages.ts). It is ALSO persisted with the conversation:
// that copy is what a reopened panel, or a second summarise, redisplays. The
// reception side (state.meta) is covered by lib/panel-reducer.test.ts.
describe("runSummary — provenance emitted on the 'done' STATE and persisted", () => {
  it('persists the provenance with the conversation, on the terminal write and no earlier', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseOpenAI(['Frais']));
    const saveConversation = vi.fn<OrchestratorDeps['saveConversation']>(async () => {});
    const { deps, emit } = makeDeps({
      settings: baseSettings,
      ask: fakeAsk({ transcript: okTranscript, meta: fakeMeta }),
      fetchImpl,
      saveConversation,
    });
    await runSummary('v1', deps);

    // A summary shorter than the throttle interval: one single write, flush()'s,
    // carrying head and tail together (see makeTailPersist, lib/orchestrator.ts).
    expect(saveConversation).toHaveBeenCalledTimes(1);
    const saved = saveConversation.mock.calls[0]?.[0] as Conversation;
    const openrouter = getProvider('openrouter');
    expect(saved.provenance).toEqual({
      producedAt: expect.any(Number),
      provider: openrouter.label,
      model: openrouter.defaultModel,
    });

    // Exactly the provenance the panel was told, to the millisecond: one
    // Date.now() for the whole generation, never two that could differ.
    const done = emit.mock.calls.map((c) => c[0] as PanelBroadcast).at(-1);
    expect(done).toMatchObject({ status: 'done', meta: saved.provenance });
  });

  it('persists NO provenance for a failed generation: nothing settled to describe', async () => {
    // 429: refused outright, never retried (see withRetry, lib/llm/stream.ts),
    // so this test needs no timer control to reach the failure.
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 429 }));
    const saveConversation = vi.fn<OrchestratorDeps['saveConversation']>(async () => {});
    const { deps } = makeDeps({
      settings: baseSettings,
      ask: fakeAsk({ transcript: okTranscript, meta: fakeMeta }),
      fetchImpl,
      saveConversation,
    });

    await expect(runSummary('v1', deps)).rejects.toThrow();

    const saved = saveConversation.mock.calls.at(-1)?.[0] as Conversation;
    expect(saved.status).toBe('error');
    expect(saved.provenance).toBeNull();
  });
});

// The two halves of the fallback's honesty chain — streamChat does call
// onEffortDropped, and describeSummaryProvenance does render the sentence — each
// had their own test, but not the closure that links them, nor the conditional
// reporting into summaryMeta: runSummary itself. These two cover that central
// link end to end, from a real 400 on the REAL openrouter provider through to
// the 'done' STATE emitted to the panel.
describe("runSummary — le repli sur 400 (lib/llm/stream.ts) atteint bien SummaryMeta.effortDropped", () => {
  it(
    "first call refused (400 on the effort parameter sent by default, DEFAULT_EFFORT='off'): "
    + "the request resent without it succeeds, and the final 'done' STATE carries effortDropped:true",
    async () => {
      let calls = 0;
      const fetchImpl = vi.fn<typeof fetch>(async () => {
        calls += 1;
        if (calls === 1) return new Response('nope', { status: 400 });
        return sseOpenAI(['Bon', 'jour']);
      });
      const { deps, emit } = makeDeps({
        settings: baseSettings, // efforts: {} inherited from DEFAULT_SETTINGS → DEFAULT_EFFORT 'off' does go out
        ask: fakeAsk({ transcript: okTranscript, meta: fakeMeta }),
        fetchImpl,
      });
      await runSummary('v1', deps);

      // Two requests: the first with reasoning.enabled:false (refused), then the
      // fallback without the parameter (which succeeds). Never a third.
      expect(fetchImpl.mock.calls.length).toBe(2);
      const events = emit.mock.calls.map((c) => c[0] as PanelBroadcast);
      const chunks = events.filter((e) => e.type === 'CHUNK').map((e) => (e.type === 'CHUNK' ? e.text : ''));
      expect(chunks).toEqual(['Bon', 'jour']);
      expect(events.at(-1)).toMatchObject({
        type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'done',
        meta: { effortDropped: true },
      });
    },
  );

  it('no 400: no fallback, and SummaryMeta carries no effortDropped at all, never an explicit false', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseOpenAI(['Bon', 'jour']));
    const { deps, emit } = makeDeps({
      settings: baseSettings,
      ask: fakeAsk({ transcript: okTranscript, meta: fakeMeta }),
      fetchImpl,
    });
    await runSummary('v1', deps);

    expect(fetchImpl.mock.calls.length).toBe(1);
    const events = emit.mock.calls.map((c) => c[0] as PanelBroadcast);
    const done = events.at(-1);
    expect(done?.type).toBe('STATE');
    expect(done && 'meta' in done ? done.meta : undefined).not.toHaveProperty('effortDropped');
  });

  // streamChat's fallback (one resend WITHOUT the parameter) and withRetry's
  // attempts (on a RETRYABLE error) are two independent recovery layers, composed
  // here. Without memory SHARED between them — the effortDropped flag, held
  // outside the withRetry closure, see runSummary — a second withRetry attempt
  // would rebuild the request with resolveEffort(settings) and resend the
  // parameter already known to be refused: another 400, another fallback, on
  // EVERY attempt, up to 8 network requests for one summary instead of 4, half of
  // them doomed. The two tests above cannot catch this: one withRetry attempt
  // suffices there, so the composition is never exercised.
  it(
    '400 → 503 → success, composing the fallback AND a withRetry attempt: '
    + 'only one of the three requests carries the reasoning parameter, because '
    + 'withRetry must NEVER resend a parameter already known to be refused',
    async () => {
      let calls = 0;
      const fetchImpl = vi.fn<typeof fetch>(async () => {
        calls += 1;
        // 1) initial request, with the parameter: refused, triggering
        //    streamChat's fallback WITHIN this same withRetry attempt.
        if (calls === 1) return new Response('nope', { status: 400 });
        // 2) the fallback itself, without the parameter, fails in turn on a
        //    erreur RETRYABLE cette fois (503) → withRetry rejoue toute la
        //    retryable error: a second complete attempt.
        if (calls === 2) return new Response('slow', { status: 503 });
        // 3) that second withRetry attempt must NOT resend the parameter already
        //    refused at step 1 — what this test checks.
        return sseOpenAI(['ok']);
      });
      const { deps } = makeDeps({
        settings: baseSettings, // efforts: {} → DEFAULT_EFFORT 'off' sent by default
        ask: fakeAsk({ transcript: okTranscript, meta: fakeMeta }),
        fetchImpl,
      });

      // withRetry really waits (5 s before its second attempt, see
      // lib/llm/stream.ts): without fake timers this test would wait for real.
      // vi.runAllTimersAsync() lets every scheduled delay elapse without slowing
      // the test — the same pattern as the streaming-performance test above.
      vi.useFakeTimers();
      try {
        const done = runSummary('v1', deps);
        await vi.runAllTimersAsync();
        await done;
      } finally {
        vi.useRealTimers();
      }

      expect(calls).toBe(3);
      const bodies = fetchImpl.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
      // The central point: ONLY the very first request carries the parameter.
      // Without the fix, the third — withRetry's second attempt — would carry it
      // again.
      expect(bodies[0]).toHaveProperty('reasoning');
      expect(bodies[1]).not.toHaveProperty('reasoning');
      expect(bodies[2]).not.toHaveProperty('reasoning');
    },
  );
});

// The panel's regenerate button restarts THIS video's summary rather than
// redisplaying it, and the fresh result replaces the stored conversation. Only
// that video's conversation is affected.
describe('runSummary — regenerate generates instead of redisplaying', () => {
  it('never reads the stored conversation with regenerate=true, and overwrites it with the fresh summary', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseOpenAI(['Frais']));
    const getConversation = vi.fn<OrchestratorDeps['getConversation']>(async () => storedConversation());
    const saveConversation = vi.fn<OrchestratorDeps['saveConversation']>(async () => {});
    const { deps, emit } = makeDeps({
      settings: baseSettings,
      ask: fakeAsk({ transcript: okTranscript, meta: fakeMeta }),
      fetchImpl,
      getConversation,
      saveConversation,
    });

    await runSummary('v1', deps, true);

    // Never READ: no RESTORE, and no trace of the old text in the events — only
    // the fresh one.
    expect(getConversation).not.toHaveBeenCalled();
    const events = emit.mock.calls.map((c) => c[0] as PanelBroadcast);
    expect(events.some((e) => e.type === 'RESTORE')).toBe(false);
    const chunks = events.filter((e) => e.type === 'CHUNK').map((e) => (e.type === 'CHUNK' ? e.text : ''));
    expect(chunks).toEqual(['Frais']);
    expect(fetchImpl.mock.calls.length).toBe(1);

    // ... and yet WRITTEN afterwards: the stored conversation now holds the fresh
    // summary, so the next summarise of this video redisplays that one.
    const saved = saveConversation.mock.calls.at(-1)?.[0] as Conversation;
    expect(saved.videoId).toBe('v1');
    expect(saved.turns.at(-1)?.text).toBe('Frais');
  });

  it('keeps reading the stored conversation with regenerate=false, the default', async () => {
    const getConversation = vi.fn<OrchestratorDeps['getConversation']>(async () => storedConversation());
    const { deps } = makeDeps({ settings: baseSettings, getConversation });

    await runSummary('v1', deps); // regenerate omis

    expect(getConversation).toHaveBeenCalledTimes(1);
  });
});

// {language} must be substituted with the language's NAME, not the stored locale
// code, or the model receives an absurd instruction — invisible while the browser
// language matches the transcript's, and wrong as soon as they differ. Driven
// through the REAL runSummary with a fake fetchImpl, rather than a unit test of
// languageName() in isolation, to prove the substitution really happens in the
// prompt that goes on the wire.
describe('runSummary — {language} substituted with the language NAME, not the code', () => {
  it("puts the language name in the body sent, never the raw code", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseOpenAI(['Bon', 'jour']));
    const { deps } = makeDeps({
      settings: { ...baseSettings, language: 'fr' },
      ask: fakeAsk({ transcript: okTranscript, meta: fakeMeta }),
      fetchImpl,
    });
    await runSummary('v1', deps);

    expect(fetchImpl.mock.calls.length).toBe(1);
    const init = fetchImpl.mock.calls[0]?.[1];
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
    const sent = body.messages?.[0]?.content as string;

    expect(sent).toContain('français');
    expect(sent).not.toContain('en fr.');
  });
});

// The output language is a SETTING, not a property of the prompt: it must reach
// the model whatever the prompt says, a custom prompt that never mentions a
// language included (see LANGUAGE_INSTRUCTION, lib/settings.ts). Driven through
// the REAL runSummary, because what is being asserted is the text on the wire.
describe('runSummary — the language instruction is appended to every prompt', () => {
  /** The prompt actually sent, for an arbitrary stored prompt. */
  async function sentPromptFor(prompt: string): Promise<string> {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseOpenAI(['ok']));
    const { deps } = makeDeps({
      settings: { ...baseSettings, language: 'fr', ...withPrompt(prompt) },
      ask: fakeAsk({ transcript: okTranscript, meta: fakeMeta }),
      fetchImpl,
    });
    await runSummary('v1', deps);

    const init = fetchImpl.mock.calls[0]?.[1];
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
    return body.messages?.[0]?.content as string;
  }

  it('names the language, for a shipped prompt that no longer mentions one', async () => {
    const sent = await sentPromptFor(DEFAULT_PROMPT);

    expect(sent).toContain('Write in français');
    expect(sent).not.toContain('{language}');
  });

  it('appends it to a custom prompt that says nothing about language', async () => {
    expect(await sentPromptFor('Liste les chiffres cités.\n{transcript}')).toContain('Write in français');
  });

  // After the input data, transcript included: an instruction placed before
  // 20,000 tokens of transcript is the one that gets diluted.
  it('places it after the transcript, never before', async () => {
    const sent = await sentPromptFor(DEFAULT_PROMPT);

    expect(sent).toContain('le monde');
    expect(sent.indexOf('OUTPUT LANGUAGE')).toBeGreaterThan(sent.indexOf('le monde'));
  });

  // The options page no longer offers {language}, but a profile stored while it
  // did still carries it. Such a prompt states its language twice, which is
  // harmless; leaving the placeholder literal in the text sent is not.
  it('substitutes {language} in a prompt stored before the token was withdrawn', async () => {
    const sent = await sentPromptFor('Réponds en {language}.\n{transcript}');

    expect(sent).toContain('Réponds en français.');
    expect(sent).not.toContain('{language}');
    expect(sent).toContain('OUTPUT LANGUAGE');
  });
});

// settings.customBaseUrl only means something for the
// 'custom' (voir lib/settings.ts, champ customBaseUrl). Avant ce correctif,
// it was passed as the ProviderConfig's baseUrl whatever the active provider
// was: someone who had entered a custom endpoint and then switched back to
// another provider saw their requests go to that leftover endpoint instead
// du defaultBaseUrl du provider choisi.
describe("runSummary — customBaseUrl must only reach the 'custom' provider", () => {
  it("sends to OpenRouter's URL, not to customBaseUrl, when openrouter is active with a customBaseUrl set", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseOpenAI(['Bon', 'jour']));
    const { deps } = makeDeps({
      settings: {
        ...baseSettings,
        provider: 'openrouter',
        apiKeys: { openrouter: 'sk-or-test' },
        customBaseUrl: 'https://stale.example.com/v1',
      },
      ask: fakeAsk({ transcript: okTranscript, meta: fakeMeta }),
      fetchImpl,
    });
    await runSummary('v1', deps);

    expect(fetchImpl.mock.calls.length).toBe(1);
    const requested = fetchImpl.mock.calls[0]?.[0];
    const url = new URL(requested instanceof Request ? requested.url : String(requested));
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(url.hostname).not.toBe('stale.example.com');
  });

  it('sends to that customBaseUrl when the custom provider is active', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseOpenAI(['Bon', 'jour']));
    const { deps } = makeDeps({
      settings: {
        ...baseSettings,
        provider: 'custom',
        apiKeys: { custom: 'sk-custom-test' },
        customBaseUrl: 'https://mon-relais.example.com/v1',
      },
      ask: fakeAsk({ transcript: okTranscript, meta: fakeMeta }),
      fetchImpl,
    });
    await runSummary('v1', deps);

    expect(fetchImpl.mock.calls.length).toBe(1);
    const requested = fetchImpl.mock.calls[0]?.[0];
    const url = new URL(requested instanceof Request ? requested.url : String(requested));
    expect(url.origin + url.pathname).toBe('https://mon-relais.example.com/v1/chat/completions');
  });

});

describe('runSummary — remembering the resume (pending-resume)', () => {
  it("stores {videoId, tabId} before emitting the error, with no key and a known tabId", async () => {
    const rememberPendingResume = vi.fn<OrchestratorDeps['rememberPendingResume']>(async () => {});
    const { deps } = makeDeps({
      settings: { ...baseSettings, apiKeys: {} },
      tabId: 42,
      rememberPendingResume,
    });
    await runSummary('v1', deps);

    expect(rememberPendingResume).toHaveBeenCalledTimes(1);
    expect(rememberPendingResume).toHaveBeenCalledWith({ videoId: 'v1', tabId: 42 });
  });

  it('stores nothing with no key and no known tabId', async () => {
    const rememberPendingResume = vi.fn<OrchestratorDeps['rememberPendingResume']>(async () => {});
    const { deps } = makeDeps({
      settings: { ...baseSettings, apiKeys: {} },
      rememberPendingResume,
    });
    await runSummary('v1', deps);

    expect(rememberPendingResume).not.toHaveBeenCalled();
  });

  it('stores nothing when a key is configured, even with a known tabId', async () => {
    const rememberPendingResume = vi.fn<OrchestratorDeps['rememberPendingResume']>(async () => {});
    const { deps } = makeDeps({
      settings: baseSettings,
      tabId: 42,
      rememberPendingResume,
      getConversation: async () => storedConversation(),
    });
    await runSummary('v1', deps);

    expect(rememberPendingResume).not.toHaveBeenCalled();
  });
});

// {duration} is a placeholder the orchestrator substitutes but the shipped
// prompt no longer uses (see DEFAULT_PROMPT, lib/settings.ts). It stays
// supported for a custom prompt, so these drive a custom prompt through the REAL
// runSummary with a fake fetchImpl: the substitution has to happen in the prompt
// that goes on the wire, not in an isolated formatDuration() unit test.
const DURATION_PROMPT = 'Durée : {duration}.\n{transcript}';

describe('runSummary — {duration} substituted with a human duration in the summary language', () => {
  /** The prompt actually sent, for a custom prompt carrying {duration}. */
  async function sentPromptFor(meta: VideoMeta | undefined, language = 'fr'): Promise<string> {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseOpenAI(['Bon', 'jour']));
    const { deps } = makeDeps({
      settings: { ...baseSettings, language, ...withPrompt(DURATION_PROMPT) },
      ask: meta === undefined
        // GET_META returns undefined: ask() only answers GET_TRANSCRIPT.
        ? async <T,>(msg: Msg): Promise<T | undefined> => (
          msg.type === 'GET_TRANSCRIPT' ? okTranscript as unknown as T : undefined
        )
        : fakeAsk({ transcript: okTranscript, meta }),
      fetchImpl,
    });
    await runSummary('v1', deps);

    const init = fetchImpl.mock.calls[0]?.[1];
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
    return body.messages?.[0]?.content as string;
  }

  it("puts '61 minutes' in the body sent, for a 61-minute video summarised in French", async () => {
    expect(await sentPromptFor({ ...fakeMeta, durationSeconds: 61 * 60 })).toContain('61 minutes');
  });

  // An unreliable duration substitutes nothing at all. A wrong duration would
  // skew a prompt indexed on it more surely than a missing one.
  it.each([
    ['unavailable metadata', undefined],
    ['a duration of 0', { ...fakeMeta, durationSeconds: 0 }],
    ['a NaN duration', { ...fakeMeta, durationSeconds: NaN }],
    ['a negative duration', { ...fakeMeta, durationSeconds: -5 }],
  ] as const)('substitutes an empty string for %s, never a fabricated number', async (_label, meta) => {
    const sent = await sentPromptFor(meta);

    expect(sent).not.toContain('NaN');
    expect(sent).not.toMatch(/\b0 minutes\b|-5 minutes/);
    expect(sent).not.toContain('{duration}');
  });
});

// A token the options page offers but buildPrompt does not know would reach the
// model VERBATIM, mid-prompt. PROMPT_TOKENS (lib/prompt-tokens.ts) and
// buildPrompt are the two halves, and only a real run links them.
describe('runSummary — every PROMPT_TOKEN is substituted', () => {
  it('leaves no offered placeholder literal in the prompt sent', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseOpenAI(['ok']));
    const { deps } = makeDeps({
      settings: { ...baseSettings, ...withPrompt(PROMPT_TOKENS.join('\n')) },
      ask: fakeAsk({ transcript: okTranscript, meta: fakeMeta }),
      fetchImpl,
    });
    await runSummary('v1', deps);

    const init = fetchImpl.mock.calls[0]?.[1];
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
    const sent = body.messages?.[0]?.content as string;

    for (const token of PROMPT_TOKENS) expect(sent, token).not.toContain(token);
  });
});

// The prompt is user-editable, and nothing stops someone reusing a placeholder
// twice. Proof
// que l'orchestrateur substitue bien TOUTES les occurrences (replaceAll),
// not just the first (replace).
// String.replace.
describe('runSummary — a placeholder used twice in a custom prompt is substituted twice', () => {
  // {transcript} is the case that matters here: this call site was the ONLY one
  // of the five still using prompt.replace(...) with a string rather than
  // replaceAll, so a second occurrence stayed literal in the text sent to the
  // model.
  it("substitutes BOTH occurrences of a repeated {transcript} in a custom prompt", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseOpenAI(['Bon', 'jour']));
    const customPrompt = 'Titre : {title}. Transcription : {transcript}. Encore la transcription : {transcript}.';
    const { deps } = makeDeps({
      settings: { ...baseSettings, ...withPrompt(customPrompt) },
      ask: fakeAsk({ transcript: okTranscript, meta: fakeMeta }),
      fetchImpl,
    });
    await runSummary('v1', deps);

    const init = fetchImpl.mock.calls[0]?.[1];
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
    const sent = body.messages?.[0]?.content as string;

    // toContain, not toBe: the language block is appended after the prompt (see
    // LANGUAGE_INSTRUCTION, lib/settings.ts). One contiguous match still pins
    // both substitutions, verbatim and in order.
    expect(sent).toContain(
      'Titre : Titre. Transcription : [0:00] Bonjour le monde. Encore la transcription : [0:00] Bonjour le monde.',
    );
    expect(sent).not.toContain('{transcript}');
  });
});

// The follow-up question itself — see runAsk (lib/orchestrator.ts) for how
// responsibilities are shared with its caller (entrypoints/background.ts, which
// translates an escaping exception into an ERROR, exactly as startSummary does
// for runSummary).
describe('runAsk', () => {
  const ANSWER = (questionId: string): StreamTarget => ({ kind: 'answer', questionId });

  const savedConversation: Conversation = {
    videoId: 'v1',
    meta: fakeMeta,
    status: 'done',
    provenance: { producedAt: 5000, provider: 'OpenRouter', model: 'un-modèle' },
    createdAt: 1000,
    turns: [
      // The initial summary's user turn carries the COMPLETE prompt, transcript
      // included. THIS is the turn these tests check runAsk neither regenerates
      // nor re-requests.
      { role: 'user', text: 'Résume cette vidéo. Transcript horodaté : [0:00] Bonjour le monde.' },
      { role: 'assistant', text: 'Voici le résumé de la vidéo.' },
    ],
  };

  function makeAskDeps(overrides: Partial<AskDeps> & { settings?: Settings } = {}) {
    const emit = vi.fn();
    const fetchImpl = overrides.fetchImpl ?? vi.fn<typeof fetch>();
    const saveConversation = overrides.saveConversation ?? vi.fn<AskDeps['saveConversation']>(async () => {});
    const getConversation =
      overrides.getConversation ?? vi.fn<AskDeps['getConversation']>(async () => savedConversation);
    const settings = overrides.settings ?? baseSettings;

    const deps: AskDeps = {
      emit,
      getSettings: async () => settings,
      getConversation,
      saveConversation,
      fetchImpl,
    };
    return { deps, emit, fetchImpl, saveConversation, getConversation };
  }

  it("loads the existing history, never re-reads the transcript, appends both turns and saves", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseOpenAI(['Le ', 'monde.']));
    const saveConversation = vi.fn<AskDeps['saveConversation']>(async () => {});
    const getConversation = vi.fn<AskDeps['getConversation']>(async () => savedConversation);
    const { deps, emit } = makeAskDeps({ fetchImpl, saveConversation, getConversation });

    await runAsk('v1', 'Et le monde, dans tout ça ?', 'q1', deps);

    // History loaded, never rebuilt from a transcript.
    expect(getConversation).toHaveBeenCalledWith('v1');
    expect(getConversation).toHaveBeenCalledTimes(1);

    // The request carries the WHOLE history: the initial summary's user turn,
    // transcript included, appears in it as is.
    expect(fetchImpl.mock.calls.length).toBe(1);
    const init = fetchImpl.mock.calls[0]?.[1];
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
    const messages = body.messages as { role: string; content: string }[];
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: 'user', content: savedConversation.turns[0]?.text });
    expect(messages[2]).toEqual({ role: 'user', content: 'Et le monde, dans tout ça ?' });

    // The point that matters: the transcript text appears only ONCE in the body
    // sent, never re-extracted or re-injected.
    const occurrences = body.messages
      .map((m: { content: string }) => m.content)
      .join('\n')
      .split('Bonjour le monde').length - 1;
    expect(occurrences).toBe(1);

    // A streaming STATE, never 'loading', which would make the panel reset the
    // displayed summary (see lib/panel-reducer.ts), then the CHUNKs, then done.
    const events = emit.mock.calls.map((c) => c[0] as PanelBroadcast);
    expect(events[0]).toEqual({ type: 'STATE', videoId: 'v1', target: ANSWER('q1'), status: 'streaming' });
    const chunks = events.filter((e) => e.type === 'CHUNK').map((e) => (e.type === 'CHUNK' ? e.text : ''));
    expect(chunks).toEqual(['Le ', 'monde.']);
    expect(events.at(-1)).toEqual({ type: 'STATE', videoId: 'v1', target: ANSWER('q1'), status: 'done' });

    // The saved conversation carries BOTH new turns on top of the two already
    // there: question AND answer.
    expect(saveConversation).toHaveBeenCalledTimes(1);
    const saved = saveConversation.mock.calls[0]?.[0] as Conversation;
    expect(saved.turns).toHaveLength(4);
    expect(saved.turns[2]).toEqual({ role: 'user', text: 'Et le monde, dans tout ça ?' });
    expect(saved.turns[3]).toEqual({ role: 'assistant', text: 'Le monde.' });
    expect(saved.status).toBe('done');
  });

  it("emits a clean 'no-conversation' ERROR, with no fetch and no exception, when none exists", async () => {
    const getConversation = vi.fn<AskDeps['getConversation']>(async () => null);
    const fetchImpl = vi.fn<typeof fetch>();
    const { deps, emit } = makeAskDeps({ getConversation, fetchImpl });

    await expect(runAsk('v1', 'Une question ?', 'q1', deps)).resolves.toBeUndefined();

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({
      type: 'ERROR', videoId: 'v1', target: ANSWER('q1'), code: 'no-conversation',
      message: 'No summary has been generated for this video yet.',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("emits a clean 'no-key' ERROR with no fetch, when no key is configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { deps, emit } = makeAskDeps({ settings: { ...baseSettings, apiKeys: {} }, fetchImpl });

    await runAsk('v1', 'Une question ?', 'q1', deps);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({
      type: 'ERROR', videoId: 'v1', target: ANSWER('q1'), code: 'no-key', message: 'No key configured',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('NEVER retries a 429 during a follow-up question', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 429 }));
    const { deps } = makeAskDeps({ fetchImpl });

    await expect(runAsk('v1', 'Une question ?', 'q1', deps)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a 503 during a follow-up question, as for a summary, through the shared withRetry', async () => {
    let calls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      calls += 1;
      if (calls < 3) return new Response('{}', { status: 503 });
      return sseOpenAI(['Réponse finale']);
    });
    const { deps, emit } = makeAskDeps({ fetchImpl });

    // withRetry waits 5s/10s/20s between attempts by default, and this test
    // cannot wait for real. It cannot take a custom `sleep` from outside either,
    // since runAsk calls it internally, so vitest's fake timers advance the clock
    // without waiting.
    vi.useFakeTimers();
    try {
      const promise = runAsk('v1', 'Une question ?', 'q1', deps);
      await vi.runAllTimersAsync();
      await promise;
    } finally {
      vi.useRealTimers();
    }

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const events = emit.mock.calls.map((c) => c[0] as PanelBroadcast);
    expect(events.at(-1)).toEqual({ type: 'STATE', videoId: 'v1', target: ANSWER('q1'), status: 'done' });
  });

  // runAsk had NO effort test, and so never received the cross-attempt memory fix
  // applied to runSummary. These two cover both halves: the level does go out,
  // and it does NOT go out again once refused.
  it("sends the resolved level on a follow-up question too", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseOpenAI(['Réponse']));
    const { deps } = makeAskDeps({ fetchImpl });

    await runAsk('v1', 'Une question ?', 'q1', deps);

    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.reasoning).toEqual({ enabled: false });
  });

  it(
    '400 → 503 → success: only one of the three requests carries the reasoning '
    + 'parameter, because withRetry must NEVER resend a level already known to be '
    + 'refused (twin of the runSummary test)',
    async () => {
      let calls = 0;
      const fetchImpl = vi.fn<typeof fetch>(async () => {
        calls += 1;
        // 1) initial request with the parameter: refused, triggering streamChat's
        //    fallback WITHIN this same withRetry attempt.
        if (calls === 1) return new Response('nope', { status: 400 });
        // 2) the fallback itself, without the parameter, hits a
        //    RETRYABLE → withRetry rejoue toute la fermeture.
        if (calls === 2) return new Response('slow', { status: 503 });
        // 3) that second attempt must NOT resend the refused level.
        return sseOpenAI(['Réponse']);
      });
      const { deps, emit } = makeAskDeps({ fetchImpl });

      vi.useFakeTimers();
      try {
        const promise = runAsk('v1', 'Une question ?', 'q1', deps);
        await vi.runAllTimersAsync();
        await promise;
      } finally {
        vi.useRealTimers();
      }

      expect(calls).toBe(3);
      const bodies = fetchImpl.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
      expect(bodies[0]).toHaveProperty('reasoning');
      expect(bodies[1]).not.toHaveProperty('reasoning');
      expect(bodies[2]).not.toHaveProperty('reasoning');

      // The question still succeeds: remembering the refusal costs no answer.
      const events = emit.mock.calls.map((c) => c[0] as PanelBroadcast);
      expect(events.at(-1)).toEqual({ type: 'STATE', videoId: 'v1', target: ANSWER('q1'), status: 'done' });
    },
  );

  // A summary is only ever displayed from the conversation behind it, so an
  // ASK with no conversation means nothing is displayed either — no summary can
  // be visible with its history missing. Nothing is rebuilt: the 'no-conversation'
  // ERROR above is the whole of it.
  it('never queries the YouTube tab: everything a follow-up needs is in the stored conversation', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseOpenAI(['Réponse.']));
    const { deps } = makeAskDeps({ fetchImpl });

    await runAsk('v1', 'Et alors ?', 'q1', deps);

    // AskDeps carries no `ask` at all: the type itself is the proof, and this
    // body is what would break if one were reintroduced by habit.
    expect(Object.keys(deps)).not.toContain('ask');
    expect(fetchImpl.mock.calls.length).toBe(1);
  });
});
