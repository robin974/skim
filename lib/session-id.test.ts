import { describe, it, expect } from 'vitest';
import { conversationSessionId } from './session-id';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('conversationSessionId', () => {
  it('is stable: one video, one id, in any session', () => {
    expect(conversationSessionId('v1')).toBe(conversationSessionId('v1'));
  });

  it('differs across videos', () => {
    expect(conversationSessionId('v1')).not.toBe(conversationSessionId('v2'));
  });

  it('is a UUID the gateway accepts, and never the raw video id', () => {
    const id = conversationSessionId('dQw4w9WgXcQ');
    expect(id).toMatch(UUID_RE);
    expect(id).not.toContain('dQw4w9WgXcQ');
  });

  // Locks the derivation itself: the header must stay stable across releases,
  // otherwise every update silently resets the affinity the summaries primed.
  // 'abc' is the SHA-256 reference vector; the two ids were produced by
  // node:crypto and pin THIS implementation to the standard.
  it('locks the hash, byte for byte', () => {
    expect(conversationSessionId('v1')).toBe('3bfc2695-94ef-6492-28e9-a74bab00f042');
    expect(conversationSessionId('dQw4w9WgXcQ')).toBe('5f6b0b4e-201f-2a7e-6692-7abb5cadeec8');
    expect(conversationSessionId('abc')).toBe('ba7816bf-8f01-cfea-4141-40de5dae2223');
  });
});
