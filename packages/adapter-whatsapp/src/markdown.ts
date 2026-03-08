/**
 * WhatsApp-specific format conversion using AST-based parsing.
 *
 * WhatsApp uses a markdown-like format with some differences from standard:
 * - Bold: *text* (single asterisk, not double)
 * - Italic: _text_
 * - Strikethrough: ~text~ (single tilde, not double)
 * - Monospace: ```text```
 *
 * @see https://faq.whatsapp.com/539178204879377
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
export class WhatsAppFormatConverter extends BaseFormatConverter {
  /**
   * Convert an AST to WhatsApp markdown format.
   *
   * Transforms unsupported nodes (headings, thematic breaks, tables)
   * into WhatsApp-compatible equivalents, then converts standard markdown
   * bold/strikethrough to WhatsApp syntax.
   */
  fromAst(ast: Root): string {
    const transformed = walkAst(structuredClone(ast), (node: Content) => {
      // Headings -> bold paragraph
      if (node.type === "heading") {
        const heading = node as Content & { children: Content[] };
        return {
          type: "paragraph",
          children: [{ type: "strong", children: heading.children }],
        } as Content;
      }
      // Thematic breaks -> text separator
      if (node.type === "thematicBreak") {
        return {
          type: "paragraph",
          children: [{ type: "text", value: "---" }],
        } as Content;
      }
      // Tables -> code blocks (same as Telegram)
      if (isTableNode(node)) {
        return {
          type: "code" as const,
          value: tableToAscii(node),
          lang: undefined,
        } as Content;
      }
      return node;
    });
    const standardMarkdown = stringifyMarkdown(transformed).trim();
    return this.toWhatsAppFormat(standardMarkdown);
  }

  /**
   * Parse WhatsApp markdown into an AST.
   *
   * Transforms WhatsApp-specific formatting to standard markdown first,
   * then parses with the standard parser.
   */
  toAst(markdown: string): Root {
    const standardMarkdown = this.fromWhatsAppFormat(markdown);
    return parseMarkdown(standardMarkdown);
  }

  /**
   * Render a postable message to WhatsApp-compatible string.
   */
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

  /**
   * Convert standard markdown to WhatsApp format.
   * **bold** -> *bold*, *italic* -> _italic_, ~~strike~~ -> ~strike~
   */
  private toWhatsAppFormat(text: string): string {
    // Protect escaped formatting chars
    const ESC_STAR = "%%ESC_STAR%%";
    const ESC_TILDE = "%%ESC_TILDE%%";
    let result = text.replace(/\\\*/g, ESC_STAR).replace(/\\~/g, ESC_TILDE);
    // First: convert *italic* -> _italic_ (single * not adjacent to another *)
    result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "_$1_");
    // Then: convert **bold** -> *bold*
    result = result.replace(/\*\*(.+?)\*\*/g, "*$1*");
    // Convert ~~strikethrough~~ -> ~strikethrough~
    result = result.replace(/~~(.+?)~~/g, "~$1~");
    // Restore escaped chars
    result = result
      .replace(new RegExp(ESC_STAR, "g"), "\\*")
      .replace(new RegExp(ESC_TILDE, "g"), "\\~");
    return result;
  }

  /**
   * Convert WhatsApp format to standard markdown.
   * Converts single-asterisk bold to double-asterisk bold,
   * and single-tilde strikethrough to double-tilde strikethrough.
   *
   * Careful not to convert _italic_ (which is the same in both formats).
   */
  private fromWhatsAppFormat(text: string): string {
    // Convert *bold* to **bold** (single * not preceded/followed by *, no newlines)
    let result = text.replace(
      /(?<!\*)\*(?!\*)([^\n*]+?)(?<!\*)\*(?!\*)/g,
      "**$1**"
    );
    // Convert ~strike~ to ~~strike~~ (single ~ not preceded/followed by ~, no newlines)
    result = result.replace(/(?<!~)~(?!~)([^\n~]+?)(?<!~)~(?!~)/g, "~~$1~~");
    return result;
  }
}
