/**
 * GitLab-specific format conversion using AST-based parsing.
 *
 * GitLab uses GitLab Flavored Markdown (GLFM), which builds on GitHub Flavored
 * Markdown (GFM). Markdown strings are posted as written, so GitLab references
 * reach GitLab unescaped and render as links:
 * - @mentions (user references)
 * - #123, !123, and ~label (issue, merge request, and label references)
 * - SHA references (commit links)
 */

import {
  type AdapterPostableMessage,
  BaseFormatConverter,
  parseMarkdown,
  type Root,
  stringifyMarkdown,
} from "chat";

export class GitLabFormatConverter extends BaseFormatConverter {
  /**
   * GLFM accepts standard GFM, so we can use remark-stringify directly.
   */
  fromAst(ast: Root): string {
    // Use standard markdown stringification
    // remark-stringify handles GFM well
    return stringifyMarkdown(ast).trim();
  }

  /**
   * Parse GitLab markdown into an AST.
   * GLFM is a superset of GFM, so we use the standard parser.
   */
  toAst(markdown: string): Root {
    return parseMarkdown(markdown);
  }

  /**
   * Strings and markdown are posted as written. Round-tripping markdown through
   * remark-stringify would escape GitLab reference syntax (`~label` becomes
   * `\~label`), which stops GitLab from linking it.
   */
  override renderPostable(message: AdapterPostableMessage): string {
    if (typeof message === "string") {
      return message;
    }
    if ("raw" in message) {
      return message.raw;
    }
    if ("markdown" in message) {
      return message.markdown;
    }
    if ("ast" in message) {
      return this.fromAst(message.ast);
    }
    // Handle cards via base class
    return super.renderPostable(message);
  }
}
