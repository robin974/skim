// OpenCode Go: a low-cost subscription (opencode.ai/docs/go) giving access to a
// curated list of open models behind ONE key. It is pasted into the options page
// like any other key and travels as `Authorization: Bearer`.
//
// What justifies its own file rather than one more call to
// createOpenAICompatibleProvider: the gateway does NOT expose a single protocol.
// Depending on the model it serves /chat/completions (OpenAI), /messages
// (Anthropic) or /responses (OpenAI Responses), and a model served on one is not
// served on the others. The routing therefore lives in buildChatRequest, keyed
// by model id.
import type {
  BuiltRequest, ChatRequest, ChatTurn, EffortScaleLevel, EffortSupport, ModelOption, Provider, ProviderConfig,
} from '../types';
import { clampEffort } from '../effort';
import type { ErrorCode } from '@/lib/messages';

const DEFAULT_BASE_URL = 'https://opencode.ai/zen/go/v1';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Default model, chosen for THIS extension's job — summarising a transcript —
 * rather than for the coding agent OpenCode Go targets:
 *  - 1M context window, the widest on the list alongside glm-5.2 and kimi-k3, so
 *    a 3-hour transcript fits without chunking;
 *  - generalist, therefore comfortable in French prose, unlike the "code"
 *    variants;
 *  - served on /chat/completions, the only one of the three protocols verifiable
 *    without an active subscription (see WIRES below);
 *  - among the cheapest ($0.435/1M input), so the most forgiving of the
 *    subscription's usage caps — which matters when every summary sends a whole
 *    transcript.
 */
const DEFAULT_MODEL = 'deepseek-v4-pro';

/** The three protocols the gateway serves. */
type Wire = 'chat' | 'messages' | 'responses';

/**
 * Protocol per model, for the models NOT on /chat/completions (see
 * DEFAULT_WIRE). This table has to be embedded: the gateway's /models endpoint
 * returns bare ids, with no metadata to infer the protocol from.
 *
 * Source: the github.com/can1357/oh-my-pi catalogue
 * (packages/catalog/src/models.json, `api` field of the `opencode-go`
 * provider), NOT the "Endpoints" table at opencode.ai/docs/go. The two
 * contradict each other on five models, and the catalogue is the empirical one:
 * its changelog documents having to reroute deepseek-v4-flash to /responses
 * because "the OpenCode Go gateway does not serve this model at
 * /zen/go/v1/chat/completions", while the docs still list it on
 * /chat/completions. In the other direction, the docs announce three models on
 * /messages where the catalogue serves them on /chat/completions.
 *
 * Corollary: this table ages. A model OpenCode adds later falls back to
 * DEFAULT_WIRE, which remains the right bet (17 of the 24 published models are
 * there) but can fail — the provider's error message then surfaces as is.
 */
const WIRES: Record<string, Wire> = {
  'deepseek-v4-flash': 'responses',
  'gpt-5.6-luna': 'responses',
  'grok-4.5': 'responses',
  'minimax-m2.5': 'messages',
  'qwen3.7-max': 'messages',
  'qwen3.7-plus': 'messages',
  'qwen3.8-max': 'messages',
};

const DEFAULT_WIRE: Wire = 'chat';

export function wireFor(model: string): Wire {
  return WIRES[model] ?? DEFAULT_WIRE;
}

/**
 * Effort levels accepted per model. Same source as WIRES (the empirical oh-my-pi
 * catalogue, `thinking.efforts` field), but NOT the same contract: this list is
 * asserted from that catalogue and was verified ONCE on a sample, not level by
 * level nor model by model, and is deliberately not re-probed.
 *
 * Unlike WIRES, no live probe rechecks this table. A stale entry here produces a
 * wrong MENU — a level offered that no longer exists, or the reverse — never a
 * broken request, because the gateway does not validate levels (see below). WIRES
 * and UNAVAILABLE do not have that luxury: a wrong entry there breaks a summary.
 *
 * 18 models: the catalogue's 24, minus the two already in UNAVAILABLE, minus the
 * 4 served on /messages, whose effort transport is not established for this
 * gateway. Those four, like any absent model, return 'unknown': the interface
 * says so rather than offering a setting with no effect.
 *
 * THE GATEWAY DOES NOT VALIDATE LEVELS — measured 2026-08-12 with one request:
 * `deepseek-v4-pro` + `minimal`, outside its declared list below, is ACCEPTED
 * (200). This table is therefore a CHOICE aid for the user and the UI, not a
 * server-side guard. Nothing technically stops a level absent from here being
 * sent, so this table, and it alone, has to stay right.
 *
 * THE 'off' COLUMN is measured, not assumed. The catalogue promised a switch for
 * none of these models, since the gateway is the native host of none of them.
 * Measured anyway, one representative per family — the family, not the
 * individual model, decides the transport: on /chat/completions,
 * `thinking: { type: 'disabled' }` really does cut reasoning (raw SSE stream
 * with no reasoning fragment at all, AND request accepted — both conditions,
 * never one) for the Kimi, MiMo, Qwen, MiniMax and DeepSeek families. 'off' is
 * therefore listed below for ALL models of those families, not just the
 * representative. `enable_thinking: false`, the second transport tried, was never
 * needed.
 *
 * SECOND CAMPAIGN, 2026-08-12 (fixtures/diag-off-opencodego.mjs): GLM and Hunyuan
 * DO turn off. The first campaign concluded otherwise, but it had tried only two
 * transports, both at the body's top level, and neither suits those families.
 * `reasoning_effort: 'none'` turns them off outright — measured on glm-5.2,
 * glm-5.1 and hy3: identical answer, not one reasoning fragment left in the raw
 * stream, and a first character at 0.7-1.7 s against 3.2-6.8 s at the default.
 * "Cannot turn off" was a verdict on the transports tried, not on the models.
 *
 * That is why those four now carry 'off', and why the transport is chosen PER
 * FAMILY (see OFF_TRANSPORTS): no single transport covers everyone —
 * `reasoning_effort: 'none'` answers 500 on mimo-v2.5, and lets minimax-m3 emit
 * its reasoning inside the content itself (`<think>…`), where
 * `thinking:{type:'disabled'}` cuts it.
 *
 * STILL DO NOT TURN OFF, per that second campaign:
 *  - grok-4.5: all four transports tried are refused with a 400 naming the
 *    parameter. Not "unsampled" — a flat refusal;
 *  - deepseek-v4-flash and gpt-5.6-luna (both /responses): their stream carries
 *    NO reasoning even at the default, so there is nothing whose extinction
 *    could be demonstrated. gpt-5.6-luna does accept `reasoning:{effort:'none'}`
 *    (200), but accepting is not turning off, and this project's criterion
 *    requires both.
 */
export const EFFORTS: Record<string, readonly EffortScaleLevel[]> = {
  'deepseek-v4-flash': ['minimal', 'low', 'medium', 'high', 'xhigh'],
  'deepseek-v4-pro': ['off', 'high', 'max'],
  'glm-5': ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  'glm-5.1': ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  'glm-5.2': ['off', 'minimal', 'low', 'medium', 'high', 'max'],
  'gpt-5.6-luna': ['low', 'medium', 'high', 'xhigh', 'max'],
  'grok-4.5': ['minimal', 'low', 'medium', 'high', 'xhigh'],
  hy3: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  'kimi-k2.5': ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  'kimi-k2.6': ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  'kimi-k2.7-code': ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  'kimi-k3': ['off', 'low', 'high', 'max'],
  'mimo-v2.5': ['off', 'low', 'medium', 'high'],
  'mimo-v2.5-pro': ['off', 'low', 'medium', 'high'],
  'minimax-m2.7': ['off', 'low', 'medium', 'high'],
  'minimax-m3': ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  'qwen3.5-plus': ['off', 'minimal', 'low', 'medium', 'high'],
  'qwen3.6-plus': ['off', 'minimal', 'low', 'medium', 'high'],
};

/**
 * Models GET /models announces but the gateway refuses to serve. Measured
 * 2026-08-12 by the live probe (opencodego.live.test.ts): of the 25 published
 * ids, these three answer 400 on ALL THREE protocols, with messages that leave
 * no doubt — "Unsupported model …" and "Model is unavailable." So this is not a
 * routing miss (see WIRES) but a catalogue promising more than it delivers.
 *
 * Removed from the dropdown rather than left for the user to hit: all three fail
 * for certain, and the failure would only surface on the first summary, as a
 * generic error.
 *
 * This list cannot rot silently: the probe checks both directions — that no
 * other model breaks, and that these still do. The day OpenCode enables them, it
 * fails and asks for their removal.
 */
export const UNAVAILABLE = new Set(['mimo-v2-pro', 'mimo-v2-omni', 'hy3-preview']);

/**
 * Readable labels for the model dropdown. The /models endpoint returns bare ids,
 * opaque to anyone not following open-model releases closely. An id absent from
 * this table displays as is, so the list stays complete when OpenCode adds one.
 */
const LABELS: Record<string, string> = {
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'glm-5': 'GLM-5',
  'glm-5.1': 'GLM-5.1',
  'glm-5.2': 'GLM-5.2',
  'gpt-5.6-luna': 'GPT-5.6 Luna',
  'grok-4.5': 'Grok 4.5',
  hy3: 'Hy3',
  'hy3-preview': 'Hy3 (preview)',
  'kimi-k2.5': 'Kimi K2.5',
  'kimi-k2.6': 'Kimi K2.6',
  'kimi-k2.7-code': 'Kimi K2.7 Code',
  'kimi-k3': 'Kimi K3',
  'mimo-v2-omni': 'MiMo-V2-Omni',
  'mimo-v2-pro': 'MiMo-V2-Pro',
  'mimo-v2.5': 'MiMo-V2.5',
  'mimo-v2.5-pro': 'MiMo-V2.5-Pro',
  'minimax-m2.5': 'MiniMax M2.5',
  'minimax-m2.7': 'MiniMax M2.7',
  'minimax-m3': 'MiniMax M3',
  'qwen3.5-plus': 'Qwen3.5 Plus',
  'qwen3.6-plus': 'Qwen3.6 Plus',
  'qwen3.7-max': 'Qwen3.7 Max',
  'qwen3.7-plus': 'Qwen3.7 Plus',
  'qwen3.8-max': 'Qwen3.8 Max',
};

function classifyStatus(status: number): ErrorCode {
  // 402 as well as 429: the Go subscription is capped in usage dollars, and a
  // cap reached is a quota overrun — certainly not an invalid key, which would
  // send the user to re-paste a perfectly good one.
  if (status === 402 || status === 429) return 'quota';
  if (status === 500 || status === 502 || status === 503 || status === 529) return 'overloaded';
  if (status === 401 || status === 403) return 'invalid-key';
  // 400 is NOT classified 'invalid-key' here, unlike the OpenAI-compatible
  // providers: on this gateway it is the expected code when a model is not
  // served on the protocol WIRES chose (stale table). Reporting an invalid key
  // would send the user hunting in the wrong place.
  return 'unknown';
}

function bearer(cfg: ProviderConfig): Record<string, string> {
  return { 'content-type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` };
}

function baseUrlOf(cfg: ProviderConfig): string {
  return cfg.baseUrl || DEFAULT_BASE_URL;
}

/** Declared capabilities for a model. Shared by the encoders and the Provider below: one table, one read. */
function effortsFor(model: string): EffortSupport {
  const levels = EFFORTS[model];
  return levels ? { levels } : { levels: [], reason: 'unknown' };
}

/**
 * The level actually sendable for THIS model, or undefined when nothing goes
 * out. The gateway does not validate levels (see EFFORTS), so this is where —
 * and nowhere server-side — the provider honours its own declaration. Not a
 * second policy point: resolveEffort (lib/settings.ts) remains the only place
 * that DECIDES, and since it already clamps against this same model, this clamp
 * is idempotent on the normal path.
 */
function sendableEffort(req: ChatRequest): EffortScaleLevel | undefined {
  return clampEffort(effortsFor(req.model), req.effort ?? 'default');
}

/**
 * The transport that really turns THIS model off. Two values because two were
 * measured necessary (see EFFORTS): neither covers all eight families alone.
 *
 * A table per MODEL, populated per family: the family decides the transport, but
 * writing it out model by model avoids guessing a family from an id at runtime.
 * A model declaring 'off' without appearing here would make the tables
 * inconsistent — opencodego.test.ts closes that gap.
 */
export const OFF_TRANSPORTS: Record<string, 'thinking-disabled' | 'reasoning-effort-none'> = {
  // Measured silent with `thinking: { type: 'disabled' }`, reconfirmed by the
  // second campaign on one representative per family.
  'deepseek-v4-pro': 'thinking-disabled',
  'kimi-k2.5': 'thinking-disabled',
  'kimi-k2.6': 'thinking-disabled',
  'kimi-k2.7-code': 'thinking-disabled',
  'kimi-k3': 'thinking-disabled',
  'mimo-v2.5': 'thinking-disabled',
  'mimo-v2.5-pro': 'thinking-disabled',
  'minimax-m2.7': 'thinking-disabled',
  'minimax-m3': 'thinking-disabled',
  'qwen3.5-plus': 'thinking-disabled',
  'qwen3.6-plus': 'thinking-disabled',
  // Deaf to `thinking`, turned off by `reasoning_effort: 'none'` (second
  // campaign, 2026-08-12). glm-5 follows its two siblings without having been
  // probed itself: the family decides the transport.
  'glm-5': 'reasoning-effort-none',
  'glm-5.1': 'reasoning-effort-none',
  'glm-5.2': 'reasoning-effort-none',
  hy3: 'reasoning-effort-none',
};

/**
 * The turn-off body, on /chat/completions and ONLY there: no 'off' model in the
 * table is served on /responses or /messages — every model carrying 'off' is
 * absent from WIRES, hence on DEFAULT_WIRE — so chatBody is the only one of the
 * three bodies that needs it.
 *
 * Receives the ALREADY clamped level, so 'off' only arrives for a model EFFORTS
 * declares it for: measured as really able to turn off, never assumed. Such a
 * model absent from OFF_TRANSPORTS falls back to the majority transport rather
 * than to an empty body.
 *
 * An empty body would be worse, because of `sentEffort` (lib/llm/stream.ts): it
 * infers that a parameter went out from INTENT (`req.effort !== 'default'`), not
 * from the real body. Excluding 'off' from the body with nothing in its place
 * would make an 'off' request that took a 400 from elsewhere look to streamChat
 * like it had sent a parameter, triggering a retry byte-identical to the first —
 * exactly what the fallback's contract forbids. Carrying the measured level in
 * `thinking` keeps intent and body in agreement, and the retry (rebuilt with
 * effort: 'default') does omit it.
 */
function disableBody(model: string, level: EffortScaleLevel | undefined): Record<string, unknown> {
  if (level !== 'off') return {};
  return OFF_TRANSPORTS[model] === 'reasoning-effort-none'
    ? { reasoning_effort: 'none' }
    : { thinking: { type: 'disabled' } };
}

/** /chat/completions body — identical to the OpenAI API. */
function chatBody(req: ChatRequest): string {
  const level = sendableEffort(req);
  return JSON.stringify({
    model: req.model,
    stream: true,
    messages: req.turns.map((t) => ({ role: t.role, content: t.text })),
    ...(level && level !== 'off' ? { reasoning_effort: level } : {}),
    ...disableBody(req.model, level),
  });
}

/**
 * /messages body — Anthropic. max_tokens is MANDATORY there, unlike on
 * /chat/completions where omitting it lets the provider decide: without it the
 * request is rejected with a 400. 4096 matches the anthropic provider, well above
 * a summary's ~1,500 tokens.
 */
function messagesBody(req: ChatRequest): string {
  return JSON.stringify({
    model: req.model,
    stream: true,
    max_tokens: 4096,
    messages: req.turns.map((t) => ({ role: t.role, content: t.text })),
  });
}

/**
 * /responses body — OpenAI's Responses API. The part type differs by role
 * (`input_text` for the user, `output_text` for the assistant): the short
 * `input: "…"` form could not carry a conversation history, which follow-up
 * questions need.
 */
function responsesBody(req: ChatRequest): string {
  // 'off' cannot arrive here — no model served on /responses declares it, an
  // invariant locked by opencodego.test.ts — but the filter stays explicit:
  // `thinking` is a /chat/completions field with no measured equivalent on this
  // protocol (see disableBody).
  const level = sendableEffort(req);
  return JSON.stringify({
    model: req.model,
    stream: true,
    input: req.turns.map((t: ChatTurn) => ({
      role: t.role,
      content: [{ type: t.role === 'assistant' ? 'output_text' : 'input_text', text: t.text }],
    })),
    ...(level && level !== 'off' ? { reasoning: { effort: level } } : {}),
  });
}

/**
 * The wired effort levels live in EFFORTS above, not here — see its comment for
 * the source, the contract and the families that carry 'off'. Like WIRES,
 * EFFORTS will age: a model absent from it, whether brand new or one of the four
 * served on /messages, falls back to 'unknown' through effortsFor rather than
 * guessing a parameter that would fail with a 400.
 */
export const opencodego: Provider = {
  id: 'opencode-go',
  label: 'OpenCode Go',
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultModel: DEFAULT_MODEL,

  effortsFor,

  buildChatRequest(req: ChatRequest, cfg: ProviderConfig): BuiltRequest {
    const baseUrl = baseUrlOf(cfg);
    const wire = wireFor(req.model);

    if (wire === 'messages') {
      return {
        url: `${baseUrl}/messages`,
        init: {
          method: 'POST',
          headers: {
            ...bearer(cfg),
            // The gateway expects the OpenCode key, but this path speaks the
            // Anthropic protocol, and the reference clients send `x-api-key` +
            // `anthropic-version`. Both authentication forms go out rather than
            // betting on one: they carry the same value, and whichever header
            // the gateway ignores costs nothing.
            'x-api-key': cfg.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: messagesBody(req),
        },
      };
    }

    if (wire === 'responses') {
      return {
        url: `${baseUrl}/responses`,
        init: { method: 'POST', headers: bearer(cfg), body: responsesBody(req) },
      };
    }

    return {
      url: `${baseUrl}/chat/completions`,
      init: { method: 'POST', headers: bearer(cfg), body: chatBody(req) },
    };
  },

  /**
   * One parser for all three protocols. Not a shortcut: parseChunk does not
   * receive the model (lib/llm/stream.ts knows only the provider), so it CANNOT
   * route the way buildChatRequest does. The three shapes are disjoint —
   * `choices[].delta.content`, `content_block_delta` and
   * `response.output_text.delta` — and recognise unambiguously.
   */
  parseChunk(payload: string): string | null {
    try {
      const json = JSON.parse(payload);

      // OpenAI /chat/completions.
      const delta = json.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') return delta || null;

      // Anthropic /messages. `content_block_delta` also carries reasoning
      // blocks (thinking_delta), which have no `text` field: they are ignored
      // here, which is intended — the panel shows the answer, not the thinking.
      if (json.type === 'content_block_delta') {
        return typeof json.delta?.text === 'string' ? json.delta.text || null : null;
      }

      // OpenAI /responses. The stream's other events (response.created,
      // response.output_item.added, …) carry no text.
      if (json.type === 'response.output_text.delta') {
        return typeof json.delta === 'string' ? json.delta || null : null;
      }

      return null;
    } catch {
      return null;
    }
  },

  classifyStatus,

  /**
   * GET /usage rather than GET /models: this gateway's model list is PUBLIC
   * (verified — it answers 200 with no authorization header), so using it as a
   * probe would validate any string, including an empty key. /usage requires the
   * key and answers 401 "AuthError" without it, at no cost — preferable to the
   * minimal completion request the anthropic provider uses, which spends
   * subscription quota on every key paste.
   */
  buildValidateRequest(cfg: ProviderConfig): BuiltRequest {
    return {
      url: `${baseUrlOf(cfg)}/usage`,
      init: { headers: { Authorization: `Bearer ${cfg.apiKey}` } },
    };
  },

  modelCatalog: {
    // Works without a key by design: this endpoint is public (see
    // buildValidateRequest). The header goes out anyway, for consistency with
    // the other providers and in case it becomes required.
    buildRequest(cfg: ProviderConfig): BuiltRequest {
      return {
        url: `${baseUrlOf(cfg)}/models`,
        init: { headers: { Authorization: `Bearer ${cfg.apiKey}` } },
      };
    },
    parse(json: unknown): ModelOption[] {
      const data = (json as { data?: { id?: unknown }[] })?.data;
      if (!Array.isArray(data)) return [];
      return data
        .map((m) => (typeof m?.id === 'string' ? m.id : ''))
        .filter((id) => id && !UNAVAILABLE.has(id))
        .map((id) => ({ id, label: LABELS[id] ?? id }));
    },
  },
};
