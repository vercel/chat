/**
 * X-specific format conversion using AST-based parsing.
 *
 * X tweets are plain text — they don't support markdown formatting.
 * The converter:
 * - toAst: Parses raw tweet text (with @mentions, URLs, #hashtags) into mdast
 * - fromAst: Flattens an mdast AST back to plain text suitable for tweeting
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

/**
 * Maximum character limit for a single tweet.
 * Longer messages are truncated with "…".
 */
const TWEET_CHAR_LIMIT = 280;

export class XFormatConverter extends BaseFormatConverter {
  /**
   * Convert an mdast AST to plain text suitable for posting as a tweet.
   *
   * Strips all formatting (bold, italic, strikethrough) since X doesn't
   * support markdown. Links are rendered as raw URLs.
   */
  fromAst(ast: Root): string {
    return this.fromAstWithNodeConverter(ast, (node) =>
      this.nodeToPlainText(node),
    );
  }

  /**
   * Parse tweet text into an mdast AST.
   *
   * Tweet text is essentially plain text with:
   * - @mentions (kept as-is)
   * - #hashtags (kept as-is)
   * - URLs (already expanded by the time we receive text in most cases)
   *
   * We parse it as standard markdown which handles the plain text case well.
   */
  toAst(text: string): Root {
    // Tweet text is effectively plain text — parse directly as markdown
    // which handles paragraphs, line breaks, and any incidental formatting
    return parseMarkdown(text);
  }

  /**
   * Convert any AdapterPostableMessage to a tweet-ready string.
   * Truncates to 280 characters if necessary.
   */
  override renderPostable(message: AdapterPostableMessage): string {
    let text: string;

    if (typeof message === "string") {
      text = message;
    } else if ("raw" in message) {
      text = message.raw;
    } else if ("markdown" in message) {
      text = this.fromAst(parseMarkdown(message.markdown));
    } else if ("ast" in message) {
      text = this.fromAst(message.ast);
    } else {
      text = "";
    }

    return this.truncate(text);
  }

  /**
   * Truncate text to the tweet character limit.
   */
  private truncate(text: string): string {
    if (text.length <= TWEET_CHAR_LIMIT) {
      return text;
    }
    return `${text.slice(0, TWEET_CHAR_LIMIT - 1)}…`;
  }

  /**
   * Convert an AST node to plain text.
   * Strips all formatting since tweets don't support markdown.
   */
  private nodeToPlainText(node: Content): string {
    if (isParagraphNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToPlainText(child))
        .join("");
    }

    if (isTextNode(node)) {
      return node.value;
    }

    if (isStrongNode(node) || isEmphasisNode(node) || isDeleteNode(node)) {
      // Strip formatting, keep content
      return getNodeChildren(node)
        .map((child) => this.nodeToPlainText(child))
        .join("");
    }

    if (isInlineCodeNode(node)) {
      return `\`${node.value}\``;
    }

    if (isCodeNode(node)) {
      return `\`\`\`\n${node.value}\n\`\`\``;
    }

    if (isLinkNode(node)) {
      // For tweets, just output the URL (X auto-links URLs)
      return node.url;
    }

    if (isBlockquoteNode(node)) {
      return getNodeChildren(node)
        .map((child) => `> ${this.nodeToPlainText(child)}`)
        .join("\n");
    }

    if (isListNode(node)) {
      return getNodeChildren(node)
        .map((item, i) => {
          const prefix = node.ordered ? `${i + 1}.` : "-";
          const content = getNodeChildren(item)
            .map((child) => this.nodeToPlainText(child))
            .join("");
          return `${prefix} ${content}`;
        })
        .join("\n");
    }

    if (isListItemNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToPlainText(child))
        .join("");
    }

    if (node.type === "break") {
      return "\n";
    }

    if (node.type === "thematicBreak") {
      return "---";
    }

    // Fallback: try to extract children or value
    const children = getNodeChildren(node);
    if (children.length > 0) {
      return children.map((child) => this.nodeToPlainText(child)).join("");
    }
    return getNodeValue(node);
  }
}
