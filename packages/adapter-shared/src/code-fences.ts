/**
 * Code-fence normalizer for platforms whose markdown-like formats use
 * Slack-style ``` fences: the platform treats text immediately after the
 * opening fence as code, while CommonMark treats it as the fence's info
 * string, silently dropping the first line. Rewriting each paired fence
 * onto its own lines preserves the content through a CommonMark parser.
 *
 * Everything the platform renders literally stays plain text: an unpaired
 * ```, a ``` inside an inline code span, and a ``` on a blockquote line.
 * Text that a closing fence pushes onto a new line gets its leading block
 * marker escaped so CommonMark cannot promote it to a blockquote, heading,
 * list, or nested fence.
 *
 * `@chat-adapter/slack/format` mirrors this algorithm for entity-escaped
 * mrkdwn (`&gt;` blockquotes, `<…>` control tokens); it cannot import this
 * module because that subpath is published dependency-free. Keep the two
 * in sync when changing either.
 */

const CODE_FENCE = "```";
const LEADING_WHITESPACE_PATTERN = /^[ \t]+/;
// Line prefixes CommonMark promotes to a block construct (blockquote,
// heading, list item, fence, thematic break, HTML).
const BLOCK_MARKER_PATTERN =
  /^(?:[<>]|#{1,6}(?=[ \t\n]|$)|[-+*](?=[ \t\n]|$)|`{3,}|~{3,}|(?:[-*_][ \t]*){3,}(?=\n|$))/;
const ORDERED_LIST_MARKER_PATTERN = /^(\d{1,9})([.)])(?=[ \t\n]|$)/;

export interface NormalizeCodeFencesOptions {
  /**
   * Convert fenced code content (e.g. resolve platform tokens). Emphasis
   * and other text-level rewrites must not run here so code stays verbatim.
   */
  convertCode?: (code: string) => string;
  /** Convert a non-code text segment to standard Markdown. */
  convertText?: (text: string) => string;
}

export function normalizeCodeFences(
  text: string,
  options: NormalizeCodeFencesOptions = {}
): string {
  const convertText = options.convertText ?? passThrough;
  const convertCode = options.convertCode ?? passThrough;
  if (!text.includes(CODE_FENCE)) {
    return convertText(text);
  }

  let result = "";
  let textStart = 0;
  let cursor = 0;
  // Set when the closing fence splits a line: the text after it lands at
  // the start of a new line, where CommonMark would promote a leading
  // block marker the platform rendered inline.
  let movedToOwnLine = false;

  const flushTextBefore = (end: number): void => {
    let segment = text.slice(textStart, end);
    if (movedToOwnLine) {
      segment = escapeLeadingBlockMarker(segment);
      movedToOwnLine = false;
    }
    result += convertText(segment);
  };

  while (cursor < text.length) {
    if (text[cursor] !== "`") {
      cursor += 1;
      continue;
    }
    if (!text.startsWith(CODE_FENCE, cursor)) {
      const spanEnd = findInlineCodeEnd(text, cursor);
      cursor = spanEnd === -1 ? cursor + 1 : spanEnd;
      continue;
    }

    const contentStart = cursor + CODE_FENCE.length;
    const contentEnd = text.indexOf(CODE_FENCE, contentStart);
    if (contentEnd === -1 || isOnBlockquoteLine(text, cursor)) {
      // The platform renders an unpaired or quoted ``` literally.
      cursor = contentStart;
      continue;
    }

    flushTextBefore(cursor);
    if (result.length > 0 && !result.endsWith("\n")) {
      result += "\n";
    }
    const content = text.slice(contentStart, contentEnd);
    result += CODE_FENCE;
    if (!content.startsWith("\n")) {
      result += "\n";
    }
    result += convertCode(content);
    if (!content.endsWith("\n")) {
      result += "\n";
    }
    result += CODE_FENCE;

    cursor = contentEnd + CODE_FENCE.length;
    textStart = cursor;
    if (cursor < text.length && text[cursor] !== "\n") {
      result += "\n";
      movedToOwnLine = true;
    }
  }

  flushTextBefore(text.length);
  return result;
}

function passThrough(value: string): string {
  return value;
}

// Platform inline code spans never cross line breaks.
function findInlineCodeEnd(text: string, index: number): number {
  const close = text.indexOf("`", index + 1);
  if (close === -1) {
    return -1;
  }
  const newline = text.indexOf("\n", index + 1);
  if (newline !== -1 && newline < close) {
    return -1;
  }
  return close + 1;
}

function isOnBlockquoteLine(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  return text.slice(lineStart, index).trimStart().startsWith(">");
}

function escapeLeadingBlockMarker(text: string): string {
  const whitespace = LEADING_WHITESPACE_PATTERN.exec(text)?.[0] ?? "";
  // Collapse the leading separator so it cannot become an indented code
  // block, then defuse any block marker now sitting at the line start.
  const prefix = whitespace.length > 0 ? " " : "";
  const rest = text.slice(whitespace.length);
  if (BLOCK_MARKER_PATTERN.test(rest)) {
    return `${prefix}\\${rest}`;
  }
  return prefix + rest.replace(ORDERED_LIST_MARKER_PATTERN, "$1\\$2");
}
