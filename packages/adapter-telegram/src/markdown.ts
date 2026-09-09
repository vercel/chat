/**
 * Telegram MarkdownV2 format conversion.
 *
 * Renders markdown AST as Telegram MarkdownV2, which requires escaping
 * special characters outside of entities. This replaces the previous
 * approach of emitting standard markdown with legacy parse_mode "Markdown",
 * which was incompatible (standard markdown uses **bold** while Telegram
 * legacy uses *bold*) and caused "can't parse entities" errors.
 *
 * @see https://core.telegram.org/bots/api#markdownv2-style
 */

import {
  type AdapterPostableMessage,
  BaseFormatConverter,
  type Content,
  isTableNode,
  type Nodes,
  parseMarkdown,
  type Root,
  tableToAscii,
  walkAst,
} from "chat";

// MarkdownV2 requires escaping these characters in normal text:
// _ * [ ] ( ) ~ ` > # + - = | { } . ! \
const MARKDOWNV2_SPECIAL_CHARS = /([_*[\]()~`>#+\-=|{}.!\\])/g;

// Inside ``` code blocks, only ` and \ need escaping
const CODE_BLOCK_SPECIAL_CHARS = /([`\\])/g;

// Inside (...) of inline links, only ) and \ need escaping
const LINK_URL_SPECIAL_CHARS = /([)\\])/g;

/**
 * How the adapter intends a message to be rendered.
 *
 * - `"MarkdownV2"` — the body was produced by the MarkdownV2 renderer and
 *   must be parsed by Telegram with `parse_mode: "MarkdownV2"`.
 * - `"plain"` — the body ships verbatim with no markdown parsing (the Bot
 *   API receives no `parse_mode` field).
 *
 * Internal type; the Bot API wire value is obtained via `toBotApiParseMode`.
 */
export type TelegramParseMode = "MarkdownV2" | "plain";

/**
 * Translate the internal parse mode to the Bot API `parse_mode` field.
 * Returns `undefined` for plain messages so the field is omitted.
 */
export function toBotApiParseMode(
  mode: TelegramParseMode
): "MarkdownV2" | undefined {
  return mode === "MarkdownV2" ? "MarkdownV2" : undefined;
}

/** Maximum length of a Telegram text message body in characters. */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

/** Maximum length of a media caption (photo/document/etc.) in characters. */
export const TELEGRAM_CAPTION_LIMIT = 1024;

// Entity delimiters whose opener/closer pairing must be preserved when
// truncating a rendered MarkdownV2 string. Telegram reads `__` as underline,
// which pairs separately from single `_` italics.
const MARKDOWN_V2_ENTITY_MARKERS = ["*", "_", "__", "~", "`"] as const;

type EntityMarker = (typeof MARKDOWN_V2_ENTITY_MARKERS)[number];

const MARKDOWN_V2_ELLIPSIS = "\\.\\.\\.";
const PLAIN_ELLIPSIS = "...";

/**
 * Escape text for use in normal MarkdownV2 context (outside entities).
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(MARKDOWNV2_SPECIAL_CHARS, "\\$1");
}

interface DelimiterScan {
  /** Number of `]` that close a link label. */
  closeBrackets: number;
  /**
   * Unescaped entity delimiter positions outside code and link URLs. Fences
   * and `__` record one position per delimiter so a cut through an opener
   * retreats to its first character.
   */
  markers: Record<EntityMarker, number[]>;
  /** Unescaped `[` positions outside code and link URLs. */
  openBrackets: number[];
}

/**
 * Single pass over a MarkdownV2 string collecting every delimiter the trimmer
 * pairs up. Markers inside fenced code, inline code, or the `(...)` part of a
 * link are literal text and are skipped.
 */
function scanDelimiters(text: string): DelimiterScan {
  const markers: Record<EntityMarker, number[]> = {
    "*": [],
    _: [],
    __: [],
    "~": [],
    "`": [],
  };
  const openBrackets: number[] = [];
  let closeBrackets = 0;
  let inFence = false;
  let inInline = false;
  let inLinkUrl = false;
  let backslashes = 0;
  const lastIndex = text.length - 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === "\\") {
      backslashes++;
      continue;
    }

    const escaped = backslashes % 2 === 1;
    backslashes = 0;
    if (escaped) {
      continue;
    }

    if (inLinkUrl) {
      // A link's `]` only counts toward bracket pairing once its URL
      // closes, so a slice mid-URL leaves the `[` unmatched.
      if (ch === ")") {
        inLinkUrl = false;
        closeBrackets++;
      }
      continue;
    }

    if (ch === "`") {
      if (!inInline && text.startsWith("```", i)) {
        markers["`"].push(i);
        inFence = !inFence;
        i += 2;
        continue;
      }
      if (inFence) {
        continue;
      }
      markers["`"].push(i);
      // A slice that ends in two opening backticks is a cut fence, not a
      // balanced empty inline-code span.
      if (!inInline && i + 2 === text.length && text[i + 1] === "`") {
        i += 1;
      }
      inInline = !inInline;
      continue;
    }

    if (inFence || inInline) {
      continue;
    }

    if (ch === "[") {
      openBrackets.push(i);
      continue;
    }

    if (ch === "]") {
      if (text[i + 1] === "(") {
        inLinkUrl = true;
        i += 1;
      } else if (i < lastIndex) {
        // Telegram accepts a bare `[label]`; only a `]` that ends the slice
        // may have lost its `(url)` to the cut.
        closeBrackets++;
      }
      continue;
    }

    if (ch === "_") {
      if (text[i + 1] === "_") {
        markers.__.push(i);
        i += 1;
      } else {
        markers._.push(i);
      }
      continue;
    }

    if (ch === "*" || ch === "~") {
      markers[ch].push(i);
    }
  }

  return { markers, openBrackets, closeBrackets };
}

export function endsWithOrphanBackslash(text: string): boolean {
  let trailing = 0;
  for (let i = text.length - 1; i >= 0 && text[i] === "\\"; i--) {
    trailing++;
  }
  return trailing % 2 === 1;
}

/**
 * Drop any trailing characters that would produce invalid MarkdownV2 after
 * a length-based truncation:
 *
 *  - orphan trailing `\` (would escape the appended ellipsis or nothing)
 *  - unclosed entity delimiter (`*`, `_`, `__`, `~`, `` ` ``) left open
 *    because the slice cut between the opener and its closer
 *  - unmatched `[` from a link whose closer was cut off, or whose `(...)`
 *    URL part was left unterminated by the slice
 *
 * Best-effort: may drop more than strictly necessary in edge cases, but
 * guarantees the output is parseable MarkdownV2 (when the input was).
 *
 * Exported for tests; production callers go through `truncateForTelegram`.
 */
export function trimToMarkdownV2SafeBoundary(text: string): string {
  let current = text;
  const maxIterations = current.length + 1;

  for (let i = 0; i < maxIterations; i++) {
    if (endsWithOrphanBackslash(current)) {
      current = current.slice(0, -1);
      continue;
    }

    const scan = scanDelimiters(current);
    let cut = current.length;

    for (const marker of MARKDOWN_V2_ENTITY_MARKERS) {
      const positions = scan.markers[marker];
      if (positions.length % 2 === 1) {
        cut = Math.min(cut, positions.at(-1) ?? cut);
      }
    }

    if (scan.openBrackets.length > scan.closeBrackets) {
      cut = Math.min(cut, scan.openBrackets.at(-1) ?? cut);
    }

    if (cut >= current.length) {
      return current;
    }

    current = current.slice(0, cut);
  }

  return current;
}

/**
 * Truncate a rendered string to `limit` characters, appending a
 * parse-mode-appropriate ellipsis.
 *
 * Text that fits the limit is returned unchanged: the MarkdownV2 renderer
 * emits balanced entities, so there is nothing to repair, and a trim there
 * could only delete valid content.
 *
 * For MarkdownV2, the naive slice + "..." is unsafe: `.` is reserved and
 * must be escaped, and the slice can leave orphan escape characters (`\`)
 * or cut through a paired entity (`*bold*`, `` `code` ``) resulting in
 * `Bad Request: can't parse entities`. This function uses an escaped
 * ellipsis (`\.\.\.`) and trims back past any unbalanced entity delimiter
 * or orphan backslash before appending.
 */
export function truncateForTelegram(
  text: string,
  limit: number,
  parseMode: TelegramParseMode
): string {
  if (text.length <= limit) {
    return text;
  }

  const isMarkdownV2 = parseMode === "MarkdownV2";
  const ellipsis = isMarkdownV2 ? MARKDOWN_V2_ELLIPSIS : PLAIN_ELLIPSIS;
  let slice = text.slice(0, limit - ellipsis.length);

  if (isMarkdownV2) {
    slice = trimToMarkdownV2SafeBoundary(slice);
  }

  return `${slice}${ellipsis}`;
}

/**
 * Escape text inside code/pre blocks (only ` and \ need escaping).
 */
function escapeCodeBlock(text: string): string {
  return text.replace(CODE_BLOCK_SPECIAL_CHARS, "\\$1");
}

/**
 * Escape text inside link URLs (only ) and \ need escaping).
 */
function escapeLinkUrl(text: string): string {
  return text.replace(LINK_URL_SPECIAL_CHARS, "\\$1");
}

/**
 * Recursively render an mdast node as Telegram MarkdownV2 text.
 */
function renderMarkdownV2(node: Nodes): string {
  switch (node.type) {
    case "root":
      return node.children.map(renderMarkdownV2).join("\n\n");

    case "paragraph":
      return node.children.map(renderMarkdownV2).join("");

    case "text":
      return escapeMarkdownV2(node.value);

    case "strong":
      return `*${node.children.map(renderMarkdownV2).join("")}*`;

    case "emphasis":
      return `_${node.children.map(renderMarkdownV2).join("")}_`;

    case "delete":
      return `~${node.children.map(renderMarkdownV2).join("")}~`;

    case "inlineCode":
      return `\`${escapeCodeBlock(node.value)}\``;

    case "code": {
      const lang = node.lang ?? "";
      const val = escapeCodeBlock(node.value);
      return `\`\`\`${lang}\n${val}\n\`\`\``;
    }

    case "link": {
      const linkText = node.children.map(renderMarkdownV2).join("");
      const url = escapeLinkUrl(node.url);
      return `[${linkText}](${url})`;
    }

    case "blockquote": {
      const inner = node.children.map(renderMarkdownV2).join("\n");
      return inner
        .split("\n")
        .map((line) => `>${line}`)
        .join("\n");
    }

    case "list":
      return node.children
        .map((item, i) => {
          const content = item.children.map(renderMarkdownV2).join("\n");
          if (node.ordered) {
            return `${escapeMarkdownV2(`${i + 1}.`)} ${content}`;
          }
          return `\\- ${content}`;
        })
        .join("\n");

    case "listItem":
      return node.children.map(renderMarkdownV2).join("\n");

    case "heading": {
      // Telegram has no heading syntax; render as bold
      const text = node.children.map(renderMarkdownV2).join("");
      return `*${text}*`;
    }

    case "thematicBreak":
      return escapeMarkdownV2("———");

    case "break":
      return "\n";

    case "image": {
      const alt = escapeMarkdownV2(node.alt ?? "");
      const url = escapeLinkUrl(node.url);
      return `[${alt}](${url})`;
    }

    case "html":
      // Telegram MarkdownV2 parser rejects raw HTML; escape so it renders literally.
      return escapeMarkdownV2(node.value);

    case "linkReference":
    case "imageReference":
      // Reference-style links/images lose their reference resolution here.
      // Render the visible label as escaped text so nothing is dropped silently.
      if ("children" in node && node.children.length > 0) {
        return node.children.map(renderMarkdownV2).join("");
      }
      return escapeMarkdownV2(node.label ?? node.identifier);

    case "definition":
      // Reference-link definitions have no visible output.
      return "";

    case "footnoteDefinition":
      // Hidden — footnote bodies aren't rendered inline in chat.
      return "";

    case "footnoteReference":
      // No footnotes UI in Telegram; surface the label so it's not dropped.
      return escapeMarkdownV2(`[^${node.label ?? node.identifier}]`);

    case "yaml":
      // Frontmatter isn't visible in chat messages.
      return "";

    case "table":
    case "tableRow":
    case "tableCell":
      // `fromAst` walks the AST and rewrites Table nodes to Code blocks before
      // calling this renderer. A table arriving here means that preprocessing
      // was skipped — a contract violation, not a rendering decision.
      throw new Error(
        `Telegram MarkdownV2 renderer received a ${node.type} node; fromAst should have preprocessed it into a code block.`
      );

    default: {
      throw new Error(`Unhandled case: ${node satisfies never}`);
    }
  }
}

export class TelegramFormatConverter extends BaseFormatConverter {
  fromAst(ast: Root): string {
    // Check for table nodes and replace them with code blocks,
    // since Telegram renders raw pipe syntax as garbled text.
    const transformed = walkAst(structuredClone(ast), (node: Content) => {
      if (isTableNode(node)) {
        return {
          type: "code" as const,
          value: tableToAscii(node),
          lang: undefined,
        } as Content;
      }
      return node;
    });
    return renderMarkdownV2(transformed).trim();
  }

  toAst(text: string): Root {
    return parseMarkdown(text);
  }

  override renderPostable(message: AdapterPostableMessage): string {
    if (typeof message === "string") {
      return message;
    }
    if ("raw" in message) {
      return message.raw;
    }
    if ("markdown" in message) {
      return this.fromMarkdown(message.markdown);
    }
    if ("ast" in message) {
      return this.fromAst(message.ast);
    }
    return super.renderPostable(message);
  }
}
