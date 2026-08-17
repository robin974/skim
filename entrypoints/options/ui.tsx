// The options page's visual vocabulary: inline style tokens and a few tiny
// components, shared by the four tabs.
//
// Styles are INLINE, as they have always been on this page, but every colour
// goes through a CSS variable from style.css, never a hexadecimal written here.
// That is the only way to support both themes: an inline style cannot carry a
// `@media (prefers-color-scheme)`, but it can perfectly well carry a
// `var(--surface)` the stylesheet redefines per theme.
//
// The action buttons are the exception, and say below why they had to become
// class names.
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useT } from '@/lib/i18n-react';

/** Content column, at the width the options page is designed for. */
export const pageStyle: CSSProperties = {
  font: '14px/1.6 system-ui, sans-serif',
  color: 'var(--fg)',
  background: 'var(--bg)',
  minHeight: '100vh',
  padding: '20px 24px 48px',
  maxWidth: 748,
  boxSizing: 'border-box',
};

/**
 * The product name in the settings header — its only consumer, which is why this
 * replaced the generic h1Style rather than sitting beside it. 20px with a tight
 * letter-spacing: a name set at heading size, not a heading that happens to
 * contain a name.
 */
export const brandNameStyle: CSSProperties = {
  font: '600 20px system-ui', margin: 0, color: 'var(--strong)', letterSpacing: '-0.01em',
};

/** The one-line tagline under the name. 12.5px is already Hint's size — no new step in the scale. */
export const taglineStyle: CSSProperties = {
  margin: '1px 0 0', fontSize: 12.5, lineHeight: 1.45, color: 'var(--muted)',
};
export const h2Style: CSSProperties = { font: '600 14px system-ui', margin: '0 0 8px', color: 'var(--strong)' };

export const labelStyle: CSSProperties = { font: '600 12.5px system-ui', color: 'var(--label)' };

export const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px',
  border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--field-bg)', color: 'var(--fg)',
  font: 'inherit', fontSize: 13,
};

export const selectStyle: CSSProperties = { ...inputStyle };

/**
 * The action buttons are classes and not style objects, alone on this page: they
 * need a `:hover`, which a style attribute cannot carry, and an inline
 * `background` would beat the rule that gives them one. Their whole fill
 * therefore lives in style.css; a call site adds a style attribute only for what
 * it alone changes.
 */
export const buttonClass = 'action-button';

/** Destructive buttons: error border and background, never a solid red. */
export const dangerButtonClass = 'action-button action-button-danger';

/**
 * The same destructive button, standing inside the error box that asks the
 * question rather than on the page.
 */
export const dangerOnErrorButtonClass = `${dangerButtonClass} action-button-on-error`;

/**
 * The page's only saturated fill — same rule as the panel's .cta-button:
 * reserved for the action that unblocks everything else, never for an everyday
 * control. It draws its own `:disabled` state, so a caller passes `disabled` and
 * nothing else.
 */
export const primaryButtonClass = 'action-button-primary';

/**
 * The "ready" pill: the page's status badge, and the same pill on a provider row
 * that has a key. One shape for one claim, wherever it is made.
 *
 * The two hexadecimals are the only ones this page is allowed: they are the
 * gradient of the button injected into YouTube (entrypoints/youtube.content.ts)
 * and of the icon (docs/icon/icon.svg). They belong to the brand, not to the
 * theme, and are therefore the same in light and dark — unlike every other
 * colour here, which goes through a variable.
 */
export const BRAND_PILL: CSSProperties = {
  flex: 'none',
  font: '600 11px system-ui',
  letterSpacing: '.07em',
  textTransform: 'uppercase',
  padding: '5px 12px',
  borderRadius: 999,
  background: 'linear-gradient(135deg, #4f7cff, #9b5cff)',
  color: '#fff',
};

/** A tab's block: a title, then its content. */
export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={h2Style}>{title}</h2>
      {children}
    </section>
  );
}

/**
 * Two-step inline confirmation. Not window.confirm — a browser modal blocks the
 * whole document, is untranslatable, and its wording does not belong to the
 * extension — and not deletion on the first click of an irreversible gesture.
 *
 * The question takes the button's place rather than opening a dialog: the page
 * does not move, and the answer is one click away from where the eye already is.
 */
export function ConfirmButton({
  label, question, onConfirm,
}: {
  label: string;
  question: string;
  onConfirm: () => Promise<void>;
}) {
  const t = useT();
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button type="button" className={dangerButtonClass} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12.5, color: 'var(--error-fg)' }}>{question}</span>
      <button
        type="button"
        className={dangerButtonClass}
        onClick={() => {
          setAsking(false);
          onConfirm().catch(console.error);
        }}
      >
        {t('data.reset.confirmYes')}
      </button>
      <button type="button" className={buttonClass} onClick={() => setAsking(false)}>
        {t('common.cancel')}
      </button>
    </span>
  );
}

/**
 * The key field's eye — the project's only drawn icon. Inline SVG: no file to
 * load, no icon font, and `stroke: currentColor` makes it follow the button's
 * colour in both themes without declaring one.
 */
export function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M1.2 8s2.6-4.2 6.8-4.2S14.8 8 14.8 8s-2.6 4.2-6.8 4.2S1.2 8 1.2 8Z" />
      <circle cx="8" cy="8" r="1.9" />
      {/* The slash appears when the key is VISIBLE: the icon announces what the
         button will do (hide), not the current state — the convention of every
         password field. */}
      {off && <path d="M2.5 13.5 13.5 2.5" />}
    </svg>
  );
}
