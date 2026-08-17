import { describe, it, expect } from 'vitest';
import { describeSummaryProvenance, describeVideoMeta, formatProducedAt } from './summary-meta';
import { createTranslator } from './i18n';
import type { SummaryMeta, VideoMeta } from './messages';

// Provenance composes catalogue KEYS rather than words (see lib/i18n.ts), so
// these tests pass a real French translator and check the sentence as it
// displays.
const t = createTranslator('fr');

describe('formatProducedAt', () => {
  it('produces a non-empty string containing a plausible date', () => {
    const s = formatProducedAt(new Date('2026-08-10T14:32:00Z').getTime());
    expect(s.length).toBeGreaterThan(0);
    // Locale-dependent through the runtime's Intl: the exact format is not
    // pinned, only the presence of the year, which holds across usual locales.
    expect(s).toContain('2026');
  });
});

describe('describeSummaryProvenance — the complete footer line', () => {
  const producedAt = new Date('2026-08-10T14:32:00').getTime();

  it('source, production date, then provider and model', () => {
    const meta: SummaryMeta = {
      producedAt, provider: 'OpenRouter', model: 'anthropic/claude-sonnet-4.5',
    };
    const line = describeSummaryProvenance(meta, t);
    expect(line).toBe(
      `Construit à partir des sous-titres, généré le ${formatProducedAt(producedAt, 'fr')}, `
      + 'par OpenRouter (anthropic/claude-sonnet-4.5).',
    );
  });

  // The line says the same thing whether the summary has just been generated or
  // was redisplayed: it describes the summary, not the moment it reached the
  // screen. The cache wording it used to carry ("servi depuis le cache") is
  // gone with the cache itself.
  it('a redisplayed summary keeps ITS date, with nothing said about where it was read from', () => {
    const meta: SummaryMeta = { producedAt, provider: 'Gemini', model: 'gemini-3.6-flash' };
    const line = describeSummaryProvenance(meta, t);
    // The date follows the INTERFACE locale, not the browser's: on an interface
    // switched to English, a French-formatted date would be the one fragment of
    // the line left in French.
    expect(line).toContain(`généré le ${formatProducedAt(producedAt, 'fr')}`);
    expect(line).toContain('par Gemini (gemini-3.6-flash)');
    expect(line.toLowerCase()).not.toContain('cache');
  });

  // `activeModel` falls back to the provider's defaultModel, which the 'custom'
  // provider does not have (lib/settings.ts): the model really can be empty.
  it('empty model: the provider shows alone, with no empty parentheses', () => {
    const meta: SummaryMeta = { producedAt, provider: 'OpenRouter', model: '' };
    const line = describeSummaryProvenance(meta, t);
    expect(line).toContain('par OpenRouter');
    expect(line).not.toContain('()');
    expect(line).not.toContain('undefined');
  });

  it('never mentions an API key nor any field outside SummaryMeta', () => {
    const meta: SummaryMeta = { producedAt, provider: 'OpenRouter', model: 'un-modèle' };
    const line = describeSummaryProvenance(meta, t);
    expect(line.toLowerCase()).not.toContain('key');
    expect(line.toLowerCase()).not.toContain('clé');
    expect(line.toLowerCase()).not.toContain('sk-');
  });

  it('reports the effort fallback, as the last segment and without drama', () => {
    const line = describeSummaryProvenance({
      producedAt, provider: 'OpenRouter', model: 'm', effortDropped: true,
    }, t);
    expect(line).toContain("sans le réglage d'effort, refusé par le modèle");
    expect(line.endsWith("sans le réglage d'effort, refusé par le modèle.")).toBe(true);
  });

  it('says nothing when the fallback did not happen', () => {
    const line = describeSummaryProvenance({ producedAt, provider: 'OpenRouter', model: 'm' }, t);
    expect(line).not.toContain('effort');
  });

  // The opening segment is the one the catalogues have to agree on: it is the
  // only word in the line that does not come from the provider or the clock.
  it('opens the same way in the English catalogue', () => {
    const line = describeSummaryProvenance({ producedAt, provider: 'OpenRouter', model: 'm' }, createTranslator('en'));
    expect(line.startsWith('Built from the subtitles,')).toBe(true);
  });
});

// The line under the video's title in the panel. Same rule as the provenance
// line above: a segment nothing is known about is left unsaid, never filled in.
describe('describeVideoMeta — the channel · duration line', () => {
  const meta = (overrides: Partial<VideoMeta> = {}): VideoMeta => ({
    videoId: 'v1', title: 'Titre', channel: 'Fireship', description: '', durationSeconds: 1860, ...overrides,
  });

  it('names the channel, then the duration', () => {
    expect(describeVideoMeta(meta(), t)).toBe('Fireship · 31 min');
  });

  it('reads an hour and more as a clock, with padded minutes', () => {
    expect(describeVideoMeta(meta({ durationSeconds: 3840 }), t)).toBe('Fireship · 1 h 04');
  });

  it('drops the channel when none was stored, keeping the duration alone', () => {
    expect(describeVideoMeta(meta({ channel: '  ' }), t)).toBe('31 min');
  });

  // A conversation stored before the metadata arrived: 0 is not a duration, and
  // "0 min" would state something false about the video.
  it('drops an unusable duration rather than showing zero', () => {
    expect(describeVideoMeta(meta({ durationSeconds: 0 }), t)).toBe('Fireship');
    expect(describeVideoMeta(meta({ durationSeconds: Number.NaN }), t)).toBe('Fireship');
  });

  it('rounds a video shorter than a minute up rather than to zero', () => {
    expect(describeVideoMeta(meta({ durationSeconds: 20 }), t)).toBe('Fireship · 1 min');
  });

  it('returns nothing at all when the video has no metadata: the panel then draws no line', () => {
    expect(describeVideoMeta(null, t)).toBe('');
    expect(describeVideoMeta(meta({ channel: '', durationSeconds: 0 }), t)).toBe('');
  });

  // `meta` comes straight out of session storage, written by whatever build
  // opened the session. A field the type promises but the data lacks MUST NOT
  // throw: there is no error boundary above the panel, and the whole side panel
  // would go blank.
  it('survives a stored meta missing the fields its type promises', () => {
    const partial = { videoId: 'v1', title: 'Titre' } as unknown as VideoMeta;
    expect(() => describeVideoMeta(partial, t)).not.toThrow();
    expect(describeVideoMeta(partial, t)).toBe('');
  });
});
