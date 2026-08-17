// The four tabs of the options page, and their addressing through the URL hash.
//
// The hash is not comfort: it is what lets a panel error open the settings ON
// THE RIGHT TAB instead of dropping the user on the page to hunt for the
// setting at fault. See openOptions (lib/open-options.ts), which turns it into
// a real URL.

export const OPTIONS_TABS = ['providers', 'profiles', 'languages', 'data'] as const;

export type OptionsTab = (typeof OPTIONS_TABS)[number];

export const DEFAULT_OPTIONS_TAB: OptionsTab = 'providers';

/**
 * Hashes that named a tab that has since been renamed. `#prompt` was the single
 * prompt editor before it became the profile list: a bookmark on it must land on
 * the tab that took its place, not on the providers fallback.
 */
const TAB_ALIASES: Record<string, OptionsTab> = { prompt: 'profiles' };

export function isOptionsTab(value: string): value is OptionsTab {
  return (OPTIONS_TABS as readonly string[]).includes(value);
}

/**
 * The tab a URL hash designates (`'#profiles'`, `'profiles'`, `''`…).
 *
 * Tolerant by construction: an absent, empty, unknown or stale hash falls back
 * to the first tab rather than rendering an empty page. A dead bookmark MUST
 * open usable settings, not an error.
 */
export function tabFromHash(hash: string): OptionsTab {
  const raw = hash.replace(/^#/, '');
  // decodeURIComponent THROWS on a lone percent sign ("#100%"). An arbitrary
  // hash comes from the URL, so from outside: one stray character MUST NOT take
  // the whole options page down with it.
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const normalized = decoded.trim().toLowerCase();
  if (isOptionsTab(normalized)) return normalized;
  return TAB_ALIASES[normalized] ?? DEFAULT_OPTIONS_TAB;
}

/** The hash to write in the URL for this tab — always with its `#`. */
export function hashForTab(tab: OptionsTab): string {
  return `#${tab}`;
}
