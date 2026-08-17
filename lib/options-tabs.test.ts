import { describe, it, expect } from 'vitest';
import { DEFAULT_OPTIONS_TAB, OPTIONS_TABS, hashForTab, isOptionsTab, tabFromHash } from './options-tabs';

describe('tabFromHash', () => {
  it('recognises a valid hash, with or without its hash sign', () => {
    expect(tabFromHash('#profiles')).toBe('profiles');
    expect(tabFromHash('profiles')).toBe('profiles');
    expect(tabFromHash('#data')).toBe('data');
  });

  // '#prompt' named the single prompt editor before it became the profile list.
  // A bookmark on it must land on the tab that took its place, not on the
  // providers fallback.
  it('resolves the renamed #prompt to the profiles tab', () => {
    expect(tabFromHash('#prompt')).toBe('profiles');
  });

  // A stale bookmark must open usable settings, not an empty page.
  it('falls back to the first tab for an absent, empty or unknown hash', () => {
    expect(tabFromHash('')).toBe(DEFAULT_OPTIONS_TAB);
    expect(tabFromHash('#')).toBe(DEFAULT_OPTIONS_TAB);
    expect(tabFromHash('#effort')).toBe(DEFAULT_OPTIONS_TAB);
  });

  it('tolerates case and surrounding spaces', () => {
    expect(tabFromHash('#Languages')).toBe('languages');
    expect(tabFromHash('#  profiles ')).toBe('profiles');
  });

  // Chrome does not encode simple hashes, but a URL copied out of a word
  // processor may arrive encoded.
  it('decodes an encoded hash', () => {
    expect(tabFromHash('#%70rofiles')).toBe('profiles');
  });

  it('does not crash on a lone percent sign, where decodeURIComponent would throw', () => {
    expect(() => tabFromHash('#100%')).not.toThrow();
    expect(tabFromHash('#100%')).toBe(DEFAULT_OPTIONS_TAB);
  });
});

describe('hashForTab', () => {
  it('round-trips through tabFromHash for every tab', () => {
    for (const tab of OPTIONS_TABS) {
      expect(tabFromHash(hashForTab(tab))).toBe(tab);
    }
  });

  it('always carries its hash sign: the value goes into a URL as is', () => {
    expect(hashForTab('data')).toBe('#data');
  });
});

describe('isOptionsTab', () => {
  it('recognises only the four real tabs', () => {
    expect(isOptionsTab('providers')).toBe(true);
    expect(isOptionsTab('effort')).toBe(false);
  });
});
