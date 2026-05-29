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
  let markdown = mrkdwn;
  markdown = markdown.replace(/<@([A-Z0-9_]+)\|([^<>]+)>/g, "@$2");
  markdown = markdown.replace(/<@([A-Z0-9_]+)>/g, "@$1");
  markdown = markdown.replace(/<#[A-Z0-9_]+\|([^<>]+)>/g, "#$1");
  markdown = markdown.replace(/<#([A-Z0-9_]+)>/g, "#$1");
  markdown = markdown.replace(/<(https?:\/\/[^|<>]+)\|([^<>]+)>/g, "[$2]($1)");
  markdown = markdown.replace(/<(https?:\/\/[^<>]+)>/g, "$1");
  markdown = markdown.replace(/(?<![_*\\])\*([^*\n]+)\*(?![_*])/g, "**$1**");
  markdown = markdown.replace(/(?<!~)~([^~\n]+)~(?!~)/g, "~~$1~~");
  return unescapeSlackText(markdown);
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
