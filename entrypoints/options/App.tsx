// The options page. Design target, not a formality: one step, under two
// minutes, no jargon — the first cause of abandonment in a BYOK product.
//
// Every change is stored immediately through setSettings: there is no save
// button anywhere on this page.
//
// This file is the shell — header, status badge, tab bar, provenance footer —
// and the sole owner of the settings. Tabs receive them as props and write
// through the same optimistic `patch`, never through a read of their own.
//
// The active tab lives in the URL HASH, not in React state alone: that is what
// lets the side panel open the settings ON the setting at fault (see
// openOptions, lib/open-options.ts) instead of dropping the user on a page to
// explore.
import { useCallback, useEffect, useState } from 'react';
import { getSettings, setSettings, getStoredLanguage, configuredProviders, storeKeyPatch } from '@/lib/settings';
import type { Settings } from '@/lib/settings';
import type { ProviderId } from '@/lib/llm/types';
import { OPTIONS_TABS, hashForTab, tabFromHash, type OptionsTab } from '@/lib/options-tabs';
import { TranslationProvider, useT } from '@/lib/i18n-react';
import type { MessageKey } from '@/lib/i18n';
import { formatBuildFooter, type BuildInfo } from '@/lib/build-info';
import { resumePendingSummaryIfAny } from './resume';
import { ProvidersTab } from './ProvidersTab';
import { ProfilesTab } from './ProfilesTab';
import { LanguagesTab } from './LanguagesTab';
import { DataTab } from './DataTab';
import { BRAND_PILL, brandNameStyle, pageStyle, taglineStyle } from './ui';

/**
 * Build identity, computed once at module load: these are compile-time
 * constants (see wxt.config.ts), not state that could change during a session.
 * No key and no setting goes into it — a release knows only its version, a dev
 * build adds sha, branch, dirty flag and timestamp.
 */
const BUILD_INFO: BuildInfo = __BUILD_RELEASE__
  ? { kind: 'release', version: chrome.runtime.getManifest().version }
  : {
      kind: 'dev', version: chrome.runtime.getManifest().version,
      sha: __BUILD_SHA__, branch: __BUILD_BRANCH__, dirty: __BUILD_DIRTY__, timestamp: __BUILD_TIME__,
    };
const BUILD_FOOTER = formatBuildFooter(BUILD_INFO);

const TAB_LABELS: Record<OptionsTab, MessageKey> = {
  providers: 'options.tab.providers',
  profiles: 'options.tab.profiles',
  languages: 'options.tab.languages',
  data: 'options.tab.data',
};

export function App() {
  const [settings, setLocalSettings] = useState<Settings | null>(null);
  const [storedLanguage, setStoredLanguage] = useState('');

  const load = useCallback(async () => {
    const [s, lang] = await Promise.all([getSettings(), getStoredLanguage()]);
    setLocalSettings(s);
    setStoredLanguage(lang);
  }, []);

  useEffect(() => { load().catch(console.error); }, [load]);

  /**
   * Never rejects: errors are logged here rather than propagated, so JSX
   * handlers can call it without an await or a .catch() at every call site and
   * without leaving an unhandled promise.
   */
  const patch = useCallback(async (p: Partial<Settings>): Promise<void> => {
    setLocalSettings((prev) => (prev ? { ...prev, ...p } : prev));
    try {
      await setSettings(p);
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Nothing to show before the interface language is known: a first screen
  // rendered in the wrong language and replaced a fraction of a second later
  // would be worse than a blank instant. This is a local storage read.
  if (!settings) return null;

  return (
    <TranslationProvider uiLanguage={settings.uiLanguage}>
      <Page
        settings={settings}
        patch={patch}
        storedLanguage={storedLanguage}
        onStoredLanguageChange={setStoredLanguage}
        onReload={load}
      />
    </TranslationProvider>
  );
}

type PageProps = {
  settings: Settings;
  patch: (p: Partial<Settings>) => Promise<void>;
  storedLanguage: string;
  onStoredLanguageChange: (value: string) => void;
  onReload: () => Promise<void>;
};

function Page({
  settings, patch, storedLanguage, onStoredLanguageChange, onReload,
}: PageProps) {
  const t = useT();
  const [tab, setTab] = useState<OptionsTab>(() => tabFromHash(location.hash));

  // The browser tab carries the page title: translated like the rest, rather
  // than frozen in French in index.html.
  useEffect(() => { document.title = t('options.title'); }, [t]);

  // The URL is the source of truth, not this state: it can change without a tab
  // click. A second openOptions(...) on an ALREADY open settings tab does not
  // reload the page, it only replaces the hash — without this listener, a panel
  // error would open the settings and change nothing on screen.
  useEffect(() => {
    const onHashChange = () => setTab(tabFromHash(location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const ready = configuredProviders(settings).length > 0;

  /** After a key validates: store it, then resume a pending summary if there is one. */
  const onKeyValidated = async (targetProvider: ProviderId, key: string) => {
    // storeKeyPatch decides whether the SELECTION moves with the key: this page
    // no longer picks the provider, but it does repair a selection that has no
    // key — which is also what makes the resume below land on a usable one.
    await patch(storeKeyPatch(settings, targetProvider, key));
    await resumePendingSummaryIfAny();
  };

  const selectTab = (next: OptionsTab, moveFocus = false) => {
    setTab(next);
    // Focus FOLLOWS the selection when it comes from the keyboard, never from a
    // click — the clicked button already has focus.
    if (moveFocus) document.getElementById(`tab-${next}`)?.focus();
    // Replaces the history entry rather than stacking one per visited tab: the
    // browser's back button must return where the user came from, not walk them
    // back through four tabs of the same page.
    history.replaceState(null, '', hashForTab(next));
  };

  /** Arrows, Home and End in the tab bar — the second half of the ARIA tabs pattern. */
  const onTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const current = OPTIONS_TABS.indexOf(tab);
    const last = OPTIONS_TABS.length - 1;
    // Wrapping: the first tab follows the last, as anyone who has used a tab bar
    // from the keyboard expects.
    const next =
      e.key === 'ArrowRight' ? OPTIONS_TABS[(current + 1) % OPTIONS_TABS.length]
      : e.key === 'ArrowLeft' ? OPTIONS_TABS[(current + last) % OPTIONS_TABS.length]
      : e.key === 'Home' ? OPTIONS_TABS[0]
      : e.key === 'End' ? OPTIONS_TABS[last]
      : undefined;

    if (next === undefined) return;
    e.preventDefault();
    selectTab(next, true);
  };

  return (
    <main style={pageStyle}>
      {/*
        alt="" on the icon, and no title either: the name is written in text
        right beside it, and an alternative would read it twice.

        128.png for a 40px render — a source under 1.5× the display size is soft
        on a Retina screen.

        "Skim" is a literal, not a catalogue key: a product name does not
        translate, exactly like the manifest strings.
      */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <img src="/icon/128.png" alt="" width={40} height={40} style={{ display: 'block', flex: 'none' }} />
          {/* minWidth: 0 lets the tagline wrap instead of pushing the badge out
             of the row on a narrow window. */}
          <div style={{ minWidth: 0 }}>
            <h1 style={brandNameStyle}>Skim</h1>
            <p style={taglineStyle}>{t('options.tagline')}</p>
          </div>
        </div>
        <StatusBadge ready={ready} />
      </div>

      {/* The full ARIA tabs pattern or nothing: a bar that DECLARES itself a
         tablist without arrow keys and a roving tabindex is worse than a plain
         list of buttons — the screen reader announces a widget whose promised
         gestures do not answer. */}
      <div
        role="tablist"
        aria-label={t('options.tabs.aria')}
        onKeyDown={onTabKeyDown}
        style={{ display: 'flex', gap: 2, marginTop: 18, borderBottom: '1px solid var(--border)' }}
      >
        {OPTIONS_TABS.map((id) => {
          const active = id === tab;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={active}
              aria-controls={`panel-${id}`}
              // Roving tabindex: one Tab enters the bar, the arrows move within
              // it — half of what the role promises.
              tabIndex={active ? 0 : -1}
              onClick={() => selectTab(id)}
              style={{
                padding: '8px 12px',
                border: 0,
                background: 'transparent',
                cursor: 'pointer',
                font: `${active ? 600 : 500} 13px system-ui`,
                color: active ? 'var(--strong)' : 'var(--muted)',
                borderBottom: `2px solid ${active ? 'var(--tab-active)' : 'transparent'}`,
                // Offsets the bar's rule: the active tab's underline must COVER
                // it, not sit on top of it.
                marginBottom: -1,
              }}
            >
              {t(TAB_LABELS[id])}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        style={{ paddingTop: 20 }}
      >
        {tab === 'providers' && (
          <ProvidersTab settings={settings} patch={patch} onKeyValidated={onKeyValidated} />
        )}
        {tab === 'profiles' && <ProfilesTab settings={settings} patch={patch} />}
        {tab === 'languages' && (
          <LanguagesTab
            settings={settings}
            patch={patch}
            storedLanguage={storedLanguage}
            onStoredLanguageChange={onStoredLanguageChange}
          />
        )}
        {tab === 'data' && <DataTab onReload={onReload} />}
      </div>

      {/*
        Discreet on purpose. A release shows the version, the one fact a user
        can quote in a bug report; a dev build shows the provenance that answers
        "which build is running?" without the service worker console. Both stay
        invisible to whoever is not looking for them.
      */}
      <footer
        style={{
          marginTop: 32, paddingTop: 12, borderTop: '1px solid var(--border)',
          color: 'var(--muted)', fontSize: 11, fontFamily: 'ui-monospace, monospace',
        }}
      >
        {BUILD_FOOTER}
      </footer>
    </main>
  );
}

/**
 * The ready / needs-setup badge, top right.
 *
 * The page's only indicator that answers "does this work?" without reading
 * anything. Its criterion is at least ONE stored key: this page no longer names
 * an active provider — the panel picks one, among those with a key — so
 * qualifying a single provider here would answer a question the page no longer
 * asks. Never a network check, which would spend a request on every page open.
 *
 * "Ready" wears the brand pill; "needs setup" keeps the amber, because it is a
 * warning and the two must not read as the same statement in two colours.
 */
function StatusBadge({ ready }: { ready: boolean }) {
  const t = useT();
  return (
    <span
      title={t(ready ? 'options.badge.ready.title' : 'options.badge.setup.title')}
      // marginTop: 4 optically centres the badge against the name, now that the
      // row aligns on flex-start for a left group two lines tall.
      style={ready ? { ...BRAND_PILL, marginTop: 4 } : {
        ...BRAND_PILL,
        marginTop: 4,
        background: 'var(--warn-bg)',
        border: '1px solid var(--warn-border)',
        color: 'var(--warn-fg)',
      }}
    >
      {t(ready ? 'options.badge.ready' : 'options.badge.setup')}
    </span>
  );
}
