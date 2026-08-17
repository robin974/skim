import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EFFORT_SCALE } from '@/lib/llm/types';
import { PROMPT_TOKENS } from './prompt-tokens';

const store: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (k: string) => ({ [k]: store[k] }),
      set: async (o: Record<string, unknown>) => { Object.assign(store, o); },
      remove: async (k: string) => { delete store[k]; },
    },
  },
  i18n: { getUILanguage: () => 'fr-FR' },
});

const {
  getSettings, setSettings, clearSetting, activeKey, activeModel, modelPatch, languageName, getStoredLanguage, getUiTranslator,
  DEFAULT_SETTINGS, DEFAULT_PROMPT, LANGUAGE_INSTRUCTION, effortKey, storedEffort, effortPatch, resolveEffort, checkedEffort,
  storeKeyPatch, removeKeyPatch, configuredProviders, alternateProvider, maskApiKey, resetAllSettings,
  DEFAULT_PROFILE_ID, defaultProfile, allProfiles, activeProfile, activePrompt,
  profilePatch, upsertProfilePatch, deleteProfilePatch,
} = await import('./settings');
type Settings = Awaited<ReturnType<typeof getSettings>>;

const { createTranslator } = await import('./i18n');
const t = createTranslator('fr');

describe('settings', () => {
  beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

  it('returns the defaults when nothing is stored', async () => {
    const s = await getSettings();
    expect(s.provider).toBe('openrouter');
    expect(s.apiKeys).toEqual({});
  });

  it('derives the language from the browser', async () => {
    const s = await getSettings();
    expect(s.language).toBe('fr');
  });

  it('merges a patch without overwriting the rest', async () => {
    await setSettings({ apiKeys: { openrouter: 'or-test' } });
    await setSettings({ provider: 'anthropic' });
    const s = await getSettings();
    expect(s.apiKeys).toEqual({ openrouter: 'or-test' });
    expect(s.provider).toBe('anthropic');
  });

  it('keeps the defaults for fields absent from storage', async () => {
    await setSettings({ apiKeys: { openrouter: 'x' } });
    const s = await getSettings();
    expect(s.profiles).toEqual([]);
    expect(s.activeProfileId).toBe(DEFAULT_PROFILE_ID);
  });

  // The default is 'off' (explicit extinction), not 'default' (omission): see
  // DEFAULT_EFFORT in lib/settings.ts for the measurement behind it. Sending
  // nothing is not neutral on a reasoning model — it lets the model think.
  it("defaults to 'off': sending nothing is not neutral, it lets the model think", async () => {
    const s = await getSettings();
    expect(s.efforts).toEqual({});
    expect(storedEffort(s)).toBe('off');
  });
});

// Conversations live in chrome.storage.session, settings under the 'settings'
// key of chrome.storage.local: changing a setting cannot reach a summary already
// produced, whose provenance stays readable after a model or effort change.
describe('changing settings never touches anything but the settings key', () => {
  beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

  it('setSettings writes under its own key and leaves every other entry intact', async () => {
    store.autre = { garde: 'moi' };

    const withModel = { ...DEFAULT_SETTINGS, provider: 'anthropic' as const, models: { anthropic: 'claude-opus-4-6' } };
    await setSettings({ provider: 'anthropic' });
    await setSettings(modelPatch({ ...DEFAULT_SETTINGS, provider: 'anthropic' }, 'claude-opus-4-6'));
    await setSettings(effortPatch(withModel, 'high'));

    expect(store.autre).toEqual({ garde: 'moi' });
  });
});

describe('modelPatch — the same shape the options page writes', () => {
  it('sets the ACTIVE provider\'s model without touching the others', () => {
    const s = { ...DEFAULT_SETTINGS, provider: 'gemini' as const, models: { openai: 'gpt-x' } };
    expect(modelPatch(s, 'gemini-3.6-flash')).toEqual({
      models: { openai: 'gpt-x', gemini: 'gemini-3.6-flash' },
    });
  });

  it('writes a patch that activeModel() then reads back — the same contract as the options page', async () => {
    await setSettings({ provider: 'openai' });
    const before = await getSettings();
    await setSettings(modelPatch(before, 'gpt-5.5'));

    const after = await getSettings();
    expect(activeModel(after)).toBe('gpt-5.5');
  });
});

describe('per-model effort, replacing the global setting', () => {
  beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

  it("defaults to 'off' per model too", async () => {
    const s = await getSettings();
    expect(s.efforts).toEqual({});
    expect(storedEffort(s)).toBe('off');
  });

  it('keys on provider AND model: the same id can exist at two providers', () => {
    expect(effortKey('opencode-go', 'deepseek-v4-flash')).toBe('opencode-go/deepseek-v4-flash');
    expect(effortKey('deepseek', 'deepseek-v4-flash')).toBe('deepseek/deepseek-v4-flash');
  });

  it("has effortPatch write on the active model without touching the others", () => {
    const s = { ...DEFAULT_SETTINGS, provider: 'openrouter' as const, efforts: { 'deepseek/deepseek-v4-pro': 'max' as const } };
    const patch = effortPatch(s, 'low');
    expect(patch.efforts['deepseek/deepseek-v4-pro']).toBe('max');
    expect(patch.efforts['openrouter/anthropic/claude-sonnet-4.5']).toBe('low');
  });

  it('has resolveEffort clamp against the active model\'s capabilities', () => {
    const s = {
      ...DEFAULT_SETTINGS, provider: 'opencode-go' as const,
      models: { 'opencode-go': 'gpt-5.6-luna' },
      efforts: { 'opencode-go/gpt-5.6-luna': 'minimal' as const },
    };
    // gpt-5.6-luna offers low and above only: nothing below 'minimal', so omission.
    expect(resolveEffort(s)).toBeUndefined();
  });

  it("has resolveEffort clamp down to 'off' where measurement established it: deepseek-v4-pro offers off/high/max only", () => {
    const s = {
      ...DEFAULT_SETTINGS, provider: 'opencode-go' as const,
      models: { 'opencode-go': 'deepseek-v4-pro' },
      efforts: { 'opencode-go/deepseek-v4-pro': 'minimal' as const },
    };
    expect(resolveEffort(s)).toBe('off');
  });

  it("sends NOTHING for the 'off' default on a model that cannot turn off", () => {
    // grok-4.5: all four turn-off transports tried are refused with a 400 by the
    // gateway (second campaign, 2026-08-12 — see EFFORTS in opencodego.ts). It
    // does not declare 'off', so nothing goes out.
    const s = { ...DEFAULT_SETTINGS, provider: 'opencode-go' as const, models: { 'opencode-go': 'grok-4.5' } };
    expect(resolveEffort(s)).toBeUndefined();
  });

  it("does send the 'off' default to OpenRouter, which can turn off", () => {
    const s = { ...DEFAULT_SETTINGS, provider: 'openrouter' as const };
    expect(resolveEffort(s)).toBe('off');
  });
});

// The panel's control must check the level REALLY APPLIED, never storedEffort as
// is. DEFAULT_EFFORT is 'off' and storedEffort() falls back to it whenever no
// entry exists for the active model — but effortChoices only offers 'off' where
// the model declares it, which Gemini, DeepSeek and 3 of the 18 OpenCode Go
// models do not. Checking storedEffort() there would render a radio group with
// nothing checked.
describe('checkedEffort — checks the applied level, never the stored one', () => {
  it("checks the default for a model that does not declare 'off' with nothing stored", () => {
    // grok-4.5 declares five levels but NOT 'off': the gateway refuses all four
    // turn-off transports with a 400. With nothing stored, storedEffort() is
    // 'off', absent from its list, so checkedEffort() must return 'default'.
    const s = { ...DEFAULT_SETTINGS, provider: 'opencode-go' as const, models: { 'opencode-go': 'grok-4.5' } };
    expect(checkedEffort(s)).toBe('default');
  });

  it('checks the clamped level, not the stored one, when the stored level exceeds the model\'s maximum', () => {
    // deepseek-v4-flash n'offre que low/high/max (DEEPSEEK_EFFORTS,
    // openai-compatible.ts): a stored 'xhigh' drops to 'high'.
    const s = {
      ...DEFAULT_SETTINGS, provider: 'deepseek' as const,
      models: { deepseek: 'deepseek-v4-flash' },
      efforts: { 'deepseek/deepseek-v4-flash': 'xhigh' as const },
    };
    expect(checkedEffort(s)).toBe('high');
  });

  it("keeps checking off by default on OpenRouter, which declares 'off'", () => {
    const s = { ...DEFAULT_SETTINGS, provider: 'openrouter' as const };
    expect(checkedEffort(s)).toBe('off');
  });
});

describe('migration of the old global `effort` setting', () => {
  beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

  it("moves a non-'default' global effort onto the active model, then drops the entry", async () => {
    store.settings = { provider: 'openrouter', effort: 'high' };
    const s = await getSettings();
    expect(s.efforts['openrouter/anthropic/claude-sonnet-4.5']).toBe('high');
    expect('effort' in (store.settings as object)).toBe(false);
  });

  it("simply removes a global effort of 'default', writing nothing elsewhere", async () => {
    store.settings = { provider: 'openrouter', effort: 'default' };
    const s = await getSettings();
    expect(s.efforts).toEqual({});
    expect('effort' in (store.settings as object)).toBe(false);
  });

  it("writes NOTHING when nothing is stored: getSettings runs on every summary", async () => {
    const writes: unknown[] = [];
    const originalSet = chrome.storage.local.set;
    chrome.storage.local.set = vi.fn(async (v: unknown) => { writes.push(v); });
    try {
      await getSettings();
    } finally {
      chrome.storage.local.set = originalSet;
    }
    expect(writes).toEqual([]);
  });
});

describe('clearSetting', () => {
  beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

  // Removing the entry rather than rewriting the current default into it: that
  // would pin the field to today's value and cut the user off from every future
  // improvement.
  it('makes getSettings fall back to the default once the stored entry is removed', async () => {
    await setSettings({ customBaseUrl: 'https://exemple.test/v1' });
    expect((await getSettings()).customBaseUrl).toBe('https://exemple.test/v1');

    await clearSetting('customBaseUrl');

    expect((await getSettings()).customBaseUrl).toBe(DEFAULT_SETTINGS.customBaseUrl);
  });

  it('leaves the other keys intact when removing one', async () => {
    await setSettings({ customBaseUrl: 'https://exemple.test/v1', apiKeys: { openrouter: 'or-test' }, provider: 'anthropic' });

    await clearSetting('customBaseUrl');

    const s = await getSettings();
    expect(s.customBaseUrl).toBe('');
    expect(s.apiKeys).toEqual({ openrouter: 'or-test' });
    expect(s.provider).toBe('anthropic');
  });

  it("never lets undefined reach storage as a stored value: setSettings skips it", async () => {
    await setSettings({ customBaseUrl: 'kept' });
    // Simulates a caller bypassing the typing — Settings has no optional field,
    // so `{ customBaseUrl: undefined }` does not compile without this deliberate
    // cast. It must neither overwrite nor write `undefined`.
    await setSettings({ customBaseUrl: undefined } as unknown as Partial<Settings>);

    expect(Object.prototype.hasOwnProperty.call(store.settings as object, 'customBaseUrl')).toBe(true);
    expect((store.settings as Partial<Settings>).customBaseUrl).toBe('kept');
    expect((await getSettings()).customBaseUrl).toBe('kept');
  });
});

// The shipped profile is built on READ, never stored: that is what keeps a user
// who customised nothing on the current DEFAULT_PROMPT, improvements included.
describe('profiles — the shipped one is built, not stored', () => {
  it('names the default profile from the catalogue and prompts it with DEFAULT_PROMPT', () => {
    expect(defaultProfile(t)).toEqual({
      id: DEFAULT_PROFILE_ID, name: 'Par défaut', prompt: DEFAULT_PROMPT,
    });
  });

  it('lists the default first, then the user profiles in stored order', () => {
    const s = {
      ...DEFAULT_SETTINGS,
      profiles: [{ id: 'a', name: 'A', prompt: 'pa' }, { id: 'b', name: 'B', prompt: 'pb' }],
    } as Settings;
    expect(allProfiles(s, t).map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID, 'a', 'b']);
  });

  it('returns the profile activeProfileId points at', () => {
    const s = { ...DEFAULT_SETTINGS, profiles: [{ id: 'a', name: 'A', prompt: 'pa' }], activeProfileId: 'a' } as Settings;
    expect(activeProfile(s, t).name).toBe('A');
    expect(activePrompt(s)).toBe('pa');
  });

  // A dangling reference must cost a prompt the user did not pick, never a
  // summary that cannot run.
  it('falls back to the default when activeProfileId points at a deleted profile', () => {
    const s = { ...DEFAULT_SETTINGS, profiles: [], activeProfileId: 'gone' } as Settings;
    expect(activeProfile(s, t).id).toBe(DEFAULT_PROFILE_ID);
    expect(activePrompt(s)).toBe(DEFAULT_PROMPT);
  });

  it('prompts the default profile with DEFAULT_PROMPT, whatever is stored beside it', () => {
    const s = { ...DEFAULT_SETTINGS, profiles: [{ id: 'a', name: 'A', prompt: 'pa' }] } as Settings;
    expect(activePrompt(s)).toBe(DEFAULT_PROMPT);
  });
});

describe('profile patches — the same shape the panel and the options page write', () => {
  const s = {
    ...DEFAULT_SETTINGS,
    profiles: [{ id: 'a', name: 'A', prompt: 'pa' }, { id: 'b', name: 'B', prompt: 'pb' }],
    activeProfileId: 'a',
  } as Settings;

  it('switches the active profile and nothing else', () => {
    expect(profilePatch('b')).toEqual({ activeProfileId: 'b' });
  });

  it('updates a known profile in place, keeping the display order', () => {
    const patch = upsertProfilePatch(s, { id: 'a', name: 'A2', prompt: 'pa2' });
    expect(patch.profiles.map((p) => p.id)).toEqual(['a', 'b']);
    expect(patch.profiles[0]).toEqual({ id: 'a', name: 'A2', prompt: 'pa2' });
  });

  it('appends an unknown profile', () => {
    const patch = upsertProfilePatch(s, { id: 'c', name: 'C', prompt: 'pc' });
    expect(patch.profiles.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  // Storing the shipped profile would pin its prompt to today's DEFAULT_PROMPT,
  // which is exactly what building it on read avoids.
  it('refuses to store the shipped profile', () => {
    expect(upsertProfilePatch(s, { id: DEFAULT_PROFILE_ID, name: 'X', prompt: 'x' }).profiles)
      .toEqual(s.profiles);
  });

  it('removes a profile and leaves the active one alone when another was active', () => {
    expect(deleteProfilePatch(s, 'b')).toEqual({
      profiles: [{ id: 'a', name: 'A', prompt: 'pa' }],
      activeProfileId: 'a',
    });
  });

  it('falls back to the shipped profile when the deleted one was active', () => {
    expect(deleteProfilePatch(s, 'a').activeProfileId).toBe(DEFAULT_PROFILE_ID);
  });
});

// The single `prompt` setting becomes a profile list. Same constraint as the
// legacy `effort` migration: getSettings runs on EVERY summary, so it may only
// write while the legacy key still exists.
describe('migration of the old `prompt` setting', () => {
  beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

  // The custom prompt is why the user wrote it: an update that silently reverted
  // to the shipped prompt would be indistinguishable from a bug.
  it('turns a custom prompt into a profile and activates it', async () => {
    store.settings = { prompt: 'ma vraie personnalisation, à ne jamais perdre' };

    const s = await getSettings();

    expect(s.profiles).toHaveLength(1);
    expect(s.profiles[0]?.prompt).toBe('ma vraie personnalisation, à ne jamais perdre');
    expect(s.profiles[0]?.name).toBe('Mon prompt');
    expect(s.activeProfileId).toBe(s.profiles[0]?.id);
    expect(activePrompt(s)).toBe('ma vraie personnalisation, à ne jamais perdre');
  });

  it('drops the `prompt` key in the same write, so the migration happens once', async () => {
    store.settings = { prompt: 'personnalisé' };
    await getSettings();

    expect('prompt' in (store.settings as object)).toBe(false);
    expect((store.settings as Partial<Settings>).activeProfileId).toBeDefined();

    const again = await getSettings();
    expect(again.profiles).toHaveLength(1);
  });

  // A stored prompt equal to the current default carries no information, only
  // the trap of pinning the user to today's prompt: dropped, with no profile
  // created for it.
  it('drops a stored prompt identical to the current default without creating a profile', async () => {
    store.settings = { prompt: DEFAULT_PROMPT };

    const s = await getSettings();

    expect(s.profiles).toEqual([]);
    expect(s.activeProfileId).toBe(DEFAULT_PROFILE_ID);
    expect('prompt' in (store.settings as object)).toBe(false);
  });

  // A stale old default the user legitimately pinned is a real customisation:
  // only the exactly-redundant case is dropped.
  it("keeps a stored prompt equal to an OLD default, as a profile", async () => {
    const ancienDefaut = 'Résume cette vidéo. [prompt v6, remplacé depuis par v7]';
    expect(ancienDefaut).not.toBe(DEFAULT_PROMPT);
    store.settings = { prompt: ancienDefaut };

    const s = await getSettings();

    expect(activePrompt(s)).toBe(ancienDefaut);
  });

  it('adds the migrated profile beside profiles already stored, never replacing them', async () => {
    store.settings = {
      prompt: 'legacy',
      profiles: [{ id: 'a', name: 'A', prompt: 'pa' }],
      activeProfileId: 'a',
    };

    const s = await getSettings();

    expect(s.profiles.map((p) => p.prompt)).toEqual(['pa', 'legacy']);
    expect(s.activeProfileId).toBe(s.profiles[1]?.id);
  });

  it('writes NOTHING when no legacy prompt is stored: getSettings runs on every summary', async () => {
    await setSettings({ provider: 'anthropic' });
    const writes: unknown[] = [];
    const originalSet = chrome.storage.local.set;
    chrome.storage.local.set = vi.fn(async (v: unknown) => { writes.push(v); });
    try {
      await getSettings();
    } finally {
      chrome.storage.local.set = originalSet;
    }
    expect(writes).toEqual([]);
  });
});

describe('getStoredLanguage', () => {
  // A distinction getSettings() cannot make, since it always resolves empty to
  // the browser language. The options page needs it to keep "browser language"
  // selected after a reload.
  it("returns an empty string when nothing is stored, even though getSettings() resolves a concrete language", async () => {
    expect(await getStoredLanguage()).toBe('');
    expect((await getSettings()).language).toBe('fr'); // resolved from 'fr-FR'
  });

  it('returns the explicitly stored code', async () => {
    await setSettings({ language: 'es' });
    expect(await getStoredLanguage()).toBe('es');
  });

  it("returns empty after an explicit return to follow-the-browser", async () => {
    await setSettings({ language: 'es' });
    await setSettings({ language: '' });
    expect(await getStoredLanguage()).toBe('');
  });
});

describe('getUiTranslator', () => {
  beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

  // What the injected YouTube button reads (Msg/GET_UI_STRINGS). The interface
  // language governs it like every other label, which is the whole point: the
  // button and the panel it opens are one gesture, and they MUST agree.
  it('follows the browser when no interface language is stored', async () => {
    const t = await getUiTranslator();
    expect(t('youtube.button.label')).toBe('✦ Résumer'); // browser is 'fr-FR'
  });

  it('follows the explicitly chosen interface language over the browser', async () => {
    await setSettings({ uiLanguage: 'en' });
    const t = await getUiTranslator();
    expect(t('youtube.button.label')).toBe('✦ Summarize');
    expect(t('youtube.button.aria')).toBe('Summarize this video with AI');
  });

  it('falls back to the browser when the stored language has no catalogue', async () => {
    await setSettings({ uiLanguage: 'de' });
    expect((await getUiTranslator())('youtube.button.label')).toBe('✦ Résumer');
  });

  // Reading a label MUST NOT be able to rewrite settings: it answers a content
  // script on every YouTube page, and getSettings() carries the migrations.
  it('writes nothing', async () => {
    await getUiTranslator();
    expect(store).toEqual({});
  });
});

describe('activeKey', () => {
  it('returns the active provider\'s key', () => {
    const s = { ...DEFAULT_SETTINGS, provider: 'anthropic' as const, apiKeys: { anthropic: 'sk-ant-x' } };
    expect(activeKey(s)).toBe('sk-ant-x');
  });

  it('returns an empty string when the active provider has no key', () => {
    const s = { ...DEFAULT_SETTINGS, provider: 'openai' as const, apiKeys: { anthropic: 'sk-ant-x' } };
    expect(activeKey(s)).toBe('');
  });
});

describe('activeModel', () => {
  it('returns the model configured for the active provider', () => {
    const s = { ...DEFAULT_SETTINGS, provider: 'openai' as const, models: { openai: 'gpt-custom' } };
    expect(activeModel(s)).toBe('gpt-custom');
  });

  it('falls back to the provider\'s defaultModel when none is configured', () => {
    const s = { ...DEFAULT_SETTINGS, provider: 'gemini' as const, models: {} };
    expect(activeModel(s)).toBe('gemini-3.6-flash');
  });

  it('falls back to the defaultModel when the configured model is an empty string', () => {
    const s = { ...DEFAULT_SETTINGS, provider: 'gemini' as const, models: { gemini: '' } };
    expect(activeModel(s)).toBe('gemini-3.6-flash');
  });
});

describe('languageName', () => {
  it.each([
    ['fr', 'français'],
    ['en', 'English'],
    ['es', 'español'],
  ])('%s → %s', (code, expected) => {
    expect(languageName(code)).toBe(expected);
  });

  it.each(['', 'not a locale'])('returns malformed input %j as is, without throwing', (code) => {
    expect(() => languageName(code)).not.toThrow();
    expect(languageName(code)).toBe(code);
  });
});

// Chosen by the benchmark in fixtures/bench-prompts.mjs — see the comment above
// DEFAULT_PROMPT in lib/settings.ts for the variants compared and what each
// clause fixes.
describe('DEFAULT_PROMPT', () => {
  it('carries the placeholders it needs to describe the video', () => {
    for (const placeholder of ['{title}', '{channel}', '{description}', '{transcript}']) {
      expect(DEFAULT_PROMPT).toContain(placeholder);
    }
  });

  // The whole point of the split: the shipped prompt says WHAT to write, the
  // setting says in which language. A {language} back in here would re-couple
  // the two, and state the language twice — LANGUAGE_INSTRUCTION is appended
  // whatever the prompt says (see buildPrompt, lib/orchestrator.ts).
  it('says nothing about the output language', () => {
    expect(DEFAULT_PROMPT).not.toContain('{language}');
  });

  // A placeholder the shipped prompt uses but the options page does not offer —
  // and buildPrompt therefore does not replace — would reach the model verbatim.
  it('uses no placeholder outside PROMPT_TOKENS', () => {
    for (const used of DEFAULT_PROMPT.match(/\{[a-z]+\}/g) ?? []) {
      expect(PROMPT_TOKENS, used).toContain(used);
    }
  });

  it("contains no benchmark residue: no unresolved template syntax", () => {
    expect(DEFAULT_PROMPT).not.toContain('${HEADER}');
    expect(DEFAULT_PROMPT).not.toContain('${');
    expect(DEFAULT_PROMPT).not.toMatch(/`/);
  });
});

// Appended to prompts that do not necessarily ask for a summary, so it must
// state the output language and nothing else. Naming a deliverable here would
// inject "summary" into a custom prompt that asked for something else — the very
// coupling this block exists to remove.
describe('LANGUAGE_INSTRUCTION', () => {
  it('carries the {language} placeholder buildPrompt substitutes', () => {
    expect(LANGUAGE_INSTRUCTION).toContain('{language}');
  });

  it('names no deliverable and no property of one', () => {
    expect(LANGUAGE_INSTRUCTION.toLowerCase()).not.toMatch(/summar|résum|structur|bullet|concise|detailed/);
  });

  // Same trap as DEFAULT_PROMPT above, and one this block is more exposed to: a
  // placeholder nothing substitutes would reach the model verbatim, at the very
  // end of the prompt. {language} is the one placeholder outside PROMPT_TOKENS
  // buildPrompt still substitutes: the options page does not offer it, this
  // block is the only text allowed to carry it.
  it('uses no placeholder buildPrompt does not substitute', () => {
    for (const used of LANGUAGE_INSTRUCTION.match(/\{[a-z]+\}/g) ?? []) {
      expect([...PROMPT_TOKENS, '{language}'], used).toContain(used);
    }
  });
});


// ── Ajouts du handoff onboarding ────────────────────────────────────────────

// The settings page no longer picks the provider — the panel does. It still
// repairs a SELECTION that cannot work, because the panel hides its picker in
// exactly that state: leaving it there would be a dead end.
describe('storeKeyPatch — the key, and the selection only when it is stuck', () => {
  it('stores the key beside the others', () => {
    const s = { ...DEFAULT_SETTINGS, provider: 'gemini', apiKeys: { gemini: 'ge' } } as Settings;
    expect(storeKeyPatch(s, 'openai', 'oa').apiKeys).toEqual({ gemini: 'ge', openai: 'oa' });
  });

  it('adopts the provider when the selected one has no key', () => {
    const s = { ...DEFAULT_SETTINGS, provider: 'openrouter', apiKeys: {} } as Settings;
    expect(storeKeyPatch(s, 'gemini', 'ge').provider).toBe('gemini');
  });

  // Configuring a second key is not a request to switch, and switching is one
  // click away in the panel.
  it('leaves a working selection alone', () => {
    const s = { ...DEFAULT_SETTINGS, provider: 'gemini', apiKeys: { gemini: 'ge' } } as Settings;
    expect(storeKeyPatch(s, 'openai', 'oa').provider).toBeUndefined();
  });

  it('touches neither the model nor the effort already stored', () => {
    const s = {
      ...DEFAULT_SETTINGS,
      provider: 'gemini',
      apiKeys: {},
      models: { gemini: 'gemini-3.6-flash' },
      efforts: { 'gemini/gemini-3.6-flash': 'low' },
    } as Settings;
    const patch = storeKeyPatch(s, 'gemini', 'ge');
    expect(patch.models).toBeUndefined();
    expect(patch.efforts).toBeUndefined();
  });
});

describe('removeKeyPatch — le chemin de retrait qui manquait', () => {
  it("removes the targeted provider's key, and only it", () => {
    const s = { ...DEFAULT_SETTINGS, apiKeys: { openrouter: 'or', gemini: 'ge' }, efforts: {} } as Settings;
    expect(removeKeyPatch(s, 'openrouter').apiKeys).toEqual({ gemini: 'ge' });
  });

  // Those levels only describe models unreachable without a key, and leaving them
  // would resurrect old settings if the key ever came back.
  it("takes the same provider's effort levels with it, never the others'", () => {
    const s = {
      ...DEFAULT_SETTINGS,
      apiKeys: { openrouter: 'or', gemini: 'ge' },
      efforts: { 'openrouter/m1': 'high', 'openrouter/m2': 'low', 'gemini/m3': 'max' },
    } as Settings;
    expect(removeKeyPatch(s, 'openrouter').efforts).toEqual({ 'gemini/m3': 'max' });
  });

  it("touches nothing when the provider had no key", () => {
    const s = { ...DEFAULT_SETTINGS, apiKeys: { gemini: 'ge' }, efforts: {} } as Settings;
    expect(removeKeyPatch(s, 'openai')).toEqual({ apiKeys: { gemini: 'ge' }, efforts: {} });
  });

  // Mirror image of storeKeyPatch: the panel's picker is hidden while the
  // selection has no key, so a user who still has a usable account must not be
  // stranded on the one they just deleted.
  it('hands the selection to another configured provider', () => {
    const s = {
      ...DEFAULT_SETTINGS, provider: 'openrouter', apiKeys: { openrouter: 'or', gemini: 'ge' }, efforts: {},
    } as Settings;
    expect(removeKeyPatch(s, 'openrouter').provider).toBe('gemini');
  });

  it('leaves the selection where it is when nothing else has a key', () => {
    const s = { ...DEFAULT_SETTINGS, provider: 'openrouter', apiKeys: { openrouter: 'or' }, efforts: {} } as Settings;
    expect(removeKeyPatch(s, 'openrouter').provider).toBeUndefined();
  });

  it('leaves the selection alone when another provider loses its key', () => {
    const s = {
      ...DEFAULT_SETTINGS, provider: 'openrouter', apiKeys: { openrouter: 'or', gemini: 'ge' }, efforts: {},
    } as Settings;
    expect(removeKeyPatch(s, 'gemini').provider).toBeUndefined();
  });

  // setSettings merges at the FIRST level only: rewriting the whole apiKeys
  // object replaces it, which is what makes removal expressible as a patch.
  it('really writes a removal through setSettings', async () => {
    await setSettings({ apiKeys: { openrouter: 'or', gemini: 'ge' } });
    const before = await getSettings();
    await setSettings(removeKeyPatch(before, 'openrouter'));
    expect((await getSettings()).apiKeys).toEqual({ gemini: 'ge' });
  });
});

describe('configuredProviders / alternateProvider', () => {
  it('lists the providers that have a key', () => {
    const s = { ...DEFAULT_SETTINGS, apiKeys: { gemini: 'g', anthropic: 'a' } } as Settings;
    expect(configuredProviders(s).sort()).toEqual(['anthropic', 'gemini']);
  });

  // `custom` cannot work without dynamic host permissions (see PROVIDERS,
  // lib/llm/index.ts), so offering it would offer a silently broken extension.
  it("never exposes `custom`, even with a stored key", () => {
    const s = { ...DEFAULT_SETTINGS, apiKeys: { custom: 'c', gemini: 'g' } } as Settings;
    expect(configuredProviders(s)).toEqual(['gemini']);
  });

  it('never returns the active provider as the alternate', () => {
    const s = { ...DEFAULT_SETTINGS, provider: 'gemini', apiKeys: { gemini: 'g', anthropic: 'a' } } as Settings;
    expect(alternateProvider(s)).toBe('anthropic');
  });

  it('returns null when no other provider is configured: nothing to offer', () => {
    const s = { ...DEFAULT_SETTINGS, provider: 'gemini', apiKeys: { gemini: 'g' } } as Settings;
    expect(alternateProvider(s)).toBeNull();
  });
});

describe('maskApiKey — recognise the key without being able to copy it', () => {
  it('keeps the provider prefix whole', () => {
    expect(maskApiKey('sk-or-v1-abcdefghijklmnop4f2a')).toBe('sk-or-v1-••••••••••••••••4f2a');
    expect(maskApiKey('sk-proj-abcdefghijklmnop1234')).toBe('sk-proj-••••••••••••••••1234');
  });

  it('falls back to six characters when the key has no dash', () => {
    expect(maskApiKey('AIzaSyD0123456789abcdef')).toBe('AIzaSy••••••••••••••••cdef');
  });

  it('discloses the last four characters and nothing more of the middle', () => {
    const masked = maskApiKey('sk-or-v1-SECRETSECRETSECRET9999');
    expect(masked).toContain('9999');
    expect(masked).not.toContain('SECRET');
  });

  // The bullet count is fixed: deriving it from the real length would disclose
  // that length while teaching nobody anything useful.
  it('always masks with the same number of bullets, whatever the length', () => {
    const a = maskApiKey('sk-or-v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1234');
    const b = maskApiKey('sk-or-v1-aaaa1234');
    expect(a.replace(/[^•]/g, '')).toBe(b.replace(/[^•]/g, ''));
  });

  it('masks a string too short to carry a prefix entirely', () => {
    expect(maskApiKey('abc')).toBe('••••••••••••');
    expect(maskApiKey('abc')).not.toContain('abc');
  });
});

describe('uiLanguage', () => {
  it('defaults to empty, meaning follow the browser', () => {
    expect(DEFAULT_SETTINGS.uiLanguage).toBe('');
  });

  // The crucial difference from `language`, which getSettings resolves: the
  // Languages tab's <select> must keep telling "chosen" from "follow the
  // browser", and resolveLocale (lib/i18n.ts) can do that fallback itself.
  it("is NEVER resolved by getSettings, unlike the summary language", async () => {
    const s = await getSettings();
    expect(s.uiLanguage).toBe('');
    expect(s.language).toBe('fr');
  });

  it('se stocke et se relit tel quel', async () => {
    await setSettings({ uiLanguage: 'en' });
    expect((await getSettings()).uiLanguage).toBe('en');
  });
});

describe('resetAllSettings', () => {
  it('erases everything: the next getSettings starts from the defaults', async () => {
    await setSettings({ provider: 'anthropic', apiKeys: { anthropic: 'a' }, uiLanguage: 'en' });
    await resetAllSettings();
    const s = await getSettings();
    expect(s.provider).toBe(DEFAULT_SETTINGS.provider);
    expect(s.apiKeys).toEqual({});
    expect(s.uiLanguage).toBe('');
  });

  // Targets its own key, never the whole area: another entry of the same
  // chrome.storage.local must not be emptied by the back door.
  it('removes its own key and nothing else', async () => {
    store['autre'] = { garde: 'moi' };
    await resetAllSettings();
    expect(store['autre']).toEqual({ garde: 'moi' });
  });
});
