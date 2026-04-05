/**
 * Zalo-specific format conversion using AST-based parsing.
 *
 * Zalo Bot API has no rich text formatting support.
 * All messages are sent and received as plain text.
 */

import {
  type AdapterPostableMessage,
  BaseFormatConverter,
  type Content,
  isTableNode,
  parseMarkdown,
  type Root,
  stringifyMarkdown,
  tableToAscii,
  walkAst,
} from "chat";

export class ZaloFormatConverter extends BaseFormatConverter {
  /**
   * Convert an AST to plain text for Zalo.
   *
   * Strips all markdown formatting since Zalo doesn't render it.
   * Preserves structure via whitespace.
   */
  fromAst(ast: Root): string {
    const transformed = walkAst(structuredClone(ast), (node: Content) => {
      // Headings -> plain paragraph (strip bold wrapping)
      if (node.type === "heading") {
        const heading = node as Content & { children: Content[] };
        const children = heading.children.flatMap((child) =>
          child.type === "strong"
            ? (child as Content & { children: Content[] }).children
            : [child]
        );
        return {
          type: "paragraph",
          children,
        } as Content;
      }
      // Thematic breaks -> text separator
      if (node.type === "thematicBreak") {
        return {
          type: "paragraph",
          children: [{ type: "text", value: "---" }],
        } as Content;
      }
      // Tables -> ASCII table
      if (isTableNode(node)) {
        return {
          type: "code" as const,
          value: tableToAscii(node),
          lang: undefined,
        } as Content;
      }
      return node;
    });

    // Stringify as plain markdown, then strip formatting markers
    const markdown = stringifyMarkdown(transformed, {
      emphasis: "_",
      bullet: "-",
    }).trim();

    return this.stripFormatting(markdown);
  }

  /**
   * Parse plain text from Zalo into an AST.
   */
  toAst(text: string): Root {
    return parseMarkdown(text);
  }

  /**
   * Render a postable message to a plain text string for Zalo.
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
    return super.renderPostable(message);
  }

  /**
   * Strip markdown formatting markers so output is plain text.
   * Converts **bold** -> text, _italic_ -> text, ~~strike~~ -> text.
   */
  private stripFormatting(text: string): string {
    let result = text;
    // Strip **bold**
    result = result.replace(/\*\*(.+?)\*\*/g, "$1");
    // Strip *bold* (single asterisk)
    result = result.replace(/\*(.+?)\*/g, "$1");
    // Strip _italic_
    result = result.replace(/_(.+?)_/g, "$1");
    // Strip ~~strikethrough~~
    result = result.replace(/~~(.+?)~~/g, "$1");
    return result;
  }
}
