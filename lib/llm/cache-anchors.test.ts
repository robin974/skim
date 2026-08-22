import { describe, it, expect } from 'vitest';
import { cacheAnchors, cacheableContent, CACHE_CONTROL } from './cache-anchors';
import type { ChatTurn } from './types';

const user = (text: string): ChatTurn => ({ role: 'user', text });
const assistant = (text: string): ChatTurn => ({ role: 'assistant', text });

describe('cacheAnchors', () => {
  it('anchors nothing on an empty request', () => {
    expect(cacheAnchors([])).toEqual([]);
  });

  it('anchors the transcript turn alone on a summary', () => {
    // runSummary sends exactly one turn: there is no tail to anchor separately.
    expect(cacheAnchors([user('prompt + transcript')])).toEqual([0]);
  });

  it('anchors the transcript turn and the question on a first follow-up', () => {
    const turns = [user('prompt + transcript'), assistant('summary'), user('question')];
    expect(cacheAnchors(turns)).toEqual([0, 2]);
  });

  it('keeps two anchors however long the conversation grows', () => {
    const turns = [
      user('prompt + transcript'), assistant('summary'),
      user('q1'), assistant('a1'), user('q2'), assistant('a2'), user('q3'),
    ];
    // Anthropic allows 4 breakpoints per request; the count must not follow the
    // number of questions asked.
    expect(cacheAnchors(turns)).toEqual([0, 6]);
  });

  it('never anchors an assistant turn', () => {
    // The tail of a request is a question by construction (runAsk appends it
    // last). A trailing assistant turn means the caller is not the orchestrator,
    // and a content-part array on an assistant message is what a relay may
    // refuse.
    const turns = [user('prompt + transcript'), assistant('summary')];
    expect(cacheAnchors(turns)).toEqual([0]);
  });

  it('anchors nothing when the first turn is not the user turn', () => {
    expect(cacheAnchors([assistant('orphan')])).toEqual([]);
  });
});

describe('cacheableContent', () => {
  it('leaves an unanchored turn as the bare string it was before', () => {
    expect(cacheableContent('hello', false)).toBe('hello');
  });

  it('wraps an anchored turn in one marked text block', () => {
    expect(cacheableContent('hello', true)).toEqual([
      { type: 'text', text: 'hello', cache_control: CACHE_CONTROL },
    ]);
  });
});
