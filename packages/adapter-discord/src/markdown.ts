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

import { replaceBareMentions } from "@chat-adapter/shared";
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

const SUPPRESSED_AUTOLINK_REGEX = /^<https?:\/\/[^<>\s]+>$/i;
const SUPPRESSED_MASKED_LINK_REGEX = /\]\(<https?:\/\/[^<>\s]+>\)$/i;

// biome-ignore lint/style/noEnum: Link styles must use an enum.
enum DiscordLinkStyle {
  SuppressedAutolink = "suppressed-autolink",
  SuppressedMaskedLink = "suppressed-masked-link",
}

interface DiscordLinkData {
  discordLinkStyle?: DiscordLinkStyle;
}

function getDiscordLinkStyle(source: string): DiscordLinkStyle | undefined {
  if (SUPPRESSED_AUTOLINK_REGEX.test(source)) {
    return DiscordLinkStyle.SuppressedAutolink;
  }
  if (SUPPRESSED_MASKED_LINK_REGEX.test(source)) {
    return DiscordLinkStyle.SuppressedMaskedLink;
  }
  return undefined;
}

export class DiscordFormatConverter extends BaseFormatConverter {
  /**
   * Convert bare `@mentions` to Discord format (`@name` → `<@name>`), leaving
   * emails, URLs, code spans, and existing `<@…>` tokens untouched.
   */
  private convertMentionsToDiscord(text: string): string {
    return replaceBareMentions(text, (_mention, name) => `<@${name}>`);
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
      return this.fromAst(this.parseDiscordMarkdown(message.markdown));
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

    return this.parseDiscordMarkdown(markdown);
  }

  /**
   * mdast normalizes Discord's two angle-bracketed link forms, so retain their
   * source style in the node's adapter-specific data before rendering.
   */
  private parseDiscordMarkdown(markdown: string): Root {
    const ast = parseMarkdown(markdown);
    this.markDiscordLinkStyles(ast.children, markdown);
    return ast;
  }

  private markDiscordLinkStyles(nodes: Content[], markdown: string): void {
    for (const node of nodes) {
      if (isLinkNode(node)) {
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;

        if (start !== undefined && end !== undefined) {
          const source = markdown.slice(start, end);
          const discordLinkStyle = getDiscordLinkStyle(source);

          if (discordLinkStyle !== undefined) {
            node.data = { ...node.data, discordLinkStyle };
          }
        }
      }

      this.markDiscordLinkStyles(getNodeChildren(node), markdown);
    }
  }

  private nodeToDiscordMarkdown(node: Content): string {
    // Use type guards for type-safe node handling
    if (isParagraphNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToDiscordMarkdown(child))
        .join("");
    }

    if (isTextNode(node)) {
      // Convert bare @mentions to Discord format <@mention>
      return this.convertMentionsToDiscord(node.value);
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
      const children = getNodeChildren(node);
      const linkText = children
        .map((child) => this.nodeToDiscordMarkdown(child))
        .join("");
      const discordLinkStyle = (node.data as DiscordLinkData | undefined)
        ?.discordLinkStyle;
      if (discordLinkStyle === DiscordLinkStyle.SuppressedAutolink) {
        return `<${node.url}>`;
      }
      if (discordLinkStyle === DiscordLinkStyle.SuppressedMaskedLink) {
        return `[${linkText}](<${node.url}>)`;
      }

      // Bare URLs (label === url) must stay bare: Discord only renders masked
      // links `[text](url)` inside embeds, so `[url](url)` in a normal message
      // shows up as literal text instead of a clickable link.
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
