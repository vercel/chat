/**
 * Telegram-specific format conversion using AST-based parsing.
 *
 * Telegram uses MarkdownV2 format:
 * - Bold: *text*
 * - Italic: _text_
 * - Underline: __text__
 * - Strikethrough: ~text~
 * - Code: `code`
 * - Pre: ```pre```
 * - Links: [text](url)
 * - Mentions: [name](tg://user?id=123) or @username
 *
 * Special characters that need escaping in MarkdownV2:
 * _ * [ ] ( ) ~ ` > # + - = | { } . !
 */

import {
  type AdapterPostableMessage,
  BaseFormatConverter,
  type Content,
  getNodeChildren,
  getNodeValue,
  isBlockquoteNode,
  isCodeNode,
  isDeleteNode,
  isEmphasisNode,
  isInlineCodeNode,
  isLinkNode,
  isListItemNode,
  isListNode,
  isParagraphNode,
  isStrongNode,
  isTextNode,
  parseMarkdown,
  type Root,
} from "chat";

/** Characters that must be escaped in Telegram MarkdownV2 text */
const MARKDOWNV2_SPECIAL_CHARS = /[_*[\]()~`>#+\-=|{}.!\\]/g;

/** Escape text for use in Telegram MarkdownV2 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(MARKDOWNV2_SPECIAL_CHARS, "\\$&");
}

export class TelegramFormatConverter extends BaseFormatConverter {
  /**
   * Override renderPostable for Telegram-specific formatting.
   */
  override renderPostable(message: AdapterPostableMessage): string {
    if (typeof message === "string") {
      return message;
    }
    if ("raw" in message) {
      return message.raw;
    }
    if ("markdown" in message) {
      return this.fromAst(parseMarkdown(message.markdown));
    }
    if ("ast" in message) {
      return this.fromAst(message.ast);
    }
    return "";
  }

  /**
   * Render an AST to Telegram MarkdownV2 format.
   */
  fromAst(ast: Root): string {
    return this.fromAstWithNodeConverter(ast, (node) =>
      this.nodeToMarkdownV2(node)
    );
  }

  /**
   * Parse Telegram text into an AST.
   * Telegram messages arrive as plain text with entities, but we handle
   * MarkdownV2 formatted text as well for round-trip conversion.
   */
  toAst(text: string): Root {
    // Remove MarkdownV2 escapes to get plain markdown
    let markdown = text.replace(/\\([_*[\]()~`>#+\-=|{}.!])/g, "$1");

    // Telegram MarkdownV2 bold is *text*, same as Slack
    // Convert to standard markdown **text**
    markdown = markdown.replace(/(?<![_*\\])\*([^*\n]+)\*(?![_*])/g, "**$1**");

    // Telegram strikethrough: ~text~ -> ~~text~~
    markdown = markdown.replace(/(?<!~)~([^~\n]+)~(?!~)/g, "~~$1~~");

    // Telegram underline __text__ is non-standard, strip the underline markers
    markdown = markdown.replace(/__([^_]+)__/g, "$1");

    return parseMarkdown(markdown);
  }

  private nodeToMarkdownV2(node: Content): string {
    if (isParagraphNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToMarkdownV2(child))
        .join("");
    }

    if (isTextNode(node)) {
      return escapeMarkdownV2(node.value);
    }

    if (isStrongNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToMarkdownV2(child))
        .join("");
      return `*${content}*`;
    }

    if (isEmphasisNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToMarkdownV2(child))
        .join("");
      return `_${content}_`;
    }

    if (isDeleteNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToMarkdownV2(child))
        .join("");
      return `~${content}~`;
    }

    if (isInlineCodeNode(node)) {
      return `\`${node.value}\``;
    }

    if (isCodeNode(node)) {
      const lang = node.lang ? node.lang : "";
      return `\`\`\`${lang}\n${node.value}\n\`\`\``;
    }

    if (isLinkNode(node)) {
      const linkText = getNodeChildren(node)
        .map((child) => this.nodeToMarkdownV2(child))
        .join("");
      return `[${linkText}](${escapeMarkdownV2(node.url)})`;
    }

    if (isBlockquoteNode(node)) {
      return getNodeChildren(node)
        .map((child) => `>${this.nodeToMarkdownV2(child)}`)
        .join("\n");
    }

    if (isListNode(node)) {
      return getNodeChildren(node)
        .map((item, i) => {
          const prefix = node.ordered
            ? `${escapeMarkdownV2(`${i + 1}.`)}`
            : escapeMarkdownV2("•");
          const content = getNodeChildren(item)
            .map((child) => this.nodeToMarkdownV2(child))
            .join("");
          return `${prefix} ${content}`;
        })
        .join("\n");
    }

    if (isListItemNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToMarkdownV2(child))
        .join("");
    }

    if (node.type === "break") {
      return "\n";
    }

    if (node.type === "thematicBreak") {
      return escapeMarkdownV2("---");
    }

    // For unsupported nodes, try to extract text
    const children = getNodeChildren(node);
    if (children.length > 0) {
      return children.map((child) => this.nodeToMarkdownV2(child)).join("");
    }
    return escapeMarkdownV2(getNodeValue(node));
  }
}
