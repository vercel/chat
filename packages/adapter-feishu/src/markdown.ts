/**
 * Feishu-specific format conversion using AST-based parsing.
 *
 * Feishu text messages support:
 * - Bold: <b>text</b>
 * - Italic: <i>text</i>
 * - Underline: <u>text</u> (mapped to emphasis in mdast)
 * - Strikethrough: <s>text</s>
 * - Links: [text](url)
 * - Mentions: <at user_id="ou_xxx">Name</at>
 * - Code: `text` and ```blocks```
 *
 * Feishu also has a "post" (rich text) JSON format for richer messages.
 */

import {
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

import type {
  FeishuPostContent,
  FeishuPostElement,
  FeishuPostParagraph,
} from "./types";

export class FeishuFormatConverter extends BaseFormatConverter {
  /**
   * Parse Feishu text message into mdast AST.
   *
   * Converts Feishu HTML-like tags to standard markdown, then parses.
   */
  toAst(feishuText: string): Root {
    let markdown = feishuText;

    // Convert <at> tags to @Name
    markdown = markdown.replace(/<at user_id="[^"]*">([^<]*)<\/at>/g, "@$1");

    // Convert HTML-like formatting tags to markdown
    markdown = markdown.replace(/<b>([\s\S]*?)<\/b>/g, "**$1**");
    markdown = markdown.replace(/<i>([\s\S]*?)<\/i>/g, "_$1_");
    markdown = markdown.replace(/<s>([\s\S]*?)<\/s>/g, "~~$1~~");
    // Underline has no mdast equivalent; map to emphasis
    markdown = markdown.replace(/<u>([\s\S]*?)<\/u>/g, "_$1_");

    return parseMarkdown(markdown);
  }

  /**
   * Render mdast AST to Feishu text format.
   */
  fromAst(ast: Root): string {
    return this.fromAstWithNodeConverter(ast, (node) =>
      this.nodeToFeishu(node)
    );
  }

  /**
   * Convert mdast AST to Feishu post (rich text) JSON content.
   *
   * Used in postMessage for better formatting fidelity.
   */
  toPostContent(ast: Root, title?: string): FeishuPostContent {
    const paragraphs: FeishuPostParagraph[] = [];

    for (const child of ast.children) {
      const elements = this.nodeToPostElements(child as Content);
      if (elements.length > 0) {
        paragraphs.push(elements);
      }
    }

    return {
      zh_cn: {
        ...(title ? { title } : {}),
        content: paragraphs,
      },
    };
  }

  private nodeToFeishu(node: Content): string {
    if (isParagraphNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToFeishu(child))
        .join("");
    }

    if (isTextNode(node)) {
      return node.value;
    }

    if (isStrongNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToFeishu(child))
        .join("");
      return `<b>${content}</b>`;
    }

    if (isEmphasisNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToFeishu(child))
        .join("");
      return `<i>${content}</i>`;
    }

    if (isDeleteNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToFeishu(child))
        .join("");
      return `<s>${content}</s>`;
    }

    if (isInlineCodeNode(node)) {
      return `\`${node.value}\``;
    }

    if (isCodeNode(node)) {
      return `\`\`\`\n${node.value}\n\`\`\``;
    }

    if (isLinkNode(node)) {
      const linkText = getNodeChildren(node)
        .map((child) => this.nodeToFeishu(child))
        .join("");
      return `[${linkText}](${node.url})`;
    }

    if (isBlockquoteNode(node)) {
      return getNodeChildren(node)
        .map((child) => `> ${this.nodeToFeishu(child)}`)
        .join("\n");
    }

    if (isListNode(node)) {
      return getNodeChildren(node)
        .map((item, i) => {
          const prefix = node.ordered ? `${i + 1}.` : "•";
          const content = getNodeChildren(item)
            .map((child) => this.nodeToFeishu(child))
            .join("");
          return `${prefix} ${content}`;
        })
        .join("\n");
    }

    if (isListItemNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToFeishu(child))
        .join("");
    }

    if (node.type === "break") {
      return "\n";
    }

    if (node.type === "thematicBreak") {
      return "---";
    }

    // Fallback: extract text from children
    const children = getNodeChildren(node);
    if (children.length > 0) {
      return children.map((child) => this.nodeToFeishu(child)).join("");
    }
    return getNodeValue(node);
  }

  /**
   * Convert mdast node to Feishu post elements.
   */
  private nodeToPostElements(node: Content): FeishuPostElement[] {
    if (isParagraphNode(node)) {
      const elements: FeishuPostElement[] = [];
      for (const child of getNodeChildren(node)) {
        elements.push(...this.inlineToPostElements(child));
      }
      return elements;
    }

    if (isCodeNode(node)) {
      return [
        {
          tag: "code_block" as const,
          language: node.lang || undefined,
          text: node.value,
        },
      ];
    }

    if (isBlockquoteNode(node)) {
      // Flatten blockquote children as text with "> " prefix
      const text = getNodeChildren(node)
        .map((child) => this.nodeToFeishu(child))
        .join("");
      return [{ tag: "text" as const, text: `> ${text}` }];
    }

    if (isListNode(node)) {
      return getNodeChildren(node).map((item, i) => {
        const prefix = node.ordered ? `${i + 1}.` : "•";
        const content = getNodeChildren(item)
          .map((child) => this.nodeToFeishu(child))
          .join("");
        return { tag: "text" as const, text: `${prefix} ${content}` };
      });
    }

    if (node.type === "thematicBreak") {
      return [{ tag: "hr" as const }];
    }

    // Fallback
    const text = this.nodeToFeishu(node);
    if (text) {
      return [{ tag: "text" as const, text }];
    }
    return [];
  }

  /**
   * Convert inline mdast nodes to post elements with style.
   */
  private inlineToPostElements(node: Content): FeishuPostElement[] {
    if (isTextNode(node)) {
      return [{ tag: "text" as const, text: node.value }];
    }

    if (isStrongNode(node)) {
      const text = getNodeChildren(node)
        .map((child) => getNodeValue(child))
        .join("");
      return [{ tag: "text" as const, text, style: ["bold"] }];
    }

    if (isEmphasisNode(node)) {
      const text = getNodeChildren(node)
        .map((child) => getNodeValue(child))
        .join("");
      return [{ tag: "text" as const, text, style: ["italic"] }];
    }

    if (isDeleteNode(node)) {
      const text = getNodeChildren(node)
        .map((child) => getNodeValue(child))
        .join("");
      return [{ tag: "text" as const, text, style: ["lineThrough"] }];
    }

    if (isInlineCodeNode(node)) {
      return [{ tag: "text" as const, text: `\`${node.value}\`` }];
    }

    if (isLinkNode(node)) {
      const text = getNodeChildren(node)
        .map((child) => getNodeValue(child))
        .join("");
      return [{ tag: "a" as const, text, href: node.url }];
    }

    // Fallback
    const value = getNodeValue(node);
    if (value) {
      return [{ tag: "text" as const, text: value }];
    }
    return [];
  }
}
