/**
 * Slack format conversion.
 *
 * Outgoing: Slack now natively renders markdown via the `markdown_text` field
 * on chat.postMessage / postEphemeral / update / scheduleMessage. We pass
 * markdown through there and let Slack handle it. Interactive `response_url`
 * payloads do not accept `markdown_text`, so those still use Slack mrkdwn text.
 *
 * Incoming: Slack `message` events still deliver text as mrkdwn
 * (`*bold*`, `<@U123>`, `<url|text>`), so the toAst parser stays.
 */

import { replaceBareMentions } from "@chat-adapter/shared";
import {
  type AdapterPostableMessage,
  BaseFormatConverter,
  type Content,
  convertEmojiPlaceholders,
  getNodeChildren,
  isBlockquoteNode,
  isCodeNode,
  isDeleteNode,
  isEmphasisNode,
  isInlineCodeNode,
  isLinkNode,
  isListNode,
  isParagraphNode,
  isStrongNode,
  isTableNode,
  isTextNode,
  parseMarkdown,
  type Root,
  stringifyMarkdown,
  tableToAscii,
} from "chat";
import { slackMrkdwnToMarkdown } from "./format";

export type SlackTextPayload = { text: string } | { markdown_text: string };

export class SlackFormatConverter extends BaseFormatConverter {
  /**
   * Render an AST to standard markdown. Slack accepts this directly via
   * `markdown_text` and the `markdown` block.
   */
  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }

  /**
   * Parse Slack mrkdwn into an AST. Used for incoming `message` events.
   */
  toAst(mrkdwn: string): Root {
    return parseMarkdown(slackMrkdwnToMarkdown(mrkdwn));
  }

  /**
   * Build the Slack API payload fields for a message.
   *
   * - `string` / `{ raw }` → `{ text }` (plain — preserves literal `*`, `_`, etc.)
   * - `{ markdown }` / `{ ast }` → `{ markdown_text }` (Slack renders natively)
   *
   * Bare `@user` mentions are rewritten to `<@user>` and `:emoji:` placeholders
   * are normalized for Slack in all branches.
   *
   * Note: `markdown_text` has a 12,000 character limit; `text` allows ~40,000.
   * Note: `markdown_text` is mutually exclusive with `text` and `blocks`.
   */
  toSlackPayload(message: AdapterPostableMessage): SlackTextPayload {
    if (typeof message === "string") {
      return { text: this.finalize(message) };
    }
    if ("raw" in message) {
      return { text: this.finalize(message.raw) };
    }
    if ("markdown" in message) {
      return { markdown_text: this.finalize(message.markdown) };
    }
    if ("ast" in message) {
      return { markdown_text: this.finalize(stringifyMarkdown(message.ast)) };
    }
    return { text: "" };
  }

  /**
   * Build text for Slack response_url payloads.
   *
   * Slack rejects `markdown_text` on response_url (`no_text`), so markdown/AST
   * messages are rendered to Slack's legacy mrkdwn format for this surface.
   */
  toResponseUrlText(message: AdapterPostableMessage): string {
    if (typeof message === "string") {
      return this.finalize(message);
    }
    if ("raw" in message) {
      return this.finalize(message.raw);
    }
    if ("markdown" in message) {
      return convertEmojiPlaceholders(
        this.astToMrkdwn(parseMarkdown(message.markdown)),
        "slack"
      );
    }
    if ("ast" in message) {
      return convertEmojiPlaceholders(this.astToMrkdwn(message.ast), "slack");
    }
    return "";
  }

  private finalize(text: string): string {
    return convertEmojiPlaceholders(linkBareMentionNames(text), "slack");
  }

  private astToMrkdwn(ast: Root): string {
    return this.fromAstWithNodeConverter(ast, (node) =>
      this.nodeToMrkdwn(node)
    );
  }

  private nodeToMrkdwn(node: Content): string {
    if (isParagraphNode(node)) {
      return getNodeChildren(node)
        .map((child) => this.nodeToMrkdwn(child))
        .join("");
    }

    if (isTextNode(node)) {
      return linkBareMentionNames(node.value);
    }

    if (isStrongNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToMrkdwn(child))
        .join("");
      return `*${content}*`;
    }

    if (isEmphasisNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToMrkdwn(child))
        .join("");
      return `_${content}_`;
    }

    if (isDeleteNode(node)) {
      const content = getNodeChildren(node)
        .map((child) => this.nodeToMrkdwn(child))
        .join("");
      return `~${content}~`;
    }

    if (isInlineCodeNode(node)) {
      return `\`${node.value}\``;
    }

    if (isCodeNode(node)) {
      return `\`\`\`${node.lang || ""}\n${node.value}\n\`\`\``;
    }

    if (isLinkNode(node)) {
      const linkText = getNodeChildren(node)
        .map((child) => this.nodeToMrkdwn(child))
        .join("");
      return `<${node.url}|${linkText}>`;
    }

    if (isBlockquoteNode(node)) {
      return getNodeChildren(node)
        .map((child) => `> ${this.nodeToMrkdwn(child)}`)
        .join("\n");
    }

    if (isListNode(node)) {
      return this.renderList(node, 0, (child) => this.nodeToMrkdwn(child), "•");
    }

    if (node.type === "break") {
      return "\n";
    }

    if (node.type === "thematicBreak") {
      return "---";
    }

    if (isTableNode(node)) {
      return `\`\`\`\n${tableToAscii(node)}\n\`\`\``;
    }

    return this.defaultNodeToText(node, (child) => this.nodeToMrkdwn(child));
  }
}

function linkBareMentionNames(text: string): string {
  return replaceBareMentions(text, (_mention, name) => `<@${name}>`);
}
