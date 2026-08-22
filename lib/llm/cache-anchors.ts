import type { ChatTurn } from './types';

/**
 * Which turns of a request carry a prompt-cache breakpoint.
 *
 * Only for the providers whose caching is EXPLICIT — Anthropic's protocol, and
 * OpenRouter relaying to it. OpenAI, DeepSeek and Gemini cache a matching prefix
 * on their own, with no parameter to send, and get nothing from this module.
 *
 * The prefix a follow-up resends is already byte-identical to the previous
 * request's: runAsk replays `conversation.turns` untouched and appends the
 * question (see lib/orchestrator.ts). That is the whole precondition for a
 * prefix cache; the breakpoints below are what turn it into a discount.
 *
 * Two anchors, never more:
 *  - turn 0, the summary's user turn, which carries the transcript (35 to 82 KB
 *    measured on this project's fixtures, see fixtures/README.md). It is what
 *    every follow-up resends, and it never moves;
 *  - the last turn, so the questions and answers already exchanged are read from
 *    cache too instead of being rewritten on every new question.
 *
 * Anthropic allows at most 4 breakpoints per request and looks back at most 20
 * content blocks for an earlier entry. runAsk appends 2 turns per question, so
 * neither limit is ever approached.
 *
 * Anchors land on USER turns only. `cache_control` has to ride inside a content
 * block, so an anchored turn is sent as a block ARRAY rather than a bare string,
 * and an OpenAI-compatible relay does not necessarily accept that shape on an
 * assistant message. Both anchors are user turns by construction — runSummary
 * sends one user turn, runAsk appends the question last — so the restriction
 * costs nothing and removes the question.
 */
export function cacheAnchors(turns: ChatTurn[]): number[] {
  const anchors: number[] = [];
  if (turns[0]?.role === 'user') anchors.push(0);

  const last = turns.length - 1;
  if (last > 0 && turns[last]?.role === 'user') anchors.push(last);

  return anchors;
}

/** The breakpoint marker, identical across the protocols that accept one. */
export const CACHE_CONTROL = { type: 'ephemeral' } as const;

/** One text block of an Anthropic-protocol message, with or without a breakpoint. */
export type CacheableBlock = { type: 'text'; text: string; cache_control?: typeof CACHE_CONTROL };

/**
 * The `content` of one message: a bare string, or the single-block array an
 * anchor requires. The two forms render to the same prompt, so moving the second
 * anchor from one request to the next does not change the cached prefix — the
 * cache key is derived from the rendered prompt, not from the request's JSON.
 */
export function cacheableContent(text: string, anchored: boolean): string | CacheableBlock[] {
  return anchored ? [{ type: 'text', text, cache_control: CACHE_CONTROL }] : text;
}
