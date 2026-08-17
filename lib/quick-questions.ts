// The one-click follow-up under a finished summary, and under a finished
// answer: the catalogue's fixed question, sent as a question instead of a
// sentence typed into the ask bar.
//
// One decision lives here, pure: whether a given panel state offers that button
// at all, and what it hangs off.
import type { StreamTarget } from './messages';
import type { UiState } from './panel-reducer';

/** Where the block hangs and what it offers. */
export type QuickBlock = { target: StreamTarget; label: string };

/**
 * The block for the state as displayed, or `null` when there is none to show.
 *
 * It hangs off the LAST FINISHED output — the summary while no question has been
 * asked, the last answer afterwards — which is what makes "the block is replaced
 * by nothing once its question is asked" hold with no state to remember: asking
 * appends an output, and the block follows it down. The rejected alternative was
 * one block per output, kept alive above the conversation: it needs a flag per
 * output, that flag has to be persisted to survive a reopened panel, and it
 * leaves stale offers stacked up the scroll.
 *
 * Nothing hangs off unfinished or failed output, exactly like SummaryFooter: no
 * block while anything streams, none under an answer that errored, none on a
 * summary that never arrived.
 *
 * `condense` is passed in as a catalogue string (`panel.quick.condense`) because
 * lib/ returns keys, never words. It disappears once asked — which is read from
 * the conversation rather than from a flag: a clicked button becomes an ordinary
 * question whose text IS the label, so having been asked is already recorded.
 * Regenerating clears the conversation, and the button comes back with it.
 */
export function quickQuestionBlock(state: UiState, condense: string): QuickBlock | null {
  // `videoId !== null` for the same reason as canRegenerate (lib/panel-reducer.ts):
  // a click sends a question about a video, and askQuestion refuses without one.
  // A button that does nothing is worse than no button.
  if (state.status !== 'done' || state.videoId === null) return null;

  const last = state.answers.at(-1);
  if (last !== undefined && last.status !== 'done') return null;

  const label = condense.trim();
  if (label === '') return null;
  // Never twice the same question. The label is fixed, so this can only match a
  // question already asked — which is precisely when the button must be gone.
  if (state.answers.some((a) => normalise(a.question) === normalise(label))) return null;

  return {
    target: last === undefined ? { kind: 'summary' } : { kind: 'answer', questionId: last.questionId },
    label,
  };
}

/**
 * Comparison key for "has this question already been asked". Case and
 * surrounding space only: the same label clicked twice, or retyped by hand, is
 * what this catches.
 */
function normalise(question: string): string {
  return question.trim().toLowerCase();
}
