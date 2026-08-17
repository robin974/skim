import { describe, it, expect } from 'vitest';
import {
  buildAuthUrl, extractCodeFromRedirect, buildKeyExchangeRequest, parseKeyExchangeResponse,
} from './openrouter-oauth';

describe('buildAuthUrl', () => {
  it('pointe vers https://openrouter.ai/auth avec callback_url, code_challenge et code_challenge_method=S256', () => {
    const url = new URL(buildAuthUrl({
      redirectUrl: 'https://abcd1234.chromiumapp.org/',
      codeChallenge: 'chall-xyz',
    }));

    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth');
    expect(url.searchParams.get('callback_url')).toBe('https://abcd1234.chromiumapp.org/');
    expect(url.searchParams.get('code_challenge')).toBe('chall-xyz');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});

describe('extractCodeFromRedirect', () => {
  it("extracts 'code' from a valid redirect URL", () => {
    expect(extractCodeFromRedirect('https://abcd1234.chromiumapp.org/?code=abc123')).toBe('abc123');
  });

  it("returns null when 'code' is absent", () => {
    expect(extractCodeFromRedirect('https://abcd1234.chromiumapp.org/?error=access_denied')).toBeNull();
  });

  it('returns null on a malformed URL, without throwing', () => {
    expect(() => extractCodeFromRedirect('not a url')).not.toThrow();
    expect(extractCodeFromRedirect('not a url')).toBeNull();
  });
});

describe('buildKeyExchangeRequest', () => {
  it('POSTs to /api/v1/auth/keys with code, code_verifier and code_challenge_method=S256 in the body', () => {
    const built = buildKeyExchangeRequest({ code: 'the-code', codeVerifier: 'the-verifier' });

    expect(built.url).toBe('https://openrouter.ai/api/v1/auth/keys');
    expect(built.init.method).toBe('POST');
    expect(typeof built.init.body).toBe('string');
    const body = JSON.parse(typeof built.init.body === 'string' ? built.init.body : '{}');
    expect(body).toEqual({
      code: 'the-code',
      code_verifier: 'the-verifier',
      code_challenge_method: 'S256',
    });
  });
});

describe('parseKeyExchangeResponse', () => {
  it('extracts the key when the response has the expected shape', () => {
    expect(parseKeyExchangeResponse({ key: 'sk-or-v1-abc' })).toBe('sk-or-v1-abc');
  });

  it.each([
    ['a non-object', 'nope'],
    ['null', null],
    ['a missing key field', {}],
    ['a non-string key', { key: 42 }],
    ['an empty key', { key: '' }],
  ])('returns null for %s', (_label, json) => {
    expect(parseKeyExchangeResponse(json)).toBeNull();
  });
});
