/**
 * Twitter / X format conversion.
 *
 * Twitter DMs use plain text with entity annotations (similar to Telegram).
 * For outbound messages, we send plain text since the DM API doesn't
 * support rich formatting (bold/italic/etc.) natively.
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

export class TwitterFormatConverter extends BaseFormatConverter {
  /**
   * Convert platform text to mdast AST.
   * Twitter DMs are plain text — we parse as if they were markdown
   * so that any user-typed markdown is preserved in the AST.
   */
  toAst(text: string): Root {
    return parseMarkdown(text);
  }

  /**
   * Convert mdast AST to platform text format.
   * Twitter DMs don't support rich formatting, so we try to
   * produce readable plain text. Tables get converted to ASCII art.
   */
  fromAst(ast: Root): string {
    const transformed = walkAst(structuredClone(ast), (node: Content) => {
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

  override renderPostable(message: AdapterPostableMessage): string {
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
    return super.renderPostable(message);
  }
}
