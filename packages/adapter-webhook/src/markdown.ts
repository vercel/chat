import {
  type AdapterPostableMessage,
  BaseFormatConverter,
  parseMarkdown,
  type Root,
  stringifyMarkdown,
} from "chat";

/**
 * Format converter for the webhook adapter. Inbound text and outbound text
 * are both Markdown; your `send` callback converts it to the platform format.
 */
export class WebhookFormatConverter extends BaseFormatConverter {
  fromAst(ast: Root): string {
    return stringifyMarkdown(ast).trim();
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
