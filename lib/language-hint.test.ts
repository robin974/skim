import { describe, it, expect } from 'vitest';
import { shouldShowLanguageHint, type LanguageHintState } from './language-hint';

/** The one state where the hint is earned: everything else varies from here. */
const shown: LanguageHintState = {
  dismissed: false,
  storedLanguage: '',
  language: 'en',
  status: 'done',
  text: 'One variable changed at a time.',
};

describe('shouldShowLanguageHint', () => {
  it('shows under a finished English summary the user never asked for', () => {
    expect(shouldShowLanguageHint(shown)).toBe(true);
  });

  // The ✕ is the only thing that hides it for good.
  it('never shows once dismissed', () => {
    expect(shouldShowLanguageHint({ ...shown, dismissed: true })).toBe(false);
  });

  // A user who picked English knows where the setting is. This is the condition
  // getSettings() cannot express on its own: it resolves an empty language to a
  // concrete code, so `language: 'en'` alone cannot tell the two apart.
  it('never shows when a language was explicitly chosen, English included', () => {
    expect(shouldShowLanguageHint({ ...shown, storedLanguage: 'en' })).toBe(false);
    expect(shouldShowLanguageHint({ ...shown, storedLanguage: 'fr', language: 'fr' })).toBe(false);
  });

  // The hint names English because English is the fallback. A French browser
  // gets French summaries and has nothing to be told.
  it('never shows when the fallback did not apply', () => {
    expect(shouldShowLanguageHint({ ...shown, language: 'fr' })).toBe(false);
    expect(shouldShowLanguageHint({ ...shown, language: 'de' })).toBe(false);
  });

  // A claim about the language of a text that does not exist yet is a claim, not
  // an observation.
  it('never shows without a finished summary on screen', () => {
    expect(shouldShowLanguageHint({ ...shown, status: 'streaming' })).toBe(false);
    expect(shouldShowLanguageHint({ ...shown, status: 'loading' })).toBe(false);
    expect(shouldShowLanguageHint({ ...shown, status: 'error' })).toBe(false);
    expect(shouldShowLanguageHint({ ...shown, status: 'idle' })).toBe(false);
    expect(shouldShowLanguageHint({ ...shown, text: '' })).toBe(false);
  });
});
