import {
  AdapterError,
  AdapterRateLimitError,
  AuthenticationError,
  extractCard,
  extractFiles,
  extractPostableAttachments,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
  ValidationError,
} from "@chat-adapter/shared";
import type {
  Adapter,
  AdapterPostableMessage,
  ChatInstance,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Logger,
  MessageSubject,
  RawMessage,
  StreamChunk,
  StreamOptions,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import {
  ConsoleLogger,
  convertEmojiPlaceholders,
  Message,
  NotImplementedError,
  StreamingMarkdownRenderer,
} from "chat";
import { cardToNotionMarkdown } from "./cards";
import { NotionFormatConverter } from "./markdown";
import { createNotionRateLimiter, sleep, type TokenBucket } from "./rate-limit";
import type {
  NotionAdapterConfig,
  NotionBotUser,
  NotionComment,
  NotionCommentListResponse,
  NotionMentionMode,
  NotionPageResponse,
  NotionRawMessage,
  NotionThreadId,
  NotionVerificationPayload,
  NotionWebhookEvent,
} from "./types";
import {
  DEFAULT_EXTERNAL_URL_POLL_DELAYS_MS,
  DEFAULT_NOTION_VERSION,
} from "./types";
import {
  channelIdFromThreadId as channelIdFromThreadIdHelper,
  chunkMarkdown,
  decodeThreadId as decodeThreadIdHelper,
  encodeThreadId as encodeThreadIdHelper,
  extractNotionPageDescription,
  extractNotionPageTitle,
  getPageUrl as getPageUrlHelper,
  normalizeUuid,
  verifyNotionSignature,
} from "./utils";

const MAX_RATE_LIMIT_RETRIES = 3;
/** Cap list-comments pages when walking backward for newest messages. */
const MAX_FETCH_PAGES = 20;
/**
 * Conservative per-comment markdown ceiling. Notion caps a single rich-text
 * run at 2000 chars; keeping the whole comment under this guarantees no run
 * overflows. Longer messages are split into sequential comments.
 */
const MAX_COMMENT_MARKDOWN_CHARS = 1900;
/** Notion comments accept at most 3 native file_upload attachments. */
const MAX_COMMENT_ATTACHMENTS = 3;

const MENTION_MODES = new Set<NotionMentionMode>([
  "mention",
  "all-comments",
  "keyword",
]);

function parseMentionMode(
  value: string | undefined,
  logger: Logger
): NotionMentionMode | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (MENTION_MODES.has(normalized as NotionMentionMode)) {
    return normalized as NotionMentionMode;
  }
  logger.warn(
    `Invalid NOTION_MENTION_MODE "${value}"; expected mention | all-comments | keyword. Falling back to "mention".`
  );
  return undefined;
}

function parseKeywords(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const keywords = value
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  return keywords.length > 0 ? keywords : undefined;
}

export { NotionFormatConverter } from "./markdown";
export type {
  NotionAdapterConfig,
  NotionBotUser,
  NotionComment,
  NotionMentionMode,
  NotionRawMessage,
  NotionThreadId,
  NotionWebhookEvent,
} from "./types";
export {
  DEFAULT_EXTERNAL_URL_POLL_DELAYS_MS,
  DEFAULT_NOTION_VERSION,
} from "./types";
export {
  decodeThreadId,
  encodeThreadId,
  getPageUrl,
  normalizeUuid,
  signNotionBody,
  verifyNotionSignature,
} from "./utils";

const API_BASE = "https://api.notion.com/v1";
const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const RECENT_POST_TTL_MS = 5 * 60 * 1000;
const DEFAULT_STREAMING_EDIT_INTERVAL_MS = 1500;

function isVerificationPayload(
  value: unknown
): value is NotionVerificationPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "verification_token" in value &&
    typeof (value as NotionVerificationPayload).verification_token ===
      "string" &&
    !("type" in value)
  );
}

function isWebhookEvent(value: unknown): value is NotionWebhookEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as NotionWebhookEvent).id === "string" &&
    typeof (value as NotionWebhookEvent).type === "string" &&
    typeof (value as NotionWebhookEvent).entity === "object"
  );
}

/**
 * Official Notion comments adapter for Chat SDK.
 *
 * Inbound: Notion webhooks (`comment.created`) with HMAC verification.
 * Outbound: Comments REST API with Post+Edit streaming.
 */
export class NotionAdapter
  implements Adapter<NotionThreadId, NotionRawMessage>
{
  readonly name = "notion";
  readonly userName: string;
  readonly lockScope = "thread" as const;

  protected readonly token: string;
  /**
   * HMAC key from the webhook verification handshake.
   * Optional at construct time so the one-time `verification_token` POST can be
   * logged before the operator pastes it into Notion / env. Required for all
   * subsequent signed webhook deliveries.
   */
  protected readonly verificationToken: string | undefined;
  protected readonly notionVersion: string;
  protected readonly apiBaseUrl: string;
  protected readonly mentionMode: NotionMentionMode;
  protected readonly keywords: string[];
  protected readonly streamingEditIntervalMs: number;
  protected readonly externalUrlPollDelaysMs: number[];
  protected readonly logger: Logger;
  protected readonly formatConverter = new NotionFormatConverter();
  protected readonly rateLimiter: TokenBucket;

  protected chat: ChatInstance | null = null;
  protected _botUserId: string | null = null;
  protected workspaceId: string | null = null;
  protected workspaceName: string | null = null;

  /** Recently seen webhook event IDs for dedupe (retries). */
  protected readonly seenEventIds = new Map<string, number>();
  /** Comment IDs recently posted by this adapter (echo filter). */
  protected readonly recentlyPostedIds = new Map<string, number>();
  /** In-memory block → page cache (also mirrored to state when available). */
  protected readonly blockPageCache = new Map<string, string>();
  /** Event IDs provisionally claimed in state before handling completes. */
  protected readonly pendingStateClaims = new Set<string>();

  get botUserId(): string | undefined {
    return this._botUserId ?? undefined;
  }

  constructor(config: NotionAdapterConfig = {}) {
    const token = config.token ?? process.env.NOTION_TOKEN;
    const verificationToken =
      config.verificationToken ?? process.env.NOTION_VERIFICATION_TOKEN;

    if (!token) {
      throw new ValidationError(
        "notion",
        "token is required. Set NOTION_TOKEN or pass token in config."
      );
    }

    this.logger = config.logger ?? new ConsoleLogger("info").child("notion");
    this.token = token;
    this.verificationToken = verificationToken;
    this.notionVersion =
      config.notionVersion ??
      process.env.NOTION_VERSION ??
      DEFAULT_NOTION_VERSION;
    this.apiBaseUrl = config.apiBaseUrl ?? API_BASE;
    this.userName =
      config.userName ?? process.env.NOTION_BOT_USERNAME ?? "notion-bot";
    this.mentionMode =
      config.mentionMode ??
      parseMentionMode(process.env.NOTION_MENTION_MODE, this.logger) ??
      "mention";
    this.keywords =
      config.keywords ?? parseKeywords(process.env.NOTION_KEYWORDS) ?? [];
    this.streamingEditIntervalMs =
      config.streamingEditIntervalMs ?? DEFAULT_STREAMING_EDIT_INTERVAL_MS;
    this.externalUrlPollDelaysMs = config.externalUrlPollDelaysMs?.map((ms) =>
      Math.max(0, ms)
    ) ?? [...DEFAULT_EXTERNAL_URL_POLL_DELAYS_MS];
    this.rateLimiter = createNotionRateLimiter();

    if (!verificationToken) {
      this.logger.warn(
        "NOTION_VERIFICATION_TOKEN is not set. The adapter will accept Notion's one-time verification_token handshake and log it, but all signed webhook events will return 401 until you set the token."
      );
    }
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger.info("Initializing Notion adapter", {
      notionVersion: this.notionVersion,
      mentionMode: this.mentionMode,
    });

    const me = await this.apiFetch<NotionBotUser>("/users/me");
    this._botUserId = me.id;
    this.workspaceId = me.bot.workspace_id ?? null;
    this.workspaceName = me.bot.workspace_name ?? null;
    if (me.name && this.userName === "notion-bot") {
      // Keep configured/env override; only log detected name.
      this.logger.info("Notion bot identity resolved", {
        botUserId: me.id,
        botName: me.name,
        workspaceId: this.workspaceId,
        workspaceName: this.workspaceName,
      });
    } else {
      this.logger.info("Notion bot identity resolved", {
        botUserId: me.id,
        workspaceId: this.workspaceId,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Thread IDs
  // ---------------------------------------------------------------------------

  encodeThreadId(platformData: NotionThreadId): string {
    return encodeThreadIdHelper(platformData);
  }

  decodeThreadId(threadId: string): NotionThreadId {
    return decodeThreadIdHelper(threadId);
  }

  channelIdFromThreadId(threadId: string): string {
    return channelIdFromThreadIdHelper(threadId);
  }

  /** Construct a Notion deep link for a thread. */
  getPageUrl(threadId: string): string {
    return getPageUrlHelper(threadId);
  }

  /**
   * Resolve the parent Notion page for a comment message.
   * Used by `message.subject` — fetches `GET /v1/pages/{pageId}` on first access.
   */
  async fetchSubject(raw: NotionRawMessage): Promise<MessageSubject | null> {
    const pageId = raw.pageId;
    if (!pageId) {
      return null;
    }

    try {
      const page = await this.apiFetch<NotionPageResponse>(`/pages/${pageId}`);
      const title = extractNotionPageTitle(page);
      const description = extractNotionPageDescription(page);
      // Prefer in_trash; archived is a deprecated alias Notion still returns.
      const archived = Boolean(page.in_trash || page.archived);
      return {
        type: "page",
        id: normalizeUuid(page.id ?? pageId, "pageId"),
        title,
        description,
        status: archived ? "archived" : undefined,
        url:
          typeof page.url === "string"
            ? page.url
            : getPageUrlHelper(encodeThreadIdHelper({ pageId })),
        author: page.created_by
          ? {
              id: page.created_by.id,
              name: page.created_by.name ?? page.created_by.id,
            }
          : undefined,
        raw: page,
      };
    } catch (error) {
      this.logger.debug("Failed to fetch subject", { pageId, error });
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Webhook
  // ---------------------------------------------------------------------------

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    const rawBody = await request.text();

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody) as unknown;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // One-time subscription verification handshake (unsigned).
    if (isVerificationPayload(parsed)) {
      return this.handleVerificationHandshake(parsed);
    }

    if (!this.verificationToken) {
      this.logger.error(
        "NOTION_VERIFICATION_TOKEN is not configured; rejecting signed webhook. Paste the verification_token from the handshake into env and restart."
      );
      return new Response("NOTION_VERIFICATION_TOKEN not configured", {
        status: 401,
      });
    }

    const signature = request.headers.get("x-notion-signature");
    if (!verifyNotionSignature(rawBody, signature, this.verificationToken)) {
      this.logger.warn("Notion webhook signature verification failed");
      return new Response("Unauthorized", { status: 401 });
    }

    // Defensive: support a future/batched envelope `{ events: [...] }` while
    // current docs deliver one event object per POST.
    const events = this.extractEvents(parsed);
    const failures: unknown[] = [];
    for (const event of events) {
      try {
        await this.dispatchWebhookEvent(event, options);
      } catch (error) {
        failures.push(error);
        this.logger.error("Notion webhook event handling failed", {
          eventId: event.id,
          type: event.type,
          error,
        });
      }
    }

    if (failures.length > 0) {
      // Let Notion retry; events that succeeded were marked seen.
      return new Response("Webhook event handling failed", { status: 500 });
    }

    return new Response("OK", { status: 200 });
  }

  /**
   * Protected extension point: route verified webhook events.
   * Subclasses can override to handle `page.*` / `database.*` etc.
   */
  protected async dispatchWebhookEvent(
    event: NotionWebhookEvent,
    options?: WebhookOptions
  ): Promise<void> {
    this.pruneSeenEvents();

    if (await this.isDuplicateEvent(event.id)) {
      this.logger.debug("Skipping duplicate Notion webhook event", {
        eventId: event.id,
        type: event.type,
      });
      return;
    }

    try {
      switch (event.type) {
        case "comment.created":
          await this.handleCommentCreated(event, options);
          break;
        case "comment.updated":
        case "comment.deleted":
          this.logger.debug("Ignoring Notion comment lifecycle event", {
            type: event.type,
            eventId: event.id,
          });
          break;
        default:
          await this.onUnhandledWebhookEvent(event, options);
          break;
      }
      await this.markEventSeen(event.id);
    } catch (error) {
      if (error instanceof CommentGoneError) {
        // Soft-drop: mark seen so Notion retries don't loop forever.
        await this.markEventSeen(event.id);
        this.logger.info(
          "Comment not found (deleted/resolved before fetch); dropping event",
          { commentId: error.commentId, eventId: event.id }
        );
        return;
      }
      // Transient / unexpected — release any state claim and do NOT mark
      // in-memory so Notion can retry.
      await this.releaseEventClaim(event.id);
      throw error;
    }
  }

  /**
   * Dedupe check: in-memory Map first, then durable `setIfNotExists` when
   * state is available. A successful claim is provisional until
   * `markEventSeen` / soft-drop; failures call `releaseEventClaim`.
   */
  protected async isDuplicateEvent(eventId: string): Promise<boolean> {
    if (this.seenEventIds.has(eventId)) {
      return true;
    }
    const state = this.chat?.getState();
    if (!state) {
      return false;
    }
    const claimed = await state.setIfNotExists(
      `notion:event:${eventId}`,
      true,
      DEDUPE_TTL_MS
    );
    if (!claimed) {
      this.seenEventIds.set(eventId, Date.now());
      return true;
    }
    this.pendingStateClaims.add(eventId);
    return false;
  }

  protected async markEventSeen(eventId: string): Promise<void> {
    this.seenEventIds.set(eventId, Date.now());
    this.pendingStateClaims.delete(eventId);
    const state = this.chat?.getState();
    if (state) {
      // Ensure durable key exists (no-op if already claimed in isDuplicateEvent).
      await state.setIfNotExists(
        `notion:event:${eventId}`,
        true,
        DEDUPE_TTL_MS
      );
    }
  }

  protected async releaseEventClaim(eventId: string): Promise<void> {
    if (!this.pendingStateClaims.has(eventId)) {
      return;
    }
    this.pendingStateClaims.delete(eventId);
    const state = this.chat?.getState();
    if (state) {
      await state.delete(`notion:event:${eventId}`);
    }
  }

  /**
   * Protected no-op for page/database/other events.
   * Subclass to react to `page.content_updated` etc.
   */
  protected async onUnhandledWebhookEvent(
    event: NotionWebhookEvent,
    _options?: WebhookOptions
  ): Promise<void> {
    this.logger.debug("Ignoring Notion webhook event type", {
      type: event.type,
      eventId: event.id,
    });
  }

  protected handleVerificationHandshake(
    payload: NotionVerificationPayload
  ): Response {
    this.logger.warn(
      [
        "Notion webhook verification_token received.",
        "Paste this token into the Notion connection Webhooks UI and click Verify.",
        "Also set NOTION_VERIFICATION_TOKEN (or config.verificationToken) to this value.",
        "WARNING: After verification, the webhook URL is locked — changing it requires deleting and recreating the subscription.",
        `verification_token=${payload.verification_token}`,
      ].join(" ")
    );
    return new Response("OK", { status: 200 });
  }

  protected extractEvents(parsed: unknown): NotionWebhookEvent[] {
    if (isWebhookEvent(parsed)) {
      return [parsed];
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as { events?: unknown }).events)
    ) {
      return (parsed as { events: unknown[] }).events.filter(isWebhookEvent);
    }
    return [];
  }

  protected async handleCommentCreated(
    event: NotionWebhookEvent,
    options?: WebhookOptions
  ): Promise<void> {
    if (!this.chat) {
      this.logger.error(
        "Notion adapter not initialized; dropping comment.created"
      );
      return;
    }

    const commentId = event.entity.id;
    if (!event.data?.page_id) {
      this.logger.warn(
        "comment.created missing data.page_id; will resolve from comment parent",
        { commentId, eventId: event.id }
      );
    }

    // Sparse payloads omit discussion_id. Fetch inside the factory (PRD) and
    // share one in-flight promise so processMessage gets the discussion-scoped
    // threadId without a second HTTP round-trip.
    let cached: Promise<Message<NotionRawMessage>> | null = null;
    const lazyFactory = (): Promise<Message<NotionRawMessage>> => {
      if (!cached) {
        cached = (async () => {
          const comment = await this.retrieveComment(commentId);
          if (!comment) {
            throw new CommentGoneError(commentId);
          }
          const pageId = await this.resolvePageId(comment, event);
          const threadId = this.encodeThreadId({
            pageId,
            discussionId: comment.discussion_id,
          });
          return this.parseComment(comment, threadId, event);
        })();
      }
      return cached;
    };

    // CommentGoneError is handled in dispatchWebhookEvent (mark seen + drop).
    // Other errors propagate so the event is not marked seen and Notion retries.
    const preview = await lazyFactory();
    this.chat.processMessage(this, preview.threadId, lazyFactory, options);
  }

  // ---------------------------------------------------------------------------
  // Parsing / mentions
  // ---------------------------------------------------------------------------

  parseMessage(raw: NotionRawMessage): Message<NotionRawMessage> {
    const pageId = raw.pageId;
    const threadId = this.encodeThreadId({
      pageId,
      discussionId: raw.comment.discussion_id,
    });
    return this.parseComment(raw.comment, threadId, raw.event);
  }

  protected parseComment(
    comment: NotionComment,
    threadId: string,
    event?: NotionWebhookEvent
  ): Message<NotionRawMessage> {
    const plain = this.formatConverter.richTextToPlain(comment.rich_text);
    const markdown = this.formatConverter.richTextToMarkdown(comment.rich_text);
    const isBot =
      comment.created_by.type === "bot" ||
      comment.created_by.id === this._botUserId;
    const isMe =
      comment.created_by.id === this._botUserId ||
      this.recentlyPostedIds.has(comment.id);

    const message = new Message<NotionRawMessage>({
      id: comment.id,
      threadId,
      text: plain,
      formatted: this.formatConverter.toAst(markdown || plain || ""),
      raw: { comment, pageId: this.decodeThreadId(threadId).pageId, event },
      author: {
        userId: comment.created_by.id,
        userName: comment.created_by.name ?? comment.created_by.id,
        fullName: comment.created_by.name ?? comment.created_by.id,
        isBot: Boolean(isBot),
        isMe,
      },
      metadata: {
        dateSent: new Date(comment.created_time),
        edited: comment.last_edited_time > comment.created_time,
        editedAt:
          comment.last_edited_time > comment.created_time
            ? new Date(comment.last_edited_time)
            : undefined,
      },
      attachments: (comment.attachments ?? []).map((att) => ({
        type: "file" as const,
        name: att.category,
        url: att.file.url,
      })),
    });

    message.isMention = this.detectMention(comment, plain, isMe);
    return message;
  }

  protected detectMention(
    _comment: NotionComment,
    plainText: string,
    isMe: boolean
  ): boolean {
    if (isMe) {
      return false;
    }
    switch (this.mentionMode) {
      case "all-comments":
        return true;
      case "keyword": {
        if (this.keywords.length === 0) {
          return false;
        }
        return this.keywords.some((keyword) => {
          const pattern = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i");
          return pattern.test(plainText);
        });
      }
      default: {
        // "mention" — Notion connection bots are not @-mentionable in the
        // composer, so match plain-text @userName / @botUserId like Chat/GitHub
        // (not rich-text mention spans).
        return textMentionsBot(plainText, this.userName, this._botUserId);
      }
    }
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  // ---------------------------------------------------------------------------
  // Outbound (M2 stubs that compile; real impl in M2)
  // ---------------------------------------------------------------------------

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<NotionRawMessage>> {
    const decoded = this.decodeThreadId(threadId);
    const { markdown, attachmentIds, linkOverflow } = await this.renderOutbound(
      message,
      { attachNative: true }
    );

    let bodyMarkdown = markdown;
    if (linkOverflow.length > 0) {
      bodyMarkdown = `${bodyMarkdown}\n\n${linkOverflow.join("\n")}`.trim();
    }

    // Split over-long bodies into sequential comments — Notion caps a rich-text
    // run at 2000 chars. Always post at least one comment, even when empty.
    const chunks = chunkMarkdown(bodyMarkdown, MAX_COMMENT_MARKDOWN_CHARS);
    const safeChunks = chunks.length > 0 ? chunks : [bodyMarkdown];

    const postChunk = async (
      chunk: string,
      replyDiscussionId: string | undefined,
      withAttachments: boolean
    ): Promise<NotionComment> => {
      const body: Record<string, unknown> = { markdown: chunk };
      if (replyDiscussionId) {
        body.discussion_id = replyDiscussionId;
      } else if (decoded.blockId) {
        // Decision B: whole-block discussion start (selected-text cannot be started via API)
        body.parent = { block_id: decoded.blockId };
      } else {
        body.parent = { page_id: decoded.pageId };
      }
      if (withAttachments && attachmentIds.length > 0) {
        body.attachments = attachmentIds.map((file_upload_id) => ({
          type: "file_upload",
          file_upload_id,
        }));
      }
      const posted = await this.apiFetch<NotionComment>("/comments", {
        method: "POST",
        body,
      });
      this.trackPostedComment(posted.id);
      return posted;
    };

    // First chunk opens the discussion (or replies to an existing one); the
    // rest reply into that same discussion. Attachments ride the last chunk.
    let head: NotionComment | undefined;
    let replyDiscussionId = decoded.discussionId;
    for (const [index, chunk] of safeChunks.entries()) {
      const isLast = index === safeChunks.length - 1;
      const comment = await postChunk(chunk, replyDiscussionId, isLast);
      head ??= comment;
      replyDiscussionId = comment.discussion_id;
    }
    if (!head) {
      // Unreachable: safeChunks always has at least one entry.
      throw new ValidationError("notion", "postMessage produced no comment");
    }

    const fullThreadId = this.encodeThreadId({
      pageId: decoded.pageId,
      discussionId: head.discussion_id,
    });

    return {
      id: head.id,
      threadId: fullThreadId,
      raw: { comment: head, pageId: decoded.pageId },
    };
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<NotionRawMessage>> {
    const decoded = this.decodeThreadId(threadId);
    // PATCH comments may not accept attachments — link files in markdown only.
    const { markdown, linkOverflow } = await this.renderOutbound(message, {
      attachNative: false,
    });
    let bodyMarkdown = markdown;
    if (linkOverflow.length > 0) {
      bodyMarkdown = `${bodyMarkdown}\n\n${linkOverflow.join("\n")}`.trim();
    }
    const comment = await this.apiFetch<NotionComment>(
      `/comments/${messageId}`,
      { method: "PATCH", body: { markdown: bodyMarkdown } }
    );
    return {
      id: comment.id,
      threadId,
      raw: { comment, pageId: decoded.pageId },
    };
  }

  async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    await this.apiFetch(`/comments/${messageId}`, { method: "DELETE" });
  }

  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    options?: StreamOptions
  ): Promise<RawMessage<NotionRawMessage> | null> {
    const intervalMs =
      options?.updateIntervalMs ?? this.streamingEditIntervalMs;
    const renderer = new StreamingMarkdownRenderer();
    let posted: RawMessage<NotionRawMessage> | null = null;
    let editThreadId = threadId;
    let lastEditContent = "";
    let lastEditAt = 0;
    let stopped = false;
    let pendingEdit: Promise<void> | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const flushEdit = async (force: boolean): Promise<void> => {
      if (!posted) {
        return;
      }
      const content = renderer.render();
      // Skip redundant PATCH even on final flush when content is unchanged.
      if (content === lastEditContent) {
        return;
      }
      const elapsed = Date.now() - lastEditAt;
      if (!(force || elapsed >= intervalMs)) {
        return;
      }
      try {
        posted = await this.editMessage(editThreadId, posted.id, {
          markdown: content,
        });
        lastEditContent = content;
        lastEditAt = Date.now();
        editThreadId = posted.threadId || editThreadId;
      } catch (error) {
        this.logger.warn("Notion stream edit failed", { error });
      }
    };

    const scheduleNextEdit = (): void => {
      timerId = setTimeout(() => {
        pendingEdit = flushEdit(false).then(() => {
          if (!stopped) {
            scheduleNextEdit();
          }
        });
      }, intervalMs);
    };

    for await (const chunk of textStream) {
      if (typeof chunk === "string") {
        renderer.push(chunk);
      } else if (chunk.type === "markdown_text") {
        renderer.push(chunk.text);
      }
      // Ignore structured chunks Notion cannot render

      if (!posted) {
        const initial = renderer.render() || "…";
        posted = await this.postMessage(threadId, { markdown: initial });
        lastEditContent = initial;
        lastEditAt = Date.now();
        editThreadId = posted.threadId || threadId;
        scheduleNextEdit();
      }
    }

    stopped = true;
    if (timerId) {
      clearTimeout(timerId);
    }
    if (pendingEdit) {
      await pendingEdit;
    }

    if (!posted) {
      return this.postMessage(threadId, {
        markdown: renderer.render() || "…",
      });
    }

    await flushEdit(true);
    return posted;
  }

  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: string
  ): Promise<void> {
    throw new NotImplementedError(
      "Notion does not support reactions on comments",
      "addReaction"
    );
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: string
  ): Promise<void> {
    throw new NotImplementedError(
      "Notion does not support reactions on comments",
      "removeReaction"
    );
  }

  async startTyping(_threadId: string, _status?: string): Promise<void> {
    // No typing indicator API — intentional no-op per PRD §7.6
  }

  async disconnect(): Promise<void> {
    // No persistent connections
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<NotionRawMessage>> {
    const decoded = this.decodeThreadId(threadId);
    const limit = options.limit ?? 50;
    const direction = options.direction ?? "backward";
    // Notion list-comments ordering is undocumented; we assume oldest-first
    // (ascending created_time), matching observed API behavior.
    const pageSize = Math.min(Math.max(limit, 1), 100);

    const toMessages = (comments: NotionComment[]) =>
      comments.map((comment) =>
        this.parseComment(
          comment,
          this.encodeThreadId({
            pageId: decoded.pageId,
            discussionId: comment.discussion_id,
          })
        )
      );

    const filterDiscussion = (comments: NotionComment[]) =>
      decoded.discussionId
        ? comments.filter((c) => c.discussion_id === decoded.discussionId)
        : comments;

    if (direction === "forward") {
      const params = new URLSearchParams({
        block_id: decoded.pageId,
        page_size: String(pageSize),
      });
      if (options.cursor) {
        params.set("start_cursor", options.cursor);
      }

      const list = await this.apiFetch<NotionCommentListResponse>(
        `/comments?${params}`
      );
      const comments = filterDiscussion(list.results).slice(0, limit);

      return {
        messages: toMessages(comments),
        nextCursor: list.has_more ? (list.next_cursor ?? undefined) : undefined,
      };
    }

    // backward: walk oldest-first pages (cap ~20), then take newest `limit`.
    // nextCursor is set only when the page cap stops us before exhausting
    // older pages (best-effort; Notion start_cursor walks forward).
    const collected: NotionComment[] = [];
    let cursor = options.cursor;
    let pages = 0;
    let stoppedEarly = false;
    let earlyCursor: string | undefined;

    while (pages < MAX_FETCH_PAGES) {
      const params = new URLSearchParams({
        block_id: decoded.pageId,
        page_size: String(pageSize),
      });
      if (cursor) {
        params.set("start_cursor", cursor);
      }

      const list = await this.apiFetch<NotionCommentListResponse>(
        `/comments?${params}`
      );
      pages += 1;
      collected.push(...filterDiscussion(list.results));

      if (!(list.has_more && list.next_cursor)) {
        break;
      }
      cursor = list.next_cursor;
      if (pages >= MAX_FETCH_PAGES) {
        stoppedEarly = true;
        earlyCursor = list.next_cursor;
        break;
      }
    }

    return {
      messages: toMessages(collected.slice(-limit)),
      nextCursor: stoppedEarly ? earlyCursor : undefined,
    };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const decoded = this.decodeThreadId(threadId);
    return {
      id: threadId,
      channelId: this.channelIdFromThreadId(threadId),
      metadata: {
        pageId: decoded.pageId,
        discussionId: decoded.discussionId,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // API helpers (protected extension surface)
  // ---------------------------------------------------------------------------

  protected trackPostedComment(commentId: string): void {
    this.recentlyPostedIds.set(commentId, Date.now());
    this.pruneRecentPosts();
  }

  protected pruneRecentPosts(): void {
    const cutoff = Date.now() - RECENT_POST_TTL_MS;
    for (const [id, at] of this.recentlyPostedIds) {
      if (at < cutoff) {
        this.recentlyPostedIds.delete(id);
      }
    }
  }

  protected pruneSeenEvents(): void {
    const cutoff = Date.now() - DEDUPE_TTL_MS;
    for (const [id, at] of this.seenEventIds) {
      if (at < cutoff) {
        this.seenEventIds.delete(id);
      }
    }
  }

  protected async retrieveComment(
    commentId: string
  ): Promise<NotionComment | null> {
    try {
      return await this.apiFetch<NotionComment>(`/comments/${commentId}`);
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  protected async resolvePageId(
    comment: NotionComment,
    event?: NotionWebhookEvent
  ): Promise<string> {
    if (event?.data?.page_id) {
      return normalizeUuid(event.data.page_id, "pageId");
    }
    if (comment.parent.type === "page_id") {
      return normalizeUuid(comment.parent.page_id, "pageId");
    }
    const blockId = normalizeUuid(comment.parent.block_id, "blockId");
    return this.resolveBlockPageId(blockId);
  }

  protected async resolveBlockPageId(blockId: string): Promise<string> {
    const cached = this.blockPageCache.get(blockId);
    if (cached) {
      return cached;
    }

    const state = this.chat?.getState();
    const stateKey = `notion:block-page:${blockId}`;
    if (state) {
      const fromState = await state.get(stateKey);
      if (typeof fromState === "string") {
        this.blockPageCache.set(blockId, fromState);
        return fromState;
      }
    }

    const visited: string[] = [blockId];
    let currentId = blockId;
    for (let depth = 0; depth < 20; depth++) {
      const block = await this.apiFetch<{
        id: string;
        parent: {
          type: string;
          page_id?: string;
          block_id?: string;
          workspace?: boolean;
        };
      }>(`/blocks/${currentId}`);

      if (block.parent.type === "page_id" && block.parent.page_id) {
        const pageId = normalizeUuid(block.parent.page_id, "pageId");
        // Cache every intermediate blockId → pageId once the page is found.
        for (const visitedId of visited) {
          this.blockPageCache.set(visitedId, pageId);
          if (state) {
            await state.set(`notion:block-page:${visitedId}`, pageId);
          }
        }
        return pageId;
      }
      if (block.parent.type === "block_id" && block.parent.block_id) {
        currentId = normalizeUuid(block.parent.block_id, "blockId");
        visited.push(currentId);
        const cachedParent = this.blockPageCache.get(currentId);
        if (cachedParent) {
          for (const visitedId of visited) {
            this.blockPageCache.set(visitedId, cachedParent);
          }
          return cachedParent;
        }
        continue;
      }
      break;
    }

    throw new ValidationError(
      "notion",
      `Could not resolve containing page for block ${blockId}`
    );
  }

  /**
   * Protected Notion REST helper. All adapter API traffic goes through here
   * so the global token-bucket and Retry-After handling stay centralized.
   */
  protected async apiFetch<T>(
    path: string,
    init: {
      method?: string;
      body?: unknown;
    } = {}
  ): Promise<T> {
    let attempt = 0;
    for (;;) {
      await this.rateLimiter.acquire();
      const url = path.startsWith("http") ? path : `${this.apiBaseUrl}${path}`;
      const response = await fetch(url, {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Notion-Version": this.notionVersion,
          "Content-Type": "application/json",
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });

      const handled = await this.handleNotionHttpResponse<T>(
        response,
        path,
        init.method ?? "GET",
        attempt
      );
      if (handled.kind === "retry") {
        attempt = handled.attempt;
        continue;
      }
      return handled.value;
    }
  }

  /**
   * Create a Notion File Upload (single_part) and send binary contents.
   * Returns the file_upload id when status is uploaded.
   */
  protected async uploadFileToNotion(input: {
    filename: string;
    mimeType?: string;
    data: Buffer | Blob | ArrayBuffer;
  }): Promise<string> {
    const createBody: Record<string, string> = {
      filename: input.filename,
    };
    if (input.mimeType) {
      createBody.content_type = input.mimeType;
    }
    const created = await this.apiFetch<NotionFileUploadResponse>(
      "/file_uploads",
      { method: "POST", body: createBody }
    );
    if (!created.id) {
      throw new ValidationError(
        "notion",
        "Notion File Upload create returned no id"
      );
    }

    const blob = fileUploadDataToBlob(input.data, input.mimeType);
    await this.sendFileUploadMultipart(created.id, blob, input.filename);
    return created.id;
  }

  /**
   * Import a publicly reachable URL via Notion File Uploads `external_url` mode.
   * Polls until status is `uploaded` (Notion imports asynchronously). Returns
   * the file_upload id only when attachable; otherwise null so callers can
   * fall back to a markdown link without failing the comment.
   */
  protected async uploadExternalUrlToNotion(input: {
    url: string;
    filename?: string;
  }): Promise<string | null> {
    try {
      const body: Record<string, string> = {
        mode: "external_url",
        external_url: input.url,
      };
      if (input.filename) {
        body.filename = input.filename;
      }
      const created = await this.apiFetch<NotionFileUploadResponse>(
        "/file_uploads",
        { method: "POST", body }
      );
      if (!created.id) {
        return null;
      }
      return await this.waitForFileUploadUploaded(created.id, created.status);
    } catch (error) {
      this.logger.warn("Notion external_url file upload failed", {
        url: input.url,
        error,
      });
      return null;
    }
  }

  /**
   * Wait until a File Upload leaves `pending` and is attachable (`uploaded`).
   * Polls immediately when the first delay is `0`, then sleeps between
   * subsequent checks. Returns null for failed/expired/timeout so the
   * comment can still post with a markdown link.
   */
  protected async waitForFileUploadUploaded(
    fileUploadId: string,
    initialStatus?: string
  ): Promise<string | null> {
    let status = initialStatus;
    if (status === "uploaded") {
      return fileUploadId;
    }
    if (status === "failed" || status === "expired") {
      return null;
    }

    for (const delayMs of this.externalUrlPollDelaysMs) {
      if (delayMs > 0) {
        await sleep(delayMs);
      }
      const current = await this.apiFetch<NotionFileUploadResponse>(
        `/file_uploads/${fileUploadId}`
      );
      status = current.status;
      if (status === "uploaded") {
        return fileUploadId;
      }
      if (status === "failed" || status === "expired") {
        this.logger.warn("Notion external_url file upload did not succeed", {
          fileUploadId,
          status,
        });
        return null;
      }
    }

    this.logger.warn(
      "Notion external_url file upload still pending after poll window; linking instead",
      { fileUploadId, status }
    );
    return null;
  }

  /**
   * POST multipart form-data to `/file_uploads/{id}/send`.
   * Does not set Content-Type manually — FormData supplies the boundary.
   */
  protected async sendFileUploadMultipart(
    fileUploadId: string,
    blob: Blob,
    filename: string
  ): Promise<void> {
    const path = `/file_uploads/${fileUploadId}/send`;
    let attempt = 0;
    for (;;) {
      await this.rateLimiter.acquire();
      const url = `${this.apiBaseUrl}${path}`;
      const formData = new FormData();
      formData.append("file", blob, filename);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Notion-Version": this.notionVersion,
        },
        body: formData,
      });

      const handled =
        await this.handleNotionHttpResponse<NotionFileUploadResponse>(
          response,
          path,
          "POST",
          attempt
        );
      if (handled.kind === "retry") {
        attempt = handled.attempt;
        continue;
      }
      if (handled.value?.status && handled.value.status !== "uploaded") {
        throw new ValidationError(
          "notion",
          `Notion File Upload send for ${fileUploadId} returned status ${handled.value.status}`
        );
      }
      return;
    }
  }

  /**
   * Shared status / error handling for JSON and multipart Notion HTTP calls.
   */
  protected async handleNotionHttpResponse<T>(
    response: Response,
    path: string,
    method: string,
    attempt: number
  ): Promise<{ kind: "ok"; value: T } | { kind: "retry"; attempt: number }> {
    if (response.status === 429 || response.status === 529) {
      const retryAfter = parseRetryAfterSeconds(
        response.headers.get("retry-after")
      );
      const nextAttempt = attempt + 1;
      if (nextAttempt > MAX_RATE_LIMIT_RETRIES) {
        throw new AdapterRateLimitError("notion", retryAfter);
      }
      this.logger.warn("Notion rate limited; backing off", {
        status: response.status,
        retryAfter,
        attempt: nextAttempt,
        path,
      });
      await sleep(Math.max(retryAfter, 1) * 1000);
      return { kind: "retry", attempt: nextAttempt };
    }

    if (response.status === 401) {
      throw new AuthenticationError(
        "notion",
        "Notion API authentication failed — check NOTION_TOKEN"
      );
    }

    if (response.status === 403) {
      throw new PermissionError(
        "notion",
        "access this resource",
        "Enable Read content / Read comments / Insert comments (and User information if needed) on the Notion connection, and share the target pages with the connection"
      );
    }

    if (response.status === 404) {
      if (method === "PATCH" || method === "DELETE") {
        throw new PermissionError(
          "notion",
          `${method === "PATCH" ? "edit" : "delete"} this comment`,
          "Notion only allows updating/deleting comments created by this connection"
        );
      }
      throw new ResourceNotFoundError("notion", "resource", path);
    }

    if (!response.ok) {
      const text = await response.text();
      if (response.status >= 500) {
        throw new NetworkError(
          "notion",
          `Notion API ${method} ${path} failed (${response.status}): ${text}`
        );
      }
      throw new ValidationError(
        "notion",
        `Notion API ${method} ${path} failed (${response.status}): ${text}`
      );
    }

    if (response.status === 204) {
      return { kind: "ok", value: undefined as T };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return { kind: "ok", value: undefined as T };
    }

    return { kind: "ok", value: (await response.json()) as T };
  }

  /**
   * Render outbound message to Notion comment markdown + optional attachments.
   * Cards flatten to markdown; interactive buttons are warned and dropped.
   * When `attachNative` is true (postMessage), uploads up to 3 files via the
   * File Uploads API; overflow and failures become markdown links.
   */
  protected async renderOutbound(
    message: AdapterPostableMessage,
    options: { attachNative: boolean }
  ): Promise<{
    markdown: string;
    attachmentIds: string[];
    linkOverflow: string[];
  }> {
    const card = extractCard(message);
    let markdown: string;
    if (card) {
      if (
        card.children.some(
          (child) =>
            typeof child === "object" &&
            child !== null &&
            "type" in child &&
            (child as { type?: string }).type === "actions"
        )
      ) {
        this.logger.warn(
          "Notion comments do not support interactive buttons/callbackUrl; rendering card as markdown fallback"
        );
      }
      markdown = this.formatConverter.normalizeCommentMarkdown(
        cardToNotionMarkdown(card)
      );
    } else {
      markdown = this.formatConverter.renderPostable(message);
    }

    const files = extractFiles(message);
    const attachments = extractPostableAttachments(message);
    const attachmentIds: string[] = [];
    const linkOverflow: string[] = [];

    const urlCandidates = attachments.filter(
      (a): a is typeof a & { url: string } =>
        typeof a.url === "string" && a.url.length > 0
    );

    const totalCandidates = files.length + urlCandidates.length;
    if (options.attachNative && totalCandidates > MAX_COMMENT_ATTACHMENTS) {
      this.logger.warn(
        `Notion comments support at most ${MAX_COMMENT_ATTACHMENTS} native attachments; linking the rest as markdown`,
        { totalCandidates }
      );
    }

    for (const file of files) {
      if (
        options.attachNative &&
        attachmentIds.length < MAX_COMMENT_ATTACHMENTS
      ) {
        try {
          const id = await this.uploadFileToNotion({
            filename: file.filename,
            mimeType: file.mimeType,
            data: file.data,
          });
          attachmentIds.push(id);
          continue;
        } catch (error) {
          this.logger.warn(
            "Notion File Upload failed; falling back to markdown link",
            { filename: file.filename, error }
          );
        }
      }
      linkOverflow.push(`📎 ${file.filename}`);
    }

    for (const attachment of urlCandidates) {
      if (
        options.attachNative &&
        attachmentIds.length < MAX_COMMENT_ATTACHMENTS
      ) {
        try {
          const id = await this.uploadExternalUrlToNotion({
            url: attachment.url,
            filename: attachment.name,
          });
          if (id) {
            attachmentIds.push(id);
            continue;
          }
        } catch (error) {
          this.logger.warn(
            "Notion external_url File Upload failed; falling back to markdown link",
            { url: attachment.url, error }
          );
        }
      }
      linkOverflow.push(attachment.url);
    }

    return {
      markdown: convertEmojiPlaceholders(markdown, "notion"),
      attachmentIds,
      linkOverflow,
    };
  }
}

interface NotionFileUploadResponse {
  content_type?: string | null;
  filename?: string | null;
  id?: string;
  object?: string;
  status?: string;
}

function fileUploadDataToBlob(
  data: Buffer | Blob | ArrayBuffer,
  mimeType?: string
): Blob {
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Blob([data], { type: mimeType });
  }
  if (Buffer.isBuffer(data)) {
    return new Blob([new Uint8Array(data)], { type: mimeType });
  }
  throw new ValidationError(
    "notion",
    "Unsupported FileUpload data type for Notion upload"
  );
}

/** Soft-drop signal: comment deleted/resolved before retrieve — mark seen. */
class CommentGoneError extends AdapterError {
  readonly commentId: string;

  constructor(commentId: string) {
    super(`Comment ${commentId} gone`, "notion", "COMMENT_GONE");
    this.name = "CommentGoneError";
    this.commentId = commentId;
  }
}

/**
 * Plain-text @-mention detection (GitHub / Chat SDK style).
 * Matches `@userName` or `@botUserId` with a word boundary after the token.
 */
function textMentionsBot(
  plainText: string,
  userName: string,
  botUserId: string | null
): boolean {
  const usernamePattern = new RegExp(`@${escapeRegExp(userName)}\\b`, "i");
  if (usernamePattern.test(plainText)) {
    return true;
  }
  if (botUserId) {
    const userIdPattern = new RegExp(`@${escapeRegExp(botUserId)}\\b`, "i");
    if (userIdPattern.test(plainText)) {
      return true;
    }
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse Retry-After: integer seconds, or HTTP-date via Date.parse.
 * Never returns NaN (defaults to 1 second).
 */
function parseRetryAfterSeconds(header: string | null): number {
  if (!header) {
    return 1;
  }
  const asNumber = Number(header);
  if (!Number.isNaN(asNumber) && asNumber >= 0) {
    return asNumber;
  }
  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) {
    const seconds = Math.ceil((asDate - Date.now()) / 1000);
    return seconds > 0 ? seconds : 1;
  }
  return 1;
}

export function createNotionAdapter(
  config?: NotionAdapterConfig
): NotionAdapter {
  return new NotionAdapter(config);
}
