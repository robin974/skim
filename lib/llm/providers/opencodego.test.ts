import { describe, it, expect } from 'vitest';
import { opencodego, wireFor, UNAVAILABLE, EFFORTS, OFF_TRANSPORTS } from './opencodego';
import { EFFORT_SCALE } from '../types';

const cfg = { apiKey: 'sk-secret' };
const turns = [{ role: 'user' as const, text: 'salut' }];

const bodyOf = (init: RequestInit) => JSON.parse(init.body as string);
const headersOf = (init: RequestInit) => init.headers as Record<string, string>;

describe('opencode-go: protocol routing', () => {
  it('routes a model absent from the table to /chat/completions', () => {
    // The default bet: 17 of the 24 published models are there, and it is where
    // anything OpenCode adds after this table lands.
    expect(wireFor('un-modele-inconnu')).toBe('chat');
    const { url } = opencodego.buildChatRequest({ model: 'un-modele-inconnu', turns }, cfg);
    expect(url).toBe('https://opencode.ai/zen/go/v1/chat/completions');
  });

  it('kimi-k3 est servi en /chat/completions', () => {
    const { url } = opencodego.buildChatRequest({ model: 'kimi-k3', turns }, cfg);
    expect(url).toBe('https://opencode.ai/zen/go/v1/chat/completions');
  });

  it('qwen3.8-max est servi en /messages (protocole Anthropic)', () => {
    const { url, init } = opencodego.buildChatRequest({ model: 'qwen3.8-max', turns }, cfg);
    expect(url).toBe('https://opencode.ai/zen/go/v1/messages');
    // max_tokens is mandatory on this protocol: without it, a 400.
    expect(bodyOf(init).max_tokens).toBe(4096);
    expect(headersOf(init)['anthropic-version']).toBe('2023-06-01');
  });

  it('grok-4.5 est servi en /responses', () => {
    const { url, init } = opencodego.buildChatRequest({ model: 'grok-4.5', turns }, cfg);
    expect(url).toBe('https://opencode.ai/zen/go/v1/responses');
    expect(bodyOf(init).input[0].content[0].type).toBe('input_text');
  });

  it('turns an assistant turn into output_text on /responses', () => {
    // Follow-up questions resend the history, and an assistant turn labelled
    // input_text is refused by the Responses API.
    const { init } = opencodego.buildChatRequest(
      { model: 'gpt-5.6-luna', turns: [{ role: 'assistant', text: 'réponse' }] }, cfg,
    );
    expect(bodyOf(init).input[0].content[0].type).toBe('output_text');
  });

  it('les trois protocoles demandent le streaming', () => {
    for (const model of ['kimi-k3', 'qwen3.8-max', 'grok-4.5']) {
      const { init } = opencodego.buildChatRequest({ model, turns }, cfg);
      expect(bodyOf(init).stream, model).toBe(true);
    }
  });

  it('sends the key in a header, never in the URL, on all three protocols', () => {
    for (const model of ['kimi-k3', 'qwen3.8-max', 'grok-4.5']) {
      const { url, init } = opencodego.buildChatRequest({ model, turns }, cfg);
      expect(url, model).not.toContain('sk-secret');
      expect(headersOf(init).Authorization, model).toBe('Bearer sk-secret');
    }
  });

  it('sends x-api-key TOO on the Anthropic path', () => {
    // The gateway expects an OpenCode key, but this path speaks Anthropic: no
    // bet is placed on which authentication form it reads.
    const { init } = opencodego.buildChatRequest({ model: 'minimax-m2.5', turns }, cfg);
    expect(headersOf(init)['x-api-key']).toBe('sk-secret');
  });
});

describe('OpenCode Go — per-model levels', () => {
  it.each([
    ['deepseek-v4-flash', ['minimal', 'low', 'medium', 'high', 'xhigh']],
    ['deepseek-v4-pro', ['off', 'high', 'max']],
    ['glm-5.2', ['off', 'minimal', 'low', 'medium', 'high', 'max']],
    ['kimi-k3', ['off', 'low', 'high', 'max']],
    ['mimo-v2.5', ['off', 'low', 'medium', 'high']],
    ['gpt-5.6-luna', ['low', 'medium', 'high', 'xhigh', 'max']],
  ] as const)('%s offre %j', (model, levels) => {
    expect(opencodego.effortsFor?.(model)).toEqual({ levels });
  });

  it('offers nothing for a model absent from the table rather than guessing', () => {
    expect(opencodego.effortsFor?.('modele-tout-neuf')).toEqual({ levels: [], reason: 'unknown' });
  });

  it("keeps the 4 models served over the Anthropic protocol out of the table: their effort transport is not established", () => {
    for (const model of ['minimax-m2.5', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.8-max']) {
      expect(opencodego.effortsFor?.(model)?.levels).toEqual([]);
    }
  });

  it('lists no unavailable model in the table', () => {
    for (const model of UNAVAILABLE) expect(EFFORTS[model]).toBeUndefined();
  });

  it("declares 'off' ONLY for the families measured as able to turn off", () => {
    // Kimi, MiMo, MiniMax, Qwen and DeepSeek on /chat/completions: measured
    // silent with `thinking:{type:'disabled'}`. GLM and Hunyuan: measured silent
    // with `reasoning_effort:'none'` by the second campaign, which tried the
    // transports the first had not — see the EFFORTS comment.
    const off = [
      'deepseek-v4-pro', 'kimi-k2.5', 'kimi-k2.6', 'kimi-k2.7-code', 'kimi-k3',
      'mimo-v2.5', 'mimo-v2.5-pro', 'minimax-m2.7', 'minimax-m3', 'qwen3.5-plus', 'qwen3.6-plus',
      'glm-5', 'glm-5.1', 'glm-5.2', 'hy3',
    ];
    for (const model of off) expect(EFFORTS[model], model).toContain('off');

    // grok-4.5: all four transports tried are refused with a 400.
    // deepseek-v4-flash and gpt-5.6-luna (/responses): no reasoning in the
    // stream even at the default, so nothing whose extinction is demonstrable.
    const sans = ['deepseek-v4-flash', 'gpt-5.6-luna', 'grok-4.5'];
    for (const model of sans) expect(EFFORTS[model], model).not.toContain('off');

    // The two lists cover the table exactly: nothing is forgotten.
    expect([...off, ...sans].sort()).toEqual(Object.keys(EFFORTS).sort());
  });

  // Two tables, one fact: "this model can turn off". If one moved without the
  // other, an 'off' level offered by the interface would go out with the majority
  // transport — for a family deaf to `thinking`, a parameter with no effect,
  // displayed as off while the model reasons.
  it("gives every model declaring 'off' a measured turn-off transport, and vice versa", () => {
    const declarent = Object.entries(EFFORTS)
      .filter(([, levels]) => levels.includes('off'))
      .map(([model]) => model);

    expect(declarent.sort()).toEqual(Object.keys(OFF_TRANSPORTS).sort());
  });

  // The invariant disableBody rests on: the measured turn-off transport,
  // `thinking: { type: 'disabled' }`, is a /chat/completions field, and only
  // chatBody writes it. The day a model declaring 'off' moved to another
  // protocol — exactly what already happened to deepseek-v4-flash, rerouted to
  // /responses — 'off' would SILENTLY stop carrying anything.
  it("serves every model declaring 'off' on /chat/completions, the only protocol where the transport exists", () => {
    for (const [model, levels] of Object.entries(EFFORTS)) {
      if (levels.includes('off')) expect(wireFor(model), model).toBe('chat');
    }
  });
});

// A level THIS provider does not declare for THIS model does not cross the
// network boundary. The gateway validates nothing (measured — see EFFORTS): it
// would accept any level without saying so, which is why the table is the guard
// here and nowhere else.
describe('boundary: an undeclared level never crosses the encoder', () => {
  it.each(EFFORT_SCALE)(
    'a model outside the table: %s leaves the body byte-identical',
    (effort) => {
      const sans = opencodego.buildChatRequest({ model: 'modele-tout-neuf', turns }, cfg);
      const avec = opencodego.buildChatRequest({ model: 'modele-tout-neuf', turns, effort }, cfg);
      expect(String(avec.init.body)).toBe(String(sans.init.body));
    },
  );

  // The transport depends on the family, not the protocol: GLM and Hunyuan are
  // served on /chat/completions like deepseek-v4-pro, yet `thinking` does not
  // turn them off — measured (see EFFORTS, second campaign). Sending the
  // majority transport here would display off while the model reasons: the bug
  // these two tests lock down.
  it("sends 'off' as reasoning_effort:'none' for GLM and Hunyuan, never as thinking", () => {
    for (const model of ['glm-5', 'glm-5.1', 'glm-5.2', 'hy3']) {
      const body = bodyOf(opencodego.buildChatRequest({ model, turns, effort: 'off' }, cfg).init);
      expect(body.reasoning_effort, model).toBe('none');
      expect(body.thinking, model).toBeUndefined();
    }
  });

  it("makes 'off' produce a body genuinely different from 'default' on GLM, so the 400 fallback changes something", () => {
    const off = opencodego.buildChatRequest({ model: 'glm-5.2', turns, effort: 'off' }, cfg);
    const dflt = opencodego.buildChatRequest({ model: 'glm-5.2', turns }, cfg);
    expect(String(off.init.body)).not.toBe(String(dflt.init.body));
    expect(bodyOf(dflt.init).reasoning_effort).toBeUndefined();
  });

  it("keeps 'minimal' as 'minimal' on a GLM model: 'off' opened the scale, it did not replace it", () => {
    const body = bodyOf(opencodego.buildChatRequest({ model: 'glm-5.2', turns, effort: 'minimal' }, cfg).init);
    expect(body.reasoning_effort).toBe('minimal');
    expect(body.thinking).toBeUndefined();
  });

  it("drops 'medium' to 'off' on deepseek-v4-pro (off, high, max), never 'medium' on the wire", () => {
    const body = bodyOf(opencodego.buildChatRequest({ model: 'deepseek-v4-pro', turns, effort: 'medium' }, cfg).init);
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it("caps deepseek-v4-flash at 'xhigh' on /responses: 'max' drops instead of going out as is", () => {
    const body = bodyOf(opencodego.buildChatRequest({ model: 'deepseek-v4-flash', turns, effort: 'max' }, cfg).init);
    expect(body.reasoning).toEqual({ effort: 'xhigh' });
  });

  it("never sends 'off' on /responses: the model does not declare it, and thinking does not exist there", () => {
    const off = opencodego.buildChatRequest({ model: 'deepseek-v4-flash', turns, effort: 'off' }, cfg);
    const sans = opencodego.buildChatRequest({ model: 'deepseek-v4-flash', turns }, cfg);
    expect(String(off.init.body)).toBe(String(sans.init.body));
  });
});

describe('OpenCode Go — the level goes out on the right protocol', () => {
  it('puts reasoning_effort at the root on /chat/completions', () => {
    const { url, init } = opencodego.buildChatRequest({ model: 'glm-5.2', turns, effort: 'max' }, cfg);
    expect(url).toContain('/chat/completions');
    expect(JSON.parse(String(init.body)).reasoning_effort).toBe('max');
  });

  it('nests reasoning.effort on /responses', () => {
    const { url, init } = opencodego.buildChatRequest(
      { model: 'deepseek-v4-flash', turns, effort: 'xhigh' }, cfg,
    );
    expect(url).toContain('/responses');
    expect(JSON.parse(String(init.body)).reasoning).toEqual({ effort: 'xhigh' });
  });

  it.each(['glm-5.2', 'deepseek-v4-flash', 'minimax-m2.5'])(
    "%s : 'default' laisse le corps identique à l'octet près", (model) => {
      const sans = opencodego.buildChatRequest({ model, turns }, cfg);
      const avec = opencodego.buildChatRequest({ model, turns, effort: 'default' }, cfg);
      expect(String(avec.init.body)).toBe(String(sans.init.body));
    },
  );

  it("carries 'off' as thinking:{type:'disabled'}, never reasoning_effort:'off'", () => {
    const body = bodyOf(opencodego.buildChatRequest({ model: 'deepseek-v4-pro', turns, effort: 'off' }, cfg).init);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("returns to a body identical to 'default' once 'off' is removed, so the 400 fallback would resend a genuinely different body", () => {
    const off = opencodego.buildChatRequest({ model: 'deepseek-v4-pro', turns, effort: 'off' }, cfg);
    const dflt = opencodego.buildChatRequest({ model: 'deepseek-v4-pro', turns, effort: 'default' }, cfg);
    expect(String(off.init.body)).not.toBe(String(dflt.init.body));
    expect(bodyOf(dflt.init).thinking).toBeUndefined();
  });
});

describe('reasoning effort — /messages: omitted unconditionally, transport not established', () => {
  // /chat/completions and /responses wire a real level (see the EFFORTS table).
  // /messages stays out of the table: the 4 models served there can receive no
  // level at all.
  it.each(['minimal', 'low', 'medium', 'high'] as const)('%s adds nothing to the body on /messages', (effort) => {
    const body = bodyOf(opencodego.buildChatRequest({ model: 'qwen3.8-max', turns, effort }, cfg).init);
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'stream']);
  });
});

describe('opencode-go : parseChunk couvre les trois formats', () => {
  it('lit un delta /chat/completions', () => {
    expect(opencodego.parseChunk(JSON.stringify({ choices: [{ delta: { content: 'Bon' } }] }))).toBe('Bon');
  });

  it('lit un content_block_delta Anthropic', () => {
    expect(opencodego.parseChunk(JSON.stringify({
      type: 'content_block_delta', delta: { type: 'text_delta', text: 'jour' },
    }))).toBe('jour');
  });

  it('lit un response.output_text.delta', () => {
    expect(opencodego.parseChunk(JSON.stringify({
      type: 'response.output_text.delta', delta: ' !',
    }))).toBe(' !');
  });

  it('ignore un bloc de raisonnement Anthropic (pas de champ text)', () => {
    expect(opencodego.parseChunk(JSON.stringify({
      type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' },
    }))).toBeNull();
  });

  it('ignores stream events with no text', () => {
    expect(opencodego.parseChunk(JSON.stringify({ type: 'response.created' }))).toBeNull();
    expect(opencodego.parseChunk(JSON.stringify({ type: 'message_start' }))).toBeNull();
    expect(opencodego.parseChunk(JSON.stringify({ choices: [{ delta: {} }] }))).toBeNull();
  });

  it('renvoie null sur du JSON invalide', () => {
    expect(opencodego.parseChunk('{not json')).toBeNull();
  });
});

describe('opencode-go: classifyStatus', () => {
  it('maps 429 to a quota overrun', () => expect(opencodego.classifyStatus(429)).toBe('quota'));
  it('maps 402 the same way: the Go subscription caps are in usage dollars', () => {
    expect(opencodego.classifyStatus(402)).toBe('quota');
  });
  it('maps 401 to an invalid key', () => expect(opencodego.classifyStatus(401)).toBe('invalid-key'));
  it('maps 403 to an invalid key', () => expect(opencodego.classifyStatus(403)).toBe('invalid-key'));
  it('maps 503 to overloaded', () => expect(opencodego.classifyStatus(503)).toBe('overloaded'));
  it('maps 529 to overloaded', () => expect(opencodego.classifyStatus(529)).toBe('overloaded'));
  it('does NOT blame the key on a 400: that is the code for a misrouted model', () => {
    expect(opencodego.classifyStatus(400)).toBe('unknown');
  });
});

describe('opencode-go: key validation', () => {
  it('probes /usage, not /models: /models is public and would validate anything', () => {
    const { url, init } = opencodego.buildValidateRequest(cfg);
    expect(url).toBe('https://opencode.ai/zen/go/v1/usage');
    expect(headersOf(init).Authorization).toBe('Bearer sk-secret');
    expect(url).not.toContain('sk-secret');
  });
});

describe('opencode-go: model catalogue', () => {
  const parse = (json: unknown) => opencodego.modelCatalog!.parse(json);

  it('extracts the ids and gives them a readable label', () => {
    expect(parse({ data: [{ id: 'kimi-k3' }, { id: 'mimo-v2.5-pro' }] })).toEqual([
      { id: 'kimi-k3', label: 'Kimi K3' },
      { id: 'mimo-v2.5-pro', label: 'MiMo-V2.5-Pro' },
    ]);
  });

  it('keeps a model unknown to the label table, under its id', () => {
    expect(parse({ data: [{ id: 'modele-de-demain' }] }))
      .toEqual([{ id: 'modele-de-demain', label: 'modele-de-demain' }]);
  });

  it('removes the models the gateway announces without serving', () => {
    // Measured as 400 on all three protocols — see UNAVAILABLE.
    const parsed = parse({
      data: [{ id: 'kimi-k3' }, { id: 'mimo-v2-pro' }, { id: 'mimo-v2-omni' }, { id: 'hy3-preview' }],
    });
    expect(parsed.map((m) => m.id)).toEqual(['kimi-k3']);
  });

  it('returns an empty list rather than throwing on an unexpected response', () => {
    expect(parse({})).toEqual([]);
    expect(parse(null)).toEqual([]);
    expect(parse({ data: 'pas un tableau' })).toEqual([]);
    expect(parse({ data: [{}, { id: 42 }] })).toEqual([]);
  });
});

describe('opencode-go: identity', () => {
  it('serves the default model over the safest protocol', () => {
    expect(opencodego.defaultModel).toBe('deepseek-v4-pro');
    expect(wireFor(opencodego.defaultModel)).toBe('chat');
  });
  it('points the base URL at the Go gateway', () => {
    expect(opencodego.defaultBaseUrl).toBe('https://opencode.ai/zen/go/v1');
  });
});

describe('opencode-go: prompt cache', () => {
  const conversation = [
    { role: 'user' as const, text: 'transcript' },
    { role: 'assistant' as const, text: 'summary' },
    { role: 'user' as const, text: 'question' },
  ];

  it('marks the transcript turn and the question on /messages', () => {
    const { init } = opencodego.buildChatRequest({ model: 'qwen3.8-max', turns: conversation }, cfg);
    const messages = bodyOf(init).messages;
    expect(messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(messages[1].content).toBe('summary');
    expect(messages[2].content[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('sends bare strings on the two OpenAI protocols, whose cache is automatic', () => {
    const chat = bodyOf(opencodego.buildChatRequest({ model: 'kimi-k3', turns: conversation }, cfg).init);
    expect(chat.messages.map((m: { content: unknown }) => m.content))
      .toEqual(['transcript', 'summary', 'question']);
  });
});
