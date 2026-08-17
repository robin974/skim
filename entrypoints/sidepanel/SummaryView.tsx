// Renders the typed tree lib/summary-format.ts produces as React elements —
// never `dangerouslySetInnerHTML`, never an HTML string built from the model's
// text. See the header of lib/summary-format.ts for why: the summary derives
// from a transcript an arbitrary third party controls.
import { parseSummary, type Block, type Inline } from '@/lib/summary-format';
import { findVideoTabId } from '@/lib/video-tab';
import type { Msg } from '@/lib/messages';

type Props = {
  text: string;
  videoId: string | null;
};

/**
 * Order: first try to move the playback already running in the tab that shows
 * THIS video (SEEK, handled by entrypoints/youtube.content.ts). If no tab shows
 * it, or the one that does cannot answer — closed, content script not injected
 * yet — or answers without having found a player, open the video in a new tab at
 * the right timestamp.
 *
 * The tab is found by video and not taken to be the active one: the panel shows
 * one tab of the session at a time, and that is not necessarily the video
 * playing in front of the user (see lib/session-tabs.ts). Reading a summary of
 * one video must never scrub another. `chrome.tabs.query({})` needs no extra
 * permission — Chrome fills `url` for tabs covered by a host permission, which
 * is exactly the YouTube ones (see TabLike, lib/video-tab.ts).
 */
async function seek(videoId: string | null, seconds: number): Promise<void> {
  if (videoId === null) return;

  const tabId = findVideoTabId(videoId, await chrome.tabs.query({}).catch(() => []));

  if (tabId !== undefined) {
    const response = await chrome.tabs
      .sendMessage(tabId, { type: 'SEEK', videoId, seconds } satisfies Msg)
      .catch(() => undefined);
    const ok =
      typeof response === 'object' && response !== null && 'ok' in response && response.ok === true;
    if (ok) return;
  }

  await chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}&t=${seconds}s` }).catch(() => {});
}

function renderInline(nodes: Inline[], videoId: string | null, keyPrefix: string): React.ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    if (node.kind === 'strong') return <strong key={key}>{node.text}</strong>;
    if (node.kind === 'em') return <em key={key}>{node.text}</em>;
    if (node.kind === 'timestamp') {
      return (
        <button
          key={key}
          type="button"
          className="timestamp"
          onClick={() => {
            seek(videoId, node.seconds).catch(() => {});
          }}
        >
          [{node.label}]
        </button>
      );
    }
    return node.text;
  });
}

export function SummaryView({ text, videoId }: Props) {
  const blocks = parseSummary(text);
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < blocks.length) {
    const block: Block | undefined = blocks[i];
    if (block === undefined) break;

    if (block.kind === 'heading') {
      // The level read from the Markdown becomes the matching `<hN>` rather
      // than one level for every heading: the CSS gives them distinct sizes, and
      // that is the whole use of a heading. `block.level` is a 1-6 literal (see
      // HeadingLevel), so this template can only produce a real heading tag.
      const Heading = `h${block.level}` as const;
      // A section title ends with a timestamp ("## Title [MM:SS]"): the same
      // `renderInline` as bullets and paragraphs, so it becomes a clickable
      // button rather than literal text. The CSS distinguishes it from the title
      // so it reads as a control, not as part of the wording.
      elements.push(<Heading key={`h-${i}`}>{renderInline(block.content, videoId, `h-${i}`)}</Heading>);
      i += 1;
      continue;
    }

    if (block.kind === 'bullet') {
      // Groups consecutive bullets under one <ul> rather than one list per
      // bullet — that is the shape the prompt produces.
      const items: React.ReactNode[] = [];
      let j = i;
      for (let b = blocks[j]; b !== undefined && b.kind === 'bullet'; j += 1, b = blocks[j]) {
        items.push(<li key={`li-${j}`}>{renderInline(b.content, videoId, `li-${j}`)}</li>);
      }
      elements.push(<ul key={`ul-${i}`}>{items}</ul>);
      i = j;
      continue;
    }

    elements.push(<p key={`p-${i}`}>{renderInline(block.content, videoId, `p-${i}`)}</p>);
    i += 1;
  }

  return <div className="summary">{elements}</div>;
}
