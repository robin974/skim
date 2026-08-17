// The providers tab: an assistant, always — pick a provider, store its key.
//
// It configures KEYS and nothing else. Model and reasoning effort belong to the
// panel header now, next to the summary they produce, and with them went the
// notion of an ACTIVE provider: a stored key makes a provider selectable in the
// panel, and the panel picks the one the next summary uses.
//
// Two screens rather than a page of forms. Everything used to be visible at
// once — a card of three fields plus five "add a key" rows — which is a lot to
// read and says nothing about where to start, on the first screen a new user
// ever sees.
//
// The decisions live in lib/provider-setup.ts (list order, step bar, key-step
// copy); what is here is the styling and the wiring.
import { useState, type CSSProperties } from 'react';
import { maskApiKey, removeKeyPatch } from '@/lib/settings';
import type { Settings } from '@/lib/settings';
import { getProvider } from '@/lib/llm';
import type { ProviderId } from '@/lib/llm/types';
import {
  OAUTH_PROVIDER, SETUP_STEPS, SETUP_STEP_LABELS, canGoBackTo, keyStepCopy, setupRows, stepStatus,
  type SetupScreen, type SetupStep, type StepStatus,
} from '@/lib/provider-setup';
import { validateKey } from '@/lib/validate-key';
import { useT } from '@/lib/i18n-react';
import { connectOpenRouter, type OAuthResult } from './openrouter-connect';
import {
  BRAND_PILL, EyeIcon, buttonClass, dangerButtonClass, dangerOnErrorButtonClass, primaryButtonClass,
} from './ui';

/**
 * Where to get a key, per provider. Shown while no key is stored: this is the
 * step that blocks new BYOK users most, and an environment variable name tells
 * nobody where to click.
 */
const KEY_URLS: Partial<Record<ProviderId, string>> = {
  openrouter: 'https://openrouter.ai/keys',
  openai: 'https://platform.openai.com/api-keys',
  deepseek: 'https://platform.deepseek.com/api_keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  gemini: 'https://aistudio.google.com/app/apikey',
  'opencode-go': 'https://opencode.ai/auth',
};

type Props = {
  settings: Settings;
  patch: (p: Partial<Settings>) => Promise<void>;
  /** Stores a validated key, then resumes a pending summary (see resume.ts). */
  onKeyValidated: (provider: ProviderId, key: string) => Promise<void>;
};

/** Column width of the step that carries text rather than a list. */
const columnStyle: CSSProperties = { maxWidth: 520 };

const titleStyle: CSSProperties = { font: '600 16px system-ui', margin: '0 0 4px', color: 'var(--strong)' };

const subtitleStyle: CSSProperties = {
  color: 'var(--muted)', fontSize: 13, margin: '0 0 16px', textWrap: 'pretty',
};

export function ProvidersTab({ settings, patch, onKeyValidated }: Props) {
  // Local, never persisted: reopening the settings starts on the list, which is
  // the screen that says what can be done. The URL hash keeps designating the
  // TAB (lib/options-tabs.ts) and nothing finer — the assistant adds no history
  // entry.
  const [screen, setScreen] = useState<SetupScreen>({ kind: 'list' });

  const backToList = () => setScreen({ kind: 'list' });

  return (
    <div>
      <StepBar screen={screen} onBack={backToList} />

      {/* One JSX position per screen, so React really unmounts the previous one:
         that is what replays the entry animation on arrival, and only on
         arrival — typing in the key field re-renders without remounting. */}
      {screen.kind === 'list' && (
        <ProviderList settings={settings} onPick={(provider) => setScreen({ kind: 'key', provider })} />
      )}

      {screen.kind === 'key' && (
        <KeyStep
          key={screen.provider}
          settings={settings}
          provider={screen.provider}
          patch={patch}
          onKeyValidated={onKeyValidated}
          onBack={backToList}
          onStored={() => setScreen({ kind: 'done', provider: screen.provider })}
        />
      )}

      {screen.kind === 'done' && <DoneScreen provider={screen.provider} onBack={backToList} />}
    </div>
  );
}

/**
 * The two steps in one pill. Not a progress bar: it says where the assistant
 * stands, in two words the user has already read as titles — and the step
 * already taken is a way back to it (see canGoBackTo).
 */
function StepBar({ screen, onBack }: { screen: SetupScreen; onBack: () => void }) {
  return (
    <div
      style={{
        display: 'inline-flex', padding: 3, gap: 3, marginBottom: 18,
        border: '1px solid var(--border)', borderRadius: 999, background: 'var(--surface)',
      }}
    >
      {SETUP_STEPS.map((step, i) => (
        <Step
          key={step}
          step={step}
          index={i + 1}
          status={stepStatus(step, screen)}
          onBack={canGoBackTo(step, screen) ? onBack : undefined}
        />
      ))}
    </div>
  );
}

/**
 * A step: a plain `<span>`, or the `<button>` that returns to the list when this
 * one is behind. Same shape either way — what changes is the cursor and the
 * underline on hover (.setup-step-back, style.css), never the pill.
 */
function Step({
  step, index, status, onBack,
}: {
  step: SetupStep;
  index: number;
  status: StepStatus;
  onBack?: () => void;
}) {
  const t = useT();
  const current = status === 'current';
  const style: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999,
    background: current ? 'var(--bg)' : status === 'done' ? 'var(--ok-bg)' : 'transparent',
    font: `${current ? 600 : 500} 12.5px system-ui`,
    color: current ? 'var(--strong)' : status === 'done' ? 'var(--label)' : 'var(--muted)',
  };
  const content = (
    <>
      <span style={{ font: '600 11px ui-monospace, monospace', opacity: 0.7 }}>{index}</span>
      {t(SETUP_STEP_LABELS[step])}
    </>
  );

  if (!onBack) return <span style={style}>{content}</span>;

  return (
    <button
      type="button"
      className="setup-step-back"
      onClick={onBack}
      title={t('setup.choose.title')}
      style={{ ...style, border: 0, cursor: 'pointer' }}
    >
      {content}
    </button>
  );
}

/**
 * Step 1. One row per provider: its name, the state of its key, and what
 * clicking will do.
 *
 * No logo, no description, no "recommended" badge and no selection circle: the
 * row selects nothing — it opens the key step. The name and the key's state are
 * what the choice actually rests on.
 */
function ProviderList({ settings, onPick }: { settings: Settings; onPick: (id: ProviderId) => void }) {
  const t = useT();

  return (
    <div className="setup-step">
      <h2 style={titleStyle}>{t('setup.choose.title')}</h2>
      <p style={{ ...subtitleStyle, maxWidth: '56ch' }}>{t('setup.choose.subtitle')}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {setupRows(settings).map(({ id, hasKey }) => (
          // The row draws itself in style.css, not here: it needs a :hover, and
          // an inline background would beat it (see .setup-row).
          <button key={id} type="button" className="setup-row" onClick={() => onPick(id)}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', font: '600 14px system-ui', color: 'var(--strong)' }}>
                {getProvider(id).label}
              </span>
              <span
                style={{ display: 'block', fontSize: 12, color: hasKey ? 'var(--ok-fg)' : 'var(--muted)' }}
              >
                {t(hasKey ? 'providers.key.stored' : 'providers.key.none')}
              </span>
            </span>
            {hasKey && <span style={BRAND_PILL}>{t('options.badge.ready')}</span>}
            <span style={{ flex: 'none', font: '600 12.5px system-ui', color: 'var(--link)' }}>
              {t(hasKey ? 'setup.row.replace' : 'setup.row.configure')}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Step 2. Either the stored key — masked, with the means to reveal, replace or
 * delete it — or the field that writes a new one.
 *
 * Showing the key in clear is a choice, not an oversight: it already sits in
 * chrome.storage.local, readable by anyone who opens the extension's console.
 * What revealing adds is not exfiltration but the shoulder surfer — hence
 * masking BY DEFAULT, and a reveal that takes an explicit gesture every time
 * (the state is never remembered, here or between two visits).
 */
function KeyStep({
  settings, provider, patch, onKeyValidated, onBack, onStored,
}: {
  settings: Settings;
  provider: ProviderId;
  patch: (p: Partial<Settings>) => Promise<void>;
  onKeyValidated: (provider: ProviderId, key: string) => Promise<void>;
  onBack: () => void;
  onStored: () => void;
}) {
  const t = useT();
  const [replacing, setReplacing] = useState(false);
  const storedKey = settings.apiKeys[provider] ?? '';
  const label = getProvider(provider).label;
  const showStored = storedKey !== '' && !replacing;
  const { titleKey, subtitleKey } = keyStepCopy({ provider, stored: showStored });

  return (
    <div className="setup-step" style={columnStyle}>
      <button
        type="button"
        onClick={onBack}
        style={{
          border: 0, background: 'transparent', padding: 0, margin: '0 0 10px',
          color: 'var(--link)', cursor: 'pointer', font: '500 12.5px system-ui',
        }}
      >
        {t('setup.back')}
      </button>

      <h2 style={titleStyle}>{t(titleKey, { provider: label })}</h2>
      <p style={subtitleStyle}>{t(subtitleKey, { provider: label })}</p>

      {showStored ? (
        <StoredKey
          providerLabel={label}
          storedKey={storedKey}
          onReplace={() => setReplacing(true)}
          onDelete={() => {
            patch(removeKeyPatch(settings, provider)).catch(console.error);
            onBack();
          }}
        />
      ) : (
        <NewKey
          provider={provider}
          onKeyValidated={onKeyValidated}
          onStored={() => { setReplacing(false); onStored(); }}
        />
      )}
    </div>
  );
}

/** The stored key: masked, revealable, replaceable, deletable. */
function StoredKey({
  providerLabel, storedKey, onReplace, onDelete,
}: {
  providerLabel: string;
  storedKey: string;
  onReplace: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [revealed, setRevealed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <div>
      {/*
        This row is meant to stay on one line, and does at the designed width.
        But the options page opens in an ordinary tab, which can be narrowed: at
        300 px, two buttons that refuse to shrink crushed the field until the key
        ran one character per line. The right fallback is not to break the key
        but to let the buttons wrap below — hence `wrap` here, and a 220 px basis
        on the field that keeps everything on one line whenever there is room.
      */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div
          style={{
            flex: '1 1 220px', minWidth: 0, display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 8px 6px 10px', border: '1px solid var(--border)', borderRadius: 6,
            background: 'var(--field-bg)',
          }}
        >
          {/*
            Revealed, the key WRAPS; masked, it stays on one line with an
            ellipsis. That is the only formatting that keeps the button's
            promise: an ellipsised key can be neither read nor copied, so "show
            the key" would have shown only its beginning.

            The break happens anywhere (`break-all`) because a key has no natural
            hyphenation point — which also brings its min-content width down to
            one character, so it cannot push on the column that holds it.
          */}
          <code
            style={{
              flex: 1, minWidth: 0,
              color: 'var(--label)', fontSize: 12.5, fontFamily: 'ui-monospace, monospace',
              lineHeight: 1.5,
              ...(revealed
                ? { whiteSpace: 'normal' as const, wordBreak: 'break-all' as const }
                : { overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const }),
            }}
          >
            {revealed ? storedKey : maskApiKey(storedKey)}
          </code>
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            title={revealed ? t('providers.key.hide') : t('providers.key.show')}
            aria-label={revealed ? t('providers.key.hide') : t('providers.key.show')}
            style={{
              flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, padding: 0, border: 0, borderRadius: 5,
              background: 'transparent', color: 'var(--muted)', cursor: 'pointer',
            }}
          >
            <EyeIcon off={revealed} />
          </button>
        </div>
        <button
          type="button"
          className={buttonClass}
          style={{ flex: 'none' }}
          onClick={() => { setRevealed(false); onReplace(); }}
        >
          {t('providers.key.replace')}
        </button>
        <button
          type="button"
          className={dangerButtonClass}
          style={{ flex: 'none' }}
          title={t('providers.key.delete.title', { provider: providerLabel })}
          onClick={() => { setRevealed(false); setConfirming(true); }}
        >
          {t('providers.key.delete')}
        </button>
      </div>

      {/* INLINE confirmation rather than window.confirm: a browser modal blocks
         the whole document and is untranslatable. Two clicks are still two
         clicks — and the question names what deleting costs. */}
      {confirming && (
        <div
          style={{
            marginTop: 10, padding: '12px 14px', borderRadius: 8,
            border: '1px solid var(--error-border)', background: 'var(--error-bg)',
          }}
        >
          <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--error-fg)' }}>
            {t('providers.key.deleteConfirm', { provider: providerLabel })}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={onDelete}
              className={dangerOnErrorButtonClass}
              style={{ font: '600 12.5px system-ui' }}
            >
              {t('providers.key.deleteYes')}
            </button>
            <button type="button" className={buttonClass} onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Writing a key: the OpenRouter button when it applies, then the field and its
 * "Validate".
 *
 * The key leaves for the provider on a CLICK, not on paste as it once did.
 * Pasting is not the only way to fill a field — a password manager, a
 * keystroke, a correction — and a check firing on one gesture out of three left
 * the other two silently unverified.
 */
function NewKey({
  provider, onKeyValidated, onStored,
}: {
  provider: ProviderId;
  onKeyValidated: (provider: ProviderId, key: string) => Promise<void>;
  onStored: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState('');
  const [state, setState] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  const [message, setMessage] = useState('');
  const providerLabel = getProvider(provider).label;
  const keyUrl = KEY_URLS[provider];
  const pending = value.trim() === '' || state === 'checking';

  const submit = async () => {
    const key = value.trim();
    if (key === '') return;
    setState('checking');
    setMessage('');
    // Safety net: validateKey() carries its own try/catch and is meant always to
    // resolve. This one guarantees that an unexpected failure never leaves the
    // button stuck on "checking…".
    try {
      const result = await validateKey(getProvider(provider), { apiKey: key });
      if (result.status !== 'valid') {
        setState('invalid');
        setMessage(t(result.messageKey, result.params));
        return;
      }
      setState('valid');
      await onKeyValidated(provider, key);
      onStored();
    } catch (e) {
      setState('invalid');
      setMessage(t('validate.crashed'));
      console.error(e);
    }
  };

  return (
    <div>
      {provider === OAUTH_PROVIDER && (
        <>
          <OpenRouterConnectButton
            onConnected={async (key) => {
              await onKeyValidated(OAUTH_PROVIDER, key);
              onStored();
            }}
          />
          <p
            style={{
              margin: '0 0 10px', fontSize: 12, color: 'var(--muted)',
              textTransform: 'uppercase', letterSpacing: '.06em',
            }}
          >
            {t('setup.or')}
          </p>
        </>
      )}

      <input
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => { setValue(e.target.value); setState('idle'); setMessage(''); }}
        // Enter validates, as in any one-field form. Not a shortcut for the
        // button: the same gesture, from where the key was just typed.
        onKeyDown={(e) => { if (e.key === 'Enter' && !pending) submit().catch(console.error); }}
        placeholder={t('providers.key.placeholder', { provider: providerLabel })}
        aria-label={t('providers.key.placeholder', { provider: providerLabel })}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '10px 12px',
          border: '1px solid var(--border)', borderRadius: 8,
          background: 'var(--field-bg)', color: 'var(--fg)', font: 'inherit', fontSize: 13.5,
        }}
      />

      {/* Nothing at rest: an empty <p> holding a line's height would reserve
         room for a message that only exists once the key is on its way. */}
      {state !== 'idle' && (
        <p
          style={{
            margin: '8px 0 0', fontSize: 12.5,
            color: state === 'valid' ? 'var(--ok-fg)' : state === 'invalid' ? 'var(--error-fg)' : 'var(--muted)',
          }}
        >
          {state === 'checking' ? t('providers.key.checking')
            : state === 'valid' ? t('providers.key.valid')
            : message}
        </p>
      )}

      {keyUrl && (
        <p style={{ margin: '8px 0 0', fontSize: 12.5 }}>
          <a href={keyUrl} target="_blank" rel="noreferrer">
            {t('providers.key.get', { provider: providerLabel })}
          </a>
        </p>
      )}

      <div style={{ marginTop: 20 }}>
        {/* Really `disabled`, never a greyed button that answers nothing: an
           empty field has nothing to check. The state it draws is the class's
           own `:disabled`. */}
        <button
          type="button"
          disabled={pending}
          onClick={() => { submit().catch(console.error); }}
          className={primaryButtonClass}
        >
          {state === 'checking' ? t('providers.key.checking') : t('setup.key.submit')}
        </button>
      </div>
    </div>
  );
}

/**
 * The OpenRouter PKCE OAuth button. The only provider offered here: see
 * openrouter-connect.ts for why this is not a generic per-provider abstraction.
 */
function OpenRouterConnectButton({ onConnected }: { onConnected: (key: string) => Promise<void> }) {
  const t = useT();
  const [state, setState] = useState<'idle' | 'connecting' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleClick = async () => {
    setState('connecting');
    setMessage('');
    // Safety net: connectOpenRouter() is designed always to resolve to
    // { ok, … } and never throw, but if that contract broke, this try/catch
    // guarantees the button never stays stuck on "connecting…".
    let result: OAuthResult;
    try {
      result = await connectOpenRouter();
    } catch (e) {
      setState('error');
      setMessage(t('oauth.unexpected'));
      console.error(e);
      return;
    }
    if (result.ok) {
      await onConnected(result.key);
      return;
    }
    setState('error');
    setMessage(`${t(result.messageKey)} ${t('oauth.error.fallback')}`);
  };

  return (
    <div
      style={{
        marginBottom: 16, padding: '14px 16px', borderRadius: 10,
        border: '1px solid var(--card-border)', background: 'var(--card-bg)',
      }}
    >
      <button
        type="button"
        onClick={() => { handleClick().catch(console.error); }}
        disabled={state === 'connecting'}
        className={primaryButtonClass}
      >
        {state === 'connecting' ? t('oauth.connecting') : t('oauth.connect')}
      </button>
      <p style={{ margin: '8px 0 0', fontSize: 12.5, color: state === 'error' ? 'var(--error-fg)' : 'var(--muted)' }}>
        {state === 'error' ? message : t('oauth.oneClick')}
      </p>
    </div>
  );
}

/**
 * The success screen. One way out, back to the list: no "replace the key" here —
 * a key was just stored, and the screen that offers to replace it is one click
 * away.
 */
function DoneScreen({ provider, onBack }: { provider: ProviderId; onBack: () => void }) {
  const t = useT();
  const label = getProvider(provider).label;

  return (
    <div
      className="setup-step"
      style={{
        maxWidth: 560, padding: '16px 18px', borderRadius: 10,
        border: '1px solid var(--ok-border)', background: 'var(--ok-bg)',
      }}
    >
      <div style={{ font: '600 15px system-ui', color: 'var(--ok-fg)', marginBottom: 4 }}>
        {t('setup.done.title', { provider: label })}
      </div>
      <div style={{ fontSize: 13, color: 'var(--fg)' }}>{t('providers.key.stored')}</div>
      <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--fg)' }}>
        {t('setup.done.models', { provider: label })}
      </p>
      <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--fg)' }}>{t('setup.done.next')}</p>
      <div style={{ marginTop: 14 }}>
        <button type="button" className={buttonClass} onClick={onBack}>{t('setup.done.back')}</button>
      </div>
    </div>
  );
}
