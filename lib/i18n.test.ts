import { describe, it, expect } from 'vitest';
import {
  CATALOGS, LOCALES, createTranslator, effortLabelKey, interpolate, isLocale, pluralCategory, resolveLocale,
} from './i18n';
import { EFFORT_SCALE } from './llm/types';
import { ERROR_PLANS } from './panel-errors';

describe('resolveLocale', () => {
  it('lets an explicit choice win over the browser', () => {
    expect(resolveLocale('en', 'fr-FR')).toBe('en');
    expect(resolveLocale('fr', 'en-US')).toBe('fr');
  });

  it('treats empty as follow the browser, ignoring the region', () => {
    expect(resolveLocale('', 'fr-CA')).toBe('fr');
    expect(resolveLocale('', 'en-GB')).toBe('en');
  });

  // Falls back to English rather than French, even though French is the
  // reference catalogue: a German browser has no reason to get French.
  it("falls back to English for a language with no catalogue", () => {
    expect(resolveLocale('', 'de-DE')).toBe('en');
    expect(resolveLocale('de', 'de-DE')).toBe('en');
  });

  it('does not crash on a setting that became invalid: it falls back to the browser', () => {
    expect(resolveLocale('klingon', 'fr-FR')).toBe('fr');
  });
});

describe('isLocale', () => {
  it('recognises only the languages actually translated', () => {
    expect(isLocale('fr')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('es')).toBe(false);
  });
});

// The only rule that differs between the two catalogues. A key that lists
// nothing shows 0: the common case, not an edge case.
describe('pluralCategory', () => {
  it('puts 0 and 1 in the singular in French', () => {
    expect(pluralCategory('fr', 0)).toBe('one');
    expect(pluralCategory('fr', 1)).toBe('one');
    expect(pluralCategory('fr', 2)).toBe('other');
  });

  it('puts 0 in the plural in English', () => {
    expect(pluralCategory('en', 0)).toBe('other');
    expect(pluralCategory('en', 1)).toBe('one');
    expect(pluralCategory('en', 2)).toBe('other');
  });
});

describe('interpolate', () => {
  it('replaces named placeholders', () => {
    expect(interpolate('by {provider} ({model})', { provider: 'X', model: 'y' })).toBe('by X (y)');
  });

  it('accepts a number', () => {
    expect(interpolate('{count} s', { count: 12 })).toBe('12 s');
  });

  // A visible "{provider}" gets noticed and fixed; an "undefined" reads as a bug
  // in the extension.
  it('leaves a placeholder with no value as is, never "undefined"', () => {
    expect(interpolate('by {provider}', {})).toBe('by {provider}');
    expect(interpolate('by {provider}')).toBe('by {provider}');
  });
});

describe('createTranslator', () => {
  it('renders the requested language catalogue', () => {
    expect(createTranslator('fr')('panel.onboarding.cta')).toBe('Commencer');
    expect(createTranslator('en')('panel.onboarding.cta')).toBe('Get started');
  });

  it('injects the parameters', () => {
    expect(createTranslator('fr')('providers.key.get', { provider: 'Anthropic' }))
      .toBe('Obtenir une clé Anthropic');
  });

  it('picks the plural form and injects {count} without being passed it', () => {
    const fr = createTranslator('fr');
    expect(fr.n('profiles.chars', 1)).toBe('1 caractère');
    expect(fr.n('profiles.chars', 12)).toBe('12 caractères');
  });

  it('mixes {count} with the other parameters', () => {
    expect(createTranslator('fr').n('effort.byProvider', 3, { provider: 'OpenRouter' }))
      .toBe('3 crans, rétrogradés par OpenRouter selon le modèle');
  });

  it('exposes its locale, which is what formats provenance dates', () => {
    expect(createTranslator('en').locale).toBe('en');
  });
});

// Catalogue exhaustiveness is guaranteed by typing (`en: Catalog`), never by a
// test. What follows checks what typing CANNOT see: that no translation is
// empty, that plural pairs are complete, and that keys referenced elsewhere in
// lib/ really exist.
describe('catalogues', () => {
  it('has no empty translation in any language', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(CATALOGS[locale])) {
        expect(value.trim(), `${locale}/${key}`).not.toBe('');
      }
    }
  });

  it('gives every "_other" key its "_one", in both languages', () => {
    for (const locale of LOCALES) {
      const catalog = CATALOGS[locale];
      for (const key of Object.keys(catalog)) {
        if (!key.endsWith('_other')) continue;
        expect(catalog, `${locale}/${key}`).toHaveProperty(key.replace(/_other$/, '_one'));
      }
    }
  });

  it('carries exactly the same keys in both languages', () => {
    expect(Object.keys(CATALOGS.en).sort()).toEqual(Object.keys(CATALOGS.fr).sort());
  });

  // No level of the scale, and not 'default' either, may end up without a label.
  it('gives every effort level its label, in both languages', () => {
    for (const locale of LOCALES) {
      for (const level of ['default', ...EFFORT_SCALE] as const) {
        expect(CATALOGS[locale][effortLabelKey(level)], `${locale}/${level}`).toBeTruthy();
      }
    }
  });

  it('gives every panel error code a translated message', () => {
    for (const locale of LOCALES) {
      for (const [code, plan] of Object.entries(ERROR_PLANS)) {
        expect(CATALOGS[locale][plan.message], `${locale}/${code}`).toBeTruthy();
        if (plan.detail) expect(CATALOGS[locale][plan.detail], `${locale}/${code}/detail`).toBeTruthy();
      }
    }
  });
});
