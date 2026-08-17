import { describe, it, expect, beforeEach, vi } from 'vitest';

const session: Record<string, any> = {};
const local: Record<string, any> = {};
// `get` accepts a single key OR an array, like the real
// chrome.storage.StorageArea.get: getConversation reads two keys — head and
// tail — in one call (see lib/conversations.ts).
const mk = (s: Record<string, any>) => ({
  // `null` returns the whole area, as listConversations reads it.
  get: async (k: string | string[] | null) => {
    if (k === null) return { ...s };
    if (Array.isArray(k)) {
      const r: Record<string, any> = {};
      for (const key of k) if (key in s) r[key] = s[key];
      return r;
    }
    return { [k]: s[k] };
  },
  set: async (o: any) => { Object.assign(s, o); },
  // A single key OR an array: deleteConversation removes its three keys at once.
  remove: async (k: string | string[]) => {
    for (const key of Array.isArray(k) ? k : [k]) delete s[key];
  },
});
vi.stubGlobal('chrome', { storage: { session: mk(session), local: mk(local) } });

const C = await import('./conversations');

describe('conversations', () => {
  beforeEach(() => {
    for (const k of Object.keys(session)) delete session[k];
    for (const k of Object.keys(local)) delete local[k];
  });

  it('returns null for an unknown video', async () => {
    expect(await C.getConversation('nope')).toBeNull();
  });

  it('reads back a stored conversation', async () => {
    await C.saveConversation({ videoId: 'a', meta: null, status: 'done', provenance: null,
      turns: [{ role: 'assistant', text: 'résumé' }] });
    const c = await C.getConversation('a');
    expect(c?.turns).toHaveLength(1);
    expect(c?.status).toBe('done');
  });

  it('isolates conversations per video', async () => {
    await C.saveConversation({
      videoId: 'a', meta: null, status: 'done', provenance: null,
      turns: [{ role: 'assistant', text: 'A' }],
    });
    await C.saveConversation({
      videoId: 'b', meta: null, status: 'done', provenance: null,
      turns: [{ role: 'assistant', text: 'B' }],
    });
    expect((await C.getConversation('a'))?.turns[0]?.text).toBe('A');
    expect((await C.getConversation('b'))?.turns[0]?.text).toBe('B');
  });

  // Conversations live in chrome.storage.session and die with the browser, so
  // nothing else records what produced a summary. Without this round trip the
  // panel would redisplay a summary with no provenance line under it.
  describe('provenance: date, provider, model', () => {
    const provenance = {
      producedAt: 5000, provider: 'Gemini', model: 'gemini-3.6-flash',
    };

    it('round-trips the provenance of a finished summary', async () => {
      await C.saveConversation({
        videoId: 'v1', meta: null, status: 'done', provenance,
        turns: [{ role: 'user', text: 'Résume.' }, { role: 'assistant', text: 'Résumé.' }],
      });

      expect((await C.getConversation('v1'))?.provenance).toEqual(provenance);
    });

    it('carries the provenance on the tail write that ends the stream, without rewriting the head', async () => {
      await C.saveConversation({
        videoId: 'v1', meta: null, status: 'streaming', provenance: null,
        turns: [{ role: 'user', text: 'Résume. Transcript intégral ici.' }, { role: 'assistant', text: 'Ré' }],
      });

      await C.saveConversationTail('v1', { role: 'assistant', text: 'Résumé final.' }, 'done', provenance);

      const c = await C.getConversation('v1');
      expect(c?.provenance).toEqual(provenance);
      expect(c?.turns[0]?.text).toBe('Résume. Transcript intégral ici.');
    });

    it('is null while the summary is still streaming: nothing settled to announce yet', async () => {
      await C.saveConversation({
        videoId: 'v1', meta: null, status: 'streaming', provenance: null,
        turns: [{ role: 'user', text: 'Résume.' }, { role: 'assistant', text: 'Résumé partiel…' }],
      });

      expect((await C.getConversation('v1'))?.provenance).toBeNull();
    });
  });

  // The cache that kept summaries in chrome.storage.local for 30 days is gone.
  // Nothing in the interface could show or clear what it left behind, so the
  // entry is removed rather than left on disk.
  describe('dropLegacyCache', () => {
    it('removes the cache an earlier version left in storage.local', async () => {
      local.cache = { v1: { summary: 'vieux résumé', source: 'transcript', at: 1000 } };

      await C.dropLegacyCache();

      expect(local.cache).toBeUndefined();
    });

    it('is a no-op when there is nothing left to remove, never an error', async () => {
      await expect(C.dropLegacyCache()).resolves.toBeUndefined();
    });

    it('leaves the session conversations alone', async () => {
      await C.saveConversation({
        videoId: 'a', meta: null, status: 'done', provenance: null,
        turns: [{ role: 'assistant', text: 'résumé de session' }],
      });

      await C.dropLegacyCache();

      expect((await C.getConversation('a'))?.turns[0]?.text).toBe('résumé de session');
    });
  });

  // saveConversation used to write the WHOLE conversation under one key, and
  // reserialising that single piece on every chunk cost 150+ seconds for a
  // summary the model produces in under a second. Storage is now split into a
  // head (meta and every turn but the last) and a tail (the last turn plus
  // status) — see StoredHead in lib/conversations.ts. These tests cover the
  // contract getConversation must honour for BOTH shapes.
  describe('head/tail split', () => {
    it('round-trips a conversation written through saveConversation unchanged', async () => {
      const conversation = {
        videoId: 'v1',
        meta: { videoId: 'v1', title: 'Titre', channel: 'Chaîne', description: 'Desc', durationSeconds: 120 },
        status: 'done' as const,
        provenance: null,
        turns: [
          { role: 'user' as const, text: 'Résume. Transcript : [0:00] Bonjour le monde.' },
          { role: 'assistant' as const, text: 'Résumé complet.' },
        ],
      };
      await C.saveConversation(conversation);

      // `createdAt` belongs to storage, not to the draft: it is the one field a
      // reader gets that a writer never supplies (see ConversationDraft).
      expect(await C.getConversation('v1')).toEqual({ ...conversation, createdAt: expect.any(Number) });
    });

    // The point that matters most here: a session opened BEFORE the split wrote
    // its conversation in the OLD shape — the complete Conversation object,
    // status included, under a single conv:<id> key with no separate :tail. A
    // reader that only knew the split shape would silently lose that running
    // session.
    it('still loads a conversation stored in the OLD SHAPE, with no :tail key', async () => {
      session['conv:old'] = {
        videoId: 'old',
        meta: null,
        status: 'streaming',
        turns: [
          { role: 'user', text: 'Résume cette vidéo.' },
          { role: 'assistant', text: 'Résumé partiel, encore en cours…' },
        ],
      };

      const c = await C.getConversation('old');

      expect(c).toEqual({
        videoId: 'old',
        meta: null,
        status: 'streaming',
        // The old shape predates provenance: null, never fabricated. Its
        // creation date came later still, and 0 sorts it before anything this
        // session can stamp — which is where it belongs.
        provenance: null,
        createdAt: 0,
        turns: [
          { role: 'user', text: 'Résume cette vidéo.' },
          { role: 'assistant', text: 'Résumé partiel, encore en cours…' },
        ],
      });
    });

    it(
      'saveConversationTail touches only the tail: the head written by saveConversation '
      + 'stays intact across several successive saveConversationTail calls',
      async () => {
        const meta = { videoId: 'v1', title: 'Titre', channel: 'Chaîne', description: 'Desc', durationSeconds: 60 };
        await C.saveConversation({
          videoId: 'v1', meta, status: 'streaming', provenance: null,
          turns: [
            { role: 'user', text: 'Résume. Transcript intégral : [0:00] beaucoup de texte ici.' },
            { role: 'assistant', text: '' },
          ],
        });

        await C.saveConversationTail('v1', { role: 'assistant', text: 'Ré' }, 'streaming');
        await C.saveConversationTail('v1', { role: 'assistant', text: 'Résumé' }, 'streaming');
        await C.saveConversationTail('v1', { role: 'assistant', text: 'Résumé final.' }, 'done');

        const c = await C.getConversation('v1');
        expect(c?.meta).toEqual(meta);
        // The user turn, transcript included, was never rewritten: this is
        // exactly the text of the very first saveConversation.
        expect(c?.turns[0]).toEqual(
          { role: 'user', text: 'Résume. Transcript intégral : [0:00] beaucoup de texte ici.' },
        );
        // Only the tail moved, up to its very last value.
        expect(c?.turns[1]).toEqual({ role: 'assistant', text: 'Résumé final.' });
        expect(c?.status).toBe('done');
      },
    );
  });

  // The creation date orders the panel's tabs (lib/session-tabs.ts). Nothing
  // else dates a conversation before it ends, so it has to survive every
  // rewrite of the turns.
  describe('createdAt', () => {
    const summary = (text: string) => ({
      videoId: 'v1', meta: null, status: 'done' as const, provenance: null,
      turns: [{ role: 'user' as const, text: 'Résume.' }, { role: 'assistant' as const, text }],
    });

    it('stamps the first write', async () => {
      const before = Date.now();
      await C.saveConversation(summary('Premier résumé.'));

      expect((await C.getConversation('v1'))!.createdAt).toBeGreaterThanOrEqual(before);
    });

    // A regenerated summary keeps its tab where the user left it: re-stamping
    // here would send it to the end of the bar.
    it('carries the first stamp over every later write', async () => {
      session['conv:v1'] = { videoId: 'v1', meta: null, turns: [], createdAt: 1000 };
      await C.saveConversation(summary('Résumé régénéré.'));

      expect((await C.getConversation('v1'))!.createdAt).toBe(1000);
    });
  });

  // The tab bar is derived from what is stored — there is no separate list to
  // keep in step (see lib/session-tabs.ts).
  describe('listConversations', () => {
    const write = async (videoId: string, status: 'streaming' | 'done', title: string) => {
      await C.saveConversation({
        videoId,
        meta: { videoId, title, channel: 'Chaîne', description: '', durationSeconds: 60 },
        status,
        provenance: null,
        turns: [{ role: 'user', text: 'Résume.' }, { role: 'assistant', text: 'Texte.' }],
      });
    };

    it('returns nothing on an empty session', async () => {
      expect(await C.listConversations()).toEqual([]);
    });

    it('lists one entry per stored conversation, with its title and status', async () => {
      await write('a', 'done', 'Titre A');
      await write('b', 'streaming', 'Titre B');

      const list = await C.listConversations();

      expect(list).toHaveLength(2);
      expect(list.find((c) => c.videoId === 'a')?.meta?.title).toBe('Titre A');
      expect(list.find((c) => c.videoId === 'b')?.status).toBe('streaming');
    });

    // The three keys of one conversation share a prefix. Only the head names a
    // conversation; matching the others would list every video three times.
    it('reads heads alone, never the :tail or :quick keys', async () => {
      await write('a', 'done', 'Titre A');
      session['conv:a:quick'] = { turns: 2, questions: ['Une ?'] };

      expect((await C.listConversations()).map((c) => c.videoId)).toEqual(['a']);
    });

    it('still lists a conversation stored in the old shape', async () => {
      session['conv:old'] = { videoId: 'old', meta: null, status: 'streaming', turns: [] };

      expect(await C.listConversations()).toEqual([
        { videoId: 'old', meta: null, createdAt: 0, status: 'streaming' },
      ]);
    });
  });

  describe('deleteConversation', () => {
    it('removes head, tail and the suggestions key an older session may carry', async () => {
      await C.saveConversation({
        videoId: 'v1', meta: null, status: 'done', provenance: null,
        turns: [{ role: 'user', text: 'Résume.' }, { role: 'assistant', text: 'Résumé.' }],
      });
      session['conv:v1:quick'] = { turns: 2, questions: ['Une ?'] };

      await C.deleteConversation('v1');

      expect(Object.keys(session)).toEqual([]);
      expect(await C.getConversation('v1')).toBeNull();
    });

    it('leaves every other conversation alone', async () => {
      const draft = (videoId: string) => ({
        videoId, meta: null, status: 'done' as const, provenance: null,
        turns: [{ role: 'user' as const, text: 'Résume.' }, { role: 'assistant' as const, text: videoId }],
      });
      await C.saveConversation(draft('a'));
      await C.saveConversation(draft('b'));

      await C.deleteConversation('a');

      expect(await C.getConversation('a')).toBeNull();
      expect((await C.getConversation('b'))?.turns[1]?.text).toBe('b');
    });
  });

  // A listener must tell a new conversation from a chunk of one that already
  // exists, without re-reading an area that holds the transcripts.
  describe('readConversationKey / readTailStatus', () => {
    it('recognises a head and a tail, and names the video', () => {
      expect(C.readConversationKey('conv:dQw4')).toEqual({ kind: 'head', videoId: 'dQw4' });
      expect(C.readConversationKey('conv:dQw4:tail')).toEqual({ kind: 'tail', videoId: 'dQw4' });
    });

    it('ignores the suggestions key an older session may carry, and anything else', () => {
      expect(C.readConversationKey('conv:dQw4:quick')).toBeNull();
      expect(C.readConversationKey('settings')).toBeNull();
      expect(C.readConversationKey('conv:')).toBeNull();
    });

    it('reads the status off a stored tail, and nothing off anything else', () => {
      expect(C.readTailStatus({ turn: { role: 'assistant', text: '' }, status: 'streaming' })).toBe('streaming');
      expect(C.readTailStatus({ status: 'inventé' })).toBeUndefined();
      expect(C.readTailStatus(undefined)).toBeUndefined();
    });
  });
});
