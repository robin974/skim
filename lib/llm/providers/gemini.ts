import type {
  BuiltRequest, ChatRequest, ChatTurn, EffortLevel, EffortSupport, ModelOption, Provider, ProviderConfig,
} from '../types';
import { clampEffort } from '../effort';
import type { ErrorCode } from '@/lib/messages';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-3.6-flash';

export function classifyStatus(status: number): ErrorCode {
  if (status === 429) return 'quota';
  if (status === 503 || status === 500) return 'overloaded';
  if (status === 400 || status === 401 || status === 403) return 'invalid-key';
  return 'unknown';
}

function toGeminiRole(role: ChatTurn['role']): 'user' | 'model' {
  return role === 'assistant' ? 'model' : 'user';
}

function toContents(turns: ChatTurn[]) {
  return turns.map((t) => ({ role: toGeminiRole(t.role), parts: [{ text: t.text }] }));
}

/**
 * Reasoning effort. Gemini exposes TWO distinct, non-interchangeable mechanisms,
 * verified 2026-08-12 against
 * ai.google.dev/gemini-api/docs/generate-content/thinking:
 *  - `generationConfig.thinkingConfig.thinkingLevel`, qualitative
 *    (minimal/low/medium/high), on the Gemini 3 generation only;
 *  - `generationConfig.thinkingConfig.thinkingBudget`, a token COUNT, on Gemini
 *    2.5 — with no official qualitative scale, mapping our levels onto it would
 *    mean INVENTING thresholds.
 *
 * Gemini 2.0 and older support neither, and the behaviour of a thinkingConfig
 * sent to a model that does not understand it is documented nowhere (error, or
 * silently ignored). The parameter is therefore sent ONLY for a generation 3
 * model, never as thinkingBudget.
 *
 * Two heuristics, not one. `thinkingLevel` is specific to generation 3, but the
 * accepted tiers differ WITHIN it: Pro knows only `low` and `high`, while Flash
 * and Flash-Lite take all four. A single heuristic sent `minimal` and `medium`
 * to a Pro that does not know them.
 *
 * These patterns will age if Google changes its naming convention; the cut is
 * exact as of 2026-08-12, and `DEFAULT_MODEL` falls on the Flash side.
 *
 * No `'off'` level: turning off would go through `thinkingBudget: 0`, the OTHER
 * mechanism, ruled out above.
 */
const GEMINI_3_PRO = /^gemini-3(\.\d+)?-pro\b/;
const GEMINI_3 = /^gemini-3(\.|-|$)/;

function effortsFor(model: string): EffortSupport {
  if (GEMINI_3_PRO.test(model)) return { levels: ['low', 'high'] };
  if (GEMINI_3.test(model)) return { levels: ['minimal', 'low', 'medium', 'high'] };
  return { levels: [], reason: 'unknown' };
}

function mapEffort(effort: EffortLevel | undefined, model: string): { thinkingLevel: string } | undefined {
  const level = clampEffort(effortsFor(model), effort ?? 'default');
  return level === undefined ? undefined : { thinkingLevel: level };
}

export const gemini: Provider = {
  id: 'gemini',
  label: 'Gemini',
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultModel: DEFAULT_MODEL,
  effortsFor,

  buildChatRequest(req: ChatRequest, cfg: ProviderConfig): BuiltRequest {
    const baseUrl = cfg.baseUrl || DEFAULT_BASE_URL;
    const thinkingConfig = mapEffort(req.effort, req.model);
    const body: { contents: unknown; generationConfig?: { thinkingConfig: { thinkingLevel: string } } } = {
      contents: toContents(req.turns),
    };
    if (thinkingConfig) body.generationConfig = { thinkingConfig };
    return {
      url: `${baseUrl}/models/${req.model}:streamGenerateContent?alt=sse&key=${cfg.apiKey}`,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    };
  },

  parseChunk(payload: string): string | null {
    try {
      const json = JSON.parse(payload);
      const text = json.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
      return text || null;
    } catch {
      return null;
    }
  },

  classifyStatus,

  buildValidateRequest(cfg: ProviderConfig): BuiltRequest {
    const baseUrl = cfg.baseUrl || DEFAULT_BASE_URL;
    return { url: `${baseUrl}/models?key=${cfg.apiKey}`, init: {} };
  },

  modelCatalog: {
    /**
     * pageSize=1000: without it the API paginates at 50 and the list stops
     * mid-alphabet with nothing to signal it. Nothing here follows nextPageToken
     * — one request, one complete list.
     */
    buildRequest(cfg: ProviderConfig): BuiltRequest {
      const baseUrl = cfg.baseUrl || DEFAULT_BASE_URL;
      return { url: `${baseUrl}/models?pageSize=1000&key=${cfg.apiKey}`, init: {} };
    },
    /**
     * The Gemini catalogue mixes generation, embedding, image and TTS models.
     * `supportedGenerationMethods` decides without a name heuristic: keep only
     * what the extension actually calls, streamGenerateContent.
     */
    parse(json: unknown): ModelOption[] {
      const models = (json as { models?: unknown })?.models;
      if (!Array.isArray(models)) return [];
      return models
        .filter((m: { supportedGenerationMethods?: unknown }) =>
          Array.isArray(m?.supportedGenerationMethods)
          && m.supportedGenerationMethods.includes('streamGenerateContent'))
        .map((m: { name?: unknown; displayName?: unknown }) => {
          // `name` arrives prefixed ("models/gemini-3.6-flash") while
          // buildChatRequest expects the bare id and rebuilds the prefix itself.
          // Letting it through would produce "/models/models/gemini-…".
          const id = typeof m.name === 'string' ? m.name.replace(/^models\//, '') : '';
          return { id, label: typeof m.displayName === 'string' && m.displayName ? m.displayName : id };
        })
        .filter((m) => m.id !== '');
    },
  },
};
