/**
 * Zoom-specific format conversion using AST-based parsing.
 *
 * Zoom Team Chat uses a markdown-like format with two differences from standard:
 * - Underline: __text__ (double underscore, not standard markdown)
 * - Strikethrough: ~text~ (single tilde, standard uses double ~~text~~)
 *
 * All other tokens (**bold**, _italic_, `code`, # heading, * list) are standard.
 */

import {
  BaseFormatConverter,
  type Content,
  parseMarkdown,
  type Root,
  stringifyMarkdown,
  walkAst,
} from "chat";
import type { PhrasingContent } from "mdast";
import type { UnderlineNode } from "./types.js";

export class ZoomFormatConverter extends BaseFormatConverter {
  /**
   * Convert Zoom markdown to mdast.
   *
   * Zoom tokens vs standard markdown:
   * - __underline__ — custom "underline" node (via link-sentinel approach)
   * - ~strikethrough~ — "delete" node (single → double tilde before parse)
   * - **bold**, _italic_, `code`, # heading, * list — standard (no conversion)
   */
  toAst(markdown: string): Root {
    const standardMarkdown = this.toStandardMarkdown(markdown);
    const ast = parseMarkdown(standardMarkdown);
    // Post-process: convert sentinel link nodes to UnderlineNode
    return walkAst(ast, (node: Content) => {
      if (
        node.type === "link" &&
        (node as Content & { url?: string }).url === "zoom-ul:"
      ) {
        const linkNode = node as Content & {
          url: string;
          children: PhrasingContent[];
        };
        return {
          type: "underline",
          children: linkNode.children,
        } as unknown as Content;
      }
      return node;
    });
  }

  /**
   * Convert mdast to Zoom markdown.
   *
   * Handles:
   * - Custom underline node → __text__
   * - delete node → ~strikethrough~ (post-process ~~...~~ → ~...~)
   * - Headings, lists: use stringifyMarkdown with * bullets
   */
  fromAst(ast: Root): string {
    const transformed = walkAst(
      structuredClone(ast) as Root,
      (node: Content) => {
        const nodeType = (node as unknown as { type: string }).type;
        if (nodeType === "underline") {
          const ul = node as unknown as UnderlineNode;
          // Render children as plain text content, wrap in __...__
          // Use an html inline node so stringifyMarkdown passes through the raw
          // __text__ token without escaping the underscores.
          const childText = ul.children
            .map((c) =>
              c.type === "text"
                ? (c as { type: "text"; value: string }).value
                : ""
            )
            .join("");
          return {
            type: "html",
            value: `__${childText}__`,
          } as Content;
        }
        return node;
      }
    );

    const markdown = stringifyMarkdown(transformed as Root, {
      emphasis: "_",
      bullet: "*", // Zoom uses * for list bullets
    }).trim();

    return this.toZoomMarkdown(markdown);
  }

  /**
   * Pre-process Zoom markdown to standard markdown for parseMarkdown().
   * CRITICAL: Handle __underline__ BEFORE standard markdown processing.
   * Double underscore is a superset of single underscore at regex level.
   */
  private toStandardMarkdown(text: string): string {
    // 1. Handle __underline__ first (double underscore before italic processing)
    //    Replace __text__ with a link sentinel that parseMarkdown will handle correctly.
    //    Using a link node [text](zoom-ul:) as the sentinel — recognized in AST post-processing.
    let result = text.replace(/__([^\n_]+?)__/g, "[$1](zoom-ul:)");

    // 2. Convert ~strikethrough~ to ~~strikethrough~~ (single → double tilde)
    //    Regex: single ~ not preceded or followed by ~, no newlines inside
    result = result.replace(/(?<!~)~(?!~)([^\n~]+?)(?<!~)~(?!~)/g, "~~$1~~");

    return result;
  }

  /**
   * Post-process standard markdown output to Zoom markdown tokens.
   * stringifyMarkdown outputs ~~strikethrough~~ — convert to ~strikethrough~.
   */
  private toZoomMarkdown(text: string): string {
    return text.replace(/~~(.+?)~~/g, "~$1~");
  }
}
