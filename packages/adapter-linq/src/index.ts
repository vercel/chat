import { timingSafeEqual } from "node:crypto";
import {
  AdapterRateLimitError,
  AuthenticationError,
  cardToFallbackText,
  extractCard,
  extractFiles,
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
  ListThreadsOptions,
  ListThreadsResult,
  Logger,
  RawMessage,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import { ConsoleLogger, Message } from "chat";
import createClient from "openapi-fetch";
import { LinqFormatConverter } from "./markdown";
import type { components, paths } from "./schema";
import type {
  LinqAdapterConfig,
  LinqChat,
  LinqMessage,
  LinqMessageEventV2,
  LinqMessageFailedEvent,
  LinqRawMessage,
  LinqReactionEventBase,
  LinqThreadId,
  LinqWebhookPayload,
} from "./types";

const LINQ_API_BASE = "https://api.linqapp.com/api/partner";
const WEBHOOK_SIGNATURE_HEADER = "x-webhook-signature";
const WEBHOOK_TIMESTAMP_HEADER = "x-webhook-timestamp";
const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

const LINQ_REACTION_MAP: Record<string, string> = {
  love: "heart",
  like: "thumbsup",
  dislike: "thumbsdown",
  laugh: "laughing",
  emphasize: "exclamation",
  question: "question",
};

const EMOJI_TO_LINQ_REACTION: Record<string, string> = {
  heart: "love",
  thumbsup: "like",
  thumbsdown: "dislike",
  laughing: "laugh",
  exclamation: "emphasize",
  question: "question",
};

export class LinqAdapter implements Adapter<LinqThreadId, LinqRawMessage> {
  readonly name = "linq";

  private readonly apiToken: string;
  private readonly signingSecret?: string;
  private readonly phoneNumber?: string;
  private readonly logger: Logger;
  private readonly formatConverter = new LinqFormatConverter();
  private readonly client: ReturnType<typeof createClient<paths>>;

  private chat: ChatInstance | null = null;
  private _userName: string;

  get userName(): string {
    return this._userName;
  }

  get botUserId(): string | undefined {
    return this.phoneNumber;
  }

  constructor(config: LinqAdapterConfig = {}) {
    const apiToken = config.apiToken ?? process.env.LINQ_API_TOKEN;
    if (!apiToken) {
      throw new ValidationError(
        "linq",
        "apiToken is required. Set LINQ_API_TOKEN or provide it in config."
      );
    }

    this.apiToken = apiToken;
    this.signingSecret =
      config.signingSecret ?? process.env.LINQ_SIGNING_SECRET;
    this.phoneNumber = config.phoneNumber ?? process.env.LINQ_PHONE_NUMBER;
    this.logger = config.logger ?? new ConsoleLogger("info").child("linq");
    this._userName = config.userName ?? "bot";

    this.client = createClient<paths>({
      baseUrl: LINQ_API_BASE,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
      },
    });
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    const chatUserName = chat.getUserName?.();
    if (typeof chatUserName === "string" && chatUserName.trim()) {
      this._userName = chatUserName;
    }

    this.logger.info("Linq adapter initialized", {
      phoneNumber: this.phoneNumber,
    });
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    let body: string;
    try {
      body = await request.text();
    } catch {
      return new Response("Invalid request body", { status: 400 });
    }

    if (this.signingSecret) {
      const signature = request.headers.get(WEBHOOK_SIGNATURE_HEADER);
      const timestamp = request.headers.get(WEBHOOK_TIMESTAMP_HEADER);

      if (!(signature && timestamp)) {
        this.logger.warn("Linq webhook missing signature or timestamp headers");
        return new Response("Missing signature headers", { status: 401 });
      }

      const timestampNum = Number.parseInt(timestamp, 10);
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestampNum) > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
        this.logger.warn("Linq webhook timestamp out of tolerance");
        return new Response("Timestamp out of tolerance", { status: 401 });
      }

      const isValid = await this.verifySignature(signature, timestamp, body);
      if (!isValid) {
        this.logger.warn("Linq webhook signature verification failed");
        return new Response("Invalid signature", { status: 401 });
      }
    }

    let payload: LinqWebhookPayload;
    try {
      payload = JSON.parse(body) as LinqWebhookPayload;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring Linq webhook");
      return new Response("OK", { status: 200 });
    }

    try {
      this.routeWebhookEvent(payload, options);
    } catch (error) {
      this.logger.warn("Failed to process Linq webhook event", {
        error: String(error),
        eventType: payload.event_type,
        eventId: payload.event_id,
      });
    }

    return new Response("OK", { status: 200 });
  }

  encodeThreadId(platformData: LinqThreadId): string {
    return `linq:${platformData.chatId}`;
  }

  decodeThreadId(threadId: string): LinqThreadId {
    const parts = threadId.split(":");
    if (parts[0] !== "linq" || parts.length !== 2 || !parts[1]) {
      throw new ValidationError("linq", `Invalid Linq thread ID: ${threadId}`);
    }
    return { chatId: parts[1] };
  }

  channelIdFromThreadId(threadId: string): string {
    return this.decodeThreadId(threadId).chatId;
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<LinqRawMessage>> {
    const { chatId } = this.decodeThreadId(threadId);

    const card = extractCard(message);
    const text = card
      ? cardToFallbackText(card)
      : this.formatConverter.renderPostable(message);

    if (!text.trim()) {
      throw new ValidationError("linq", "Message text cannot be empty");
    }

    const files = extractFiles(message);
    const parts: unknown[] = [{ type: "text", value: text }];

    for (const file of files) {
      try {
        const attachmentId = await this.uploadFile(file);
        parts.push({ type: "media", attachment_id: attachmentId });
      } catch (error) {
        this.logger.warn("Failed to upload file, skipping attachment", {
          filename: file.filename,
          error: String(error),
        });
      }
    }

    const { data, error, response } = await this.client.POST(
      "/v3/chats/{chatId}/messages",
      {
        params: { path: { chatId } },
        body: {
          message: {
            parts: parts as [{ type: "text"; value: string }],
          },
        },
      }
    );

    if (error || !data) {
      this.handleApiError(response, "postMessage");
    }

    const sentMessage = data.message;

    return {
      id: sentMessage.id,
      threadId,
      raw: this.sentMessageToRawMessage(sentMessage, chatId),
    };
  }

  async editMessage(
    _threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<LinqRawMessage>> {
    const card = extractCard(message);
    const text = card
      ? cardToFallbackText(card)
      : this.formatConverter.renderPostable(message);

    if (!text.trim()) {
      throw new ValidationError("linq", "Message text cannot be empty");
    }

    const { data, error, response } = await this.client.PATCH(
      "/v3/messages/{messageId}",
      {
        params: { path: { messageId } },
        body: {
          part_index: 0,
          text,
        },
      }
    );

    if (error || !data) {
      this.handleApiError(response, "editMessage");
    }

    const threadId = this.encodeThreadId({ chatId: data.chat_id });

    return {
      id: data.id,
      threadId,
      raw: data,
    };
  }

  async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    const { chatId } = this.decodeThreadId(_threadId);

    const { error, response } = await this.client.DELETE(
      "/v3/messages/{messageId}",
      {
        params: { path: { messageId } },
        body: { chat_id: chatId },
      }
    );

    if (error) {
      this.handleApiError(response, "deleteMessage");
    }
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<LinqRawMessage>> {
    const { chatId } = this.decodeThreadId(threadId);
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));

    const { data, error, response } = await this.client.GET(
      "/v3/chats/{chatId}/messages",
      {
        params: {
          path: { chatId },
          query: {
            limit,
            cursor: options.cursor ?? undefined,
          },
        },
      }
    );

    if (error || !data) {
      this.handleApiError(response, "fetchMessages");
    }

    const messages = data.messages.map((msg) =>
      this.parseLinqMessage(msg, threadId)
    );

    return {
      messages,
      nextCursor: data.next_cursor ?? undefined,
    };
  }

  async fetchMessage(
    threadId: string,
    messageId: string
  ): Promise<Message<LinqRawMessage> | null> {
    const { data, error } = await this.client.GET("/v3/messages/{messageId}", {
      params: { path: { messageId } },
    });

    if (error || !data) {
      return null;
    }

    return this.parseLinqMessage(data, threadId);
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { chatId } = this.decodeThreadId(threadId);

    const { data, error, response } = await this.client.GET(
      "/v3/chats/{chatId}",
      {
        params: { path: { chatId } },
      }
    );

    if (error || !data) {
      this.handleApiError(response, "fetchThread");
    }

    return this.chatToThreadInfo(data, threadId);
  }

  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const threadId = this.encodeThreadId({ chatId: channelId });
    const { chatId } = this.decodeThreadId(threadId);

    const { data, error, response } = await this.client.GET(
      "/v3/chats/{chatId}",
      {
        params: { path: { chatId } },
      }
    );

    if (error || !data) {
      this.handleApiError(response, "fetchChannelInfo");
    }

    return {
      id: channelId,
      name: data.display_name ?? channelId,
      isDM: !data.is_group,
      memberCount: data.handles?.length,
      metadata: { chat: data },
    };
  }

  // TODO: Linq chats can be group chats (is_group). This synchronous method
  // can't call the API, so we default to true. Use fetchThread/fetchChannelInfo
  // for accurate isDM values.
  isDM(_threadId: string): boolean {
    return true;
  }

  async addReaction(
    _threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const reactionType = this.emojiToLinqReaction(emoji);

    const body: Record<string, unknown> = {
      operation: "add",
      type: reactionType.type,
    };
    if (reactionType.customEmoji) {
      body.custom_emoji = reactionType.customEmoji;
    }

    const { error, response } = await this.client.POST(
      "/v3/messages/{messageId}/reactions",
      {
        params: { path: { messageId } },
        body: body as { operation: "add"; type: "love" },
      }
    );

    if (error) {
      this.handleApiError(response, "addReaction");
    }
  }

  async removeReaction(
    _threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const reactionType = this.emojiToLinqReaction(emoji);

    const body: Record<string, unknown> = {
      operation: "remove",
      type: reactionType.type,
    };
    if (reactionType.customEmoji) {
      body.custom_emoji = reactionType.customEmoji;
    }

    const { error, response } = await this.client.POST(
      "/v3/messages/{messageId}/reactions",
      {
        params: { path: { messageId } },
        body: body as { operation: "remove"; type: "love" },
      }
    );

    if (error) {
      this.handleApiError(response, "removeReaction");
    }
  }

  async startTyping(threadId: string): Promise<void> {
    const { chatId } = this.decodeThreadId(threadId);

    const { error, response } = await this.client.POST(
      "/v3/chats/{chatId}/typing",
      {
        params: { path: { chatId } },
      }
    );

    if (error) {
      this.handleApiError(response, "startTyping");
    }
  }

  async openDM(userId: string): Promise<string> {
    if (!this.phoneNumber) {
      throw new ValidationError(
        "linq",
        "phoneNumber is required for openDM. Set LINQ_PHONE_NUMBER or provide it in config."
      );
    }

    const { data, error, response } = await this.client.POST("/v3/chats", {
      body: {
        from: this.phoneNumber,
        to: [userId],
        message: {
          parts: [{ type: "text", value: " " }],
        },
      },
    });

    if (error || !data) {
      this.handleApiError(response, "openDM");
    }

    return this.encodeThreadId({ chatId: data.chat.id });
  }

  async postChannelMessage(
    channelId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<LinqRawMessage>> {
    const threadId = this.encodeThreadId({ chatId: channelId });
    return this.postMessage(threadId, message);
  }

  async fetchChannelMessages(
    channelId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<LinqRawMessage>> {
    const threadId = this.encodeThreadId({ chatId: channelId });
    return this.fetchMessages(threadId, options);
  }

  async listThreads(
    _channelId: string,
    options: ListThreadsOptions = {}
  ): Promise<ListThreadsResult<LinqRawMessage>> {
    if (!this.phoneNumber) {
      throw new ValidationError(
        "linq",
        "phoneNumber is required for listThreads. Set LINQ_PHONE_NUMBER or provide it in config."
      );
    }

    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));

    const { data, error, response } = await this.client.GET("/v3/chats", {
      params: {
        query: {
          from: this.phoneNumber,
          limit,
          cursor: options.cursor ?? undefined,
        },
      },
    });

    if (error || !data) {
      this.handleApiError(response, "listThreads");
    }

    const threads = await Promise.all(
      data.chats.map(async (chat) => {
        const threadId = this.encodeThreadId({ chatId: chat.id });
        const messagesResult = await this.fetchMessages(threadId, { limit: 1 });
        const rootMessage =
          messagesResult.messages[0] ?? this.createEmptyMessage(chat, threadId);

        return {
          id: threadId,
          rootMessage,
          lastReplyAt: chat.updated_at ? new Date(chat.updated_at) : undefined,
        };
      })
    );

    return {
      threads,
      nextCursor: data.next_cursor ?? undefined,
    };
  }

  parseMessage(raw: LinqRawMessage): Message<LinqRawMessage> {
    const threadId = this.encodeThreadId({ chatId: raw.chat_id });
    return this.parseLinqMessage(raw, threadId);
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  private routeWebhookEvent(
    payload: LinqWebhookPayload,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      return;
    }

    const eventType = payload.event_type;

    switch (eventType) {
      case "message.received":
      case "message.sent":
      case "message.edited": {
        this.handleMessageEvent(payload, options);
        break;
      }
      case "reaction.added":
      case "reaction.removed": {
        this.handleReactionEvent(
          payload,
          eventType === "reaction.added",
          options
        );
        break;
      }
      case "message.failed": {
        const failedData = payload.data as LinqMessageFailedEvent;
        this.logger.error("Linq message send failed", {
          chatId: failedData.chat_id,
          messageId: failedData.message_id,
          code: failedData.code,
          reason: failedData.reason,
          failedAt: failedData.failed_at,
        });
        break;
      }
      case "message.delivered":
      case "message.read": {
        this.logger.debug("Linq delivery status event", {
          eventType,
          eventId: payload.event_id,
        });
        break;
      }
      default:
        this.logger.debug("Ignoring Linq webhook event", {
          eventType,
          eventId: payload.event_id,
        });
    }
  }

  private handleMessageEvent(
    payload: LinqWebhookPayload,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      return;
    }

    const eventData = payload.data as LinqMessageEventV2;
    const chatId = eventData.chat?.id;
    if (!chatId) {
      this.logger.warn("Linq message webhook missing chat ID");
      return;
    }

    const threadId = this.encodeThreadId({ chatId });

    const isEdited = payload.event_type === "message.edited";
    const message = this.parseWebhookMessage(eventData, threadId, isEdited);

    this.chat.processMessage(this, threadId, message, options);
  }

  private handleReactionEvent(
    payload: LinqWebhookPayload,
    added: boolean,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      return;
    }

    const data = payload.data as LinqReactionEventBase;
    const chatId = data.chat_id;
    if (!chatId) {
      return;
    }

    const threadId = this.encodeThreadId({ chatId });
    const messageId = data.message_id ?? "";

    const reactionType = data.reaction_type ?? "like";
    const emoji = LINQ_REACTION_MAP[reactionType] ?? reactionType;

    const handle = data.from_handle?.handle ?? data.from ?? "unknown";

    this.chat.processReaction(
      {
        adapter: this,
        threadId,
        messageId,
        emoji: { name: emoji, toString: () => emoji, toJSON: () => emoji },
        rawEmoji: data.custom_emoji ?? reactionType,
        added,
        user: {
          userId: handle,
          userName: handle,
          fullName: handle,
          isBot: false,
          isMe: data.is_from_me ?? false,
        },
        raw: data,
      },
      options
    );
  }

  private parseLinqMessage(
    raw: LinqMessage,
    threadId: string
  ): Message<LinqRawMessage> {
    const parts = raw.parts ?? [];
    const textParts: string[] = [];
    const attachments: Attachment[] = [];

    for (const part of parts) {
      if (part.type === "text") {
        textParts.push((part as { type: "text"; value: string }).value);
      } else if (part.type === "media") {
        const mediaPart = part as {
          type: "media";
          id: string;
          url: string;
          filename: string;
          mime_type: string;
          size_bytes: number;
        };
        attachments.push({
          type: this.mimeTypeToAttachmentType(mediaPart.mime_type),
          name: mediaPart.filename,
          mimeType: mediaPart.mime_type,
          size: mediaPart.size_bytes,
          fetchData: async () => {
            const response = await fetch(mediaPart.url);
            if (!response.ok) {
              throw new NetworkError(
                "linq",
                `Failed to download attachment ${mediaPart.id}`
              );
            }
            return Buffer.from(await response.arrayBuffer());
          },
        });
      }
    }
    const text = textParts.join("\n");

    const senderHandle = raw.from_handle?.handle ?? raw.from ?? "unknown";
    const isMe = raw.is_from_me ?? false;

    return new Message<LinqRawMessage>({
      id: raw.id,
      threadId,
      text,
      formatted: this.formatConverter.toAst(text),
      raw,
      author: {
        userId: senderHandle,
        userName: senderHandle,
        fullName: senderHandle,
        isBot: false,
        isMe,
      },
      metadata: {
        dateSent: raw.created_at ? new Date(raw.created_at) : new Date(),
        edited: false,
      },
      attachments,
      isMention: !isMe,
    });
  }

  private parseWebhookMessage(
    eventData: LinqMessageEventV2,
    threadId: string,
    isEdited = false
  ): Message<LinqRawMessage> {
    const parts = eventData.parts ?? [];
    const textParts: string[] = [];
    const attachments: Attachment[] = [];

    for (const part of parts) {
      if (part.type === "text") {
        textParts.push((part as { type: "text"; value: string }).value);
      } else if (part.type === "media") {
        const mediaPart = part as {
          type: "media";
          id: string;
          url: string;
          filename: string;
          mime_type: string;
          size_bytes: number;
        };
        attachments.push({
          type: this.mimeTypeToAttachmentType(mediaPart.mime_type),
          name: mediaPart.filename,
          mimeType: mediaPart.mime_type,
          size: mediaPart.size_bytes,
          fetchData: async () => {
            const response = await fetch(mediaPart.url);
            if (!response.ok) {
              throw new NetworkError(
                "linq",
                `Failed to download attachment ${mediaPart.id}`
              );
            }
            return Buffer.from(await response.arrayBuffer());
          },
        });
      }
    }
    const text = textParts.join("\n");

    const senderHandle = eventData.sender_handle?.handle ?? "unknown";
    const isMe = eventData.direction === "outbound";

    const chatId = eventData.chat?.id ?? "";
    const messageId = eventData.id ?? "";

    const rawMessage: LinqRawMessage = {
      id: messageId,
      chat_id: chatId,
      is_from_me: isMe,
      is_delivered: false,
      is_read: false,
      created_at: eventData.sent_at ?? new Date().toISOString(),
      updated_at: eventData.sent_at ?? new Date().toISOString(),
      parts: eventData.parts as LinqMessage["parts"],
      from_handle: eventData.sender_handle as LinqMessage["from_handle"],
    };

    return new Message<LinqRawMessage>({
      id: messageId,
      threadId,
      text,
      formatted: this.formatConverter.toAst(text),
      raw: rawMessage,
      author: {
        userId: senderHandle,
        userName: senderHandle,
        fullName: senderHandle,
        isBot: false,
        isMe,
      },
      metadata: {
        dateSent: eventData.sent_at ? new Date(eventData.sent_at) : new Date(),
        edited: isEdited,
      },
      attachments,
      isMention: !isMe,
    });
  }

  private async uploadFile(file: {
    data: Buffer | Blob | ArrayBuffer;
    filename: string;
    mimeType?: string;
  }): Promise<string> {
    const mimeType = file.mimeType ?? "application/octet-stream";
    let fileData: Buffer;
    if (Buffer.isBuffer(file.data)) {
      fileData = file.data;
    } else if (file.data instanceof ArrayBuffer) {
      fileData = Buffer.from(file.data);
    } else {
      fileData = Buffer.from(await (file.data as Blob).arrayBuffer());
    }

    const { data, error, response } = await this.client.POST(
      "/v3/attachments",
      {
        body: {
          filename: file.filename,
          content_type:
            mimeType as components["schemas"]["SupportedContentType"],
          size_bytes: fileData.byteLength,
        },
      }
    );

    if (error || !data) {
      this.handleApiError(response, "uploadFile");
    }

    const uploadResponse = await fetch(data.upload_url, {
      method: data.http_method,
      headers: data.required_headers,
      body: fileData,
    });

    if (!uploadResponse.ok) {
      throw new NetworkError(
        "linq",
        `File upload PUT failed with status ${uploadResponse.status}`
      );
    }

    return data.attachment_id;
  }

  private createEmptyMessage(
    chat: LinqChat,
    threadId: string
  ): Message<LinqRawMessage> {
    const raw: LinqRawMessage = {
      id: "",
      chat_id: chat.id,
      is_from_me: false,
      is_delivered: false,
      is_read: false,
      created_at: chat.created_at ?? new Date().toISOString(),
      updated_at: chat.updated_at ?? new Date().toISOString(),
      parts: null,
    };

    return new Message<LinqRawMessage>({
      id: "",
      threadId,
      text: "",
      formatted: this.formatConverter.toAst(""),
      raw,
      author: {
        userId: "unknown",
        userName: "unknown",
        fullName: "unknown",
        isBot: false,
        isMe: false,
      },
      metadata: {
        dateSent: chat.created_at ? new Date(chat.created_at) : new Date(),
        edited: false,
      },
      attachments: [],
      isMention: false,
    });
  }

  private async verifySignature(
    signature: string,
    timestamp: string,
    body: string
  ): Promise<boolean> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(this.signingSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signedPayload = `${timestamp}.${body}`;
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(signedPayload)
    );

    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    try {
      return timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch {
      return false;
    }
  }

  private handleApiError(response: Response, operation: string): never {
    const status = response.status;

    if (status === 401 || status === 403) {
      throw new AuthenticationError(
        "linq",
        `${operation} failed: unauthorized (${status})`
      );
    }
    if (status === 404) {
      throw new ResourceNotFoundError("linq", "resource", operation);
    }
    if (status === 429) {
      throw new AdapterRateLimitError("linq");
    }
    throw new NetworkError("linq", `${operation} failed with status ${status}`);
  }

  private chatToThreadInfo(chat: LinqChat, threadId: string): ThreadInfo {
    return {
      id: threadId,
      channelId: chat.id,
      channelName: chat.display_name ?? chat.id,
      isDM: !chat.is_group,
      metadata: { chat },
    };
  }

  private sentMessageToRawMessage(
    sentMessage: {
      id: string;
      parts?: unknown[];
      status?: string;
      created_at?: string;
    },
    chatId: string
  ): LinqRawMessage {
    return {
      id: sentMessage.id,
      chat_id: chatId,
      is_from_me: true,
      is_delivered: false,
      is_read: false,
      created_at: sentMessage.created_at ?? new Date().toISOString(),
      updated_at: sentMessage.created_at ?? new Date().toISOString(),
      parts: sentMessage.parts as LinqMessage["parts"],
    };
  }

  private emojiToLinqReaction(emoji: EmojiValue | string): {
    type: string;
    customEmoji?: string;
  } {
    const emojiStr = typeof emoji === "string" ? emoji : emoji.name;
    const mapped = EMOJI_TO_LINQ_REACTION[emojiStr];

    if (mapped) {
      return { type: mapped };
    }

    return { type: "custom", customEmoji: emojiStr };
  }

  private mimeTypeToAttachmentType(mimeType: string): Attachment["type"] {
    if (mimeType.startsWith("image/")) {
      return "image";
    }
    if (mimeType.startsWith("video/")) {
      return "video";
    }
    if (mimeType.startsWith("audio/")) {
      return "audio";
    }
    return "file";
  }
}

export function createLinqAdapter(config?: LinqAdapterConfig): LinqAdapter {
  return new LinqAdapter(config ?? {});
}

export { LinqFormatConverter } from "./markdown";
export type {
  LinqAdapterConfig,
  LinqChat,
  LinqChatHandle,
  LinqMessage,
  LinqMessageEventV2,
  LinqMessageFailedEvent,
  LinqRawMessage,
  LinqReactionEventBase,
  LinqReactionType,
  LinqThreadId,
  LinqWebhookEventType,
  LinqWebhookPayload,
} from "./types";
