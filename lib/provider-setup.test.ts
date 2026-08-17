import { describe, it, expect } from 'vitest';
import {
  OAUTH_PROVIDER, SETUP_STEPS, SETUP_STEP_LABELS, canGoBackTo, keyStepCopy, setupRows, stepStatus,
} from './provider-setup';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import { CATALOGS } from './i18n';

const settings = (apiKeys: Settings['apiKeys']): Settings => ({ ...DEFAULT_SETTINGS, apiKeys });

describe('setupRows — the order of the list', () => {
  it('puts the providers that have a key first', () => {
    const rows = setupRows(settings({ gemini: 'g' }));
    expect(rows[0]).toEqual({ id: 'gemini', hasKey: true });
    expect(rows.every((r, i) => i === 0 || !r.hasKey)).toBe(true);
  });

  // Stable across visits: a sort on a changing criterion (last used, translated
  // alphabet) would move the rows under the cursor.
  it("keeps PROVIDERS' order inside each group", () => {
    const rows = setupRows(settings({ gemini: 'g', openai: 'o' }));
    expect(rows.map((r) => r.id)).toEqual([
      'openai', 'gemini', 'openrouter', 'deepseek', 'anthropic', 'opencode-go',
    ]);
  });

  // `custom` cannot be covered by host permissions declared ahead of time, so
  // offering it would offer a silently broken extension (see PROVIDERS,
  // lib/llm/index.ts).
  it('never offers `custom`, even with a key stored for it', () => {
    expect(setupRows(settings({ custom: 'c' })).some((r) => r.id === 'custom')).toBe(false);
  });

  it('lists every other provider when nothing is configured', () => {
    const rows = setupRows(settings({}));
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => !r.hasKey)).toBe(true);
  });
});

describe('stepStatus — where the assistant stands', () => {
  it('opens on the provider step, the key still ahead', () => {
    expect(stepStatus('provider', { kind: 'list' })).toBe('current');
    expect(stepStatus('key', { kind: 'list' })).toBe('upcoming');
  });

  it('marks the provider behind once the key step is open', () => {
    const screen = { kind: 'key', provider: 'gemini' } as const;
    expect(stepStatus('provider', screen)).toBe('done');
    expect(stepStatus('key', screen)).toBe('current');
  });

  // A two-state bar would leave the last step looking pending on the very screen
  // that says it succeeded.
  it('marks BOTH steps behind on the success screen', () => {
    const screen = { kind: 'done', provider: 'gemini' } as const;
    expect(SETUP_STEPS.map((s) => stepStatus(s, screen))).toEqual(['done', 'done']);
  });
});

describe('canGoBackTo — the step behind you is a way back', () => {
  it('offers no way back from the step you are on', () => {
    expect(canGoBackTo('provider', { kind: 'list' })).toBe(false);
  });

  it('returns to the list from the key step, exactly as the back link does', () => {
    expect(canGoBackTo('provider', { kind: 'key', provider: 'gemini' })).toBe(true);
  });

  it('returns to the list from the success screen too', () => {
    expect(canGoBackTo('provider', { kind: 'done', provider: 'gemini' })).toBe(true);
  });

  // Both steps are behind on the success screen, but going back to the KEY one
  // would offer to replace a key just stored — what that screen refuses to do.
  it('never leads back to the key step', () => {
    expect(canGoBackTo('key', { kind: 'done', provider: 'gemini' })).toBe(false);
    expect(canGoBackTo('key', { kind: 'key', provider: 'gemini' })).toBe(false);
    expect(canGoBackTo('key', { kind: 'list' })).toBe(false);
  });
});

describe('keyStepCopy — three situations, three things to say', () => {
  it('a stored key offers to show, replace or delete it', () => {
    expect(keyStepCopy({ provider: 'gemini', stored: true })).toEqual({
      titleKey: 'setup.key.stored.title',
      subtitleKey: 'setup.key.stored.subtitle',
    });
  });

  // The one provider with third-party OAuth: its step opens on a button, and
  // says so, where the others open on a field.
  it('OpenRouter with no key leads with the connection', () => {
    expect(keyStepCopy({ provider: OAUTH_PROVIDER, stored: false }).titleKey)
      .toBe('setup.key.oauth.title');
  });

  it('any other provider with no key asks for a paste', () => {
    expect(keyStepCopy({ provider: 'anthropic', stored: false })).toEqual({
      titleKey: 'setup.key.paste.title',
      subtitleKey: 'setup.key.paste.subtitle',
    });
  });

  // The OAuth copy belongs to the flow, not to the provider: a stored key is a
  // stored key, whichever way it got there.
  it('a stored OpenRouter key gets the stored copy, not the OAuth one', () => {
    expect(keyStepCopy({ provider: OAUTH_PROVIDER, stored: true }).titleKey)
      .toBe('setup.key.stored.title');
  });
});

// The keys returned above are only worth anything if the catalogue answers them.
// Typing proves `en` covers `fr`; this proves the assistant names keys that
// exist at all.
describe('the assistant names keys the catalogue holds', () => {
  it('translates every step label, in both languages', () => {
    for (const catalog of Object.values(CATALOGS)) {
      for (const step of SETUP_STEPS) {
        expect(catalog[SETUP_STEP_LABELS[step]]).toBeTruthy();
      }
    }
  });

  it('translates every key-step title and subtitle, in both languages', () => {
    const cases = [
      keyStepCopy({ provider: OAUTH_PROVIDER, stored: false }),
      keyStepCopy({ provider: 'gemini', stored: false }),
      keyStepCopy({ provider: 'gemini', stored: true }),
    ];
    for (const catalog of Object.values(CATALOGS)) {
      for (const { titleKey, subtitleKey } of cases) {
        expect(catalog[titleKey]).toBeTruthy();
        expect(catalog[subtitleKey]).toBeTruthy();
      }
    }
  });
});
