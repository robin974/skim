// The providers tab, as an assistant: pick a provider, store its key. Two
// steps, always — a page of forms is what the first screen after install used
// to be, and it said nothing about where to start.
//
// The tab configures KEYS and nothing else. Model and reasoning effort belong to
// the panel header now, beside the summary they will produce, and with them goes
// the notion of an ACTIVE provider: a stored key makes a provider selectable
// THERE, and the panel picks the one the next summary uses (see storeKeyPatch,
// lib/settings.ts, for the one case the settings still touch that selection).
//
// What lives here is what the screen decides and a test can check — the order of
// the list, where the assistant stands, which sentences the key step carries.
// The .tsx keeps the styles and the wiring.
import { SELECTABLE_PROVIDERS } from './llm';
import type { ProviderId } from './llm/types';
import type { MessageKey } from './i18n';
import type { Settings } from './settings';

/**
 * The one provider offering third-party OAuth, hence the only one whose key step
 * opens with a button rather than a field. Not a capability flag on Provider:
 * the flow itself is written for OpenRouter alone (see openrouter-connect.ts),
 * and a flag would promise an abstraction that does not exist.
 */
export const OAUTH_PROVIDER: ProviderId = 'openrouter';

/**
 * Where the assistant stands. Not persisted: reopening the settings starts on
 * the list, which is the screen that says what can be done.
 *
 * `done` is the success screen, distinct from `key` with a stored key: one
 * confirms what just happened, the other offers to show, replace or delete.
 */
export type SetupScreen =
  | { kind: 'list' }
  | { kind: 'key'; provider: ProviderId }
  | { kind: 'done'; provider: ProviderId };

export type SetupStep = 'provider' | 'key';

export const SETUP_STEPS: readonly SetupStep[] = ['provider', 'key'];

export const SETUP_STEP_LABELS: Record<SetupStep, MessageKey> = {
  provider: 'setup.step.provider',
  key: 'setup.step.key',
};

/**
 * How a step reads in the bar: the one being taken, one already behind, or one
 * still ahead. Three states rather than a boolean, because the bar has to say
 * both "you are here" and "this is behind you" — a two-state bar leaves the last
 * step looking pending on the success screen.
 */
export type StepStatus = 'current' | 'done' | 'upcoming';

export function stepStatus(step: SetupStep, screen: SetupScreen): StepStatus {
  if (screen.kind === 'done') return 'done';
  if (screen.kind === 'list') return step === 'provider' ? 'current' : 'upcoming';
  return step === 'provider' ? 'done' : 'current';
}

/**
 * Whether a step in the bar leads back to the list. The bar is a trail, not a
 * progress meter: the step behind you is where you came from, and clicking it
 * does exactly what the "‹ Changer de fournisseur" link does.
 *
 * The provider step only. Going back to the KEY step from the success screen
 * would offer to replace a key just stored — the one thing that screen
 * deliberately does not offer.
 */
export function canGoBackTo(step: SetupStep, screen: SetupScreen): boolean {
  return step === 'provider' && screen.kind !== 'list';
}

/** One line of the provider list: a name, and whether its key is stored. */
export type SetupRow = { id: ProviderId; hasKey: boolean };

/**
 * The list, configured providers first, PROVIDERS order within each group.
 *
 * Configured first because those are the ones with nothing left to do; the
 * others send the user off to fetch a key. The order stays PROVIDERS' inside
 * each group — stable across visits, which a sort on a changing criterion (last
 * used, translated alphabet) would not be.
 */
export function setupRows(s: Settings): SetupRow[] {
  const rows = SELECTABLE_PROVIDERS.map((id) => ({ id, hasKey: Boolean(s.apiKeys[id]) }));
  return [...rows.filter((r) => r.hasKey), ...rows.filter((r) => !r.hasKey)];
}

/**
 * The title and subtitle of the key step. Three situations, three things to say:
 * a key is already stored, OpenRouter can create one in a click, or there is one
 * to paste.
 *
 * Returns KEYS, never sentences (see lib/i18n.ts): the decision is tested here,
 * the wording lives in the catalogue. Both take a `{provider}` parameter, which
 * the caller fills with the provider's label — a catalogue that ignores it in
 * one language is free to.
 */
export function keyStepCopy(
  { provider, stored }: { provider: ProviderId; stored: boolean },
): { titleKey: MessageKey; subtitleKey: MessageKey } {
  if (stored) {
    return { titleKey: 'setup.key.stored.title', subtitleKey: 'setup.key.stored.subtitle' };
  }
  if (provider === OAUTH_PROVIDER) {
    return { titleKey: 'setup.key.oauth.title', subtitleKey: 'setup.key.oauth.subtitle' };
  }
  return { titleKey: 'setup.key.paste.title', subtitleKey: 'setup.key.paste.subtitle' };
}
