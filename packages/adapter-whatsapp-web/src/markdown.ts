/**
 * WhatsApp-specific format conversion using AST-based parsing.
 *
 * WhatsApp uses a format similar to markdown but with some differences:
 * - Bold: *text*
 * - Italic: _text_
 * - Strikethrough: ~text~
 * - Monospace: ```text```
 * - No link syntax (URLs are auto-linked by the client)
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

export class WhatsAppFormatConverter extends BaseFormatConverter {
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

  fromAst(ast: Root): string {
    return this.fromAstWithNodeConverter(ast, (node) =>
      this.nodeToWhatsApp(node)
    );
  }

  toAst(text: string): Root {
    let markdown = text;

    // WhatsApp bold: *text* is already standard markdown single asterisk
    // but we treat it as bold (like Slack), so convert to double **
    markdown = markdown.replace(/(?<![_*\\])\*([^*\n]+)\*(?![_*])/g, "**$1**");

    // WhatsApp strikethrough: ~text~ -> ~~text~~
    markdown = markdown.replace(/(?<!~)~([^~\n]+)~(?!~)/g, "~~$1~~");

    // WhatsApp monospace: ```text``` is already standard markdown
    // Single backtick is not supported in WhatsApp

    return parseMarkdown(markdown);
  }

  private nodeToWhatsApp(node: Content): string {
    if (isParagraphNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToWhatsApp(child))
        .join("");
    }

    if (isTextNode(node)) {
      return node.value;
    }

    if (isStrongNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToWhatsApp(child))
        .join("");
      return `*${content}*`;
    }

    if (isEmphasisNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToWhatsApp(child))
        .join("");
      return `_${content}_`;
    }

    if (isDeleteNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToWhatsApp(child))
        .join("");
      return `~${content}~`;
    }

    if (isInlineCodeNode(node)) {
      return `\`\`\`${node.value}\`\`\``;
    }

    if (isCodeNode(node)) {
      return `\`\`\`${node.value}\`\`\``;
    }

    if (isLinkNode(node)) {
      const linkText = getNodeChildren(node)
        .map((child) => this.nodeToWhatsApp(child))
        .join("");
      // WhatsApp auto-links URLs, so just output the URL if text matches, otherwise text + URL
      if (linkText === node.url || !linkText) {
        return node.url;
      }
      return `${linkText}: ${node.url}`;
    }

    if (isBlockquoteNode(node)) {
      return getNodeChildren(node)
        .map((child) => `> ${this.nodeToWhatsApp(child)}`)
        .join("\n");
    }

    if (isListNode(node)) {
      return getNodeChildren(node)
        .map((item, i) => {
          const prefix = node.ordered ? `${i + 1}.` : "•";
          const content = getNodeChildren(item)
            .map((child) => this.nodeToWhatsApp(child))
            .join("");
          return `${prefix} ${content}`;
        })
        .join("\n");
    }

    if (isListItemNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToWhatsApp(child))
        .join("");
    }

    if (node.type === "break") {
      return "\n";
    }

    if (node.type === "thematicBreak") {
      return "---";
    }

    const children = getNodeChildren(node);
    if (children.length > 0) {
      return children.map((child) => this.nodeToWhatsApp(child)).join("");
    }
    return getNodeValue(node);
  }
}
