/**
 * GitLab-specific format conversion using AST-based parsing.
 *
 * GitLab uses GitLab Flavored Markdown (GLFM), which builds on GitHub Flavored
 * Markdown (GFM). This converter passes standard markdown through and leaves
 * GitLab references as plain text for GitLab to render:
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
   * Override renderPostable to handle @mentions in plain strings.
   * GitLab @mentions are already in the correct format (@username).
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
    // Handle cards via base class
    return super.renderPostable(message);
  }
}
