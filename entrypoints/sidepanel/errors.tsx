// Rendering of a panel error, shared by the summary (App.tsx) and follow-up
// answers (Conversation.tsx), in its own module so neither has to depend on the
// other.
//
// This file DECIDES nothing: the copy lives in the message catalogue
// (lib/i18n.ts) and the button choice in lib/panel-errors.ts, both outside the
// JSX so they stay translatable and testable. What remains here is the rendering
// and the wiring of gestures — plus the panel's only input field (see
// PanelKeyField at the bottom).
import { useState } from 'react';
import type { ErrorCode } from '@/lib/messages';
import type { ProviderId } from '@/lib/llm/types';
import type { Settings } from '@/lib/settings';
import { alternateProvider } from '@/lib/settings';
import { getProvider } from '@/lib/llm';
import { ERROR_PLANS, resolvePanelErrorActions } from '@/lib/panel-errors';
import { validateKey } from '@/lib/validate-key';
import { openOptions } from '@/lib/open-options';
import { useT } from '@/lib/i18n-react';

type Props = {
  code: ErrorCode;
  /** The summary, or a follow-up answer: see PanelErrorContext (lib/panel-errors.ts). */
  target: 'summary' | 'answer';
  settings: Settings;
  /** Absent = no video to restart, so no retry button. */
  onRetry?: () => void;
  onSwitchProvider?: (provider: ProviderId) => void;
  /** Called with an ALREADY VALIDATED key (see PanelKeyField): storing it and retrying is the caller's job. */
  onKeyFixed?: (key: string) => void;
};

export function ErrorBox({ code, target, settings, onRetry, onSwitchProvider, onKeyFixed }: Props) {
  const t = useT();
  const plan = ERROR_PLANS[code];
  const providerLabel = getProvider(settings.provider).label;

  const actions = resolvePanelErrorActions(code, {
    target,
    canRetry: onRetry !== undefined,
    alternate: onSwitchProvider === undefined ? null : alternateProvider(settings),
  });

  return (
    <div className="error-box">
      <p className="error-message">{t(plan.message, { provider: providerLabel })}</p>

      {/* The repair field comes BEFORE the buttons: when it is there, it is the
         expected gesture, and opening the settings is only the fallback. */}
      {actions.some((a) => a.kind === 'fix-key') && onKeyFixed && (
        <PanelKeyField settings={settings} onKeyFixed={onKeyFixed} />
      )}

      {plan.detail && <p className="error-detail">{t(plan.detail)}</p>}

      {actions.length > 0 && (
        <div className="error-actions">
          {actions.map((action) => {
            if (action.kind === 'retry') {
              return (
                <button key="retry" type="button" onClick={onRetry}>
                  {t('error.action.retry')}
                </button>
              );
            }
            if (action.kind === 'switch-provider') {
              return (
                <button
                  key="switch"
                  type="button"
                  onClick={() => onSwitchProvider?.(action.provider)}
                >
                  {t('error.action.switchProvider', { provider: getProvider(action.provider).label })}
                </button>
              );
            }
            if (action.kind === 'open-settings') {
              return (
                <button key="settings" type="button" onClick={() => openOptions(action.tab)}>
                  {t('error.action.openSettings')}
                </button>
              );
            }
            // 'fix-key' is rendered above, not as a button.
            return null;
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The panel's key paste field — a reduced ApiKeyField: checked on paste, no
 * button to press, never prefilled with the existing key.
 *
 * Reduced deliberately: no "get a key" link, no provider choice, no reveal
 * toggle. This field exists for ONE case — the active provider's key was just
 * refused while a summary was expected — and everything beyond it stays the
 * options page's job, one click away.
 */
function PanelKeyField({ settings, onKeyFixed }: { settings: Settings; onKeyFixed: (key: string) => void }) {
  const t = useT();
  const [state, setState] = useState<'idle' | 'checking' | 'invalid'>('idle');
  const [message, setMessage] = useState('');
  const provider = getProvider(settings.provider);

  const handlePaste = async (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text');
    setState('checking');
    setMessage('');
    // Same safety net as the options page: validateKey is designed always to
    // resolve, and this try/catch guarantees that a breach of that contract does
    // not leave the field stuck on "checking…".
    try {
      const result = await validateKey(provider, {
        apiKey: pasted,
        baseUrl: settings.provider === 'custom' ? settings.customBaseUrl : undefined,
      });
      if (result.status === 'valid') {
        // No 'valid' state shown here, unlike the options page: the summary
        // restarts immediately and replaces the whole error box, so a success
        // message visible for a fraction of a second would be noise.
        onKeyFixed(pasted.trim());
        return;
      }
      setState('invalid');
      setMessage(t(result.messageKey, result.params));
    } catch (e) {
      setState('invalid');
      setMessage(t('validate.crashed'));
      console.error(e);
    }
  };

  return (
    <div className="error-key">
      <input
        type="password"
        className="error-key-input"
        autoComplete="off"
        placeholder={t('error.invalid-key.placeholder')}
        aria-label={t('error.invalid-key.placeholder')}
        onPaste={(e) => { handlePaste(e).catch(console.error); }}
        disabled={state === 'checking'}
      />
      {state === 'checking' && <p className="error-detail">{t('providers.key.checking')}</p>}
      {state === 'invalid' && <p className="error-detail">{message}</p>}
    </div>
  );
}
