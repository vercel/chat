/**
 * XChat-specific format conversion using AST-based parsing.
 *
 * XChat clients render messages as plain text — there is no markdown
 * rendering. The converter passes markdown through unchanged, so markers
 * like `**bold**` appear literally but stay readable as plain-text
 * conventions; URLs and @mentions are made tappable separately via
 * entity spans.
 *
 * Tables are the one exception: raw GFM table syntax is unreadable as
 * plain text, so they are converted to ASCII art in code blocks.
 */

import {
  BaseFormatConverter,
  type Content,
  isTableNode,
  parseMarkdown,
  type Root,
  stringifyMarkdown,
  tableToAscii,
  walkAst,
} from "chat";

export class XchatFormatConverter extends BaseFormatConverter {
  /**
   * Convert an AST to the text sent in an XChat message.
   *
   * Markdown is stringified as-is and shows up literally in clients, with
   * one exception: tables are converted to ASCII art in code blocks since
   * raw GFM table syntax is unreadable as plain text.
   */
  fromAst(ast: Root): string {
    const transformed = walkAst(structuredClone(ast), (node: Content) => {
      // Tables -> code blocks (ASCII art)
      if (isTableNode(node)) {
        return {
          type: "code" as const,
          value: tableToAscii(node),
          lang: undefined,
        } as Content;
      }
      return node;
    });

    return stringifyMarkdown(transformed).trim();
  }

  /**
   * Parse standard markdown into an AST.
   */
  toAst(markdown: string): Root {
    return parseMarkdown(markdown);
  }
}
