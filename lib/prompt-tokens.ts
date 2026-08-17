// The five prompt placeholders, and insertion at the caret: the variables are
// clickable tokens rather than a list to copy by hand under the field.
//
// Here rather than in the React component because this is index arithmetic on a
// string — caret offset, replaced selection, space or no space — exactly the
// kind of code that breaks silently and that the test glob can exercise.

/**
 * The five placeholders replaced when a summary runs (see buildPrompt,
 * lib/orchestrator.ts). This list is DISPLAY: it says what the user may insert,
 * and MUST stay aligned with what buildPrompt actually replaces — a token
 * offered here but unknown there would reach the model verbatim.
 *
 * `{language}` is deliberately absent. The output language is a setting, not a
 * prompt variable: its whole instruction is appended at send time (see
 * LANGUAGE_INSTRUCTION, lib/settings.ts), so a prompt has nothing to place.
 */
export const PROMPT_TOKENS = [
  '{duration}', '{title}', '{channel}', '{description}', '{transcript}',
] as const;

export type PromptToken = (typeof PROMPT_TOKENS)[number];

export type Insertion = {
  text: string;
  /** Where to put the caret back: right after the inserted token. */
  caret: number;
};

/**
 * Inserts `token` into `text` at the caret, replacing the selection if there is
 * one.
 *
 * Bounds are normalised rather than assumed correct: a `<textarea>`'s
 * `selectionStart` and `selectionEnd` are `null` until it has been focused, and
 * clicking a token before ever touching the field is the common first-visit
 * case. Appending at the END is the lesser evil there — the default prompt ends
 * with the input block, where one more token still means something, whereas the
 * start would break the first instruction.
 */
export function insertToken(text: string, token: string, start: number | null, end: number | null): Insertion {
  const from = clamp(start ?? text.length, text.length);
  const to = clamp(end ?? from, text.length);
  const [a, b] = from <= to ? [from, to] : [to, from];

  return {
    text: `${text.slice(0, a)}${token}${text.slice(b)}`,
    caret: a + token.length,
  };
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}
