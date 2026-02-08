/**
 * X (Twitter) adapter for the Chat SDK.
 *
 * Uses the @xdevplatform/xdk official TypeScript SDK for API v2 calls.
 * Receives events via Account Activity API webhooks (v1.1 format) and
 * translates them to normalized SDK messages.
 */

import { AdapterRateLimitError, ValidationError } from "@chat-adapter/shared";
import { Client, OAuth1 } from "@xdevplatform/xdk";
import type {
  Adapter,
  AdapterPostableMessage,
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

import { getEmoji, Message, NotImplementedError } from "chat";

import { XFormatConverter } from "./markdown";
import type {
  V1DirectMessageEvent,
  V1FavoriteEvent,
  V1Tweet,
  XAdapterConfig,
  XThreadId,
  XWebhookPayload,
} from "./types";
import { handleCrcChallenge, verifyWebhookSignature } from "./webhook";

export { XFormatConverter } from "./markdown";
// Re-export public types
export type { XAdapterConfig, XThreadId } from "./types";
export { handleCrcChallenge, verifyWebhookSignature } from "./webhook";

export class XAdapter implements Adapter<XThreadId, unknown> {
  readonly name = "x";
  readonly userName: string;

  // biome-ignore lint/suspicious/noExplicitAny: XDK Client type is complex
  private client: any;
  private apiSecret: string;
  private chat: ChatInstance | null = null;
  private logger: Logger;
  private _botUserId: string | null = null;
  private _botScreenName: string | null = null;
  private formatConverter = new XFormatConverter();
  private static CONVERSATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  /** Bot user ID used for mention detection and liking */
  get botUserId(): string | undefined {
    return this._botUserId || undefined;
  }

  constructor(config: XAdapterConfig) {
    this.apiSecret = config.apiSecret;
    this.logger = config.logger;
    this.userName = config.userName || "bot";
    this._botUserId = config.botUserId || null;

    // Create OAuth1 auth and XDK client
    const oauth1 = new OAuth1({
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
      callback: "oob", // Not used for server-to-server; required by SDK
      accessToken: config.accessToken,
      accessTokenSecret: config.accessTokenSecret,
    });

    this.client = new Client({ oauth1 });
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    // Fetch bot identity if not provided
    if (!this._botUserId) {
      try {
        const result = await this.client.users.getMe({
          userfields: ["id", "username", "name"],
        });

        if (result.data) {
          this._botUserId = result.data.id;
          this._botScreenName = result.data.username;
          if (result.data.name) {
            (this as { userName: string }).userName = result.data.name;
          }
        }

        this.logger.info("X auth completed", {
          botUserId: this._botUserId,
          botScreenName: this._botScreenName,
        });
      } catch (error) {
        this.logger.warn("Could not fetch bot user info from X", { error });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Webhook handling
  // ---------------------------------------------------------------------------

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    this.logger.info("X handleWebhook called", {
      method: request.method,
      url: request.url,
    });

    // CRC challenge (GET request)
    if (request.method === "GET") {
      const url = new URL(request.url);
      const crcToken = url.searchParams.get("crc_token");
      const nonce = url.searchParams.get("nonce");

      this.logger.info("X GET request received", {
        hasCrcToken: !!crcToken,
        crcTokenLength: crcToken?.length ?? 0,
        nonce,
        allParams: Object.fromEntries(url.searchParams.entries()),
      });

      if (crcToken) {
        this.logger.info("X CRC challenge: computing HMAC-SHA256 response", {
          crcToken,
          apiSecretLength: this.apiSecret.length,
          apiSecretPrefix: this.apiSecret.slice(0, 4) + "...",
        });

        const response = handleCrcChallenge(crcToken, this.apiSecret);
        const responseBody = await response.clone().json();

        this.logger.info("X CRC challenge: response ready", {
          status: response.status,
          body: responseBody,
        });

        return response;
      }

      this.logger.warn("X GET request missing crc_token, returning 400");
      return new Response("Missing crc_token", { status: 400 });
    }

    // POST request — verify signature and process events
    const body = await request.text();
    const signature = request.headers.get("x-twitter-webhooks-signature");

    this.logger.info("X POST webhook received", {
      bodyLength: body.length,
      hasSignature: !!signature,
    });

    if (!verifyWebhookSignature(body, signature, this.apiSecret)) {
      this.logger.warn("X webhook signature verification failed", {
        signature,
      });
      return new Response("Invalid signature", { status: 401 });
    }

    this.logger.info("X webhook signature verified successfully");

    let payload: XWebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      this.logger.warn("X webhook body is not valid JSON");
      return new Response("Invalid JSON", { status: 400 });
    }

    // Process events (respond 200 immediately, process async)
    this.processWebhookPayload(payload, options);

    return new Response("ok", { status: 200 });
  }

  /**
   * Route webhook events by type.
   */
  private processWebhookPayload(
    payload: XWebhookPayload,
    options?: WebhookOptions
  ): void {
    if (payload.tweet_create_events) {
      for (const tweet of payload.tweet_create_events) {
        this.handleTweetCreate(tweet, options);
      }
    }

    if (payload.direct_message_events) {
      for (const dm of payload.direct_message_events) {
        this.handleDirectMessage(dm, payload.users, options);
      }
    }

    if (payload.favorite_events) {
      for (const fav of payload.favorite_events) {
        this.handleFavorite(fav, options);
      }
    }
  }

  /**
   * Handle a tweet_create_event from the webhook.
   */
  private handleTweetCreate(tweet: V1Tweet, options?: WebhookOptions): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring tweet event");
      return;
    }

    // Skip retweets (they have a retweeted_status)
    if (tweet.retweeted_status) {
      this.logger.debug("Ignoring retweet", { id: tweet.id_str });
      return;
    }

    // Resolve conversation_id asynchronously, then process
    this.chat.processMessage(
      this,
      // We'll compute the real threadId inside the factory
      `x:${tweet.id_str}`, // Placeholder — corrected after conversation_id resolution
      async () => {
        const conversationId = await this.resolveConversationId(
          tweet.id_str,
          tweet.in_reply_to_status_id_str || null
        );
        const threadId = this.encodeThreadId({
          conversationId,
          type: "tweet",
        });
        return this.parseTweetMessage(tweet, threadId);
      },
      options
    );
  }

  /**
   * Handle a direct_message_event from the webhook.
   */
  private handleDirectMessage(
    dm: V1DirectMessageEvent,
    users?: Record<string, import("./types").V1User>,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring DM event");
      return;
    }

    // DM conversation ID is derived from the two participants (sorted)
    const senderId = dm.message_create.sender_id;
    const recipientId = dm.message_create.target.recipient_id;
    const dmConversationId = [senderId, recipientId].sort().join("-");

    const threadId = this.encodeThreadId({
      conversationId: dmConversationId,
      type: "dm",
    });

    const senderUser = users?.[senderId];

    this.chat.processMessage(
      this,
      threadId,
      () => Promise.resolve(this.parseDmMessage(dm, threadId, senderUser)),
      options
    );
  }

  /**
   * Handle a favorite_event (like) from the webhook.
   */
  private handleFavorite(fav: V1FavoriteEvent, options?: WebhookOptions): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring favorite");
      return;
    }

    const tweetId = fav.favorited_status.id_str;
    const isMe =
      this._botUserId !== null && fav.user.id_str === this._botUserId;

    // We need the conversation_id to build the correct thread ID.
    // For simplicity, use the tweet's own ID as a fallback.
    const threadId = `x:${tweetId}`;

    this.chat.processReaction(
      {
        emoji: getEmoji("heart"),
        rawEmoji: "heart",
        added: true,
        user: {
          userId: fav.user.id_str,
          userName: fav.user.screen_name,
          fullName: fav.user.name,
          isBot: false,
          isMe,
        },
        messageId: tweetId,
        threadId,
        raw: fav,
        adapter: this,
      },
      options
    );
  }

  // ---------------------------------------------------------------------------
  // Message parsing
  // ---------------------------------------------------------------------------

  /**
   * Parse a v1.1 tweet into a normalized Message.
   */
  private parseTweetMessage(
    tweet: V1Tweet,
    threadId: string
  ): Message<unknown> {
    const isMe = this.isMessageFromSelf(tweet.user.id_str);

    // Use extended_tweet.full_text for long tweets, fall back to text
    const text = tweet.extended_tweet?.full_text || tweet.text;
    const entities = tweet.extended_tweet?.entities || tweet.entities;

    // Check if this tweet mentions the bot
    const isMention = entities.user_mentions?.some(
      (m) => m.id_str === this._botUserId
    );

    return new Message({
      id: tweet.id_str,
      threadId,
      text: this.formatConverter.extractPlainText(text),
      formatted: this.formatConverter.toAst(text),
      raw: tweet,
      author: {
        userId: tweet.user.id_str,
        userName: tweet.user.screen_name,
        fullName: tweet.user.name,
        isBot: false,
        isMe,
      },
      metadata: {
        dateSent: new Date(tweet.created_at),
        edited: false,
      },
      attachments: [],
      isMention,
    });
  }

  /**
   * Parse a v1.1 DM event into a normalized Message.
   */
  private parseDmMessage(
    dm: V1DirectMessageEvent,
    threadId: string,
    senderUser?: import("./types").V1User
  ): Message<unknown> {
    const senderId = dm.message_create.sender_id;
    const isMe = this.isMessageFromSelf(senderId);

    const text = dm.message_create.message_data.text;

    return new Message({
      id: dm.id,
      threadId,
      text: this.formatConverter.extractPlainText(text),
      formatted: this.formatConverter.toAst(text),
      raw: dm,
      author: {
        userId: senderId,
        userName: senderUser?.screen_name || senderId,
        fullName: senderUser?.name || senderId,
        isBot: false,
        isMe,
      },
      metadata: {
        dateSent: new Date(parseInt(dm.created_timestamp, 10)),
        edited: false,
      },
      attachments: [],
    });
  }

  /**
   * Resolve conversation_id for a v1.1 tweet.
   * V1.1 payloads don't include conversation_id, so for replies
   * we look it up via the v2 API and cache the result.
   */
  private async resolveConversationId(
    tweetIdStr: string,
    inReplyTo: string | null
  ): Promise<string> {
    // Root tweets have themselves as their conversation_id
    if (!inReplyTo) {
      return tweetIdStr;
    }

    const cacheKey = `x:conv:${tweetIdStr}`;

    // Check cache
    if (this.chat) {
      const cached = await this.chat.getState().get<string>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    try {
      // Fetch via v2 API to get conversation_id
      const v2Tweet = await this.client.posts.getById(tweetIdStr, {
        tweetfields: ["conversation_id"],
      });

      const conversationId = v2Tweet.data?.conversation_id ?? inReplyTo;

      // Cache for 24 hours
      if (this.chat) {
        await this.chat
          .getState()
          .set(cacheKey, conversationId, XAdapter.CONVERSATION_CACHE_TTL_MS);
      }

      return conversationId;
    } catch (error) {
      this.logger.warn("Could not resolve conversation_id via v2 API", {
        tweetId: tweetIdStr,
        error,
      });
      // Fall back to the in_reply_to ID
      return inReplyTo;
    }
  }

  // ---------------------------------------------------------------------------
  // Message operations
  // ---------------------------------------------------------------------------

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<unknown>> {
    const decoded = this.decodeThreadId(threadId);
    const text = this.formatConverter.renderPostable(message);

    if (decoded.type === "dm") {
      return this.postDmMessage(decoded.conversationId, text, threadId);
    }

    // Tweet reply — reply to the conversation root
    try {
      this.logger.debug("X API: posts.create (reply)", {
        conversationId: decoded.conversationId,
        textLength: text.length,
      });

      const result = await this.client.posts.create({
        text,
        reply: { in_reply_to_tweet_id: decoded.conversationId },
      });

      const newId = result.data?.id || `post-${Date.now()}`;

      this.logger.debug("X API: posts.create response", { id: newId });

      return {
        id: newId,
        threadId,
        raw: result,
      };
    } catch (error) {
      this.handleXError(error);
    }
  }

  /**
   * Post a DM message.
   * The conversationId for DMs is formatted as "senderId-recipientId" (sorted).
   * We use createByParticipantId to send to the other participant.
   */
  private async postDmMessage(
    dmConversationId: string,
    text: string,
    threadId: string
  ): Promise<RawMessage<unknown>> {
    // DM conversation IDs are "userId1-userId2" (sorted)
    // We need to send to the other participant
    const participants = dmConversationId.split("-");
    const recipientId =
      participants.find((id) => id !== this._botUserId) || participants[0];

    try {
      this.logger.debug("X API: directMessages.createByParticipantId", {
        recipientId,
        textLength: text.length,
      });

      const result = await this.client.directMessages.createByParticipantId(
        recipientId as string,
        { body: { text } }
      );

      const newId = result.data?.dm_event_id || `dm-${Date.now()}`;

      return {
        id: newId,
        threadId,
        raw: result,
      };
    } catch (error) {
      this.handleXError(error);
    }
  }

  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage
  ): Promise<RawMessage<unknown>> {
    throw new NotImplementedError(
      "X API does not support editing tweets",
      "editMessage"
    );
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const decoded = this.decodeThreadId(threadId);

    try {
      if (decoded.type === "dm") {
        this.logger.debug("X API: directMessages.deleteEvents", { messageId });
        await this.client.directMessages.deleteEvents(messageId);
      } else {
        this.logger.debug("X API: posts.delete", { messageId });
        await this.client.posts.delete(messageId);
      }
    } catch (error) {
      this.handleXError(error);
    }
  }

  async addReaction(
    _threadId: string,
    messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    // X only supports "like" as a reaction — map any emoji to like
    if (!this._botUserId) {
      this.logger.warn("Cannot like: bot user ID not known");
      return;
    }

    try {
      this.logger.debug("X API: users.likePost", {
        userId: this._botUserId,
        tweetId: messageId,
      });

      await this.client.users.likePost(this._botUserId, {
        body: { tweet_id: messageId },
      });
    } catch (error) {
      this.handleXError(error);
    }
  }

  async removeReaction(
    _threadId: string,
    messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    if (!this._botUserId) {
      this.logger.warn("Cannot unlike: bot user ID not known");
      return;
    }

    try {
      this.logger.debug("X API: users.unlikePost", {
        userId: this._botUserId,
        tweetId: messageId,
      });

      await this.client.users.unlikePost(this._botUserId, messageId);
    } catch (error) {
      this.handleXError(error);
    }
  }

  async startTyping(_threadId: string): Promise<void> {
    // No-op for tweets; X doesn't expose a typing indicator API for bots
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<unknown>> {
    const decoded = this.decodeThreadId(threadId);
    const limit = options.limit || 100;

    if (decoded.type === "dm") {
      // For DMs, we'd need to fetch DM events for the conversation
      // This is a simplified implementation
      this.logger.debug("X API: fetchMessages for DM not fully supported yet");
      return { messages: [] };
    }

    // Use recent search with conversation_id query
    try {
      this.logger.debug("X API: posts.searchRecent", {
        conversationId: decoded.conversationId,
        limit,
      });

      const searchOptions: Record<string, unknown> = {
        maxResults: Math.min(limit, 100), // API max is 100 per page
        tweetfields: [
          "conversation_id",
          "author_id",
          "created_at",
          "in_reply_to_user_id",
        ],
        expansions: ["author_id"],
        userfields: ["username", "name"],
      };

      if (options.cursor) {
        searchOptions.nextToken = options.cursor;
      }

      const result = await this.client.posts.searchRecent(
        `conversation_id:${decoded.conversationId}`,
        searchOptions
      );

      const tweets = result.data || [];
      const includes = result.includes || {};
      const users = includes.users || [];

      // Build a user lookup map
      const userMap = new Map<string, { username: string; name: string }>();
      for (const user of users) {
        if (user.id) {
          userMap.set(user.id, {
            username: user.username || user.id,
            name: user.name || user.username || user.id,
          });
        }
      }

      const messages = tweets.map(
        // biome-ignore lint/suspicious/noExplicitAny: v2 tweet response types
        (tweet: any) => {
          const author = userMap.get(tweet.author_id) || {
            username: tweet.author_id,
            name: tweet.author_id,
          };
          const isMe = this.isMessageFromSelf(tweet.author_id);

          return new Message({
            id: tweet.id,
            threadId,
            text: this.formatConverter.extractPlainText(tweet.text || ""),
            formatted: this.formatConverter.toAst(tweet.text || ""),
            raw: tweet,
            author: {
              userId: tweet.author_id || "unknown",
              userName: author.username,
              fullName: author.name,
              isBot: false,
              isMe,
            },
            metadata: {
              dateSent: tweet.created_at
                ? new Date(tweet.created_at)
                : new Date(),
              edited: false,
            },
            attachments: [],
          });
        }
      );

      return {
        messages,
        nextCursor: result.meta?.next_token || undefined,
      };
    } catch (error) {
      this.handleXError(error);
    }
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const decoded = this.decodeThreadId(threadId);

    if (decoded.type === "dm") {
      return {
        id: threadId,
        channelId: decoded.conversationId,
        channelName: "DM",
        metadata: { type: "dm" },
      };
    }

    try {
      this.logger.debug("X API: posts.getById (thread root)", {
        id: decoded.conversationId,
      });

      const result = await this.client.posts.getById(decoded.conversationId, {
        tweetfields: ["author_id", "created_at", "conversation_id"],
        expansions: ["author_id"],
        userfields: ["username", "name"],
      });

      const author = result.includes?.users?.[0];
      const channelName = author?.name
        ? `${author.name}'s thread`
        : `Thread ${decoded.conversationId}`;

      return {
        id: threadId,
        channelId: decoded.conversationId,
        channelName,
        metadata: {
          type: "tweet",
          rootTweet: result.data,
          author,
        },
      };
    } catch (error) {
      this.handleXError(error);
    }
  }

  async fetchMessage(
    threadId: string,
    messageId: string
  ): Promise<Message<unknown> | null> {
    try {
      const result = await this.client.posts.getById(messageId, {
        tweetfields: [
          "conversation_id",
          "author_id",
          "created_at",
          "in_reply_to_user_id",
        ],
        expansions: ["author_id"],
        userfields: ["username", "name"],
      });

      if (!result.data) return null;

      const tweet = result.data;
      const author = result.includes?.users?.[0];
      const isMe = this.isMessageFromSelf(tweet.author_id);

      return new Message({
        id: tweet.id,
        threadId,
        text: this.formatConverter.extractPlainText(tweet.text || ""),
        formatted: this.formatConverter.toAst(tweet.text || ""),
        raw: tweet,
        author: {
          userId: tweet.author_id || "unknown",
          userName: author?.username || tweet.author_id || "unknown",
          fullName: author?.name || tweet.author_id || "unknown",
          isBot: false,
          isMe,
        },
        metadata: {
          dateSent: tweet.created_at ? new Date(tweet.created_at) : new Date(),
          edited: false,
        },
        attachments: [],
      });
    } catch (error) {
      this.logger.warn("Could not fetch message", { messageId, error });
      return null;
    }
  }

  /**
   * Open a direct message conversation with a user.
   * Sends an initial message to establish the DM thread.
   */
  async openDM(userId: string): Promise<string> {
    try {
      this.logger.debug(
        "X API: directMessages.createByParticipantId (openDM)",
        {
          participantId: userId,
        }
      );

      // Send initial message to open the conversation
      const result = await this.client.directMessages.createByParticipantId(
        userId,
        { body: { text: "👋" } }
      );

      const dmConversationId = result.data?.dm_conversation_id;

      if (dmConversationId) {
        return this.encodeThreadId({
          conversationId: dmConversationId,
          type: "dm",
        });
      }

      // Fallback: construct from user IDs
      const botId = this._botUserId || "0";
      const conversationId = [botId, userId].sort().join("-");
      return this.encodeThreadId({ conversationId, type: "dm" });
    } catch (error) {
      this.handleXError(error);
    }
  }

  /**
   * Check if a thread is a direct message conversation.
   */
  isDM(threadId: string): boolean {
    return threadId.startsWith("x:dm:");
  }

  // ---------------------------------------------------------------------------
  // Thread ID encoding/decoding
  // ---------------------------------------------------------------------------

  encodeThreadId(platformData: XThreadId): string {
    if (platformData.type === "dm") {
      return `x:dm:${platformData.conversationId}`;
    }
    return `x:${platformData.conversationId}`;
  }

  decodeThreadId(threadId: string): XThreadId {
    if (threadId.startsWith("x:dm:")) {
      return {
        conversationId: threadId.slice(5), // after "x:dm:"
        type: "dm",
      };
    }
    if (threadId.startsWith("x:")) {
      return {
        conversationId: threadId.slice(2), // after "x:"
        type: "tweet",
      };
    }
    throw new ValidationError("x", `Invalid X thread ID: ${threadId}`);
  }

  // ---------------------------------------------------------------------------
  // Interface helpers
  // ---------------------------------------------------------------------------

  parseMessage(raw: V1Tweet): Message<unknown> {
    const threadId = `x:${raw.id_str}`;
    return this.parseTweetMessage(raw, threadId);
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private isMessageFromSelf(userId: string): boolean {
    return this._botUserId !== null && userId === this._botUserId;
  }

  private handleXError(error: unknown): never {
    // Check for rate limiting
    const apiError = error as { status?: number; data?: { title?: string } };
    if (apiError.status === 429) {
      throw new AdapterRateLimitError("x");
    }
    throw error;
  }
}

/**
 * Create a new X adapter instance.
 */
export function createXAdapter(config: XAdapterConfig): XAdapter {
  return new XAdapter(config);
}
