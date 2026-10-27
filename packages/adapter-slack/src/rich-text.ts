/**
 * Message bodies rebuilt from `rich_text` blocks.
 *
 * Slack flattens composer lists in `event.text` to lines starting with `•` or
 * `◦`, which are not markdown list syntax. The list structure exists only in
 * the blocks, as `rich_text_list` elements with `style`, `indent`, and
 * `offset`. `richTextBody` builds an intermediate body with mrkdwn styles,
 * Markdown list markers, and entity-encoded literal punctuation for the
 * existing mention resolution and format converter pipeline.
 */
import {
  blocktext,
  isRecord,
  type SlackEvent,
  type SlackMessageBlock,
  TABLE_BLOCK_TYPES,
} from "./event";
import { escapeSlackText } from "./format";

/** A labeled user, channel, or user group token: `<!subteam^S1|@devs>`. */
const LABELED_TOKEN_PATTERN =
  /<([@#][A-Z0-9_]+|!subteam\^[A-Z0-9_]+)\|[^<>]*>/g;
const UNLABELED_TOKEN_PATTERN = /<(?:[@#][A-Z0-9_]+|!subteam\^[A-Z0-9_]+)>/g;
const WHITESPACE_PATTERN = /\s/;
const PUNCTUATION_PATTERN = /[\p{P}\p{S}]/u;
const LEADING_INDENTATION_PATTERN = /^[ \t]/gm;
// Encode literal ASCII punctuation so CommonMark cannot interpret it as
// markup after the Slack format converter runs. Style markers are added later.
const MARKDOWN_PUNCTUATION_PATTERN =
  /[\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e]/g;
const INLINE_ELEMENT_TYPES = new Set([
  "text",
  "link",
  "emoji",
  "user",
  "broadcast",
  "channel",
  "usergroup",
  "date",
  "color",
  "team",
]);

type Mark = "bold" | "italic" | "strike" | "code";

/** Marks in nesting order, outermost first. Code must be innermost. */
const MARKS: readonly Mark[] = ["bold", "italic", "strike", "code"];
const MARKERS: Record<Mark, string> = {
  bold: "*",
  code: "`",
  italic: "_",
  strike: "~",
};

/**
 * A piece of inline content with one set of marks. `first` and `last` are
 * the characters a neighboring marker would touch, used to decide whether a
 * marker can open or close there.
 */
interface Run {
  first: string;
  last: string;
  /** Raw text to escape after the final marks are known, rather than a token. */
  literal?: boolean;
  marks: Mark[];
  text: string;
}

/**
 * Render the message body from its `rich_text` blocks when they contain a
 * list. Returns `undefined` for every other message, which keeps using
 * `event.text`.
 *
 * Only messages whose non-table blocks are all `rich_text` qualify: other
 * block types (such as an app's `section` blocks), or unsupported elements
 * inside rich text, can carry content this renderer would drop. Tables keep
 * their existing handling.
 */
export function richTextBody(event: SlackEvent): string | undefined {
  const blocks = (event.blocks ?? []).filter(
    (block) => !TABLE_BLOCK_TYPES.has(block.type)
  );
  if (
    blocks.length === 0 ||
    !blocks.every(
      (block) =>
        block.type === "rich_text" &&
        (block.elements ?? []).every(canRenderElement)
    ) ||
    !blocks.some((block) =>
      block.elements?.some((element) => element.type === "rich_text_list")
    )
  ) {
    return;
  }
  const body = blocks.map(richTextBlockMrkdwn).join("\n\n");

  // Block elements carry only IDs. `event.text` labels the same tokens
  // (`<!subteam^S…|@handle>`, `<#C…|name>`), so reuse those labels.
  const labeled = new Map<string, string>();
  for (const match of (event.text ?? "").matchAll(LABELED_TOKEN_PATTERN)) {
    labeled.set(`<${match[1]}>`, match[0]);
  }
  return body.replace(
    UNLABELED_TOKEN_PATTERN,
    (token) => labeled.get(token) ?? token
  );
}

function canRenderElement(element: SlackMessageBlock): boolean {
  switch (element.type) {
    case "rich_text_list":
      return (element.elements ?? []).every(
        (item) => item.type === "rich_text_section" && canRenderElement(item)
      );
    case "rich_text_section":
    case "rich_text_quote":
    case "rich_text_preformatted":
      return (element.elements ?? []).every((child) =>
        INLINE_ELEMENT_TYPES.has(child.type)
      );
    default:
      return false;
  }
}

/** Remove trailing newlines without a regex, which is quadratic on long runs. */
function trimTrailingNewlines(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === "\n") {
    end -= 1;
  }
  return text.slice(0, end);
}

/**
 * Render one `rich_text` block. Lists and quotes are separated from the
 * following text by a blank line so it does not become a lazy continuation
 * of the last list item or quote line.
 */
function richTextBlockMrkdwn(block: SlackMessageBlock): string {
  let result = "";
  let previous: SlackMessageBlock | undefined;
  // Content column of the most recent item at each list nesting level.
  let columns: number[] = [];

  for (const element of block.elements ?? []) {
    const isList = element.type === "rich_text_list";
    let chunk: string;
    if (isList) {
      chunk = richTextListMrkdwn(element, columns);
    } else {
      columns = [];
      chunk = richTextElementMrkdwn(element);
    }

    if (previous) {
      const previousIsList = previous.type === "rich_text_list";
      const required =
        isList !== previousIsList || previous.type === "rich_text_quote"
          ? 2
          : 1;
      const newlines = result.length - trimTrailingNewlines(result).length;
      result += "\n".repeat(Math.max(0, required - newlines));
    }
    result += chunk;
    previous = element;
  }
  return trimTrailingNewlines(result);
}

/**
 * Render one `rich_text_list`. Nested lists arrive as sibling elements with a
 * higher `indent`, so each item is indented to the content column of its
 * parent item, tracked across siblings in `columns`.
 */
function richTextListMrkdwn(
  list: SlackMessageBlock,
  columns: number[]
): string {
  const indent = Math.min(
    typeof list.indent === "number" ? list.indent : 0,
    columns.length
  );
  const base = indent === 0 ? 0 : (columns[indent - 1] ?? 0);
  const offset = typeof list.offset === "number" ? list.offset : 0;
  // `style` is typed for inline elements; on a list it is a string.
  const ordered = (list.style as unknown) === "ordered";
  const lines: string[] = [];

  for (const [index, item] of (list.elements ?? []).entries()) {
    const marker = ordered ? `${offset + index + 1}. ` : "- ";
    const column = base + marker.length;
    columns.length = indent;
    columns.push(column);
    const [first = "", ...rest] = trimTrailingNewlines(
      richTextElementMrkdwn(item)
    ).split("\n");
    lines.push(`${" ".repeat(base)}${marker}${first}`);
    for (const line of rest) {
      lines.push(`${" ".repeat(column)}${line}`);
    }
  }
  return lines.join("\n");
}

/** Render a section, quote, or preformatted element. */
function richTextElementMrkdwn(element: SlackMessageBlock): string {
  switch (element.type) {
    case "rich_text_preformatted": {
      const code = (element.elements ?? [])
        .map((child) =>
          child.type === "text"
            ? escapeSlackText(child.text ?? "")
            : blocktext(child)
        )
        .join("");
      return `\`\`\`\n${code}\n\`\`\``;
    }
    case "rich_text_quote":
      return trimTrailingNewlines(inlineMrkdwn(element.elements ?? []))
        .split("\n")
        .map((line) => `&gt; ${line}`)
        .join("\n");
    default:
      return inlineMrkdwn(element.elements ?? []);
  }
}

/**
 * Render inline elements to mrkdwn. Consecutive elements share markers, so
 * bold `a` followed by bold italic `b` renders as `*a _b_*` rather than two
 * marker pairs pressed together, which neither Slack nor CommonMark parses.
 */
function inlineMrkdwn(elements: SlackMessageBlock[]): string {
  // Protect literal indentation before adding list or quote prefixes, so
  // CommonMark cannot turn the text into a code block with encoded content.
  return renderRuns(expressibleRuns(elements.flatMap(elementRuns))).replace(
    LEADING_INDENTATION_PATTERN,
    (char) => `&#${char.charCodeAt(0)};`
  );
}

function elementRuns(element: SlackMessageBlock): Run[] {
  const style = element.style;
  const marks = isRecord(style)
    ? MARKS.filter((mark) => style[mark] === true)
    : [];

  if (element.type === "text") {
    // Markers never span a line break, so each line is its own run and the
    // break itself carries no marks.
    const runs: Run[] = [];
    for (const [index, line] of (element.text ?? "").split("\n").entries()) {
      if (index > 0) {
        runs.push({ first: "\n", last: "\n", marks: [], text: "\n" });
      }
      if (line) {
        runs.push({
          first: line[0],
          last: line.at(-1) ?? "",
          literal: true,
          marks,
          text: line,
        });
      }
    }
    return runs;
  }

  // `event.text` carries `<!here>`, which the format converter turns into
  // `@here` outside code and keeps literal inside it.
  const text =
    element.type === "broadcast" && typeof element.range === "string"
      ? `<!${element.range}>`
      : blocktext(element);
  if (!text) {
    return [];
  }
  // Mentions and links render as words after conversion, so treat their
  // edges as word characters. Emoji keep their colons.
  const edge = element.type === "emoji" ? ":" : "a";
  return [{ first: edge, last: edge, marks, text }];
}

function commonPrefix(a: readonly Mark[], b: readonly Mark[]): number {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) {
    index += 1;
  }
  return index;
}

function isSpace(char: string): boolean {
  return WHITESPACE_PATTERN.test(char);
}

function isPunctuation(char: string): boolean {
  return PUNCTUATION_PATTERN.test(char);
}

/**
 * Whether the markers that change between two runs can be written where
 * they meet. Emphasis markers need a space or punctuation on their outer
 * side (`foo*bar*` is not bold in Slack or CommonMark), and a closing marker
 * pressed against an opening one (`*a*_b_`) parses as neither. Code spans
 * open and close anywhere.
 */
function canTransition(previous: Run, next: Run): boolean {
  const shared = commonPrefix(previous.marks, next.marks);
  const closing = previous.marks.slice(shared);
  const opening = next.marks.slice(shared);
  if (isSpace(previous.last) || isSpace(next.first)) {
    return true;
  }
  const closesEmphasis = closing.some((mark) => mark !== "code");
  const opensEmphasis = opening.some((mark) => mark !== "code");
  if (closesEmphasis && opensEmphasis) {
    return false;
  }
  if (closesEmphasis) {
    return opening.includes("code") || isPunctuation(next.first);
  }
  if (opensEmphasis) {
    return closing.includes("code") || isPunctuation(previous.last);
  }
  return true;
}

/**
 * Drop marks that change where they cannot be written, such as bold that
 * starts mid-word, keeping the marks both runs share. The text is always
 * kept; only formatting that mrkdwn cannot express is lost.
 */
function expressibleRuns(runs: Run[]): Run[] {
  const result = runs.map((run) => ({ ...run, marks: [...run.marks] }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 1; index < result.length; index += 1) {
      const previous = result[index - 1];
      const next = result[index];
      if (!canTransition(previous, next)) {
        const shared = previous.marks.filter((mark) =>
          next.marks.includes(mark)
        );
        previous.marks = shared;
        next.marks = [...shared];
        changed = true;
      }
    }
  }
  return result;
}

/**
 * Write runs with their markers. Whitespace stays outside markers, since
 * `*bold *` is not bold, and every marker closes before a line break.
 */
function renderRuns(runs: Run[]): string {
  let output = "";
  let pending = "";
  let open: Mark[] = [];
  const closeFrom = (depth: number) => {
    for (let index = open.length - 1; index >= depth; index -= 1) {
      output += MARKERS[open[index]];
    }
    open = open.slice(0, depth);
  };

  for (const run of runs) {
    // A rejected style transition may have removed code. Only escape after
    // that decision, so formerly-code text cannot become Markdown syntax.
    let text = run.text;
    if (run.literal) {
      text = run.marks.includes("code")
        ? escapeSlackText(run.text)
        : run.text.replace(
            MARKDOWN_PUNCTUATION_PATTERN,
            (char) => `&#${char.charCodeAt(0)};`
          );
    }
    const core = text.trim();
    if (!core) {
      if (text.includes("\n")) {
        closeFrom(0);
      }
      pending += text;
      continue;
    }
    const leading = text.length - text.trimStart().length;
    const trailing = text.length - text.trimEnd().length;
    pending += text.slice(0, leading);

    const shared = commonPrefix(open, run.marks);
    closeFrom(shared);
    output += pending;
    pending = "";
    for (const mark of run.marks.slice(shared)) {
      output += MARKERS[mark];
    }
    open = [...run.marks];
    output += core;
    pending = text.slice(text.length - trailing);
  }
  closeFrom(0);
  return output + pending;
}
