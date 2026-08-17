// The shared effort scale and its single clamping rule. Kept apart from the
// providers on purpose: each provider knows what ITS model accepts
// (effortsFor), and none needs to know the rule arbitrating between the level
// requested and the levels offered.
import { EFFORT_SCALE } from './types';
import type { EffortLevel, EffortScaleLevel, EffortSupport, Provider } from './types';
import type { PluralKey, Translator } from '@/lib/i18n';

/**
 * Entries of the effort control for a given model. `'default'` opens the list
 * without being a level: it compares to nothing, it says "let the provider
 * decide". An EMPTY list when nothing is steerable — never "default" alone,
 * which would offer a choice with no alternative.
 */
export function effortChoices(support: EffortSupport): EffortLevel[] {
  return support.levels.length === 0 ? [] : ['default', ...support.levels];
}

/**
 * What the sentence under the effort control is built from: what the code KNOWS
 * about the levels offered, never more.
 *
 * The distinction is not cosmetic. At OpenRouter the 7 levels belong to the
 * PROVIDER and apply to any relayed model id, so claiming "7 levels accepted by
 * this model" was false for every non-reasoning model — the user saw eight inert
 * chips with nothing to say so, on the DEFAULT provider.
 *
 * Returns a KEY and a count, never the sentence: the decision — which of the two
 * claims the code is entitled to make — stays here and stays tested, while the
 * words live in the catalogue. Shared by the panel and the options page, so the
 * same table is never described by two sentences that could contradict.
 */
export function describeEffortLevels(support: EffortSupport, providerLabel: string, t: Translator): string {
  const key: Extract<PluralKey, 'effort.byProvider' | 'effort.byModel'> =
    support.scope === 'provider' ? 'effort.byProvider' : 'effort.byModel';
  return t.n(key, support.levels.length, { provider: providerLabel });
}

/** The sentence shown in place of the control. Names the reason: the two do not call for the same response. */
export function describeNoEffort(support: EffortSupport, t: Translator): string {
  return t(support.reason === 'no-reasoning' ? 'effort.none.noReasoning' : 'effort.none.unknown');
}

/**
 * The level actually sendable, or `undefined` when nothing should be sent.
 *
 * ONE RULE: never climb the scale. A level that is too high drops to the highest
 * offered level below it; with nothing below, the parameter is omitted.
 *
 * That last branch deliberately replaces the `lowest-effort` fallback of the
 * reference implementation (`clamped ?? levels[0]`), which climbs. Climbing
 * would bill reasoning nobody asked for, on every summary: the project default
 * is 'off' (DEFAULT_EFFORT, lib/settings.ts), so on a model that cannot turn off,
 * `levels[0]` would go out for everyone. Omission reproduces the pre-feature body
 * byte for byte.
 *
 * Returns an EffortScaleLevel, never an EffortLevel: 'default' NEVER comes out of
 * here — it goes in as a request and comes back as `undefined`. Saying so in the
 * type spares every provider encoder a case this function does not produce.
 */
export function clampEffort(support: EffortSupport, requested: EffortLevel): EffortScaleLevel | undefined {
  if (requested === 'default' || support.levels.length === 0) return undefined;
  if (support.levels.includes(requested)) return requested;

  const wanted = EFFORT_SCALE.indexOf(requested);
  let best: EffortScaleLevel | undefined;
  // `levels` is in increasing order, so the last level seen below the threshold
  // is the highest one that stays below it.
  for (const level of support.levels) {
    if (EFFORT_SCALE.indexOf(level) >= wanted) break;
    best = level;
  }
  return best;
}

/**
 * A model's capabilities, with the contract's fallback. `effortsFor` is OPTIONAL
 * on Provider, exactly like `modelCatalog`: a provider that does not implement it
 * thereby declares that nothing is known about its models, and the interface says
 * so instead of offering an inert setting.
 */
export function effortsOf(provider: Provider, model: string): EffortSupport {
  return provider.effortsFor?.(model) ?? { levels: [], reason: 'unknown' };
}
