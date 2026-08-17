// Makes the translator available to the whole React tree. A context rather than
// a `t` prop: the options page has four tabs and some twenty nested components,
// and a prop crossing all of them teaches nobody anything on the way.
//
// In lib/ despite containing JSX, because BOTH entrypoints need it and a shared
// module placed in entrypoints/ would be taken by WXT for another entrypoint —
// every file at the root of entrypoints/ is one. Being here claims nothing about
// testability: this is React wiring, and the translatable logic lives in
// lib/i18n.ts, tested there.
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { createTranslator, resolveLocale, type Translator } from './i18n';

const TranslatorContext = createContext<Translator | null>(null);

/**
 * `uiLanguage` is the RAW setting (empty = follow the browser). Resolution to a
 * real locale happens here, once, through resolveLocale, so the caller needs to
 * know nothing about the browser language or the fallback.
 */
export function TranslationProvider({ uiLanguage, children }: { uiLanguage: string; children: ReactNode }) {
  const t = useMemo(
    () => createTranslator(resolveLocale(uiLanguage, chrome.i18n.getUILanguage())),
    [uiLanguage],
  );

  // `lang` on <html> is not cosmetic: it tells a screen reader which voice to
  // use and the browser which hyphenation rules to apply. Both documents (panel
  // and options) are written in French in their static HTML, so without this an
  // interface switched to English would still be announced as French.
  useEffect(() => {
    document.documentElement.lang = t.locale;
  }, [t]);

  return <TranslatorContext.Provider value={t}>{children}</TranslatorContext.Provider>;
}

/**
 * Throws rather than falling back silently to a default catalogue: a component
 * rendered outside the provider would show a language other than the chosen one
 * with nothing to signal it. A blank screen in development beats a half
 * translated interface in production.
 */
export function useT(): Translator {
  const t = useContext(TranslatorContext);
  if (t === null) throw new Error('useT() hors de <TranslationProvider> : aucun catalogue de messages en vue.');
  return t;
}
