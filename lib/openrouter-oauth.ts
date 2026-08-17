// Pure construction of the OpenRouter PKCE OAuth messages: authorisation URL,
// code-for-key exchange request, code extraction from the redirect URL. No
// network and no chrome.identity here — entrypoints/options/ composes these
// with chrome.identity.launchWebAuthFlow and fetch.
//
// OpenRouter only. Anthropic banned third-party OAuth on 2026-02-20 (enforced
// 2026-04-04); OpenAI, Google and DeepSeek offer none. No generic per-provider
// abstraction: that would be speculative generality for a single real case.
import type { BuiltRequest } from '@/lib/llm/types';

const AUTH_URL = 'https://openrouter.ai/auth';
const KEY_EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';

/** The URL to open with chrome.identity.launchWebAuthFlow. */
export function buildAuthUrl(params: { redirectUrl: string; codeChallenge: string }): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set('callback_url', params.redirectUrl);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/**
 * Extracts `code` from the launchWebAuthFlow redirect URL. `null` when absent
 * or when the URL is malformed — never throws, the caller decides what happens
 * next (manual fallback).
 */
export function extractCodeFromRedirect(redirectedUrl: string): string | null {
  try {
    return new URL(redirectedUrl).searchParams.get('code');
  } catch {
    return null;
  }
}

/** POST https://openrouter.ai/api/v1/auth/keys — trades the code (single use, expires in 10 min) for an API key. */
export function buildKeyExchangeRequest(params: { code: string; codeVerifier: string }): BuiltRequest {
  return {
    url: KEY_EXCHANGE_URL,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: params.code,
        code_verifier: params.codeVerifier,
        code_challenge_method: 'S256',
      }),
    },
  };
}

/**
 * Extracts the API key from the exchange response, without `as any`: the shape
 * is checked before the content is trusted. `null` when the response does not
 * have the expected shape.
 */
export function parseKeyExchangeResponse(json: unknown): string | null {
  if (typeof json !== 'object' || json === null || !('key' in json)) return null;
  const { key } = json;
  return typeof key === 'string' && key !== '' ? key : null;
}
