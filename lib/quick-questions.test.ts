// lib/quick-questions.test.ts
import { describe, it, expect } from 'vitest';
import { quickQuestionBlock } from './quick-questions';
import { initialUiState, type UiState, type Answer } from './panel-reducer';

const CONDENSE = 'Résume la vidéo en une seule phrase';

function answer(overrides: Partial<Answer> = {}): Answer {
  return {
    questionId: 'q1',
    question: 'Et le budget ?',
    status: 'done',
    text: 'Le budget est de 3M€.',
    error: null,
    ...overrides,
  };
}

/** A summary displayed and finished — the state the block exists for. */
function summaryDone(overrides: Partial<UiState> = {}): UiState {
  return {
    ...initialUiState, status: 'done', videoId: 'v1', text: 'Voici le résumé.', ...overrides,
  };
}

describe('quickQuestionBlock — where the button hangs', () => {
  it('offers the catalogue question under a finished summary', () => {
    const block = quickQuestionBlock(summaryDone(), CONDENSE);
    expect(block).toEqual({ target: { kind: 'summary' }, label: CONDENSE });
  });

  it('follows the last answer down once a question has been answered', () => {
    const block = quickQuestionBlock(summaryDone({ answers: [answer({ questionId: 'q7' })] }), CONDENSE);
    expect(block?.target).toEqual({ kind: 'answer', questionId: 'q7' });
  });
});

// Same rule as SummaryFooter: nothing hangs off output that is unfinished or
// failed.
describe('quickQuestionBlock — nothing to hang off', () => {
  it('offers nothing while the summary is still streaming', () => {
    expect(quickQuestionBlock(summaryDone({ status: 'streaming' }), CONDENSE)).toBeNull();
  });

  it('offers nothing while the summary is loading', () => {
    expect(quickQuestionBlock(summaryDone({ status: 'loading' }), CONDENSE)).toBeNull();
  });

  it('offers nothing on a summary that failed', () => {
    expect(quickQuestionBlock(summaryDone({ status: 'error' }), CONDENSE)).toBeNull();
  });

  // A click sends a question ABOUT a video, and askQuestion refuses without one.
  it('offers nothing with no video displayed', () => {
    expect(quickQuestionBlock(summaryDone({ videoId: null }), CONDENSE)).toBeNull();
  });

  it('offers nothing while the last answer is still streaming', () => {
    const state = summaryDone({ answers: [answer({ status: 'streaming', text: '' })] });
    expect(quickQuestionBlock(state, CONDENSE)).toBeNull();
  });

  it('offers nothing under an answer that failed: never a button beside an ErrorBox', () => {
    const state = summaryDone({
      answers: [answer({ status: 'error', error: { code: 'quota', message: 'boom' } })],
    });
    expect(quickQuestionBlock(state, CONDENSE)).toBeNull();
  });
});

// A clicked button becomes an ordinary question whose text IS the label, so the
// conversation already records that it was asked. No flag, and nothing to
// persist for a reopened panel to find.
describe('quickQuestionBlock — never twice the same question', () => {
  it('disappears once its own question has been asked', () => {
    const state = summaryDone({ answers: [answer({ question: CONDENSE })] });
    expect(quickQuestionBlock(state, CONDENSE)).toBeNull();
  });

  it('ignores case and surrounding space when comparing', () => {
    const state = summaryDone({ answers: [answer({ question: `  ${CONDENSE.toUpperCase()} ` })] });
    expect(quickQuestionBlock(state, CONDENSE)).toBeNull();
  });

  it('comes back under a LATER answer, since the block only hangs off the last one', () => {
    const state = summaryDone({
      answers: [answer({ questionId: 'q1', question: 'Et le budget ?' })],
    });
    expect(quickQuestionBlock(state, CONDENSE)?.label).toBe(CONDENSE);
  });

  // An empty catalogue string would draw a button with no name on it.
  it('offers nothing when the catalogue string is empty', () => {
    expect(quickQuestionBlock(summaryDone(), '   ')).toBeNull();
  });
});
