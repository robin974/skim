// The tab bar between the panel header and the summary: one tab per summary of
// this session, plus the pinned tab for the video being watched.
//
// Which tabs exist and which one wins after a close is decided in
// lib/session-tabs.ts; this file draws them and handles the two things only a
// DOM can answer — whether the strip overflows, and bringing the selected tab
// into view.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '@/lib/i18n-react';
import { closableTabs, type SessionTab } from '@/lib/session-tabs';
import { Thumbnail } from './Thumbnail';
import { useCloseOnOutsideClick } from './useCloseOnOutsideClick';

type Props = {
  tabs: SessionTab[];
  selected: string | null;
  onSelect: (videoId: string) => void;
  /** Closing a tab forgets its summary; the caller decides which tab takes its place. */
  onClose: (videoId: string) => void;
  onCloseAll: (videoIds: string[]) => void;
};

/** One nudge of the ‹ / › affordances: a tab and its gap, so a click never lands mid-tab. */
const TAB_STEP = 152;

export function SessionTabs({ tabs, selected, onSelect, onClose, onCloseAll }: Props) {
  const t = useT();
  const list = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  /**
   * The selection was just moved by an arrow key, so focus MUST follow it: the
   * roving tabindex has moved to another element, and leaving focus on the old
   * one would take the next arrow press out of the tab order.
   *
   * A ref rather than an effect on `selected`, because a click must NOT steal
   * focus: it already lands where the user pointed.
   */
  const focusSelected = useRef(false);

  const measureEdges = useCallback(() => {
    const el = strip.current;
    if (el === null) return;
    setEdges((prev) => {
      const left = el.scrollLeft > 2;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      return prev.left === left && prev.right === right ? prev : { left, right };
    });
  }, []);

  const stripTabs = tabs.filter((tab) => !tab.pinned);
  const pinned = tabs.find((tab) => tab.pinned);

  /**
   * The one tab in the page's tab order — the selected one, or the first when
   * the selection names no tab at all. That happens while a summary generates
   * for a video whose conversation is not written yet: without the fallback
   * every tab would carry `-1` and the whole bar would drop out of the tab
   * order, unreachable by keyboard.
   */
  const roving = (tabs.find((tab) => tab.videoId === selected) ?? tabs[0])?.videoId ?? null;

  // Brings the selected tab fully into view, inside the strip alone.
  // `scrollIntoView` would move the whole panel, summary included.
  useEffect(() => {
    const el = strip.current;
    if (el === null || selected === null) return;
    const tab = el.querySelector<HTMLElement>(`[data-video-id="${CSS.escape(selected)}"]`);
    if (tab === null) return;

    // `scrollLeft` read directly, and no memorised target: this scroll is
    // instant, so there is never an animation in flight whose mid-course offset
    // could be mistaken for "already in view". Two selections in quick
    // succession each read a position already settled by the one before.
    const from = el.scrollLeft;
    const right = tab.offsetLeft + tab.offsetWidth;
    let target = from;
    if (tab.offsetLeft < from) target = Math.max(0, tab.offsetLeft - 4);
    else if (right > from + el.clientWidth) target = right - el.clientWidth + 4;

    if (target !== from) el.scrollTo({ left: target });
  }, [selected, tabs]);

  useEffect(() => {
    if (!focusSelected.current) return;
    focusSelected.current = false;
    if (selected === null) return;
    list.current?.querySelector<HTMLElement>(`[role="tab"][data-video-id="${CSS.escape(selected)}"]`)?.focus();
  }, [selected]);

  useEffect(() => {
    measureEdges();
    window.addEventListener('resize', measureEdges);
    return () => window.removeEventListener('resize', measureEdges);
  }, [measureEdges, tabs]);

  const nudge = (direction: -1 | 1) => {
    const el = strip.current;
    if (el === null) return;
    const target = Math.max(0, Math.min(el.scrollWidth, el.scrollLeft + direction * TAB_STEP));
    el.scrollTo({ left: target });
  };

  /**
   * Arrows move the selection, Home and End jump to the ends. Selection follows
   * focus, as it does for the pointer: activating a tab only reads what this
   * session already holds.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Only from a tab itself: the close cross is a button inside one, and an
    // arrow pressed there means the cross, not the strip.
    const from = event.target;
    if (!(from instanceof HTMLElement) || from.getAttribute('role') !== 'tab') return;

    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const index = tabs.findIndex((tab) => tab.videoId === selected);

    let next = -1;
    if (step !== 0 && index >= 0) next = (index + step + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next < 0) return;

    event.preventDefault();
    const target = tabs[next];
    // A bar of one tab wraps onto itself: `selected` would not change, the
    // effect below would never run, and the raised flag would then steal focus
    // on the next selection made with the pointer.
    if (target === undefined || target.videoId === selected) return;
    focusSelected.current = true;
    onSelect(target.videoId);
  };

  return (
    <div className="session-tabs">
      <div
        className="session-tabs-list"
        role="tablist"
        aria-label={t('panel.tabs.aria')}
        ref={list}
        onKeyDown={onKeyDown}
      >
        {/* Both wrappers are role="presentation": they exist to clip the strip
           and to anchor the edge affordances to it, and without that the tabs
           would no longer be the tablist's own children. */}
        <div className="session-tabs-scroll-area" role="presentation">
          <div className="session-tabs-strip" role="presentation" ref={strip} onScroll={measureEdges}>
            {stripTabs.map((tab) => (
              <Tab
                key={tab.videoId}
                tab={tab}
                selected={tab.videoId === selected}
                roving={tab.videoId === roving}
                onSelect={onSelect}
                onClose={onClose}
              />
            ))}
          </div>

          {/* Pointer affordances only: the keyboard reaches every tab through
             the arrows above, which scroll the selected one into view by
             themselves. */}
          {edges.left && <EdgeHint side="left" label={t('panel.tabs.scrollLeft')} onClick={() => nudge(-1)} />}
          {edges.right && <EdgeHint side="right" label={t('panel.tabs.scrollRight')} onClick={() => nudge(1)} />}
        </div>

        {pinned !== undefined && (
          <button
            type="button"
            role="tab"
            className={pinned.videoId === selected ? 'session-tab-pinned is-selected' : 'session-tab-pinned'}
            data-video-id={pinned.videoId}
            aria-selected={pinned.videoId === selected}
            tabIndex={pinned.videoId === roving ? 0 : -1}
            title={t('panel.tabs.currentVideo', { title: pinned.title })}
            onClick={() => onSelect(pinned.videoId)}
          >
            {/* The glyph is decoration: this tab is 32px wide and shows no title,
               so its name has to be carried by text of its own. */}
            <span className="session-tab-glyph" aria-hidden="true">▸</span>
            <span className="visually-hidden">{t('panel.tabs.currentVideo', { title: pinned.title })}</span>
          </button>
        )}
      </div>

      {stripTabs.length > 0 && (
        <TabsMenu tabs={stripTabs} selected={selected} onSelect={onSelect} onClose={onClose} onCloseAll={onCloseAll} />
      )}
    </div>
  );
}

type TabProps = {
  tab: SessionTab;
  selected: boolean;
  /** The one tab in the page's tab order; the others are reached by arrow key. */
  roving: boolean;
  onSelect: (videoId: string) => void;
  onClose: (videoId: string) => void;
};

function Tab({ tab, selected, roving, onSelect, onClose }: TabProps) {
  const t = useT();
  const label = tab.generating ? t('panel.tabs.generating', { title: tab.title }) : tab.title;

  return (
    // A div and not a <button>: the close cross is a button of its own, and a
    // button inside a button is not renderable HTML. role="tab" with the
    // keyboard handling its container carries the semantics instead.
    <div
      className={selected ? 'session-tab is-selected' : 'session-tab'}
      data-video-id={tab.videoId}
      role="tab"
      aria-selected={selected}
      tabIndex={roving ? 0 : -1}
      title={label}
      onClick={() => onSelect(tab.videoId)}
    >
      {tab.generating
        // The title is in the tooltip and in the accessible name; the dot says
        // the same thing the tooltip does, so it is hidden from both.
        ? <span className="session-tab-dot" aria-hidden="true" />
        : <Thumbnail videoId={tab.videoId} className="session-tab-thumb" />}
      <span className="session-tab-title">{label}</span>
      {selected && (
        <button
          type="button"
          className="session-tab-close"
          aria-label={t('panel.tabs.closeTab')}
          title={t('panel.tabs.closeTab')}
          onClick={(event) => {
            // Without this the click would also select the tab being closed.
            event.stopPropagation();
            onClose(tab.videoId);
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function EdgeHint({ side, label, onClick }: { side: 'left' | 'right'; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`session-tabs-edge session-tabs-edge-${side}`}
      title={label}
      aria-hidden="true"
      tabIndex={-1}
      onClick={onClick}
    >
      {side === 'left' ? '‹' : '›'}
    </button>
  );
}

type MenuProps = {
  tabs: SessionTab[];
  selected: string | null;
  onSelect: (videoId: string) => void;
  onClose: (videoId: string) => void;
  onCloseAll: (videoIds: string[]) => void;
};

/**
 * Every summary of the session in one list, for a bar too narrow to show them
 * all. Built on <details>, like the header's two popovers: the disclosure, its
 * keyboard support and its focus handling come from the platform.
 */
function TabsMenu({ tabs, selected, onSelect, onClose, onCloseAll }: MenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Closing the element fires `toggle`, and onToggle below is what writes `open`
  // back — so this stays in step without a second path into the same state.
  const menu = useRef<HTMLDetailsElement>(null);
  useCloseOnOutsideClick(menu);

  // Only while it can change something the menu shows: the elapsed seconds of a
  // running generation, on the rows that have one.
  const generating = tabs.some((tab) => tab.generating);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open || !generating) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [open, generating]);

  const choose = (videoId: string) => {
    setOpen(false);
    onSelect(videoId);
  };

  return (
    <details
      className="session-tabs-menu"
      ref={menu}
      open={open}
      onToggle={(event) => {
        const isOpen = event.currentTarget.open;
        setOpen(isOpen);
        // A menu reopened must never come back on a confirmation the user
        // walked away from.
        if (!isOpen) setConfirming(false);
      }}
    >
      <summary className="session-tabs-more" title={t('panel.tabs.showAll')}>
        <span aria-hidden="true">⌄</span> {tabs.length}
      </summary>

      <div className="session-tabs-popover">
        <p className="session-tabs-popover-title">{t('panel.tabs.listTitle')}</p>

        {tabs.map((tab) => (
          <div
            key={tab.videoId}
            className={tab.videoId === selected ? 'session-menu-row is-selected' : 'session-menu-row'}
            role="button"
            tabIndex={0}
            onClick={() => choose(tab.videoId)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              choose(tab.videoId);
            }}
          >
            <Thumbnail videoId={tab.videoId} className="session-menu-thumb" />
            <span className="session-menu-title">{tab.title}</span>
            {tab.generating && <span className="session-menu-note">{elapsed(tab, t)}</span>}
            <button
              type="button"
              className="session-tab-close"
              aria-label={t('panel.tabs.closeTab')}
              title={t('panel.tabs.closeTab')}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.videoId);
              }}
            >
              ×
            </button>
          </div>
        ))}

        {confirming ? (
          <div className="session-menu-footer session-menu-confirm">
            <span className="session-menu-confirm-text">
              {t.n('panel.tabs.closeAllConfirm', tabs.length)}
            </span>
            <button type="button" className="session-menu-cancel" onClick={() => setConfirming(false)}>
              {t('panel.tabs.closeAllCancel')}
            </button>
            <button
              type="button"
              className="session-menu-apply"
              onClick={() => {
                setConfirming(false);
                setOpen(false);
                onCloseAll(closableTabs(tabs));
              }}
            >
              {t('panel.tabs.closeAllApply')}
            </button>
          </div>
        ) : (
          <div className="session-menu-footer">
            <button type="button" className="session-menu-close-all" onClick={() => setConfirming(true)}>
              {t('panel.tabs.closeAll')}
            </button>
            <button type="button" className="session-menu-dismiss" onClick={() => setOpen(false)}>
              {t('panel.tabs.closeMenu')}
            </button>
          </div>
        )}
      </div>
    </details>
  );
}

/**
 * How long this generation has been running. `createdAt` is stamped by the
 * conversation's first write rather than by the click that started it (see
 * lib/conversations.ts), so this reads about a second short — close enough for a
 * note that says "still going", and honest about what is actually recorded.
 */
function elapsed(tab: SessionTab, t: ReturnType<typeof useT>): string {
  const seconds = tab.createdAt === 0 ? 0 : Math.max(0, Math.floor((Date.now() - tab.createdAt) / 1000));
  return t('panel.waiting.seconds', { count: seconds });
}
