import { describe, it, expect } from 'vitest';
import { gemini, classifyStatus } from './gemini';

describe('gemini : classifyStatus', () => {
  it('maps 429 to a quota overrun', () => expect(classifyStatus(429)).toBe('quota'));
  it('maps 503 to overloaded', () => expect(classifyStatus(503)).toBe('overloaded'));
  it('maps 500 to a recoverable overload', () => expect(classifyStatus(500)).toBe('overloaded'));
  it('maps 400 to an invalid key', () => expect(classifyStatus(400)).toBe('invalid-key'));
  it('maps 403 to an invalid key', () => expect(classifyStatus(403)).toBe('invalid-key'));
  it('418 est inconnu', () => expect(classifyStatus(418)).toBe('unknown'));
});

describe('gemini : buildChatRequest', () => {
  it('sends the turns as text parts', () => {
    const { init } = gemini.buildChatRequest(
      { model: 'gemini-3.6-flash', turns: [{ role: 'user', text: 'mon prompt' }] },
      { apiKey: 'k' },
    );
    const body = JSON.parse(init.body as string);
    expect(body.contents[0].parts).toEqual([{ text: 'mon prompt' }]);
  });

  it('sets no generationConfig when no effort applies', () => {
    const { init } = gemini.buildChatRequest(
      { model: 'gemini-3.6-flash', turns: [{ role: 'user', text: 'x' }] },
      { apiKey: 'k' },
    );
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig).toBeUndefined();
  });

  it('converts the assistant role into model', () => {
    const { init } = gemini.buildChatRequest(
      {
        model: 'gemini-3.6-flash',
        turns: [
          { role: 'user', text: 'question' },
          { role: 'assistant', text: 'réponse précédente' },
        ],
      },
      { apiKey: 'k' },
    );
    const body = JSON.parse(init.body as string);
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[1].role).toBe('model');
  });

  it('puts the key in the query string, a Gemini exception', () => {
    const { url } = gemini.buildChatRequest(
      { model: 'gemini-3.6-flash', turns: [{ role: 'user', text: 'x' }] },
      { apiKey: 'SECRET' },
    );
    expect(url).toContain('key=SECRET');
  });

  it('falls back to the default on an empty baseUrl: a cleared field must not send a relative URL', () => {
    const { url } = gemini.buildChatRequest(
      { model: 'gemini-3.6-flash', turns: [{ role: 'user', text: 'x' }] },
      { apiKey: 'k', baseUrl: '' },
    );
    expect(url).toContain('https://generativelanguage.googleapis.com/v1beta');
  });
});

describe('reasoning effort — thinkingConfig.thinkingLevel, generation 3 only', () => {
  const turns = [{ role: 'user' as const, text: 'mon prompt' }];
  const cfg = { apiKey: 'k' };

  it('absent: the body is byte-identical to before this setting existed', () => {
    const { init } = gemini.buildChatRequest({ model: 'gemini-3.6-flash', turns }, cfg);
    expect(init.body).toBe(JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'mon prompt' }] }] }));
  });

  it("'default': same guarantee, no generationConfig at all", () => {
    const { init } = gemini.buildChatRequest({ model: 'gemini-3.6-flash', turns, effort: 'default' }, cfg);
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig).toBeUndefined();
  });

  it.each([
    ['minimal', 'minimal'],
    ['low', 'low'],
    ['medium', 'medium'],
    ['high', 'high'],
  ] as const)('gemini-3.6-flash, %s → thinkingConfig.thinkingLevel = %s', (effort, expected) => {
    const { init } = gemini.buildChatRequest({ model: 'gemini-3.6-flash', turns, effort }, cfg);
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig).toEqual({ thinkingConfig: { thinkingLevel: expected } });
  });

  // 'off' is the project-wide default (DEFAULT_EFFORT, lib/settings.ts), and
  // Gemini declares it in NEITHER of its two tables. Nothing sits below 'off' on
  // the scale, so clampEffort omits and the body stays as it was before this
  // setting existed, whatever the model.
  it("'off' on a Flash: no thinkingConfig, since Gemini does not declare it", () => {
    const { init } = gemini.buildChatRequest({ model: 'gemini-3.6-flash', turns, effort: 'off' }, cfg);
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig).toBeUndefined();
  });

  it("'off' on a Pro: no thinkingConfig, for the same reason", () => {
    const { init } = gemini.buildChatRequest({ model: 'gemini-3-pro-preview', turns, effort: 'off' }, cfg);
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig).toBeUndefined();
  });

  it("gives a Gemini 2.5 model no thinkingConfig: no documented qualitative scale there, only a token budget", () => {
    const { init } = gemini.buildChatRequest({ model: 'gemini-2.5-flash', turns, effort: 'high' }, cfg);
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig).toBeUndefined();
  });

  it("gives a Gemini 2.0 model no thinkingConfig", () => {
    const { init } = gemini.buildChatRequest({ model: 'gemini-2.0-flash', turns, effort: 'high' }, cfg);
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig).toBeUndefined();
  });

});

describe('Gemini — the Pro/Flash guard: Pro knows only low and high', () => {
  it.each(['gemini-3-pro-preview', 'gemini-3.1-pro-preview'])('%s: low and high only', (model) => {
    expect(gemini.effortsFor?.(model)).toEqual({ levels: ['low', 'high'] });
  });

  it.each(['gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite'])(
    '%s: all four levels', (model) => {
      expect(gemini.effortsFor?.(model)).toEqual({ levels: ['minimal', 'low', 'medium', 'high'] });
    },
  );

  it('offers nothing for a model older than generation 3', () => {
    expect(gemini.effortsFor?.('gemini-2.5-flash')).toEqual({ levels: [], reason: 'unknown' });
  });

  it("never lets 'minimal' reach a Pro: nothing below low, so nothing is sent", () => {
    const { init } = gemini.buildChatRequest(
      { model: 'gemini-3-pro-preview', turns: [{ role: 'user', text: 'x' }], effort: 'minimal' },
      { apiKey: 'k' },
    );
    expect(JSON.parse(String(init.body)).generationConfig?.thinkingConfig).toBeUndefined();
  });

  it("does let 'high' reach a Pro", () => {
    const { init } = gemini.buildChatRequest(
      { model: 'gemini-3-pro-preview', turns: [{ role: 'user', text: 'x' }], effort: 'high' },
      { apiKey: 'k' },
    );
    expect(JSON.parse(String(init.body)).generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'high' });
  });
});

describe('gemini : parseChunk', () => {
  it('extracts the text from candidates/parts', () => {
    const payload = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Bon' }, { text: 'jour' }] } }] });
    expect(gemini.parseChunk(payload)).toBe('Bonjour');
  });

  it('returns null when there is no text', () => {
    expect(gemini.parseChunk(JSON.stringify({ candidates: [] }))).toBeNull();
  });

  it('returns null on invalid JSON', () => {
    expect(gemini.parseChunk('{not json')).toBeNull();
  });
});

describe('gemini: model catalogue', () => {
  it('asks for a page large enough not to truncate the list silently', () => {
    const { url } = gemini.modelCatalog!.buildRequest({ apiKey: 'k' });
    expect(url).toContain('pageSize=1000');
  });

  it('keeps only models supporting streamGenerateContent, without the models/ prefix', () => {
    const parsed = gemini.modelCatalog!.parse({
      models: [
        {
          name: 'models/gemini-3.6-flash', displayName: 'Gemini 3.6 Flash',
          supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
        },
        {
          name: 'models/text-embedding-004', displayName: 'Embedding 004',
          supportedGenerationMethods: ['embedContent'],
        },
        { name: 'models/gemini-tts', displayName: 'TTS', supportedGenerationMethods: ['generateContent'] },
      ],
    });
    expect(parsed).toEqual([{ id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' }]);
  });

  it('returns an empty list rather than throwing on an unexpected response', () => {
    expect(gemini.modelCatalog!.parse({})).toEqual([]);
    expect(gemini.modelCatalog!.parse(null)).toEqual([]);
  });
});
