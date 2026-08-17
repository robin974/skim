// Honest waiting: a summary takes 10 to 40 s, a follow-up answer usually less
// but not always. A static line from start to finish reads as a stuck request,
// and pushed users to click the button again while a summary was already
// running.
//
// Two distinct requirements:
//  - a PHASE, chosen by the caller among those the system REALLY knows (see
//    App.tsx) — never an invented phase, and never the name of the internal
//    technical path, which stays a deliberately invisible detail;
//  - an elapsed time that TICKS, the only reliable signal over a wait of tens of
//    seconds.
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n-react';

/**
 * Seconds elapsed since `phaseKey` took its current value, updated every second.
 * `phaseKey` encodes both the video and the phase (e.g. `v1:loading`), so the id
 * changes as soon as either does, restarting the timer without a mutable
 * `useRef` or a `Date.now()` inside a pure reducer.
 *
 * `null` disables the timer: nothing rendered, no interval started.
 */
function usePhaseElapsedSeconds(phaseKey: string | null): number {
  const [phase, setPhase] = useState<{ key: string; startedAt: number } | null>(null);

  // Adjusting during render, React's recommended pattern for resetting derived
  // state when a prop changes: no effect, no extra render.
  if (phaseKey !== null && phase?.key !== phaseKey) {
    setPhase({ key: phaseKey, startedAt: Date.now() });
  } else if (phaseKey === null && phase !== null) {
    setPhase(null);
  }

  const [, tick] = useState(0);
  useEffect(() => {
    if (phaseKey === null) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [phaseKey]);

  if (phase === null) return 0;
  return Math.max(0, Math.floor((Date.now() - phase.startedAt) / 1000));
}

type Props = {
  /** Label of the current phase — see App.tsx for the only two labels in use. */
  label: string;
  /**
   * Identifies the phase for the timer (see usePhaseElapsedSeconds), typically
   * `${videoId}:${status}`. A new value restarts it at zero.
   */
  phaseKey: string;
  /** Reduces visual weight, for the wait under an already-asked follow-up question. */
  compact?: boolean;
};

export function Waiting({ label, phaseKey, compact = false }: Props) {
  const t = useT();
  const seconds = usePhaseElapsedSeconds(phaseKey);

  return (
    <div className={compact ? 'waiting waiting-compact' : 'waiting'} aria-live="polite" aria-busy="true">
      <p className="waiting-label">
        <span>{label}</span>
        <span className="waiting-elapsed">{t('panel.waiting.seconds', { count: seconds })}</span>
      </p>
      <div className="skeleton" aria-hidden="true">
        <div className="skeleton-line" />
        <div className="skeleton-line" />
        {!compact && <div className="skeleton-line skeleton-line-short" />}
      </div>
    </div>
  );
}

/**
 * Discreet "more is coming" indicator, appended after the text already received
 * from the first chunk of a stream onwards, replacing the timer.
 */
export function StreamingCursor() {
  return <span className="stream-cursor" aria-hidden="true" />;
}
