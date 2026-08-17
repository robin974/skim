// The profiles tab: a list of named prompts on the left, the selected one's
// editor on the right.
//
// Selecting a profile in the list ACTIVATES it — one selection, not two. A page
// where "the profile being edited" and "the profile the next summary uses" could
// differ would need a third control to reconcile them, and the panel already
// shows which one is active.
//
// The five placeholders are clickable tokens that insert at the caret rather than
// a sentence to read under the field. Retyping "{transcript}" by hand, without a
// typo, into a 4,000-character prompt was otherwise the only way to use them.
import { useEffect, useRef, useState } from 'react';
import type { Profile, Settings } from '@/lib/settings';
import {
  DEFAULT_PROFILE_ID, DEFAULT_PROMPT, activeProfile, allProfiles,
  deleteProfilePatch, profilePatch, upsertProfilePatch,
} from '@/lib/settings';
import { PROMPT_TOKENS, insertToken } from '@/lib/prompt-tokens';
import { useT } from '@/lib/i18n-react';
import { ConfirmButton, buttonClass, inputStyle } from './ui';

type Props = {
  settings: Settings;
  patch: (p: Partial<Settings>) => Promise<void>;
};

export function ProfilesTab({ settings, patch }: Props) {
  const t = useT();
  const nameRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  /**
   * Where to put the caret after an insertion. Through state rather than a direct
   * setSelectionRange call: at click time the text is not rendered yet — patch is
   * optimistic but asynchronous on the React side — and positioning the caret
   * before the render would leave it where it was, ten characters too early after
   * a ten-character insertion.
   */
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);
  /** Same delay, same reason: a profile created by a click is not in the DOM yet. */
  const [pendingNameFocus, setPendingNameFocus] = useState(false);

  useEffect(() => {
    if (pendingCaret === null) return;
    const el = promptRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(pendingCaret, pendingCaret);
    }
    setPendingCaret(null);
  }, [pendingCaret]);

  useEffect(() => {
    if (!pendingNameFocus) return;
    nameRef.current?.select();
    setPendingNameFocus(false);
  }, [pendingNameFocus]);

  // No local "profile being edited": the active profile IS the edited one, and it
  // lives in the settings the panel reads too.
  const profiles = allProfiles(settings, t);
  const edited = activeProfile(settings, t);
  const isShipped = edited.id === DEFAULT_PROFILE_ID;

  const select = (id: string) => { patch(profilePatch(id)).catch(console.error); };

  const write = (changes: Partial<Profile>) => {
    patch(upsertProfilePatch(settings, { ...edited, ...changes })).catch(console.error);
  };

  /** Creation and duplication differ only by what they start from. Both select what they create. */
  const create = (name: string, prompt: string) => {
    const profile: Profile = { id: crypto.randomUUID(), name, prompt };
    patch({ ...upsertProfilePatch(settings, profile), ...profilePatch(profile.id) }).catch(console.error);
    setPendingNameFocus(true);
  };

  const insert = (token: string) => {
    const el = promptRef.current;
    const result = insertToken(edited.prompt, token, el?.selectionStart ?? null, el?.selectionEnd ?? null);
    write({ prompt: result.text });
    setPendingCaret(result.caret);
  };

  return (
    <div className="profile-grid">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {profiles.map((profile) => (
          <ProfileCard
            key={profile.id}
            profile={profile}
            active={profile.id === edited.id}
            onSelect={() => select(profile.id)}
          />
        ))}
        <button
          type="button"
          className="profile-new"
          onClick={() => create(t('profiles.new.name'), DEFAULT_PROMPT)}
        >
          {t('profiles.new')}
        </button>
      </div>

      {/* minWidth on the grid's own item: a grid track defaults to a
         content-based minimum, and the name row would then widen the column
         rather than let its field shrink. */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          {/* The shipped profile's name is read-only for the same reason its
             prompt is: it is built on read, never stored, so there is nothing to
             write. Duplicating it is the way to start from it. */}
          <input
            ref={nameRef}
            type="text"
            value={edited.name}
            readOnly={isShipped}
            onChange={(e) => write({ name: e.target.value })}
            aria-label={t('profiles.nameAria')}
            style={{ ...inputStyle, flex: '1 1 auto', minWidth: 0 }}
          />
          <button
            type="button"
            className={buttonClass}
            onClick={() => create(t('profiles.copySuffix', { name: edited.name }), edited.prompt)}
          >
            {t('profiles.duplicate')}
          </button>
          {!isShipped && (
            <ConfirmButton
              label={t('profiles.delete')}
              question={t('profiles.deleteConfirm')}
              onConfirm={() => patch(deleteProfilePatch(settings, edited.id))}
            />
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8, alignItems: 'center' }}>
          {PROMPT_TOKENS.map((token) => (
            <button
              key={token}
              type="button"
              className="prompt-token"
              onClick={() => insert(token)}
              disabled={isShipped}
              title={t('prompt.insert', { token })}
            >
              {token}
            </button>
          ))}
          <span style={{ fontSize: 11.5, color: 'var(--muted)', marginLeft: 4 }}>{t('prompt.tokensHint')}</span>
        </div>

        <textarea
          ref={promptRef}
          value={edited.prompt}
          readOnly={isShipped}
          onChange={(e) => write({ prompt: e.target.value })}
          rows={16}
          aria-label={t('prompt.aria')}
          style={{
            width: '100%', boxSizing: 'border-box', padding: 12,
            border: '1px solid var(--border)', borderRadius: 8,
            background: 'var(--field-bg)', color: 'var(--fg)',
            fontFamily: 'ui-monospace, monospace', fontSize: 12.5, lineHeight: 1.65,
            resize: 'vertical',
          }}
        />

        {/* Says where the language lives. Without it, a prompt with no language
           clause reads as an omission to fix by hand, and a hand-written "in
           English" would fight the appended instruction (see
           LANGUAGE_INSTRUCTION, lib/settings.ts). */}
        <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          {t('prompt.languageHint')}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          {!isShipped && (
            <button
              type="button"
              onClick={() => write({ prompt: DEFAULT_PROMPT })}
              className={buttonClass}
              style={{ padding: '7px 14px', borderRadius: 8, font: '600 13px system-ui' }}
            >
              {t('profiles.resetPrompt')}
            </button>
          )}
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {t.n('prompt.saved', edited.prompt.length)}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * One row of the list. The active one carries the same tint as the active
 * provider's card on the providers tab, so "active" means one thing on this page.
 */
function ProfileCard({
  profile, active, onSelect,
}: {
  profile: Profile;
  active: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      className={active ? 'profile-card profile-card-active' : 'profile-card'}
      onClick={onSelect}
      aria-pressed={active}
    >
      <span className="profile-card-name">{profile.name}</span>
      <span className="profile-card-meta">
        {profile.id === DEFAULT_PROFILE_ID
          ? t('profiles.shipped')
          : t.n('profiles.chars', profile.prompt.length)}
      </span>
    </button>
  );
}
