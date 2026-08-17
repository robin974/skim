// LIVE probe of the OpenCode Go gateway. Outside the default suite: it runs only
// when OPENCODE_LIVE=1 is set AND a key is found, so `npm test` stays offline
// and free, which it must.
//
//   OPENCODE_LIVE=1 OPENCODE_API_KEY=$(cat ~/.config/opencode/api_key) \
//     npx vitest run lib/llm/providers/opencodego.live.test.ts
//
// The $(cat …) substitution keeps the key out of the shell history: the command
// is recorded, never the value it produces.
//
// It exists because the WIRES table in opencodego.ts is the only part of the
// provider no offline test can validate: it asserts which model is served on
// which protocol, and that assertion is taken from a third-party catalogue, not
// measured. This probe measures it — across ALL published models, not only those
// in the table — and is what will keep it current as OpenCode adds models.
//
// Cost: one request per model, cut off at the first text chunk (see firstChunk).
import { describe, it, expect } from 'vitest';
import { opencodego, wireFor, UNAVAILABLE } from './opencodego';
import { streamChat } from '../stream';

/**
 * The project compiles with `"types": ["chrome"]` (tsconfig.json): Node's types
 * are deliberately not loaded, so no extension file can accidentally call an API
 * absent from a service worker. This declares here, and only here, the strict
 * minimum this probe needs, rather than widening `types` for everyone.
 */
declare const process: { env: Record<string, string | undefined> };

// OPENCODE_API_KEY is the name the opencode CLI already reads: nothing new to
// remember for anyone who has the tool installed.
const KEY = process.env.OPENCODE_LIVE === '1' ? (process.env.OPENCODE_API_KEY ?? '').trim() : '';

/** The stream's first text chunk, then cut off. */
async function firstChunk(model: string): Promise<string> {
  const controller = new AbortController();
  try {
    for await (const chunk of streamChat(
      opencodego,
      { model, turns: [{ role: 'user', text: 'Reply exactly: OK' }] },
      { apiKey: KEY },
      fetch,
      controller.signal,
    )) {
      if (chunk) return chunk;
    }
    return '';
  } finally {
    controller.abort();
  }
}

describe.skipIf(!KEY)('opencode-go: live probe', () => {
  it('has its key accepted by /usage', async () => {
    const built = opencodego.buildValidateRequest({ apiKey: KEY });
    const res = await fetch(built.url, built.init);
    expect(res.status, `HTTP ${res.status} on ${built.url}`).toBe(200);
  });

  it('confirms /models is public, and therefore useless as a key probe', async () => {
    // Checks the assumption that justifies choosing /usage in
    // buildValidateRequest: if it stopped holding, that choice would deserve
    // reconsideration.
    const res = await fetch(`${opencodego.defaultBaseUrl}/models`);
    expect(res.status).toBe(200);
  });

  it('confirms WIRES and UNAVAILABLE describe exactly what the gateway serves', async () => {
    // The RAW ids, not modelCatalog.parse's: that already removes UNAVAILABLE,
    // and this probe exists to check that removal is still justified.
    const res = await fetch(`${opencodego.defaultBaseUrl}/models`);
    const json = await res.json() as { data?: { id?: string }[] };
    const ids = (json.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
    expect(ids.length).toBeGreaterThan(0);

    // In batches: sequential would be slow, and all at once would hammer the
    // gateway and skew the errors with rate limiting.
    const outcome = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 5) {
      const results = await Promise.all(ids.slice(i, i + 5).map(async (id) => {
        try {
          return { id, text: await firstChunk(id), error: '' };
        } catch (e) {
          return { id, text: '', error: e instanceof Error ? e.message : String(e) };
        }
      }));
      for (const r of results) {
        outcome.set(r.id, r.text ? '' : (r.error || 'no text'));
        console.log(`${r.id.padEnd(20)} ${wireFor(r.id).padEnd(10)} ${r.text ? '✓' : `✗ ${outcome.get(r.id)}`}`);
      }
    }

    // Direction 1 — a model that should work and does not. Two possible causes,
    // told apart by the error message: "Unsupported model" / "unavailable" means
    // it belongs in UNAVAILABLE; any other 400 means WIRES gives it the wrong
    // protocol.
    const broken = ids
      .filter((id) => !UNAVAILABLE.has(id) && outcome.get(id))
      .map((id) => `${id} (${wireFor(id)}) : ${outcome.get(id)}`);
    expect(broken, `Announced but mute models:\n${broken.join('\n')}`).toEqual([]);

    // Direction 2 — an excluded model that works again, or has left the
    // catalogue: either way UNAVAILABLE is lying and must shrink.
    const revived = [...UNAVAILABLE].filter((id) => !ids.includes(id) || !outcome.get(id));
    expect(
      revived,
      `To remove from UNAVAILABLE (served again, or no longer published):\n${revived.join('\n')}`,
    ).toEqual([]);
  }, 180_000);
});
