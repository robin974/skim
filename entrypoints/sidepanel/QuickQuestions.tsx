// The one-click follow-up under a finished output: the fixed question the
// catalogue holds.
//
// Whether it shows at all is decided in lib/quick-questions.ts and nowhere else;
// this file draws it. A click sends the label AS THE QUESTION — no editing step,
// no confirmation — so the bubble that appears above the answer is exactly the
// text that was clicked.

type Props = {
  label: string;
  /** The panel's own askQuestion: this button is an ordinary question, on the same path as AskBar. */
  onAsk: (question: string) => void;
};

export function QuickQuestions({ label, onAsk }: Props) {
  return (
    <div className="quick-questions">
      <button type="button" className="quick-question quick-question-fixed" onClick={() => onAsk(label)}>
        {/* Decorative: the same sigil the panel puts on its generation actions
           (panel.idle.summarize, panel.waiting.*), where it is part of the
           catalogue string. Here it prefixes a label that must stay readable on
           its own, so it is hidden from the accessible name rather than read as
           a word. */}
        <span className="quick-sigil" aria-hidden="true">✦</span>
        {label}
      </button>
    </div>
  );
}
