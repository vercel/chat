/**
 * Google Chat-specific format conversion using AST-based parsing.
 *
 * Google Chat supports a subset of text formatting:
 * - Bold: *text*
 * - Italic: _text_
 * - Strikethrough: ~text~
 * - Monospace: `text`
 * - Code blocks: ```text```
 * - Links are auto-detected
 *
 * Very similar to Slack's mrkdwn format.
 */

import {
  BaseFormatConverter,
  type Content,
  getNodeChildren,
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
} from "chat";

export class GoogleChatFormatConverter extends BaseFormatConverter {
  /**
   * Render an AST to Google Chat format.
   */
  fromAst(ast: Root): string {
    return this.fromAstWithNodeConverter(ast, (node) => this.nodeToGChat(node));
  }

  /**
   * Parse Google Chat message into an AST.
   */
  toAst(gchatText: string): Root {
    // Convert Google Chat format to standard markdown, then parse
    let markdown = gchatText;

    // Bold: *text* -> **text**
    markdown = markdown.replace(/(?<![_*\\])\*([^*\n]+)\*(?![_*])/g, "**$1**");

    // Strikethrough: ~text~ -> ~~text~~
    markdown = markdown.replace(/(?<!~)~([^~\n]+)~(?!~)/g, "~~$1~~");

    // Italic and code are the same format as markdown

    return parseMarkdown(markdown);
  }

  private nodeToGChat(node: Content): string {
    // Use type guards for type-safe node handling
    if (isParagraphNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToGChat(child))
        .join("");
    }

    if (isTextNode(node)) {
      // Google Chat: @mentions are passed through as-is
      // To create clickable mentions in Google Chat, you'd need to use <users/{user_id}> format
      // which requires user ID lookup - beyond the scope of format conversion
      return node.value;
    }

    if (isStrongNode(node)) {
      // Markdown **text** -> GChat *text*
      const content = getNodeChildren(node)
        .map((child) => this.nodeToGChat(child))
        .join("");
      return `*${content}*`;
    }

    if (isEmphasisNode(node)) {
      // Both use _text_
      const content = getNodeChildren(node)
        .map((child) => this.nodeToGChat(child))
        .join("");
      return `_${content}_`;
    }

    if (isDeleteNode(node)) {
      // Markdown ~~text~~ -> GChat ~text~
      const content = getNodeChildren(node)
        .map((child) => this.nodeToGChat(child))
        .join("");
      return `~${content}~`;
    }

    if (isInlineCodeNode(node)) {
      return `\`${node.value}\``;
    }

    if (isCodeNode(node)) {
      return `\`\`\`\n${node.value}\n\`\`\``;
    }

    if (isLinkNode(node)) {
      // Google Chat auto-detects links, so we just output the URL
      const linkText = getNodeChildren(node)
        .map((child) => this.nodeToGChat(child))
        .join("");
      // If link text matches URL, just output URL
      if (linkText === node.url) {
        return node.url;
      }
      // Otherwise output "text (url)"
      return `${linkText} (${node.url})`;
    }

    if (isBlockquoteNode(node)) {
      // Google Chat doesn't have native blockquote, use > prefix
      return getNodeChildren(node)
        .map((child) => `> ${this.nodeToGChat(child)}`)
        .join("\n");
    }

    if (isListNode(node)) {
      return getNodeChildren(node)
        .map((item, i) => {
          const prefix = node.ordered ? `${i + 1}.` : "•";
          const content = getNodeChildren(item)
            .map((child) => this.nodeToGChat(child))
            .join("");
          return `${prefix} ${content}`;
        })
        .join("\n");
    }

    if (isListItemNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToGChat(child))
        .join("");
    }

    if (node.type === "break") {
      return "\n";
    }

    if (node.type === "thematicBreak") {
      return "---";
    }

    if (isTableNode(node)) {
      return `\`\`\`\n${tableToAscii(node)}\n\`\`\``;
    }

    return this.defaultNodeToText(node, (child) => this.nodeToGChat(child));
  }
}
