// The panel header: what the NEXT summary will use — provider, model, reasoning
// effort, summary profile — plus a shortcut to the options page.
//
// Never to be confused with SummaryFooter.tsx, which shows what PRODUCED the
// summary already displayed below. The two coexist and can legitimately diverge:
// a displayed summary keeps ITS original provenance after a model or effort
// change here (see `meta`, lib/panel-reducer.ts).
//
// Discreet chrome, not content: compact row, muted text, no saturated colour —
// the same visual vocabulary as SummaryFooter.
//
// Every change here writes the GLOBAL setting, the same one the options page
// edits, never a panel-local preference that would make two tiers diverge. It
// applies to the NEXT summary: settings live in chrome.storage.local, the
// conversations they will produce in chrome.storage.session.
//
// The API key is neither displayed nor entered here: `apiKey` only builds the
// model list request. The panel's one key field lives in errors.tsx, for the
// `invalid-key` error alone.
import { useEffect, useRef, useState } from 'react';
import {
  modelPatch, activeModel, activeKey, effortPatch, resolveEffort, checkedEffort,
  activeProfile, allProfiles, profilePatch, configuredProviders,
} from '@/lib/settings';
import type { Profile, Settings } from '@/lib/settings';
import { getProvider } from '@/lib/llm';
import { listModels } from '@/lib/llm/list-models';
import { effortsOf, effortChoices, describeNoEffort } from '@/lib/llm/effort';
import type { EffortLevel, EffortSupport, ModelOption, ProviderId } from '@/lib/llm/types';
import { effortLabelKey } from '@/lib/i18n';
import { useT } from '@/lib/i18n-react';
import { openOptions } from '@/lib/open-options';
import { useCloseOnOutsideClick } from './useCloseOnOutsideClick';

type Props = {
  settings: Settings;
  patch: (p: Partial<Settings>) => Promise<void>;
  /** Is a key stored for the active provider? See hasActiveKey (errors.tsx). */
  configured: boolean;
};

export function PanelHeader({ settings, patch, configured }: Props) {
  const t = useT();
  const provider = getProvider(settings.provider);
  const model = activeModel(settings);
  const support = effortsOf(provider, model);
  const applied = resolveEffort(settings);
  const profiles = allProfiles(settings, t);
  const profile = activeProfile(settings, t);
  // Closing a <details> is a DOM gesture, not a React one: the element owns its
  // `open` attribute, and driving it from state would fight the native toggle
  // the user already has. Two refs, two popovers that can close themselves —
  // through their own controls, and through a click anywhere else.
  const modelSwitcher = useRef<HTMLDetailsElement>(null);
  const profileSwitcher = useRef<HTMLDetailsElement>(null);
  useCloseOnOutsideClick(modelSwitcher);
  useCloseOnOutsideClick(profileSwitcher);

  return (
    <div className="panel-header">
      <div className="panel-header-row">
        {/* With no key the model picker has nothing to offer: its list loads
           WITH the key (see ModelChooser, 'locked' state). Stating that no
           account is configured says the same thing in one line and leaves the
           invitation to the onboarding screen below. */}
        {configured ? (
          <>
            {/* Both disclosures share a `name`, so opening one closes the other
               — the native exclusive-accordion group. They have to be exclusive:
               their popovers are anchored to the header (see .model-popover,
               style.css) and would otherwise land on top of each other. */}
            <details className="model-switcher" name="panel-header" ref={modelSwitcher}>
              {/* Native <details>/<summary> disclosure: keyboard and screen reader
                 support for free, where a hand-rolled popover would reimplement
                 the same thing. Model and effort share this one popover: they form
                 a single identity, not two controls to keep visually in sync —
                 which is also why the effort line sits INSIDE this <summary>,
                 where clicking it opens the popover that holds its chips. */}
              <summary className="model-summary" title={t('panel.header.switcherTitle')}>
                <span className="model-identity">
                  <span className="model-provider">{provider.label}</span>
                  <span className="model-name">{model}</span>
                </span>
                {/* Absent when nothing is sent: showing "default" would be noise.
                   The bare level read as an unrelated word in review — the field's
                   own name is what makes it legible. */}
                {applied !== undefined && (
                  <span className="model-effort">
                    {t('panel.header.effortLine', {
                      label: t('providers.field.effort'),
                      level: t(effortLabelKey(applied)),
                    })}
                  </span>
                )}
              </summary>
              <div className="model-popover">
                {/* Provider FIRST: it commands the two below it — a model list
                   is one account's, and the effort scale is that model's. */}
                <ProviderField
                  providers={configuredProviders(settings)}
                  value={settings.provider}
                  onChange={(id) => patch({ provider: id })}
                />
                <ModelChooser
                  key={settings.provider}
                  provider={provider}
                  apiKey={activeKey(settings)}
                  baseUrl={settings.provider === 'custom' ? settings.customBaseUrl : undefined}
                  value={settings.models[settings.provider] ?? ''}
                  onChange={(m) => patch(modelPatch(settings, m))}
                />
                <EffortField
                  support={support}
                  value={checkedEffort(settings)}
                  onChange={(level) => patch(effortPatch(settings, level))}
                />
                {/* Three settings are set here, often several in a row, so
                   picking one does NOT close this popover — unlike the profile's
                   below, which holds one. What closes it is this button, or a
                   click on the summary that opened it. */}
                <div className="popover-close-row">
                  <button
                    type="button"
                    className="popover-close"
                    onClick={() => { if (modelSwitcher.current) modelSwitcher.current.open = false; }}
                  >
                    {t('panel.header.closePopover')}
                  </button>
                </div>
              </div>
            </details>

            <span className="header-separator" aria-hidden="true">|</span>

            {/* A SECOND <details>, sibling of the model's: the two are
               independent settings, and nesting the profile inside the model
               popover would make one look like a property of the other. */}
            <details className="profile-switcher" name="panel-header" ref={profileSwitcher}>
              <summary className="profile-summary" title={t('panel.header.profileSwitcherTitle')}>
                <span className="profile-name">{profile.name}</span>
              </summary>
              <div className="profile-popover">
                <ProfileField
                  profiles={profiles}
                  value={profile.id}
                  onChange={(id) => {
                    patch(profilePatch(id)).catch(console.error);
                    // Picking a profile is the only thing to do in here: a
                    // second click just to close would be one click too many.
                    if (profileSwitcher.current) profileSwitcher.current.open = false;
                  }}
                />
              </div>
            </details>
          </>
        ) : (
          <span className="panel-header-status">{t('panel.header.notConnected')}</span>
        )}
        <button
          type="button"
          className="settings-shortcut"
          onClick={() => openOptions()}
          aria-label={t('panel.header.settingsAria')}
          title={t('panel.header.settings')}
        >
          ⚙
        </button>
      </div>
    </div>
  );
}

/**
 * The providers to choose from: those with a stored key, and no other. The panel
 * SELECTS, it does not configure — offering a provider with no key would offer
 * an error, and the way to add one is the last chip, which leaves for the
 * settings.
 *
 * Switching writes `provider` and nothing else: the model and the effort of the
 * provider being adopted are already stored under its own name (`models[id]`,
 * `efforts['id/model']`), so they come back as they were left rather than being
 * reset by the switch.
 */
function ProviderField({
  providers, value, onChange,
}: {
  providers: ProviderId[];
  value: ProviderId;
  onChange: (id: ProviderId) => void;
}) {
  const t = useT();
  return (
    <fieldset className="provider-field">
      <legend className="profile-legend">{t('panel.header.providerLabel')}</legend>
      <div className="profile-chips">
        {providers.map((id) => (
          <label key={id} className="profile-chip">
            <input
              type="radio"
              name="panel-provider"
              value={id}
              checked={id === value}
              onChange={() => onChange(id)}
            />
            <span>{getProvider(id).label}</span>
          </label>
        ))}
        {/* A <button> among the radios, never a radio itself: it selects
           nothing, it leaves for the page where keys are stored. */}
        <button type="button" className="profile-manage" onClick={() => openOptions('providers')}>
          {t('panel.header.addProvider')}
        </button>
      </div>
    </fieldset>
  );
}

/**
 * Profiles as chips, built exactly like EffortField's below and for the same
 * reason: native radios bring arrow-key navigation and screen reader semantics
 * for free, and let the list wrap in a narrow panel.
 *
 * Picking one changes NOTHING on screen: the displayed summary and its
 * provenance are untouched, exactly as for a model change. It applies to the
 * next summary.
 */
function ProfileField({
  profiles, value, onChange,
}: {
  profiles: Profile[];
  value: string;
  onChange: (id: string) => void;
}) {
  const t = useT();
  return (
    <fieldset className="profile-field">
      <legend className="profile-legend">{t('panel.header.profileLabel')}</legend>
      <div className="profile-chips">
        {profiles.map((profile) => (
          <label key={profile.id} className="profile-chip">
            <input
              type="radio"
              name="panel-profile"
              value={profile.id}
              checked={profile.id === value}
              onChange={() => onChange(profile.id)}
            />
            <span>{profile.name}</span>
          </label>
        ))}
        {/* A <button> among the radios, never a radio itself: it selects
           nothing, it leaves for the page where profiles are written. */}
        <button type="button" className="profile-manage" onClick={() => openOptions('profiles')}>
          {t('panel.header.manageProfiles')}
        </button>
      </div>
    </fieldset>
  );
}

/**
 * Levels as `<input type="radio">` styled as chips, never `<button>` with
 * role="radiogroup": native radios bring arrow-key navigation and screen reader
 * semantics for free — the same argument that chose <details>/<summary> above.
 * It is also what lets the list wrap when it reaches eight entries in a narrow
 * panel.
 */
function EffortField({
  support, value, onChange,
}: {
  support: EffortSupport;
  value: EffortLevel;
  onChange: (level: EffortLevel) => void;
}) {
  const t = useT();
  const choices = effortChoices(support);

  if (choices.length === 0) {
    return (
      <p className="effort-none">
        <span className="effort-legend">{t('providers.field.effort')}</span> {describeNoEffort(support, t)}
      </p>
    );
  }

  return (
    <fieldset className="effort-field">
      <legend className="effort-legend">{t('providers.field.effort')}</legend>
      <div className="effort-chips">
        {choices.map((level) => (
          <label key={level} className="effort-chip">
            <input
              type="radio"
              name="panel-effort"
              value={level}
              checked={level === value}
              onChange={() => onChange(level)}
            />
            <span>{t(effortLabelKey(level))}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Compact version of ModelField (entrypoints/options/ProvidersTab.tsx): same data
 * path (listModels, so the provider's modelCatalog or a fallback to manual
 * entry), reduced presentation to fit a narrow panel's popover.
 *
 * Deliberately simpler than the original — no "back to list" button, no detailed
 * error message. That nuance stays the options page's job, one click away
 * through the header shortcut.
 */
function ModelChooser({
  provider, apiKey, baseUrl, value, onChange,
}: {
  provider: ReturnType<typeof getProvider>;
  apiKey: string;
  baseUrl: string | undefined;
  value: string;
  onChange: (model: string) => void;
}) {
  const t = useT();
  const [state, setState] = useState<'locked' | 'loading' | 'list' | 'manual'>(apiKey ? 'loading' : 'locked');
  const [models, setModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    if (!apiKey) {
      setState('locked');
      return;
    }
    // Same guard as options/ProvidersTab.tsx: the popover can close and reopen
    // on another provider while the request is in flight.
    let cancelled = false;
    setState('loading');
    (async () => {
      try {
        const result = await listModels(provider, { apiKey, baseUrl });
        if (cancelled) return;
        if (result.status === 'ok') {
          setModels(result.models);
          setState('list');
        } else {
          setModels([]);
          setState('manual');
        }
      } catch (e) {
        if (cancelled) return;
        setModels([]);
        setState('manual');
        console.error(e);
      }
    })();
    return () => { cancelled = true; };
  }, [provider, apiKey, baseUrl]);

  const defaultLabel = provider.defaultModel
    ? t('model.default', { model: provider.defaultModel })
    : t('model.defaultUnknown');

  if (state === 'locked') {
    return (
      <p className="model-popover-hint">
        {t('panel.model.locked', { provider: provider.label })}{' '}
        <button type="button" className="model-popover-link" onClick={() => openOptions('providers')}>
          {t('error.action.openSettings')}
        </button>
      </p>
    );
  }

  if (state === 'loading') {
    return <p className="model-popover-hint">{t('model.loading')}</p>;
  }

  if (state === 'manual') {
    return (
      <input
        type="text"
        className="model-manual-input"
        value={value}
        placeholder={provider.defaultModel || t('model.placeholder')}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t('model.ariaManual')}
      />
    );
  }

  // Same guard as options/ProvidersTab.tsx: a stored model absent from the list
  // stays selected and visible rather than silently falling back to the first
  // entry.
  const isOrphan = value !== '' && !models.some((m) => m.id === value);

  return (
    <select
      className="model-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={t('model.aria')}
    >
      <option value="">{defaultLabel}</option>
      {isOrphan && <option value={value}>{t('model.orphanShort', { model: value })}</option>}
      {models.map((m) => (
        <option key={m.id} value={m.id}>{m.label}</option>
      ))}
    </select>
  );
}
