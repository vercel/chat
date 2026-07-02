/**
 * Discord-specific format conversion using AST-based parsing.
 *
 * Discord uses standard markdown with some extensions:
 * - Bold: **text** (standard)
 * - Italic: *text* or _text_ (standard)
 * - Strikethrough: ~~text~~ (standard GFM)
 * - Links: [text](url) (standard)
 * - User mentions: <@userId>
 * - Channel mentions: <#channelId>
 * - Role mentions: <@&roleId>
 * - Custom emoji: <:name:id> or <a:name:id> (animated)
 * - Spoiler: ||text||
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

/**
 * Matches a bare `@mention` (an `@` followed by word characters), but only when
 * the `@` is not preceded by a word character, another `@`, or `<`. The word
 * boundary leaves email addresses and handles like `user@example.com` untouched
 * (the `@` follows a word character), and excluding `<` avoids re-wrapping an
 * already-formatted Discord mention such as `<@123>` into `<<@123>>`.
 */
const BARE_MENTION_PATTERN = /(?<![\w@<])@(\w+)/g;

export class DiscordFormatConverter extends BaseFormatConverter {
  /**
   * Convert @mentions to Discord format in plain text.
   * @name → <@name>
   */
  private convertMentionsToDiscord(text: string): string {
    return text.replace(BARE_MENTION_PATTERN, "<@$1>");
  }

  /**
   * Override renderPostable to convert @mentions in plain strings.
   */
  override renderPostable(message: AdapterPostableMessage): string {
    if (typeof message === "string") {
      return this.convertMentionsToDiscord(message);
    }
    if ("raw" in message) {
      return this.convertMentionsToDiscord(message.raw);
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
   * Render an AST to Discord markdown format.
   */
  fromAst(ast: Root): string {
    return this.fromAstWithNodeConverter(ast, (node) =>
      this.nodeToDiscordMarkdown(node)
    );
  }

  /**
   * Parse Discord markdown into an AST.
   */
  toAst(discordMarkdown: string): Root {
    // Convert Discord-specific formats to standard markdown, then parse
    let markdown = discordMarkdown;

    // User mentions: <@userId> or <@!userId> -> @userId
    markdown = markdown.replace(/<@!?(\w+)>/g, "@$1");

    // Channel mentions: <#channelId> -> #channelId
    markdown = markdown.replace(/<#(\w+)>/g, "#$1");

    // Role mentions: <@&roleId> -> @&roleId
    markdown = markdown.replace(/<@&(\w+)>/g, "@&$1");

    // Custom emoji: <:name:id> or <a:name:id> -> :name:
    markdown = markdown.replace(/<a?:(\w+):\d+>/g, ":$1:");

    // Spoiler tags: ||text|| -> [spoiler: text]
    // (no direct markdown equivalent, convert to placeholder)
    markdown = markdown.replace(/\|\|([^|]+)\|\|/g, "[spoiler: $1]");

    return parseMarkdown(markdown);
  }

  private nodeToDiscordMarkdown(node: Content): string {
    // Use type guards for type-safe node handling
    if (isParagraphNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToDiscordMarkdown(child))
        .join("");
    }

    if (isTextNode(node)) {
      // Convert @mentions to Discord format <@mention>
      return node.value.replace(BARE_MENTION_PATTERN, "<@$1>");
    }

    if (isStrongNode(node)) {
      // Standard markdown **text**
      const content = getNodeChildren(node)
        .map((child) => this.nodeToDiscordMarkdown(child))
        .join("");
      return `**${content}**`;
    }

    if (isEmphasisNode(node)) {
      // Standard markdown *text*
      const content = getNodeChildren(node)
        .map((child) => this.nodeToDiscordMarkdown(child))
        .join("");
      return `*${content}*`;
    }

    if (isDeleteNode(node)) {
      // Standard GFM ~~text~~
      const content = getNodeChildren(node)
        .map((child) => this.nodeToDiscordMarkdown(child))
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
        .map((child) => this.nodeToDiscordMarkdown(child))
        .join("");
      // Bare URLs / autolinks (label === url) must stay bare: Discord only
      // renders masked links `[text](url)` inside embeds, so `[url](url)` in a
      // normal message shows up as literal text instead of a clickable link.
      if (linkText === node.url) {
        return node.url;
      }
      // Standard markdown [text](url)
      return `[${linkText}](${node.url})`;
    }

    if (isBlockquoteNode(node)) {
      return getNodeChildren(node)
        .map((child) => `> ${this.nodeToDiscordMarkdown(child)}`)
        .join("\n");
    }

    if (isListNode(node)) {
      return this.renderList(node, 0, (child) =>
        this.nodeToDiscordMarkdown(child)
      );
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

    return this.defaultNodeToText(node, (child) =>
      this.nodeToDiscordMarkdown(child)
    );
  }
}
