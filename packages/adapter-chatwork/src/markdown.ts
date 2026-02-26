/**
 * Chatwork-specific format conversion using AST-based parsing.
 *
 * Chatwork uses a custom tag-based format:
 * - Bold: not natively supported (use emphasis markers)
 * - Quoting: [qt][qtmeta aid=xxx time=xxx]...[/qt]
 * - Code: [code]...[/code]
 * - Info blocks: [info]...[/info]
 * - Title in info: [info][title]Title[/title]Body[/info]
 * - Horizontal rule: [hr]
 * - To mentions: [To:account_id]Name
 * - Reply: [rp aid=xxx to=room_id-message_id]
 * - Piconname: [piconname:account_id]Name
 * - Links: auto-linked by Chatwork
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

export class ChatworkFormatConverter extends BaseFormatConverter {
  /**
   * Render an AST to Chatwork format.
   */
  fromAst(ast: Root): string {
    return this.fromAstWithNodeConverter(ast, (node) =>
      this.nodeToChatwork(node)
    );
  }

  /**
   * Parse Chatwork format into an AST.
   * Converts Chatwork-specific tags to standard markdown before parsing.
   */
  toAst(chatworkText: string): Root {
    let markdown = chatworkText;

    // Remove [To:xxx] mentions, keep the name after it
    markdown = markdown.replace(/\[To:(\d+)\]\s*/g, "@$1 ");

    // Remove [rp aid=xxx to=xxx-xxx] reply markers
    markdown = markdown.replace(/\[rp aid=\d+ to=[\w-]+\]\s*/g, "");

    // Remove [piconname:xxx] tags
    markdown = markdown.replace(/\[piconname:\d+\][^\n]*/g, "");

    // Convert [code]...[/code] to fenced code blocks
    markdown = markdown.replace(
      /\[code\]([\s\S]*?)\[\/code\]/g,
      "```\n$1\n```"
    );

    // Convert [info][title]Title[/title]Body[/info] to blockquote
    markdown = markdown.replace(
      /\[info\]\[title\]([\s\S]*?)\[\/title\]([\s\S]*?)\[\/info\]/g,
      "> **$1**\n> $2"
    );

    // Convert [info]...[/info] to blockquote
    markdown = markdown.replace(
      /\[info\]([\s\S]*?)\[\/info\]/g,
      "> $1"
    );

    // Convert [qt][qtmeta ...]...[/qt] to blockquote
    markdown = markdown.replace(
      /\[qt\](?:\[qtmeta[^\]]*\])?([\s\S]*?)\[\/qt\]/g,
      "> $1"
    );

    // Convert [hr] to thematic break
    markdown = markdown.replace(/\[hr\]/g, "---");

    return parseMarkdown(markdown);
  }

  /**
   * Override renderPostable to handle Chatwork-specific formatting.
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

  private nodeToChatwork(node: Content): string {
    if (isParagraphNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToChatwork(child))
        .join("");
    }

    if (isTextNode(node)) {
      return node.value;
    }

    if (isStrongNode(node)) {
      // Chatwork doesn't have native bold; use emphasis markers
      const content = getNodeChildren(node)
        .map((child) => this.nodeToChatwork(child))
        .join("");
      return `*${content}*`;
    }

    if (isEmphasisNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToChatwork(child))
        .join("");
      return `_${content}_`;
    }

    if (isDeleteNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToChatwork(child))
        .join("");
      return `~${content}~`;
    }

    if (isInlineCodeNode(node)) {
      return `\`${node.value}\``;
    }

    if (isCodeNode(node)) {
      return `[code]\n${node.value}\n[/code]`;
    }

    if (isLinkNode(node)) {
      const linkText = getNodeChildren(node)
        .map((child) => this.nodeToChatwork(child))
        .join("");
      // Chatwork auto-links URLs, but include text if different
      if (linkText === node.url || !linkText) {
        return node.url;
      }
      return `${linkText} (${node.url})`;
    }

    if (isBlockquoteNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToChatwork(child))
        .join("\n");
      return `[info]${content}[/info]`;
    }

    if (isListNode(node)) {
      return getNodeChildren(node)
        .map((item, i) => {
          const prefix = node.ordered ? `${i + 1}.` : "-";
          const content = getNodeChildren(item)
            .map((child) => this.nodeToChatwork(child))
            .join("");
          return `${prefix} ${content}`;
        })
        .join("\n");
    }

    if (isListItemNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToChatwork(child))
        .join("");
    }

    if (node.type === "break") {
      return "\n";
    }

    if (node.type === "thematicBreak") {
      return "[hr]";
    }

    // For unsupported nodes, try to extract text
    const children = getNodeChildren(node);
    if (children.length > 0) {
      return children
        .map((child) => this.nodeToChatwork(child))
        .join("");
    }
    return getNodeValue(node);
  }
}
