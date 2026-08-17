// PKCE (Proof Key for Code Exchange, RFC 7636) for the OpenRouter OAuth flow.
// Pure functions only; chrome.identity.launchWebAuthFlow is called from
// entrypoints/.

/** The RFC 3986 §2.3 "unreserved" alphabet — the only one allowed in a PKCE code_verifier. */
const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/**
 * Generates a random RFC 7636 `code_verifier` (43-128 characters, unreserved
 * alphabet). `crypto.getRandomValues`, never `Math.random`: this verifier is a
 * secret, and making it predictable breaks the whole point of PKCE.
 */
export function generateCodeVerifier(length = 64): string {
  if (length < 43 || length > 128) {
    throw new RangeError('code_verifier must be 43 to 128 characters (RFC 7636)');
  }
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let verifier = '';
  for (const byte of bytes) verifier += UNRESERVED[byte % UNRESERVED.length];
  return verifier;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * `code_challenge` = base64url(SHA-256(verifier)), method S256 — the only one
 * OpenRouter accepts. The RFC forbids `=` padding and the standard alphabet
 * (`+`, `/`) for use in a URL.
 */
export async function computeCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}
