import { describe, it, expect, vi } from 'vitest';
import { streamChat, withRetry } from './stream';
import { LLMError } from './types';
import type { BuiltRequest, ChatRequest, Provider, ProviderConfig } from './types';
import { openrouter } from './providers/openai-compatible';

/** Fake provider: enough to exercise streamChat/withRetry without depending on a real one. */
const fakeProvider: Provider = {
  id: 'custom',
  label: 'Fake',
  defaultBaseUrl: 'https://fake.test',
  defaultModel: 'fake-model',
  buildChatRequest(req: ChatRequest, cfg: ProviderConfig): BuiltRequest {
    return {
      url: `https://fake.test/chat?key=${cfg.apiKey}`,
      init: { method: 'POST', body: JSON.stringify(req) },
    };
  },
  parseChunk(payload: string): string | null {
    try {
      const json = JSON.parse(payload);
      return json.text ?? null;
    } catch {
      return null;
    }
  },
  classifyStatus(status: number) {
    if (status === 429) return 'quota';
    if (status === 503) return 'overloaded';
    return 'unknown';
  },
  buildValidateRequest(): BuiltRequest {
    return { url: 'https://fake.test/validate', init: {} };
  },
};

const req: ChatRequest = { model: 'fake-model', turns: [{ role: 'user', text: 'hi' }] };
const cfg: ProviderConfig = { apiKey: 'k' };

/**
 * Composes an SSE body from already-formed `data: …` lines, so each element
 * carries the complete payload in the vocabulary of the provider under test.
 * Deliberately generic: the fallback test below exercises `openrouter`, a real
 * provider, and must not depend on a payload shape specific to fakeProvider.
 */
function sseResponse(lines: string[]) {
  return new Response(lines.map((l) => `${l}\n\n`).join(''), { status: 200 });
}

describe('streamChat', () => {
  it('yields the chunks in order', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([
      `data: ${JSON.stringify({ text: 'Bon' })}`,
      `data: ${JSON.stringify({ text: 'jour' })}`,
    ]));
    const out: string[] = [];
    for await (const c of streamChat(fakeProvider, req, cfg, fetchImpl)) out.push(c);
    expect(out).toEqual(['Bon', 'jour']);
  });

  it('never exposes the key in an error message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 429 }));
    await expect(async () => {
      for await (const _c of streamChat(fakeProvider, req, { apiKey: 'SECRET' }, fetchImpl)) { /* */ }
    }).rejects.toSatisfy((e: LLMError) => e.code === 'quota' && !e.message.includes('SECRET'));
  });

  it('classifies a 503 as overloaded', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    await expect(async () => {
      for await (const _c of streamChat(fakeProvider, req, cfg, fetchImpl)) { /* */ }
    }).rejects.toSatisfy((e: LLMError) => e.code === 'overloaded');
  });

  // Without flushing the buffer at the end of the stream this text would be
  // lost, and every summary would be truncated with nothing to signal it.
  it('emits the last line even without a trailing newline', async () => {
    const line = (t: string) => `data: ${JSON.stringify({ text: t })}`;
    const fetchImpl = vi.fn().mockResolvedValue(new Response(`${line('début')}\n\n${line('fin')}`));
    const out: string[] = [];
    for await (const c of streamChat(fakeProvider, req, cfg, fetchImpl)) out.push(c);
    expect(out).toEqual(['début', 'fin']);
  });

  it('ignores SSE lines not prefixed with data:', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(`: ping\ndata: ${JSON.stringify({ text: 'ok' })}\n\n`),
    );
    const out: string[] = [];
    for await (const c of streamChat(fakeProvider, req, cfg, fetchImpl)) out.push(c);
    expect(out).toEqual(['ok']);
  });
});

describe('fallback without the reasoning parameter (400)', () => {
  const provider = openrouter;
  const cfg = { apiKey: 'k' };
  const req = { model: 'm', turns: [{ role: 'user' as const, text: 'x' }], effort: 'off' as const };

  it('resends ONCE without the parameter, and reports it', async () => {
    const bodies: string[] = [];
    let dropped = false;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      if (bodies.length === 1) return new Response('nope', { status: 400 });
      return sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}']);
    }) as unknown as typeof fetch;

    const out: string[] = [];
    for await (const c of streamChat(provider, req, cfg, fetchImpl, undefined, {
      onEffortDropped: () => { dropped = true; },
    })) out.push(c);

    expect(out.join('')).toBe('ok');
    expect(dropped).toBe(true);
    expect(JSON.parse(bodies[0] ?? '{}').reasoning).toEqual({ enabled: false });
    expect('reasoning' in JSON.parse(bodies[1] ?? '{}')).toBe(false);
  });

  it('never retries twice: a 400 on the fallback propagates', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => { calls += 1; return new Response('nope', { status: 400 }); }) as unknown as typeof fetch;
    await expect(async () => {
      for await (const _ of streamChat(provider, req, cfg, fetchImpl)) { /* rien */ }
    }).rejects.toThrow();
    expect(calls).toBe(2);
  });

  it("does not retry when no parameter was sent: the 400 comes from elsewhere", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => { calls += 1; return new Response('nope', { status: 400 }); }) as unknown as typeof fetch;
    await expect(async () => {
      for await (const _ of streamChat(provider, { ...req, effort: 'default' }, cfg, fetchImpl)) { /* rien */ }
    }).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("never turns a 429 into a fallback", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => { calls += 1; return new Response('slow', { status: 429 }); }) as unknown as typeof fetch;
    await expect(async () => {
      for await (const _ of streamChat(provider, req, cfg, fetchImpl)) { /* rien */ }
    }).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe('withRetry', () => {
  const noSleep = async () => {};

  it('retries on overload and then succeeds', async () => {
    let n = 0;
    const r = await withRetry(async () => {
      if (++n < 3) throw new LLMError('overloaded', 'occupé');
      return 'ok';
    }, { sleep: noSleep });
    expect(r).toBe('ok');
    expect(n).toBe(3);
  });

  it('NEVER retries on an exhausted quota', async () => {
    let n = 0;
    await expect(withRetry(async () => {
      n++;
      throw new LLMError('quota', 'épuisé');
    }, { sleep: noSleep })).rejects.toThrow('épuisé');
    expect(n).toBe(1);
  });

  it('does not retry on an invalid key', async () => {
    let n = 0;
    await expect(withRetry(async () => {
      n++;
      throw new LLMError('invalid-key', 'clé morte');
    }, { sleep: noSleep })).rejects.toThrow();
    expect(n).toBe(1);
  });

  it('gives up after the planned number of attempts', async () => {
    let n = 0;
    await expect(withRetry(async () => {
      n++;
      throw new LLMError('overloaded', 'occupé');
    }, { attempts: 4, sleep: noSleep })).rejects.toThrow();
    expect(n).toBe(4);
  });

  it('honours the exponential 5s, 10s, 20s backoff', async () => {
    const waits: number[] = [];
    await expect(withRetry(async () => { throw new LLMError('overloaded', 'x'); }, {
      attempts: 4, sleep: async (ms) => { waits.push(ms); },
    })).rejects.toThrow();
    expect(waits).toEqual([5000, 10000, 20000]);
  });
});
