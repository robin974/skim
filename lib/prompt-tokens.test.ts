import { describe, it, expect } from 'vitest';
import { PROMPT_TOKENS, insertToken } from './prompt-tokens';

describe('insertToken', () => {
  it('inserts at the caret and returns the caret after the token', () => {
    expect(insertToken('abcdef', '{title}', 3, 3)).toEqual({ text: 'abc{title}def', caret: 10 });
  });

  it('replaces the selection', () => {
    expect(insertToken('abcdef', '{title}', 2, 4)).toEqual({ text: 'ab{title}ef', caret: 9 });
  });

  it('accepts a backwards selection, with the caret before its anchor', () => {
    expect(insertToken('abcdef', '{x}', 4, 2)).toEqual({ text: 'ab{x}ef', caret: 5 });
  });

  // `selectionStart` is null until the <textarea> has been focused, and clicking
  // a token before touching the field is the common first-visit case.
  it('appends at the end of the text when no caret is known', () => {
    expect(insertToken('abc', '{x}', null, null)).toEqual({ text: 'abc{x}', caret: 6 });
  });

  it('clamps out-of-range positions rather than producing truncated text', () => {
    expect(insertToken('abc', '{x}', -5, -5)).toEqual({ text: '{x}abc', caret: 3 });
    expect(insertToken('abc', '{x}', 99, 99)).toEqual({ text: 'abc{x}', caret: 6 });
  });

  it('makes the token the whole text when the text is empty', () => {
    expect(insertToken('', '{transcript}', 0, 0)).toEqual({ text: '{transcript}', caret: 12 });
  });
});

// The link between this list and what buildPrompt actually replaces is checked
// in lib/orchestrator.test.ts, by running a prompt made of every token through
// the real runSummary: a token offered here but unknown there would reach the
// model verbatim. DEFAULT_PROMPT cannot stand in for that: it happens to use
// every token today, and nothing binds it to keep doing so.
describe('PROMPT_TOKENS', () => {
  it('offers each token once, in the shape buildPrompt matches', () => {
    expect(new Set(PROMPT_TOKENS).size).toBe(PROMPT_TOKENS.length);
    for (const token of PROMPT_TOKENS) expect(token, token).toMatch(/^\{[a-z]+\}$/);
  });
});
