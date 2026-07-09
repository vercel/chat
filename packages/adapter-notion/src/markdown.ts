/**
 * Notion comment format conversion.
 *
 * Outbound: prefer Notion's native `markdown` body parameter (inline subset).
 * Inbound: map rich-text spans → mdast via plain_text concatenation for M1;
 * richer AST mapping lands in M2.
 */

import {
  type AdapterPostableMessage,
  BaseFormatConverter,
  parseMarkdown,
  type Root,
  stringifyMarkdown,
} from "chat";
import type { NotionRichText } from "./types";

const HEADING_LINE = /^#{1,6}\s+(.+)$/gm;
const FENCED_CODE = /```[\w]*\n?([\s\S]*?)```/g;
const BLOCKQUOTE_PREFIX = /^>\s?/gm;
const UNORDERED_LIST = /^[\t ]*[-*+]\s+/gm;
const ORDERED_LIST = /^[\t ]*\d+\.\s+/gm;
const TABLE_SEPARATOR = /^\|[-:| ]+\|$/gm;
const TABLE_ROW = /^\|(.+)\|$/gm;

export class NotionFormatConverter extends BaseFormatConverter {
  fromAst(ast: Root): string {
    return stringifyMarkdown(ast).trim();
  }

  toAst(markdown: string): Root {
    return parseMarkdown(markdown);
  }

  /** Concatenate rich-text plain_text for Message.text. */
  richTextToPlain(richText: NotionRichText[]): string {
    return richText.map((span) => span.plain_text).join("");
  }

  /** Best-effort markdown from rich-text for formatted AST (M1). */
  richTextToMarkdown(richText: NotionRichText[]): string {
    const parts: string[] = [];
    for (const span of richText) {
      let text = span.plain_text;
      if (span.type === "mention") {
        parts.push(text);
        continue;
      }
      if (span.type === "equation" && span.equation) {
        parts.push(`$${span.equation.expression}$`);
        continue;
      }
      const { annotations } = span;
      if (annotations.code) {
        text = `\`${text}\``;
      }
      if (annotations.bold) {
        text = `**${text}**`;
      }
      if (annotations.italic) {
        text = `*${text}*`;
      }
      if (annotations.strikethrough) {
        text = `~~${text}~~`;
      }
      if (span.href) {
        text = `[${text}](${span.href})`;
      } else if (span.text?.link?.url) {
        text = `[${text}](${span.text.link.url})`;
      }
      parts.push(text);
    }
    return parts.join("");
  }

  override renderPostable(message: AdapterPostableMessage): string {
    if (typeof message === "string") {
      return this.normalizeCommentMarkdown(message);
    }
    if ("raw" in message) {
      return this.normalizeCommentMarkdown(message.raw);
    }
    if ("markdown" in message) {
      return this.normalizeCommentMarkdown(this.fromMarkdown(message.markdown));
    }
    if ("ast" in message) {
      return this.normalizeCommentMarkdown(this.fromAst(message.ast));
    }
    return this.normalizeCommentMarkdown(super.renderPostable(message));
  }

  /**
   * Notion comment markdown supports inline constructs only.
   * Strip / flatten headings, lists, tables, blockquotes, fenced code.
   */
  normalizeCommentMarkdown(markdown: string): string {
    let text = markdown;
    text = text.replace(HEADING_LINE, "**$1**");
    text = text.replace(FENCED_CODE, (_m, code: string) => {
      const trimmed = code.trim();
      if (!trimmed.includes("\n") && trimmed.length < 200) {
        return `\`${trimmed}\``;
      }
      return trimmed;
    });
    text = text.replace(BLOCKQUOTE_PREFIX, "");
    text = text.replace(UNORDERED_LIST, "");
    text = text.replace(ORDERED_LIST, "");
    text = text.replace(TABLE_SEPARATOR, "");
    text = text.replace(TABLE_ROW, (_m, row: string) =>
      row
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean)
        .join(" — ")
    );
    return text.trim();
  }
}
