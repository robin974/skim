// lib/panel-reducer.test.ts
import { describe, it, expect } from 'vitest';
import {
  reduceStreamEvent, initialUiState, hydrateFromConversation, canRegenerate,
  type UiState, type Answer,
} from './panel-reducer';
import type { StreamEvent, StreamTarget, SummaryMeta } from './messages';
import type { Conversation } from './conversations';

const SUMMARY: StreamTarget = { kind: 'summary' };
const answerTarget = (questionId: string): StreamTarget => ({ kind: 'answer', questionId });

describe('reduceStreamEvent', () => {
  it("starts idle, with no known video and no follow-up conversation", () => {
    expect(initialUiState).toEqual({ status: 'idle', text: '', error: null, videoId: null, answers: [], meta: null });
  });

  it('moves to loading on STATE loading, resetting text, error, conversation AND provenance, and adopts the video', () => {
    const withStaleData: UiState = {
      status: 'error',
      text: 'ancien texte',
      error: { code: 'unknown', message: 'boom' },
      videoId: 'video-A',
      answers: [{ questionId: 'q1', question: 'Et alors ?', status: 'done', text: 'Alors ça.', error: null }],
      // A previous summary's provenance must be erased by the move to 'loading'
      // too, exactly like the text and the rest — otherwise the footer would show
      // video A's provenance while video B loads.
      meta: { producedAt: 1, provider: 'OpenRouter', model: 'x' },
    };
    const s = reduceStreamEvent(withStaleData, { type: 'STATE', videoId: 'video-B', target: SUMMARY, status: 'loading' });
    expect(s).toEqual({ status: 'loading', text: '', error: null, videoId: 'video-B', answers: [], meta: null });
  });

  it('concatenates the text of a summary CHUNK for the current video', () => {
    const loading = reduceStreamEvent(initialUiState, {
      type: 'STATE',
      videoId: 'v1',
      target: SUMMARY,
      status: 'loading',
    });
    const s1 = reduceStreamEvent(loading, { type: 'CHUNK', videoId: 'v1', target: SUMMARY, text: 'Bon' });
    const s2 = reduceStreamEvent(s1, { type: 'CHUNK', videoId: 'v1', target: SUMMARY, text: 'jour' });
    expect(s2.text).toBe('Bonjour');
    expect(s2.videoId).toBe('v1');
  });

  it('advances the status through STATE streaming then done for the same video', () => {
    let s = reduceStreamEvent(initialUiState, { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'loading' });
    s = reduceStreamEvent(s, { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'streaming' });
    expect(s.status).toBe('streaming');
    s = reduceStreamEvent(s, { type: 'CHUNK', videoId: 'v1', target: SUMMARY, text: 'résumé' });
    s = reduceStreamEvent(s, { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'done' });
    expect(s).toEqual({ status: 'done', text: 'résumé', error: null, videoId: 'v1', answers: [], meta: null });
  });

  it("moves status to 'error' on ERROR even with no prior STATE (no-key, no-transcript)", () => {
    // Reproduces orchestrator.ts: no STATE was ever emitted for this video, so
    // the panel is still idle.
    const s = reduceStreamEvent(initialUiState, {
      type: 'ERROR',
      videoId: 'v1',
      target: SUMMARY,
      code: 'no-key',
      message: 'No key configured',
    });
    expect(s.status).toBe('error');
    expect(s.error).toEqual({ code: 'no-key', message: 'No key configured' });
    expect(s.videoId).toBe('v1');
  });

  it("moves status to 'error' on ERROR even from 'streaming': no error STATE is ever emitted", () => {
    let s = reduceStreamEvent(initialUiState, { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'loading' });
    s = reduceStreamEvent(s, { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'streaming' });
    s = reduceStreamEvent(s, { type: 'CHUNK', videoId: 'v1', target: SUMMARY, text: 'partiel' });
    s = reduceStreamEvent(s, {
      type: 'ERROR', videoId: 'v1', target: SUMMARY, code: 'offline', message: 'Connexion perdue',
    });
    expect(s.status).toBe('error');
    expect(s.error).toEqual({ code: 'offline', message: 'Connexion perdue' });
    // Text already received need not be erased by an ERROR.
    expect(s.text).toBe('partiel');
  });

  it('ignores a CHUNK for a video other than the displayed one', () => {
    let s = reduceStreamEvent(initialUiState, { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'loading' });
    s = reduceStreamEvent(s, { type: 'CHUNK', videoId: 'v1', target: SUMMARY, text: 'A' });
    const ignored = reduceStreamEvent(s, { type: 'CHUNK', videoId: 'v2', target: SUMMARY, text: 'B' });
    expect(ignored).toEqual(s);
  });

  it('ignores an ERROR for a video other than the displayed one', () => {
    let s = reduceStreamEvent(initialUiState, { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'loading' });
    s = reduceStreamEvent(s, { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'streaming' });
    const ignored = reduceStreamEvent(s, {
      type: 'ERROR',
      videoId: 'v2',
      target: SUMMARY,
      code: 'quota',
      message: 'Quota atteint',
    });
    expect(ignored).toEqual(s);
    expect(ignored.status).toBe('streaming');
  });

  it('ignores a done/streaming STATE for a video other than the displayed one', () => {
    let s = reduceStreamEvent(initialUiState, { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'loading' });
    s = reduceStreamEvent(s, { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'streaming' });
    // A concurrent run for another video (v2) finishes while v1 is displayed: it
    // must change neither v1's status nor its text.
    const ignored = reduceStreamEvent(s, { type: 'STATE', videoId: 'v2', target: SUMMARY, status: 'done' });
    expect(ignored).toEqual(s);
  });

  it("lets a loading STATE for a NEW video interrupt the previous display, even mid-stream", () => {
    let s = reduceStreamEvent(initialUiState, { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'loading' });
    s = reduceStreamEvent(s, { type: 'CHUNK', videoId: 'v1', target: SUMMARY, text: 'texte de v1' });
    const switched = reduceStreamEvent(s, { type: 'STATE', videoId: 'v2', target: SUMMARY, status: 'loading' });
    expect(switched).toEqual({ status: 'loading', text: '', error: null, videoId: 'v2', answers: [], meta: null });
  });

  it('handles every StreamEvent variant', () => {
    // This exists to document the three shapes; real exhaustiveness is
    // guaranteed by the compiler (no silent `default`
    // dans reduceStreamEvent).
    const events: StreamEvent[] = [
      { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'loading' },
      { type: 'CHUNK', videoId: 'v1', target: SUMMARY, text: 'x' },
      { type: 'ERROR', videoId: 'v1', target: SUMMARY, code: 'unknown', message: 'x' },
    ];
    let s = initialUiState;
    for (const ev of events) s = reduceStreamEvent(s, ev);
    expect(s.status).toBe('error');
  });

  describe('real sequence: video A finished, then an early failure on video B', () => {
    // Reproduces the bug fixed in orchestrator.ts, where runSummary emitted an
    // ERROR ('no-key'/'no-transcript') BEFORE the new video's loading STATE.
    // After the fix, emit(STATE loading) is runSummary's very first instruction,
    // before any early return, so these two events always arrive in this order
    // for a given video:
    //   1. video A finishes (loading, CHUNK, done) — the panel shows A
    //   2. STATE loading for B — the panel switches to B, text cleared
    //   3. ERROR for B — the error displays, still on B
    const videoACompleted = (): UiState => {
      let s = reduceStreamEvent(initialUiState, { type: 'STATE', videoId: 'A', target: SUMMARY, status: 'loading' });
      s = reduceStreamEvent(s, { type: 'CHUNK', videoId: 'A', target: SUMMARY, text: 'résumé de A' });
      s = reduceStreamEvent(s, { type: 'STATE', videoId: 'A', target: SUMMARY, status: 'done' });
      return s;
    };

    it("avec le STATE loading de B (comportement post-correctif) : l'erreur de B s'affiche", () => {
      const afterA = videoACompleted();
      expect(afterA).toEqual({ status: 'done', text: 'résumé de A', error: null, videoId: 'A', answers: [], meta: null });

      const switchedToB = reduceStreamEvent(afterA, { type: 'STATE', videoId: 'B', target: SUMMARY, status: 'loading' });
      expect(switchedToB).toEqual({ status: 'loading', text: '', error: null, videoId: 'B', answers: [], meta: null });

      const errored = reduceStreamEvent(switchedToB, {
        type: 'ERROR',
        videoId: 'B',
        target: SUMMARY,
        code: 'no-key',
        message: 'No key configured',
      });
      expect(errored).toEqual({
        status: 'error',
        text: '',
        error: { code: 'no-key', message: 'No key configured' },
        videoId: 'B',
        answers: [],
        meta: null,
      });
    });

    it("WITHOUT B's loading STATE, simulating the pre-fix order: B's error would be wrongly ignored", () => {
      const afterA = videoACompleted();

      // Step 2 deliberately omitted: exactly what
      // l'ancien runSummary pour 'no-key'/'no-transcript', qui retournait
      // did before emitting STATE loading for the new video.
      const errorForBWithoutSwitch = reduceStreamEvent(afterA, {
        type: 'ERROR',
        videoId: 'B',
        target: SUMMARY,
        code: 'no-key',
        message: 'No key configured',
      });

      // The filter rightly ignores an ERROR for a video other than the displayed
      // one, so the panel would stay stuck on A's finished summary with no sign
      // that the click on B failed.
      expect(errorForBWithoutSwitch).toEqual(afterA);
      expect(errorForBWithoutSwitch.status).toBe('done');
      expect(errorForBWithoutSwitch.videoId).toBe('A');
    });
  });
});

describe('reduceStreamEvent — questions de suivi (task-12)', () => {
  const summaryDone = (): UiState => {
    let s = reduceStreamEvent(initialUiState, { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'loading' });
    s = reduceStreamEvent(s, { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'streaming' });
    s = reduceStreamEvent(s, { type: 'CHUNK', videoId: 'v1', target: SUMMARY, text: 'Résumé complet.' });
    s = reduceStreamEvent(s, { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'done' });
    return s;
  };

  it('adds a pending answer entry on ASK_SUBMITTED, without touching the displayed summary', () => {
    const done = summaryDone();
    const asked = reduceStreamEvent(done, {
      type: 'ASK_SUBMITTED', videoId: 'v1', questionId: 'q1', question: 'Et le budget ?',
    });
    expect(asked.text).toBe('Résumé complet.');
    expect(asked.status).toBe('done');
    expect(asked.answers).toEqual([
      { questionId: 'q1', question: 'Et le budget ?', status: 'streaming', text: '', error: null },
    ]);
  });

  it('feeds a CHUNK targeting an answer into that answer, never into the summary text', () => {
    const done = summaryDone();
    let s = reduceStreamEvent(done, {
      type: 'ASK_SUBMITTED', videoId: 'v1', questionId: 'q1', question: 'Et le budget ?',
    });
    s = reduceStreamEvent(s, { type: 'CHUNK', videoId: 'v1', target: answerTarget('q1'), text: 'Le budget ' });
    s = reduceStreamEvent(s, { type: 'CHUNK', videoId: 'v1', target: answerTarget('q1'), text: 'est de 3M€.' });

    // The summary above stays intact — THE checkpoint of the event contract:
    // without an explicit discriminant, this text would have been concatenated
    // onto the summary.
    expect(s.text).toBe('Résumé complet.');
    expect(s.answers).toEqual([
      { questionId: 'q1', question: 'Et le budget ?', status: 'streaming', text: 'Le budget est de 3M€.', error: null },
    ]);
  });

  it('still routes an answer correctly while the summary is displayed at done', () => {
    // The summary is already 'done' when the question is asked — normal
    // behaviour, since a follow-up can only be asked once a summary exists.
    const done = summaryDone();
    let s = reduceStreamEvent(done, {
      type: 'ASK_SUBMITTED', videoId: 'v1', questionId: 'q1', question: 'Un dernier point ?',
    });
    s = reduceStreamEvent(s, { type: 'STATE', videoId: 'v1', target: answerTarget('q1'), status: 'streaming' });
    s = reduceStreamEvent(s, { type: 'CHUNK', videoId: 'v1', target: answerTarget('q1'), text: 'Oui, ' });
    s = reduceStreamEvent(s, { type: 'CHUNK', videoId: 'v1', target: answerTarget('q1'), text: 'un dernier point.' });
    s = reduceStreamEvent(s, { type: 'STATE', videoId: 'v1', target: answerTarget('q1'), status: 'done' });

    expect(s.status).toBe('done'); // the SUMMARY's status did not move
    expect(s.text).toBe('Résumé complet.');
    expect(s.answers).toEqual([
      { questionId: 'q1', question: 'Un dernier point ?', status: 'done', text: 'Oui, un dernier point.', error: null },
    ]);
  });

  it('routes each CHUNK to the right entry with two questions in flight at once', () => {
    const done = summaryDone();
    let s = reduceStreamEvent(done, {
      type: 'ASK_SUBMITTED', videoId: 'v1', questionId: 'q1', question: 'Question 1 ?',
    });
    s = reduceStreamEvent(s, {
      type: 'ASK_SUBMITTED', videoId: 'v1', questionId: 'q2', question: 'Question 2 ?',
    });
    s = reduceStreamEvent(s, { type: 'CHUNK', videoId: 'v1', target: answerTarget('q1'), text: 'Réponse 1' });
    s = reduceStreamEvent(s, { type: 'CHUNK', videoId: 'v1', target: answerTarget('q2'), text: 'Réponse 2' });
    s = reduceStreamEvent(s, { type: 'CHUNK', videoId: 'v1', target: answerTarget('q1'), text: ' suite' });

    const byId = (id: string): Answer | undefined => s.answers.find((a) => a.questionId === id);
    expect(byId('q1')?.text).toBe('Réponse 1 suite');
    expect(byId('q2')?.text).toBe('Réponse 2');
  });

  it("moves ONLY that answer to error on an ERROR targeting it, never the summary", () => {
    const done = summaryDone();
    let s = reduceStreamEvent(done, {
      type: 'ASK_SUBMITTED', videoId: 'v1', questionId: 'q1', question: 'Et alors ?',
    });
    s = reduceStreamEvent(s, {
      type: 'ERROR', videoId: 'v1', target: answerTarget('q1'), code: 'no-conversation', message: 'boom',
    });

    expect(s.status).toBe('done'); // the summary stays displayed, intact
    expect(s.text).toBe('Résumé complet.');
    expect(s.answers).toEqual([
      { questionId: 'q1', question: 'Et alors ?', status: 'error', error: { code: 'no-conversation', message: 'boom' }, text: '' },
    ]);
  });

  it('clears the follow-up conversation too on a loading STATE for a new video', () => {
    const done = summaryDone();
    const asked = reduceStreamEvent(done, {
      type: 'ASK_SUBMITTED', videoId: 'v1', questionId: 'q1', question: 'Et alors ?',
    });
    expect(asked.answers).toHaveLength(1);

    const switched = reduceStreamEvent(asked, { type: 'STATE', videoId: 'v2', target: SUMMARY, status: 'loading' });
    expect(switched.answers).toEqual([]);
  });

  it('ignores an answer event whose questionId matches no known entry', () => {
    const done = summaryDone();
    const s = reduceStreamEvent(done, { type: 'CHUNK', videoId: 'v1', target: answerTarget('inconnu'), text: 'x' });
    expect(s).toEqual(done);
  });

  it('ignores ASK_SUBMITTED for a video other than the displayed one', () => {
    const done = summaryDone();
    const s = reduceStreamEvent(done, {
      type: 'ASK_SUBMITTED', videoId: 'v2', questionId: 'q1', question: 'Et alors ?',
    });
    expect(s).toEqual(done);
  });
});

describe('hydrateFromConversation — reopening the panel (GET_STATE)', () => {
  const meta = null;

  it('returns the idle state for a video with no known conversation', () => {
    const s = hydrateFromConversation(null, 'v1');
    expect(s).toEqual({ status: 'idle', text: '', error: null, videoId: 'v1', answers: [], meta: null });
  });

  it('restores text and status from a finished conversation with no follow-up', () => {
    const conversation: Conversation = {
      videoId: 'v1', meta, provenance: null, status: 'done', createdAt: 1000,
      turns: [
        { role: 'user', text: 'prompt complet, transcript inclus' },
        { role: 'assistant', text: 'Voici le résumé.' },
      ],
    };
    const s = hydrateFromConversation(conversation, 'v1');
    // meta: null because THIS conversation carries no provenance — a shape
    // written before the field existed. See the block below for the normal case.
    expect(s).toEqual({ status: 'done', text: 'Voici le résumé.', error: null, videoId: 'v1', answers: [], meta: null });
  });

  // Conversations die with the browser session, so they are the only record of
  // what produced a summary. A panel reopened over a finished summary — or a
  // second summarise of the same video — restores the line under it rather than
  // showing the summary bare.
  it('restores the provenance stored with the summary', () => {
    const provenance: SummaryMeta = {
      producedAt: 1_700_000_000_000, provider: 'Gemini', model: 'gemini-flash',
    };
    const conversation: Conversation = {
      videoId: 'v1', meta, provenance, status: 'done', createdAt: 1000,
      turns: [
        { role: 'user', text: 'prompt complet' },
        { role: 'assistant', text: 'Voici le résumé.' },
      ],
    };
    expect(hydrateFromConversation(conversation, 'v1').meta).toEqual(provenance);
  });

  it('shows no provenance for a failed generation: nothing settled to describe', () => {
    const conversation: Conversation = {
      videoId: 'v1', meta, provenance: null, status: 'error', createdAt: 1000,
      turns: [{ role: 'user', text: 'prompt' }, { role: 'assistant', text: 'Résumé interrompu' }],
    };
    expect(hydrateFromConversation(conversation, 'v1').meta).toBeNull();
  });

  it('rebuilds the question/answer pairs in order from a conversation with finished follow-ups', () => {
    const conversation: Conversation = {
      videoId: 'v1', meta, provenance: null, status: 'done', createdAt: 1000,
      turns: [
        { role: 'user', text: 'prompt complet, transcript inclus' },
        { role: 'assistant', text: 'Voici le résumé.' },
        { role: 'user', text: 'Et le budget ?' },
        { role: 'assistant', text: 'Le budget est de 3M€.' },
        { role: 'user', text: 'Et les délais ?' },
        { role: 'assistant', text: 'Six mois.' },
      ],
    };
    const s = hydrateFromConversation(conversation, 'v1');
    expect(s.text).toBe('Voici le résumé.');
    expect(s.answers).toHaveLength(2);
    expect(s.answers[0]).toMatchObject({ question: 'Et le budget ?', text: 'Le budget est de 3M€.', status: 'done' });
    expect(s.answers[1]).toMatchObject({ question: 'Et les délais ?', text: 'Six mois.', status: 'done' });
    // Stable, distinct questionIds, for React keys and to never collide with a
    // client-generated id (crypto.randomUUID()).
    expect(new Set(s.answers.map((a) => a.questionId)).size).toBe(2);
  });

  it("restores the text as is from a conversation still 'streaming' at the last write, honestly unsure of the rest", () => {
    const conversation: Conversation = {
      videoId: 'v1', meta, provenance: null, status: 'streaming', createdAt: 1000,
      turns: [
        { role: 'user', text: 'prompt complet' },
        { role: 'assistant', text: 'Résumé partiel encore en cours' },
      ],
    };
    const s = hydrateFromConversation(conversation, 'v1');
    expect(s.status).toBe('streaming');
    expect(s.text).toBe('Résumé partiel encore en cours');
    expect(s.error).toBeNull();
  });

  it("uses status 'error' with a generic message, not a fabricated one, for a failed conversation", () => {
    const conversation: Conversation = {
      videoId: 'v1', meta, provenance: null, status: 'error', createdAt: 1000,
      turns: [
        { role: 'user', text: 'prompt complet' },
        { role: 'assistant', text: 'Résumé interrompu' },
      ],
    };
    const s = hydrateFromConversation(conversation, 'v1');
    expect(s.status).toBe('error');
    expect(s.error).not.toBeNull();
    expect(s.text).toBe('Résumé interrompu');
  });
});

describe('reduceStreamEvent — HYDRATED, the asynchronous rehydration at mount', () => {
  const hydratedState: UiState = {
    status: 'done', text: 'Résumé restauré', error: null, videoId: 'v1', answers: [], meta: null,
  };

  it("applies when nothing has happened since mount (videoId still null)", () => {
    const s = reduceStreamEvent(initialUiState, { type: 'HYDRATED', state: hydratedState });
    expect(s).toEqual(hydratedState);
  });

  it("is ignored when a live event already fixed a video, being fresher than the rehydration", () => {
    const live = reduceStreamEvent(initialUiState, {
      type: 'STATE', videoId: 'v2', target: SUMMARY, status: 'loading',
    });
    const s = reduceStreamEvent(live, { type: 'HYDRATED', state: hydratedState });
    expect(s).toEqual(live);
  });

  // A RESTORE says a video already has a finished conversation and that nothing
  // will be generated. The 'loading' STATE that preceded it must not be what
  // stays on screen, so this rehydration overrides the display — the only case
  // that does.
  it('applies over a live event when forced, which is what a RESTORE asks for', () => {
    const live = reduceStreamEvent(initialUiState, {
      type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'loading',
    });
    const s = reduceStreamEvent(live, { type: 'HYDRATED', state: hydratedState, force: true });
    expect(s).toEqual(hydratedState);
  });
});

// The provenance (SummaryMeta) carried by the 'done' STATE that ends a summary.
describe('reduceStreamEvent — provenance carried by the summary\'s done STATE', () => {
  const META: SummaryMeta = {
    producedAt: 1000, provider: 'OpenRouter', model: 'un-modèle',
  };

  const loadingV1 = (): UiState =>
    reduceStreamEvent(initialUiState, { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'loading' });

  it("stores meta in state.meta when a 'done' STATE carries it", () => {
    const s = reduceStreamEvent(loadingV1(), { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'done', meta: META });
    expect(s.meta).toEqual(META);
  });

  it("does not touch known provenance on a 'streaming' STATE, which carries no meta", () => {
    let s = reduceStreamEvent(loadingV1(), { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'done', meta: META });
    s = reduceStreamEvent(s, { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'streaming' });
    expect(s.meta).toEqual(META);
  });

  it("clears the previous provenance on a 'loading' STATE for a NEW video", () => {
    let s = reduceStreamEvent(loadingV1(), { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'done', meta: META });
    s = reduceStreamEvent(s, { type: 'STATE', videoId: 'v2', target: SUMMARY, status: 'loading' });
    expect(s.meta).toBeNull();
  });

  it('never touches state.meta on a STATE targeting a follow-up answer', () => {
    let s = reduceStreamEvent(loadingV1(), { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'done', meta: META });
    s = reduceStreamEvent(s, { type: 'ASK_SUBMITTED', videoId: 'v1', questionId: 'q1', question: '?' });
    s = reduceStreamEvent(s, { type: 'STATE', videoId: 'v1', target: answerTarget('q1'), status: 'done' });
    expect(s.meta).toEqual(META);
  });

  it("ignores a 'done' STATE for a video OTHER than the displayed one, meta included", () => {
    const s = loadingV1();
    const ignored = reduceStreamEvent(s, { type: 'STATE', videoId: 'v2', target: SUMMARY, status: 'done', meta: META });
    expect(ignored.meta).toBeNull();
  });
});

// The regenerate button: the local REGENERATE_SUBMITTED action, and the pure
// canRegenerate() predicate driving its `disabled` attribute in App.tsx, whose
// React rendering is outside the test glob.
describe('reduceStreamEvent — REGENERATE_SUBMITTED', () => {
  const summaryDoneWithMeta = (): UiState => {
    let s = reduceStreamEvent(initialUiState, { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'loading' });
    s = reduceStreamEvent(s, { type: 'CHUNK', videoId: 'v1', target: SUMMARY, text: 'Résumé complet.' });
    s = reduceStreamEvent(s, {
      type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'done',
      meta: { producedAt: 1, provider: 'OpenRouter', model: 'x' },
    });
    return s;
  };

  it('resets text, error, follow-up conversation AND provenance, exactly like a loading STATE', () => {
    const s = reduceStreamEvent(summaryDoneWithMeta(), { type: 'REGENERATE_SUBMITTED', videoId: 'v1' });
    expect(s).toEqual({ status: 'loading', text: '', error: null, videoId: 'v1', answers: [], meta: null });
  });

  it('is ignored when the video does not match the displayed one', () => {
    const done = summaryDoneWithMeta();
    const ignored = reduceStreamEvent(done, { type: 'REGENERATE_SUBMITTED', videoId: 'v2' });
    expect(ignored).toEqual(done);
  });
});

describe('canRegenerate — regeneration is never available while a stream runs', () => {
  const summaryDone = (): UiState => {
    let s = reduceStreamEvent(initialUiState, { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'loading' });
    s = reduceStreamEvent(s, { type: 'CHUNK', videoId: 'v1', target: SUMMARY, text: 'Résumé complet.' });
    s = reduceStreamEvent(s, { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'done' });
    return s;
  };

  it('is false with no displayed video, in the initial state', () => {
    expect(canRegenerate(initialUiState)).toBe(false);
  });

  it("is false while the summary is loading", () => {
    const s = reduceStreamEvent(initialUiState, { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'loading' });
    expect(canRegenerate(s)).toBe(false);
  });

  it("is false while the summary is streaming: exactly the overlap this must exclude", () => {
    let s = reduceStreamEvent(initialUiState, { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'loading' });
    s = reduceStreamEvent(s, { type: 'STATE', videoId: 'v1', target: SUMMARY, status: 'streaming' });
    expect(canRegenerate(s)).toBe(false);
  });

  it("is true once the summary is done with no question in flight", () => {
    expect(canRegenerate(summaryDone())).toBe(true);
  });

  it('is false when the summary is done but a follow-up answer is still generating', () => {
    const s = reduceStreamEvent(summaryDone(), {
      type: 'ASK_SUBMITTED', videoId: 'v1', questionId: 'q1', question: 'Et alors ?',
    });
    expect(canRegenerate(s)).toBe(false);
  });

  it('is true again once both the summary and the follow-up answer are done', () => {
    let s = reduceStreamEvent(summaryDone(), {
      type: 'ASK_SUBMITTED', videoId: 'v1', questionId: 'q1', question: 'Et alors ?',
    });
    s = reduceStreamEvent(s, { type: 'STATE', videoId: 'v1', target: answerTarget('q1'), status: 'done' });
    expect(canRegenerate(s)).toBe(true);
  });

  it("is false on a failed summary: nothing to regenerate from that state", () => {
    const s = reduceStreamEvent(initialUiState, { type: 'ERROR', videoId: 'v1', target: SUMMARY, code: 'no-key', message: 'x' });
    expect(canRegenerate(s)).toBe(false);
  });
});

// chrome.runtime.sendMessage can fail while the service worker wakes, and
// useSummary then passes `null`.
describe('hydrateFromConversation — no conversation to restore', () => {
  it('returns the idle state for this video, not a crash', () => {
    expect(hydrateFromConversation(null, 'v1')).toEqual({ ...initialUiState, videoId: 'v1' });
  });
});
