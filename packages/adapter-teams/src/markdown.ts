/**
 * Teams-specific format conversion using AST-based parsing.
 *
 * Teams supports a subset of HTML for formatting:
 * - Bold: <b> or <strong>
 * - Italic: <i> or <em>
 * - Strikethrough: <s> or <strike>
 * - Links: <a href="url">text</a>
 * - Code: <pre> and <code>
 *
 * Teams also accepts standard markdown in most cases.
 */

import { escapeTableCell } from "@chat-adapter/shared";
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
} from "chat";

export class TeamsFormatConverter extends BaseFormatConverter {
  /**
   * Convert @mentions to Teams format in plain text.
   * @name → <at>name</at>
   */
  private convertMentionsToTeams(text: string): string {
    return text.replace(/@(\w+)/g, "<at>$1</at>");
  }

  /**
   * Override renderPostable to convert @mentions in plain strings.
   */
  override renderPostable(message: AdapterPostableMessage): string {
    if (typeof message === "string") {
      return this.convertMentionsToTeams(message);
    }
    if ("raw" in message) {
      return this.convertMentionsToTeams(message.raw);
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
   * Render an AST to Teams format.
   * Teams accepts standard markdown, so we just stringify cleanly.
   */
  fromAst(ast: Root): string {
    return this.fromAstWithNodeConverter(ast, (node) => this.nodeToTeams(node));
  }

  /**
   * Parse Teams message into an AST.
   * Converts Teams HTML/mentions to standard markdown format.
   */
  toAst(teamsText: string): Root {
    // Convert Teams HTML to markdown, then parse
    let markdown = teamsText;

    // Convert @mentions from Teams format: <at>Name</at> -> @Name
    markdown = markdown.replace(/<at>([^<]+)<\/at>/gi, "@$1");

    // Convert HTML tags to markdown
    // Bold: <b>, <strong> -> **text**
    markdown = markdown.replace(
      /<(b|strong)>([^<]+)<\/(b|strong)>/gi,
      "**$2**"
    );

    // Italic: <i>, <em> -> _text_
    markdown = markdown.replace(/<(i|em)>([^<]+)<\/(i|em)>/gi, "_$2_");

    // Strikethrough: <s>, <strike> -> ~~text~~
    markdown = markdown.replace(
      /<(s|strike)>([^<]+)<\/(s|strike)>/gi,
      "~~$2~~"
    );

    // Links: <a href="url">text</a> -> [text](url)
    markdown = markdown.replace(
      /<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi,
      "[$2]($1)"
    );

    // Code: <code>text</code> -> `text`
    markdown = markdown.replace(/<code>([^<]+)<\/code>/gi, "`$1`");

    // Pre: <pre>text</pre> -> ```text```
    markdown = markdown.replace(/<pre>([^<]+)<\/pre>/gi, "```\n$1\n```");

    // Strip remaining HTML tags (loop to handle nested/reconstructed tags)
    let prev: string;
    do {
      prev = markdown;
      markdown = markdown.replace(/<[^>]+>/g, "");
    } while (markdown !== prev);

    // Decode HTML entities in a single pass to prevent double-unescaping
    const entityMap: Record<string, string> = {
      "&lt;": "<",
      "&gt;": ">",
      "&amp;": "&",
      "&quot;": '"',
      "&#39;": "'",
    };
    markdown = markdown.replace(
      /&(?:lt|gt|amp|quot|#39);/g,
      (match) => entityMap[match] ?? match
    );

    return parseMarkdown(markdown);
  }

  private nodeToTeams(node: Content): string {
    // Use type guards for type-safe node handling
    if (isParagraphNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToTeams(child))
        .join("");
    }

    if (isTextNode(node)) {
      // Convert @mentions to Teams format <at>mention</at>
      return node.value.replace(/@(\w+)/g, "<at>$1</at>");
    }

    if (isStrongNode(node)) {
      // Teams supports **text** markdown
      const content = getNodeChildren(node)
        .map((child) => this.nodeToTeams(child))
        .join("");
      return `**${content}**`;
    }

    if (isEmphasisNode(node)) {
      // Teams supports _text_ markdown
      const content = getNodeChildren(node)
        .map((child) => this.nodeToTeams(child))
        .join("");
      return `_${content}_`;
    }

    if (isDeleteNode(node)) {
      // Teams supports ~~text~~ markdown
      const content = getNodeChildren(node)
        .map((child) => this.nodeToTeams(child))
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
        .map((child) => this.nodeToTeams(child))
        .join("");
      // Standard markdown link format
      return `[${linkText}](${node.url})`;
    }

    if (isBlockquoteNode(node)) {
      return getNodeChildren(node)
        .map((child) => `> ${this.nodeToTeams(child)}`)
        .join("\n");
    }

    if (isListNode(node)) {
      return this.renderList(node, 0, (child) => this.nodeToTeams(child));
    }

    if (node.type === "break") {
      return "\n";
    }

    if (node.type === "thematicBreak") {
      return "---";
    }

    if (isTableNode(node)) {
      return this.tableToGfm(node);
    }

    return this.defaultNodeToText(node, (child) => this.nodeToTeams(child));
  }

  /**
   * Render an mdast table node as a GFM markdown table.
   * Teams renders markdown tables natively.
   */
  private tableToGfm(node: MdastTable): string {
    const rows: string[][] = [];
    for (const row of node.children) {
      const cells: string[] = [];
      for (const cell of row.children) {
        const cellContent = getNodeChildren(cell)
          .map((child) => this.nodeToTeams(child))
          .join("");
        cells.push(cellContent);
      }
      rows.push(cells);
    }

    if (rows.length === 0) {
      return "";
    }

    const lines: string[] = [];
    // Header row
    lines.push(`| ${rows[0].map(escapeTableCell).join(" | ")} |`);
    // Separator
    const separators = rows[0].map(() => "---");
    lines.push(`| ${separators.join(" | ")} |`);
    // Data rows
    for (let i = 1; i < rows.length; i++) {
      lines.push(`| ${rows[i].map(escapeTableCell).join(" | ")} |`);
    }
    return lines.join("\n");
  }
}
