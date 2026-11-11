/**
 * Markdown parsing and conversion utilities using unified/remark.
 */

import type {
  Blockquote,
  Code,
  Content,
  Delete,
  Emphasis,
  InlineCode,
  Link,
  List,
  ListItem,
  Paragraph,
  Root,
  Strong,
  Table,
  TableCell,
  TableRow,
  Text,
} from "mdast";

import { toString as mdastToString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify, {
  type Options as MarkdownStringifyOptions,
} from "remark-stringify";
import { unified } from "unified";
import type { CardChild, CardElement, ChartElement } from "./cards";
import type { AdapterPostableMessage } from "./types";

// Alias for use within this file
type PostableMessageInput = AdapterPostableMessage;

const LINE_BREAK_REGEX = /\r\n|\r|\n/;

// Re-export types for adapters
export type {
  Blockquote,
  Code,
  Content,
  Delete,
  Emphasis,
  InlineCode,
  Link,
  List,
  ListItem,
  Nodes,
  Paragraph,
  Root,
  Strong,
  Table,
  TableCell,
  TableRow,
  Text,
} from "mdast";

// ============================================================================
// Type Guards for mdast nodes
// ============================================================================

/**
 * Type guard for text nodes.
 */
export function isTextNode(node: Content): node is Text {
  return node.type === "text";
}

/**
 * Type guard for paragraph nodes.
 */
export function isParagraphNode(node: Content): node is Paragraph {
  return node.type === "paragraph";
}

/**
 * Type guard for strong (bold) nodes.
 */
export function isStrongNode(node: Content): node is Strong {
  return node.type === "strong";
}

/**
 * Type guard for emphasis (italic) nodes.
 */
export function isEmphasisNode(node: Content): node is Emphasis {
  return node.type === "emphasis";
}

/**
 * Type guard for delete (strikethrough) nodes.
 */
export function isDeleteNode(node: Content): node is Delete {
  return node.type === "delete";
}

/**
 * Type guard for inline code nodes.
 */
export function isInlineCodeNode(node: Content): node is InlineCode {
  return node.type === "inlineCode";
}

/**
 * Type guard for code block nodes.
 */
export function isCodeNode(node: Content): node is Code {
  return node.type === "code";
}

/**
 * Type guard for link nodes.
 */
export function isLinkNode(node: Content): node is Link {
  return node.type === "link";
}

/**
 * Type guard for blockquote nodes.
 */
export function isBlockquoteNode(node: Content): node is Blockquote {
  return node.type === "blockquote";
}

/**
 * Type guard for list nodes.
 */
export function isListNode(node: Content): node is List {
  return node.type === "list";
}

/**
 * Type guard for list item nodes.
 */
export function isListItemNode(node: Content): node is ListItem {
  return node.type === "listItem";
}

/**
 * Type guard for table nodes.
 */
export function isTableNode(node: Content): node is Table {
  return node.type === "table";
}

/**
 * Type guard for table row nodes.
 */
export function isTableRowNode(node: Content): node is TableRow {
  return node.type === "tableRow";
}

/**
 * Type guard for table cell nodes.
 */
export function isTableCellNode(node: Content): node is TableCell {
  return node.type === "tableCell";
}

/**
 * Render an mdast table node as a padded ASCII table string.
 *
 * Produces output like:
 * ```
 * Name  | Age | Role
 * ------|-----|--------
 * Alice | 30  | Engineer
 * Bob   | 25  | Designer
 * ```
 *
 * Shared by adapters that lack native table support (Slack, GChat, Discord, Telegram).
 */
export function tableToAscii(node: Table): string {
  const rows: string[][] = [];

  for (const row of node.children) {
    const cells: string[] = [];
    for (const cell of row.children) {
      cells.push(mdastToString(cell));
    }
    rows.push(cells);
  }

  if (rows.length === 0) {
    return "";
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);
  return tableElementToAscii(headers, dataRows);
}

/**
 * Render a table from headers and string rows as a padded ASCII table.
 * Used for card TableElement fallback rendering.
 */
export function tableElementToAscii(
  headers: string[],
  rows: string[][]
): string {
  const allRows = [headers, ...rows];
  const colCount = Math.max(...allRows.map((r) => r.length));
  if (colCount === 0) {
    return "";
  }
  const colWidths: number[] = Array.from({ length: colCount }, () => 0);

  for (const row of allRows) {
    for (let i = 0; i < colCount; i++) {
      const cellLen = (row[i] || "").length;
      if (cellLen > colWidths[i]) {
        colWidths[i] = cellLen;
      }
    }
  }

  const formatRow = (cells: string[]): string =>
    Array.from({ length: colCount }, (_, i) =>
      (cells[i] || "").padEnd(colWidths[i])
    )
      .join(" | ")
      .trimEnd();

  const lines: string[] = [];
  lines.push(formatRow(headers));
  lines.push(colWidths.map((w) => "-".repeat(w)).join("-|-"));
  for (const row of rows) {
    lines.push(formatRow(row));
  }
  return lines.join("\n");
}

/**
 * Render a chart element as text: the title followed by the underlying
 * data as a padded ASCII table.
 * Used for card ChartElement fallback rendering on platforms without
 * native chart support.
 */
export function chartElementToFallbackText(element: ChartElement): string {
  const { chart, title } = element;

  if (chart.type === "pie") {
    const table = tableElementToAscii(
      ["Label", "Value"],
      chart.segments.map((s) => [s.label, String(s.value)])
    );
    return `${title}\n${table}`;
  }

  const headers = [chart.xLabel ?? "", ...chart.series.map((s) => s.name)];
  const rows = chart.categories.map((category) => [
    category,
    ...chart.series.map((s) => {
      const point = s.data.find((p) => p.label === category);
      return point ? String(point.value) : "";
    }),
  ]);
  return `${title}\n${tableElementToAscii(headers, rows)}`;
}

// ============================================================================
// Helper functions for accessing node properties type-safely
// ============================================================================

/**
 * Get children from a content node that has children.
 * Returns empty array for nodes without children.
 * This eliminates the need for `as Content` casts in adapter converters.
 */
export function getNodeChildren(node: Content): Content[] {
  if ("children" in node && Array.isArray(node.children)) {
    return node.children as Content[];
  }
  return [];
}

/**
 * Get value from a content node that has a value property.
 * Returns empty string for nodes without value.
 */
export function getNodeValue(node: Content): string {
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }
  return "";
}

/**
 * Default maximum length of inbound message text that
 * `BaseFormatConverter.parseIncoming` parses as markdown.
 */
export const DEFAULT_MAX_INCOMING_PARSE_LENGTH = 16_384;

/**
 * Default maximum number of `*`, `_`, and `~` characters in inbound text that
 * `BaseFormatConverter.parseIncoming` parses as markdown. Resolving unmatched
 * emphasis delimiters within one paragraph takes quadratic time.
 */
const DEFAULT_MAX_INCOMING_EMPHASIS_MARKERS = 2048;

/**
 * Default maximum number of `]` characters in inbound text that
 * `BaseFormatConverter.parseIncoming` parses as markdown. Resolving each link
 * label end scans back over the inline content before it.
 */
const DEFAULT_MAX_INCOMING_CLOSING_BRACKETS = 128;

/**
 * Default maximum number of `<` characters in inbound text that
 * `BaseFormatConverter.parseIncoming` parses as markdown. Each unclosed inline
 * HTML construct scans ahead over the rest of the paragraph.
 */
const DEFAULT_MAX_INCOMING_ANGLE_BRACKETS = 512;

/**
 * Default maximum number of `www.` autolink literals in one run of
 * non-whitespace characters of inbound text that
 * `BaseFormatConverter.parseIncoming` parses as markdown. Each one scans ahead
 * over the rest of its run.
 */
const DEFAULT_MAX_INCOMING_WWW_AUTOLINKS = 8;

/**
 * Default maximum container nesting on one line of inbound text that
 * `BaseFormatConverter.parseIncoming` parses as markdown, counting blockquote,
 * list, and footnote definition markers plus half the columns of leading
 * indentation. Parsing a line costs time quadratic in the containers it opens.
 */
const DEFAULT_MAX_INCOMING_CONTAINER_MARKERS = 32;

const LINE_ENDING_PATTERN = /\r\n|\r|\n/;
const FENCE_SKIP_DISABLED_PATTERN = /^ {0,3}<|^ {1,3}(?:`{3,}|~{3,})/m;
const FENCE_OPEN_PATTERN = /^(`{3,}|~{3,})/;
const FENCE_CLOSE_PATTERN = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const WWW_AUTOLINK_PATTERN = /www\./gi;
const WHITESPACE_PATTERN = /\s+/;

/**
 * Default maximum nesting depth of an AST built by
 * `BaseFormatConverter.parseIncoming`. Recursive serializers such as
 * `JSON.stringify` overflow the stack on trees a few thousand levels deep.
 */
const DEFAULT_MAX_INCOMING_AST_DEPTH = 128;

function countChars(value: string, chars: string): number {
  let count = 0;
  for (const char of value) {
    if (chars.includes(char)) {
      count++;
    }
  }
  return count;
}

function isBlank(char: string | undefined): boolean {
  return char === undefined || char === " " || char === "\t";
}

function leadingColumns(line: string): number {
  let columns = 0;
  for (const char of line) {
    if (char === " ") {
      columns++;
    } else if (char === "\t") {
      columns += 4 - (columns % 4);
    } else {
      break;
    }
  }
  return columns;
}

/**
 * Count the blockquote, list, and footnote definition markers that open
 * containers at the start of a line, such as the three in `> - 1. item`.
 */
function countContainerMarkers(line: string): number {
  let count = 0;
  let i = 0;
  while (i < line.length) {
    while (line[i] === " " || line[i] === "\t") {
      i++;
    }
    const char = line[i];
    if (char === ">") {
      i++;
    } else if (
      (char === "-" || char === "+" || char === "*") &&
      isBlank(line[i + 1])
    ) {
      i += 2;
    } else if (char === "[" && line[i + 1] === "^") {
      const labelEnd = line.indexOf("]", i + 2);
      if (labelEnd === -1 || line[labelEnd + 1] !== ":") {
        return count;
      }
      i = labelEnd + 2;
    } else {
      let digits = 0;
      while (
        digits < 10 &&
        line[i + digits] >= "0" &&
        line[i + digits] <= "9"
      ) {
        digits++;
      }
      const delimiter = line[i + digits];
      if (
        digits === 0 ||
        digits > 9 ||
        !(delimiter === "." || delimiter === ")") ||
        !isBlank(line[i + digits + 1])
      ) {
        return count;
      }
      i += digits + 2;
    }
    count++;
  }
  return count;
}

/**
 * The marker that closes a fenced code block opened by `line`, if `line`
 * opens one at the top level. Only fences at column zero count, since an
 * indented fence may belong to a container that ends before its closing fence.
 * Callers don't skip fences at all when any opener or closer is indented,
 * since a column-zero line could then close a fence instead of opening one.
 */
function fenceOpener(line: string): string | undefined {
  const marker = FENCE_OPEN_PATTERN.exec(line)?.[1];
  if (marker?.startsWith("`") && line.slice(marker.length).includes("`")) {
    return;
  }
  return marker;
}

function exceedsWwwAutolinksPerWord(line: string, max: number): boolean {
  for (const word of line.split(WHITESPACE_PATTERN)) {
    if ((word.match(WWW_AUTOLINK_PATTERN)?.length ?? 0) > max) {
      return true;
    }
  }
  return false;
}

function closesFence(line: string, opener: string): boolean {
  const marker = FENCE_CLOSE_PATTERN.exec(line)?.[1];
  return (
    marker !== undefined &&
    marker[0] === opener[0] &&
    marker.length >= opener.length
  );
}

function exceedsDepth(ast: Root, max: number): boolean {
  const stack: [Root | Content, number][] = [[ast, 0]];
  let entry = stack.pop();
  while (entry) {
    const [node, depth] = entry;
    if (depth > max) {
      return true;
    }
    if ("children" in node) {
      for (const child of node.children) {
        stack.push([child as Content, depth + 1]);
      }
    }
    entry = stack.pop();
  }
  return false;
}

/**
 * Parse markdown string into an AST.
 * Supports GFM (GitHub Flavored Markdown) for strikethrough, tables, etc.
 */
export function parseMarkdown(markdown: string): Root {
  const processor = unified().use(remarkParse).use(remarkGfm);
  return processor.parse(markdown);
}

/**
 * Options for stringifyMarkdown.
 */
export interface StringifyOptions {
  /** Bullet character for unordered lists. Default: `'*'` */
  bullet?: "*" | "-" | "+";
  /** Emphasis marker character. Default: `'*'` */
  emphasis?: "*" | "_";
  /**
   * Custom serializers keyed by mdast node type. Each replaces the default
   * serializer for that node type and is responsible for its own escaping.
   * Set `peek` on a handler that wraps its content in a marker.
   */
  handlers?: MarkdownStringifyOptions["handlers"];
}

/**
 * Stringify an AST back to markdown.
 */
export function stringifyMarkdown(
  ast: Root,
  options?: StringifyOptions
): string {
  const processor = unified().use(remarkStringify, options).use(remarkGfm);
  return processor.stringify(ast);
}

function nodeValue(node: Content | Root): string | null {
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }
  if ("alt" in node && typeof node.alt === "string") {
    return node.alt;
  }
  return null;
}

function childPlainText(
  node: Content | Root,
  separator: string,
  keepEmpty = false
): string {
  if (!("children" in node && Array.isArray(node.children))) {
    return "";
  }

  const texts = (node.children as (Content | Root)[]).map((child) =>
    plainTextNode(child)
  );
  return (keepEmpty ? texts : texts.filter((text) => text.length > 0)).join(
    separator
  );
}

function plainTextNode(node: Content | Root): string {
  const value = nodeValue(node);
  if (value !== null) {
    return value;
  }

  switch (node.type) {
    case "root":
      return childPlainText(node, "\n\n");
    case "list":
      return childPlainText(node, "\n");
    case "table": {
      // Drop rows with no content (e.g. a placeholder header row) but keep
      // rows that have any populated cell.
      const rows = (node.children as Content[]).map((child) =>
        plainTextNode(child)
      );
      return rows.filter((row) => row.trim().length > 0).join("\n");
    }
    case "listItem":
    case "blockquote":
      return childPlainText(node, "\n");
    case "tableRow":
      // Keep empty cells so columns stay aligned in the tab-separated output
      return childPlainText(node, "\t", true);
    case "break":
      return "\n";
    case "thematicBreak":
      return "";
    case "tableCell":
      return childPlainText(node, "");
    default:
      return childPlainText(node, "");
  }
}

/**
 * Extract plain text from an AST (strips all formatting).
 */
export function toPlainText(ast: Root): string {
  return plainTextNode(ast);
}

/**
 * Extract plain text from a markdown string.
 */
export function markdownToPlainText(markdown: string): string {
  const ast = parseMarkdown(markdown);
  return toPlainText(ast);
}

/**
 * Walk the AST and transform nodes.
 */
export function walkAst<T extends Content | Root>(
  node: T,
  visitor: (node: Content) => Content | null
): T {
  if ("children" in node && Array.isArray(node.children)) {
    node.children = node.children
      .map((child) => {
        const result = visitor(child as Content);
        if (result === null) {
          return null;
        }
        return walkAst(result, visitor);
      })
      .filter((n): n is Content => n !== null);
  }
  return node;
}

/**
 * Create a text node.
 */
export function text(value: string): Text {
  return { type: "text", value };
}

/**
 * Create a strong (bold) node.
 */
export function strong(children: Content[]): Strong {
  return { type: "strong", children: children as Strong["children"] };
}

/**
 * Create an emphasis (italic) node.
 */
export function emphasis(children: Content[]): Emphasis {
  return { type: "emphasis", children: children as Emphasis["children"] };
}

/**
 * Create a delete (strikethrough) node.
 */
export function strikethrough(children: Content[]): Delete {
  return { type: "delete", children: children as Delete["children"] };
}

/**
 * Create an inline code node.
 */
export function inlineCode(value: string): InlineCode {
  return { type: "inlineCode", value };
}

/**
 * Create a code block node.
 */
export function codeBlock(value: string, lang?: string): Code {
  return { type: "code", value, lang };
}

/**
 * Create a link node.
 */
export function link(url: string, children: Content[], title?: string): Link {
  return { type: "link", url, children: children as Link["children"], title };
}

/**
 * Create a blockquote node.
 */
export function blockquote(children: Content[]): Blockquote {
  return { type: "blockquote", children: children as Blockquote["children"] };
}

/**
 * Create a paragraph node.
 */
export function paragraph(children: Content[]): Paragraph {
  return { type: "paragraph", children: children as Paragraph["children"] };
}

/**
 * Create a root node (top-level AST container).
 */
export function root(children: Content[]): Root {
  return { type: "root", children: children as Root["children"] };
}

/**
 * Interface for platform-specific format converters.
 *
 * The AST (mdast Root) is the canonical representation.
 * All conversions go through the AST:
 *
 *   Platform Format <-> AST <-> Markdown String
 *
 * Adapters implement this interface to convert between
 * their platform-specific format and the standard AST.
 */
export interface FormatConverter {
  /**
   * Extract plain text from platform format.
   * Convenience method - default implementation uses toAst + toPlainText.
   */
  extractPlainText(platformText: string): string;
  /**
   * Render an AST to the platform's native format.
   * This is the primary method used when sending messages.
   */
  fromAst(ast: Root): string;

  /**
   * Parse platform's native format into an AST.
   * This is the primary method used when receiving messages.
   */
  toAst(platformText: string): Root;
}

/**
 * @deprecated Use FormatConverter instead
 */
export interface MarkdownConverter extends FormatConverter {
  // Convenience methods for markdown string I/O
  fromMarkdown(markdown: string): string;
  toMarkdown(platformText: string): string;
  toPlainText(platformText: string): string;
}

/**
 * Base class for format converters with default implementations.
 */
export abstract class BaseFormatConverter implements FormatConverter {
  abstract fromAst(ast: Root): string;
  abstract toAst(platformText: string): Root;

  /**
   * Whether `renderList` indents every line of a multi-line block in a list
   * item, such as a code block or block quote, to the item's content column.
   * Enable it for CommonMark targets, where an unindented line leaves the
   * item. Nested lists are always indented.
   */
  protected indentListContinuationLines = false;

  protected renderList(
    node: List,
    depth: number,
    nodeConverter: (node: Content) => string,
    unorderedBullet = "-"
  ): string {
    return this.renderListLines(
      node,
      "  ".repeat(depth),
      nodeConverter,
      unorderedBullet
    ).join("\n");
  }

  private renderListLines(
    node: List,
    indent: string,
    nodeConverter: (node: Content) => string,
    unorderedBullet: string
  ): string[] {
    const start = node.start ?? 1;
    const lines: string[] = [];
    for (const [i, item] of getNodeChildren(node).entries()) {
      const prefix = node.ordered ? `${start + i}.` : unorderedBullet;
      const marker = `${indent}${prefix} `;
      // Content after the marker starts at this column, so "1. " needs
      // three spaces for a nested list to stay inside the item.
      const contentIndent = " ".repeat(marker.length);
      let previous: Content | undefined;
      for (const child of getNodeChildren(item)) {
        if (isListNode(child)) {
          const nested = this.renderListLines(
            child,
            contentIndent,
            nodeConverter,
            unorderedBullet
          );
          if (nested.length === 0) {
            continue;
          }
          if (previous) {
            // A nested list can follow its parent's text directly, except
            // after HTML, or when it is ordered and doesn't start at 1,
            // because then it can't interrupt a paragraph.
            const canInterrupt =
              previous.type !== "html" &&
              (!child.ordered || (child.start ?? 1) === 1);
            if (!canInterrupt) {
              lines.push("");
            }
            lines.push(...nested);
          } else {
            lines.push(`${marker}${nested[0].slice(contentIndent.length)}`);
            lines.push(...nested.slice(1));
          }
          previous = child;
          continue;
        }
        const text = nodeConverter(child);
        if (!text.trim()) {
          continue;
        }
        const [firstLine, ...rest] = text.split(LINE_BREAK_REGEX);
        if (previous) {
          // Two blocks need a blank line between them or they merge.
          lines.push("", `${contentIndent}${firstLine}`);
        } else {
          lines.push(`${marker}${firstLine}`);
        }
        for (const line of rest) {
          lines.push(
            this.indentListContinuationLines && line
              ? `${contentIndent}${line}`
              : line
          );
        }
        previous = child;
      }
    }
    return lines;
  }

  /**
   * Default fallback for converting an unknown mdast node to text.
   * Recursively converts children if present, otherwise extracts the node value.
   * Adapters should call this in their nodeToX() default case.
   */
  protected defaultNodeToText(
    node: Content,
    nodeConverter: (node: Content) => string
  ): string {
    const children = getNodeChildren(node);
    if (children.length > 0) {
      return children.map(nodeConverter).join("");
    }
    return getNodeValue(node);
  }

  /**
   * Template method for implementing fromAst with a node converter.
   * Iterates through AST children and converts each using the provided function.
   * Joins results with double newlines (standard paragraph separation).
   *
   * @param ast - The AST to convert
   * @param nodeConverter - Function to convert each Content node to string
   * @returns Platform-formatted string
   */
  protected fromAstWithNodeConverter(
    ast: Root,
    nodeConverter: (node: Content) => string
  ): string {
    const parts: string[] = [];
    for (const node of ast.children) {
      parts.push(nodeConverter(node as Content));
    }
    return parts.join("\n\n");
  }

  extractPlainText(platformText: string): string {
    return toPlainText(this.toAst(platformText));
  }

  /**
   * Maximum length, in UTF-16 code units, of inbound text that
   * `parseIncoming` will parse as markdown. The markdown parser has
   * superlinear worst cases, so longer text is kept verbatim in a single
   * text node.
   * Subclasses can override this to match their platform's limits.
   */
  protected maxIncomingParseLength = DEFAULT_MAX_INCOMING_PARSE_LENGTH;

  /**
   * Maximum number of `*`, `_`, and `~` characters in inbound text that
   * `parseIncoming` will parse as markdown. Text with more is kept verbatim
   * in a single text node.
   */
  protected maxIncomingEmphasisMarkers = DEFAULT_MAX_INCOMING_EMPHASIS_MARKERS;

  /**
   * Maximum number of `]` characters in inbound text that `parseIncoming`
   * will parse as markdown. Text with more is kept verbatim in a single text
   * node.
   */
  protected maxIncomingClosingBrackets = DEFAULT_MAX_INCOMING_CLOSING_BRACKETS;

  /**
   * Maximum number of `<` characters in inbound text that `parseIncoming`
   * will parse as markdown. Text with more is kept verbatim in a single text
   * node.
   */
  protected maxIncomingAngleBrackets = DEFAULT_MAX_INCOMING_ANGLE_BRACKETS;

  /**
   * Maximum number of `www.` autolink literals in one run of non-whitespace
   * characters of inbound text that `parseIncoming` will parse as markdown.
   * Text with more is kept verbatim in a single text node.
   */
  protected maxIncomingWwwAutolinks = DEFAULT_MAX_INCOMING_WWW_AUTOLINKS;

  /**
   * Maximum container nesting on one line of inbound text that
   * `parseIncoming` will parse as markdown, counting blockquote, list, and
   * footnote definition markers plus half the columns of leading indentation.
   * Text with a line nested deeper is kept verbatim in a single text node.
   */
  protected maxIncomingContainerMarkers =
    DEFAULT_MAX_INCOMING_CONTAINER_MARKERS;

  /**
   * Maximum nesting depth of the AST `parseIncoming` returns. Text that
   * parses deeper is kept verbatim in a single text node.
   */
  protected maxIncomingAstDepth = DEFAULT_MAX_INCOMING_AST_DEPTH;

  /**
   * Parse inbound platform text into the plain text and AST for a `Message`.
   * Parses once. Text that exceeds the limits checked by
   * `exceedsIncomingBudget`, that overflows the stack while parsing, or that
   * parses deeper than `maxIncomingAstDepth` is kept verbatim in a single text
   * node.
   */
  parseIncoming(platformText: string): { formatted: Root; text: string } {
    if (this.exceedsIncomingBudget(platformText)) {
      return this.unparsedIncoming(platformText);
    }
    let formatted: Root;
    try {
      formatted = this.toAst(platformText);
    } catch (error) {
      if (error instanceof RangeError) {
        return this.unparsedIncoming(platformText);
      }
      throw error;
    }
    if (exceedsDepth(formatted, this.maxIncomingAstDepth)) {
      return this.unparsedIncoming(platformText);
    }
    return { text: toPlainText(formatted), formatted };
  }

  /**
   * Whether inbound text exceeds `maxIncomingParseLength` or, outside fenced
   * code blocks, `maxIncomingEmphasisMarkers`, `maxIncomingClosingBrackets`,
   * `maxIncomingAngleBrackets`, `maxIncomingWwwAutolinks` in any one word, or
   * `maxIncomingContainerMarkers`. Checked before parsing, in linear time.
   */
  protected exceedsIncomingBudget(platformText: string): boolean {
    if (platformText.length > this.maxIncomingParseLength) {
      return true;
    }
    const skipFences = !FENCE_SKIP_DISABLED_PATTERN.test(platformText);
    let emphasisMarkers = 0;
    let closingBrackets = 0;
    let angleBrackets = 0;
    let fence: string | undefined;
    for (const line of platformText.split(LINE_ENDING_PATTERN)) {
      if (fence) {
        if (closesFence(line, fence)) {
          fence = undefined;
        }
        continue;
      }
      if (skipFences) {
        fence = fenceOpener(line);
        if (fence) {
          continue;
        }
      }
      const nesting = line.trim()
        ? countContainerMarkers(line) + Math.floor(leadingColumns(line) / 2)
        : 0;
      emphasisMarkers += countChars(line, "*_~");
      closingBrackets += countChars(line, "]");
      angleBrackets += countChars(line, "<");
      if (
        nesting > this.maxIncomingContainerMarkers ||
        emphasisMarkers > this.maxIncomingEmphasisMarkers ||
        closingBrackets > this.maxIncomingClosingBrackets ||
        angleBrackets > this.maxIncomingAngleBrackets ||
        exceedsWwwAutolinksPerWord(line, this.maxIncomingWwwAutolinks)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Text to keep when `parseIncoming` skips markdown parsing. Converters whose
   * platform text carries markup that shouldn't reach users, such as entities
   * or mention tokens, can override this. It must run in linear time.
   */
  protected incomingFallbackText(platformText: string): string {
    return platformText;
  }

  /**
   * Build the unformatted result `parseIncoming` returns when it skips
   * markdown parsing.
   */
  protected unparsedIncoming(platformText: string): {
    formatted: Root;
    text: string;
  } {
    const fallback = this.incomingFallbackText(platformText);
    return {
      text: fallback,
      formatted: root([paragraph([text(fallback)])]),
    };
  }

  // Convenience methods for markdown string I/O
  fromMarkdown(markdown: string): string {
    return this.fromAst(parseMarkdown(markdown));
  }

  toMarkdown(platformText: string): string {
    return stringifyMarkdown(this.toAst(platformText));
  }

  /** @deprecated Use extractPlainText instead */
  toPlainText(platformText: string): string {
    return this.extractPlainText(platformText);
  }

  /**
   * Convert a PostableMessage to platform format (text only).
   * - string: passed through as raw text (no conversion)
   * - { raw: string }: passed through as raw text (no conversion)
   * - { markdown: string }: converted from markdown to platform format
   * - { ast: Root }: converted from AST to platform format
   * - { card: CardElement }: returns fallback text (cards should be handled by adapter)
   * - CardElement: returns fallback text (cards should be handled by adapter)
   *
   * Note: For cards, adapters should check for card content first and render
   * them using platform-specific card APIs, using this method only for fallback.
   */
  renderPostable(message: PostableMessageInput): string {
    if (typeof message === "string") {
      return message;
    }
    if ("raw" in message) {
      return message.raw;
    }
    if ("markdown" in message) {
      return this.fromMarkdown(message.markdown);
    }
    if ("ast" in message) {
      return this.fromAst(message.ast);
    }
    if ("card" in message) {
      // Card with fallback text or generate from card content
      return message.fallbackText || this.cardToFallbackText(message.card);
    }
    if ("type" in message && message.type === "card") {
      // Direct CardElement
      return this.cardToFallbackText(message);
    }
    // Should never reach here with proper typing
    throw new Error("Invalid PostableMessage format");
  }

  /**
   * Generate fallback text from a card element.
   * Override in subclasses for platform-specific formatting.
   */
  protected cardToFallbackText(card: CardElement): string {
    const parts: string[] = [];

    if (card.title) {
      parts.push(`**${card.title}**`);
    }

    if (card.subtitle) {
      parts.push(card.subtitle);
    }

    for (const child of card.children) {
      const text = this.cardChildToFallbackText(child);
      if (text) {
        parts.push(text);
      }
    }

    return parts.join("\n");
  }

  /**
   * Convert card child element to fallback text.
   */
  protected cardChildToFallbackText(child: CardChild): string | null {
    switch (child.type) {
      case "text":
        return child.content;
      case "fields":
        return child.children
          .map((f) => `**${f.label}**: ${f.value}`)
          .join("\n");
      case "actions":
        // Actions are interactive-only — exclude from fallback text.
        // See: https://docs.slack.dev/reference/methods/chat.postMessage
        return null;
      case "table":
        return tableElementToAscii(child.headers, child.rows);
      case "chart":
        return chartElementToFallbackText(child);
      case "text_input":
        // An empty box carries no text of its own.
        return child.label;
      case "section":
        return child.children
          .map((c) => this.cardChildToFallbackText(c))
          .filter(Boolean)
          .join("\n");
      default:
        return null;
    }
  }
}
