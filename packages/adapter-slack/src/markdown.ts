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
  type Link,
  parseMarkdown,
  type Root,
  stringifyMarkdown,
  type Text,
  tableToAscii,
} from "chat";
import { slackMrkdwnToMarkdown, unescapeSlackText } from "./format";

export type SlackTextPayload = { text: string } | { markdown_text: string };

const SLACK_ID_PATTERN = /^[A-Z0-9_]+$/;
const SPECIAL_MENTION_TOKEN_PATTERN = /^!(here|channel|everyone)(?:\|[^<>]*)?$/;
const USER_GROUP_TOKEN_PATTERN = /^!subteam\^([A-Z0-9_]+)(?:\|@?(.+))?$/;
const LINK_SCHEME_PATTERN = /^(?:https?:\/\/|mailto:|tel:)/;
const WEB_URL_PATTERN = /^https?:\/\/[^|]+$/;
const BLANK_PATTERN = /[ \t]/;

interface ControlToken {
  text: string;
  /** The destination the fallback links the text to, if any. */
  url?: string;
}

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
 * `toAst` rewrites a link token to `[label](url)`. A blank ends a markdown
 * link destination, so that markdown then stays literal text.
 */
function linkToken(url: string, label: string): ControlToken {
  return BLANK_PATTERN.test(url)
    ? { text: `[${label}](${url})` }
    : { text: label, url };
}

/**
 * A token whose target starts with a link scheme of `length` characters. The
 * text matches `toAst`. The link is narrower: only a token with characters
 * after the scheme and, when it has a `|`, a label gets one. `toAst` also
 * autolinks the rest, such as `<mailto:>` or `<https://example.com|>`, and
 * the fallback renders those as text.
 */
function schemeToken(
  token: string,
  target: string,
  label: string | undefined,
  length: number
): ControlToken | undefined {
  const web = token.startsWith("http");
  if (target.length > length) {
    if (label) {
      return linkToken(target, label);
    }
    if (label === undefined && !web) {
      return linkToken(target, target.slice(length));
    }
    if (label === undefined && !BLANK_PATTERN.test(target)) {
      return { text: target, url: target };
    }
  }
  if (web || !BLANK_PATTERN.test(token)) {
    return { text: token };
  }
}

/**
 * The plain text `toAst` renders for the content of one `<…>` control token,
 * with the destination of a link token, or `undefined` for a token `toAst`
 * keeps verbatim.
 */
function controlTokenText(token: string): ControlToken | undefined {
  const pipe = token.indexOf("|");
  const target = pipe === -1 ? token : token.slice(0, pipe);
  const label = pipe === -1 ? undefined : token.slice(pipe + 1);
  const scheme = LINK_SCHEME_PATTERN.exec(target);
  if (scheme) {
    return schemeToken(token, target, label, scheme[0].length);
  }
  const special = SPECIAL_MENTION_TOKEN_PATTERN.exec(token);
  if (special) {
    return { text: `@${special[1]}` };
  }
  if (label === "") {
    return;
  }

  const group = USER_GROUP_TOKEN_PATTERN.exec(token);
  if (group) {
    return { text: `@${group[2] ?? group[1]}` };
  }
  if (target.startsWith("@") && SLACK_ID_PATTERN.test(target.slice(1))) {
    return { text: label === undefined ? target : `@${label}` };
  }
  if (target.startsWith("#") && SLACK_ID_PATTERN.test(target.slice(1))) {
    return {
      text: label === undefined ? target : `#${label} (${target.slice(1)})`,
    };
  }
  if (target && label !== undefined && WEB_URL_PATTERN.test(label)) {
    return linkToken(label, target);
  }
}

/**
 * Render mrkdwn as text and explicit links without parsing markdown: control
 * tokens become the text `toAst` renders for them, link tokens become link
 * nodes, and entities are decoded, while formatting characters stay as typed.
 * Runs in linear time.
 *
 * Code is not recognized: a link token inside backticks still becomes a link
 * node between the literal backticks, where `toAst` keeps it as code text.
 */
function slackMrkdwnFallback(mrkdwn: string): {
  formatted: Root;
  text: string;
} {
  const children: (Text | Link)[] = [];
  let text = "";
  let pending = "";
  const flushPending = (): void => {
    if (pending) {
      const value = unescapeSlackText(pending);
      children.push({ type: "text", value });
      text += value;
      pending = "";
    }
  };

  let start = 0;
  let cursor = mrkdwn.indexOf("<");
  while (cursor !== -1) {
    const end = angleTokenEnd(mrkdwn, cursor);
    if (end === -1) {
      cursor = mrkdwn.indexOf("<", cursor + 1);
      continue;
    }
    const token = controlTokenText(mrkdwn.slice(cursor + 1, end - 1));
    if (token !== undefined) {
      pending += mrkdwn.slice(start, cursor);
      if (token.url === undefined) {
        pending += token.text;
      } else {
        flushPending();
        const value = unescapeSlackText(token.text);
        children.push({
          type: "link",
          url: unescapeSlackText(token.url),
          children: [{ type: "text", value }],
        });
        text += value;
      }
      start = end;
    }
    cursor = mrkdwn.indexOf("<", end);
  }
  pending += mrkdwn.slice(start);
  flushPending();
  if (children.length === 0) {
    children.push({ type: "text", value: "" });
  }
  return {
    text,
    formatted: { type: "root", children: [{ type: "paragraph", children }] },
  };
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
   * each retains only text and explicit link nodes. Otherwise each part goes through
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
    return slackMrkdwnFallback(mrkdwn).text;
  }

  /**
   * Keep link nodes only while `incomingFallbackText` is not overridden. A
   * subclass that overrides it gets its text in a single text node, so the
   * tree never carries content, such as a link destination, that the override
   * removed.
   */
  protected override unparsedIncoming(mrkdwn: string): {
    formatted: Root;
    text: string;
  } {
    if (
      this.incomingFallbackText ===
      SlackFormatConverter.prototype.incomingFallbackText
    ) {
      return slackMrkdwnFallback(mrkdwn);
    }
    const text = this.incomingFallbackText(mrkdwn);
    return {
      text,
      formatted: {
        type: "root",
        children: [
          { type: "paragraph", children: [{ type: "text", value: text }] },
        ],
      },
    };
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
      return this.renderBlockquote(node, (child) => this.nodeToMrkdwn(child));
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
