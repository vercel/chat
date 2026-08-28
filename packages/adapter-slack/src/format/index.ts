export interface SlackPlainTextObject {
  emoji?: boolean;
  text: string;
  type: "plain_text";
}

export interface SlackMrkdwnTextObject {
  text: string;
  type: "mrkdwn";
  verbatim?: boolean;
}

export type SlackTextObject = SlackMrkdwnTextObject | SlackPlainTextObject;

export interface SlackTextOptions {
  emoji?: boolean;
  verbatim?: boolean;
}

export interface SlackDateOptions {
  link?: string;
}

const CONTROL_PATTERN = /[<>|]/;
const DATE_CONTROL_PATTERN = /[\^|>]/;
const SLACK_ID_PATTERN = /^[A-Z0-9_]+$/;
const SLACK_USER_TOKEN_PATTERN = /(?<![<\w])@([A-Z][A-Z0-9_]+)/g;
const TEXT_OBJECT_MAX_LENGTH = 3000;
const CODE_FENCE = "```";
const LEADING_WHITESPACE_PATTERN = /^[ \t]+/;
// Line prefixes CommonMark promotes to a block construct (blockquote,
// heading, list item, fence, thematic break, HTML) — in pre-unescape form.
const BLOCK_MARKER_PATTERN =
  /^(?:&gt;|&lt;|#{1,6}(?=[ \t\n]|$)|[-+*](?=[ \t\n]|$)|`{3,}|~{3,}|(?:[-*_][ \t]*){3,}(?=\n|$))/;
const ORDERED_LIST_MARKER_PATTERN = /^(\d{1,9})([.)])(?=[ \t\n]|$)/;

export function escapeSlackText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function unescapeSlackText(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function createSlackPlainText(
  text: string,
  options: SlackTextOptions = {}
): SlackPlainTextObject {
  assertSlackTextObjectText(text);
  return {
    ...(options.emoji === undefined ? {} : { emoji: options.emoji }),
    text,
    type: "plain_text",
  };
}

export function createSlackMrkdwn(
  text: string,
  options: SlackTextOptions = {}
): SlackMrkdwnTextObject {
  assertSlackTextObjectText(text);
  return {
    text,
    type: "mrkdwn",
    ...(options.verbatim === undefined ? {} : { verbatim: options.verbatim }),
  };
}

export function formatSlackUser(userId: string): string {
  assertSlackId(userId, "userId");
  return `<@${userId}>`;
}

export function formatSlackChannel(channelId: string): string {
  assertSlackId(channelId, "channelId");
  return `<#${channelId}>`;
}

export function formatSlackUserGroup(userGroupId: string): string {
  assertSlackId(userGroupId, "userGroupId");
  return `<!subteam^${userGroupId}>`;
}

export function formatSlackSpecialMention(
  mention: "channel" | "everyone" | "here"
): string {
  return `<!${mention}>`;
}

export function formatSlackLink(url: string, label?: string): string {
  assertNoSlackControl(url, "url");
  return label ? `<${url}|${escapeSlackText(label)}>` : `<${url}>`;
}

export function formatSlackDate(
  timestamp: Date | number,
  token: string,
  fallback: string,
  options: SlackDateOptions = {}
): string {
  assertNoSlackDateControl(token, "token");
  const seconds =
    timestamp instanceof Date
      ? Math.floor(timestamp.getTime() / 1000)
      : timestamp;
  if (!Number.isInteger(seconds)) {
    throw new TypeError("timestamp must be an integer unix timestamp or Date");
  }
  const link = options.link ? `^${assertSlackDateLink(options.link)}` : "";
  return `<!date^${seconds}^${token}${link}|${escapeSlackText(fallback)}>`;
}

export function slackMrkdwnToMarkdown(mrkdwn: string): string {
  const markdown = mrkdwn.includes(CODE_FENCE)
    ? convertMrkdwnWithCodeFences(mrkdwn)
    : convertMrkdwnText(mrkdwn);
  return unescapeSlackText(markdown);
}

function convertSlackTokens(mrkdwn: string): string {
  let markdown = mrkdwn.replace(/<@([A-Z0-9_]+)\|([^<>]+)>/g, "@$2");
  markdown = markdown.replace(/<@([A-Z0-9_]+)>/g, "@$1");
  markdown = markdown.replace(/<#([A-Z0-9_]+)\|([^<>]+)>/g, "#$2 ($1)");
  markdown = markdown.replace(/<#([A-Z0-9_]+)>/g, "#$1");
  markdown = markdown.replace(
    /<(?!https?:\/\/)([^<>|]+)\|(https?:\/\/[^|<>]+)>/g,
    "<$2|$1>"
  );
  markdown = markdown.replace(/<(https?:\/\/[^|<>]+)\|([^<>]+)>/g, "[$2]($1)");
  markdown = markdown.replace(/<(https?:\/\/[^<>]+)>/g, "$1");
  return markdown;
}

function convertMrkdwnText(mrkdwn: string): string {
  let markdown = convertSlackTokens(mrkdwn);
  markdown = markdown.replace(/(?<![_*\\])\*([^*\n]+)\*(?![_*])/g, "**$1**");
  markdown = markdown.replace(/(?<!~)~([^~\n]+)~(?!~)/g, "~~$1~~");
  return markdown;
}

/**
 * Slack treats text immediately after an opening fence as code, while
 * CommonMark treats it as the fence's info string. Rewrite each paired
 * ``` fence onto its own lines so the Markdown parser preserves all code
 * block content, and keep everything Slack renders literally — unpaired
 * fences, fences inside inline code or `<…>` tokens, and fences on
 * blockquote lines — as plain text. Fence content skips the emphasis
 * rewrites so code like `*a` survives verbatim.
 *
 * Mirrors `normalizeCodeFences` in `@chat-adapter/shared` with mrkdwn's
 * entity escaping (`&gt;` blockquotes, `<…>` control tokens). This module
 * cannot import it: the `@chat-adapter/slack/format` subpath is published
 * dependency-free (see boundary.test.ts). Keep the two in sync.
 */
function convertMrkdwnWithCodeFences(mrkdwn: string): string {
  let result = "";
  let textStart = 0;
  let cursor = 0;
  // Set when the closing fence splits a line: the text after it lands at
  // the start of a new line, where CommonMark would promote a leading
  // block marker Slack rendered inline.
  let movedToOwnLine = false;

  const flushTextBefore = (end: number): void => {
    let text = mrkdwn.slice(textStart, end);
    if (movedToOwnLine) {
      text = escapeLeadingBlockMarker(text);
      movedToOwnLine = false;
    }
    result += convertMrkdwnText(text);
  };

  while (cursor < mrkdwn.length) {
    const char = mrkdwn[cursor];
    if (char === "<") {
      const tokenEnd = findAngleTokenEnd(mrkdwn, cursor);
      cursor = tokenEnd === -1 ? cursor + 1 : tokenEnd;
      continue;
    }
    if (char !== "`") {
      cursor += 1;
      continue;
    }
    if (!mrkdwn.startsWith(CODE_FENCE, cursor)) {
      const spanEnd = findInlineCodeEnd(mrkdwn, cursor);
      cursor = spanEnd === -1 ? cursor + 1 : spanEnd;
      continue;
    }

    const contentStart = cursor + CODE_FENCE.length;
    const contentEnd = mrkdwn.indexOf(CODE_FENCE, contentStart);
    if (contentEnd === -1 || isOnBlockquoteLine(mrkdwn, cursor)) {
      // Slack renders an unpaired or quoted ``` literally.
      cursor = contentStart;
      continue;
    }

    flushTextBefore(cursor);
    if (result.length > 0 && !result.endsWith("\n")) {
      result += "\n";
    }
    const content = mrkdwn.slice(contentStart, contentEnd);
    result += CODE_FENCE;
    if (!content.startsWith("\n")) {
      result += "\n";
    }
    result += convertSlackTokens(content);
    if (!content.endsWith("\n")) {
      result += "\n";
    }
    result += CODE_FENCE;

    cursor = contentEnd + CODE_FENCE.length;
    textStart = cursor;
    if (cursor < mrkdwn.length && mrkdwn[cursor] !== "\n") {
      result += "\n";
      movedToOwnLine = true;
    }
  }

  flushTextBefore(mrkdwn.length);
  return result;
}

function findAngleTokenEnd(mrkdwn: string, index: number): number {
  let cursor = index + 1;
  while (
    cursor < mrkdwn.length &&
    mrkdwn[cursor] !== ">" &&
    mrkdwn[cursor] !== "\n" &&
    mrkdwn[cursor] !== "\r"
  ) {
    cursor += 1;
  }
  return mrkdwn[cursor] === ">" ? cursor + 1 : -1;
}

// Slack inline code spans never cross line breaks.
function findInlineCodeEnd(mrkdwn: string, index: number): number {
  const close = mrkdwn.indexOf("`", index + 1);
  if (close === -1) {
    return -1;
  }
  const newline = mrkdwn.indexOf("\n", index + 1);
  if (newline !== -1 && newline < close) {
    return -1;
  }
  return close + 1;
}

function isOnBlockquoteLine(mrkdwn: string, index: number): boolean {
  const lineStart = mrkdwn.lastIndexOf("\n", index - 1) + 1;
  return mrkdwn.slice(lineStart, index).trimStart().startsWith("&gt;");
}

function escapeLeadingBlockMarker(text: string): string {
  const whitespace = LEADING_WHITESPACE_PATTERN.exec(text)?.[0] ?? "";
  // Collapse the leading separator so it cannot become an indented code
  // block, then defuse any block marker now sitting at the line start.
  const prefix = whitespace.length > 0 ? " " : "";
  const rest = text.slice(whitespace.length);
  if (BLOCK_MARKER_PATTERN.test(rest)) {
    return `${prefix}\\${rest}`;
  }
  return prefix + rest.replace(ORDERED_LIST_MARKER_PATTERN, "$1\\$2");
}

export function markdownBoldToSlackMrkdwn(markdown: string): string {
  return markdown.replace(/\*\*(.+?)\*\*/g, "*$1*");
}

export function linkBareSlackMentions(text: string): string {
  return text.replace(SLACK_USER_TOKEN_PATTERN, "<@$1>");
}

function assertSlackTextObjectText(text: string): void {
  if (text.length < 1 || text.length > TEXT_OBJECT_MAX_LENGTH) {
    throw new TypeError(
      `text must be between 1 and ${TEXT_OBJECT_MAX_LENGTH} characters`
    );
  }
}

function assertSlackId(value: string, name: string): void {
  if (!SLACK_ID_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a Slack ID`);
  }
}

function assertNoSlackControl(value: string, name: string): void {
  if (CONTROL_PATTERN.test(value)) {
    throw new TypeError(`${name} cannot contain Slack control characters`);
  }
}

function assertNoSlackDateControl(value: string, name: string): void {
  if (DATE_CONTROL_PATTERN.test(value)) {
    throw new TypeError(`${name} cannot contain Slack date control characters`);
  }
}

function assertSlackDateLink(value: string): string {
  assertNoSlackDateControl(value, "link");
  return value;
}
