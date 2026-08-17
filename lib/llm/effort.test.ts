import { describe, it, expect } from 'vitest';
import { createTranslator } from '@/lib/i18n';
import {
  clampEffort, effortsOf, effortChoices, describeNoEffort, describeEffortLevels,
} from './effort';
import { openrouter, deepseek } from './providers/openai-compatible';
import { EFFORT_SCALE } from './types';
import type { EffortSupport, Provider } from './types';

const support = (...levels: EffortSupport['levels']): EffortSupport => ({ levels });

describe('EFFORT_SCALE', () => {
  it("runs lowest to highest, and 'default' is not part of it", () => {
    expect(EFFORT_SCALE).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  });
});

describe('clampEffort — never climbs the scale', () => {
  it("'default' omits the parameter, whatever levels are offered", () => {
    expect(clampEffort(support('low', 'high'), 'default')).toBeUndefined();
  });

  it('omits the parameter when no level is offered', () => {
    expect(clampEffort({ levels: [], reason: 'unknown' }, 'high')).toBeUndefined();
  });

  it('passes an offered level through unchanged', () => {
    expect(clampEffort(support('high', 'max'), 'max')).toBe('max');
  });

  it('drops a too-high level to the highest offered level below it', () => {
    expect(clampEffort(support('minimal', 'low', 'medium', 'high'), 'max')).toBe('high');
    expect(clampEffort(support('low', 'high', 'max'), 'medium')).toBe('low');
  });

  it("OMITS for a level below everything offered, never climbing to meet it", () => {
    expect(clampEffort(support('high', 'max'), 'minimal')).toBeUndefined();
    expect(clampEffort(support('low', 'high'), 'minimal')).toBeUndefined();
  });

  it("omits when 'off' is not offered: never bill reasoning nobody asked for", () => {
    expect(clampEffort(support('high', 'max'), 'off')).toBeUndefined();
  });

  it("passes 'off' through when it is offered", () => {
    expect(clampEffort(support('off', 'low', 'high'), 'off')).toBe('off');
  });
});

describe('effortsOf — absent means unknown, as with modelCatalog', () => {
  const bare = { id: 'openai' } as unknown as Provider;

  it("a provider without effortsFor returns unknown, never a mute empty list", () => {
    expect(effortsOf(bare, 'gpt-4o-mini')).toEqual({ levels: [], reason: 'unknown' });
  });

  it('delegates when the provider implements effortsFor', () => {
    const p = { ...bare, effortsFor: () => support('low', 'high') } as unknown as Provider;
    expect(effortsOf(p, 'any-model')).toEqual({ levels: ['low', 'high'] });
  });
});

describe('effortChoices — the list comes from the model, not a constant', () => {
  it("opens the list with 'default', then the model's levels in order", () => {
    expect(effortChoices({ levels: ['high', 'max'] })).toEqual(['default', 'high', 'max']);
  });

  it('offers no list at all when no level is available, not even default alone', () => {
    expect(effortChoices({ levels: [], reason: 'unknown' })).toEqual([]);
  });
});

// The interface used to claim "N levels on this model" while OpenRouter's table
// knows nothing about the model — its 7 levels apply to any relayed id,
// including a model that does not reason. The sentence must say what the code
// knows, no more.
//
// Both functions compose their sentence from the message catalogue: the DECISION
// stays here, the words come from there. The assertions below use a real French
// translator and check the rendered sentence.
const t = createTranslator('fr');

describe('describeEffortLevels — the note asserts of the model only what the code knows', () => {
  it('per-model table: the note really does speak of the model', () => {
    expect(describeEffortLevels({ levels: ['high', 'max'] }, 'DeepSeek', t))
      .toBe('2 crans acceptés par ce modèle');
  });

  it("provider list: names the provider and its downgrading, never the model", () => {
    const note = describeEffortLevels(openrouter.effortsFor?.('openai/gpt-4o-mini') ?? { levels: [] }, 'OpenRouter', t);
    expect(note).toBe('7 crans, rétrogradés par OpenRouter selon le modèle');
    expect(note).not.toContain('ce modèle');
  });

  it("agrees in the singular for a single level", () => {
    expect(describeEffortLevels({ levels: ['high'] }, 'DeepSeek', t)).toBe('1 cran accepté par ce modèle');
  });

  it("PER-MODEL tables do not declare 'provider', or the note would lie the other way", () => {
    expect(deepseek.effortsFor?.('deepseek-v4-pro')?.scope).toBeUndefined();
  });
});

describe('describeNoEffort — two reasons, two responses', () => {
  it('a model that does not reason closes the subject', () => {
    expect(describeNoEffort({ levels: [], reason: 'no-reasoning' }, t)).toBe('Ce modèle ne réfléchit pas.');
  });

  it("an unknown capability leaves a way out: change model", () => {
    expect(describeNoEffort({ levels: [], reason: 'unknown' }, t))
      .toBe("L'extension ne sait pas piloter la réflexion de ce modèle.");
  });
});
