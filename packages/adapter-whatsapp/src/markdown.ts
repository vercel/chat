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
  parseMarkdown,
  type Root,
  stringifyMarkdown,
} from "chat";

export class WhatsAppFormatConverter extends BaseFormatConverter {
  /**
   * Convert an AST to WhatsApp markdown format.
   *
   * Transforms standard markdown bold (**text**) to WhatsApp bold (*text*)
   * and standard strikethrough (~~text~~) to WhatsApp strikethrough (~text~).
   */
  fromAst(ast: Root): string {
    const standardMarkdown = stringifyMarkdown(ast).trim();
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
   * **bold** -> *bold*, ~~strike~~ -> ~strike~
   */
  private toWhatsAppFormat(text: string): string {
    // Convert **bold** to *bold* (avoid converting already single *)
    let result = text.replace(/\*\*(.+?)\*\*/g, "*$1*");
    // Convert ~~strikethrough~~ to ~strikethrough~
    result = result.replace(/~~(.+?)~~/g, "~$1~");
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
