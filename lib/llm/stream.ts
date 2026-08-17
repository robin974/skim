import type { BuiltRequest, ChatRequest, Provider, ProviderConfig } from './types';
import { LLMError } from './types';
import type { ErrorCode } from '@/lib/messages';

/**
 * Consumes an already-built request. Not exported: streamChat is the only way
 * in, so nothing can reach a provider while bypassing buildChatRequest.
 */
async function* streamFromBuilt(
  provider: Provider,
  built: BuiltRequest,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const { url, init } = built;

  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal });
  } catch {
    // Never include the URL or the headers: they carry the key.
    throw new LLMError('offline', 'Network request failed');
  }
  if (!res.ok) {
    throw new LLMError(provider.classifyStatus(res.status), `${provider.label}: HTTP ${res.status}`, res.status);
  }

  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';

  const extract = (line: string): string | null => {
    if (!line.startsWith('data:')) return null;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return null;
    return provider.parseChunk(payload);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const text = extract(line);
      if (text) yield text;
    }
  }

  // An SSE stream can end without a trailing newline. Without this flush the
  // last line would stay in the buffer and every summary would be truncated.
  buffer += decoder.decode();
  const tail = extract(buffer);
  if (tail) yield tail;
}

/**
 * 400 fallback: resends ONCE, without the reasoning parameter.
 *
 * The "once" guarantee holds for ONE call to streamChat, not for a whole
 * summary. If the caller retries this call — withRetry on a retryable error
 * AFTER the fallback — nothing here stops the new call resending the parameter
 * and walking the whole cycle again. Avoiding that across attempts is
 * deliberately the caller's job: see `effortDropped` in lib/orchestrator.ts,
 * kept OUTSIDE the withRetry closure for exactly this reason.
 *
 * This fallback is necessary because the parameter now goes out BY DEFAULT (see
 * DEFAULT_EFFORT, lib/settings.ts). For someone who asked for nothing, a 400 no
 * longer degrades an option, it breaks the extension. An optimisation MUST NOT
 * become an outage.
 *
 * Three bounds, each necessary:
 *  - once, and only if a parameter really went out — a 400 on a request without
 *    one comes from elsewhere, and resending it identically only doubles the
 *    bill;
 *  - on 400 only: a 429 is NEVER retried, and a 401 is not fixed by dropping a
 *    parameter;
 *  - before any chunk is emitted. streamFromBuilt checks `res.ok` before
 *    producing anything, so this holds already; the flag guarantees it even if
 *    that precedence changed, rather than letting a retry duplicate text already
 *    on screen.
 *
 * The fallback does not hide: onEffortDropped carries it up to the provenance
 * displayed under the summary.
 */
export async function* streamChat(
  provider: Provider,
  req: ChatRequest,
  cfg: ProviderConfig,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  hooks?: { onEffortDropped?: () => void },
): AsyncGenerator<string> {
  const sentEffort = req.effort !== undefined && req.effort !== 'default';
  let emitted = false;

  try {
    for await (const chunk of streamFromBuilt(provider, provider.buildChatRequest(req, cfg), fetchImpl, signal)) {
      emitted = true;
      yield chunk;
    }
    return;
  } catch (e) {
    const isBadRequest = e instanceof LLMError && e.status === 400;
    if (!sentEffort || emitted || !isBadRequest) throw e;
  }

  hooks?.onEffortDropped?.();
  const retry = provider.buildChatRequest({ ...req, effort: 'default' }, cfg);
  yield* streamFromBuilt(provider, retry, fetchImpl, signal);
}

const RETRYABLE: ErrorCode[] = ['overloaded', 'offline'];

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const code = e instanceof LLMError ? e.code : 'unknown';
      if (!RETRYABLE.includes(code) || i === attempts - 1) throw e;
      await sleep(5000 * 2 ** i);
    }
  }
  throw last;
}
