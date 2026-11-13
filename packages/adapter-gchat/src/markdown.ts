/**
 * Google Chat-specific format conversion using AST-based parsing.
 *
 * Google Chat supports a subset of text formatting:
 * - Bold: *text*
 * - Italic: _text_
 * - Strikethrough: ~text~
 * - Monospace: `text`
 * - Code blocks: ```text```
 * - Links are auto-detected
 *
 * Very similar to Slack's mrkdwn format.
 */

import {
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

const CODE_FENCE = "```";
const BOLD_PATTERN = /(?<![_*\\])\*([^\s*](?:[^*\n]*[^\s*])?)\*(?![_*])/g;
const STRIKETHROUGH_PATTERN = /(?<!~)~([^\s~](?:[^~\n]*[^\s~])?)~(?!~)/g;
const MARKER_PATTERN = /[*~]/g;

/**
 * Google Chat bold/strikethrough only wraps when a non-space character sits
 * directly inside each marker, and never applies inside code. Matching any
 * `*...*` pair also turned multiplication (`2 * 3`) into bold and rewrote
 * code such as `rm -rf *`. Same approach as the Slack adapter's
 * `applyEmphasis`, plus skipping fenced code blocks.
 */
function applyEmphasis(text: string): string {
  let masked = "";
  let cursor = 0;
  let start = 0;

  while (cursor < text.length) {
    if (text[cursor] !== "`") {
      cursor += 1;
      continue;
    }
    const isFence = text.startsWith(CODE_FENCE, cursor);
    const end = isFence
      ? findCodeFenceEnd(text, cursor)
      : findInlineCodeEnd(text, cursor);
    if (end === -1) {
      cursor += isFence ? CODE_FENCE.length : 1;
      continue;
    }
    masked += text.slice(start, cursor) + "x".repeat(end - cursor);
    start = end;
    cursor = end;
  }

  masked += text.slice(start);
  const markers = new Set<number>();
  for (const pattern of [BOLD_PATTERN, STRIKETHROUGH_PATTERN]) {
    for (const match of masked.matchAll(pattern)) {
      markers.add(match.index);
      markers.add(match.index + match[0].length - 1);
    }
  }
  return text.replace(MARKER_PATTERN, (marker, index: number) =>
    markers.has(index) ? marker.repeat(2) : marker
  );
}

function findCodeFenceEnd(text: string, index: number): number {
  const close = text.indexOf(CODE_FENCE, index + CODE_FENCE.length);
  return close === -1 ? -1 : close + CODE_FENCE.length;
}

// Inline code spans never cross line breaks.
function findInlineCodeEnd(text: string, index: number): number {
  let cursor = index + 1;
  while (
    cursor < text.length &&
    text[cursor] !== "`" &&
    text[cursor] !== "\n" &&
    text[cursor] !== "\r"
  ) {
    cursor += 1;
  }
  return text[cursor] === "`" ? cursor + 1 : -1;
}

export class GoogleChatFormatConverter extends BaseFormatConverter {
  /**
   * Render an AST to Google Chat format.
   */
  fromAst(ast: Root): string {
    return this.fromAstWithNodeConverter(ast, (node) => this.nodeToGChat(node));
  }

  /**
   * Parse Google Chat message into an AST.
   */
  toAst(gchatText: string): Root {
    return parseMarkdown(this.toStandardMarkdown(gchatText));
  }

  /**
   * Check the budget against the markdown that `toAst` parses, after Google
   * Chat bold and strikethrough are converted. The length limit still applies
   * to the text as delivered.
   */
  protected override exceedsIncomingBudget(gchatText: string): boolean {
    return (
      gchatText.length > this.maxIncomingParseLength ||
      super.exceedsIncomingBudget(this.toStandardMarkdown(gchatText))
    );
  }

  /**
   * Convert Google Chat format to standard markdown.
   */
  private toStandardMarkdown(gchatText: string): string {
    // Bold: *text* -> **text**, strikethrough: ~text~ -> ~~text~~.
    // Italic and code are the same format as markdown.
    return applyEmphasis(gchatText);
  }

  private nodeToGChat(node: Content): string {
    // Use type guards for type-safe node handling
    if (isParagraphNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToGChat(child))
        .join("");
    }

    if (isTextNode(node)) {
      // Google Chat: @mentions are passed through as-is
      // To create clickable mentions in Google Chat, you'd need to use <users/{user_id}> format
      // which requires user ID lookup - beyond the scope of format conversion
      return node.value;
    }

    if (isStrongNode(node)) {
      // Markdown **text** -> GChat *text*
      const content = getNodeChildren(node)
        .map((child) => this.nodeToGChat(child))
        .join("");
      return `*${content}*`;
    }

    if (isEmphasisNode(node)) {
      // Both use _text_
      const content = getNodeChildren(node)
        .map((child) => this.nodeToGChat(child))
        .join("");
      return `_${content}_`;
    }

    if (isDeleteNode(node)) {
      // Markdown ~~text~~ -> GChat ~text~
      const content = getNodeChildren(node)
        .map((child) => this.nodeToGChat(child))
        .join("");
      return `~${content}~`;
    }

    if (isInlineCodeNode(node)) {
      return `\`${node.value}\``;
    }

    if (isCodeNode(node)) {
      return `\`\`\`\n${node.value}\n\`\`\``;
    }

    if (isLinkNode(node)) {
      // Google Chat supports custom link labels using <url|text> syntax.
      const linkText = getNodeChildren(node)
        .map((child) => this.nodeToGChat(child))
        .join("");
      if (linkText === node.url) {
        return node.url;
      }
      const collapsibleSchemes = ["mailto:", "tel:"];
      for (const scheme of collapsibleSchemes) {
        if (!node.url.startsWith(scheme)) {
          continue;
        }
        const bareValue = node.url.slice(scheme.length);
        if (bareValue === linkText) {
          return bareValue;
        }
      }
      return `<${node.url}|${linkText}>`;
    }

    if (isBlockquoteNode(node)) {
      // Google Chat doesn't have native blockquote, use > prefix
      return getNodeChildren(node)
        .map((child) => `> ${this.nodeToGChat(child)}`)
        .join("\n");
    }

    if (isListNode(node)) {
      return this.renderList(node, 0, (child) => this.nodeToGChat(child), "•");
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

    return this.defaultNodeToText(node, (child) => this.nodeToGChat(child));
  }
}
