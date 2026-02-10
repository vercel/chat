/**
 * Slack-specific format conversion using AST-based parsing.
 *
 * Slack uses "mrkdwn" format which is similar but not identical to markdown:
 * - Bold: *text* (not **text**)
 * - Italic: _text_ (same)
 * - Strikethrough: ~text~ (not ~~text~~)
 * - Links: <url|text> (not [text](url))
 * - User mentions: <@U123>
 * - Channel mentions: <#C123|name>
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

export class SlackFormatConverter extends BaseFormatConverter {
  /**
   * Convert @mentions to Slack format in plain text.
   * @name → <@name>
   */
  private convertMentionsToSlack(text: string): string {
    return text.replace(/(?<!<)@(\w+)/g, "<@$1>");
  }

  /**
   * Override renderPostable to convert @mentions in plain strings.
   */
  override renderPostable(message: AdapterPostableMessage): string {
    if (typeof message === "string") {
      return this.convertMentionsToSlack(message);
    }
    if ("raw" in message) {
      return this.convertMentionsToSlack(message.raw);
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
   * Render an AST to Slack mrkdwn format.
   */
  fromAst(ast: Root): string {
    return this.fromAstWithNodeConverter(ast, (node) =>
      this.nodeToMrkdwn(node),
    );
  }

  /**
   * Parse Slack mrkdwn into an AST.
   */
  toAst(mrkdwn: string): Root {
    // Convert Slack mrkdwn to standard markdown string, then parse
    let markdown = mrkdwn;

    // User mentions: <@U123|name> -> @name or <@U123> -> @U123
    markdown = markdown.replace(/<@([^|>]+)\|([^>]+)>/g, "@$2");
    markdown = markdown.replace(/<@([^>]+)>/g, "@$1");

    // Channel mentions: <#C123|name> -> #name
    markdown = markdown.replace(/<#[^|>]+\|([^>]+)>/g, "#$1");
    markdown = markdown.replace(/<#([^>]+)>/g, "#$1");

    // Links: <url|text> -> [text](url)
    markdown = markdown.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "[$2]($1)");

    // Bare links: <url> -> url
    markdown = markdown.replace(/<(https?:\/\/[^>]+)>/g, "$1");

    // Bold: *text* -> **text** (but be careful with emphasis)
    // This is tricky because Slack uses * for bold, not emphasis
    markdown = markdown.replace(/(?<![_*\\])\*([^*\n]+)\*(?![_*])/g, "**$1**");

    // Strikethrough: ~text~ -> ~~text~~
    markdown = markdown.replace(/(?<!~)~([^~\n]+)~(?!~)/g, "~~$1~~");

    return parseMarkdown(markdown);
  }

  private nodeToMrkdwn(node: Content): string {
    // Use type guards for type-safe node handling
    if (isParagraphNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToMrkdwn(child))
        .join("");
    }

    if (isTextNode(node)) {
      // Convert @mentions to Slack format <@mention>
      return node.value.replace(/(?<!<)@(\w+)/g, "<@$1>");
    }

    if (isStrongNode(node)) {
      // Markdown **text** -> Slack *text*
      const content = getNodeChildren(node)
        .map((child) => this.nodeToMrkdwn(child))
        .join("");
      return `*${content}*`;
    }

    if (isEmphasisNode(node)) {
      // Both use _text_
      const content = getNodeChildren(node)
        .map((child) => this.nodeToMrkdwn(child))
        .join("");
      return `_${content}_`;
    }

    if (isDeleteNode(node)) {
      // Markdown ~~text~~ -> Slack ~text~
      const content = getNodeChildren(node)
        .map((child) => this.nodeToMrkdwn(child))
        .join("");
      return `~${content}~`;
    }

    if (isInlineCodeNode(node)) {
      return `\`${node.value}\``;
    }

    if (isCodeNode(node)) {
      return `\`\`\`${node.lang || ""}\n${node.value}\n\`\`\``;
    }

    if (isLinkNode(node)) {
      const linkText = getNodeChildren(node)
        .map((child) => this.nodeToMrkdwn(child))
        .join("");
      // Markdown [text](url) -> Slack <url|text>
      return `<${node.url}|${linkText}>`;
    }

    if (isBlockquoteNode(node)) {
      return getNodeChildren(node)
        .map((child) => `> ${this.nodeToMrkdwn(child)}`)
        .join("\n");
    }

    if (isListNode(node)) {
      return getNodeChildren(node)
        .map((item, i) => {
          const prefix = node.ordered ? `${i + 1}.` : "•";
          const content = getNodeChildren(item)
            .map((child) => this.nodeToMrkdwn(child))
            .join("");
          return `${prefix} ${content}`;
        })
        .join("\n");
    }

    if (isListItemNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToMrkdwn(child))
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
      return children.map((child) => this.nodeToMrkdwn(child)).join("");
    }
    return getNodeValue(node);
  }
}

// Backwards compatibility alias
export { SlackFormatConverter as SlackMarkdownConverter };
