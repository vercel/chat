/**
 * Telegram format conversion.
 *
 * Telegram's `MarkdownV2` parse mode requires every occurrence of the
 * reserved characters `_ * [ ] ( ) ~ ` > # + - = | { } . !` to be
 * escaped with a preceding `\` outside of formatting entities. The
 * plain markdown produced by `remark-stringify` does not satisfy this
 * rule, which made Telegram reject messages that contained perfectly
 * ordinary punctuation (periods, parentheses, dashes, pipes, …).
 *
 * This converter walks the mdast AST directly and emits MarkdownV2
 * with context-aware escaping so the resulting string is always safe
 * to send with `parse_mode: "MarkdownV2"`.
 */

import {
  type AdapterPostableMessage,
  BaseFormatConverter,
  type Content,
  getNodeChildren,
  isBlockquoteNode,
  isCodeNode,
  isDeleteNode,
  isEmphasisNode,
  isInlineCodeNode,
  isLinkNode,
  isListNode,
  isParagraphNode,
  isStrongNode,
  isTableNode,
  isTextNode,
  parseMarkdown,
  type Root,
  tableToAscii,
} from "chat";

// Reserved MarkdownV2 characters that must be escaped in regular text.
// Order matters for the regex: backslash is handled separately first so
// we don't double-escape already-escaped characters we emit ourselves.
const MARKDOWN_V2_RESERVED = /[_*[\]()~`>#+\-=|{}.!]/g;

// Inside `code` and `pre` entities only `\` and `` ` `` need escaping.
const MARKDOWN_V2_CODE_RESERVED = /[`\\]/g;

// Inside the `(url)` portion of a link only `)` and `\` need escaping.
const MARKDOWN_V2_LINK_URL_RESERVED = /[)\\]/g;

function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(MARKDOWN_V2_RESERVED, (char) => `\\${char}`);
}

function escapeCode(text: string): string {
  return text.replace(MARKDOWN_V2_CODE_RESERVED, (char) => `\\${char}`);
}

function escapeLinkUrl(url: string): string {
  return url.replace(MARKDOWN_V2_LINK_URL_RESERVED, (char) => `\\${char}`);
}

export class TelegramFormatConverter extends BaseFormatConverter {
  fromAst(ast: Root): string {
    const parts: string[] = [];
    for (const node of ast.children) {
      parts.push(this.nodeToMarkdownV2(node as Content));
    }
    return parts.join("\n\n").trim();
  }

  toAst(text: string): Root {
    return parseMarkdown(text);
  }

  override renderPostable(message: AdapterPostableMessage): string {
    if (typeof message === "string") {
      return escapeText(message);
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

  private nodeToMarkdownV2(node: Content): string {
    if (isParagraphNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToMarkdownV2(child))
        .join("");
    }

    if (isTextNode(node)) {
      return escapeText(node.value);
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
      return `\`${escapeCode(node.value)}\``;
    }

    if (isCodeNode(node)) {
      const lang = node.lang ?? "";
      return `\`\`\`${lang}\n${escapeCode(node.value)}\n\`\`\``;
    }

    if (isLinkNode(node)) {
      const linkText = getNodeChildren(node)
        .map((child) => this.nodeToMarkdownV2(child))
        .join("");
      return `[${linkText}](${escapeLinkUrl(node.url)})`;
    }

    if (isBlockquoteNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToMarkdownV2(child))
        .join("\n")
        .split("\n")
        .map((line) => `>${line}`)
        .join("\n");
    }

    if (isListNode(node)) {
      return this.renderMarkdownV2List(node, 0);
    }

    if (node.type === "break") {
      return "\n";
    }

    if (node.type === "thematicBreak") {
      return "\\-\\-\\-";
    }

    if (isTableNode(node)) {
      return `\`\`\`\n${escapeCode(tableToAscii(node))}\n\`\`\``;
    }

    if (node.type === "heading") {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToMarkdownV2(child))
        .join("");
      return `*${content}*`;
    }

    return escapeText(
      this.defaultNodeToText(node, (child) => {
        if (isTextNode(child)) {
          return child.value;
        }
        return this.defaultNodeToText(child, () => "");
      })
    );
  }

  private renderMarkdownV2List(node: Content, depth: number): string {
    if (!isListNode(node)) {
      return "";
    }
    const indent = "  ".repeat(depth);
    const start = node.start ?? 1;
    const lines: string[] = [];
    for (const [i, item] of getNodeChildren(node).entries()) {
      const prefix = node.ordered ? `${start + i}\\.` : "\\-";
      let isFirstContent = true;
      for (const child of getNodeChildren(item)) {
        if (isListNode(child)) {
          lines.push(this.renderMarkdownV2List(child, depth + 1));
          continue;
        }
        const rendered = this.nodeToMarkdownV2(child);
        if (!rendered.trim()) {
          continue;
        }
        if (isFirstContent) {
          lines.push(`${indent}${prefix} ${rendered}`);
          isFirstContent = false;
        } else {
          lines.push(`${indent}  ${rendered}`);
        }
      }
    }
    return lines.join("\n");
  }
}
