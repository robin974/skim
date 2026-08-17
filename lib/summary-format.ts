// Turns a model summary into a typed tree the panel renders.
//
// The summary derives from a YouTube transcript, content an arbitrary third
// party controls. The side panel is an extension page with access to the
// `chrome.*` APIs, so injecting HTML built from that text would be a real
// privilege escalation, not a cosmetic bug. This text MUST NEVER be rendered
// through `dangerouslySetInnerHTML` or a Markdown dependency, which would
// eventually build an HTML string. Instead, entrypoints/sidepanel/SummaryView.tsx
// walks the tree produced here and emits React elements: no HTML string is ever
// built, so the whole vulnerability class is excluded by construction rather
// than sanitised after the fact.
//
// This is NOT a general Markdown parser. It covers one subset: headings
// (numbered or hashed), single-level bullets, paragraphs, bold and italic
// spans, and bracketed timestamps.
//
// The shipped prompt (see DEFAULT_PROMPT, lib/settings.ts) asks for headings,
// bold, and a `[m:ss]` or `[h:mm:ss]` timestamp at the end of every section
// heading. Nothing here enforces that: a follow-up answer is written under no
// such prompt, a custom profile may ask for anything, and a model drifts. A
// heading without a timestamp is output to render, not a defect to report.
import { parseTimestamp } from './transcript';

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'timestamp'; label: string; seconds: number };

/** Markdown heading level, 1 (`#`) to 6 (`######`) — carried to the renderer, which emits the matching `<hN>`. */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

// `heading` carries inline content like `bullet` and `paragraph`, not raw text:
// section titles end with a timestamp, the most useful jump target in a summary.
// As raw text that timestamp would render as literal characters instead of a
// button.
//
// `level` is kept to the renderer rather than flattened. Flattened, two headings
// of different ranks rendered identically — and at the same size as bold text,
// which cost the document the one thing a heading provides: visible hierarchy.
export type Block =
  | { kind: 'heading'; level: HeadingLevel; content: Inline[] }
  | { kind: 'bullet'; content: Inline[] }
  | { kind: 'paragraph'; content: Inline[] };

// Observed forms: "1. Title" (what the prompt asks for) and "## Title" (the
// model sometimes drifts to it). All six Markdown levels are accepted, not just
// `##`/`###`: the summary prompt frames the shape of its answer, but follow-up
// questions do not (Conversation.tsx feeds answers to the same SummaryView), and
// a model there happily opens with "# Title". An unrecognised level rendered
// literally, hash included.
const HEADING_NUMBERED = /^\d+\.\s+(.*)$/;
const HEADING_HASH = /^(#{1,6})\s+(.*)$/;

/**
 * Rank given to a numbered heading ("1. Title"). 2, like `##`: it is the same
 * rank in the shape the prompt produces — a section of the summary, not its
 * overall title. Level 1 would make every numbered line a document title, larger
 * than everything around it.
 */
const NUMBERED_HEADING_LEVEL = 2;
// The required whitespace after the marker is what separates a `*` bullet from
// a line that opens on italics: "*ceci*" is a paragraph, "* ceci" is a bullet.
const BULLET = /^[-*]\s+(.*)$/;

// A `*` with whitespace against it is not an emphasis marker. CommonMark's
// flanking rules, reduced to the one thing they buy here: without them
// "2 * 3 * 4" would italicise " 3 ".
const WHITESPACE = /\s/;

/**
 * Turns the raw summary into a list of typed blocks.
 *
 * Never throws and never loses content: an unrecognised line becomes a
 * paragraph, and inside a line anything that is not a recognised construct
 * (closed emphasis, valid timestamp) stays literal text rather than being
 * dropped. That is what makes this safe to call on a document truncated
 * mid-stream: an unfinished `**bold`, `*italic` or `[12:` breaks nothing, it
 * just shows as itself until the missing part arrives in the next chunk.
 */
export function parseSummary(markdown: string): Block[] {
  if (markdown === '') return [];

  const blocks: Block[] = [];

  for (const rawLine of markdown.split('\n')) {
    // Trailing \r: tolerate CRLF text without leaking the carriage return into
    // displayed content.
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.trim() === '') continue; // nothing to show; only whitespace is dropped

    const hashMatch = HEADING_HASH.exec(line);
    if (hashMatch) {
      // The hash run's length IS the level, and the pattern already bounds it to
      // 6, so the cast can only produce a valid HeadingLevel.
      const level = (hashMatch[1]?.length ?? NUMBERED_HEADING_LEVEL) as HeadingLevel;
      blocks.push({ kind: 'heading', level, content: parseInline(hashMatch[2] ?? '') });
      continue;
    }

    const numberedMatch = HEADING_NUMBERED.exec(line);
    if (numberedMatch) {
      blocks.push({
        kind: 'heading', level: NUMBERED_HEADING_LEVEL, content: parseInline(numberedMatch[1] ?? ''),
      });
      continue;
    }

    const bulletMatch = BULLET.exec(line);
    if (bulletMatch) {
      blocks.push({ kind: 'bullet', content: parseInline(bulletMatch[1] ?? '') });
      continue;
    }

    blocks.push({ kind: 'paragraph', content: parseInline(line) });
  }

  return blocks;
}

/**
 * Single left-to-right pass: any character no recognised construct consumes is
 * copied verbatim into the current literal text. Nothing is ever dropped
 * silently — a malformed or truncated construct (no closing `**`, no closing
 * `]`, unreadable timestamp) simply stays text.
 */
function parseInline(content: string): Inline[] {
  const inlines: Inline[] = [];
  let buffer = '';
  let i = 0;

  const flush = () => {
    if (buffer !== '') {
      inlines.push({ kind: 'text', text: buffer });
      buffer = '';
    }
  };

  while (i < content.length) {
    if (content.startsWith('**', i)) {
      const close = content.indexOf('**', i + 2);
      // `close > i + 2` excludes empty bold (`****`), which has nothing to show.
      if (close !== -1 && close > i + 2) {
        flush();
        inlines.push({ kind: 'strong', text: content.slice(i + 2, close) });
        i = close + 2;
        continue;
      }
      // No closing marker (text truncated mid-stream): literal.
    }

    // Read after `**`, so a bold marker is never seen as an empty italic. A
    // truncated `**bold` reaches this branch and stays literal: its second `*`
    // closes nothing.
    if (content.charAt(i) === '*') {
      const close = content.indexOf('*', i + 1);
      // `close > i + 1` excludes `**`, already handled above.
      if (
        close > i + 1 &&
        !WHITESPACE.test(content.charAt(i + 1)) &&
        !WHITESPACE.test(content.charAt(close - 1))
      ) {
        flush();
        inlines.push({ kind: 'em', text: content.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
      // No closing marker, or whitespace against one of them: literal.
    }

    if (content.charAt(i) === '[') {
      const close = content.indexOf(']', i + 1);
      if (close !== -1) {
        const inner = content.slice(i + 1, close);
        // Reuse lib/transcript.ts's parser rather than write a second one: a
        // divergence between what the summary displays and what the transcript
        // understood would be a subtle bug. `parseTimestamp` already tolerates
        // brackets, so passing `inner` without them is equivalent.
        const seconds = parseTimestamp(inner);
        if (!Number.isNaN(seconds)) {
          flush();
          inlines.push({ kind: 'timestamp', label: inner, seconds });
          i = close + 1;
          continue;
        }
        // `[abc]`, `[99:99:99:99]`…: unreadable timestamp, stays literal rather
        // than becoming a broken button.
      }
      // No `]` (text truncated mid-stream): literal.
    }

    buffer += content.charAt(i);
    i += 1;
  }

  flush();
  return inlines;
}
