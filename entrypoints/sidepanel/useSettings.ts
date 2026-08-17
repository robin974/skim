// The settings, read once for the whole panel.
//
// Several screens depend on them — the unconfigured panel, in-place key repair,
// provider switching on errors, the interface language — so one read is hoisted
// to the root rather than several independent ones that would diverge on the
// first change.
//
// Listening to chrome.storage is not comfort: onboarding consists precisely of
// configuring a key IN ANOTHER TAB while the panel stays open beside the video.
// Without it the panel would stay stuck on "no account configured" until closed,
// having done exactly what it asked for with nothing visibly changing.
import { useCallback, useEffect, useState } from 'react';
import { getSettings, getStoredLanguage, setSettings } from '@/lib/settings';
import type { Settings } from '@/lib/settings';

export type UseSettings = {
  /** `null` until the first read completes (a few milliseconds of local storage). */
  settings: Settings | null;
  /**
   * The summary language AS STORED: '' means "follow the browser", a
   * distinction getSettings() erases by always resolving it. Read here, beside
   * the settings it belongs to, because the language hint's whole condition
   * rests on it (see shouldShowLanguageHint, lib/language-hint.ts).
   */
  storedLanguage: string;
  /**
   * Optimistic, like the options page's `patch()`: the display flips
   * immediately, the real write follows. Errors go to the console, never to the
   * UI — an onChange cannot await a promise.
   */
  patch: (p: Partial<Settings>) => Promise<void>;
};

const SETTINGS_KEY = 'settings';

export function useSettings(): UseSettings {
  const [settings, setLocalSettings] = useState<Settings | null>(null);
  const [storedLanguage, setStoredLanguage] = useState('');

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      Promise.all([getSettings(), getStoredLanguage()])
        .then(([s, lang]) => {
          if (cancelled) return;
          setLocalSettings(s);
          setStoredLanguage(lang);
        })
        .catch(console.error);
    };

    reload();

    // The 'settings' key of storage.local only: any other entry of that area
    // changing is none of this hook's business, and reloading the settings for it
    // would be pure waste.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && SETTINGS_KEY in changes) reload();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  const patch = useCallback(async (p: Partial<Settings>): Promise<void> => {
    setLocalSettings((prev) => (prev ? { ...prev, ...p } : prev));
    try {
      await setSettings(p);
    } catch (e) {
      console.error(e);
    }
  }, []);

  return { settings, storedLanguage, patch };
}
