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

import { normalizeCodeFences } from "@chat-adapter/shared";
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
   * into WhatsApp-compatible equivalents and renders supported formatting
   * directly in WhatsApp syntax.
   */
  fromAst(ast: Root): string {
    const transformed = walkAst(structuredClone(ast), (node: Content) => {
      // Headings -> bold paragraph (flatten nested strong to avoid ***)
      if (node.type === "heading") {
        const heading = node as Content & { children: Content[] };
        const children = heading.children.flatMap((child) =>
          child.type === "strong"
            ? (child as Content & { children: Content[] }).children
            : [child]
        );
        return {
          type: "paragraph",
          children: [{ type: "strong", children }],
        } as Content;
      }
      // Thematic breaks -> text separator
      if (node.type === "thematicBreak") {
        return {
          type: "paragraph",
          children: [{ type: "text", value: "━━━" }],
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
    const options = {
      emphasis: "_",
      bullet: "-",
      handlers: {
        text: (node) => node.value,
        strong: (node, _parent, state, info) =>
          `*${state.containerPhrasing(node, { ...info, before: "*", after: "*" })}*`,
        delete: (node, _parent, state, info) =>
          `~${state.containerPhrasing(node, { ...info, before: "~", after: "~" })}~`,
      },
    } satisfies Parameters<typeof stringifyMarkdown>[1];
    // Lookahead must not serialize nested formatting a second time.
    Object.assign(options.handlers.strong, { peek: () => "*" });
    Object.assign(options.handlers.delete, { peek: () => "~" });
    return stringifyMarkdown(transformed, options).trim();
  }

  /**
   * Parse WhatsApp markdown into an AST.
   *
   * Normalizes WhatsApp's ``` fences for CommonMark (the text after the
   * opening fence is code, not an info string) and transforms
   * WhatsApp-specific formatting to standard markdown outside the fences,
   * then parses with the standard parser.
   */
  toAst(markdown: string): Root {
    const standardMarkdown = normalizeCodeFences(markdown, {
      convertText: (text) => this.fromWhatsAppFormat(text),
    });
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
