import type {
  BuiltRequest, ChatRequest, ChatTurn, ModelOption, Provider, ProviderConfig,
} from '../types';
import { cacheAnchors, cacheableContent } from '../cache-anchors';
import type { CacheableBlock } from '../cache-anchors';
import type { ErrorCode } from '@/lib/messages';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';

function classifyStatus(status: number): ErrorCode {
  if (status === 429) return 'quota';
  // 529 is the Anthropic API's own overload code (overloaded_error); 500/502/503
  // stay covered in case an intermediate proxy gets in the way.
  if (status === 500 || status === 502 || status === 503 || status === 529) return 'overloaded';
  if (status === 400 || status === 401 || status === 403) return 'invalid-key';
  return 'unknown';
}

/**
 * Carries the prompt-cache breakpoints (see lib/llm/cache-anchors.ts). Without
 * them Anthropic caches NOTHING: unlike the OpenAI and Gemini endpoints, whose
 * prefix cache is automatic, this one only ever reuses what a `cache_control`
 * block marks. A follow-up would otherwise resend the whole transcript at full
 * price on every question.
 */
function toMessages(
  turns: ChatTurn[],
): { role: 'user' | 'assistant'; content: string | CacheableBlock[] }[] {
  const anchors = cacheAnchors(turns);
  return turns.map((t, i) => ({ role: t.role, content: cacheableContent(t.text, anchors.includes(i)) }));
}

function headersFor(cfg: ProviderConfig): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': cfg.apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

/**
 * No effort mapping here, deliberately. Verified 2026-08-12 against
 * platform.claude.com/docs/en/docs/build-with-claude/extended-thinking: the
 * correct parameter depends on the model's GENERATION, not just the provider.
 *  - Claude ≤ 4.5 (including this provider's defaultModel): only the manual mode
 *    exists, `thinking: { type: "enabled", budget_tokens }` — a token COUNT
 *    (minimum 1024, must stay under max_tokens), with no official qualitative
 *    scale to map our levels onto without inventing thresholds;
 *  - Claude 4.6: the same manual mode still works but is deprecated;
 *  - Claude ≥ 4.7: `thinking: { type: "enabled" }` is REJECTED with a 400. Only
 *    the adaptive mode exists, `thinking: { type: "adaptive" }` alongside a
 *    separate `output_config: { effort }`, which does accept a qualitative label
 *    close to our vocabulary.
 *
 * So the right setting is neither a provider attribute nor a pure function of
 * the requested model — buildChatRequest receives only a model id, from the live
 * catalogue or typed by hand — and picking the wrong mode does not degrade
 * silently: it returns a 400 that breaks summarising for this provider.
 *
 * A name heuristic is possible in theory (see gemini.ts, whose generation cut is
 * documented stable), but Claude offers no such naming guarantee: several model
 * names do not follow the sonnet/opus/haiku-N-M scheme. The effort setting
 * therefore has no effect for Anthropic.
 */
export const anthropic: Provider = {
  id: 'anthropic',
  label: 'Anthropic',
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultModel: 'claude-sonnet-4-5',

  buildChatRequest(req: ChatRequest, cfg: ProviderConfig): BuiltRequest {
    const baseUrl = cfg.baseUrl || DEFAULT_BASE_URL;
    return {
      url: `${baseUrl}/v1/messages`,
      init: {
        method: 'POST',
        headers: headersFor(cfg),
        body: JSON.stringify({
          model: req.model,
          stream: true,
          max_tokens: 4096,
          messages: toMessages(req.turns),
        }),
      },
    };
  },

  parseChunk(payload: string): string | null {
    try {
      const json = JSON.parse(payload);
      if (json.type !== 'content_block_delta') return null;
      return json.delta?.text ?? null;
    } catch {
      return null;
    }
  },

  classifyStatus,

  // Anthropic exposes no light unauthenticated list endpoint, so the key is
  // validated with the smallest possible completion request.
  buildValidateRequest(cfg: ProviderConfig): BuiltRequest {
    const baseUrl = cfg.baseUrl || DEFAULT_BASE_URL;
    return {
      url: `${baseUrl}/v1/messages`,
      init: {
        method: 'POST',
        headers: headersFor(cfg),
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      },
    };
  },

  /**
   * GET /v1/models does exist and is authenticated, so this does not contradict
   * buildValidateRequest above: this list populates the dropdown, it does not
   * validate the key. The validation completion is the real test that a key can
   * generate, not merely read.
   */
  modelCatalog: {
    buildRequest(cfg: ProviderConfig): BuiltRequest {
      const baseUrl = cfg.baseUrl || DEFAULT_BASE_URL;
      return { url: `${baseUrl}/v1/models?limit=1000`, init: { headers: headersFor(cfg) } };
    },
    parse(json: unknown): ModelOption[] {
      const data = (json as { data?: { id?: unknown; display_name?: unknown }[] })?.data;
      if (!Array.isArray(data)) return [];
      return data
        .filter((m): m is { id: string; display_name?: string } => typeof m?.id === 'string' && m.id !== '')
        .map((m) => ({ id: m.id, label: m.display_name || m.id }));
    },
  },
};
