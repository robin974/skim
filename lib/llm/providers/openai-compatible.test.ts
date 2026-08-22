import { describe, it, expect } from 'vitest';
import { openrouter, openai, deepseek, custom } from './openai-compatible';
import { EFFORT_SCALE } from '../types';

describe('openai-compatible : parseChunk', () => {
  it('extrait le texte d\'un delta valide', () => {
    expect(openrouter.parseChunk(JSON.stringify({ choices: [{ delta: { content: 'Bonjour' } }] }))).toBe('Bonjour');
  });

  it('renvoie null sur un delta vide', () => {
    expect(openrouter.parseChunk(JSON.stringify({ choices: [{ delta: {} }] }))).toBeNull();
  });

  it('renvoie null sur du JSON invalide', () => {
    expect(openrouter.parseChunk('{not json')).toBeNull();
  });
});

describe('openai-compatible : buildChatRequest', () => {
  const req = { model: 'anthropic/claude-sonnet-4.5', turns: [{ role: 'user' as const, text: 'salut' }] };
  const cfg = { apiKey: 'sk-secret' };

  it('le corps contient stream: true', () => {
    const { init } = openrouter.buildChatRequest(req, cfg);
    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(true);
  });

  it('puts the key in the Authorization header and never in the URL', () => {
    const { url, init } = openrouter.buildChatRequest(req, cfg);
    expect(url).not.toContain('sk-secret');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-secret');
  });

  it('POST vers {baseUrl}/chat/completions', () => {
    const { url } = openrouter.buildChatRequest(req, cfg);
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('keeps the assistant role as is, with no conversion', () => {
    const withAssistant = {
      model: 'm',
      turns: [{ role: 'assistant' as const, text: 'réponse' }],
    };
    const { init } = openrouter.buildChatRequest(withAssistant, cfg);
    const body = JSON.parse(init.body as string);
    expect(body.messages[0].role).toBe('assistant');
  });

  it('honours a custom baseUrl for the custom provider', () => {
    const { url } = custom.buildChatRequest(req, { apiKey: 'k', baseUrl: 'https://my-proxy.example/v1' });
    expect(url).toBe('https://my-proxy.example/v1/chat/completions');
  });

  it("falls back to the provider's default on an empty baseUrl: a cleared field must not send an empty URL", () => {
    const { url } = openrouter.buildChatRequest(req, { apiKey: 'k', baseUrl: '' });
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
  });
});

describe('openai-compatible : classifyStatus', () => {
  it('maps 429 to a quota overrun', () => expect(openrouter.classifyStatus(429)).toBe('quota'));
  it('500 est une surcharge', () => expect(openrouter.classifyStatus(500)).toBe('overloaded'));
  it('502 est une surcharge', () => expect(openrouter.classifyStatus(502)).toBe('overloaded'));
  it('503 est une surcharge', () => expect(openrouter.classifyStatus(503)).toBe('overloaded'));
  it('maps 401 to an invalid key', () => expect(openrouter.classifyStatus(401)).toBe('invalid-key'));
  it('maps 403 to an invalid key', () => expect(openrouter.classifyStatus(403)).toBe('invalid-key'));
  it('maps 400 to an invalid key', () => expect(openrouter.classifyStatus(400)).toBe('invalid-key'));
  it('418 est inconnu', () => expect(openrouter.classifyStatus(418)).toBe('unknown'));
});

describe('openai-compatible : buildValidateRequest', () => {
  it('GETs {baseUrl}/models with the same header', () => {
    const { url, init } = openrouter.buildValidateRequest({ apiKey: 'sk-secret' });
    expect(url).toBe('https://openrouter.ai/api/v1/models');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-secret');
    expect(url).not.toContain('sk-secret');
  });
});

describe('openai-compatible: model catalogue', () => {
  it('has OpenRouter prefer the readable name over the id', () => {
    expect(openrouter.modelCatalog!.parse({
      data: [{ id: 'anthropic/claude-sonnet-4.5', name: 'Anthropic: Claude Sonnet 4.5' }],
    })).toEqual([{ id: 'anthropic/claude-sonnet-4.5', label: 'Anthropic: Claude Sonnet 4.5' }]);
  });

  it('has OpenRouter drop a model that produces no text', () => {
    const parsed = openrouter.modelCatalog!.parse({
      data: [
        { id: 'un/modele-image', architecture: { output_modalities: ['image'] } },
        { id: 'un/modele-texte', architecture: { output_modalities: ['text'] } },
        { id: 'un/modele-sans-metadonnee' },
      ],
    });
    // The model with no metadata is kept: missing data must not make a valid
    // model disappear from the list.
    expect(parsed.map((m) => m.id)).toEqual(['un/modele-texte', 'un/modele-sans-metadonnee']);
  });

  it('has OpenAI drop what cannot chat', () => {
    const parsed = openai.modelCatalog!.parse({
      data: [
        { id: 'gpt-4o-mini' }, { id: 'o3-mini' }, { id: 'chatgpt-4o-latest' },
        { id: 'text-embedding-3-large' }, { id: 'whisper-1' }, { id: 'dall-e-3' },
        { id: 'tts-1' }, { id: 'gpt-4o-realtime-preview' }, { id: 'omni-moderation-latest' },
        { id: 'davinci-002' },
      ],
    });
    expect(parsed.map((m) => m.id)).toEqual(['gpt-4o-mini', 'o3-mini', 'chatgpt-4o-latest']);
  });

  it('has DeepSeek filter nothing: its list is already entirely conversational', () => {
    expect(deepseek.modelCatalog!.parse({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }))
      .toEqual([{ id: 'deepseek-chat', label: 'deepseek-chat' }, { id: 'deepseek-reasoner', label: 'deepseek-reasoner' }]);
  });

  it('returns an empty list rather than throwing on an unexpected response', () => {
    expect(openrouter.modelCatalog!.parse({})).toEqual([]);
    expect(openrouter.modelCatalog!.parse(null)).toEqual([]);
    expect(openrouter.modelCatalog!.parse({ data: [{ id: null }] })).toEqual([]);
  });
});

describe('effort de raisonnement — OpenRouter (reasoning.effort)', () => {
  const req = { model: 'anthropic/claude-sonnet-4.5', turns: [{ role: 'user' as const, text: 'salut' }] };
  const cfg = { apiKey: 'sk-secret' };

  it('absent: the body carries the request and nothing else', () => {
    const { init } = openrouter.buildChatRequest(req, cfg);
    // A relayed Anthropic model carries a prompt-cache breakpoint, hence the
    // block form (see lib/llm/cache-anchors.ts). The effort setting adds nothing
    // on top of it: the comparison stays byte-exact.
    expect(init.body).toBe(JSON.stringify({
      model: req.model,
      stream: true,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: 'salut', cache_control: { type: 'ephemeral' } }],
      }],
    }));
  });

  it("'default': same guarantee — complete omission, not a field sent with the value 'default'", () => {
    const { init } = openrouter.buildChatRequest({ ...req, effort: 'default' }, cfg);
    const body = JSON.parse(init.body as string);
    expect(body.reasoning).toBeUndefined();
    expect('reasoning' in body).toBe(false);
  });

  it.each([
    ['minimal', 'minimal'],
    ['low', 'low'],
    ['medium', 'medium'],
    ['high', 'high'],
  ] as const)('%s → reasoning.effort = %s', (effort, expected) => {
    const { init } = openrouter.buildChatRequest({ ...req, effort }, cfg);
    const body = JSON.parse(init.body as string);
    expect(body.reasoning).toEqual({ effort: expected });
  });
});

describe("effort de raisonnement — openai/custom : omis sans condition", () => {
  const req = { model: 'gpt-4o-mini', turns: [{ role: 'user' as const, text: 'salut' }] };
  const cfg = { apiKey: 'sk-secret' };

  it.each(['minimal', 'low', 'medium', 'high'] as const)(
    'openai: %s adds nothing to the body (reasoning_effort cannot be confirmed without risking a 400 on the default model)',
    (effort) => {
      const { init } = openai.buildChatRequest({ ...req, effort }, cfg);
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({ model: 'gpt-4o-mini', stream: true, messages: [{ role: 'user', content: 'salut' }] });
    },
  );

  it.each(['minimal', 'low', 'medium', 'high'] as const)(
    'custom: %s adds nothing to the body (arbitrary endpoint, nothing documented)',
    (effort) => {
      const { init } = custom.buildChatRequest(
        { model: 'un-modele', turns: req.turns, effort }, { apiKey: 'k', baseUrl: 'https://my-proxy.example/v1' },
      );
      const body = JSON.parse(init.body as string);
      expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'stream']);
    },
  );
});

describe('OpenRouter — capabilities and turning off', () => {
  const req = { model: 'anthropic/claude-sonnet-4.5', turns: [{ role: 'user' as const, text: 'salut' }] };
  const cfg = { apiKey: 'sk-secret' };

  it('offers all 7 levels for any model: OpenRouter normalises and downgrades itself', () => {
    expect(openrouter.effortsFor?.('anthropic/claude-sonnet-4.5')).toEqual({
      levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      // The list is the PROVIDER's, not the model's: it applies to any relayed
      // id, including a model that does not reason. The interface must say so
      // (see describeEffortLevels).
      scope: 'provider',
    });
    expect(openrouter.effortsFor?.('un/modele-jamais-vu')?.levels).toHaveLength(7);
  });

  it("sends enabled:false for 'off', measured faster than effort:'none' (17.4 s against 22.8 s)", () => {
    const { init } = openrouter.buildChatRequest({ ...req, effort: 'off' }, cfg);
    const body = JSON.parse(String(init.body));
    expect(body.reasoning).toEqual({ enabled: false });
  });

  it.each(['xhigh', 'max'] as const)('%s passe en reasoning.effort', (effort) => {
    const { init } = openrouter.buildChatRequest({ ...req, effort }, cfg);
    expect(JSON.parse(String(init.body)).reasoning).toEqual({ effort });
  });
});

describe('DeepSeek direct — per-model capabilities', () => {
  const req = { model: 'deepseek-v4-pro', turns: [{ role: 'user' as const, text: 'salut' }] };
  const cfg = { apiKey: 'sk-secret' };

  it.each([
    ['deepseek-v4-flash', ['low', 'high', 'max']],
    ['deepseek-v4-pro', ['high', 'max']],
  ] as const)('%s offre %j', (model, levels) => {
    expect(deepseek.effortsFor?.(model)).toEqual({ levels });
  });

  it("treats the default model as the alias of the mode WITHOUT reasoning: nothing to steer", () => {
    expect(deepseek.effortsFor?.('deepseek-chat')).toEqual({ levels: [], reason: 'unknown' });
  });

  it('sends an offered level as reasoning_effort at the root', () => {
    const { init } = deepseek.buildChatRequest(
      { model: 'deepseek-v4-pro', turns: req.turns, effort: 'max' }, cfg,
    );
    expect(JSON.parse(String(init.body)).reasoning_effort).toBe('max');
  });

  it("leaves the body untouched for 'default'", () => {
    const { init } = deepseek.buildChatRequest(
      { model: 'deepseek-v4-pro', turns: req.turns, effort: 'default' }, cfg,
    );
    expect('reasoning_effort' in JSON.parse(String(init.body))).toBe(false);
  });
});

describe('openai / custom — no declared capability', () => {
  it("has openai not implement effortsFor: absence says we do not know", () => {
    expect(openai.effortsFor).toBeUndefined();
  });

  it("custom non plus : une URL arbitraire n'a pas de catalogue connu", () => {
    expect(custom.effortsFor).toBeUndefined();
  });
});

// The contract: for 'default', AND FOR ANY MODEL WITH NO DECLARED CAPABILITY,
// the body each provider produces is identical to the pre-feature one. The first
// half was covered, the second was not — the encoder wrote reasoning_effort
// without ever consulting effortsFor.
//
// Note the precise claim: this is no longer true of EVERY DeepSeek model, since
// v4-flash and v4-pro do wire reasoning_effort. It is true of any model this
// provider declares no capability for — its DEFAULT model first among them.
describe('boundary: an undeclared level never crosses the encoder', () => {
  const turns = [{ role: 'user' as const, text: 'salut' }];
  const cfg = { apiKey: 'sk-secret' };
  const nu = (model: string) => JSON.stringify({
    model, stream: true, messages: [{ role: 'user', content: 'salut' }],
  });

  it.each(EFFORT_SCALE)(
    'deepseek-chat (no declared capability): %s leaves the body byte-identical',
    (effort) => {
      const { init } = deepseek.buildChatRequest({ model: 'deepseek-chat', turns, effort }, cfg);
      expect(init.body).toBe(nu('deepseek-chat'));
    },
  );

  it.each(EFFORT_SCALE)(
    'a hand-typed DeepSeek id, outside the table: %s does not go out either',
    (effort) => {
      const { init } = deepseek.buildChatRequest({ model: 'deepseek-reasoner', turns, effort }, cfg);
      expect(init.body).toBe(nu('deepseek-reasoner'));
    },
  );

  it("drops 'xhigh' to 'high' on deepseek-v4-pro (high, max): never climb the scale, even to a declared level", () => {
    const { init } = deepseek.buildChatRequest({ model: 'deepseek-v4-pro', turns, effort: 'xhigh' }, cfg);
    expect(JSON.parse(String(init.body)).reasoning_effort).toBe('high');
  });

  it("sends nothing for 'off' on deepseek-v4-pro: nothing sits below it, and DeepSeek has no switch", () => {
    const { init } = deepseek.buildChatRequest({ model: 'deepseek-v4-pro', turns, effort: 'off' }, cfg);
    expect(init.body).toBe(nu('deepseek-v4-pro'));
  });

  it.each(EFFORT_SCALE)(
    'OpenRouter declares all 7 levels for any model: %s does cross the boundary',
    (effort) => {
      const { init } = openrouter.buildChatRequest({ model: 'un/modele-jamais-vu', turns, effort }, cfg);
      expect(JSON.parse(String(init.body)).reasoning)
        .toEqual(effort === 'off' ? { enabled: false } : { effort });
    },
  );
});

describe('openai-compatible : instances', () => {
  it('gives openrouter the right default', () => {
    expect(openrouter.defaultBaseUrl).toBe('https://openrouter.ai/api/v1');
    expect(openrouter.defaultModel).toBe('anthropic/claude-sonnet-4.5');
  });
  it('openai pointe sur api.openai.com', () => {
    expect(openai.defaultBaseUrl).toBe('https://api.openai.com/v1');
  });
  it('deepseek pointe sur api.deepseek.com', () => {
    expect(deepseek.defaultBaseUrl).toBe('https://api.deepseek.com/v1');
  });
  it('les quatre ids sont distincts', () => {
    expect(new Set([openrouter.id, openai.id, deepseek.id, custom.id]).size).toBe(4);
  });
});

describe('openai-compatible: prompt cache', () => {
  const cfg = { apiKey: 'k' };
  const conversation = [
    { role: 'user' as const, text: 'transcript' },
    { role: 'assistant' as const, text: 'summary' },
    { role: 'user' as const, text: 'question' },
  ];
  const messagesOf = (init: RequestInit) => JSON.parse(init.body as string).messages;
  const contents = (init: RequestInit) => messagesOf(init).map((m: { content: unknown }) => m.content);

  it('marks the transcript turn and the question for a relayed Anthropic model', () => {
    const { init } = openrouter.buildChatRequest({ model: 'anthropic/claude-sonnet-4.5', turns: conversation }, cfg);
    const messages = messagesOf(init);
    expect(messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(messages[1].content).toBe('summary');
    expect(messages[2].content[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('marks a relayed Google model too', () => {
    const { init } = openrouter.buildChatRequest({ model: 'google/gemini-2.5-flash', turns: conversation }, cfg);
    expect(messagesOf(init)[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('sends nothing extra for a relayed model whose cache is automatic', () => {
    const { init } = openrouter.buildChatRequest({ model: 'openai/gpt-4o-mini', turns: conversation }, cfg);
    expect(contents(init)).toEqual(['transcript', 'summary', 'question']);
  });

  it.each([
    ['openai', openai, 'gpt-4o-mini'],
    ['deepseek', deepseek, 'deepseek-chat'],
    ['custom', custom, 'whatever'],
  ] as const)('%s never sends a content-part array', (_label, provider, model) => {
    // Their prefix cache is automatic, and an arbitrary endpoint is not
    // guaranteed to accept the array form where a string is expected.
    const { init } = provider.buildChatRequest({ model, turns: conversation }, cfg);
    expect(contents(init)).toEqual(['transcript', 'summary', 'question']);
  });
});
