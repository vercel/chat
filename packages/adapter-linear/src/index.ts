import { createHmac, timingSafeEqual } from "node:crypto";
import { extractCard, ValidationError } from "@chat-adapter/shared";
import type { LinearFetch, User } from "@linear/sdk";
import { LinearClient } from "@linear/sdk";
import type {
  Adapter,
  AdapterPostableMessage,
  Author,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Logger,
  RawMessage,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import { ConsoleLogger, convertEmojiPlaceholders, Message } from "chat";
import { cardToLinearMarkdown } from "./cards";
import { LinearFormatConverter } from "./markdown";
import type {
  CommentWebhookPayload,
  LinearAdapterConfig,
  LinearCommentData,
  LinearRawMessage,
  LinearThreadId,
  LinearWebhookActor,
  LinearWebhookPayload,
  ReactionWebhookPayload,
} from "./types";

const COMMENT_THREAD_PATTERN = /^([^:]+):c:([^:]+)$/;

// Re-export types
export type {
  LinearAdapterAPIKeyConfig,
  LinearAdapterAppConfig,
  LinearAdapterConfig,
  LinearAdapterOAuthConfig,
  LinearRawMessage,
  LinearThreadId,
} from "./types";

/**
 * Linear adapter for chat SDK.
 *
 * Supports comment threads on Linear issues.
 * Authentication via personal API key or OAuth access token.
 *
 * @example API Key auth
 * ```typescript
 * import { Chat } from "chat";
 * import { createLinearAdapter } from "@chat-adapter/linear";
 * import { MemoryState } from "@chat-adapter/state-memory";
 *
 * const chat = new Chat({
 *   userName: "my-bot",
 *   adapters: {
 *     linear: createLinearAdapter({
 *       apiKey: process.env.LINEAR_API_KEY!,
 *       webhookSecret: process.env.LINEAR_WEBHOOK_SECRET!,
 *       userName: "my-bot",
 *       logger: console,
 *     }),
 *   },
 *   state: new MemoryState(),
 *   logger: "info",
 * });
 * ```
 *
 * @example OAuth auth
 * ```typescript
 * const chat = new Chat({
 *   userName: "my-bot",
 *   adapters: {
 *     linear: createLinearAdapter({
 *       accessToken: process.env.LINEAR_ACCESS_TOKEN!,
 *       webhookSecret: process.env.LINEAR_WEBHOOK_SECRET!,
 *       userName: "my-bot",
 *       logger: console,
 *     }),
 *   },
 *   state: new MemoryState(),
 *   logger: "info",
 * });
 * ```
 */
export class LinearAdapter
  implements Adapter<LinearThreadId, LinearRawMessage>
{
  readonly name = "linear";
  readonly userName: string;

  private linearClient!: LinearClient;
  private readonly webhookSecret: string;
  private chat: ChatInstance | null = null;
  private readonly logger: Logger;
  private _botUserId: string | null = null;
  private readonly formatConverter = new LinearFormatConverter();

  // Client credentials auth state
  private readonly clientCredentials: {
    clientId: string;
    clientSecret: string;
  } | null = null;
  private accessTokenExpiry: number | null = null;

  /** Bot user ID used for self-message detection */
  get botUserId(): string | undefined {
    return this._botUserId ?? undefined;
  }

  constructor(config: LinearAdapterConfig) {
    this.webhookSecret = config.webhookSecret;
    this.logger = config.logger;
    this.userName = config.userName;

    // Create LinearClient based on auth method
    // @see https://linear.app/developers/sdk
    if ("apiKey" in config && config.apiKey) {
      this.linearClient = new LinearClient({ apiKey: config.apiKey });
    } else if ("accessToken" in config && config.accessToken) {
      this.linearClient = new LinearClient({
        accessToken: config.accessToken,
      });
    } else if ("clientId" in config && config.clientId) {
      // Client credentials mode - token will be fetched during initialize()
      this.clientCredentials = {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      };
    } else {
      throw new Error(
        "LinearAdapter requires either apiKey, accessToken, or clientId/clientSecret"
      );
    }
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    // For client credentials mode, fetch an access token first
    if (this.clientCredentials) {
      await this.refreshClientCredentialsToken();
    }

    // Fetch the bot's user ID for self-message detection
    // @see https://linear.app/developers/sdk-fetching-and-modifying-data
    try {
      const viewer = await this.linearClient.viewer;
      this._botUserId = viewer.id;
      this.logger.info("Linear auth completed", {
        botUserId: this._botUserId,
        displayName: viewer.displayName,
      });
    } catch (error) {
      this.logger.warn("Could not fetch Linear bot user ID", { error });
    }
  }

  /**
   * Fetch a new access token using client credentials grant.
   * The token is valid for 30 days. The adapter auto-refreshes on 401.
   *
   * @see https://linear.app/developers/oauth-2-0-authentication#client-credentials-tokens
   */
  private async refreshClientCredentialsToken(): Promise<void> {
    if (!this.clientCredentials) {
      return;
    }

    const { clientId, clientSecret } = this.clientCredentials;

    const response = await fetch("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "read,write,comments:create,issues:create",
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to fetch Linear client credentials token: ${response.status} ${errorBody}`
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.linearClient = new LinearClient({
      accessToken: data.access_token,
    });

    // Track expiry so we can proactively refresh (with 1 hour buffer)
    this.accessTokenExpiry = Date.now() + data.expires_in * 1000 - 3600000;

    this.logger.info("Linear client credentials token obtained", {
      expiresIn: `${Math.round(data.expires_in / 86400)} days`,
    });
  }

  /**
   * Ensure the client credentials token is still valid. Refresh if expired.
   */
  private async ensureValidToken(): Promise<void> {
    if (
      this.clientCredentials &&
      this.accessTokenExpiry &&
      Date.now() > this.accessTokenExpiry
    ) {
      this.logger.info("Linear access token expired, refreshing...");
      await this.refreshClientCredentialsToken();
    }
  }

  /**
   * Handle incoming webhook from Linear.
   *
   * @see https://linear.app/developers/webhooks
   */
  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    const body = await request.text();
    this.logger.debug("Linear webhook raw body", {
      body: body.substring(0, 500),
    });

    // Verify request signature (Linear-Signature header)
    // @see https://linear.app/developers/webhooks#securing-webhooks
    const signature = request.headers.get("linear-signature");
    if (!this.verifySignature(body, signature)) {
      return new Response("Invalid signature", { status: 401 });
    }

    // Parse the JSON payload
    let payload: LinearWebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      this.logger.error("Linear webhook invalid JSON", {
        contentType: request.headers.get("content-type"),
        bodyPreview: body.substring(0, 200),
      });
      return new Response("Invalid JSON", { status: 400 });
    }

    // Validate webhook timestamp to prevent replay attacks (within 5 minutes)
    if (payload.webhookTimestamp) {
      const timeDiff = Math.abs(Date.now() - payload.webhookTimestamp);
      if (timeDiff > 5 * 60 * 1000) {
        this.logger.warn("Linear webhook timestamp too old", {
          webhookTimestamp: payload.webhookTimestamp,
          timeDiff,
        });
        return new Response("Webhook expired", { status: 401 });
      }
    }

    // Handle events based on type
    if (payload.type === "Comment") {
      const commentPayload = payload as CommentWebhookPayload;
      if (commentPayload.action === "create") {
        this.handleCommentCreated(commentPayload, options);
      }
    } else if (payload.type === "Reaction") {
      const reactionPayload = payload as ReactionWebhookPayload;
      this.handleReaction(reactionPayload);
    }

    return new Response("ok", { status: 200 });
  }

  /**
   * Verify Linear webhook signature using HMAC-SHA256.
   *
   * @see https://linear.app/developers/webhooks#securing-webhooks
   */
  private verifySignature(body: string, signature: string | null): boolean {
    if (!signature) {
      return false;
    }

    const computedSignature = createHmac("sha256", this.webhookSecret)
      .update(body)
      .digest("hex");

    try {
      return timingSafeEqual(
        Buffer.from(computedSignature, "hex"),
        Buffer.from(signature, "hex")
      );
    } catch {
      return false;
    }
  }

  /**
   * Handle a new comment created on an issue.
   *
   * Threading logic:
   * - If the comment has a parentId, it's a reply -> thread under the parent (root comment)
   * - If no parentId, this is a root comment -> thread under this comment's own ID
   */
  private handleCommentCreated(
    payload: CommentWebhookPayload,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring comment");
      return;
    }

    const { data, actor } = payload;

    // Skip if the comment has no issueId (e.g., project update comment)
    if (!data.issueId) {
      this.logger.debug("Ignoring non-issue comment", {
        commentId: data.id,
      });
      return;
    }

    // Determine thread: use parentId as root if it's a reply, otherwise this comment is the root
    const rootCommentId = data.parentId || data.id;
    const threadId = this.encodeThreadId({
      issueId: data.issueId,
      commentId: rootCommentId,
    });

    // Build message
    const message = this.buildMessage(data, actor, threadId);

    // Skip bot's own messages
    if (data.userId === this._botUserId) {
      this.logger.debug("Ignoring message from self", {
        messageId: data.id,
      });
      return;
    }

    this.chat.processMessage(this, threadId, message, options);
  }

  /**
   * Handle reaction events (logging only - reactions don't include issueId).
   */
  private handleReaction(payload: ReactionWebhookPayload): void {
    if (!this.chat) {
      return;
    }

    const { data, actor } = payload;

    // Reactions on comments need a commentId to find the thread.
    // Since reaction webhooks don't include issueId directly,
    // we'd need an additional API call to look it up.
    this.logger.debug("Received reaction webhook", {
      reactionId: data.id,
      emoji: data.emoji,
      commentId: data.commentId,
      action: payload.action,
      actorName: actor.name,
    });
  }

  /**
   * Build a Message from a Linear comment and actor.
   */
  private buildMessage(
    comment: LinearCommentData,
    actor: LinearWebhookActor,
    threadId: string
  ): Message<LinearRawMessage> {
    const text = comment.body || "";

    const author: Author = {
      userId: comment.userId,
      userName: actor.name || "unknown",
      fullName: actor.name || "unknown",
      isBot: actor.type !== "user",
      isMe: comment.userId === this._botUserId,
    };

    const formatted: FormattedContent = this.formatConverter.toAst(text);

    const raw: LinearRawMessage = {
      comment,
      organizationId: undefined,
    };

    return new Message<LinearRawMessage>({
      id: comment.id,
      threadId,
      text,
      formatted,
      raw,
      author,
      metadata: {
        dateSent: comment.createdAt ? new Date(comment.createdAt) : new Date(),
        edited: comment.createdAt !== comment.updatedAt,
        editedAt:
          comment.createdAt !== comment.updatedAt && comment.updatedAt
            ? new Date(comment.updatedAt)
            : undefined,
      },
      attachments: [],
    });
  }

  /**
   * Post a message to a thread (create a comment on an issue).
   *
   * For comment-level threads, uses parentId to reply under the root comment.
   * For issue-level threads, creates a top-level comment.
   *
   * Uses LinearClient.createComment({ issueId, body, parentId? }).
   * @see https://linear.app/developers/sdk-fetching-and-modifying-data#mutations
   */
  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<LinearRawMessage>> {
    await this.ensureValidToken();
    const { issueId, commentId } = this.decodeThreadId(threadId);

    // Render message to markdown
    let body: string;
    const card = extractCard(message);
    if (card) {
      body = cardToLinearMarkdown(card);
    } else {
      body = this.formatConverter.renderPostable(message);
    }

    // Convert emoji placeholders to unicode
    body = convertEmojiPlaceholders(body, "linear");

    // Create the comment via Linear SDK
    // If commentId is present, reply under that comment (comment-level thread)
    const commentPayload = await this.linearClient.createComment({
      issueId,
      body,
      parentId: commentId,
    });

    const comment = await commentPayload.comment;
    if (!comment) {
      throw new Error("Failed to create comment on Linear issue");
    }

    return {
      id: comment.id,
      threadId,
      raw: {
        comment: {
          id: comment.id,
          body: comment.body,
          issueId,
          userId: this._botUserId || "",
          createdAt: comment.createdAt.toISOString(),
          updatedAt: comment.updatedAt.toISOString(),
          url: comment.url,
        },
      },
    };
  }

  /**
   * Edit an existing message (update a comment).
   *
   * Uses LinearClient.updateComment(id, { body }).
   * @see https://linear.app/developers/sdk-fetching-and-modifying-data#mutations
   */
  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<LinearRawMessage>> {
    await this.ensureValidToken();
    const { issueId } = this.decodeThreadId(threadId);

    // Render message to markdown
    let body: string;
    const card = extractCard(message);
    if (card) {
      body = cardToLinearMarkdown(card);
    } else {
      body = this.formatConverter.renderPostable(message);
    }

    // Convert emoji placeholders to unicode
    body = convertEmojiPlaceholders(body, "linear");

    // Update the comment via Linear SDK
    const commentPayload = await this.linearClient.updateComment(messageId, {
      body,
    });

    const comment = await commentPayload.comment;
    if (!comment) {
      throw new Error("Failed to update comment on Linear");
    }

    return {
      id: comment.id,
      threadId,
      raw: {
        comment: {
          id: comment.id,
          body: comment.body,
          issueId,
          userId: this._botUserId || "",
          createdAt: comment.createdAt.toISOString(),
          updatedAt: comment.updatedAt.toISOString(),
          url: comment.url,
        },
      },
    };
  }

  /**
   * Delete a message (delete a comment).
   *
   * Uses LinearClient.deleteComment(id).
   */
  async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    await this.ensureValidToken();
    await this.linearClient.deleteComment(messageId);
  }

  /**
   * Add a reaction to a comment.
   *
   * Uses LinearClient.createReaction({ commentId, emoji }).
   * Linear reactions use emoji strings (unicode).
   */
  async addReaction(
    _threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    await this.ensureValidToken();
    const emojiStr = this.resolveEmoji(emoji);
    await this.linearClient.createReaction({
      commentId: messageId,
      emoji: emojiStr,
    });
  }

  /**
   * Remove a reaction from a comment.
   *
   * Linear doesn't have a direct "remove reaction by emoji + user" API.
   * Removing requires knowing the reaction ID, which would require fetching
   * the comment's reactions first. This is a known limitation.
   */
  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    this.logger.warn(
      "removeReaction is not fully supported on Linear - reaction ID lookup would be required"
    );
  }

  /**
   * Start typing indicator. Not supported by Linear.
   */
  async startTyping(_threadId: string): Promise<void> {
    // Linear doesn't support typing indicators
  }

  /**
   * Fetch messages from a thread.
   *
   * For issue-level threads: fetches all top-level issue comments.
   * For comment-level threads: fetches the root comment and its children (replies).
   */
  async fetchMessages(
    threadId: string,
    options?: FetchOptions
  ): Promise<FetchResult<LinearRawMessage>> {
    await this.ensureValidToken();
    const { issueId, commentId } = this.decodeThreadId(threadId);

    if (commentId) {
      // Comment-level thread: fetch root comment's children
      return this.fetchCommentThread(threadId, issueId, commentId, options);
    }

    // Issue-level thread: fetch all top-level comments
    return this.fetchIssueComments(threadId, issueId, options);
  }

  /**
   * Fetch top-level comments on an issue.
   */
  private async fetchIssueComments(
    threadId: string,
    issueId: string,
    options?: FetchOptions
  ): Promise<FetchResult<LinearRawMessage>> {
    const issue = await this.linearClient.issue(issueId);
    const commentsConnection = await issue.comments({
      first: options?.limit ?? 50,
    });

    const messages = await this.commentsToMessages(
      commentsConnection.nodes,
      threadId,
      issueId
    );

    return {
      messages,
      nextCursor: commentsConnection.pageInfo.hasNextPage
        ? commentsConnection.pageInfo.endCursor
        : undefined,
    };
  }

  /**
   * Fetch a comment thread (root comment + its children/replies).
   */
  private async fetchCommentThread(
    threadId: string,
    issueId: string,
    commentId: string,
    options?: FetchOptions
  ): Promise<FetchResult<LinearRawMessage>> {
    const rootComment = await this.linearClient.comment({ id: commentId });
    if (!rootComment) {
      return { messages: [] };
    }

    // Get the children (replies) of the root comment
    const childrenConnection = await rootComment.children({
      first: options?.limit ?? 50,
    });

    // Include the root comment as the first message, then its children
    const rootMessages = await this.commentsToMessages(
      [rootComment],
      threadId,
      issueId
    );
    const childMessages = await this.commentsToMessages(
      childrenConnection.nodes,
      threadId,
      issueId
    );

    return {
      messages: [...rootMessages, ...childMessages],
      nextCursor: childrenConnection.pageInfo.hasNextPage
        ? childrenConnection.pageInfo.endCursor
        : undefined,
    };
  }

  /**
   * Convert an array of Linear SDK Comment objects to Message instances.
   */
  private async commentsToMessages(
    comments: Array<{
      id: string;
      body: string;
      createdAt: Date;
      updatedAt: Date;
      url: string;
      user: LinearFetch<User> | undefined;
    }>,
    threadId: string,
    issueId: string
  ): Promise<Message<LinearRawMessage>[]> {
    const messages: Message<LinearRawMessage>[] = [];

    for (const comment of comments) {
      const user = await comment.user;
      const author: Author = {
        userId: user?.id || "unknown",
        userName: user?.displayName || "unknown",
        fullName: user?.name || user?.displayName || "unknown",
        isBot: false,
        isMe: user?.id === this._botUserId,
      };

      const formatted: FormattedContent = this.formatConverter.toAst(
        comment.body
      );

      messages.push(
        new Message<LinearRawMessage>({
          id: comment.id,
          threadId,
          text: comment.body,
          formatted,
          author,
          metadata: {
            dateSent: new Date(comment.createdAt),
            edited: comment.createdAt.getTime() !== comment.updatedAt.getTime(),
            editedAt:
              comment.createdAt.getTime() !== comment.updatedAt.getTime()
                ? new Date(comment.updatedAt)
                : undefined,
          },
          attachments: [],
          raw: {
            comment: {
              id: comment.id,
              body: comment.body,
              issueId,
              userId: user?.id || "unknown",
              createdAt: comment.createdAt.toISOString(),
              updatedAt: comment.updatedAt.toISOString(),
              url: comment.url,
            },
          },
        })
      );
    }

    return messages;
  }

  /**
   * Fetch thread info for a Linear issue.
   */
  async fetchThread(threadId: string): Promise<ThreadInfo> {
    await this.ensureValidToken();
    const { issueId } = this.decodeThreadId(threadId);

    const issue = await this.linearClient.issue(issueId);

    return {
      id: threadId,
      channelId: issueId,
      channelName: `${issue.identifier}: ${issue.title}`,
      isDM: false,
      metadata: {
        issueId,
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
      },
    };
  }

  /**
   * Encode a Linear thread ID.
   *
   * Formats:
   * - Issue-level: linear:{issueId}
   * - Comment thread: linear:{issueId}:c:{commentId}
   */
  encodeThreadId(platformData: LinearThreadId): string {
    if (platformData.commentId) {
      return `linear:${platformData.issueId}:c:${platformData.commentId}`;
    }
    return `linear:${platformData.issueId}`;
  }

  /**
   * Decode a Linear thread ID.
   *
   * Formats:
   * - Issue-level: linear:{issueId}
   * - Comment thread: linear:{issueId}:c:{commentId}
   */
  decodeThreadId(threadId: string): LinearThreadId {
    if (!threadId.startsWith("linear:")) {
      throw new ValidationError(
        "linear",
        `Invalid Linear thread ID: ${threadId}`
      );
    }

    const withoutPrefix = threadId.slice(7);
    if (!withoutPrefix) {
      throw new ValidationError(
        "linear",
        `Invalid Linear thread ID format: ${threadId}`
      );
    }

    // Check for comment thread format: {issueId}:c:{commentId}
    const commentMatch = withoutPrefix.match(COMMENT_THREAD_PATTERN);
    if (commentMatch) {
      return {
        issueId: commentMatch[1],
        commentId: commentMatch[2],
      };
    }

    // Issue-level format: {issueId}
    return { issueId: withoutPrefix };
  }

  /**
   * Derive channel ID from a Linear thread ID.
   * linear:{issueId}:c:{commentId} -> linear:{issueId}
   * linear:{issueId} -> linear:{issueId}
   */
  channelIdFromThreadId(threadId: string): string {
    const { issueId } = this.decodeThreadId(threadId);
    return `linear:${issueId}`;
  }

  /**
   * Parse platform message format to normalized format.
   */
  parseMessage(raw: LinearRawMessage): Message<LinearRawMessage> {
    const text = raw.comment.body || "";
    const formatted: FormattedContent = this.formatConverter.toAst(text);

    return new Message<LinearRawMessage>({
      id: raw.comment.id,
      threadId: "",
      text,
      formatted,
      author: {
        userId: raw.comment.userId,
        userName: "unknown",
        fullName: "unknown",
        isBot: false,
        isMe: raw.comment.userId === this._botUserId,
      },
      metadata: {
        dateSent: raw.comment.createdAt
          ? new Date(raw.comment.createdAt)
          : new Date(),
        edited: raw.comment.createdAt !== raw.comment.updatedAt,
        editedAt:
          raw.comment.createdAt !== raw.comment.updatedAt &&
          raw.comment.updatedAt
            ? new Date(raw.comment.updatedAt)
            : undefined,
      },
      attachments: [],
      raw,
    });
  }

  /**
   * Render formatted content to Linear markdown.
   */
  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  /**
   * Resolve an emoji value to a unicode string.
   * Linear uses standard unicode emoji for reactions.
   */
  private resolveEmoji(emoji: EmojiValue | string): string {
    const emojiName = typeof emoji === "string" ? emoji : emoji.name;

    const mapping: Record<string, string> = {
      thumbs_up: "\u{1F44D}",
      thumbs_down: "\u{1F44E}",
      heart: "\u{2764}\u{FE0F}",
      fire: "\u{1F525}",
      rocket: "\u{1F680}",
      eyes: "\u{1F440}",
      check: "\u{2705}",
      warning: "\u{26A0}\u{FE0F}",
      sparkles: "\u{2728}",
      wave: "\u{1F44B}",
      raised_hands: "\u{1F64C}",
      laugh: "\u{1F604}",
      hooray: "\u{1F389}",
      confused: "\u{1F615}",
    };

    return mapping[emojiName] || emojiName;
  }
}

/**
 * Factory function to create a Linear adapter.
 *
 * @example
 * ```typescript
 * const adapter = createLinearAdapter({
 *   apiKey: process.env.LINEAR_API_KEY!,
 *   webhookSecret: process.env.LINEAR_WEBHOOK_SECRET!,
 *   userName: "my-bot",
 *   logger: console,
 * });
 * ```
 */
export function createLinearAdapter(config?: {
  accessToken?: string;
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
  logger?: Logger;
  userName?: string;
  webhookSecret?: string;
}): LinearAdapter {
  const logger = config?.logger ?? new ConsoleLogger("info").child("linear");
  const webhookSecret =
    config?.webhookSecret ?? process.env.LINEAR_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new ValidationError(
      "linear",
      "webhookSecret is required. Set LINEAR_WEBHOOK_SECRET or provide it in config."
    );
  }
  const userName =
    config?.userName ?? process.env.LINEAR_BOT_USERNAME ?? "linear-bot";

  // Auto-detect auth mode. Only fall back to env vars for auth fields when
  // the caller hasn't provided ANY auth field, so we don't mix auth modes.
  const hasAuthConfig = !!(
    config?.apiKey ||
    config?.accessToken ||
    config?.clientId ||
    config?.clientSecret
  );

  const apiKey =
    config?.apiKey ?? (hasAuthConfig ? undefined : process.env.LINEAR_API_KEY);
  if (apiKey) {
    return new LinearAdapter({
      apiKey,
      webhookSecret,
      userName,
      logger,
    });
  }

  const accessToken =
    config?.accessToken ??
    (hasAuthConfig ? undefined : process.env.LINEAR_ACCESS_TOKEN);
  if (accessToken) {
    return new LinearAdapter({
      accessToken,
      webhookSecret,
      userName,
      logger,
    });
  }

  const clientId =
    config?.clientId ??
    (hasAuthConfig ? undefined : process.env.LINEAR_CLIENT_ID);
  const clientSecret =
    config?.clientSecret ??
    (hasAuthConfig ? undefined : process.env.LINEAR_CLIENT_SECRET);
  if (clientId && clientSecret) {
    return new LinearAdapter({
      clientId,
      clientSecret,
      webhookSecret,
      userName,
      logger,
    });
  }

  throw new ValidationError(
    "linear",
    "Authentication is required. Set LINEAR_API_KEY, LINEAR_ACCESS_TOKEN, or LINEAR_CLIENT_ID/LINEAR_CLIENT_SECRET, or provide auth in config."
  );
}
