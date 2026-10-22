/**
 * Slack message event types and the content extraction shared by message
 * parsing and mention classification. It imports no runtime packages, so the
 * `@chat-adapter/slack/webhook` subpath can use it.
 */
import type { SlackBlock } from "./cards";
import { escapeSlackText } from "./format";

export const SLACK_USER_ID_PATTERN = /^[A-Z0-9_]+$/;

/**
 * Collect the user and channel IDs referenced by `<@U…>` / `<#C…>` tokens.
 * Parses by splitting on angle brackets to avoid ReDoS.
 */
export function collectMentionIds(
  text: string,
  userIds: Set<string>,
  channelIds: Set<string>
): void {
  for (const segment of text.split("<")) {
    const end = segment.indexOf(">");
    if (end === -1) {
      continue;
    }
    const inner = segment.slice(0, end);
    if (inner.startsWith("@")) {
      const rest = inner.slice(1);
      const pipeIdx = rest.indexOf("|");
      const uid = pipeIdx >= 0 ? rest.slice(0, pipeIdx) : rest;
      if (SLACK_USER_ID_PATTERN.test(uid)) {
        userIds.add(uid);
      }
    } else if (inner.startsWith("#")) {
      const rest = inner.slice(1);
      const pipeIdx = rest.indexOf("|");
      // Only collect bare channel IDs (no label already present)
      if (pipeIdx === -1 && SLACK_USER_ID_PATTERN.test(rest)) {
        channelIds.add(rest);
      }
    }
  }
}

/**
 * Block inside a Slack message event (`event.blocks` or `attachment.blocks`).
 * Extends the open Block Kit shape with the fields the parser reads directly;
 * everything else stays reachable through the index signature.
 */
export interface SlackMessageBlock extends SlackBlock {
  elements?: SlackMessageBlock[];
  rows?: unknown;
  /** `{ code: true }` marks an inline-code text element. */
  style?: { code?: boolean };
  text?: string;
  url?: string;
  user_id?: string;
}

/** Slack event payload (raw message format) */
export interface SlackEvent {
  /** Legacy attachments (unfurl previews, app unfurls, etc.) */
  attachments?: Array<{
    blocks?: SlackMessageBlock[];
    fallback?: string;
    fields?: Array<{ title?: string; value?: string; short?: boolean }>;
    from_url?: string;
    image_url?: string;
    is_app_unfurl?: boolean;
    is_msg_unfurl?: boolean;
    /** Field names Slack renders as mrkdwn ("pretext", "text", "fields") */
    mrkdwn_in?: string[];
    original_url?: string;
    pretext?: string;
    service_icon?: string;
    service_name?: string;
    text?: string;
    thumb_url?: string;
    title?: string;
    title_link?: string;
  }>;
  /** Rich text blocks containing structured elements (links, mentions, etc.) */
  blocks?: SlackMessageBlock[];
  bot_id?: string;
  bot_profile?: { user_id?: string };
  channel?: string;
  /** Channel type: "channel", "group", "mpim", or "im" (DM) */
  channel_type?: string;
  /** Deleted message timestamp on message_deleted events */
  deleted_ts?: string;
  edited?: { ts: string };
  event_ts?: string;
  files?: Array<{
    id?: string;
    mimetype?: string;
    url_private?: string;
    name?: string;
    size?: number;
    original_w?: number;
    original_h?: number;
  }>;
  /** Hidden flag on message_changed events (true for unfurl-only updates) */
  hidden?: boolean;
  /** Timestamp of the latest reply (present on thread parent messages) */
  latest_reply?: string;
  /** Inner message on message_changed events */
  message?: SlackEvent;
  /** Previous message snapshot on message_deleted events */
  previous_message?: SlackEvent;
  /** Number of replies in the thread (present on thread parent messages) */
  reply_count?: number;
  subtype?: string;
  team?: string;
  team_id?: string;
  text?: string;
  thread_ts?: string;
  ts?: string;
  type: string;
  user?: string;
  username?: string;
}

/** Table extracted from a Slack table block, one mrkdwn string per cell. */
export interface SlackTableData {
  /**
   * True when the source rows carry no header styling. GFM tables always
   * render their first row as a header, so headerless tables get an empty
   * header row prepended instead of promoting the first data row.
   */
  headerless: boolean;
  rows: string[][];
}

export const TABLE_BLOCK_TYPES = new Set(["table", "data_table"]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Flatten a table cell (or any rich text element inside one) to mrkdwn.
 * Mentions, channels, and links are emitted as mrkdwn tokens so the format
 * converter renders them the same way it renders body text.
 */
function blocktext(value: unknown): string {
  if (!(isRecord(value) && typeof value.type === "string")) {
    return "";
  }

  const text = str(value.text);
  switch (value.type) {
    case "raw_text":
      // A raw_text cell is plain text: Slack reserves mentions and links for
      // rich_text cells, so its control characters render literally. Keep it
      // aligned with `classifyBlocksMention`, which does not scan these cells.
      return escapeSlackText(text ?? "");
    case "link": {
      const url = str(value.url);
      if (!url) {
        return text ?? "";
      }
      return text ? `<${url}|${text}>` : `<${url}>`;
    }
    case "emoji": {
      const name = str(value.name);
      return name ? `:${name}:` : "";
    }
    case "user": {
      const userId = str(value.user_id);
      return userId ? `<@${userId}>` : "";
    }
    case "broadcast": {
      const range = str(value.range);
      return range ? `@${range}` : "";
    }
    case "channel": {
      const channelId = str(value.channel_id);
      return channelId ? `<#${channelId}>` : "";
    }
    case "usergroup": {
      const usergroupId = str(value.usergroup_id);
      return usergroupId ? `<!subteam^${usergroupId}>` : "";
    }
    case "date": {
      const fallback = str(value.fallback);
      if (fallback) {
        return fallback;
      }
      // Format the timestamp rather than leaking the raw format template
      // (e.g. "{date_num}") when Slack omits the fallback.
      return typeof value.timestamp === "number"
        ? new Date(value.timestamp * 1000).toISOString().slice(0, 10)
        : "";
    }
    case "color":
      return str(value.value) ?? "";
    case "team":
      return str(value.team_id) ?? "";
    default:
      break;
  }
  if (text !== undefined) {
    return text;
  }
  const fallback = str(value.label) ?? str(value.url) ?? str(value.file_id);
  if (fallback !== undefined) {
    return fallback;
  }
  // Raw value cells (raw_number, raw_date, raw_currency, raw_percent,
  // raw_boolean, …) carry a primitive value when text is absent.
  if (
    typeof value.value === "number" ||
    typeof value.value === "string" ||
    typeof value.value === "boolean"
  ) {
    return String(value.value);
  }
  if (!Array.isArray(value.elements)) {
    return "";
  }

  const separator =
    value.type === "rich_text" || value.type === "rich_text_list" ? "\n" : "";
  return value.elements.map(blocktext).join(separator);
}

function hasBoldText(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (isRecord(value.style) && value.style.bold === true) {
    return true;
  }
  return Array.isArray(value.elements) && value.elements.some(hasBoldText);
}

export function tableData(block: SlackMessageBlock): SlackTableData | null {
  if (!(TABLE_BLOCK_TYPES.has(block.type) && Array.isArray(block.rows))) {
    return null;
  }

  const sourceRows = block.rows.filter(
    (row): row is unknown[] => Array.isArray(row) && row.length > 0
  );
  if (sourceRows.length === 0) {
    return null;
  }

  // data_table rows always start with a header row (the outbound renderer in
  // blocks/index.ts relies on this); pasted `table` blocks mark headers only
  // via bold cell styling.
  const headerless = block.type === "table" && !sourceRows[0].some(hasBoldText);
  return { headerless, rows: sourceRows.map((row) => row.map(blocktext)) };
}

/**
 * Skip attachments that carry someone else's content (link unfurls, app
 * unfurls) — their blocks must not be attributed to the message author.
 */
export function isForeignAttachment(
  attachment: NonNullable<SlackEvent["attachments"]>[number]
): boolean {
  return Boolean(
    attachment.is_msg_unfurl ||
      attachment.is_app_unfurl ||
      attachment.from_url ||
      attachment.original_url
  );
}

/**
 * Attachments authored by the message sender, in attachment order. Unfurls
 * are excluded everywhere author attachments are read — content, tables, and
 * links alike — because their content is not the author's.
 */
export function authorAttachments(
  event: SlackEvent
): NonNullable<SlackEvent["attachments"]> {
  return (event.attachments ?? []).filter(
    (attachment) => !isForeignAttachment(attachment)
  );
}

/**
 * One piece of attachment text. `mrkdwn` parts go through the format
 * converter (formatting characters are markup); `literal` parts render as
 * plain text where only Slack control sequences (`<@U…>`, `<url|label>`,
 * entity escapes) are honored, so literal `*`/`_`/backticks survive.
 */
export type SlackAttachmentPart = { literal: string } | { mrkdwn: string };

/** Renderable content of one attachment. */
export interface SlackAttachmentContent {
  /** Structured content. When present, Slack renders only the blocks. */
  blocks: SlackMessageBlock[];
  parts: SlackAttachmentPart[];
  tables: SlackTableData[];
}

/**
 * Content of a legacy attachment. Alerting integrations (Sentry, PagerDuty,
 * GitHub) put the real payload in `pretext`/`title`/`text`/`fields`, so
 * without this the normalized message keeps only the one-line summary.
 *
 * Slack renders these fields as plain text unless they are listed in the
 * attachment's `mrkdwn_in` array; the parts mirror that so alert text
 * containing shell commands or globs isn't reinterpreted as formatting.
 * `title` is always plain text and links to `title_link` when present.
 *
 * When the attachment carries blocks, Slack renders only the blocks and
 * ignores the legacy fields — mirrored here by preferring extracted tables.
 * Block types the parser can't render fall back to the legacy fields, and
 * `fallback` (the attachment's plain-text stand-in) fills in last so an
 * attachment never silently contributes nothing.
 */
export function attachmentContent(
  attachment: NonNullable<SlackEvent["attachments"]>[number]
): SlackAttachmentContent {
  const blocks = attachment.blocks ?? [];
  const tables = blocks.flatMap((block) => {
    const parsed = tableData(block);
    return parsed ? [parsed] : [];
  });

  const parts: SlackAttachmentPart[] = [];
  if (tables.length === 0) {
    const mrkdwnIn = new Set(attachment.mrkdwn_in ?? []);
    const push = (value: string | undefined, mrkdwn: boolean) => {
      const trimmed = value?.trim();
      if (trimmed) {
        parts.push(mrkdwn ? { mrkdwn: trimmed } : { literal: trimmed });
      }
    };

    push(attachment.pretext, mrkdwnIn.has("pretext"));
    const title = attachment.title?.trim();
    if (attachment.title_link) {
      // Fold the link in as a control sequence so the title renders as a
      // link node and the URL survives into the normalized message.
      push(
        title
          ? `<${attachment.title_link}|${escapeSlackText(title)}>`
          : `<${attachment.title_link}>`,
        false
      );
    } else {
      push(title, false);
    }
    push(attachment.text, mrkdwnIn.has("text"));
    for (const field of attachment.fields ?? []) {
      const fieldTitle = field.title?.trim();
      const value = field.value?.trim();
      push(
        fieldTitle && value ? `${fieldTitle}: ${value}` : fieldTitle || value,
        mrkdwnIn.has("fields")
      );
    }

    if (parts.length === 0) {
      push(attachment.fallback, false);
    }
  }

  return { blocks, parts, tables };
}
