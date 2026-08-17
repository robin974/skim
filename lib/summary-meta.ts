// Pure formatting of a displayed summary's provenance: what it was built from,
// when, and by which model.
// entrypoints/sidepanel/SummaryFooter.tsx only renders the string produced here.
//
// Deliberately discreet in its WORDING, not just in its CSS (see style.css,
// .summary-footer): a reference line, never an alert or a warning.
//
// The words come from the catalogue (lib/i18n.ts) and this module receives a
// translator. What stays HERE, and stays tested, is the DECISION: which
// segments, in what order, and which are left unsaid for lack of information.
import type { SummaryMeta, VideoMeta } from './messages';
import type { Locale, Translator } from './i18n';

/**
 * Readable production date, in the INTERFACE locale rather than the browser's:
 * on an interface switched to English, a French-formatted date would be the one
 * fragment of the line left in French. `undefined` (no translator in sight)
 * lets `toLocaleString` fall back to the browser.
 */
export function formatProducedAt(epochMs: number, locale?: Locale): string {
  return new Date(epochMs).toLocaleString(locale);
}

/**
 * The full provenance line: one sentence, up to four comma-separated segments.
 *  1. what the summary was built from — the subtitles, the only path there is;
 *  2. the production date;
 *  3. provider and model;
 *  4. the effort fallback, ONLY when it happened (see streamChat,
 *     lib/llm/stream.ts) — always last, never mentioned otherwise.
 *
 * The date is stated even under a summary that has just appeared, rather than
 * "just now" for a fresh one and a date for a redisplayed one. Nothing here
 * knows which of the two it is: a summary is redisplayed from the conversation
 * that carries this very provenance, and inventing the distinction would mean
 * dating one of them wrong.
 *
 * `model` may be empty (see SummaryMeta, lib/messages.ts); the line then names
 * the provider alone rather than an empty parenthesis.
 */
export function describeSummaryProvenance(meta: SummaryMeta, t: Translator): string {
  const segments: string[] = [
    t('provenance.built.transcript'),
    t('provenance.generatedAt', { date: formatProducedAt(meta.producedAt, t.locale) }),
    meta.model
      ? t('provenance.byModel', { provider: meta.provider, model: meta.model })
      : t('provenance.byProvider', { provider: meta.provider }),
  ];

  if (meta.effortDropped) segments.push(t('provenance.effortDropped'));

  return `${segments.join(', ')}.`;
}

/**
 * The line under the video's title in the panel: channel · duration.
 *
 * Each segment is stated only when it is known. An empty channel or a duration
 * of 0 — a conversation stored before its metadata arrived, or a video whose
 * page never yielded one — drops out rather than showing a separator with
 * nothing on one side, and a video with neither returns '' so the caller draws
 * no line at all.
 *
 * The duration is rounded to the minute: this line says which video is on
 * screen, and the second it was rounded from teaches nobody anything.
 */
export function describeVideoMeta(meta: VideoMeta | null, t: Translator): string {
  if (meta === null) return '';

  const segments: string[] = [];
  // Optional chaining on a REQUIRED field: `meta` comes straight out of session
  // storage, written by whatever build opened the session (the same reason
  // lib/conversations.ts carries isLegacyConversation). A throw here would blank
  // the whole panel — there is no error boundary above it.
  const channel = meta.channel?.trim() ?? '';
  if (channel !== '') segments.push(channel);

  const duration = formatVideoDuration(meta.durationSeconds, t);
  if (duration !== '') segments.push(duration);

  return segments.join(' · ');
}

/**
 * "47 min", "1 h 04". Under a minute reads as "1 min" rather than "0 min": the
 * video exists, and a zero would read as an unknown duration — which is what ''
 * is for.
 */
function formatVideoDuration(seconds: number, t: Translator): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';

  const total = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(total / 60);
  if (hours === 0) return t('panel.videoMeta.minutes', { count: total });

  // Padded because this is a clock reading, not a count: "1 h 4" reads as four
  // of something.
  return t('panel.videoMeta.hours', { hours, minutes: String(total % 60).padStart(2, '0') });
}
