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
  Text,
} from "mdast";

import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import type { CardChild, CardElement } from "./cards";
import type { AdapterPostableMessage } from "./types";

// Alias for use within this file
type PostableMessageInput = AdapterPostableMessage;

// Re-export types for adapters
export type {
  Root,
  Content,
  Text,
  Strong,
  Emphasis,
  Delete,
  InlineCode,
  Code,
  Link,
  Blockquote,
  List,
  ListItem,
  Paragraph,
};

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
 * Parse markdown string into an AST.
 * Supports GFM (GitHub Flavored Markdown) for strikethrough, tables, etc.
 */
export function parseMarkdown(markdown: string): Root {
  const processor = unified().use(remarkParse).use(remarkGfm);
  return processor.parse(markdown);
}

/**
 * Stringify an AST back to markdown.
 */
export function stringifyMarkdown(ast: Root): string {
  const processor = unified().use(remarkStringify).use(remarkGfm);
  return processor.stringify(ast);
}

/**
 * Extract plain text from an AST (strips all formatting).
 */
export function toPlainText(ast: Root): string {
  return toString(ast);
}

/**
 * Extract plain text from a markdown string.
 */
export function markdownToPlainText(markdown: string): string {
  const ast = parseMarkdown(markdown);
  return toString(ast);
}

/**
 * Walk the AST and transform nodes.
 */
export function walkAst<T extends Content | Root>(
  node: T,
  visitor: (node: Content) => Content | null,
): T {
  if ("children" in node && Array.isArray(node.children)) {
    node.children = node.children
      .map((child) => {
        const result = visitor(child as Content);
        if (result === null) return null;
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
   * Render an AST to the platform's native format.
   * This is the primary method used when sending messages.
   */
  fromAst(ast: Root): string;

  /**
   * Parse platform's native format into an AST.
   * This is the primary method used when receiving messages.
   */
  toAst(platformText: string): Root;

  /**
   * Extract plain text from platform format.
   * Convenience method - default implementation uses toAst + toPlainText.
   */
  extractPlainText(platformText: string): string;
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
    nodeConverter: (node: Content) => string,
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
