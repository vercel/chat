import { createHmac, timingSafeEqual } from "node:crypto";
import {
  AdapterRateLimitError,
  AuthenticationError,
  cardToFallbackText,
  extractCard,
  NetworkError,
  ResourceNotFoundError,
  ValidationError,
} from "@chat-adapter/shared";
import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
  ChannelInfo,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Logger,
  RawMessage,
  StreamChunk,
  StreamOptions,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import {
  ConsoleLogger,
  convertEmojiPlaceholders,
  getEmoji,
  Message,
} from "chat";
import { MessengerFormatConverter } from "./markdown";
import type {
  MessengerAdapterConfig,
  MessengerMessagingEvent,
  MessengerRawMessage,
  MessengerSendApiResponse,
  MessengerThreadId,
  MessengerUserProfile,
  MessengerWebhookPayload,
} from "./types";

const GRAPH_API_BASE = "https://graph.facebook.com";
const DEFAULT_API_VERSION = "v21.0";
const MESSENGER_MESSAGE_LIMIT = 2000;
const MESSAGE_SEQUENCE_PATTERN = /:(\d+)$/;

export class MessengerAdapter
  implements Adapter<MessengerThreadId, MessengerRawMessage>
{
  readonly name = "messenger";

  private readonly appSecret: string;
  private readonly pageAccessToken: string;
  private readonly verifyToken: string;
  private readonly apiVersion: string;
  private readonly logger: Logger;
  private readonly formatConverter = new MessengerFormatConverter();
  private readonly messageCache = new Map<
    string,
    Message<MessengerRawMessage>[]
  >();
  private readonly userProfileCache = new Map<string, MessengerUserProfile>();

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

  constructor(
    config: MessengerAdapterConfig & { logger: Logger; userName?: string }
  ) {
    this.appSecret = config.appSecret;
    this.pageAccessToken = config.pageAccessToken;
    this.verifyToken = config.verifyToken;
    this.apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
    this.logger = config.logger;
    this._userName = config.userName ?? "bot";
    this.hasExplicitUserName = Boolean(config.userName);
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    if (!this.hasExplicitUserName) {
      this._userName = chat.getUserName();
    }

    try {
      const me = await this.graphApiFetch<{ id: string; name: string }>(
        "me",
        "GET"
      );
      this._botUserId = me.id;
      if (!this.hasExplicitUserName && me.name) {
        this._userName = me.name;
      }

      this.logger.info("Messenger adapter initialized", {
        botUserId: this._botUserId,
        userName: this._userName,
      });
    } catch (error) {
      this.logger.warn("Failed to fetch Messenger page identity", {
        error: String(error),
      });
    }
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    if (request.method === "GET") {
      return this.handleVerification(request);
    }

    const body = await request.text();

    if (!this.verifySignature(request, body)) {
      this.logger.warn("Messenger webhook rejected due to invalid signature");
      return new Response("Invalid signature", { status: 403 });
    }

    let payload: MessengerWebhookPayload;
    try {
      payload = JSON.parse(body) as MessengerWebhookPayload;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (payload.object !== "page") {
      return new Response("Not a page subscription", { status: 404 });
    }

    if (!this.chat) {
      this.logger.warn(
        "Chat instance not initialized, ignoring Messenger webhook"
      );
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    for (const entry of payload.entry) {
      for (const event of entry.messaging) {
        if (event.message && !event.message.is_echo) {
          this.handleIncomingMessage(event, options);
        }

        if (event.message?.is_echo) {
          this.handleEcho(event);
        }

        if (event.postback) {
          this.handlePostback(event, options);
        }

        if (event.reaction) {
          this.handleReaction(event, options);
        }

        if (event.delivery) {
          this.logger.debug("Message delivery confirmation", {
            watermark: event.delivery.watermark,
            mids: event.delivery.mids,
          });
        }

        if (event.read) {
          this.logger.debug("Message read confirmation", {
            watermark: event.read.watermark,
          });
        }
      }
    }

    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  private handleVerification(request: Request): Response {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === this.verifyToken) {
      this.logger.info("Messenger webhook verified");
      return new Response(challenge ?? "", { status: 200 });
    }

    this.logger.warn("Messenger webhook verification failed");
    return new Response("Forbidden", { status: 403 });
  }

  private verifySignature(request: Request, body: string): boolean {
    const signature = request.headers.get("x-hub-signature-256");
    if (!signature) {
      return false;
    }

    const [algo, hash] = signature.split("=");
    if (algo !== "sha256" || !hash) {
      return false;
    }

    try {
      const computedHash = createHmac("sha256", this.appSecret)
        .update(body, "utf8")
        .digest("hex");

      return timingSafeEqual(
        Buffer.from(hash, "hex"),
        Buffer.from(computedHash, "hex")
      );
    } catch {
      this.logger.warn("Failed to verify Messenger webhook signature");
      return false;
    }
  }

  private handleIncomingMessage(
    event: MessengerMessagingEvent,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      return;
    }

    const threadId = this.encodeThreadId({
      recipientId: event.sender.id,
    });

    const parsedMessage = this.parseMessengerMessage(event, threadId);
    this.cacheMessage(parsedMessage);

    this.chat.processMessage(this, threadId, parsedMessage, options);
  }

  private handlePostback(
    event: MessengerMessagingEvent,
    options?: WebhookOptions
  ): void {
    if (!(this.chat && event.postback)) {
      return;
    }

    const threadId = this.encodeThreadId({
      recipientId: event.sender.id,
    });

    this.chat.processAction(
      {
        adapter: this,
        actionId: event.postback.payload,
        value: event.postback.payload,
        messageId: event.postback.mid ?? `postback:${event.timestamp}`,
        threadId,
        user: {
          userId: event.sender.id,
          userName: event.sender.id,
          fullName: event.sender.id,
          isBot: false,
          isMe: false,
        },
        raw: event,
      },
      options
    );
  }

  private handleEcho(event: MessengerMessagingEvent): void {
    if (!event.message) {
      return;
    }

    const threadId = this.encodeThreadId({
      recipientId: event.recipient.id,
    });

    const parsedMessage = this.parseMessengerMessage(event, threadId);
    this.cacheMessage(parsedMessage);
  }

  private handleReaction(
    event: MessengerMessagingEvent,
    options?: WebhookOptions
  ): void {
    if (!(this.chat && event.reaction)) {
      return;
    }

    const threadId = this.encodeThreadId({
      recipientId: event.sender.id,
    });

    const added = event.reaction.action === "react";

    this.chat.processReaction(
      {
        adapter: this,
        threadId,
        messageId: event.reaction.mid,
        emoji: getEmoji(event.reaction.emoji),
        rawEmoji: event.reaction.emoji,
        added,
        user: {
          userId: event.sender.id,
          userName: event.sender.id,
          fullName: event.sender.id,
          isBot: false,
          isMe: false,
        },
        raw: event,
      },
      options
    );
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<MessengerRawMessage>> {
    const { recipientId } = this.resolveThreadId(threadId);

    const card = extractCard(message);
    const text = this.truncateMessage(
      convertEmojiPlaceholders(
        card
          ? cardToFallbackText(card)
          : this.formatConverter.renderPostable(message),
        "messenger"
      )
    );

    if (!text.trim()) {
      throw new ValidationError("messenger", "Message text cannot be empty");
    }

    const result = await this.graphApiFetch<MessengerSendApiResponse>(
      "me/messages",
      "POST",
      {
        recipient: { id: recipientId },
        message: { text },
        messaging_type: "RESPONSE",
      }
    );

    const rawMessage: MessengerMessagingEvent = {
      sender: { id: this._botUserId ?? "" },
      recipient: { id: recipientId },
      timestamp: Date.now(),
      message: {
        mid: result.message_id,
        text,
        is_echo: true,
      },
    };

    const parsedMessage = this.parseMessengerMessage(rawMessage, threadId);
    this.cacheMessage(parsedMessage);

    return {
      id: result.message_id,
      threadId,
      raw: rawMessage,
    };
  }

  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage
  ): Promise<RawMessage<MessengerRawMessage>> {
    throw new ValidationError(
      "messenger",
      "Messenger does not support editing messages"
    );
  }

  /**
   * Buffer all stream chunks and send as a single message.
   * Messenger doesn't support message editing, so we can't do incremental updates.
   */
  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    _options?: StreamOptions
  ): Promise<RawMessage<MessengerRawMessage>> {
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

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    throw new ValidationError(
      "messenger",
      "Messenger does not support deleting messages"
    );
  }

  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new ValidationError(
      "messenger",
      "Messenger does not support reactions via API"
    );
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new ValidationError(
      "messenger",
      "Messenger does not support reactions via API"
    );
  }

  async startTyping(threadId: string): Promise<void> {
    const { recipientId } = this.resolveThreadId(threadId);
    await this.graphApiFetch("me/messages", "POST", {
      recipient: { id: recipientId },
      sender_action: "typing_on",
    });
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<MessengerRawMessage>> {
    const messages = [...(this.messageCache.get(threadId) ?? [])].sort((a, b) =>
      this.compareMessages(a, b)
    );

    return this.paginateMessages(messages, options);
  }

  async fetchMessage(
    _threadId: string,
    messageId: string
  ): Promise<Message<MessengerRawMessage> | null> {
    return this.findCachedMessage(messageId) ?? null;
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { recipientId } = this.resolveThreadId(threadId);
    const profile = await this.fetchUserProfile(recipientId);
    const displayName = this.profileDisplayName(profile);

    return {
      id: threadId,
      channelId: recipientId,
      channelName: displayName,
      isDM: true,
      metadata: { profile },
    };
  }

  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const profile = await this.fetchUserProfile(channelId);
    const displayName = this.profileDisplayName(profile);

    return {
      id: channelId,
      name: displayName,
      isDM: true,
      metadata: { profile },
    };
  }

  channelIdFromThreadId(threadId: string): string {
    return this.resolveThreadId(threadId).recipientId;
  }

  async openDM(userId: string): Promise<string> {
    return this.encodeThreadId({ recipientId: userId });
  }

  isDM(_threadId: string): boolean {
    return true;
  }

  encodeThreadId(platformData: MessengerThreadId): string {
    return `messenger:${platformData.recipientId}`;
  }

  decodeThreadId(threadId: string): MessengerThreadId {
    const parts = threadId.split(":");
    if (parts[0] !== "messenger" || parts.length !== 2) {
      throw new ValidationError(
        "messenger",
        `Invalid Messenger thread ID: ${threadId}`
      );
    }

    const recipientId = parts[1];
    if (!recipientId) {
      throw new ValidationError(
        "messenger",
        `Invalid Messenger thread ID: ${threadId}`
      );
    }

    return { recipientId };
  }

  parseMessage(raw: MessengerRawMessage): Message<MessengerRawMessage> {
    const threadId = this.encodeThreadId({
      recipientId: raw.sender.id,
    });

    const message = this.parseMessengerMessage(raw, threadId);
    this.cacheMessage(message);
    return message;
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  private parseMessengerMessage(
    event: MessengerMessagingEvent,
    threadId: string
  ): Message<MessengerRawMessage> {
    const text = event.message?.text ?? event.postback?.title ?? "";
    const isEcho = event.message?.is_echo ?? false;
    const isMe = isEcho || event.sender.id === this._botUserId;

    return new Message<MessengerRawMessage>({
      id: event.message?.mid ?? `event:${event.timestamp}`,
      threadId,
      text,
      formatted: this.formatConverter.toAst(text),
      raw: event,
      author: {
        userId: event.sender.id,
        userName: event.sender.id,
        fullName: event.sender.id,
        isBot: isMe,
        isMe,
      },
      metadata: {
        dateSent: new Date(event.timestamp),
        edited: false,
      },
      attachments: this.extractAttachments(event),
      isMention: true,
    });
  }

  private extractAttachments(event: MessengerMessagingEvent): Attachment[] {
    if (!event.message?.attachments) {
      return [];
    }

    return event.message.attachments
      .filter((attachment) => attachment.payload?.url)
      .map((attachment) => {
        const url = attachment.payload?.url;
        return {
          type: this.mapAttachmentType(attachment.type),
          url,
          fetchData: url ? async () => this.downloadAttachment(url) : undefined,
        };
      });
  }

  private mapAttachmentType(
    fbType: string
  ): "image" | "video" | "audio" | "file" {
    switch (fbType) {
      case "image":
        return "image";
      case "video":
        return "video";
      case "audio":
        return "audio";
      default:
        return "file";
    }
  }

  private async downloadAttachment(url: string): Promise<Buffer> {
    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw new NetworkError(
        "messenger",
        "Failed to download Messenger attachment",
        error instanceof Error ? error : undefined
      );
    }

    if (!response.ok) {
      throw new NetworkError(
        "messenger",
        `Failed to download Messenger attachment: ${response.status}`
      );
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private async fetchUserProfile(
    userId: string
  ): Promise<MessengerUserProfile> {
    const cached = this.userProfileCache.get(userId);
    if (cached) {
      return cached;
    }

    try {
      const profile = await this.graphApiFetch<MessengerUserProfile>(
        userId,
        "GET",
        undefined,
        { fields: "first_name,last_name,profile_pic" }
      );
      this.userProfileCache.set(userId, profile);
      return profile;
    } catch {
      return { id: userId };
    }
  }

  private profileDisplayName(profile: MessengerUserProfile): string {
    const parts = [profile.first_name, profile.last_name].filter(Boolean);
    return parts.join(" ") || profile.id;
  }

  private resolveThreadId(value: string): MessengerThreadId {
    if (value.startsWith("messenger:")) {
      return this.decodeThreadId(value);
    }

    return { recipientId: value };
  }

  private truncateMessage(text: string): string {
    if (text.length <= MESSENGER_MESSAGE_LIMIT) {
      return text;
    }

    return `${text.slice(0, MESSENGER_MESSAGE_LIMIT - 3)}...`;
  }

  private paginateMessages(
    messages: Message<MessengerRawMessage>[],
    options: FetchOptions
  ): FetchResult<MessengerRawMessage> {
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

  private cacheMessage(message: Message<MessengerRawMessage>): void {
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
  ): Message<MessengerRawMessage> | undefined {
    for (const messages of this.messageCache.values()) {
      const found = messages.find((message) => message.id === messageId);
      if (found) {
        return found;
      }
    }

    return undefined;
  }

  private compareMessages(
    a: Message<MessengerRawMessage>,
    b: Message<MessengerRawMessage>
  ): number {
    const timeDiff =
      a.metadata.dateSent.getTime() - b.metadata.dateSent.getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }

    return this.messageSequence(a.id) - this.messageSequence(b.id);
  }

  private messageSequence(messageId: string): number {
    const match = messageId.match(MESSAGE_SEQUENCE_PATTERN);
    return match ? Number.parseInt(match[1], 10) : 0;
  }

  private async graphApiFetch<TResult>(
    endpoint: string,
    method: "GET" | "POST",
    body?: Record<string, unknown>,
    queryParams?: Record<string, string>
  ): Promise<TResult> {
    const url = new URL(`${GRAPH_API_BASE}/${this.apiVersion}/${endpoint}`);
    url.searchParams.set("access_token", this.pageAccessToken);

    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        url.searchParams.set(key, value);
      }
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method,
        headers:
          method === "POST"
            ? { "Content-Type": "application/json" }
            : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new NetworkError(
        "messenger",
        `Network error calling Messenger Graph API ${endpoint}`,
        error instanceof Error ? error : undefined
      );
    }

    let data: Record<string, unknown>;
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new NetworkError(
        "messenger",
        `Failed to parse Messenger API response for ${endpoint}`
      );
    }

    if (!response.ok) {
      this.throwGraphApiError(endpoint, response.status, data);
    }

    return data as TResult;
  }

  private throwGraphApiError(
    endpoint: string,
    status: number,
    data: Record<string, unknown>
  ): never {
    const error = data.error as
      | { message?: string; code?: number; type?: string }
      | undefined;
    const message = error?.message ?? `Messenger API ${endpoint} failed`;
    const code = error?.code ?? status;

    if (status === 429 || code === 4 || code === 32 || code === 613) {
      throw new AdapterRateLimitError("messenger");
    }

    if (status === 401 || code === 190) {
      throw new AuthenticationError("messenger", message);
    }

    if (status === 403 || code === 10 || code === 200) {
      throw new ValidationError("messenger", message);
    }

    if (status === 404) {
      throw new ResourceNotFoundError("messenger", endpoint);
    }

    throw new NetworkError(
      "messenger",
      `${message} (status ${status}, code ${code})`
    );
  }
}

export function createMessengerAdapter(
  config?: Partial<
    MessengerAdapterConfig & { logger: Logger; userName?: string }
  >
): MessengerAdapter {
  const appSecret = config?.appSecret ?? process.env.FACEBOOK_APP_SECRET;
  if (!appSecret) {
    throw new ValidationError(
      "messenger",
      "appSecret is required. Set FACEBOOK_APP_SECRET or provide it in config."
    );
  }

  const pageAccessToken =
    config?.pageAccessToken ?? process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!pageAccessToken) {
    throw new ValidationError(
      "messenger",
      "pageAccessToken is required. Set FACEBOOK_PAGE_ACCESS_TOKEN or provide it in config."
    );
  }

  const verifyToken = config?.verifyToken ?? process.env.FACEBOOK_VERIFY_TOKEN;
  if (!verifyToken) {
    throw new ValidationError(
      "messenger",
      "verifyToken is required. Set FACEBOOK_VERIFY_TOKEN or provide it in config."
    );
  }

  return new MessengerAdapter({
    appSecret,
    pageAccessToken,
    verifyToken,
    apiVersion: config?.apiVersion,
    logger: config?.logger ?? new ConsoleLogger("info").child("messenger"),
    userName: config?.userName,
  });
}

export { MessengerFormatConverter } from "./markdown";
export type {
  MessengerAdapterConfig,
  MessengerMessagingEvent,
  MessengerRawMessage,
  MessengerReaction,
  MessengerSendApiResponse,
  MessengerThreadId,
  MessengerUserProfile,
  MessengerWebhookPayload,
} from "./types";
