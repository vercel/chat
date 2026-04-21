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
// truncating a rendered MarkdownV2 string.
const MARKDOWN_V2_ENTITY_MARKERS = ["*", "_", "~", "`"] as const;

const MARKDOWN_V2_ELLIPSIS = "\\.\\.\\.";
const PLAIN_ELLIPSIS = "...";

/**
 * Escape text for use in normal MarkdownV2 context (outside entities).
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(MARKDOWNV2_SPECIAL_CHARS, "\\$1");
}

/**
 * Return indices of every occurrence of `marker` in `text` that is NOT
 * preceded by an odd number of backslashes (i.e. not escaped).
 */
export function findUnescapedPositions(text: string, marker: string): number[] {
  const positions: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== marker) {
      continue;
    }
    let backslashes = 0;
    let j = i - 1;
    while (j >= 0 && text[j] === "\\") {
      backslashes++;
      j--;
    }
    if (backslashes % 2 === 0) {
      positions.push(i);
    }
  }
  return positions;
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
 *  - unclosed entity delimiter (`*`, `_`, `~`, `` ` ``) left open because
 *    the slice cut between the opener and its closer
 *  - unmatched `[` from a link whose closer was cut off
 *
 * Best-effort: may drop more than strictly necessary in edge cases, but
 * guarantees the output is parseable MarkdownV2 (when the input was).
 */
function trimToMarkdownV2SafeBoundary(text: string): string {
  let current = text;
  const maxIterations = current.length + 1;

  for (let i = 0; i < maxIterations; i++) {
    if (endsWithOrphanBackslash(current)) {
      current = current.slice(0, -1);
      continue;
    }

    let minUnsafePosition = current.length;

    for (const marker of MARKDOWN_V2_ENTITY_MARKERS) {
      const positions = findUnescapedPositions(current, marker);
      if (positions.length % 2 === 1) {
        const lastUnpaired = positions.at(-1) ?? current.length;
        if (lastUnpaired < minUnsafePosition) {
          minUnsafePosition = lastUnpaired;
        }
      }
    }

    const openBrackets = findUnescapedPositions(current, "[");
    const closeBrackets = findUnescapedPositions(current, "]");
    if (openBrackets.length > closeBrackets.length) {
      const lastOpen = openBrackets.at(-1) ?? current.length;
      if (lastOpen < minUnsafePosition) {
        minUnsafePosition = lastOpen;
      }
    }

    if (minUnsafePosition >= current.length) {
      return current;
    }

    current = current.slice(0, minUnsafePosition);
  }

  return current;
}

/**
 * Truncate a rendered string to `limit` characters, appending a
 * parse-mode-appropriate ellipsis.
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
