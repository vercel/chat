/**
 * Feishu-specific format conversion using AST-based parsing.
 *
 * Feishu uses a variant of markdown with some differences:
 * - Bold: **text** (standard)
 * - Italic: *text* (standard)
 * - Strikethrough: ~~text~~ (standard GFM)
 * - Links: [text](url) (standard)
 * - User mentions: <at user_id="xxx">name</at>
 * - Inline code: `code` (standard)
 * - Code blocks: ```lang\ncode\n``` (standard)
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

export class FeishuFormatConverter extends BaseFormatConverter {
  /**
   * Convert @mentions to Feishu format in plain text.
   * @name → <at user_id="name">name</at>
   */
  private convertMentionsToFeishu(text: string): string {
    return text.replace(/@([\w.-]+)/g, '<at user_id="$1">$1</at>');
  }

  /**
   * Override renderPostable to convert @mentions in plain strings.
   */
  override renderPostable(message: AdapterPostableMessage): string {
    if (typeof message === "string") {
      return this.convertMentionsToFeishu(message);
    }
    if ("raw" in message) {
      return this.convertMentionsToFeishu(message.raw);
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
   * Render an AST to Feishu markdown format.
   */
  fromAst(ast: Root): string {
    return this.fromAstWithNodeConverter(ast, (node) =>
      this.nodeToFeishuMarkdown(node)
    );
  }

  /**
   * Parse Feishu markdown into an AST.
   */
  toAst(feishuText: string): Root {
    // Convert Feishu-specific formats to standard markdown, then parse
    let markdown = feishuText;

    // User mentions: <at user_id="xxx">name</at> -> @name
    markdown = markdown.replace(/<at user_id="[^"]*">([^<]*)<\/at>/g, "@$1");

    return parseMarkdown(markdown);
  }

  private nodeToFeishuMarkdown(node: Content): string {
    // Use type guards for type-safe node handling
    if (isParagraphNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToFeishuMarkdown(child))
        .join("");
    }

    if (isTextNode(node)) {
      // Convert @mentions to Feishu format
      return node.value.replace(/@([\w.-]+)/g, '<at user_id="$1">$1</at>');
    }

    if (isStrongNode(node)) {
      // Standard markdown **text**
      const content = getNodeChildren(node)
        .map((child) => this.nodeToFeishuMarkdown(child))
        .join("");
      return `**${content}**`;
    }

    if (isEmphasisNode(node)) {
      // Standard markdown *text*
      const content = getNodeChildren(node)
        .map((child) => this.nodeToFeishuMarkdown(child))
        .join("");
      return `*${content}*`;
    }

    if (isDeleteNode(node)) {
      // Standard GFM ~~text~~
      const content = getNodeChildren(node)
        .map((child) => this.nodeToFeishuMarkdown(child))
        .join("");
      return `~~${content}~~`;
    }

    if (isInlineCodeNode(node)) {
      return `\`${node.value}\``;
    }

    if (isCodeNode(node)) {
      return `\`\`\`${node.lang || ""}\n${node.value}\n\`\`\``;
    }

    if (isLinkNode(node)) {
      const linkText = getNodeChildren(node)
        .map((child) => this.nodeToFeishuMarkdown(child))
        .join("");
      // Standard markdown [text](url)
      return `[${linkText}](${node.url})`;
    }

    if (isBlockquoteNode(node)) {
      return getNodeChildren(node)
        .map((child) => `> ${this.nodeToFeishuMarkdown(child)}`)
        .join("\n");
    }

    if (isListNode(node)) {
      return getNodeChildren(node)
        .map((item, i) => {
          const prefix = node.ordered ? `${i + 1}.` : "-";
          const content = getNodeChildren(item)
            .map((child) => this.nodeToFeishuMarkdown(child))
            .join("");
          return `${prefix} ${content}`;
        })
        .join("\n");
    }

    if (isListItemNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToFeishuMarkdown(child))
        .join("");
    }

    if (node.type === "break") {
      return "\n";
    }

    if (node.type === "thematicBreak") {
      return "---";
    }

    // For unsupported nodes, try to extract text
    const children = getNodeChildren(node);
    if (children.length > 0) {
      return children.map((child) => this.nodeToFeishuMarkdown(child)).join("");
    }
    return getNodeValue(node);
  }
}
