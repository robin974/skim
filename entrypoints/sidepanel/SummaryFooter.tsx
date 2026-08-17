// Discreet provenance of the displayed summary, under the summary itself: where
// it came from (subtitles or audio), when it was generated, which provider and
// model produced it — plus the control that regenerates THIS summary, replacing
// it. A reference line, not a banner.
//
// Neither the API key nor any setting reaches here: `meta` carries only what
// SummaryMeta (lib/messages.ts) exposes. None of those fields can hold a key —
// lib/orchestrator.ts builds it from `provider.label`/`activeModel(settings)`,
// never from `activeKey`.
import { describeSummaryProvenance } from '@/lib/summary-meta';
import type { SummaryMeta } from '@/lib/messages';
import { useT } from '@/lib/i18n-react';

type Props = {
  /** `null`: no known provenance for this summary (see hydrateFromConversation, lib/panel-reducer.ts) — only the button shows. */
  meta: SummaryMeta | null;
  onRegenerate: () => void;
  /** Mirrors canRegenerate() (lib/panel-reducer.ts): never actionable while a summary or follow-up answer is generating. */
  disabled: boolean;
};

export function SummaryFooter({ meta, onRegenerate, disabled }: Props) {
  const t = useT();
  return (
    <div className="summary-footer">
      {meta && <p className="summary-provenance">{describeSummaryProvenance(meta, t)}</p>}
      <button
        type="button"
        className="regenerate-button"
        onClick={onRegenerate}
        disabled={disabled}
        title={t('panel.regenerate.title')}
      >
        {t('panel.regenerate')}
      </button>
    </div>
  );
}
