import { describe, it, expect } from 'vitest';
import { generateCodeVerifier, computeCodeChallenge } from './pkce';

describe('generateCodeVerifier', () => {
  it('defaults to a length within [43, 128], unreserved alphabet only', () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('honours an explicit length within the bounds', () => {
    expect(generateCodeVerifier(43)).toHaveLength(43);
    expect(generateCodeVerifier(128)).toHaveLength(128);
  });

  it('throws outside the RFC 7636 bounds (43-128)', () => {
    expect(() => generateCodeVerifier(42)).toThrow(RangeError);
    expect(() => generateCodeVerifier(129)).toThrow(RangeError);
  });

  it('generates a different value on every call, from a real random source', () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });
});

describe('computeCodeChallenge', () => {
  it('is the base64url of the verifier SHA-256, with no =, + or /', async () => {
    const verifier = generateCodeVerifier();
    const challenge = await computeCodeChallenge(verifier);
    expect(challenge).not.toMatch(/[=+/]/);
  });

  // The known test vector from RFC 7636 appendix B — a genuinely independent
  // oracle, rather than recomputing the digest with the same code under test,
  // which would only prove internal consistency.
  it('reproduces the RFC 7636 appendix B test vector', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = await computeCodeChallenge(verifier);
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('is deterministic for a given verifier', async () => {
    const verifier = 'a'.repeat(64);
    const c1 = await computeCodeChallenge(verifier);
    const c2 = await computeCodeChallenge(verifier);
    expect(c1).toBe(c2);
  });

  it('differs for two different verifiers', async () => {
    const c1 = await computeCodeChallenge('a'.repeat(64));
    const c2 = await computeCodeChallenge('b'.repeat(64));
    expect(c1).not.toBe(c2);
  });
});
