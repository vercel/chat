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

export class LinqFormatConverter extends BaseFormatConverter {
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

    return this.stripMarkdown(stringifyMarkdown(transformed).trim());
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

  private stripMarkdown(markdown: string): string {
    return (
      markdown
        // Bold
        .replace(/\*\*(.+?)\*\*/g, "$1")
        // Italic
        .replace(/\*(.+?)\*/g, "$1")
        .replace(/_(.+?)_/g, "$1")
        // Strikethrough
        .replace(/~~(.+?)~~/g, "$1")
        // Inline code
        .replace(/`(.+?)`/g, "$1")
        // Links
        .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)")
        // Headers
        .replace(/^#{1,6}\s+(.+)$/gm, "$1")
        .trim()
    );
  }
}
