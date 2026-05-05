import {
  BaseFormatConverter,
  parseMarkdown,
  type Root,
  stringifyMarkdown,
} from "chat";

/**
 * Format converter for the Web adapter.
 *
 * The Web "platform format" is markdown — the browser renders mdast (or the
 * AI SDK UIMessage text parts containing markdown) directly, so no
 * platform-specific markup translation is needed.
 */
export class WebFormatConverter extends BaseFormatConverter {
  toAst(platformText: string): Root {
    return parseMarkdown(platformText);
  }

  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }
}
