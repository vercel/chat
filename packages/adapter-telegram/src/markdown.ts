/**
 * Telegram format conversion.
 *
 * Telegram supports parse modes for rich formatting.
 * We emit Telegram-compatible HTML for formatted messages.
 */

import {
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
  isTableNode,
  isTextNode,
  parseMarkdown,
  type Root,
  tableToAscii,
  walkAst,
} from "chat";

export class TelegramFormatConverter extends BaseFormatConverter {
  fromAst(ast: Root): string {
    // Replace table nodes with code blocks since Telegram HTML
    // does not support tables natively.
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
    return this.fromAstWithNodeConverter(transformed, (node) =>
      this.nodeToTelegramHtml(node)
    ).trim();
  }

  toAst(text: string): Root {
    return parseMarkdown(text);
  }

  private nodeToTelegramHtml(node: Content): string {
    if (isParagraphNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToTelegramHtml(child))
        .join("");
    }

    if (isTextNode(node)) {
      return this.escapeHtmlText(node.value);
    }

    if (isStrongNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToTelegramHtml(child))
        .join("");
      return `<b>${content}</b>`;
    }

    if (isEmphasisNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToTelegramHtml(child))
        .join("");
      return `<i>${content}</i>`;
    }

    if (isDeleteNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToTelegramHtml(child))
        .join("");
      return `<s>${content}</s>`;
    }

    if (isInlineCodeNode(node)) {
      return `<code>${this.escapeHtmlText(node.value)}</code>`;
    }

    if (isCodeNode(node)) {
      const language = node.lang?.trim();
      const escapedCode = this.escapeHtmlText(node.value);
      if (language) {
        return `<pre><code class="language-${this.escapeHtmlAttribute(language)}">${escapedCode}</code></pre>`;
      }
      return `<pre>${escapedCode}</pre>`;
    }

    if (isLinkNode(node)) {
      const text = getNodeChildren(node)
        .map((child) => this.nodeToTelegramHtml(child))
        .join("");
      const label = text || this.escapeHtmlText(node.url);
      return `<a href="${this.escapeHtmlAttribute(node.url)}">${label}</a>`;
    }

    if (isBlockquoteNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToTelegramHtml(child))
        .join("");
      return `<blockquote>${content}</blockquote>`;
    }

    if (isListNode(node)) {
      return getNodeChildren(node)
        .map((item, index) => {
          const prefix = node.ordered ? `${index + 1}.` : "•";
          const content = getNodeChildren(item)
            .map((child) => this.nodeToTelegramHtml(child))
            .join("");
          return `${prefix} ${content}`;
        })
        .join("\n");
    }

    if (isListItemNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToTelegramHtml(child))
        .join("");
    }

    if (node.type === "break") {
      return "\n";
    }

    if (node.type === "thematicBreak") {
      return "──────────";
    }

    if (node.type === "html") {
      return this.escapeHtmlText(node.value);
    }

    const children = getNodeChildren(node);
    if (children.length > 0) {
      return children.map((child) => this.nodeToTelegramHtml(child)).join("");
    }

    return this.escapeHtmlText(getNodeValue(node));
  }

  private escapeHtmlText(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private escapeHtmlAttribute(value: string): string {
    return this.escapeHtmlText(value)
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}
