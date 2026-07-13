import type { Logger } from "chat";

/**
 * Notion API version pinned and tested by this adapter.
 * Override via `notionVersion` / `NOTION_VERSION` at your own risk.
 */
export const DEFAULT_NOTION_VERSION = "2026-03-11";

/**
 * Default delays (ms) between Retrieve File Upload polls after creating an
 * `external_url` upload. Starts with an immediate recheck (`0`), then 5s and
 * 10s — short enough for typical serverless webhook budgets (~15s max wait).
 * Notion's longer 5/15/30/45s sequence is safer for slow hosts but can block
 * `postMessage` for ~95s.
 */
export const DEFAULT_EXTERNAL_URL_POLL_DELAYS_MS = [0, 5_000, 10_000] as const;

/**
 * How inbound comments become mentions for Chat SDK dispatch.
 *
 * - `"mention"` — plain-text `@userName` or `@botUserId` (default; Notion
 *   connection bots are not @-mentionable in the comment composer)
 * - `"all-comments"` — every non-bot comment on connected pages
 * - `"keyword"` — case-insensitive word-boundary match against `keywords`
 */
export type NotionMentionMode = "mention" | "all-comments" | "keyword";

/** Configuration for the Notion adapter. */
export interface NotionAdapterConfig {
  /** Override Notion API base URL (tests / proxies). */
  apiBaseUrl?: string;
  /**
   * Delays (ms) between Retrieve File Upload polls after creating an
   * `external_url` upload. Default `[0, 5000, 10000]` (immediate recheck,
   * then 5s / 10s). Pass Notion's longer `[5000, 15000, 30000, 45000]` when
   * imports are slow and the caller can wait; pass `[]` to never wait
   * (link unless create already returned `uploaded`).
   */
  externalUrlPollDelaysMs?: number[];
  /**
   * Keywords used when `mentionMode === "keyword"`.
   * Auto-detected from `NOTION_KEYWORDS` (comma-separated).
   */
  keywords?: string[];
  /** Optional logger override. */
  logger?: Logger;
  /**
   * Mention detection mode. Default `"mention"` matches plain-text
   * `@userName` / `@botUserId` (Notion has no composer @-mention for connections).
   * Auto-detected from `NOTION_MENTION_MODE`.
   */
  mentionMode?: NotionMentionMode;
  /**
   * Notion-Version header value.
   * Defaults to `NOTION_VERSION` or the adapter's pinned version.
   */
  notionVersion?: string;
  /**
   * Minimum interval between Post+Edit streaming edits (ms).
   * Default 1500 to stay under Notion's ~3 req/s average.
   */
  streamingEditIntervalMs?: number;
  /**
   * Connection access token (Bearer token).
   * Defaults to `NOTION_TOKEN`.
   */
  token?: string;
  /**
   * Bot display name override.
   * Defaults to `NOTION_BOT_USERNAME` or `"notion-bot"`.
   */
  userName?: string;
  /**
   * Webhook HMAC key from the subscription verification handshake.
   * Defaults to `NOTION_VERIFICATION_TOKEN`.
   *
   * Optional at construct time so the one-time handshake can be logged before
   * the operator pastes the token. Required for all subsequent signed events.
   */
  verificationToken?: string;
}

/**
 * Decoded Notion thread ID.
 *
 * - Page channel root: `{ pageId }` → `notion:{pageId}`
 * - Discussion thread: `{ pageId, discussionId }` → `notion:{pageId}:{discussionId}`
 * - Whole-block discussion start: `{ pageId, blockId }` → `notion:{pageId}:block:{blockId}`
 *   (outbound; selected-text discussions cannot be started via API).
 * When both `discussionId` and `blockId` are set, encode prefers `discussionId` (reply path).
 */
export interface NotionThreadId {
  /**
   * Block UUID for starting a whole-block discussion via `parent.block_id`.
   * Encoded as `notion:{pageId}:block:{blockId}` when no discussionId is present.
   */
  blockId?: string;
  /** Discussion UUID when addressing a specific comment thread. */
  discussionId?: string;
  /** Containing page UUID (hyphenated). */
  pageId: string;
}

/** Notion rich-text annotations. */
export interface NotionAnnotations {
  bold: boolean;
  code: boolean;
  color: string;
  italic: boolean;
  strikethrough: boolean;
  underline: boolean;
}

/** Notion rich-text span (subset used by comments). */
export interface NotionRichText {
  annotations: NotionAnnotations;
  equation?: { expression: string };
  href?: string | null;
  /**
   * Nested mention payload. `type` is loose (`"user"`, agent subtypes, etc.).
   * Mention detection matches any nested object that carries the bot `user.id`,
   * not only `type === "user"`.
   */
  mention?: {
    type: string;
    user?: { object: "user"; id: string; name?: string };
    page?: { id: string };
    database?: { id: string };
    date?: { start: string; end?: string | null };
    /** Agent / other mention shapes may nest a user id here. */
    [key: string]: unknown;
  };
  plain_text: string;
  text?: { content: string; link?: { url: string } | null };
  type: "text" | "mention" | "equation";
}

/** Notion comment parent. */
export type NotionCommentParent =
  | { type: "page_id"; page_id: string }
  | { type: "block_id"; block_id: string };

/** Notion comment object (API response). */
export interface NotionComment {
  attachments?: Array<{
    category: string;
    file: { url: string; expiry_time: string };
  }>;
  created_by: { object: "user"; id: string; name?: string; type?: string };
  created_time: string;
  discussion_id: string;
  display_name?: {
    type: string;
    resolved_name?: string;
  };
  id: string;
  last_edited_time: string;
  object: "comment";
  parent: NotionCommentParent;
  rich_text: NotionRichText[];
}

/** Notion bot user from GET /v1/users/me. */
export interface NotionBotUser {
  avatar_url: string | null;
  bot: {
    owner?: { type: string; workspace?: boolean };
    workspace_id?: string;
    workspace_name?: string;
    workspace_limits?: { max_file_upload_size_in_bytes?: number };
  };
  id: string;
  name: string | null;
  object: "user";
  type: "bot";
}

/** Webhook entity reference. */
export interface NotionWebhookEntity {
  id: string;
  type: string;
}

/** Webhook event author. */
export interface NotionWebhookAuthor {
  id: string;
  type: "person" | "bot" | "agent";
}

/** Notion webhook event envelope (one event per delivery for comments). */
export interface NotionWebhookEvent {
  attempt_number?: number;
  authors?: NotionWebhookAuthor[];
  data?: {
    page_id?: string;
    parent?: { id: string; type: "page" | "block" };
  };
  entity: NotionWebhookEntity;
  id: string;
  integration_id: string;
  subscription_id: string;
  timestamp: string;
  type: string;
  workspace_id: string;
  workspace_name?: string;
}

/** One-time subscription verification payload. */
export interface NotionVerificationPayload {
  verification_token: string;
}

/** Raw message stored on Chat SDK Message.raw. */
export interface NotionRawMessage {
  comment: NotionComment;
  event?: NotionWebhookEvent;
  pageId: string;
}

/** Subset of a Notion page object used by `fetchSubject`. */
export interface NotionPageResponse {
  /**
   * @deprecated Prefer `in_trash`. Notion still returns `archived` as an
   * optional alias of `in_trash`; both may be present.
   */
  archived?: boolean;
  created_by?: { id: string; name?: string | null; object?: string };
  id: string;
  /** Prefer this over deprecated `archived` when detecting trash status. */
  in_trash?: boolean;
  object?: "page";
  properties?: Record<string, NotionPagePropertyValue>;
  url?: string;
}

/** Page property value (title / rich_text description extraction). */
export interface NotionPagePropertyValue {
  id?: string;
  rich_text?: Array<{ plain_text?: string }>;
  title?: Array<{ plain_text?: string }>;
  type?: string;
}

/** List-comments API response. */
export interface NotionCommentListResponse {
  has_more: boolean;
  next_cursor: string | null;
  object: "list";
  results: NotionComment[];
}
