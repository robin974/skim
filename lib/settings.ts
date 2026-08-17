import type { EffortLevel, ProviderId } from '@/lib/llm/types';
import { getProvider, SELECTABLE_PROVIDERS } from '@/lib/llm';
import { clampEffort, effortsOf } from '@/lib/llm/effort';
import { createTranslator, resolveLocale, type Translator } from '@/lib/i18n';

// The prompt the extension ships.
//
// English, while the summaries it produces are not: the output language is not a
// property of this text but a setting, appended at send time (see
// LANGUAGE_INSTRUCTION below and buildPrompt, lib/orchestrator.ts).
//
// No longer one of the benchmark variants. fixtures/bench-prompts.mjs still
// holds v0..v21 and the measurements that chose them, so this one can be
// compared against them by adding it there as a variant.
//
// The fidelity clause is about the VALUE, not about the spelling. Worded "keep
// them exactly as they are", it read as an order not to translate: an English
// video summarised in French came back with "$100 billion", "Middle East" and
// "Kyrgyzstan" — and the first of those is not even the same quantity once read
// in French. Which form a name or a number word takes is a language decision,
// so it belongs to LANGUAGE_INSTRUCTION, which governs a custom prompt too.
//
// The timestamp format is not decoration: the panel turns `[m:ss]` and
// `[h:mm:ss]` into buttons that move the player (see the `timestamp` inline in
// lib/summary-format.ts). A range, or an invented instant, yields either no
// button or one that jumps to the wrong place.
//
// WHICH lines carry one is a structural rule, not a per-line judgement: every
// section heading, a bullet only by exception. Left to the model ("timestamp
// what is locatable"), the criterion was never false — every line of a summary
// built from a timestamped transcript is locatable — so every line got one, and
// no shape was left for an opening or a closing paragraph.
//
// The headings therefore carry the navigation on their own, which is what makes
// the bullet exception safe. The failure to watch for is the reverse one, a long
// video losing its timestamps: measured on v18, and counted by `puces+ts` (see
// fixtures/metrics.mjs).
export const DEFAULT_PROMPT = `Write a structured summary of this video. Duration: {duration}.

CLEANUP
Keep only the substance: drop sponsors and the author's own products, calls to
subscribe or comment, greetings and thanks, spoken hesitations and repetitions.

Report figures, percentages, durations, proper nouns and technical terms as the transcript gives them: never round one, never sharpen one, never invent one. Write nothing that is not in the transcript: if a point is unclear, leave it out rather than fill it in.

LENGTH
Count about 250 words per 10 minutes of video, never more than 700 in total, opening and closing included. That is a ceiling, not a target: if it can be said in fewer, say fewer.

Hold that budget by cutting information, never by abbreviating it: eight complete points beat fifteen truncated ones.

SHAPE
Open with one paragraph, two or three sentences: the subject, then the main themes, named. A reader who stops there must know what the video is about. Write it as a full sentence, not as an announcement — never "This summary covers…".

Then the body, in sections titled "## Title", with bullets under each.

Close with one paragraph: what the video establishes taken as a whole. It must add something the opening did not — the opening says what the video is about, the closing says what comes out of it.

FORMAT
Important information in bold.

TIMESTAMPS
A timestamp is a button: the panel turns [m:ss] or [h:mm:ss] into a click that moves the player. Write one where a reader would want to jump, nowhere else.

Every section heading ends with one, and their timestamps increase down the page: they are the summary's navigation spine, and a reader following them must never be sent backwards.

A bullet takes one only when it points at a precise moment its heading does not already cover — a figure, a quotation, a turning point. Most bullets do not.

The opening and closing paragraphs take none: they are about the whole video, which has no single instant to jump to.

Copy the timestamp verbatim from the transcript. Never a range, never two on one line, never mid-line: an approximate format breaks the button, an invented one sends the reader to the wrong place.

---
INPUT DATA:

Title: {title}
Channel: {channel}
Description:
{description}

Timestamped transcript:
{transcript}`;

/**
 * The output-language block, appended to every prompt at send time (see
 * buildPrompt, lib/orchestrator.ts).
 *
 * In code rather than in DEFAULT_PROMPT so the language setting governs EVERY
 * prompt, a custom one included. Carried by the prompt, it would silently stop
 * working the day someone rewrites the prompt without the placeholder — the
 * setting would still be there, the <select> would still move, and nothing would
 * change in the summaries.
 *
 * Wording constraint: this text is appended to prompts that do not necessarily
 * ask for a summary, so it MUST name no deliverable and no property of one.
 * "Write in X", never "Summarise in X" — the verb states who writes, the prompt
 * above states what. The transcript clause is the one addition that earns its
 * place: it is about language only, and covers the real drift case, a foreign
 * transcript long enough to pull the model into its own language.
 *
 * The names-and-figures clause is the second addition, and it is about language
 * too: a prompt asking for fidelity to what the transcript says (DEFAULT_PROMPT
 * above does) is read as fidelity to the words themselves, and place names,
 * units and scale words come through untranslated. A scale word is the case that
 * is not merely awkward: an English billion read as a French billion is off by
 * three orders of magnitude.
 *
 * Appended AFTER the input data, transcript included: the last thing read cannot
 * be diluted by 20,000 tokens of transcript, and coming last it cannot reframe
 * the task either.
 *
 * Scope is left implicit on purpose. This block stays in context on follow-up
 * questions — runAsk replays the whole first turn — but the question arrives
 * last, and its own language governs the answer. Making the scope explicit here
 * ("for a follow-up, reply in the language of the question") is the fix if that
 * ever drifts; it was judged unnecessary rather than untested.
 */
export const LANGUAGE_INSTRUCTION = `---
OUTPUT LANGUAGE
Write in {language}, whatever the language of the transcript. Names, units and figures are part of that: where {language} has its own form for one, write that form rather than the transcript's. A scale word or a separator copied across states the wrong quantity.`;

/**
 * A named prompt. `id` is what `activeProfileId` points at and what the panel
 * writes when the user switches: stable for the profile's whole life, and never
 * reused once deleted, so a stale reference resolves to nothing rather than to
 * somebody else's prompt.
 */
export type Profile = {
  id: string;
  name: string;
  prompt: string;
};

/**
 * The shipped profile. NEVER stored: its prompt is DEFAULT_PROMPT at read time,
 * so future improvements to the shipped prompt keep reaching users who never
 * customised anything. Storing it would pin them to today's.
 */
export const DEFAULT_PROFILE_ID = 'default';

export type Settings = {
  provider: ProviderId;
  /** One key per provider: switching providers never loses the previous one. */
  apiKeys: Partial<Record<ProviderId, string>>;
  /** One model per provider; empty means the provider's defaultModel. */
  models: Partial<Record<ProviderId, string>>;
  /** Endpoint of the `custom` provider only. */
  customBaseUrl: string;
  language: string;
  /**
   * INTERFACE language (menus, buttons, messages), distinct from `language`,
   * which is the SUMMARY's: reading the settings in English does not oblige
   * anyone to receive English summaries.
   *
   * Empty means "follow the browser", same convention as `language`. The crucial
   * difference: getSettings() NEVER resolves this empty value to a concrete
   * code. `language` is sent to the model, so it must always hold something;
   * `uiLanguage` is only read by resolveLocale (lib/i18n.ts), which falls back
   * to chrome.i18n.getUILanguage() itself — and the Languages tab <select> needs
   * to keep telling "chosen" from "follow the browser".
   */
  uiLanguage: string;
  /** USER profiles only, in display order. Never holds the default one, which is built on read. */
  profiles: Profile[];
  /** DEFAULT_PROFILE_ID, or an id in `profiles`. An id pointing nowhere resolves to the default. */
  activeProfileId: string;
  /**
   * The one-off hint under a first summary written in the English fallback (see
   * shouldShowLanguageHint, lib/language-hint.ts). Set by its ✕ and by nothing
   * else: opening the settings is not an answer, and neither is a second summary.
   */
  summaryLanguageHintDismissed: boolean;
  /**
   * Effort per model, keyed `${provider}/${model}` (see effortKey). PER MODEL
   * rather than global, because the accepted levels depend on the model, not the
   * provider — deepseek-v4-pro knows two where a Flash knows five. A missing key
   * means DEFAULT_EFFORT.
   */
  efforts: Record<string, EffortLevel>;
};

export const DEFAULT_SETTINGS: Settings = {
  provider: 'openrouter', // the only provider offering third-party OAuth
  apiKeys: {},
  models: {},
  customBaseUrl: '',
  language: '',           // empty = follow the browser
  uiLanguage: '',         // same, but never resolved by getSettings (see the type)
  profiles: [],
  activeProfileId: DEFAULT_PROFILE_ID,
  summaryLanguageHintDismissed: false,
  efforts: {},
};

/**
 * The default is OFF, not omission. Sending nothing is not neutral: on a
 * reasoning model it lets the model think. Measured 2026-08-12 on a 61-minute
 * transcript — 266 s total and 259 s before the first character, against 17.4 s
 * and 1.1 s once off, for an equivalent summary. Summarising a transcript is
 * extraction, not deduction.
 *
 * Safe by construction: on a model that cannot be turned off, 'off' has nothing
 * below it, so clampEffort omits the parameter (see lib/llm/effort.ts) and the
 * body stays byte-identical. The gain goes to models that can; the others risk
 * no new 400.
 */
export const DEFAULT_EFFORT: EffortLevel = 'off';

/** Storage key for a level. The provider is part of it: the same model id exists at several providers, with different capabilities. */
export function effortKey(provider: ProviderId, model: string): string {
  return `${provider}/${model}`;
}

/**
 * The level AS STORED for the active model, before any clamping. Feeds
 * effortPatch and resolveEffort — NOT the panel's checked control: see
 * checkedEffort below.
 */
export function storedEffort(s: Settings): EffortLevel {
  return s.efforts[effortKey(s.provider, activeModel(s))] ?? DEFAULT_EFFORT;
}

/** Twin of modelPatch, for the same reason: panel and options page MUST write the same shape. */
export function effortPatch(s: Settings, level: EffortLevel): Pick<Settings, 'efforts'> {
  return { efforts: { ...s.efforts, [effortKey(s.provider, activeModel(s))]: level } };
}

/**
 * The level actually sent: the stored one, clamped against the active model's
 * capabilities. The project's single clamping point, shared by the orchestrator
 * and the interface, so the displayed level is exactly the sent one.
 */
export function resolveEffort(s: Settings): EffortLevel | undefined {
  const provider = getProvider(s.provider);
  return clampEffort(effortsOf(provider, activeModel(s)), storedEffort(s));
}

/**
 * The level to CHECK in the panel's effort control: the one ACTUALLY APPLIED
 * (resolveEffort), never storedEffort as is.
 *
 * DEFAULT_EFFORT is 'off', and storedEffort() falls back to it whenever no entry
 * exists for the active model — so at install, and on any never-configured
 * model. But effortChoices (lib/llm/effort.ts) only offers 'off' where the model
 * declares it, which Gemini, DeepSeek and 7 of the 18 OpenCode Go models do not.
 * Checking storedEffort() there would render a radio group with NOTHING checked
 * while a level is in force. This guard stays necessary as long as one model
 * without 'off' remains.
 *
 * `undefined` (resolveEffort sends no parameter) renders as 'default', which is
 * exactly what that word means in the control: let the provider decide.
 */
export function checkedEffort(s: Settings): EffortLevel {
  return resolveEffort(s) ?? 'default';
}

/** The shipped profile, built on read so its prompt and its name both follow the extension. */
export function defaultProfile(t: Translator): Profile {
  return { id: DEFAULT_PROFILE_ID, name: t('profiles.default.name'), prompt: DEFAULT_PROMPT };
}

/** Everything the user can pick from: the shipped profile first, then theirs, in stored order. */
export function allProfiles(s: Settings, t: Translator): Profile[] {
  return [defaultProfile(t), ...s.profiles];
}

/**
 * The profile the next summary will use. An `activeProfileId` pointing at a
 * deleted profile resolves to the default rather than to nothing: a dangling
 * reference must cost a prompt the user did not pick, never a summary that
 * cannot run.
 */
export function activeProfile(s: Settings, t: Translator): Profile {
  return allProfiles(s, t).find((p) => p.id === s.activeProfileId) ?? defaultProfile(t);
}

/**
 * What buildPrompt (lib/orchestrator.ts) sends. Takes no translator, unlike
 * activeProfile: a prompt is not interface text, and the orchestrator has no
 * business resolving a locale to build one.
 */
export function activePrompt(s: Settings): string {
  return s.profiles.find((p) => p.id === s.activeProfileId)?.prompt ?? DEFAULT_PROMPT;
}

/**
 * Switches the active profile. Exists for the same reason as modelPatch: the
 * panel and the options page MUST write exactly the same setting shape. Takes no
 * Settings, unlike its siblings — this is one field, not an entry in a keyed
 * object.
 */
export function profilePatch(id: string): Pick<Settings, 'activeProfileId'> {
  return { activeProfileId: id };
}

/**
 * Creates or updates ONE user profile, by id, keeping the display order: an
 * update leaves the profile where it was, a creation appends.
 *
 * DEFAULT_PROFILE_ID is refused rather than stored. Storing the shipped profile
 * would pin its prompt to today's DEFAULT_PROMPT, which is exactly what building
 * it on read avoids.
 */
export function upsertProfilePatch(s: Settings, profile: Profile): Pick<Settings, 'profiles'> {
  if (profile.id === DEFAULT_PROFILE_ID) return { profiles: s.profiles };
  const known = s.profiles.some((p) => p.id === profile.id);
  return {
    profiles: known ? s.profiles.map((p) => (p.id === profile.id ? profile : p)) : [...s.profiles, profile],
  };
}

/**
 * Removes a user profile. Falls back to the shipped one when the deleted profile
 * was active, in the same patch: leaving `activeProfileId` dangling would work —
 * activePrompt and activeProfile both resolve it — but the settings would then
 * describe a state the interface never offered.
 */
export function deleteProfilePatch(s: Settings, id: string): Pick<Settings, 'profiles' | 'activeProfileId'> {
  return {
    profiles: s.profiles.filter((p) => p.id !== id),
    activeProfileId: s.activeProfileId === id ? DEFAULT_PROFILE_ID : s.activeProfileId,
  };
}

const KEY = 'settings';

/**
 * Reads stored settings and merges them over DEFAULT_SETTINGS.
 *
 * Two one-off migrations run here, both under the same constraint: this function
 * runs on EVERY summary, so neither may write in the common case. Each writes
 * only while the legacy key it removes still exists, which happens once.
 */
export async function getSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(KEY);
  // `prompt` is no longer part of Settings: pulled out of the stored entry here
  // so it never travels on in `merged`, and handed to migrateLegacyPrompt below.
  const { prompt: legacyPrompt, ...stored } =
    (raw[KEY] as (Partial<Settings> & { prompt?: string }) | undefined) ?? {};

  const merged = { ...DEFAULT_SETTINGS, ...stored } as Settings;
  if (!merged.language) merged.language = chrome.i18n.getUILanguage().split('-')[0] ?? 'en';

  const withProfiles = legacyPrompt === undefined ? merged : await migrateLegacyPrompt(merged, legacyPrompt);

  const legacyEffort = (stored as { effort?: EffortLevel }).effort;
  return legacyEffort === undefined ? withProfiles : migrateLegacyEffort(withProfiles, legacyEffort);
}

/**
 * Migrates the single `prompt` setting to a profile list.
 *
 * A stored prompt EQUAL to DEFAULT_PROMPT is dropped and nothing else happens:
 * it carries no information, only the trap of pinning the user to that day's
 * prompt.
 *
 * A stored prompt that DIFFERS becomes a profile, and that profile becomes
 * active. The custom prompt MUST stay in force across the update: it is why the
 * user wrote it, and an update that silently reverts to the shipped prompt would
 * be indistinguishable from a bug in the extension.
 *
 * The migrated profile's name is resolved ONCE, here, against the interface
 * language in force — the one exception to "lib/ returns keys, never words"
 * (see lib/i18n.ts). It has to be: from this point the name is a stored value
 * the user renames at will, not a label the interface re-renders.
 */
async function migrateLegacyPrompt(merged: Settings, legacy: string): Promise<Settings> {
  const raw = await chrome.storage.local.get(KEY);
  const current = { ...((raw[KEY] as Record<string, unknown> | undefined) ?? {}) };
  delete current.prompt;

  if (legacy === DEFAULT_PROMPT) {
    await chrome.storage.local.set({ [KEY]: current });
    return merged;
  }

  const t = createTranslator(resolveLocale(merged.uiLanguage, chrome.i18n.getUILanguage()));
  const migrated: Profile = { id: crypto.randomUUID(), name: t('profiles.migrated.name'), prompt: legacy };
  const profiles = [...merged.profiles, migrated];

  current.profiles = profiles;
  current.activeProfileId = migrated.id;
  await chrome.storage.local.set({ [KEY]: current });

  return { ...merged, profiles, activeProfileId: migrated.id };
}

/**
 * Migrates the old global `effort` setting to per-model `efforts`. Under the
 * same constraint as the prompt self-healing above: getSettings runs on EVERY
 * summary, so this writes only while the `effort` key still exists, which
 * happens once — it removes the key in the same move.
 *
 * The level moves to the ACTIVE model and to it alone. The old setting applied
 * to every model, there is no faithful way to spread it, and the model in use is
 * the one the user chose it for. A stored 'default' carries no information and
 * is dropped without writing anything else.
 */
async function migrateLegacyEffort(merged: Settings, legacy: EffortLevel): Promise<Settings> {
  const efforts = legacy === 'default'
    ? merged.efforts
    : { ...merged.efforts, [effortKey(merged.provider, activeModel(merged))]: legacy };

  const raw = await chrome.storage.local.get(KEY);
  const current = { ...((raw[KEY] as Record<string, unknown> | undefined) ?? {}) };
  delete current.effort;
  current.efforts = efforts;
  await chrome.storage.local.set({ [KEY]: current });

  return { ...merged, efforts };
}

/**
 * Merges a patch into stored settings. NEVER writes an entry as `undefined`.
 * Settings has no optional field, so Partial<Settings> already rejects
 * `{ customBaseUrl: undefined }` at compile time; this filter guards against a
 * caller that bypasses typing (a form-derived value, a cast). A stored
 * `undefined` would merge OVER the default in getSettings() exactly like a real
 * value.
 *
 * Entries skipped here keep their previous stored value. This is not a removal —
 * use clearSetting for that.
 */
export async function setSettings(patch: Partial<Settings>): Promise<void> {
  const raw = await chrome.storage.local.get(KEY);
  const current = (raw[KEY] as Partial<Settings> | undefined) ?? {};
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<Settings>;
  await chrome.storage.local.set({ [KEY]: { ...current, ...clean } });
}

/**
 * Removes an entry from storage so it falls back to DEFAULT_SETTINGS on the next
 * getSettings(), rather than rewriting the CURRENT default value into it, which
 * would pin that field to today's value forever and cut the user off from every
 * future improvement.
 *
 * A dedicated function rather than "setSettings treats undefined as removal":
 * keeping setSettings strictly additive means an undefined value, accidental or
 * legitimate, can never be read two ways depending on the call site.
 */
export async function clearSetting(key: keyof Settings): Promise<void> {
  const raw = await chrome.storage.local.get(KEY);
  const current = { ...((raw[KEY] as Partial<Settings> | undefined) ?? {}) };
  delete current[key];
  await chrome.storage.local.set({ [KEY]: current });
}

/**
 * The language AS STORED, without the browser-language resolution getSettings()
 * applies. For the options page only: its <select> must tell "explicitly chosen"
 * from "follow the browser" (empty) to stay on the right option after a reload —
 * a distinction getSettings() loses by always resolving empty to a concrete
 * code.
 */
export async function getStoredLanguage(): Promise<string> {
  const raw = await chrome.storage.local.get(KEY);
  const stored = (raw[KEY] as Partial<Settings> | undefined)?.language;
  return stored ?? '';
}

/**
 * A translator for the interface language in force.
 *
 * Narrower than getSettings() on purpose, twice over. It carries the
 * migrations, and its caller here answers a content script on every YouTube
 * page: resolving a label MUST NOT be able to rewrite what is stored. And the
 * content script cannot resolve one itself — importing the catalogue measured
 * +26 KB on a script that runs inside someone else's page, so the worker
 * resolves the words and sends those (see Msg/GET_UI_STRINGS).
 */
export async function getUiTranslator(): Promise<Translator> {
  const raw = await chrome.storage.local.get(KEY);
  const stored = (raw[KEY] as Partial<Settings> | undefined)?.uiLanguage ?? '';
  return createTranslator(resolveLocale(stored, chrome.i18n.getUILanguage()));
}

/**
 * "fr" → "français", "en" → "English", "es" → "español". The name is rendered IN
 * the language itself: least ambiguous for a model, and no table to maintain.
 * An unreadable code is returned as is — a summary in the wrong language beats a
 * summary that fails.
 */
export function languageName(code: string): string {
  if (!code) return code;
  try {
    const names = new Intl.DisplayNames([code], { type: 'language' });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The active provider's key, empty string when absent. */
export function activeKey(s: Settings): string {
  return s.apiKeys[s.provider] ?? '';
}

/** The active provider's model, or its defaultModel. */
export function activeModel(s: Settings): string {
  return s.models[s.provider] || getProvider(s.provider).defaultModel;
}

/**
 * Patch setting the ACTIVE provider's model, shared by the options page and the
 * panel's model picker. Both MUST write exactly the same setting shape: the
 * panel changes the GLOBAL setting, not a local preference that would drift from
 * the options page. One function, tested once, rather than two literal
 * `{ models: {…} }` constructions that could silently diverge.
 */
export function modelPatch(s: Settings, model: string): Pick<Settings, 'models'> {
  return { models: { ...s.models, [s.provider]: model } };
}

/**
 * Patch storing ONE provider's key. Twin of removeKeyPatch below, and the only
 * place a key enters the settings from the options page.
 *
 * `provider` travels with it ONLY when the current selection has no key. The
 * settings page no longer picks the provider — the panel does (see PanelHeader)
 * — but a selection pointing at a provider with no key cannot summarise
 * anything, and the panel hides its picker in exactly that state: it would be a
 * dead end, on the very path a new user takes. Storing the first key therefore
 * repairs the selection, and only then.
 *
 * A user who already has a working provider keeps it: configuring a second key
 * is not a request to switch, and switching is one click away in the panel.
 */
export function storeKeyPatch(s: Settings, provider: ProviderId, key: string): Partial<Settings> {
  const apiKeys = { ...s.apiKeys, [provider]: key };
  return activeKey(s) === '' ? { apiKeys, provider } : { apiKeys };
}

/**
 * Patch that REMOVES one provider's key. `setSettings` is strictly additive and
 * `clearSetting('apiKeys')` would drop EVERY key at once, so neither can express
 * this on its own.
 *
 * A patch rather than a self-writing async function, for the same reason as
 * modelPatch/effortPatch: the options page already holds settings in memory and
 * writes through its optimistic `patch()`. It works because setSettings merges
 * at the FIRST level only — rewriting the whole `apiKeys` object replaces it,
 * never merges it entry by entry.
 *
 * The provider's effort levels go with it (keys `${provider}/${model}`): they
 * only describe models unreachable without a key, and leaving them would
 * resurrect old settings if the key ever came back — a state the user believed
 * they had reset.
 *
 * The SELECTION follows too, when the deleted key was the selected provider's
 * and another provider still has one — the mirror image of storeKeyPatch, and
 * for the same reason: the panel's picker is hidden while the selection has no
 * key, so leaving it there would strand a user who still has a usable account.
 * With no other key left, the selection stays put and the panel says so.
 */
export function removeKeyPatch(s: Settings, provider: ProviderId): Partial<Settings> {
  const apiKeys = { ...s.apiKeys };
  delete apiKeys[provider];

  const prefix = `${provider}/`;
  const efforts = Object.fromEntries(
    Object.entries(s.efforts).filter(([key]) => !key.startsWith(prefix)),
  );

  // Read from the apiKeys this patch is about to write, which no longer holds
  // the deleted key: the first provider left is by construction another one.
  const fallback = provider === s.provider ? configuredProviders({ ...s, apiKeys })[0] : undefined;

  return fallback === undefined ? { apiKeys, efforts } : { apiKeys, efforts, provider: fallback };
}

/**
 * Erases the whole storage entry: everything falls back to DEFAULT_SETTINGS on
 * the next getSettings().
 *
 * `chrome.storage.local.remove` rather than a loop of clearSetting: one write,
 * and it cannot forget a field added later — a `Settings` that gains a property
 * tomorrow stays covered. Does not touch the session conversations: they live in
 * another storage area entirely (lib/conversations.ts), and closing the browser
 * is what clears them.
 */
export async function resetAllSettings(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}

/**
 * Providers with a stored key, in PROVIDERS order. `custom` is excluded as it is
 * everywhere in the interface: it cannot work without dynamic host permissions
 * (see PROVIDERS, lib/llm/index.ts), so offering it would offer a silently
 * broken extension.
 */
export function configuredProviders(s: Settings): ProviderId[] {
  return SELECTABLE_PROVIDERS.filter((id) => Boolean(s.apiKeys[id]));
}

/**
 * ANOTHER already-configured provider, or null. Used by the panel's `quota`
 * error, which offers a switch rather than sending the user into the settings.
 * Hence "already configured": switching to a provider without a key would
 * replace one error with another.
 */
export function alternateProvider(s: Settings): ProviderId | null {
  return configuredProviders(s).find((id) => id !== s.provider) ?? null;
}

/**
 * Masked form of a key, to show it without revealing it:
 * `sk-or-v1-••••••••••••••••4f2a`. Enough to recognise WHICH key this is — the
 * prefix names the provider, the last four characters tell two keys of the same
 * account apart — not enough to copy it.
 *
 * The prefix stops at the last dash within the first ten characters, which keeps
 * "sk-or-v1-" and "sk-proj-" whole, and falls back to six characters for keys
 * with no dash (Google AI Studio). The bullet count is FIXED: deriving it from
 * the real length would disclose that length, which helps nobody and identifies
 * providers better than the prefix already does.
 */
export function maskApiKey(key: string): string {
  const k = key.trim();
  if (k.length < 12) return '•'.repeat(12);

  const dash = k.slice(0, 10).lastIndexOf('-');
  const head = dash > 0 ? k.slice(0, dash + 1) : k.slice(0, 6);
  return `${head}${'•'.repeat(16)}${k.slice(-4)}`;
}
