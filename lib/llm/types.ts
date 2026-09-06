import type { ErrorCode } from '@/lib/messages';

export class LLMError extends Error {
  constructor(public code: ErrorCode, message: string, public status?: number) {
    super(message);
    this.name = 'LLMError';
  }
}

export type ProviderId =
  | 'openrouter' | 'openai' | 'deepseek' | 'anthropic' | 'gemini' | 'opencode-go' | 'custom';

export type ChatTurn = { role: 'user' | 'assistant'; text: string };

/**
 * The effort scale, lowest to highest. `'off'` is the bottom: it explicitly asks
 * for no reasoning, which is NOT the same as sending nothing — on a reasoning
 * model, sending nothing lets it think (measured: 259 s before the first
 * character against 1.1 s, see docs/handoff-couper-le-raisonnement.md).
 */
export const EFFORT_SCALE = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export type EffortScaleLevel = (typeof EFFORT_SCALE)[number];

/**
 * Shared effort vocabulary. `'default'` is not a level: it is the total absence
 * of the key from the request body. It stays distinct from `'off'` (see
 * EFFORT_SCALE) and remains the right fallback wherever the extension cannot
 * steer a model's reasoning.
 */
export type EffortLevel = 'default' | EffortScaleLevel;

/**
 * What a model really accepts. `levels` runs lowest to highest and contains
 * `'off'` only where turning off is ESTABLISHED, not assumed.
 *
 * `reason` separates two situations that do not call for the same response:
 * "this model does not reason" closes the subject, while "the extension cannot
 * steer its reasoning" says another model, or a later version, will.
 */
export type EffortSupport = {
  levels: readonly EffortScaleLevel[];
  /** Set only when `levels` is empty. */
  reason?: 'no-reasoning' | 'unknown';
  /**
   * Set only when the list applies to the WHOLE provider rather than to this
   * model — OpenRouter's case: it applies the 7 levels to any model id and
   * downgrades to the supported tier itself, with no per-model table.
   *
   * The interface needs the distinction so it never ASSERTS of the model what
   * the code only knows of the provider: without it, a non-reasoning model
   * relayed through OpenRouter is promised 7 levels that change nothing. See
   * describeEffortLevels (lib/llm/effort.ts).
   */
  scope?: 'provider';
};

/** What the service worker asks for, independent of the provider. */
export type ChatRequest = {
  model: string;
  turns: ChatTurn[];
  /** Absent ≡ 'default': see EffortLevel above. */
  effort?: EffortLevel;
  /**
   * Stable id of ONE conversation, when the caller knows one. OpenCode Go
   * requires it as the `x-opencode-session` header — per-conversation routing
   * and prompt-cache affinity, enforced since 2026-09-06 — and every other
   * provider ignores it. Derived from the video id (lib/session-id.ts); absent,
   * the one provider that needs it falls back to a per-request UUID rather than
   * let the request be rejected.
   */
  sessionId?: string;
};

/** A provider's user-side configuration. */
export type ProviderConfig = { apiKey: string; baseUrl?: string };

export type BuiltRequest = { url: string; init: RequestInit };

/** One entry of the options page's model dropdown. */
export type ModelOption = { id: string; label: string };

/**
 * The models a provider offers, when it exposes a list. The two halves belong
 * together by construction — a request without its parser is useless — hence one
 * object rather than two independent optional methods on Provider, which would
 * let the type express "request without parser".
 */
export type ModelCatalog = {
  buildRequest(cfg: ProviderConfig): BuiltRequest;
  /**
   * Extracts the models usable for a summary from the JSON response. Never
   * throws: an unexpected shape yields an empty list, which the options page
   * treats as "list unavailable" and replaces with manual entry.
   */
  parse(json: unknown): ModelOption[];
};

export interface Provider {
  id: ProviderId;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  /** Builds the streaming completion HTTP request. */
  buildChatRequest(req: ChatRequest, cfg: ProviderConfig): BuiltRequest;
  /** Extracts the text fragment from an SSE payload, or null. */
  parseChunk(payload: string): string | null;
  /** Translates an HTTP status into one of the project's ErrorCodes. */
  classifyStatus(status: number): ErrorCode;
  /** Key validation request, as light as possible. */
  buildValidateRequest(cfg: ProviderConfig): BuiltRequest;
  /**
   * Absent when the provider exposes no queryable list: the options page then
   * falls back to manual id entry.
   */
  modelCatalog?: ModelCatalog;
  /**
   * The effort levels THIS model accepts. Optional, for the same reason as
   * `modelCatalog`: its absence is information, not an oversight — it says the
   * extension knows nothing of this provider's reasoning capabilities, and the
   * interface says so (see effortsOf, lib/llm/effort.ts). A provider that
   * implements it commits to a verified list, never a guessed one.
   */
  effortsFor?(model: string): EffortSupport;
}
