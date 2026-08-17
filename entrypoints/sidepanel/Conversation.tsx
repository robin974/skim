// The product's second half: once the summary is displayed, asking questions
// about it. Two distinct pieces, composed separately by App.tsx:
//  - ConversationSection: the question/answer list, scrolling BELOW the summary
//    inside <main>;
//  - AskBar: the input, pinned to the bottom of the PANEL rather than <main> —
//    see .ask-bar in style.css, outside the scrolling flow.
import { useState, type FormEvent } from 'react';
import { SummaryView } from './SummaryView';
import { Waiting, StreamingCursor } from './Waiting';
import { ErrorBox } from './errors';
import { QuickQuestions } from './QuickQuestions';
import type { Answer } from '@/lib/panel-reducer';
import type { QuickBlock } from '@/lib/quick-questions';
import type { Settings } from '@/lib/settings';
import { useT } from '@/lib/i18n-react';

/** `settings` serves ErrorBox alone, for the active provider's name. */
type SectionProps = {
  answers: Answer[];
  videoId: string;
  settings: Settings;
  /**
   * The panel's single follow-up button, whatever it hangs off: this section
   * draws it only when it belongs to one of its own answers. Deciding that here
   * rather than filtering in App.tsx keeps one notion of "where the block is"
   * (lib/quick-questions.ts) instead of two agreeing conditions.
   */
  quick: QuickBlock | null;
  onAsk: (question: string) => void;
};

export function ConversationSection({ answers, videoId, settings, quick, onAsk }: SectionProps) {
  const t = useT();
  if (answers.length === 0) return null;

  return (
    <section className="conversation" aria-label={t('panel.conversation.aria')}>
      {answers.map((a) => (
        <AnswerBlock
          key={a.questionId}
          answer={a}
          videoId={videoId}
          settings={settings}
          quick={quick?.target.kind === 'answer' && quick.target.questionId === a.questionId ? quick : null}
          onAsk={onAsk}
        />
      ))}
    </section>
  );
}

type BlockProps = {
  answer: Answer;
  videoId: string;
  settings: Settings;
  quick: QuickBlock | null;
  onAsk: (question: string) => void;
};

function AnswerBlock({ answer, videoId, settings, quick, onAsk }: BlockProps) {
  const t = useT();
  return (
    <div className="qa-entry">
      <p className="qa-question">{answer.question}</p>

      {/* Waiting: the answer has produced no chunk yet. The same component as
         the summary uses, compact — the same honesty about waiting, at a
         smaller scale since this block sits under a displayed summary. */}
      {answer.status === 'streaming' && answer.text === '' && (
        <Waiting label={t('panel.waiting.answer')} phaseKey={answer.questionId} compact />
      )}

      {answer.text !== '' && (
        <>
          <SummaryView text={answer.text} videoId={videoId} />
          {answer.status === 'streaming' && <StreamingCursor />}
        </>
      )}

      {/* target="answer": neither retry nor key repair on a follow-up answer —
         see PanelErrorContext (lib/panel-errors.ts) for why. */}
      {answer.status === 'error' && answer.error && (
        <ErrorBox code={answer.error.code} target="answer" settings={settings} />
      )}

      {/* At the very end of the answer, never beside the ErrorBox above: `quick`
         is null on anything but a finished answer. */}
      {quick && <QuickQuestions label={quick.label} onAsk={onAsk} />}
    </div>
  );
}

type AskBarProps = { onAsk: (question: string) => void; disabled: boolean };

export function AskBar({ onAsk, disabled }: AskBarProps) {
  const t = useT();
  const [value, setValue] = useState('');

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (disabled || trimmed === '') return;
    onAsk(trimmed);
    setValue('');
  };

  return (
    <form className="ask-bar" onSubmit={submit}>
      <input
        type="text"
        className="ask-input"
        placeholder={t('panel.ask.placeholder')}
        aria-label={t('panel.ask.aria')}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="ask-submit" disabled={disabled || value.trim() === ''}>
        {t('panel.ask.send')}
      </button>
    </form>
  );
}
