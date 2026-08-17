// The languages tab: the two languages side by side, so they stop being
// confused for each other.
//
// Reading the settings in English does not oblige anyone to receive English
// summaries, and the reverse holds too.
import type { Settings } from '@/lib/settings';
import { languageName } from '@/lib/settings';
import { LOCALES } from '@/lib/i18n';
import { useT } from '@/lib/i18n-react';
import { labelStyle, selectStyle } from './ui';

/**
 * Languages offered for the SUMMARY. Names are rendered through languageName, so
 * there is no label table to maintain.
 *
 * Unrelated to the INTERFACE language list below, and rightly so: the model can
 * write in a language the extension has not been translated into. The two lists
 * have no reason to coincide.
 */
const SUMMARY_LANGUAGES = ['fr', 'en', 'es', 'de', 'it', 'pt', 'nl', 'ja', 'ko', 'zh'];

type Props = {
  settings: Settings;
  patch: (p: Partial<Settings>) => Promise<void>;
  /**
   * The summary language AS STORED (see getStoredLanguage, lib/settings.ts): the
   * <select> must tell "chosen" from "follow the browser", a distinction
   * getSettings() loses by resolving the empty value.
   */
  storedLanguage: string;
  onStoredLanguageChange: (value: string) => void;
};

export function LanguagesTab({ settings, patch, storedLanguage, onStoredLanguageChange }: Props) {
  const t = useT();
  const browser = chrome.i18n.getUILanguage().split('-')[0] ?? 'en';

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div>
          <label style={{ ...labelStyle, display: 'block', marginBottom: 6 }} htmlFor="ui-language">
            {t('languages.ui.label')}
          </label>
          <select
            id="ui-language"
            value={settings.uiLanguage}
            onChange={(e) => patch({ uiLanguage: e.target.value }).catch(console.error)}
            style={selectStyle}
          >
            {/* The browser language's name in parentheses: without it, "browser
               language" does not say what you will get. */}
            <option value="">{t('languages.browser', { name: languageName(browser) })}</option>
            {/* Only the languages REALLY translated (LOCALES, lib/i18n.ts),
               never the summary language list: offering an interface language
               with no catalogue would show French under a label promising
               otherwise. */}
            {LOCALES.map((code) => (
              <option key={code} value={code}>{languageName(code)}</option>
            ))}
          </select>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--muted)' }}>{t('languages.ui.hint')}</p>
        </div>

        <div>
          <label style={{ ...labelStyle, display: 'block', marginBottom: 6 }} htmlFor="summary-language">
            {t('languages.summary.label')}
          </label>
          <select
            id="summary-language"
            value={storedLanguage}
            onChange={(e) => {
              const value = e.target.value;
              onStoredLanguageChange(value);
              patch({ language: value }).catch(console.error);
            }}
            style={selectStyle}
          >
            <option value="">{t('languages.browserPlain')}</option>
            {SUMMARY_LANGUAGES.map((code) => (
              <option key={code} value={code}>{languageName(code)}</option>
            ))}
          </select>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--muted)' }}>{t('languages.summary.hint')}</p>
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55 }}>{t('languages.note')}</p>
    </div>
  );
}
