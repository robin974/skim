// The one-off line under a first summary written in the English fallback: the
// summary language is a setting, and here is where it lives.
//
// Whether it shows at all is shouldShowLanguageHint's decision
// (lib/language-hint.ts); this file only renders it.
//
// In the provenance family, under .summary-footer — not a banner, not a coloured
// box, no icon. It states a fact about the text just above it, at the one moment
// that fact is provable.
import { useT } from '@/lib/i18n-react';
import { openOptions } from '@/lib/open-options';

type Props = {
  /**
   * Writes summaryLanguageHintDismissed. The ✕ is the ONLY thing that hides the
   * hint for good: a user who opens the Languages tab and changes nothing has
   * not been served, so the link leaves the flag alone.
   */
  onDismiss: () => void;
};

export function LanguageHint({ onDismiss }: Props) {
  const t = useT();
  return (
    <div className="summary-language-hint">
      <p>
        {t('panel.languageHint.text')}{' '}
        <button type="button" className="language-hint-link" onClick={() => openOptions('languages')}>
          {t('panel.languageHint.action')}
        </button>
      </p>
      <button
        type="button"
        className="language-hint-dismiss"
        onClick={onDismiss}
        aria-label={t('panel.languageHint.dismissAria')}
      >
        ✕
      </button>
    </div>
  );
}
