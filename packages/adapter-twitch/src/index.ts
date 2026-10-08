import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  AdapterRateLimitError,
  AuthenticationError,
  decodeKey,
  decryptToken,
  type EncryptedTokenData,
  encryptToken,
  extractCard,
  extractFiles,
  extractPostableAttachments,
  isEncryptedTokenData,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
  ValidationError,
} from "@chat-adapter/shared";
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
  StateAdapter,
  StreamChunk,
  StreamOptions,
  ThreadInfo,
  UserInfo,
  WebhookOptions,
} from "chat";
import { ConsoleLogger, convertEmojiPlaceholders, Message } from "chat";
import { cardToTwitchText } from "./cards";
import { TwitchFormatConverter, toSingleLine } from "./markdown";
import type {
  TwitchAccessToken,
  TwitchAdapterConfig,
  TwitchApiError,
  TwitchApiResponse,
  TwitchChatMessageEvent,
  TwitchChatReply,
  TwitchEventSubPayload,
  TwitchEventSubSubscription,
  TwitchOauthTokenResult,
  TwitchRawMessage,
  TwitchSendChatMessageResult,
  TwitchStoredOauthToken,
  TwitchThreadId,
  TwitchUser,
  TwitchWhisperEvent,
} from "./types";

const DEFAULT_API_BASE_URL = "https://api.twitch.tv/helix";
const DEFAULT_AUTH_BASE_URL = "https://id.twitch.tv/oauth2";

const HEADER_MESSAGE_ID = "twitch-eventsub-message-id";
const HEADER_MESSAGE_TIMESTAMP = "twitch-eventsub-message-timestamp";
const HEADER_MESSAGE_SIGNATURE = "twitch-eventsub-message-signature";
const HEADER_MESSAGE_TYPE = "twitch-eventsub-message-type";
const SIGNATURE_PREFIX = "sha256=";

const MESSAGE_TYPE_NOTIFICATION = "notification";
const MESSAGE_TYPE_VERIFICATION = "webhook_callback_verification";
const MESSAGE_TYPE_REVOCATION = "revocation";

const SUBSCRIPTION_CHAT_MESSAGE = "channel.chat.message";
const SUBSCRIPTION_WHISPER_MESSAGE = "user.whisper.message";

/** Twitch recommends rejecting notifications older than 10 minutes. */
const MAX_MESSAGE_AGE_MS = 10 * 60 * 1000;
/** Send Chat Message accepts at most 500 characters. */
const CHAT_MESSAGE_LIMIT = 500;
/** Send Whisper accepts at most 10,000 characters (500 to first-time recipients). */
const WHISPER_MESSAGE_LIMIT = 10_000;
const WEBHOOK_SECRET_MIN_LENGTH = 10;
const WEBHOOK_SECRET_MAX_LENGTH = 100;
/** Refresh cached tokens this long before they expire. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const DEFAULT_USER_TOKEN_LIFETIME_S = 14_400;
/** Per-thread cap on cached messages; busy chat rooms would otherwise grow unbounded. */
const MESSAGE_CACHE_LIMIT = 200;
const WHISPER_SEGMENT = "whisper";
const FRACTIONAL_SECONDS = /\.(\d{3})\d+/;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

interface ManagedToken extends CachedToken {
  refreshToken: string;
}

type TokenKind = "app" | "user";

interface HelixRequest {
  body?: Record<string, unknown>;
  method: "DELETE" | "GET" | "POST";
  query?: Record<string, string>;
}

export class TwitchAdapter
  implements Adapter<TwitchThreadId, TwitchRawMessage>
{
  readonly name = "twitch";
  readonly lockScope = "channel" as const;
  readonly persistThreadHistory = true;

  protected readonly apiBaseUrl: string;
  protected readonly authBaseUrl: string;
  protected readonly clientId: string;
  protected readonly clientSecret: string;
  protected readonly webhookSecret: string;
  protected readonly userAccessToken?: TwitchAccessToken;
  protected readonly refreshToken?: string;
  protected readonly encryptionKey: Buffer | undefined;
  protected readonly logger: Logger;
  protected readonly formatConverter = new TwitchFormatConverter();

  protected chat: ChatInstance | null = null;
  protected _botUserId?: string;
  protected _userName: string;
  protected readonly hasExplicitUserName: boolean;

  private readonly messageCache = new Map<
    string,
    Message<TwitchRawMessage>[]
  >();

  private appToken: CachedToken | null = null;
  private appTokenPromise: Promise<string> | null = null;
  private managedToken: ManagedToken | null = null;
  private refreshPromise: Promise<string> | null = null;
  private storedTokenLoaded = false;

  get botUserId(): string | undefined {
    return this._botUserId;
  }

  get userName(): string {
    return this._userName;
  }

  constructor(
    config: TwitchAdapterConfig & {
      clientId: string;
      clientSecret: string;
      logger: Logger;
      webhookSecret: string;
    }
  ) {
    if (!(config.userId || config.userName)) {
      throw new ValidationError(
        "twitch",
        "The bot account is required. Provide userId or userName."
      );
    }
    assertWebhookSecret(config.webhookSecret);

    this.apiBaseUrl = trimTrailingSlash(
      config.apiBaseUrl ?? DEFAULT_API_BASE_URL
    );
    this.authBaseUrl = trimTrailingSlash(
      config.authBaseUrl ?? DEFAULT_AUTH_BASE_URL
    );
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.webhookSecret = config.webhookSecret;
    this.userAccessToken = config.userAccessToken;
    this.refreshToken = config.refreshToken;
    this.encryptionKey = config.encryptionKey
      ? decodeKey(config.encryptionKey)
      : undefined;
    this.logger = config.logger;
    this._botUserId = config.userId;
    this._userName = config.userName?.toLowerCase() ?? "bot";
    this.hasExplicitUserName = Boolean(config.userName);
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    if (!this.hasExplicitUserName) {
      this._userName = chat.getUserName();
    }

    if (this._botUserId && this.hasExplicitUserName) {
      return;
    }

    try {
      const query: Record<string, string> = this._botUserId
        ? { id: this._botUserId }
        : { login: this._userName };
      const result = await this.helixFetch<TwitchUser>(
        "/users",
        { method: "GET", query },
        "app"
      );
      const user = result.data?.[0];
      if (user) {
        this._botUserId = this._botUserId ?? user.id;
        if (!this.hasExplicitUserName) {
          this._userName = user.login;
        }
      }
      this.logger.info("Twitch adapter initialized", {
        botUserId: this._botUserId,
        userName: this._userName,
      });
    } catch (error) {
      this.logger.warn("Failed to fetch Twitch bot identity", {
        error: String(error),
      });
    }

    // The bot id is required: it is the sender of every chat message and
    // whisper, and self-detection compares against it. Fail fast rather than
    // reply to the bot's own messages in production.
    if (!this._botUserId) {
      throw new ValidationError(
        "twitch",
        "Could not resolve the bot user ID. Set TWITCH_BOT_USER_ID, or set TWITCH_BOT_USERNAME to a valid Twitch login."
      );
    }
  }

  /**
   * Handle an EventSub webhook request: verify the HMAC signature and
   * freshness, answer the `webhook_callback_verification` challenge, log
   * revocations, and route `channel.chat.message` and `user.whisper.message`
   * notifications.
   */
  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const body = await request.text();
    const messageId = request.headers.get(HEADER_MESSAGE_ID);
    const timestamp = request.headers.get(HEADER_MESSAGE_TIMESTAMP);
    const signature = request.headers.get(HEADER_MESSAGE_SIGNATURE);

    if (!this.verifySignature(messageId, timestamp, body, signature)) {
      this.logger.warn("Twitch webhook rejected due to invalid signature");
      return new Response("Invalid signature", { status: 403 });
    }

    if (!isFresh(timestamp)) {
      this.logger.warn("Twitch webhook rejected due to a stale timestamp", {
        messageId,
      });
      return new Response("Stale message", { status: 403 });
    }

    let payload: TwitchEventSubPayload;
    try {
      payload = JSON.parse(body) as TwitchEventSubPayload;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const messageType = request.headers.get(HEADER_MESSAGE_TYPE);
    switch (messageType) {
      case MESSAGE_TYPE_VERIFICATION:
        return this.handleVerification(payload);
      case MESSAGE_TYPE_REVOCATION:
        this.logger.warn("Twitch revoked an EventSub subscription", {
          condition: payload.subscription?.condition,
          status: payload.subscription?.status,
          type: payload.subscription?.type,
        });
        return new Response("OK", { status: 200 });
      case MESSAGE_TYPE_NOTIFICATION:
        if (!this.chat) {
          this.logger.warn(
            "Chat instance not initialized, ignoring Twitch webhook"
          );
          return new Response("OK", { status: 200 });
        }
        this.routeNotification(payload, timestamp ?? undefined, options);
        return new Response("OK", { status: 200 });
      default:
        this.logger.debug("Ignoring Twitch EventSub message", {
          messageType,
        });
        return new Response("OK", { status: 200 });
    }
  }

  /**
   * Verify `Twitch-Eventsub-Message-Signature`: HMAC-SHA256 over the message
   * ID, timestamp, and raw body (in that order), keyed by the webhook secret,
   * hex encoded with a `sha256=` prefix.
   */
  protected verifySignature(
    messageId: string | null,
    timestamp: string | null,
    body: string,
    signature: string | null
  ): boolean {
    if (!(messageId && timestamp && signature?.startsWith(SIGNATURE_PREFIX))) {
      return false;
    }

    const expected = createHmac("sha256", this.webhookSecret)
      .update(messageId + timestamp + body, "utf8")
      .digest();

    try {
      const provided = Buffer.from(
        signature.slice(SIGNATURE_PREFIX.length),
        "hex"
      );
      return (
        provided.length === expected.length &&
        timingSafeEqual(provided, expected)
      );
    } catch {
      this.logger.warn("Failed to verify Twitch webhook signature");
      return false;
    }
  }

  /** Answer the subscription challenge with the raw challenge string. */
  protected handleVerification(payload: TwitchEventSubPayload): Response {
    if (typeof payload.challenge !== "string") {
      return new Response("Missing challenge", { status: 400 });
    }
    this.logger.info("Verified Twitch EventSub subscription", {
      type: payload.subscription?.type,
    });
    return new Response(payload.challenge, {
      headers: { "Content-Type": "text/plain" },
      status: 200,
    });
  }

  protected routeNotification(
    payload: TwitchEventSubPayload,
    receivedAt: string | undefined,
    options?: WebhookOptions
  ): void {
    const type = payload.subscription?.type;
    switch (type) {
      case SUBSCRIPTION_CHAT_MESSAGE:
        if (!isChatMessageEvent(payload.event)) {
          this.logger.warn("Unrecognized Twitch chat message payload shape");
          return;
        }
        this.handleChatMessage(payload.event, receivedAt, options);
        return;
      case SUBSCRIPTION_WHISPER_MESSAGE:
        if (!isWhisperEvent(payload.event)) {
          this.logger.warn("Unrecognized Twitch whisper payload shape");
          return;
        }
        this.handleWhisper(payload.event, receivedAt, options);
        return;
      default:
        this.logger.debug("Ignoring Twitch EventSub notification", { type });
    }
  }

  protected handleChatMessage(
    event: TwitchChatMessageEvent,
    receivedAt: string | undefined,
    options?: WebhookOptions
  ): void {
    // channel.chat.message delivers every message in the room, including the
    // bot's own sends. Drop them so the bot never replies to itself.
    if (!this.chat || this.isBotUser(event.chatter_user_id)) {
      return;
    }

    const threadId = this.encodeThreadId({
      broadcasterUserId: event.broadcaster_user_id,
      kind: "chat",
    });
    const message = this.buildChatMessage(
      { event, kind: "chat", receivedAt },
      threadId
    );
    this.cacheMessage(message);
    this.chat.processMessage(this, threadId, message, options);
  }

  protected handleWhisper(
    event: TwitchWhisperEvent,
    receivedAt: string | undefined,
    options?: WebhookOptions
  ): void {
    if (!this.chat || this.isBotUser(event.from_user_id)) {
      return;
    }

    const threadId = this.encodeThreadId({
      kind: "whisper",
      userId: event.from_user_id,
    });
    const message = this.buildWhisperMessage(
      { event, kind: "whisper", receivedAt },
      threadId
    );
    this.cacheMessage(message);
    this.chat.processMessage(this, threadId, message, options);
  }

  /**
   * Post to a thread. Chat threads send a message to the broadcaster's chat
   * room with the app access token; whisper threads send a whisper with the
   * bot's user access token. Markdown and cards are flattened to one line of
   * plain text and truncated to the platform limit.
   */
  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<TwitchRawMessage>> {
    return this.send(threadId, message);
  }

  /**
   * Reply to a specific chat message with `reply_parent_message_id`, so Twitch
   * shows it as a reply. Whispers have no reply concept and send normally.
   */
  async reply(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<TwitchRawMessage>> {
    return this.send(threadId, message, messageId);
  }

  /** Chat thread IDs double as channel IDs, so this posts to the chat room. */
  async postChannelMessage(
    channelId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<TwitchRawMessage>> {
    return this.send(channelId, message);
  }

  protected async send(
    threadId: string,
    message: AdapterPostableMessage,
    replyParentMessageId?: string
  ): Promise<RawMessage<TwitchRawMessage>> {
    const decoded = this.decodeThreadId(threadId);
    if (
      extractFiles(message).length > 0 ||
      extractPostableAttachments(message).length > 0
    ) {
      throw new ValidationError(
        "twitch",
        "Twitch does not support file uploads or attachments"
      );
    }

    if (decoded.kind === "whisper") {
      const text = this.renderOutbound(message, WHISPER_MESSAGE_LIMIT);
      return this.sendWhisper(threadId, decoded.userId, text);
    }

    const text = this.renderOutbound(message, CHAT_MESSAGE_LIMIT);
    return this.sendChatMessage(
      threadId,
      decoded.broadcasterUserId,
      text,
      replyParentMessageId
    );
  }

  protected async sendChatMessage(
    threadId: string,
    broadcasterUserId: string,
    text: string,
    replyParentMessageId?: string
  ): Promise<RawMessage<TwitchRawMessage>> {
    const senderId = this.requireBotUserId("send chat messages");
    const result = await this.helixFetch<TwitchSendChatMessageResult>(
      "/chat/messages",
      {
        body: {
          broadcaster_id: broadcasterUserId,
          message: text,
          sender_id: senderId,
          ...(replyParentMessageId
            ? { reply_parent_message_id: replyParentMessageId }
            : {}),
        },
        method: "POST",
      },
      "app"
    );

    const sent = result.data?.[0];
    if (!sent) {
      throw new NetworkError(
        "twitch",
        "Twitch returned no result for Send Chat Message"
      );
    }
    if (!sent.is_sent) {
      // Twitch answers 200 for messages that fail AutoMod, duplicate, or
      // channel-mode checks, and reports the reason in drop_reason.
      const reason = sent.drop_reason;
      throw new ValidationError(
        "twitch",
        `Twitch dropped the chat message: ${reason?.message ?? "no reason given"}${reason?.code ? ` (${reason.code})` : ""}`
      );
    }

    const raw: TwitchRawMessage = {
      event: {
        broadcaster_user_id: broadcasterUserId,
        broadcaster_user_login: "",
        broadcaster_user_name: "",
        chatter_user_id: senderId,
        chatter_user_login: this._userName,
        chatter_user_name: this._userName,
        message: { fragments: [{ text, type: "text" }], text },
        message_id: sent.message_id,
        message_type: "text",
        reply: null,
      },
      kind: "chat",
      receivedAt: new Date().toISOString(),
    };
    this.cacheMessage(this.buildChatMessage(raw, threadId));
    return { id: sent.message_id, raw, threadId };
  }

  protected async sendWhisper(
    threadId: string,
    toUserId: string,
    text: string
  ): Promise<RawMessage<TwitchRawMessage>> {
    const fromUserId = this.requireBotUserId("send whispers");
    if (!(this.userAccessToken || this.refreshToken)) {
      throw new ValidationError(
        "twitch",
        "Sending whispers requires a user access token with the user:manage:whispers scope. Set TWITCH_USER_ACCESS_TOKEN or TWITCH_REFRESH_TOKEN."
      );
    }

    await this.helixFetch(
      "/whispers",
      {
        body: { message: text },
        method: "POST",
        query: { from_user_id: fromUserId, to_user_id: toUserId },
      },
      "user"
    );

    // Send Whisper returns 204 with no body, so there is no whisper ID.
    const id = randomUUID();
    const raw: TwitchRawMessage = {
      event: {
        from_user_id: fromUserId,
        from_user_login: this._userName,
        from_user_name: this._userName,
        to_user_id: toUserId,
        to_user_login: "",
        to_user_name: "",
        whisper: { text },
        whisper_id: id,
      },
      kind: "whisper",
      receivedAt: new Date().toISOString(),
    };
    this.cacheMessage(this.buildWhisperMessage(raw, threadId));
    return { id, raw, threadId };
  }

  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage
  ): Promise<RawMessage<TwitchRawMessage>> {
    throw new ValidationError(
      "twitch",
      "Twitch does not support editing messages"
    );
  }

  /**
   * Delete a chat message with Delete Chat Messages. The bot must be the
   * broadcaster or a moderator, the app needs `moderator:manage:chat_messages`
   * for the bot account, and Twitch only deletes messages under 6 hours old
   * that don't belong to the broadcaster or another moderator.
   */
  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const decoded = this.decodeThreadId(threadId);
    if (decoded.kind === "whisper") {
      throw new ValidationError(
        "twitch",
        "Twitch does not support deleting whispers"
      );
    }

    await this.helixFetch(
      "/moderation/chat",
      {
        method: "DELETE",
        query: {
          broadcaster_id: decoded.broadcasterUserId,
          message_id: messageId,
          moderator_id: this.requireBotUserId("delete chat messages"),
        },
      },
      "app"
    );
    this.uncacheMessage(threadId, messageId);
  }

  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new ValidationError("twitch", "Twitch does not support reactions");
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new ValidationError("twitch", "Twitch does not support reactions");
  }

  async startTyping(_threadId: string): Promise<void> {
    // Twitch has no typing indicator API.
  }

  /**
   * Buffer the stream and post once on completion. Twitch chat messages can't
   * be edited, so Chat SDK's post+edit fallback would fail after the first
   * chunk.
   */
  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    _options?: StreamOptions
  ): Promise<RawMessage<TwitchRawMessage>> {
    let accumulated = "";
    for await (const chunk of textStream) {
      if (typeof chunk === "string") {
        accumulated += chunk;
      } else if (chunk.type === "markdown_text") {
        accumulated += chunk.text;
      }
    }
    return this.postMessage(threadId, { markdown: accumulated });
  }

  /**
   * Twitch has no chat history API, so messages are served from the messages
   * this adapter received or sent. `persistThreadHistory` backs longer
   * retention in the state adapter.
   */
  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<TwitchRawMessage>> {
    this.decodeThreadId(threadId);
    return paginateMessages(this.messageCache.get(threadId) ?? [], options);
  }

  async fetchMessage(
    threadId: string,
    messageId: string
  ): Promise<Message<TwitchRawMessage> | null> {
    return (
      this.messageCache.get(threadId)?.find((m) => m.id === messageId) ?? null
    );
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const decoded = this.decodeThreadId(threadId);
    return {
      channelId: this.channelIdFromThreadId(threadId),
      id: threadId,
      isDM: decoded.kind === "whisper",
      metadata: { ...decoded },
    };
  }

  async getUser(userId: string): Promise<UserInfo | null> {
    const result = await this.helixFetch<TwitchUser>(
      "/users",
      { method: "GET", query: { id: userId } },
      "app"
    );
    const user = result.data?.[0];
    if (!user) {
      return null;
    }
    return {
      avatarUrl: user.profile_image_url || undefined,
      fullName: user.display_name || user.login,
      isBot: false,
      userId: user.id,
      userName: user.login,
    };
  }

  async openDM(userId: string): Promise<string> {
    return this.encodeThreadId({ kind: "whisper", userId });
  }

  isDM(threadId: string): boolean {
    return this.decodeThreadId(threadId).kind === "whisper";
  }

  encodeThreadId(platformData: TwitchThreadId): string {
    if (platformData.kind === "whisper") {
      return `twitch:${WHISPER_SEGMENT}:${platformData.userId}`;
    }
    return `twitch:${platformData.broadcasterUserId}`;
  }

  decodeThreadId(threadId: string): TwitchThreadId {
    const parts = threadId.split(":");
    if (parts[0] === "twitch") {
      if (parts.length === 2 && parts[1] && parts[1] !== WHISPER_SEGMENT) {
        return { broadcasterUserId: parts[1], kind: "chat" };
      }
      if (parts.length === 3 && parts[1] === WHISPER_SEGMENT && parts[2]) {
        return { kind: "whisper", userId: parts[2] };
      }
    }
    throw new ValidationError(
      "twitch",
      `Invalid Twitch thread ID: ${threadId}`
    );
  }

  /** A chat room is both the channel and its only thread; whispers are their own channel. */
  channelIdFromThreadId(threadId: string): string {
    this.decodeThreadId(threadId);
    return threadId;
  }

  parseMessage(raw: TwitchRawMessage): Message<TwitchRawMessage> {
    if (raw.kind === "whisper") {
      const userId = this.isBotUser(raw.event.from_user_id)
        ? raw.event.to_user_id
        : raw.event.from_user_id;
      const threadId = this.encodeThreadId({ kind: "whisper", userId });
      const message = this.buildWhisperMessage(raw, threadId);
      this.cacheMessage(message);
      return message;
    }

    const threadId = this.encodeThreadId({
      broadcasterUserId: raw.event.broadcaster_user_id,
      kind: "chat",
    });
    const message = this.buildChatMessage(raw, threadId);
    this.cacheMessage(message);
    return message;
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  /**
   * Create a `channel.chat.message` EventSub webhook subscription for a
   * broadcaster's chat room, read as the bot account. The bot must have
   * authorized the app with `user:read:chat` and `user:bot`, and the
   * broadcaster must have granted `channel:bot` (or made the bot a moderator).
   */
  async subscribeToChat(
    broadcasterUserId: string,
    callbackUrl: string
  ): Promise<TwitchEventSubSubscription> {
    return this.createEventSubSubscription(
      SUBSCRIPTION_CHAT_MESSAGE,
      {
        broadcaster_user_id: broadcasterUserId,
        user_id: this.requireBotUserId("subscribe to chat"),
      },
      callbackUrl
    );
  }

  /**
   * Create a `user.whisper.message` EventSub webhook subscription for whispers
   * sent to the bot account. The bot must have authorized the app with
   * `user:read:whispers` or `user:manage:whispers`.
   */
  async subscribeToWhispers(
    callbackUrl: string
  ): Promise<TwitchEventSubSubscription> {
    return this.createEventSubSubscription(
      SUBSCRIPTION_WHISPER_MESSAGE,
      { user_id: this.requireBotUserId("subscribe to whispers") },
      callbackUrl
    );
  }

  protected async createEventSubSubscription(
    type: string,
    condition: Record<string, string>,
    callbackUrl: string
  ): Promise<TwitchEventSubSubscription> {
    const result = await this.helixFetch<TwitchEventSubSubscription>(
      "/eventsub/subscriptions",
      {
        body: {
          condition,
          transport: {
            callback: callbackUrl,
            method: "webhook",
            secret: this.webhookSecret,
          },
          type,
          version: "1",
        },
        method: "POST",
      },
      "app"
    );
    const subscription = result.data?.[0];
    if (!subscription) {
      throw new NetworkError(
        "twitch",
        `Twitch returned no subscription for ${type}`
      );
    }
    return subscription;
  }

  protected renderOutbound(
    message: AdapterPostableMessage,
    limit: number
  ): string {
    const card = extractCard(message);
    const rendered = card
      ? cardToTwitchText(card)
      : this.formatConverter.renderPostable(message);
    const text = toSingleLine(convertEmojiPlaceholders(rendered, "gchat"));
    if (!text) {
      throw new ValidationError("twitch", "Message text cannot be empty");
    }
    return truncate(text, limit);
  }

  protected buildChatMessage(
    raw: Extract<TwitchRawMessage, { kind: "chat" }>,
    threadId: string
  ): Message<TwitchRawMessage> {
    const { event } = raw;
    const isMe = this.isBotUser(event.chatter_user_id);
    const text = event.message.text;
    return new Message<TwitchRawMessage>({
      attachments: [],
      author: this.buildAuthor(
        event.chatter_user_id,
        event.chatter_user_login,
        event.chatter_user_name,
        isMe
      ),
      formatted: this.formatConverter.toAst(text),
      id: event.message_id,
      // Structured mentions and replies to the bot are definite. Otherwise
      // leave it undetermined so the SDK can still match @login in the text.
      isMention: isMe ? undefined : this.mentionsBot(event) || undefined,
      metadata: { dateSent: parseTimestamp(raw.receivedAt), edited: false },
      raw,
      replyTo: event.reply
        ? this.buildReplyParent(event.reply, raw, threadId)
        : undefined,
      text,
      threadId,
    });
  }

  /**
   * Build the message a chat reply points at from the `reply` metadata. Twitch
   * sends the parent's text and author but no timestamp or payload of its own,
   * so it reuses the reply's received time and raw event.
   */
  protected buildReplyParent(
    reply: TwitchChatReply,
    raw: Extract<TwitchRawMessage, { kind: "chat" }>,
    threadId: string
  ): Message<TwitchRawMessage> {
    return new Message<TwitchRawMessage>({
      attachments: [],
      author: this.buildAuthor(
        reply.parent_user_id,
        reply.parent_user_login,
        reply.parent_user_name,
        this.isBotUser(reply.parent_user_id)
      ),
      formatted: this.formatConverter.toAst(reply.parent_message_body),
      id: reply.parent_message_id,
      metadata: { dateSent: parseTimestamp(raw.receivedAt), edited: false },
      raw,
      text: reply.parent_message_body,
      threadId,
    });
  }

  protected buildWhisperMessage(
    raw: Extract<TwitchRawMessage, { kind: "whisper" }>,
    threadId: string
  ): Message<TwitchRawMessage> {
    const { event } = raw;
    const isMe = this.isBotUser(event.from_user_id);
    const text = event.whisper.text;
    return new Message<TwitchRawMessage>({
      attachments: [],
      author: this.buildAuthor(
        event.from_user_id,
        event.from_user_login,
        event.from_user_name,
        isMe
      ),
      formatted: this.formatConverter.toAst(text),
      id: event.whisper_id,
      metadata: { dateSent: parseTimestamp(raw.receivedAt), edited: false },
      raw,
      text,
      threadId,
    });
  }

  /** Whether a chat message @mentions the bot or replies to one of its messages. */
  protected mentionsBot(event: TwitchChatMessageEvent): boolean {
    if (this.isBotUser(event.reply?.parent_user_id)) {
      return true;
    }
    return (event.message.fragments ?? []).some(
      (fragment) =>
        fragment.type === "mention" && this.isBotUser(fragment.mention?.user_id)
    );
  }

  protected isBotUser(userId: string | null | undefined): boolean {
    return Boolean(this._botUserId && userId === this._botUserId);
  }

  protected buildAuthor(
    userId: string,
    login: string,
    displayName: string,
    isMe: boolean
  ): Author {
    const userName = isMe ? this._userName : login || userId;
    return {
      fullName: displayName || userName,
      isBot: isMe,
      isMe,
      userId,
      userName,
    };
  }

  protected requireBotUserId(action: string): string {
    if (!this._botUserId) {
      throw new ValidationError(
        "twitch",
        `The bot user ID is required to ${action}. Set TWITCH_BOT_USER_ID or initialize the adapter first.`
      );
    }
    return this._botUserId;
  }

  protected cacheMessage(message: Message<TwitchRawMessage>): void {
    const existing = this.messageCache.get(message.threadId) ?? [];
    const index = existing.findIndex((item) => item.id === message.id);
    if (index >= 0) {
      existing[index] = message;
    } else {
      existing.push(message);
    }
    existing.sort(compareByDate);
    if (existing.length > MESSAGE_CACHE_LIMIT) {
      existing.splice(0, existing.length - MESSAGE_CACHE_LIMIT);
    }
    this.messageCache.set(message.threadId, existing);
  }

  protected uncacheMessage(threadId: string, messageId: string): void {
    const existing = this.messageCache.get(threadId);
    if (existing) {
      this.messageCache.set(
        threadId,
        existing.filter((message) => message.id !== messageId)
      );
    }
  }

  /**
   * Get an app access token with the client credentials grant, cached until
   * shortly before it expires. Concurrent callers share one request.
   */
  protected async getAppAccessToken(): Promise<string> {
    if (
      this.appToken &&
      this.appToken.expiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS
    ) {
      return this.appToken.accessToken;
    }
    if (!this.appTokenPromise) {
      this.appTokenPromise = this.requestAppAccessToken().finally(() => {
        this.appTokenPromise = null;
      });
    }
    return this.appTokenPromise;
  }

  private async requestAppAccessToken(): Promise<string> {
    const result = await this.requestToken(
      new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "client_credentials",
      }),
      "app access token"
    );
    this.appToken = {
      accessToken: result.accessToken,
      expiresAt: Date.now() + (result.expiresIn ?? 3600) * 1000,
    };
    return result.accessToken;
  }

  protected async resolveUserAccessToken(): Promise<string> {
    if (typeof this.userAccessToken === "function") {
      return await this.userAccessToken();
    }
    if (this.refreshToken) {
      return this.resolveManagedToken();
    }
    if (this.userAccessToken) {
      return this.userAccessToken;
    }
    throw new AuthenticationError(
      "twitch",
      "No Twitch user access token configured"
    );
  }

  private async resolveManagedToken(): Promise<string> {
    const current = await this.loadManagedToken();
    if (
      current?.accessToken &&
      current.expiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS
    ) {
      return current.accessToken;
    }
    // Single-flight so concurrent calls share one refresh. Twitch may rotate
    // the refresh token, so a duplicate refresh could invalidate the other.
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshManagedToken().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async loadManagedToken(): Promise<ManagedToken | null> {
    if (!this.refreshToken) {
      return null;
    }
    if (!(this.managedToken || this.storedTokenLoaded)) {
      const state = this.tryGetState();
      if (state) {
        this.storedTokenLoaded = true;
        this.managedToken = await this.readStoredToken(state);
      }
    }
    if (!this.managedToken) {
      this.managedToken = {
        accessToken: "",
        expiresAt: 0,
        refreshToken: this.refreshToken,
      };
    }
    return this.managedToken;
  }

  private async refreshManagedToken(): Promise<string> {
    const current = await this.loadManagedToken();
    const refreshToken = current?.refreshToken ?? this.refreshToken ?? "";
    const result = await this.requestToken(
      new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      "user access token"
    );
    this.managedToken = {
      accessToken: result.accessToken,
      expiresAt:
        Date.now() + (result.expiresIn ?? DEFAULT_USER_TOKEN_LIFETIME_S) * 1000,
      // Refresh tokens may change; persist the new one or auth breaks after restart.
      refreshToken: result.refreshToken ?? refreshToken,
    };
    await this.persistManagedToken(this.managedToken);
    return this.managedToken.accessToken;
  }

  private async requestToken(
    body: URLSearchParams,
    label: string
  ): Promise<{
    accessToken: string;
    expiresIn?: number;
    refreshToken?: string;
  }> {
    let response: Response;
    try {
      response = await fetch(`${this.authBaseUrl}/token`, {
        body: body.toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
      });
    } catch (error) {
      throw new NetworkError(
        "twitch",
        `Network error requesting a Twitch ${label}`,
        error instanceof Error ? error : undefined
      );
    }

    if (!response.ok) {
      throw new AuthenticationError(
        "twitch",
        `Failed to get a Twitch ${label} (status ${response.status}). Check the client ID, client secret, and refresh token.`
      );
    }

    let result: TwitchOauthTokenResult;
    try {
      result = (await response.json()) as TwitchOauthTokenResult;
    } catch {
      throw new AuthenticationError(
        "twitch",
        `Failed to parse the Twitch ${label} response`
      );
    }
    if (!result.access_token) {
      throw new AuthenticationError(
        "twitch",
        `The Twitch ${label} response did not include an access token`
      );
    }
    return {
      accessToken: result.access_token,
      expiresIn: result.expires_in,
      refreshToken: result.refresh_token,
    };
  }

  private tokenStateKey(): string {
    return `twitch:oauth:${this.clientId}`;
  }

  private tryGetState(): StateAdapter | null {
    try {
      return this.chat?.getState() ?? null;
    } catch {
      return null;
    }
  }

  private async readStoredToken(
    state: StateAdapter
  ): Promise<ManagedToken | null> {
    try {
      const stored = await state.get<TwitchStoredOauthToken>(
        this.tokenStateKey()
      );
      if (!stored) {
        return null;
      }
      return {
        accessToken: this.revealToken(stored.accessToken),
        expiresAt: stored.expiresAt,
        refreshToken: this.revealToken(stored.refreshToken),
      };
    } catch (error) {
      this.logger.warn("Failed to read stored Twitch OAuth token", {
        error: String(error),
      });
      return null;
    }
  }

  private async persistManagedToken(token: ManagedToken): Promise<void> {
    const state = this.tryGetState();
    if (!state) {
      return;
    }
    try {
      const stored: TwitchStoredOauthToken = {
        accessToken: this.concealToken(token.accessToken),
        expiresAt: token.expiresAt,
        refreshToken: this.concealToken(token.refreshToken),
      };
      await state.set(this.tokenStateKey(), stored);
    } catch (error) {
      this.logger.warn("Failed to persist Twitch OAuth token", {
        error: String(error),
      });
    }
  }

  private concealToken(value: string): EncryptedTokenData | string {
    return this.encryptionKey ? encryptToken(value, this.encryptionKey) : value;
  }

  private revealToken(value: EncryptedTokenData | string): string {
    if (isEncryptedTokenData(value)) {
      if (!this.encryptionKey) {
        throw new AuthenticationError(
          "twitch",
          "Stored Twitch token is encrypted but no encryptionKey is configured"
        );
      }
      return decryptToken(value, this.encryptionKey);
    }
    return value;
  }

  /**
   * Call a Helix endpoint with the app or user access token. A 401 on the app
   * token clears the cached token and retries once, since app tokens can be
   * revoked or expire early.
   */
  protected async helixFetch<TData>(
    path: string,
    request: HelixRequest,
    tokenKind: TokenKind,
    isRetry = false
  ): Promise<TwitchApiResponse<TData>> {
    const token =
      tokenKind === "app"
        ? await this.getAppAccessToken()
        : await this.resolveUserAccessToken();

    const query = request.query
      ? `?${new URLSearchParams(request.query).toString()}`
      : "";
    const init: RequestInit = {
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Id": this.clientId,
        ...(request.body ? { "Content-Type": "application/json" } : {}),
      },
      method: request.method,
    };
    if (request.body) {
      init.body = JSON.stringify(request.body);
    }

    let response: Response;
    try {
      response = await fetch(`${this.apiBaseUrl}${path}${query}`, init);
    } catch (error) {
      throw new NetworkError(
        "twitch",
        `Network error calling Twitch API ${path}`,
        error instanceof Error ? error : undefined
      );
    }

    if (response.status === 401 && tokenKind === "app" && !isRetry) {
      this.appToken = null;
      return this.helixFetch(path, request, tokenKind, true);
    }

    if (response.status === 204) {
      return {};
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = undefined;
    }

    if (!response.ok) {
      this.throwApiError(path, response, data as TwitchApiError | undefined);
    }
    if (!isRecord(data)) {
      throw new NetworkError(
        "twitch",
        `Failed to parse Twitch API response for ${path}`
      );
    }
    return data as TwitchApiResponse<TData>;
  }

  protected throwApiError(
    path: string,
    response: Response,
    data: TwitchApiError | undefined
  ): never {
    const message =
      data?.message ||
      data?.error ||
      `Twitch API ${path} failed with status ${response.status}`;

    if (response.status === 429) {
      throw new AdapterRateLimitError("twitch", retryAfterSeconds(response));
    }
    if (response.status === 401) {
      throw new AuthenticationError("twitch", message);
    }
    if (response.status === 403) {
      throw new PermissionError("twitch", `call ${path}: ${message}`);
    }
    if (response.status === 404) {
      throw new ResourceNotFoundError("twitch", "resource", path);
    }
    if (response.status >= 400 && response.status < 500) {
      throw new ValidationError("twitch", message);
    }
    throw new NetworkError("twitch", `${message} (status ${response.status})`);
  }
}

function assertWebhookSecret(secret: string): void {
  if (
    secret.length < WEBHOOK_SECRET_MIN_LENGTH ||
    secret.length > WEBHOOK_SECRET_MAX_LENGTH
  ) {
    throw new ValidationError(
      "twitch",
      `webhookSecret must be ${WEBHOOK_SECRET_MIN_LENGTH} to ${WEBHOOK_SECRET_MAX_LENGTH} characters long`
    );
  }
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/**
 * Parse an EventSub RFC3339 timestamp. Twitch sends nanosecond precision;
 * trim to milliseconds so every runtime parses it.
 */
function parseTimestampMs(value: string | null | undefined): number {
  if (!value) {
    return Number.NaN;
  }
  return Date.parse(value.replace(FRACTIONAL_SECONDS, ".$1"));
}

function parseTimestamp(value: string | undefined): Date {
  const ms = parseTimestampMs(value);
  return Number.isNaN(ms) ? new Date() : new Date(ms);
}

function isFresh(timestamp: string | null): boolean {
  const ms = parseTimestampMs(timestamp);
  return !Number.isNaN(ms) && Date.now() - ms <= MAX_MESSAGE_AGE_MS;
}

/**
 * Cut `value` to `limit` characters with a trailing ellipsis, breaking at the
 * last space when one falls in the back half so words aren't split.
 */
function truncate(value: string, limit: number): string {
  const chars = Array.from(value);
  if (chars.length <= limit) {
    return value;
  }
  const kept = chars.slice(0, limit - 1);
  const lastSpace = kept.lastIndexOf(" ");
  const cut = lastSpace >= limit / 2 ? kept.slice(0, lastSpace) : kept;
  return `${cut.join("").trimEnd()}…`;
}

function retryAfterSeconds(response: Response): number | undefined {
  const reset = response.headers.get("ratelimit-reset");
  if (!reset) {
    return undefined;
  }
  const resetEpoch = Number.parseInt(reset, 10);
  if (Number.isNaN(resetEpoch)) {
    return undefined;
  }
  return Math.max(0, resetEpoch - Math.floor(Date.now() / 1000));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isChatMessageEvent(value: unknown): value is TwitchChatMessageEvent {
  return (
    isRecord(value) &&
    typeof value.message_id === "string" &&
    typeof value.broadcaster_user_id === "string" &&
    typeof value.chatter_user_id === "string" &&
    isRecord(value.message) &&
    typeof value.message.text === "string"
  );
}

function isWhisperEvent(value: unknown): value is TwitchWhisperEvent {
  return (
    isRecord(value) &&
    typeof value.whisper_id === "string" &&
    typeof value.from_user_id === "string" &&
    typeof value.to_user_id === "string" &&
    isRecord(value.whisper) &&
    typeof value.whisper.text === "string"
  );
}

function compareByDate(
  a: Message<TwitchRawMessage>,
  b: Message<TwitchRawMessage>
): number {
  return a.metadata.dateSent.getTime() - b.metadata.dateSent.getTime();
}

function paginateMessages(
  messages: Message<TwitchRawMessage>[],
  options: FetchOptions
): FetchResult<TwitchRawMessage> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
  const direction = options.direction ?? "backward";

  if (messages.length === 0) {
    return { messages: [] };
  }

  const indexById = new Map(
    messages.map((message, index) => [message.id, index])
  );

  if (direction === "backward") {
    const end =
      options.cursor && indexById.has(options.cursor)
        ? (indexById.get(options.cursor) ?? messages.length)
        : messages.length;
    const start = Math.max(0, end - limit);
    const page = messages.slice(start, end);
    return { messages: page, nextCursor: start > 0 ? page[0]?.id : undefined };
  }

  const start =
    options.cursor && indexById.has(options.cursor)
      ? (indexById.get(options.cursor) ?? -1) + 1
      : 0;
  const end = Math.min(messages.length, start + limit);
  const page = messages.slice(start, end);
  return {
    messages: page,
    nextCursor: end < messages.length ? page.at(-1)?.id : undefined,
  };
}

export function createTwitchAdapter(
  config?: TwitchAdapterConfig
): TwitchAdapter {
  const clientId = config?.clientId ?? process.env.TWITCH_CLIENT_ID;
  if (!clientId) {
    throw new ValidationError(
      "twitch",
      "clientId is required. Set TWITCH_CLIENT_ID or provide it in config."
    );
  }
  const clientSecret = config?.clientSecret ?? process.env.TWITCH_CLIENT_SECRET;
  if (!clientSecret) {
    throw new ValidationError(
      "twitch",
      "clientSecret is required. Set TWITCH_CLIENT_SECRET or provide it in config."
    );
  }
  const webhookSecret =
    config?.webhookSecret ?? process.env.TWITCH_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new ValidationError(
      "twitch",
      "webhookSecret is required. Set TWITCH_WEBHOOK_SECRET or provide it in config."
    );
  }
  const userId = config?.userId ?? process.env.TWITCH_BOT_USER_ID;
  const userName = config?.userName ?? process.env.TWITCH_BOT_USERNAME;
  if (!(userId || userName)) {
    throw new ValidationError(
      "twitch",
      "The bot account is required. Set TWITCH_BOT_USER_ID or TWITCH_BOT_USERNAME."
    );
  }

  return new TwitchAdapter({
    apiBaseUrl: config?.apiBaseUrl ?? process.env.TWITCH_API_BASE_URL,
    authBaseUrl: config?.authBaseUrl ?? process.env.TWITCH_AUTH_BASE_URL,
    clientId,
    clientSecret,
    encryptionKey: config?.encryptionKey ?? process.env.TWITCH_ENCRYPTION_KEY,
    logger: config?.logger ?? new ConsoleLogger("info").child("twitch"),
    refreshToken: config?.refreshToken ?? process.env.TWITCH_REFRESH_TOKEN,
    userAccessToken:
      config?.userAccessToken ?? process.env.TWITCH_USER_ACCESS_TOKEN,
    userId,
    userName,
    webhookSecret,
  });
}

export { cardToTwitchText } from "./cards";
export { TwitchFormatConverter } from "./markdown";
export type {
  TwitchAccessToken,
  TwitchAdapterConfig,
  TwitchApiError,
  TwitchApiResponse,
  TwitchBadge,
  TwitchChatMessageEvent,
  TwitchChatReply,
  TwitchEventSubPayload,
  TwitchEventSubSubscription,
  TwitchMessageFragment,
  TwitchOauthTokenResult,
  TwitchRawMessage,
  TwitchSendChatMessageResult,
  TwitchStoredOauthToken,
  TwitchThreadId,
  TwitchUser,
  TwitchWhisperEvent,
} from "./types";
