/**
 * The OpenCode Go gateway requires an `x-opencode-session` header on every
 * request — a stable id per conversation, used for routing and prompt-cache
 * affinity. Announced 2026-09-03; requests without it may be rejected from
 * 2026-09-06. In this extension a conversation IS a video (lib/conversations.ts
 * keys everything by videoId), so the id is derived from it.
 *
 * Hashed rather than sent raw so the header stays opaque: a YouTube video id is
 * meaningful on its own, its SHA-256 says nothing to the provider that the
 * transcript body does not already say, and the value is still stable — the
 * same video hashes to the same id in every session, which is what lets a
 * follow-up question reuse the affinity the summary established.
 *
 * Synchronous SHA-256 rather than crypto.subtle, deliberately: the orchestrator
 * derives this id in the path that leads to withRetry, and a real macrotask
 * there (subtle.digest completes on the threadpool) desynchronises any caller
 * that advances fake timers through the retries — the id would resolve only
 * after the timer queue had already been drained.
 */

/** Round constants: first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;

/** SHA-256 of a UTF-8 string, as lowercase hex. Locked by test vectors in session-id.test.ts. */
function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  // Message + 0x80 + zeros to ≡ 56 (mod 64) + 8 bytes of bit length.
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const message = new DataView(padded.buffer);
  message.setUint32(padded.length - 8, Math.floor(bitLength / 2 ** 32));
  message.setUint32(padded.length - 4, bitLength >>> 0);

  // DataViews rather than indexed array reads: noUncheckedIndexedAccess makes
  // every `words[i]` a possible undefined, which a numeric kernel cannot carry.
  // K is copied word by word — a DataView over the Uint32Array's buffer would
  // read its native-endian stores as big-endian.
  const w = new DataView(new ArrayBuffer(256));
  const k = new DataView(new ArrayBuffer(256));
  K.forEach((value, i) => k.setUint32(i * 4, value));

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let t = 0; t < 16; t++) w.setUint32(t * 4, message.getUint32(offset + t * 4));
    for (let t = 16; t < 64; t++) {
      const p = (t - 15) * 4;
      const q = (t - 2) * 4;
      const s0 = rotr(w.getUint32(p), 7) ^ rotr(w.getUint32(p), 18) ^ (w.getUint32(p) >>> 3);
      const s1 = rotr(w.getUint32(q), 17) ^ rotr(w.getUint32(q), 19) ^ (w.getUint32(q) >>> 10);
      w.setUint32(t * 4, (w.getUint32((t - 16) * 4) + s0 + w.getUint32((t - 7) * 4) + s1) | 0);
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + k.getUint32(t * 4) + w.getUint32(t * 4)) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e;
      e = (d + temp1) | 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => (x >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

export function conversationSessionId(videoId: string): string {
  const hex = sha256Hex(videoId).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
