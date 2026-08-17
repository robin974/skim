// Whether to show the one-off "this summary is in English" hint under a
// finished summary.
//
// In lib/ rather than in the component because the decision is the whole
// feature: four conditions that must ALL hold, one of them a distinction
// getSettings() deliberately erases (see getStoredLanguage, lib/settings.ts).
// The component only renders what this returns.

import type { UiState } from './panel-reducer';

/**
 * The fallback the hint exists to make visible. resolveLocale falls back to
 * English for any browser language the extension has no catalogue for, and
 * getSettings() applies the same rule to the SUMMARY language — so a German
 * browser receives English summaries without ever having asked for them.
 */
const FALLBACK_LANGUAGE = 'en';

export type LanguageHintState = {
  /** settings.summaryLanguageHintDismissed: the ✕ was pressed, once, ever. */
  dismissed: boolean;
  /**
   * getStoredLanguage(): '' means "follow the browser". NOT settings.language,
   * which getSettings() has already resolved to a concrete code — the resolution
   * is exactly what this condition has to see through.
   */
  storedLanguage: string;
  /** settings.language, after that resolution: what the model is actually told. */
  language: string;
  status: UiState['status'];
  text: string;
};

/**
 * True only under a summary that PROVES the point: finished, on screen, written
 * in a language nobody chose.
 *
 * Never while streaming and never on an error — a hint about the language of a
 * text that does not exist yet is a claim, not an observation. And never when a
 * language WAS chosen, even if that choice happens to be English: the user
 * already knows where the setting is.
 */
export function shouldShowLanguageHint(s: LanguageHintState): boolean {
  return !s.dismissed
    && s.storedLanguage === ''
    && s.language === FALLBACK_LANGUAGE
    && s.status === 'done'
    && s.text !== '';
}
