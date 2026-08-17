// The data tab: what depends on NO provider — the resets. Key, model and effort
// live with their provider, on the providers tab.
//
// Summaries are not here, and no longer anywhere: they live in
// chrome.storage.session and are gone when the browser closes (see
// lib/conversations.ts). There is nothing left to keep, and therefore nothing
// left to clear.
//
// What remains is two irreversible gestures — hence the two-step confirmation
// and the red frame around the block.
import { useState } from 'react';
import { clearSetting, resetAllSettings } from '@/lib/settings';
import { useT } from '@/lib/i18n-react';
import { ConfirmButton, h2Style } from './ui';

type Props = {
  /** Full settings reload after a reset, decided by the parent that owns them. */
  onReload: () => Promise<void>;
};

export function DataTab({ onReload }: Props) {
  const t = useT();
  const [notice, setNotice] = useState('');

  return (
    <div>
      <div style={{ border: '1px solid var(--error-border)', borderRadius: 10, padding: '14px 16px' }}>
        <h2 style={h2Style}>{t('data.reset.title')}</h2>
        <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--muted)' }}>{t('data.reset.warning')}</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {/* clearSetting('apiKeys') removes the whole entry — every key at
             once, which is exactly the gesture asked for here, and exactly why it
             did NOT suit deleting a single key (see removeKeyPatch,
             lib/settings.ts). */}
          <ConfirmButton
            label={t('data.reset.keys')}
            question={t('data.reset.keysConfirm')}
            onConfirm={async () => {
              await clearSetting('apiKeys');
              await onReload();
              setNotice(t('data.reset.keysDone'));
            }}
          />
          <ConfirmButton
            label={t('data.reset.all')}
            question={t('data.reset.allConfirm')}
            onConfirm={async () => {
              await resetAllSettings();
              await onReload();
              setNotice(t('data.reset.allDone'));
            }}
          />
        </div>
        {notice !== '' && <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>{notice}</p>}
      </div>
    </div>
  );
}
