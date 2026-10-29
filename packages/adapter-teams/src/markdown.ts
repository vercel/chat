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

const MENTION_PATTERN = /<at>([^<]+)<\/at>/gi;
const BOLD_PATTERN = /<(b|strong)>([^<]+)<\/(b|strong)>/gi;
const ITALIC_PATTERN = /<(i|em)>([^<]+)<\/(i|em)>/gi;
const STRIKE_PATTERN = /<(s|strike)>([^<]+)<\/(s|strike)>/gi;
const CODE_PATTERN = /<code>([^<]+)<\/code>/gi;
const PRE_PATTERN = /<pre>([^<]+)<\/pre>/gi;
const LINK_START_PATTERN = /<a/gi;
const HREF_PATTERN = /href="/gi;
const LINK_END_PATTERN = /<\/a>/iy;
const ENTITY_PATTERN = /&(?:lt|gt|amp|quot|#39);/g;
const PLAIN_TEXT_ENTITY_PATTERN = /&(?:lt|gt|amp|quot|#39|nbsp);/g;
const BLOCK_TAG_PATTERN =
  /^<(?:br\b|\/(?:p|div|li|tr|h[1-6]|blockquote|pre|table|ul|ol)\b)/i;
const EXTRA_NEWLINES_PATTERN = /\n{3,}/g;

const HREF_PREFIX_LENGTH = 'href="'.length;
const LINK_END_LENGTH = "</a>".length;

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": "\u00a0",
};

/**
 * Return a function that finds the next `char` in `value` at or after an
 * index. Repeated calls with nondecreasing indexes scan `value` at most once.
 */
function forwardFinder(value: string, char: string): (from: number) => number {
  let lastFrom = Number.POSITIVE_INFINITY;
  let lastIndex = -1;
  return (from) => {
    if (from < lastFrom || (lastIndex !== -1 && from > lastIndex)) {
      lastFrom = from;
      lastIndex = value.indexOf(char, from);
    }
    return lastIndex;
  };
}

interface ClosedHref {
  /** Index of the closing `"` of the attribute value. */
  quote: number;
  /** Index of `href="`. */
  start: number;
  /** Index of the `>` that ends the opening tag. */
  tagEnd: number;
  /** Index of the `</a>` that ends the link text. */
  textEnd: number;
}

/**
 * Find each `href="` that a link opened before it would complete: a nonempty
 * value, a `>` after the value, then nonempty text up to a `</a>`. Runs in
 * linear time and returns them in order.
 */
function closedHrefs(html: string): ClosedHref[] {
  const nextQuote = forwardFinder(html, '"');
  const nextTagEnd = forwardFinder(html, ">");
  const nextTagStart = forwardFinder(html, "<");
  const hrefs: ClosedHref[] = [];
  for (const match of html.matchAll(HREF_PATTERN)) {
    const valueStart = match.index + HREF_PREFIX_LENGTH;
    const quote = nextQuote(valueStart);
    if (quote <= valueStart) {
      continue;
    }
    const tagEnd = nextTagEnd(quote + 1);
    if (tagEnd === -1) {
      continue;
    }
    const textEnd = nextTagStart(tagEnd + 1);
    if (textEnd <= tagEnd + 1) {
      continue;
    }
    LINK_END_PATTERN.lastIndex = textEnd;
    if (LINK_END_PATTERN.test(html)) {
      hrefs.push({ start: match.index, quote, tagEnd, textEnd });
    }
  }
  return hrefs;
}

/**
 * Convert `<a … href="url" …>text</a>` to `[text](url)` in linear time. For
 * each `<a`, the link uses the last `href="` before the first `>` that
 * completes one. The URL may contain `>`, and the attribute list may contain
 * `<` or other `href=` attributes.
 */
function replaceLinks(html: string): string {
  const hrefs = closedHrefs(html);
  if (hrefs.length === 0) {
    return html;
  }
  const nextTagEnd = forwardFinder(html, ">");
  let result = "";
  let copied = 0;
  let candidates = 0;
  for (const match of html.matchAll(LINK_START_PATTERN)) {
    const start = match.index;
    if (start < copied) {
      continue;
    }
    const tagEnd = nextTagEnd(start + 2);
    if (tagEnd === -1) {
      break;
    }
    while (
      candidates < hrefs.length &&
      hrefs[candidates].start + HREF_PREFIX_LENGTH <= tagEnd
    ) {
      candidates++;
    }
    const href = hrefs[candidates - 1];
    if (!href || href.start < start + 3) {
      continue;
    }
    const text = html.slice(href.tagEnd + 1, href.textEnd);
    const url = html.slice(href.start + HREF_PREFIX_LENGTH, href.quote);
    result += `${html.slice(copied, start)}[${text}](${url})`;
    copied = href.textEnd + LINK_END_LENGTH;
  }
  return result + html.slice(copied);
}

/**
 * Replace each `<…>` tag with what `replace` returns for it, in linear time.
 * A tag runs from a `<` to the next `>` with at least one character between,
 * as `/<[^>]+>/g` matches. One pass leaves no tags behind, so the result
 * matches stripping until nothing changes.
 */
function replaceTags(html: string, replace: (tag: string) => string): string {
  let result = "";
  let copied = 0;
  let start = html.indexOf("<");
  while (start !== -1) {
    if (html[start + 1] === ">") {
      start = html.indexOf("<", start + 2);
      continue;
    }
    const end = html.indexOf(">", start + 2);
    if (end === -1) {
      break;
    }
    result += html.slice(copied, start) + replace(html.slice(start, end + 1));
    copied = end + 1;
    start = html.indexOf("<", copied);
  }
  return result + html.slice(copied);
}

function trimNewlines(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === "\n") {
    start++;
  }
  while (end > start && value[end - 1] === "\n") {
    end--;
  }
  return value.slice(start, end);
}

/**
 * Convert Teams HTML to the markdown `toAst` parses. Runs in linear time.
 */
function teamsHtmlToMarkdown(teamsText: string): string {
  let markdown = teamsText.replace(MENTION_PATTERN, "@$1");
  markdown = markdown.replace(BOLD_PATTERN, "**$2**");
  markdown = markdown.replace(ITALIC_PATTERN, "_$2_");
  markdown = markdown.replace(STRIKE_PATTERN, "~~$2~~");
  markdown = replaceLinks(markdown);
  markdown = markdown.replace(CODE_PATTERN, "`$1`");
  markdown = markdown.replace(PRE_PATTERN, "```\n$1\n```");
  markdown = replaceTags(markdown, () => "");
  // Decode in a single pass so `&amp;lt;` becomes `&lt;`, not `<`.
  return markdown.replace(ENTITY_PATTERN, (match) => ENTITIES[match] ?? match);
}

/**
 * Convert Teams HTML to plain text without parsing it as markdown: mentions
 * become `@Name`, line breaks and block ends become newlines, other tags are
 * dropped, and entities are decoded. Runs in linear time.
 */
function teamsHtmlToPlainText(teamsText: string): string {
  const withMentions = teamsText.replace(MENTION_PATTERN, "@$1");
  const stripped = replaceTags(withMentions, (tag) =>
    BLOCK_TAG_PATTERN.test(tag) ? "\n" : ""
  );
  const decoded = stripped.replace(
    PLAIN_TEXT_ENTITY_PATTERN,
    (match) => ENTITIES[match] ?? match
  );
  return trimNewlines(decoded.replace(EXTRA_NEWLINES_PATTERN, "\n\n"));
}

export class TeamsFormatConverter extends BaseFormatConverter {
  /**
   * Render text messages while preserving raw strings.
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
    return parseMarkdown(teamsHtmlToMarkdown(teamsText));
  }

  /**
   * Check the budget against the markdown `toAst` passes to the parser, so
   * decoded entities such as `&gt;` count as the blockquote markers they
   * become. The length limit still applies to the text as delivered.
   */
  protected override exceedsIncomingBudget(teamsText: string): boolean {
    return (
      teamsText.length > this.maxIncomingParseLength ||
      super.exceedsIncomingBudget(teamsHtmlToMarkdown(teamsText))
    );
  }

  protected override incomingFallbackText(teamsText: string): string {
    return teamsHtmlToPlainText(teamsText);
  }

  private nodeToTeams(node: Content): string {
    // Use type guards for type-safe node handling
    if (isParagraphNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToTeams(child))
        .join("");
    }

    if (isTextNode(node)) {
      return node.value;
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
