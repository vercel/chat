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
import { slackMrkdwnToMarkdown, unescapeSlackText } from "./format";

export type SlackTextPayload = { text: string } | { markdown_text: string };

const SLACK_ID_PATTERN = /^[A-Z0-9_]+$/;
const SPECIAL_MENTION_TOKEN_PATTERN = /^!(here|channel|everyone)(?:\|[^<>]*)?$/;
const USER_GROUP_TOKEN_PATTERN = /^!subteam\^([A-Z0-9_]+)(?:\|@?(.+))?$/;
const LINK_TARGET_PATTERN = /^(?:https?:\/\/|mailto:|tel:)/;
const WEB_URL_PATTERN = /^https?:\/\/[^|]+$/;
const LINK_SCHEME_PATTERN = /^(?:mailto|tel):/;

/**
 * Index just past the `>` that closes the `<` at `index`, or -1 when another
 * `<` or a line break comes first.
 */
function angleTokenEnd(mrkdwn: string, index: number): number {
  for (let cursor = index + 1; cursor < mrkdwn.length; cursor++) {
    const char = mrkdwn[cursor];
    if (char === ">") {
      return cursor + 1;
    }
    if (char === "<" || char === "\n" || char === "\r") {
      return -1;
    }
  }
  return -1;
}

/**
 * The plain text `toAst` renders for the content of one `<…>` control token,
 * or `undefined` for a token it keeps verbatim.
 */
function controlTokenText(token: string): string | undefined {
  const pipe = token.indexOf("|");
  const target = pipe === -1 ? token : token.slice(0, pipe);
  const label = pipe === -1 ? undefined : token.slice(pipe + 1);
  if (label === "") {
    return;
  }

  const special = SPECIAL_MENTION_TOKEN_PATTERN.exec(token);
  if (special) {
    return `@${special[1]}`;
  }
  const group = USER_GROUP_TOKEN_PATTERN.exec(token);
  if (group) {
    return `@${group[2] ?? group[1]}`;
  }
  if (target.startsWith("@") && SLACK_ID_PATTERN.test(target.slice(1))) {
    return label === undefined ? target : `@${label}`;
  }
  if (target.startsWith("#") && SLACK_ID_PATTERN.test(target.slice(1))) {
    return label === undefined ? target : `#${label} (${target.slice(1)})`;
  }
  if (!LINK_TARGET_PATTERN.test(target)) {
    return label !== undefined && WEB_URL_PATTERN.test(label)
      ? target
      : undefined;
  }
  return label ?? target.replace(LINK_SCHEME_PATTERN, "");
}

/**
 * Render mrkdwn as plain text without parsing it as markdown: control tokens
 * become the text `toAst` renders for them and entities are decoded, while
 * formatting characters stay as typed. Runs in linear time.
 */
function slackMrkdwnToPlainText(mrkdwn: string): string {
  let result = "";
  let start = 0;
  let cursor = mrkdwn.indexOf("<");
  while (cursor !== -1) {
    const end = angleTokenEnd(mrkdwn, cursor);
    if (end === -1) {
      cursor = mrkdwn.indexOf("<", cursor + 1);
      continue;
    }
    const text = controlTokenText(mrkdwn.slice(cursor + 1, end - 1));
    if (text !== undefined) {
      result += mrkdwn.slice(start, cursor) + text;
      start = end;
    }
    cursor = mrkdwn.indexOf("<", end);
  }
  return unescapeSlackText(result + mrkdwn.slice(start));
}

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
   * Return a parser for the mrkdwn parts of one message, such as its text,
   * layout block text, attachment text, and table cells. The parse budget
   * applies to all parts together: when they exceed it, no part is parsed and
   * each becomes a single text node. Otherwise each part goes through
   * `parseIncoming`.
   *
   * @internal Used by SlackAdapter to parse inbound messages.
   */
  incomingPartsParser(parts: readonly string[]): (part: string) => Root {
    if (this.exceedsIncomingBudget(parts.join("\n\n"))) {
      return (part) =>
        part.trim()
          ? this.unparsedIncoming(part).formatted
          : { type: "root", children: [] };
    }
    return (part) => this.parseIncoming(part).formatted;
  }

  /**
   * Check the budget against the markdown that `toAst` parses, with entities
   * decoded and Slack code fences, emphasis, and tokens converted, so the
   * checks see the same blockquotes and fences as the parser. The length
   * limit still applies to the text as delivered.
   */
  protected override exceedsIncomingBudget(mrkdwn: string): boolean {
    return (
      mrkdwn.length > this.maxIncomingParseLength ||
      super.exceedsIncomingBudget(slackMrkdwnToMarkdown(mrkdwn))
    );
  }

  protected override incomingFallbackText(mrkdwn: string): string {
    return slackMrkdwnToPlainText(mrkdwn);
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
