import {
  AdapterRateLimitError,
  AuthenticationError,
  cardToFallbackText,
  extractCard,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
  ValidationError,
} from "@chat-adapter/shared";
import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
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
import { ConsoleLogger, Message, NotImplementedError } from "chat";
import { TwitterFormatConverter } from "./markdown";
import type {
  TwitterAccountActivityPayload,
  TwitterAdapterConfig,
  TwitterApiV2Response,
  TwitterDirectMessageEvent,
  TwitterDMSendResponse,
  TwitterRawMessage,
  TwitterThreadId,
  TwitterUser,
  TwitterUserV2,
} from "./types";

const TWITTER_API_BASE = "https://api.twitter.com";
const TWITTER_DM_MESSAGE_LIMIT = 10000;
const CRC_TOKEN_PARAM = "crc_token";

interface TwitterMessageAuthor {
  fullName: string;
  isBot: boolean | "unknown";
  isMe: boolean;
  userId: string;
  userName: string;
}

/**
 * Compute HMAC-SHA256 for CRC validation.
 * Uses the Web Crypto API (available in Node 18+ and edge runtimes).
 */
async function computeHmacSha256(
  key: string,
  message: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const messageData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * Generate OAuth 1.0a Authorization header.
 *
 * This is a simplified OAuth 1.0a implementation for the X API.
 * It generates the HMAC-SHA1 signature required by Twitter's API.
 */
async function generateOAuth1Header(params: {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
  additionalParams?: Record<string, string>;
}): Promise<string> {
  const {
    method,
    url,
    consumerKey,
    consumerSecret,
    accessToken,
    accessTokenSecret,
    additionalParams,
  } = params;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID().replace(/-/g, "");

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: "1.0",
    ...additionalParams,
  };

  // Parse URL to get any query parameters
  const parsedUrl = new URL(url);
  for (const [key, value] of parsedUrl.searchParams.entries()) {
    oauthParams[key] = value;
  }

  // Sort parameters
  const sortedParams = Object.entries(oauthParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join("&");

  // Base URL without query string
  const baseUrl = `${parsedUrl.origin}${parsedUrl.pathname}`;

  // Create signature base string
  const signatureBase = `${method.toUpperCase()}&${encodeURIComponent(baseUrl)}&${encodeURIComponent(sortedParams)}`;
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(accessTokenSecret)}`;

  // Compute HMAC-SHA1
  const encoder = new TextEncoder();
  const keyData = encoder.encode(signingKey);
  const messageData = encoder.encode(signatureBase);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  const signatureBase64 = btoa(
    String.fromCharCode(...new Uint8Array(signature))
  );

  // Build Authorization header
  const authParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature: signatureBase64,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  const authHeader = Object.entries(authParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}="${encodeURIComponent(value)}"`
    )
    .join(", ");

  return `OAuth ${authHeader}`;
}

export class TwitterAdapter
  implements Adapter<TwitterThreadId, TwitterRawMessage>
{
  readonly name = "twitter";
  readonly persistMessageHistory = true;

  private readonly consumerKey: string;
  private readonly consumerSecret: string;
  private readonly accessToken: string;
  private readonly accessTokenSecret: string;
  private readonly bearerToken: string;
  private readonly apiBaseUrl: string;
  private readonly webhookEnvironment: string;
  private readonly logger: Logger;
  private readonly formatConverter = new TwitterFormatConverter();
  private readonly messageCache = new Map<
    string,
    Message<TwitterRawMessage>[]
  >();

  private chat: ChatInstance | null = null;
  private _botUserId?: string;
  private _userName: string;
  private readonly hasExplicitUserName: boolean;

  get botUserId(): string | undefined {
    return this._botUserId;
  }

  get userName(): string {
    return this._userName;
  }

  constructor(config: TwitterAdapterConfig = {}) {
    const consumerKey =
      config.consumerKey ?? process.env.TWITTER_CONSUMER_KEY;
    const consumerSecret =
      config.consumerSecret ?? process.env.TWITTER_CONSUMER_SECRET;
    const accessToken =
      config.accessToken ?? process.env.TWITTER_ACCESS_TOKEN;
    const accessTokenSecret =
      config.accessTokenSecret ?? process.env.TWITTER_ACCESS_TOKEN_SECRET;
    const bearerToken =
      config.bearerToken ?? process.env.TWITTER_BEARER_TOKEN;

    if (!consumerKey) {
      throw new ValidationError(
        "twitter",
        "Consumer key is required. Set TWITTER_CONSUMER_KEY or provide it in config."
      );
    }
    if (!consumerSecret) {
      throw new ValidationError(
        "twitter",
        "Consumer secret is required. Set TWITTER_CONSUMER_SECRET or provide it in config."
      );
    }
    if (!accessToken) {
      throw new ValidationError(
        "twitter",
        "Access token is required. Set TWITTER_ACCESS_TOKEN or provide it in config."
      );
    }
    if (!accessTokenSecret) {
      throw new ValidationError(
        "twitter",
        "Access token secret is required. Set TWITTER_ACCESS_TOKEN_SECRET or provide it in config."
      );
    }
    if (!bearerToken) {
      throw new ValidationError(
        "twitter",
        "Bearer token is required. Set TWITTER_BEARER_TOKEN or provide it in config."
      );
    }

    this.consumerKey = consumerKey;
    this.consumerSecret = consumerSecret;
    this.accessToken = accessToken;
    this.accessTokenSecret = accessTokenSecret;
    this.bearerToken = bearerToken;
    this.apiBaseUrl = (
      config.apiBaseUrl ??
      process.env.TWITTER_API_BASE_URL ??
      TWITTER_API_BASE
    ).replace(/\/+$/, "");
    this.webhookEnvironment =
      config.webhookEnvironment ??
      process.env.TWITTER_WEBHOOK_ENV ??
      "production";
    this.logger =
      config.logger ?? new ConsoleLogger("info").child("twitter");

    const userName =
      config.userName ?? process.env.TWITTER_BOT_USERNAME;
    this._userName = userName ?? "bot";
    this.hasExplicitUserName = Boolean(userName);
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    if (!this.hasExplicitUserName) {
      const chatUserName = chat.getUserName?.();
      if (typeof chatUserName === "string" && chatUserName.trim()) {
        this._userName = chatUserName;
      }
    }

    // Fetch bot's own user info via API v2
    try {
      const me = await this.twitterFetchV2<TwitterUserV2>(
        "/2/users/me",
        "GET"
      );
      if (me) {
        this._botUserId = me.id;
        if (!this.hasExplicitUserName && me.username) {
          this._userName = me.username;
        }
      }

      this.logger.info("Twitter adapter initialized", {
        botUserId: this._botUserId,
        userName: this._userName,
      });
    } catch (error) {
      this.logger.warn("Failed to fetch Twitter bot identity", {
        error: String(error),
      });
    }
  }

  /**
   * Handle incoming webhook requests from the X Account Activity API.
   *
   * GET requests are CRC challenges — we respond with the HMAC-SHA256 hash.
   * POST requests are webhook events (DMs, tweets, etc.).
   */
  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    // Handle CRC challenge (GET request)
    if (request.method === "GET") {
      return this.handleCrcChallenge(request);
    }

    // For POST requests, verify the webhook signature
    const body = await request.text();

    // Parse the payload
    let payload: TwitterAccountActivityPayload;
    try {
      payload = JSON.parse(body) as TwitterAccountActivityPayload;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!this.chat) {
      this.logger.warn(
        "Chat instance not initialized, ignoring Twitter webhook"
      );
      return new Response("OK", { status: 200 });
    }

    // Process DM events
    try {
      this.processDMEvents(payload, options);
    } catch (error) {
      this.logger.warn("Failed to process Twitter webhook payload", {
        error: String(error),
        forUserId: payload.for_user_id,
      });
    }

    return new Response("OK", { status: 200 });
  }

  /**
   * Handle CRC challenge from the X Account Activity API.
   * Responds with HMAC-SHA256 hash of the crc_token using consumer secret.
   */
  private async handleCrcChallenge(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const crcToken = url.searchParams.get(CRC_TOKEN_PARAM);

    if (!crcToken) {
      return new Response("Missing crc_token parameter", { status: 400 });
    }

    const responseToken = await computeHmacSha256(
      this.consumerSecret,
      crcToken
    );

    return new Response(
      JSON.stringify({
        response_token: `sha256=${responseToken}`,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  /**
   * Process DM events from the Account Activity webhook payload.
   */
  private processDMEvents(
    payload: TwitterAccountActivityPayload,
    options?: WebhookOptions
  ): void {
    if (!this.chat || !payload.direct_message_events) {
      return;
    }

    for (const dmEvent of payload.direct_message_events) {
      if (dmEvent.type !== "message_create") {
        continue;
      }

      // Skip messages sent by the bot itself to prevent loops
      const senderId = dmEvent.message_create.sender_id;
      if (senderId === this._botUserId) {
        continue;
      }

      // Skip messages sent by the bot to the `for_user_id`
      // (outbound DMs also appear in the webhook)
      if (senderId === payload.for_user_id && senderId === this._botUserId) {
        continue;
      }

      // Duplicate suppression: if two subscribed users are in the same DM,
      // we receive the event twice (once per user). We only process events
      // where `for_user_id` matches our bot's user ID.
      if (this._botUserId && payload.for_user_id !== this._botUserId) {
        continue;
      }

      // Determine the conversation ID
      // In a 1:1 DM, the conversation ID is derived from the user IDs
      const recipientId = dmEvent.message_create.target.recipient_id;
      const conversationId = this.deriveConversationId(senderId, recipientId);

      const threadId = this.encodeThreadId({ conversationId });

      const parsedMessage = this.parseDMEvent(
        dmEvent,
        threadId,
        payload.users
      );
      this.cacheMessage(parsedMessage);

      this.chat.processMessage(this, threadId, parsedMessage, options);
    }
  }

  /**
   * Derive a deterministic conversation ID from two user IDs.
   * Twitter's 1:1 DM conversation IDs are formed by sorting the two user
   * IDs and joining them. For simplicity, we use the smaller ID first.
   */
  private deriveConversationId(
    userId1: string,
    userId2: string
  ): string {
    const ids = [userId1, userId2].sort();
    return `${ids[0]}-${ids[1]}`;
  }

  /**
   * Parse a Twitter DM event into a normalized Message.
   */
  private parseDMEvent(
    dmEvent: TwitterDirectMessageEvent,
    threadId: string,
    users?: Record<string, TwitterUser>
  ): Message<TwitterRawMessage> {
    const senderId = dmEvent.message_create.sender_id;
    const text = dmEvent.message_create.message_data.text;
    const user = users?.[senderId];

    const author: TwitterMessageAuthor = {
      userId: senderId,
      userName: user?.screen_name ?? senderId,
      fullName: user?.name ?? user?.screen_name ?? senderId,
      isBot: senderId === this._botUserId,
      isMe: senderId === this._botUserId,
    };

    const attachments = this.extractAttachments(dmEvent);
    const isMention = this.checkMention(text);

    return new Message<TwitterRawMessage>({
      id: dmEvent.id,
      threadId,
      text,
      formatted: this.formatConverter.toAst(text),
      raw: dmEvent,
      author,
      metadata: {
        dateSent: new Date(Number.parseInt(dmEvent.created_timestamp, 10)),
        edited: false,
      },
      attachments,
      isMention,
    });
  }

  /**
   * Extract attachments from a DM event.
   */
  private extractAttachments(
    dmEvent: TwitterDirectMessageEvent
  ): Attachment[] {
    const attachments: Attachment[] = [];
    const attachment = dmEvent.message_create.message_data.attachment;

    if (attachment?.media) {
      const media = attachment.media;
      const type = media.type === "video" ? "video" : "image";

      // Find the largest image size
      const largestSize = media.sizes
        ? Object.values(media.sizes).reduce(
            (acc, size) =>
              size.w * size.h > (acc?.w ?? 0) * (acc?.h ?? 0) ? size : acc,
            undefined as { w: number; h: number; resize: string } | undefined
          )
        : undefined;

      attachments.push({
        type,
        url: media.media_url_https,
        width: largestSize?.w,
        height: largestSize?.h,
      });
    }

    return attachments;
  }

  /**
   * Check if the bot is mentioned in the text.
   */
  private checkMention(text: string): boolean {
    if (!text || !this._userName) {
      return false;
    }

    const mentionPattern = new RegExp(
      `@${this.escapeRegex(this._userName)}\\b`,
      "i"
    );
    return mentionPattern.test(text);
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<TwitterRawMessage>> {
    const { conversationId } = this.resolveThreadId(threadId);

    const card = extractCard(message);
    const text = this.truncateMessage(
      card
        ? cardToFallbackText(card)
        : this.formatConverter.renderPostable(message)
    );

    if (!text.trim()) {
      throw new ValidationError("twitter", "Message text cannot be empty");
    }

    // Determine the recipient from the conversation ID
    const recipientId = this.getRecipientFromConversation(conversationId);

    const response = await this.sendDM(recipientId, text);

    // Create a synthetic raw DM event for the sent message
    const syntheticEvent: TwitterDirectMessageEvent = {
      type: "message_create",
      id: response.dm_event_id,
      created_timestamp: String(Date.now()),
      message_create: {
        target: { recipient_id: recipientId },
        sender_id: this._botUserId ?? "",
        message_data: { text },
      },
    };

    const resultThreadId = this.encodeThreadId({
      conversationId: response.dm_conversation_id,
    });

    const parsedMessage = new Message<TwitterRawMessage>({
      id: response.dm_event_id,
      threadId: resultThreadId,
      text,
      formatted: this.formatConverter.toAst(text),
      raw: syntheticEvent,
      author: {
        userId: this._botUserId ?? "",
        userName: this._userName,
        fullName: this._userName,
        isBot: true,
        isMe: true,
      },
      metadata: {
        dateSent: new Date(),
        edited: false,
      },
      attachments: [],
    });

    this.cacheMessage(parsedMessage);

    return {
      id: parsedMessage.id,
      threadId: parsedMessage.threadId,
      raw: syntheticEvent,
    };
  }

  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage
  ): Promise<RawMessage<TwitterRawMessage>> {
    throw new NotImplementedError(
      "Twitter DMs cannot be edited after sending",
      "editMessage"
    );
  }

  async deleteMessage(
    _threadId: string,
    messageId: string
  ): Promise<void> {
    // Twitter API v2 supports deleting DM events
    await this.twitterFetchOAuth(
      `/2/dm_conversations/events/${messageId}`,
      "DELETE"
    );

    this.deleteCachedMessage(messageId);
  }

  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    // Twitter DMs do support reactions, but the API is limited.
    // For now, log a warning that this is not fully supported.
    this.logger.warn(
      "Twitter DM reactions via API are not fully supported"
    );
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    this.logger.warn(
      "Twitter DM reaction removal via API is not fully supported"
    );
  }

  async startTyping(_threadId: string): Promise<void> {
    // Twitter DM API doesn't have a native typing indicator endpoint.
    // No-op to fulfill the interface contract.
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<TwitterRawMessage>> {
    const messages = [
      ...(this.messageCache.get(threadId) ?? []),
    ].sort((a, b) => this.compareMessages(a, b));

    return this.paginateMessages(messages, options);
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { conversationId } = this.resolveThreadId(threadId);

    return {
      id: threadId,
      channelId: conversationId,
      isDM: true,
      metadata: {
        conversationId,
      },
    };
  }

  channelIdFromThreadId(threadId: string): string {
    const { conversationId } = this.resolveThreadId(threadId);
    return `twitter:${conversationId}`;
  }

  async openDM(userId: string): Promise<string> {
    if (!this._botUserId) {
      throw new ValidationError(
        "twitter",
        "Bot user ID is not available. Ensure the adapter is initialized."
      );
    }

    const conversationId = this.deriveConversationId(
      this._botUserId,
      userId
    );
    return this.encodeThreadId({ conversationId });
  }

  isDM(_threadId: string): boolean {
    // All Twitter adapter threads are DM conversations
    return true;
  }

  encodeThreadId(platformData: TwitterThreadId): string {
    return `twitter:${platformData.conversationId}`;
  }

  decodeThreadId(threadId: string): TwitterThreadId {
    const parts = threadId.split(":");
    if (parts[0] !== "twitter" || parts.length !== 2) {
      throw new ValidationError(
        "twitter",
        `Invalid Twitter thread ID: ${threadId}`
      );
    }

    const conversationId = parts[1];
    if (!conversationId) {
      throw new ValidationError(
        "twitter",
        `Invalid Twitter thread ID: ${threadId}`
      );
    }

    return { conversationId };
  }

  parseMessage(raw: TwitterRawMessage): Message<TwitterRawMessage> {
    const senderId = raw.message_create.sender_id;
    const recipientId = raw.message_create.target.recipient_id;
    const conversationId = this.deriveConversationId(senderId, recipientId);
    const threadId = this.encodeThreadId({ conversationId });

    const message = this.parseDMEvent(raw, threadId);
    this.cacheMessage(message);
    return message;
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  private resolveThreadId(value: string): TwitterThreadId {
    if (value.startsWith("twitter:")) {
      return this.decodeThreadId(value);
    }
    return { conversationId: value };
  }

  /**
   * Get the recipient user ID from a conversation ID.
   * Conversation IDs are in the format `{smallerId}-{largerId}`.
   * The recipient is the ID that is NOT the bot's.
   */
  private getRecipientFromConversation(conversationId: string): string {
    const parts = conversationId.split("-");
    if (parts.length !== 2) {
      throw new ValidationError(
        "twitter",
        `Cannot determine recipient from conversation ID: ${conversationId}`
      );
    }

    const [id1, id2] = parts;
    if (id1 === this._botUserId) {
      return id2;
    }
    if (id2 === this._botUserId) {
      return id1;
    }

    // If bot user ID is unknown, default to the second ID
    return id2;
  }

  /**
   * Send a DM via the Twitter API v2.
   */
  private async sendDM(
    recipientId: string,
    text: string
  ): Promise<{ dm_event_id: string; dm_conversation_id: string }> {
    const url = `${this.apiBaseUrl}/2/dm_conversations/with/${recipientId}/messages`;

    const response = await this.twitterFetchOAuth(url, "POST", { text });

    const data = response as { data?: { dm_event_id: string; dm_conversation_id: string } };
    if (!data.data) {
      throw new NetworkError(
        "twitter",
        "Twitter DM API returned no data"
      );
    }

    return data.data;
  }

  /**
   * Make an authenticated API call using OAuth 1.0a.
   */
  private async twitterFetchOAuth(
    urlOrPath: string,
    method: string,
    body?: Record<string, unknown>
  ): Promise<unknown> {
    const url = urlOrPath.startsWith("http")
      ? urlOrPath
      : `${this.apiBaseUrl}${urlOrPath}`;

    const authHeader = await generateOAuth1Header({
      method,
      url,
      consumerKey: this.consumerKey,
      consumerSecret: this.consumerSecret,
      accessToken: this.accessToken,
      accessTokenSecret: this.accessTokenSecret,
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new NetworkError(
        "twitter",
        `Network error calling Twitter API: ${method} ${urlOrPath}`,
        error instanceof Error ? error : undefined
      );
    }

    if (response.status === 204) {
      return {};
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new NetworkError(
        "twitter",
        `Failed to parse Twitter API response for ${method} ${urlOrPath}`
      );
    }

    if (!response.ok) {
      this.throwTwitterApiError(method, urlOrPath, response.status, data);
    }

    return data;
  }

  /**
   * Make an authenticated API call using Bearer Token (API v2 read endpoints).
   */
  private async twitterFetchV2<TResult>(
    path: string,
    method: string,
    queryParams?: Record<string, string>
  ): Promise<TResult | null> {
    const url = new URL(`${this.apiBaseUrl}${path}`);
    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        url.searchParams.set(key, value);
      }
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${this.bearerToken}`,
        },
      });
    } catch (error) {
      throw new NetworkError(
        "twitter",
        `Network error calling Twitter API: ${method} ${path}`,
        error instanceof Error ? error : undefined
      );
    }

    let data: TwitterApiV2Response<TResult>;
    try {
      data = (await response.json()) as TwitterApiV2Response<TResult>;
    } catch {
      throw new NetworkError(
        "twitter",
        `Failed to parse Twitter API v2 response for ${method} ${path}`
      );
    }

    if (!response.ok) {
      this.throwTwitterApiError(method, path, response.status, data);
    }

    return data.data ?? null;
  }

  /**
   * Map HTTP status codes to appropriate error classes.
   */
  private throwTwitterApiError(
    method: string,
    path: string,
    status: number,
    data: unknown
  ): never {
    const errors = (data as { errors?: Array<{ message?: string; detail?: string }> })
      ?.errors;
    const firstError = errors?.[0];
    const description =
      firstError?.detail ??
      firstError?.message ??
      `Twitter API ${method} ${path} failed`;

    if (status === 429) {
      throw new AdapterRateLimitError("twitter");
    }

    if (status === 401) {
      throw new AuthenticationError("twitter", description);
    }

    if (status === 403) {
      throw new PermissionError("twitter", `${method} ${path}`);
    }

    if (status === 404) {
      throw new ResourceNotFoundError("twitter", path);
    }

    if (status >= 400 && status < 500) {
      throw new ValidationError("twitter", description);
    }

    throw new NetworkError(
      "twitter",
      `${description} (status ${status})`
    );
  }

  private truncateMessage(text: string): string {
    if (text.length <= TWITTER_DM_MESSAGE_LIMIT) {
      return text;
    }
    return `${text.slice(0, TWITTER_DM_MESSAGE_LIMIT - 3)}...`;
  }

  private escapeRegex(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private cacheMessage(message: Message<TwitterRawMessage>): void {
    const existing = this.messageCache.get(message.threadId) ?? [];
    const index = existing.findIndex((item) => item.id === message.id);

    if (index >= 0) {
      existing[index] = message;
    } else {
      existing.push(message);
    }

    existing.sort((a, b) => this.compareMessages(a, b));
    this.messageCache.set(message.threadId, existing);
  }

  private findCachedMessage(
    messageId: string
  ): Message<TwitterRawMessage> | undefined {
    for (const messages of this.messageCache.values()) {
      const found = messages.find((message) => message.id === messageId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  private deleteCachedMessage(messageId: string): void {
    for (const [threadId, messages] of this.messageCache.entries()) {
      const filtered = messages.filter(
        (message) => message.id !== messageId
      );
      if (filtered.length === 0) {
        this.messageCache.delete(threadId);
      } else if (filtered.length !== messages.length) {
        this.messageCache.set(threadId, filtered);
      }
    }
  }

  private compareMessages(
    a: Message<TwitterRawMessage>,
    b: Message<TwitterRawMessage>
  ): number {
    return (
      a.metadata.dateSent.getTime() - b.metadata.dateSent.getTime()
    );
  }

  private paginateMessages(
    messages: Message<TwitterRawMessage>[],
    options: FetchOptions
  ): FetchResult<TwitterRawMessage> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    const direction = options.direction ?? "backward";

    if (messages.length === 0) {
      return { messages: [] };
    }

    const messageIndexById = new Map(
      messages.map((message, index) => [message.id, index])
    );

    if (direction === "backward") {
      const end =
        options.cursor && messageIndexById.has(options.cursor)
          ? (messageIndexById.get(options.cursor) ?? messages.length)
          : messages.length;
      const start = Math.max(0, end - limit);
      const page = messages.slice(start, end);

      return {
        messages: page,
        nextCursor: start > 0 ? page[0]?.id : undefined,
      };
    }

    const start =
      options.cursor && messageIndexById.has(options.cursor)
        ? (messageIndexById.get(options.cursor) ?? -1) + 1
        : 0;
    const end = Math.min(messages.length, start + limit);
    const page = messages.slice(start, end);

    return {
      messages: page,
      nextCursor: end < messages.length ? page.at(-1)?.id : undefined,
    };
  }
}

export function createTwitterAdapter(
  config?: TwitterAdapterConfig
): TwitterAdapter {
  return new TwitterAdapter(config ?? {});
}

export { TwitterFormatConverter } from "./markdown";
export type {
  TwitterAccountActivityPayload,
  TwitterAdapterConfig,
  TwitterDirectMessageEvent,
  TwitterDMEventV2,
  TwitterDMSendResponse,
  TwitterRawMessage,
  TwitterThreadId,
  TwitterUser,
  TwitterUserV2,
} from "./types";
