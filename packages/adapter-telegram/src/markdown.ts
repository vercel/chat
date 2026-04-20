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
 * Escape text for use in normal MarkdownV2 context (outside entities).
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(MARKDOWNV2_SPECIAL_CHARS, "\\$1");
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

interface AstNode {
  alt?: string;
  children?: AstNode[];
  identifier?: string;
  label?: string;
  lang?: string;
  ordered?: boolean;
  type: string;
  url?: string;
  value?: string;
}

/**
 * Recursively render an mdast node as Telegram MarkdownV2 text.
 */
function renderMarkdownV2(node: AstNode): string {
  if (!node) {
    return "";
  }

  switch (node.type) {
    case "root":
      return (node.children ?? []).map(renderMarkdownV2).join("\n\n");

    case "paragraph":
      return (node.children ?? []).map(renderMarkdownV2).join("");

    case "text":
      return escapeMarkdownV2(node.value ?? "");

    case "strong":
      return `*${(node.children ?? []).map(renderMarkdownV2).join("")}*`;

    case "emphasis":
      return `_${(node.children ?? []).map(renderMarkdownV2).join("")}_`;

    case "delete":
      return `~${(node.children ?? []).map(renderMarkdownV2).join("")}~`;

    case "inlineCode":
      return `\`${escapeCodeBlock(node.value ?? "")}\``;

    case "code": {
      const lang = node.lang ?? "";
      const val = escapeCodeBlock(node.value ?? "");
      return `\`\`\`${lang}\n${val}\n\`\`\``;
    }

    case "link": {
      const linkText = (node.children ?? []).map(renderMarkdownV2).join("");
      const url = escapeLinkUrl(node.url ?? "");
      return `[${linkText}](${url})`;
    }

    case "blockquote": {
      const inner = (node.children ?? []).map(renderMarkdownV2).join("\n");
      return inner
        .split("\n")
        .map((line) => `>${line}`)
        .join("\n");
    }

    case "list":
      return (node.children ?? [])
        .map((item, i) => {
          const content = (item.children ?? [])
            .map(renderMarkdownV2)
            .join("\n");
          if (node.ordered) {
            return `${escapeMarkdownV2(`${i + 1}.`)} ${content}`;
          }
          return `\\- ${content}`;
        })
        .join("\n");

    case "listItem":
      return (node.children ?? []).map(renderMarkdownV2).join("\n");

    case "heading": {
      // Telegram has no heading syntax; render as bold
      const text = (node.children ?? []).map(renderMarkdownV2).join("");
      return `*${text}*`;
    }

    case "thematicBreak":
      return escapeMarkdownV2("———");

    case "break":
      return "\n";

    case "image": {
      const alt = escapeMarkdownV2(node.alt ?? "");
      const url = escapeLinkUrl(node.url ?? "");
      return `[${alt}](${url})`;
    }

    case "html":
      // Telegram MarkdownV2 parser rejects raw HTML; escape so it renders literally.
      return escapeMarkdownV2(node.value ?? "");

    case "linkReference":
    case "imageReference":
      // Reference-style links/images lose their reference resolution here.
      // Render the visible label as escaped text so nothing is dropped silently.
      if (node.children) {
        return node.children.map(renderMarkdownV2).join("");
      }
      return escapeMarkdownV2(node.label ?? node.identifier ?? "");

    case "definition":
      // Reference-link definitions have no visible output.
      return "";

    default:
      // Best-effort fallback for unknown/future mdast node types: render any
      // children, or escape a literal value. Keeps the renderer forward-compatible
      // without dropping content silently.
      if (node.children) {
        return node.children.map(renderMarkdownV2).join("");
      }
      if (node.value) {
        return escapeMarkdownV2(node.value);
      }
      return "";
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
    return renderMarkdownV2(transformed as unknown as AstNode).trim();
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
