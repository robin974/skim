import { useEffect, useMemo, useRef } from 'react';
import type { ProviderId } from '@/lib/llm/types';
import type { Settings } from '@/lib/settings';
import { activeKey } from '@/lib/settings';
import { canRegenerate } from '@/lib/panel-reducer';
import { quickQuestionBlock } from '@/lib/quick-questions';
import { shouldShowLanguageHint } from '@/lib/language-hint';
import { TranslationProvider, useT } from '@/lib/i18n-react';
import { openOptions } from '@/lib/open-options';
import { openVideo } from '@/lib/open-video';
import { describeVideoMeta } from '@/lib/summary-meta';
import { buildSessionTabs, neighbourAfterClose, resolveSelection, type SessionTab } from '@/lib/session-tabs';
import { Thumbnail } from './Thumbnail';
import { useSummary } from './useSummary';
import { useSettings } from './useSettings';
import { useCloseOnToolbarClick } from './useCloseOnToolbarClick';
import { useSessionTabs } from './useSessionTabs';
import { useYoutubeTabs } from './useCurrentVideo';
import { SessionTabs } from './SessionTabs';
import { SummaryView } from './SummaryView';
import { Waiting, StreamingCursor } from './Waiting';
import { ConversationSection, AskBar } from './Conversation';
import { QuickQuestions } from './QuickQuestions';
import { SummaryFooter } from './SummaryFooter';
import { LanguageHint } from './LanguageHint';
import { PanelHeader } from './PanelHeader';
import { ErrorBox } from './errors';

export function App() {
  const { settings, storedLanguage, patch } = useSettings();

  // Above the early return below: the icon closes the panel even while the
  // first settings read is still in flight.
  useCloseOnToolbarClick();

  // A near-instant local storage read: nothing to announce for that fraction of
  // a second, rather than a loading state that would flash. Done HERE, at the
  // root: the interface language comes from the same settings, and rendering
  // anything before knowing it would show a first screen in the wrong language.
  if (!settings) return null;

  return (
    <TranslationProvider uiLanguage={settings.uiLanguage}>
      <Panel settings={settings} storedLanguage={storedLanguage} patch={patch} />
    </TranslationProvider>
  );
}

type PanelProps = {
  settings: Settings;
  storedLanguage: string;
  patch: (p: Partial<Settings>) => Promise<void>;
};

function Panel({ settings, storedLanguage, patch }: PanelProps) {
  const t = useT();
  const { state, hydrated, askQuestion, regenerateSummary, summarize, selectVideo } = useSummary();
  const { current: currentVideo, openVideoIds } = useYoutubeTabs();
  const { conversations, forget } = useSessionTabs();
  const { status, text, error, videoId, answers, meta } = state;

  /**
   * The bar: one tab per summary of this session, plus the pinned tab for the
   * video being watched. Derived from storage, never accumulated — see
   * lib/session-tabs.ts.
   */
  const tabs = useMemo(() => buildSessionTabs(conversations, currentVideo), [conversations, currentVideo]);
  const activeTab = tabs.find((tab) => tab.videoId === videoId) ?? null;

  /**
   * The bar appears with the first summary, not with the first video. Before
   * that it would hold nothing but the pinned tab — a marker for the video the
   * heading right under it already names, with no other tab to tell it from.
   */
  const showTabs = tabs.some((tab) => !tab.pinned);

  /**
   * The panel follows the video: opening another one shows it, and one already
   * summarised in this session shows its summary again.
   *
   * Fires on a CHANGE of watched video, never on a mere tab activation — an
   * explicit click in the bar must not be undone by leaving the YouTube tab and
   * coming back to it.
   */
  const watched = useRef<string | null>(null);
  useEffect(() => {
    const id = currentVideo?.id ?? null;
    // Recorded only once acted on. Marking it while `hydrated` is still false
    // would bet that the mount-time read is loading this very video — two
    // independent reads apart, with a round trip to a possibly sleeping service
    // worker between them. Navigate YouTube inside that window and the panel
    // would sit on the previous video until the next navigation.
    if (!hydrated || id === null || id === watched.current) return;
    watched.current = id;
    selectVideo(id);
  }, [hydrated, currentVideo, selectVideo]);

  /**
   * Opening the panel away from YouTube: there is nothing to restore for the
   * active tab, but the session may hold summaries, and the most recent is a
   * better answer than an empty screen.
   *
   * Only ever runs while NOTHING is displayed. Past that the selection changes
   * on a click or on a close, never on its own — a generation started for a
   * video whose conversation is not written yet would otherwise be yanked off
   * the screen.
   */
  useEffect(() => {
    if (!hydrated || videoId !== null) return;
    selectVideo(resolveSelection(tabs, null));
  }, [hydrated, videoId, tabs, selectVideo]);

  const closeTab = (closedId: string) => {
    // Read BEFORE forgetting: the neighbour is chosen from the bar as it stands,
    // which is the one the user is looking at.
    const next = neighbourAfterClose(tabs, closedId, videoId);
    forget([closedId]);
    selectVideo(next);
  };

  const closeAllTabs = (closedIds: string[]) => {
    forget(closedIds);
    // Only the pinned tab can survive closing everything — nothing is cached for
    // it, so there was nothing to forget. Without one the panel is left with
    // nothing to show, and `null` is what says so.
    selectVideo(tabs.find((tab) => tab.pinned)?.videoId ?? null);
  };

  // The question field only makes sense once a summary exists to rest on — the
  // user turn carrying the transcript (see orchestrator.ts) exists only then —
  // never while waiting, nor on an error that produced no usable summary.
  const canAsk = status === 'done' && videoId !== null;
  const lastAnswer = answers.at(-1) ?? null;
  const askDisabled = lastAnswer !== null && lastAnswer.status === 'streaming';

  /**
   * The follow-up button and the output it hangs off, or `null` when there is
   * nothing to offer — which is also the whole "not while it streams, not on an
   * error" rule (see quickQuestionBlock, lib/quick-questions.ts). Nothing is
   * decided here: this component only chooses where to draw it.
   */
  const quick = quickQuestionBlock(state, t('panel.quick.condense'));

  // The orchestrator's criterion and no other: activeKey(settings) is what it
  // tests before emitting 'no-key'. A key at ANOTHER provider configures nothing
  // for the next summary.
  const configured = activeKey(settings) !== '';

  // Chrome shows this title in the side panel header. Without this line it would
  // stay the static HTML's, in French, under an interface switched to English.
  useEffect(() => { document.title = t('panel.documentTitle'); }, [t]);

  /**
   * The onboarding screen replaces the panel's content while no key is stored for
   * the active provider — the entry point when the user clicks the injected
   * button with nothing configured.
   *
   * The condition tests `text === ''` and not the error code alone: a summary
   * ALREADY DISPLAYED, restored from its conversation or finished before the key
   * was deleted from another tab, MUST NEVER be replaced by a welcome screen. A panel
   * that shows what it has beats one that erases it to invite configuration.
   */
  const showOnboarding = !configured && text === '' && (status === 'idle' || status === 'error');

  /** The video to (re)start: the one that just failed, else the active tab's. */
  const retryTarget = videoId ?? currentVideo?.id ?? null;

  /**
   * In-place repair of a refused key; PanelKeyField has already validated it.
   * Written to the GLOBAL setting through the same path as the options page,
   * never a panel-local override, then the summary restarts on its own — which is
   * the whole point of repairing here rather than in another tab.
   */
  const handleKeyFixed = (key: string) => {
    patch({ apiKeys: { ...settings.apiKeys, [settings.provider]: key } })
      .then(() => { if (retryTarget !== null) summarize(retryTarget); })
      .catch(console.error);
  };

  /** Switches to another ALREADY configured provider on quota exhaustion, then retries. */
  const handleSwitchProvider = (provider: ProviderId) => {
    patch({ provider })
      .then(() => { if (retryTarget !== null) summarize(retryTarget); })
      .catch(console.error);
  };

  return (
    <div className="panel">
      {/* Pinned to the PANEL, not to main, which scrolls — same principle as
         .ask-bar at the foot: the current model, the effort and the settings
         shortcut stay reachable even at the bottom of a long summary. */}
      <PanelHeader settings={settings} patch={patch} configured={configured} />

      {/* Between the header and the content, outside the scrolling column for
         the same reason: the bar says WHICH summary is on screen, and the answer
         to that question must not scroll away from it. */}
      {!showOnboarding && showTabs && (
        <SessionTabs
          tabs={tabs}
          selected={videoId}
          onSelect={selectVideo}
          onClose={closeTab}
          onCloseAll={closeAllTabs}
        />
      )}

      {showOnboarding ? (
        <Onboarding />
      ) : (
        <main>
          {activeTab === null
            ? <EmptyTitle />
            : <VideoTitle tab={activeTab} tabOpen={openVideoIds.has(activeTab.videoId)} />}

          {/* `hydrated`: the prompt only means something once it is established
             that there is NOTHING to restore. Before that, 'idle' is just the
             reducer's initial state, indistinguishable from a proven "nothing to
             show" — rendering it immediately would make it flash on every open
             over an already-summarised video. */}
          {hydrated && status === 'idle' && (
            activeTab === null
              ? <p className="muted">{t('panel.tabs.empty')}</p>
              : <IdleVideoCard onSummarize={() => summarize(activeTab.videoId)} />
          )}

          {/* Phase 1: the system is reading the video. Which path it took is an
             internal detail, never named here. Matches STATE status:'loading'
             exactly — no invented phase. */}
          {status === 'loading' && videoId !== null && (
            <Waiting label={t('panel.waiting.reading')} phaseKey={`${videoId}:loading`} />
          )}

          {/* Phase 2: the model has started generating but no chunk has arrived
             yet. Matches STATE status:'streaming' with still-empty text. */}
          {status === 'streaming' && text === '' && videoId !== null && (
            <>
              <Waiting label={t('panel.waiting.writing')} phaseKey={`${videoId}:streaming`} />
              {/* Said once, at the only phase where it helps: generation
                 continues in the service worker, not in this document. */}
              <p className="waiting-note">{t('panel.waiting.closeable')}</p>
            </>
          )}

          {/* From the first chunk on, switch to the real text: no more timer —
             there is no telling how much is left — just a discreet indicator
             that more is coming. */}
          {(status === 'streaming' || status === 'done') && text !== '' && (
            <>
              <SummaryView text={text} videoId={videoId} />
              {status === 'streaming' && <StreamingCursor />}
              {/* Only once the summary is fully rendered: never during the
                 stream, where still-partial text has no settled provenance to
                 announce. */}
              {status === 'done' && (
                <>
                  {/* Between the summary and its provenance line: the offer to go
                     further belongs to what was just read, where the footer
                     closes the subject. */}
                  {quick?.target.kind === 'summary' && (
                    <QuickQuestions label={quick.label} onAsk={askQuestion} />
                  )}
                  <SummaryFooter meta={meta} onRegenerate={regenerateSummary} disabled={!canRegenerate(state)} />
                  {/* Hangs off a FINISHED summary and nothing else: never while
                     streaming, never under a follow-up answer, never on an
                     error. */}
                  {shouldShowLanguageHint({
                    dismissed: settings.summaryLanguageHintDismissed,
                    storedLanguage,
                    language: settings.language,
                    status,
                    text,
                  }) && (
                    <LanguageHint
                      onDismiss={() => {
                        patch({ summaryLanguageHintDismissed: true }).catch(console.error);
                      }}
                    />
                  )}
                </>
              )}
            </>
          )}

          {status === 'error' && error && (
            <ErrorBox
              code={error.code}
              target="summary"
              settings={settings}
              onRetry={retryTarget === null ? undefined : () => summarize(retryTarget)}
              onSwitchProvider={handleSwitchProvider}
              onKeyFixed={handleKeyFixed}
            />
          )}

          {/* The follow-up conversation stays BELOW the summary, which does not
             move: asking a question never replaces what is already shown. */}
          {canAsk && (
            <ConversationSection
              answers={answers}
              videoId={videoId}
              settings={settings}
              quick={quick}
              onAsk={askQuestion}
            />
          )}
        </main>
      )}

      {/* Pinned to the PANEL, not to main, which scrolls: see .ask-bar in
         style.css (position: sticky at the foot of a flex column). */}
      {canAsk && <AskBar onAsk={askQuestion} disabled={askDisabled} />}
    </div>
  );
}

/**
 * The displayed video, as the content's own title. It replaces the static
 * "Résumé" heading: with several tabs open, a heading naming the same thing for
 * all of them titles nothing.
 *
 * Clicking it reaches the video, exactly as a timestamp does (see seek,
 * SummaryView.tsx) — the tab already showing it, or a new one. The tooltip
 * announces which of the two, rather than promising one and doing the other.
 */
function VideoTitle({ tab, tabOpen }: { tab: SessionTab; tabOpen: boolean }) {
  const t = useT();
  const metaLine = describeVideoMeta(tab.meta, t);
  const openHint = t(tabOpen ? 'panel.title.openTab' : 'panel.title.openNewTab');
  const open = () => openVideo(tab.videoId);

  return (
    <div className="panel-heading">
      {/* The video's own frame rather than the extension's icon: the heading
         names ONE video among the session's, and the mark of the product that
         summarised it says nothing about which.

         The same action as the title, and the same tooltip: the frame is the
         larger target and the one the eye goes to. Hidden from the keyboard and
         from screen readers (`aria-hidden` + `tabIndex={-1}`) so this stays ONE
         control for them — the title, which carries the words. A second stop in
         the tab order, on a button whose only content is an alt-less image,
         would be a control with no name doing what the next one already does. */}
      <button
        type="button"
        className="panel-title-thumb-link"
        title={openHint}
        aria-hidden="true"
        tabIndex={-1}
        onClick={open}
      >
        <Thumbnail videoId={tab.videoId} className="panel-title-thumb" large />
      </button>
      <div className="panel-heading-text">
        <h1 className="panel-title">
          <button type="button" className="panel-title-link" title={openHint} onClick={open}>
            {tab.title}
          </button>
        </h1>
        {/* Nothing at all rather than an empty line: a video whose metadata never
           arrived has no channel and no duration to state. */}
        {metaLine !== '' && <p className="panel-title-meta">{metaLine}</p>}
      </div>
    </div>
  );
}

/**
 * No tab at all: no video to name, so the heading falls back to naming the
 * content, under the extension's own mark. 48.png for a 20px render, the ≥1.5×
 * rule; alt="" because the heading's own text follows it.
 */
function EmptyTitle() {
  const t = useT();
  return (
    <div className="panel-heading">
      <h1 className="panel-title">
        <img src="/icon/48.png" alt="" width={20} height={20} />
        {t('panel.title')}
      </h1>
    </div>
  );
}

/**
 * The unconfigured panel: a plain call to action.
 *
 * The rejected alternative was a blurred preview behind the invitation, which
 * means fabricating a fake summary of a video that does not exist. This panel has
 * never displayed anything that did not come from a real generation, and a new
 * user has no way to tell decoration from output.
 */
function Onboarding() {
  const t = useT();
  return (
    <main className="onboarding">
      <img className="onboarding-mark" src="/icon/128.png" alt="" width={32} height={32} />
      <h1 className="onboarding-title">{t('panel.onboarding.title')}</h1>
      <p className="onboarding-body">{t('panel.onboarding.body')}</p>
      {/* One of only two saturated fills in the panel (see --accent in
         style.css): reserved for the action that unblocks everything else,
         never for an everyday control. */}
      <button type="button" className="cta-button" onClick={() => openOptions('providers')}>
        {t('panel.onboarding.cta')}
      </button>
      <p className="onboarding-hint">{t('panel.onboarding.hint')}</p>
    </main>
  );
}

/**
 * The resting state, when a video really is in front of the user.
 *
 * It no longer repeats the title: that is the content's heading now, right
 * above, and it proves WHICH video the button will summarise better than a
 * second copy of it inside the card.
 */
function IdleVideoCard({ onSummarize }: { onSummarize: () => void }) {
  const t = useT();
  return (
    <>
      <p className="muted idle-lead">{t('panel.idle.none')}</p>
      <div className="idle-card">
        <button type="button" className="cta-button" onClick={onSummarize}>
          {t('panel.idle.summarize')}
        </button>
      </div>
    </>
  );
}
