import { describe, it, expect } from 'vitest';
import { anthropic } from './anthropic';

describe('anthropic: parseChunk', () => {
  it('keeps content_block_delta', () => {
    const payload = JSON.stringify({ type: 'content_block_delta', delta: { text: 'Hello' } });
    expect(anthropic.parseChunk(payload)).toBe('Hello');
  });

  it('ignores message_start', () => {
    const payload = JSON.stringify({ type: 'message_start', message: {} });
    expect(anthropic.parseChunk(payload)).toBeNull();
  });

  it('ignores content_block_stop', () => {
    const payload = JSON.stringify({ type: 'content_block_stop', index: 0 });
    expect(anthropic.parseChunk(payload)).toBeNull();
  });

  it('returns null on invalid JSON', () => {
    expect(anthropic.parseChunk('{not json')).toBeNull();
  });
});

describe('anthropic: buildChatRequest', () => {
  const req = { model: 'claude-sonnet-4-5', turns: [{ role: 'user' as const, text: 'hi' }] };
  const cfg = { apiKey: 'sk-ant-secret' };

  it('POSTs to {baseUrl}/v1/messages', () => {
    const { url, init } = anthropic.buildChatRequest(req, cfg);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
  });

  it('sends all three headers', () => {
    const { init } = anthropic.buildChatRequest(req, cfg);
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-secret');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });

  it('never puts the key in the URL', () => {
    const { url } = anthropic.buildChatRequest(req, cfg);
    expect(url).not.toContain('sk-ant-secret');
  });

  it('carries stream, max_tokens and the messages in the body', () => {
    const { init } = anthropic.buildChatRequest(req, cfg);
    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(4096);
    // The user turn carries a prompt-cache breakpoint, which requires the block
    // form (see lib/llm/cache-anchors.ts).
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }] },
    ]);
  });

  it('falls back to the default on an empty baseUrl: a cleared field must not send an empty URL', () => {
    const { url } = anthropic.buildChatRequest(req, { apiKey: 'sk-ant-secret', baseUrl: '' });
    expect(url).toBe('https://api.anthropic.com/v1/messages');
  });
});

describe('reasoning effort: omitted unconditionally — see the comment above the `anthropic` export', () => {
  it.each(['minimal', 'low', 'medium', 'high'] as const)(
    '%s adds nothing to the body, since the right parameter depends on the model generation',
    (effort) => {
      const req = { model: 'claude-sonnet-4-5', turns: [{ role: 'user' as const, text: 'hi' }], effort };
      const { init } = anthropic.buildChatRequest(req, { apiKey: 'sk-ant-secret' });
      const body = JSON.parse(init.body as string);
      expect('thinking' in body).toBe(false);
      expect('output_config' in body).toBe(false);
      expect(body).toEqual({
        model: 'claude-sonnet-4-5', stream: true, max_tokens: 4096,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }] }],
      });
    },
  );
});

describe('anthropic: classifyStatus', () => {
  it('maps 429 to a quota overrun', () => expect(anthropic.classifyStatus(429)).toBe('quota'));
  it("maps 529, Anthropic's own overload code, to overloaded", () => {
    expect(anthropic.classifyStatus(529)).toBe('overloaded');
  });
  it('maps 503 to overloaded', () => expect(anthropic.classifyStatus(503)).toBe('overloaded'));
  it('maps 401 to an invalid key', () => expect(anthropic.classifyStatus(401)).toBe('invalid-key'));
});

describe('anthropic: buildValidateRequest', () => {
  it('POSTs /v1/messages with max_tokens: 1', () => {
    const { url, init } = anthropic.buildValidateRequest({ apiKey: 'sk-ant-secret' });
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBe(1);
    expect(body.messages.length).toBeGreaterThan(0);
  });
});

describe('anthropic: model catalogue', () => {
  it('GETs /v1/models, authenticated, with no key in the URL', () => {
    const { url, init } = anthropic.modelCatalog!.buildRequest({ apiKey: 'sk-ant-secret' });
    expect(url).toBe('https://api.anthropic.com/v1/models?limit=1000');
    expect(url).not.toContain('sk-ant-secret');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-secret');
  });

  it('prefers display_name over the id', () => {
    expect(anthropic.modelCatalog!.parse({
      data: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' }, { id: 'claude-x' }],
    })).toEqual([
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      { id: 'claude-x', label: 'claude-x' },
    ]);
  });

  it('returns an empty list rather than throwing on an unexpected response', () => {
    expect(anthropic.modelCatalog!.parse({})).toEqual([]);
    expect(anthropic.modelCatalog!.parse(null)).toEqual([]);
  });
});

describe('anthropic: prompt cache', () => {
  const cfg = { apiKey: 'sk-ant-secret' };
  const bodyOf = (init: RequestInit) => JSON.parse(init.body as string);

  it('marks the transcript turn on a summary', () => {
    const req = { model: 'claude-sonnet-4-5', turns: [{ role: 'user' as const, text: 'transcript' }] };
    const { init } = anthropic.buildChatRequest(req, cfg);
    expect(bodyOf(init).messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'transcript', cache_control: { type: 'ephemeral' } }] },
    ]);
  });

  it('marks the transcript turn and the question, never the summary between them', () => {
    // This is the request every follow-up sends: without the two markers the
    // transcript is billed at full price again on each question.
    const req = {
      model: 'claude-sonnet-4-5',
      turns: [
        { role: 'user' as const, text: 'transcript' },
        { role: 'assistant' as const, text: 'summary' },
        { role: 'user' as const, text: 'question' },
      ],
    };
    const messages = bodyOf(anthropic.buildChatRequest(req, cfg).init).messages;
    expect(messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(messages[1].content).toBe('summary');
    expect(messages[2].content[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});
