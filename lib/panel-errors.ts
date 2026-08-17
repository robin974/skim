// What a panel error SAYS and what it OFFERS, split in two on purpose:
//  - the copy lives in the message catalogue (lib/i18n.ts, `error.*` keys), so
//    it is translatable and stays impersonal — the panel states, it never
//    addresses the reader;
//  - the decision "which buttons, in what order, under what conditions" lives
//    here, pure and tested, rather than in the JSX of errors.tsx.
//
// `Record<ErrorCode, …>` rejects a missing or extra key at compile time. That
// is proof, not convention.
//
// Two errors are repairable in place instead of sending the user to the options
// page. `invalid-key` gets a paste field in the panel: the key is refused
// exactly when the user is waiting for a summary, and a round trip through
// another tab is the longest path between the problem and its fix. `quota` gets
// a switch to an already-configured provider, and is never offered when there
// is none — replacing one error with another is not a repair (see
// alternateProvider, lib/settings.ts). Both write the GLOBAL setting, through
// the same functions the options page uses.
//
// The copy MUST NOT hardcode a provider name; that sent everyone off to
// configure a Gemini key regardless of what they had chosen. It MAY name the
// ACTIVE provider, which the code reads from settings.
import type { ErrorCode } from './messages';
import type { ProviderId } from './llm/types';
import type { MessageKey } from './i18n';
import type { OptionsTab } from './options-tabs';

/** What an error button does. The panel (errors.tsx) wires them; it picks none. */
export type PanelErrorAction =
  /** Paste field for a key, inside the panel. `invalid-key` only. */
  | { kind: 'fix-key' }
  /** Switches the active provider to another already-configured one, then retries. */
  | { kind: 'switch-provider'; provider: ProviderId }
  /** Retries the summary of the displayed video. */
  | { kind: 'retry' }
  | { kind: 'open-settings'; tab: OptionsTab };

type ErrorPlan = {
  message: MessageKey;
  /** Second, smaller line: what to do about it. Absent when the message stands alone. */
  detail?: MessageKey;
  /**
   * Candidates, in display order. `resolvePanelErrorActions` filters them by
   * context — the LIST is here, the CONDITIONS are there.
   */
  actions: PanelErrorAction['kind'][];
};

export const ERROR_PLANS: Record<ErrorCode, ErrorPlan> = {
  'no-key': {
    message: 'error.no-key.message',
    actions: ['open-settings'],
  },
  'invalid-key': {
    message: 'error.invalid-key.message',
    detail: 'error.invalid-key.detail',
    actions: ['fix-key', 'open-settings'],
  },
  quota: {
    message: 'error.quota.message',
    detail: 'error.quota.detail',
    actions: ['switch-provider', 'open-settings'],
  },
  overloaded: {
    message: 'error.overloaded.message',
    detail: 'error.overloaded.detail',
    actions: ['retry'],
  },
  offline: {
    message: 'error.offline.message',
    detail: 'error.offline.detail',
    actions: ['retry'],
  },
  'not-public': {
    message: 'error.not-public.message',
    detail: 'error.not-public.detail',
    // No action: retrying returns the same answer, and "try a public video" is
    // not a button.
    actions: [],
  },
  'too-long': {
    message: 'error.too-long.message',
    detail: 'error.too-long.detail',
    actions: [],
  },
  'no-transcript': {
    message: 'error.no-transcript.message',
    detail: 'error.no-transcript.detail',
    actions: ['retry'],
  },
  'transcript-unavailable': {
    message: 'error.transcript-unavailable.message',
    detail: 'error.transcript-unavailable.detail',
    actions: ['retry'],
  },
  'transcript-incomplete': {
    message: 'error.transcript-incomplete.message',
    detail: 'error.transcript-incomplete.detail',
    actions: ['retry'],
  },
  'no-conversation': {
    message: 'error.no-conversation.message',
    detail: 'error.no-conversation.detail',
    actions: [],
  },
  unknown: {
    message: 'error.unknown.message',
    detail: 'error.unknown.detail',
    actions: ['retry'],
  },
};

export type PanelErrorContext = {
  /**
   * What the error belongs to. A follow-up answer offers neither retry nor key
   * repair: "retry" would mean asking the question again, and the panel cannot
   * replay it (ASK_SUBMITTED consumed it). No button beats a button that does
   * something other than what it says.
   */
  target: 'summary' | 'answer';
  /** Is a video identified? Without one there is nothing to retry. */
  canRetry: boolean;
  /** Another already-configured provider, or null (see alternateProvider, lib/settings.ts). */
  alternate: ProviderId | null;
};

/**
 * The buttons actually displayable, in order. Never one whose action would not
 * go through: a "Switch to …" with no provider to name, or a "Retry" with no
 * video, would be dead buttons at the worst possible moment.
 */
export function resolvePanelErrorActions(code: ErrorCode, ctx: PanelErrorContext): PanelErrorAction[] {
  const actions: PanelErrorAction[] = [];

  for (const kind of ERROR_PLANS[code].actions) {
    if (kind === 'open-settings') {
      actions.push({ kind, tab: 'providers' });
      continue;
    }
    // Everything else writes a setting or starts a generation: summary only,
    // never a follow-up answer (see PanelErrorContext.target).
    if (ctx.target !== 'summary') continue;

    if (kind === 'retry' && ctx.canRetry) actions.push({ kind });
    if (kind === 'fix-key') actions.push({ kind });
    if (kind === 'switch-provider' && ctx.alternate) actions.push({ kind, provider: ctx.alternate });
  }

  return actions;
}
