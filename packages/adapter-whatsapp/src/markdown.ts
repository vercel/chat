/**
 * WhatsApp format conversion.
 *
 * WhatsApp supports basic markdown (bold, italic, strikethrough, monospace)
 * but not full markdown syntax. This adapter emits normalized markdown text.
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

const WHATSAPP_MESSAGE_LIMIT = 4096;

export class WhatsAppFormatConverter extends BaseFormatConverter {
  fromAst(ast: Root): string {
    // Replace table nodes with ASCII code blocks since WhatsApp
    // does not support pipe-delimited table syntax.
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

    const result = stringifyMarkdown(transformed).trim();
    if (result.length <= WHATSAPP_MESSAGE_LIMIT) {
      return result;
    }
    return `${result.slice(0, WHATSAPP_MESSAGE_LIMIT - 3)}...`;
  }

  toAst(text: string): Root {
    return parseMarkdown(text);
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
