import type {
  BuiltRequest, ChatRequest, ChatTurn, EffortScaleLevel, EffortSupport, ModelOption, Provider, ProviderConfig, ProviderId,
} from '../types';
import { EFFORT_SCALE } from '../types';
import { clampEffort } from '../effort';
import { cacheAnchors, cacheableContent } from '../cache-anchors';
import type { CacheableBlock } from '../cache-anchors';
import type { ErrorCode } from '@/lib/messages';

function classifyStatus(status: number): ErrorCode {
  if (status === 429) return 'quota';
  if (status === 500 || status === 502 || status === 503) return 'overloaded';
  if (status === 400 || status === 401 || status === 403) return 'invalid-key';
  return 'unknown';
}

/**
 * `anchors` is empty for every instance whose caching is automatic, and the
 * bodies those instances send are byte-identical to the ones from before this
 * parameter existed — a bare string per message, never a content-part array.
 */
function toMessages(
  turns: ChatTurn[], anchors: number[],
): { role: 'user' | 'assistant'; content: string | CacheableBlock[] }[] {
  return turns.map((t, i) => ({ role: t.role, content: cacheableContent(t.text, anchors.includes(i)) }));
}

/**
 * One /models entry as these endpoints return it. Only `id` is guaranteed by the
 * OpenAI API; `name` is an OpenRouter extension, and the modality fields serve to
 * drop anything that does not produce text.
 */
type RawModel = {
  id?: unknown;
  name?: unknown;
  output_modalities?: unknown;
  architecture?: { output_modalities?: unknown };
};

/**
 * Builds a provider for any OpenAI-compatible endpoint (OpenRouter, OpenAI,
 * DeepSeek, custom…).
 *
 * `keepModel` filters the model dropdown. It is per-instance because some
 * providers' /models mixes in models that have no business summarising
 * (embeddings, transcription, image generation), and offering them offers a
 * choice that will certainly fail. Omitted = keep everything, which suits
 * endpoints whose list is already entirely conversational or simply unknown.
 *
 * `mapEffort` translates the shared EffortLevel vocabulary into what THIS
 * instance actually documents — never a behaviour shared by the OpenAI protocol
 * at large, unlike `toMessages`: two endpoints both speaking /chat/completions
 * do not necessarily expose the same reasoning parameter. Omitted = no requested
 * level ever adds anything to the body.
 *
 * It receives ONLY levels that `effortsFor` declares for that model: never
 * `'default'`, never a level outside the list this instance claims to accept. An
 * encoder therefore has nothing to verify — it translates, it does not arbitrate.
 */
type ProviderOptions = {
  id: ProviderId;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  keepModel?: (model: RawModel & { id: string }) => boolean;
  mapEffort?: (effort: EffortScaleLevel) => Record<string, unknown>;
  effortsFor?: (model: string) => EffortSupport;
  cacheControl?: (model: string) => boolean;
};

/**
 * What an instance without `effortsFor` declares: nothing known, so nothing
 * sendable. Same value as `effortsOf`'s fallback (lib/llm/effort.ts) — a missing
 * table is information, not permission to send.
 */
const NO_EFFORTS: EffortSupport = { levels: [], reason: 'unknown' };

function createOpenAICompatibleProvider(o: ProviderOptions): Provider {
  const baseUrlOf = (cfg: ProviderConfig): string => cfg.baseUrl || o.defaultBaseUrl;

  return {
    id: o.id,
    label: o.label,
    defaultBaseUrl: o.defaultBaseUrl,
    defaultModel: o.defaultModel,
    ...(o.effortsFor ? { effortsFor: o.effortsFor } : {}),
    buildChatRequest(req: ChatRequest, cfg: ProviderConfig): BuiltRequest {
      // The provider honours its OWN declaration: no level absent from
      // `effortsFor(req.model)` crosses the network boundary. A model with no
      // declared capability therefore produces a body byte-identical to the one
      // from before this setting existed, exactly like an absent or 'default'
      // effort.
      //
      // This is not a second POLICY point: resolveEffort (lib/settings.ts)
      // remains the only place that decides the level, and since it already
      // clamped against this same model, this clamp is idempotent on the normal
      // path. It only bites on a caller that bypasses resolveEffort.
      const level = clampEffort(o.effortsFor?.(req.model) ?? NO_EFFORTS, req.effort ?? 'default');
      const extra = level && o.mapEffort ? o.mapEffort(level) : undefined;
      // Same shape as the effort clamp above: the instance declares what it
      // supports, and an instance that declares nothing sends nothing.
      const anchors = o.cacheControl?.(req.model) ? cacheAnchors(req.turns) : [];
      return {
        url: `${baseUrlOf(cfg)}/chat/completions`,
        init: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify({
            model: req.model,
            stream: true,
            messages: toMessages(req.turns, anchors),
            ...extra,
          }),
        },
      };
    },
    parseChunk(payload: string): string | null {
      try {
        const json = JSON.parse(payload);
        return json.choices?.[0]?.delta?.content ?? null;
      } catch {
        return null;
      }
    },
    classifyStatus,
    buildValidateRequest(cfg: ProviderConfig): BuiltRequest {
      return {
        url: `${baseUrlOf(cfg)}/models`,
        init: { headers: { Authorization: `Bearer ${cfg.apiKey}` } },
      };
    },
    modelCatalog: {
      // Same request as buildValidateRequest, deliberately: at these providers,
      // listing models IS the lightest validation probe. They stay two distinct
      // methods because nothing guarantees that elsewhere — it is already false
      // for OpenCode Go, whose list is public.
      buildRequest(cfg: ProviderConfig): BuiltRequest {
        return {
          url: `${baseUrlOf(cfg)}/models`,
          init: { headers: { Authorization: `Bearer ${cfg.apiKey}` } },
        };
      },
      parse(json: unknown): ModelOption[] {
        const data = (json as { data?: RawModel[] })?.data;
        if (!Array.isArray(data)) return [];
        return data
          .filter((m): m is RawModel & { id: string } => typeof m?.id === 'string' && m.id !== '')
          .filter((m) => !o.keepModel || o.keepModel(m))
          .map((m) => ({ id: m.id, label: typeof m.name === 'string' && m.name ? m.name : m.id }));
      },
    },
  };
}

/**
 * OpenRouter advertises each model's output modalities; keep only those that
 * produce text. A model declaring nothing is kept — missing metadata MUST NOT
 * make a valid model disappear from the list.
 */
function producesText(m: RawModel): boolean {
  const modalities = m.output_modalities ?? m.architecture?.output_modalities;
  if (!Array.isArray(modalities)) return true;
  return modalities.includes('text');
}

/**
 * OpenAI returns no metadata with its ids, so a chat model can only be told from
 * an embedding model by name. This filter is heuristic and will age — hence the
 * manual entry kept available in the options page for any model these rules
 * wrongly drop.
 */
const OPENAI_NON_CHAT = /embedding|whisper|tts|audio|realtime|transcribe|moderation|dall-e|image|search|davinci|babbage/;

function isOpenAIChatModel(m: { id: string }): boolean {
  if (OPENAI_NON_CHAT.test(m.id)) return false;
  return /^(gpt-|chatgpt-|o[1-9](-|$))/.test(m.id);
}

/**
 * OpenRouter NORMALISES effort across every model it relays and downgrades to
 * the nearest supported tier itself when a model does not know the requested one
 * — verified 2026-08-12 on openrouter.ai/docs/use-cases/reasoning-tokens. It is
 * the only provider here whose documentation confirms both the shape AND the
 * harmlessness of a level a given model lacks, hence one list with no per-model
 * table.
 *
 * `scope: 'provider'` tells the interface so, and that is essential: this list
 * describes NO model in particular. A non-reasoning model relayed here gets the
 * same 7 levels as everything else, and changing level does nothing. The
 * interface therefore announces the levels as OpenRouter's, with its
 * downgrading, rather than as a capability of the chosen model (see
 * describeEffortLevels, lib/llm/effort.ts).
 */
const OPENROUTER_EFFORTS: EffortSupport = { levels: EFFORT_SCALE, scope: 'provider' };

/**
 * The documentation gives three ways to turn reasoning off (`effort: 'none'`,
 * `enabled: false`, `exclude: true`). MEASUREMENT decides, on a 61-minute
 * transcript (fixtures/diag-reasoning.mjs, 2026-08-12): `enabled: false` gives
 * 17.4 s total and 1.1 s to the first character, against 22.8 s and 1.8 s for
 * `effort: 'none'`. Both zero the reasoning; one is faster. A single measurement
 * (one model, one fixture), but the only one available, and it matches the
 * reference implementation's choice.
 */
function openRouterEffort(effort: EffortScaleLevel): Record<string, unknown> {
  return effort === 'off' ? { reasoning: { enabled: false } } : { reasoning: { effort } };
}

/**
 * The relayed providers whose prompt cache is NOT automatic, and which
 * therefore need an explicit `cache_control` breakpoint to reuse anything —
 * OpenRouter passes the marker through to them. Everything else it relays
 * (OpenAI, DeepSeek, xAI…) caches a matching prefix on its own, so no marker
 * is sent there: the discount is the same, and a body carrying no content-part
 * array cannot be refused for its shape.
 *
 * This matters for the DEFAULT model, `anthropic/claude-sonnet-4.5`: without
 * the marker, the extension's own default configuration caches nothing and
 * every follow-up question resends the whole transcript at full price.
 */
const OPENROUTER_EXPLICIT_CACHE = /^(anthropic|google)\//;

export const openrouter = createOpenAICompatibleProvider({
  id: 'openrouter', label: 'OpenRouter',
  defaultBaseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'anthropic/claude-sonnet-4.5',
  keepModel: producesText, mapEffort: openRouterEffort, effortsFor: () => OPENROUTER_EFFORTS,
  cacheControl: (model) => OPENROUTER_EXPLICIT_CACHE.test(model),
});

/**
 * No mapEffort here, deliberately. OpenAI does document `reasoning_effort` (a
 * string at the root of the body), but support is MODEL-specific, not protocol
 * wide: sending it to a model that does not support it — including this
 * provider's DEFAULT model — returns a 400 ("Unsupported parameter:
 * 'reasoning_effort' is not supported with this model").
 *
 * The official reference page returned 403 when checked on 2026-08-12, so the
 * accepting model list could not be confirmed from the primary source, and
 * `isOpenAIChatModel` above does not separate "can chat" from "can reason".
 * Rather than guess a name pattern that would break this provider's default
 * model as soon as a non-'default' level is chosen, the parameter is omitted.
 */
export const openai = createOpenAICompatibleProvider({
  id: 'openai', label: 'OpenAI',
  defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini',
  keepModel: isOpenAIChatModel,
});

/**
 * DeepSeek's own documentation contradicts itself across pages on the
 * parameter's shape, and announces a partial tier rollout. These two short lists
 * reflect the REAL rollout: `reasoning_effort` at the root, and only the models
 * that accept it. This provider's default model is an alias of the mode WITHOUT
 * reasoning — it has nothing to steer, and saying so beats an inert setting.
 */
const DEEPSEEK_EFFORTS: Record<string, readonly EffortScaleLevel[]> = {
  'deepseek-v4-flash': ['low', 'high', 'max'],
  'deepseek-v4-pro': ['high', 'max'],
};

function deepseekEffortsFor(model: string): EffortSupport {
  const levels = DEEPSEEK_EFFORTS[model];
  return levels ? { levels } : { levels: [], reason: 'unknown' };
}

export const deepseek = createOpenAICompatibleProvider({
  id: 'deepseek', label: 'DeepSeek',
  defaultBaseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat',
  mapEffort: (effort) => ({ reasoning_effort: effort }),
  effortsFor: deepseekEffortsFor,
});

/**
 * Custom endpoint: baseUrl supplied by the user through ProviderConfig.baseUrl.
 * No mapEffort — the extension knows neither the model list nor the documented
 * parameters of an arbitrary endpoint.
 */
export const custom = createOpenAICompatibleProvider({
  id: 'custom', label: 'Custom endpoint',
  defaultBaseUrl: '', defaultModel: '',
});
