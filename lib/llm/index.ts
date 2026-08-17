import type { Provider, ProviderId } from './types';
import { openrouter, openai, deepseek, custom } from './providers/openai-compatible';
import { anthropic } from './providers/anthropic';
import { gemini } from './providers/gemini';
import { opencodego } from './providers/opencodego';

/**
 * `custom` stays defined here — the `ProviderId` and the provider object are
 * intact — but is NOT offered in the options page's provider picker.
 *
 * A user-supplied base URL cannot be covered by any `host_permissions` declared
 * ahead of time (wxt.config.ts), so neither key validation nor streaming can
 * reach an arbitrary origin: selecting `custom` produced a silently broken
 * extension. This is not an oversight. Adding `<all_urls>` would fix it and
 * would be fatal in Chrome Web Store review — an excessive permission for a
 * YouTube summariser. Making `custom` genuinely usable needs
 * `optional_host_permissions` plus a runtime `chrome.permissions.request()` when
 * the user enters their URL.
 */
export const PROVIDERS: Record<ProviderId, Provider> = {
  openrouter,
  openai,
  deepseek,
  anthropic,
  gemini,
  'opencode-go': opencodego,
  custom,
};

/**
 * The providers the interface offers, in display order — everything but
 * `custom`, for the reason spelled out above it.
 *
 * Declared here, beside the registry it filters, because three surfaces need the
 * same list: the setup assistant, the panel's provider chips, and
 * configuredProviders (lib/settings.ts). Three copies of the same `!== 'custom'`
 * filter would eventually disagree.
 */
export const SELECTABLE_PROVIDERS = (Object.keys(PROVIDERS) as ProviderId[]).filter((id) => id !== 'custom');

export function getProvider(id: ProviderId): Provider {
  return PROVIDERS[id];
}
