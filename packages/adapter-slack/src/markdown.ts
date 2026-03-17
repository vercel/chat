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
  type MdastTable,
  parseMarkdown,
  type Root,
  tableToAscii,
} from "chat";
import type { SlackBlock } from "./cards";

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
      this.nodeToMrkdwn(node)
    );
  }

  /**
   * Parse Slack mrkdwn into an AST.
   */
  toAst(mrkdwn: string): Root {
    // Convert Slack mrkdwn to standard markdown string, then parse
    let markdown = mrkdwn;

    // User mentions: <@U123|name> -> @name or <@U123> -> @U123
    markdown = markdown.replace(/<@([A-Z0-9_]+)\|([^<>]+)>/g, "@$2");
    markdown = markdown.replace(/<@([A-Z0-9_]+)>/g, "@$1");

    // Channel mentions: <#C123|name> -> #name
    markdown = markdown.replace(/<#[A-Z0-9_]+\|([^<>]+)>/g, "#$1");
    markdown = markdown.replace(/<#([A-Z0-9_]+)>/g, "#$1");

    // Links: <url|text> -> [text](url)
    markdown = markdown.replace(
      /<(https?:\/\/[^|<>]+)\|([^<>]+)>/g,
      "[$2]($1)"
    );

    // Bare links: <url> -> url
    markdown = markdown.replace(/<(https?:\/\/[^<>]+)>/g, "$1");

    // Bold: *text* -> **text** (but be careful with emphasis)
    // This is tricky because Slack uses * for bold, not emphasis
    markdown = markdown.replace(/(?<![_*\\])\*([^*\n]+)\*(?![_*])/g, "**$1**");

    // Strikethrough: ~text~ -> ~~text~~
    markdown = markdown.replace(/(?<!~)~([^~\n]+)~(?!~)/g, "~~$1~~");

    return parseMarkdown(markdown);
  }

  /**
   * Convert AST to Slack blocks, using a native table block for the first table.
   * Returns null if the AST contains no tables (caller should use regular text).
   * Slack allows at most one table block per message; additional tables use ASCII.
   */
  toBlocksWithTable(ast: Root): SlackBlock[] | null {
    const hasTable = ast.children.some((node) => isTableNode(node as Content));
    if (!hasTable) {
      return null;
    }

    const blocks: SlackBlock[] = [];
    let usedNativeTable = false;
    let textBuffer: string[] = [];

    const flushText = () => {
      if (textBuffer.length > 0) {
        const text = textBuffer.join("\n\n");
        if (text.trim()) {
          blocks.push({
            type: "section",
            text: { type: "mrkdwn", text },
          });
        }
        textBuffer = [];
      }
    };

    for (const child of ast.children) {
      const node = child as Content;
      if (isTableNode(node)) {
        flushText();
        if (usedNativeTable) {
          // Additional tables fall back to ASCII in a code block
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `\`\`\`\n${tableToAscii(node)}\n\`\`\``,
            },
          });
        } else {
          blocks.push(
            mdastTableToSlackBlock(node, this.nodeToMrkdwn.bind(this))
          );
          usedNativeTable = true;
        }
      } else {
        textBuffer.push(this.nodeToMrkdwn(node));
      }
    }

    flushText();
    return blocks;
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
      return this.renderList(node, 0, (child) => this.nodeToMrkdwn(child), "•");
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

    return this.defaultNodeToText(node, (child) => this.nodeToMrkdwn(child));
  }
}

/**
 * Convert an mdast Table node to a Slack table block.
 * Uses the table block schema: first row = headers, cells are raw_text,
 * column_settings carries alignment from mdast.
 * @see https://docs.slack.dev/reference/block-kit/blocks/table-block/
 */
function mdastTableToSlackBlock(
  node: MdastTable,
  cellConverter: (node: Content) => string
): SlackBlock {
  const rows: Array<Array<{ type: "raw_text"; text: string }>> = [];

  for (const row of node.children) {
    const cells = getNodeChildren(row).map((cell) => ({
      type: "raw_text" as const,
      text: getNodeChildren(cell).map(cellConverter).join(""),
    }));
    rows.push(cells);
  }

  const block: SlackBlock = { type: "table", rows };

  if (node.align) {
    const columnSettings = node.align.map(
      (a: "left" | "center" | "right" | null) => ({
        align: a || "left",
      })
    );
    block.column_settings = columnSettings;
  }

  return block;
}

// Backwards compatibility alias
export { SlackFormatConverter as SlackMarkdownConverter };
