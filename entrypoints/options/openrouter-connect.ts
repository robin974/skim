// Orchestrates the OpenRouter PKCE OAuth flow: composes the pure functions of
// lib/pkce.ts and lib/openrouter-oauth.ts with chrome.identity.launchWebAuthFlow
// and fetch, neither of which exists under Vitest. This file therefore has no
// direct test; what it builds — URL, PKCE, exchange request — is verified through
// the pure lib/ modules it composes.
//
// OpenRouter only: the sole provider offering third-party OAuth. Anthropic
// banned it on 2026-02-20 (enforced 2026-04-04); OpenAI, Google and DeepSeek
// never had one. No generic abstraction for a single real case.
import { generateCodeVerifier, computeCodeChallenge } from '@/lib/pkce';
import {
  buildAuthUrl, buildKeyExchangeRequest, extractCodeFromRedirect, parseKeyExchangeResponse,
} from '@/lib/openrouter-oauth';
import type { MessageKey } from '@/lib/i18n';

export type OAuthResult =
  | { ok: true; key: string }
  /**
   * A catalogue KEY, never a sentence (same contract as KeyValidation,
   * lib/validate-key.ts). The caller appends the manual fallback
   * (`oauth.error.fallback`) itself, shared by all seven failure causes.
   */
  | { ok: false; messageKey: MessageKey };

/**
 * Never leaves the caller waiting indefinitely: every failure point returns a
 * clear message inviting the manual fallback, never an exception that would
 * leave the UI stuck on a spinner.
 */
export async function connectOpenRouter(): Promise<OAuthResult> {
  if (typeof chrome.identity?.launchWebAuthFlow !== 'function') {
    return { ok: false, messageKey: 'oauth.error.unsupported' };
  }

  const verifier = generateCodeVerifier();
  const codeChallenge = await computeCodeChallenge(verifier);
  const redirectUrl = chrome.identity.getRedirectURL();
  const authUrl = buildAuthUrl({ redirectUrl, codeChallenge });

  let responseUrl: string | undefined;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  } catch {
    return { ok: false, messageKey: 'oauth.error.refusedFlow' };
  }
  if (!responseUrl) {
    return { ok: false, messageKey: 'oauth.error.cancelled' };
  }

  const code = extractCodeFromRedirect(responseUrl);
  if (!code) {
    return { ok: false, messageKey: 'oauth.error.noCode' };
  }

  const built = buildKeyExchangeRequest({ code, codeVerifier: verifier });
  let res: Response;
  try {
    res = await fetch(built.url, built.init);
  } catch {
    return { ok: false, messageKey: 'oauth.error.network' };
  }
  if (!res.ok) {
    // The code is single-use and expires in 10 minutes: the likeliest cause of a
    // failure here is a double click or too long a delay.
    return { ok: false, messageKey: 'oauth.error.exchangeRefused' };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, messageKey: 'oauth.error.unreadable' };
  }

  const key = parseKeyExchangeResponse(json);
  if (!key) {
    return { ok: false, messageKey: 'oauth.error.unexpected' };
  }

  return { ok: true, key };
}
