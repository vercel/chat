import { timingSafeEqual } from "node:crypto";
import {
  AdapterError,
  AdapterRateLimitError,
  extractCard,
  ValidationError,
} from "@chat-adapter/shared";
import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
  Author,
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
import { ConsoleLogger, Message } from "chat";
import { ZaloFormatConverter } from "./markdown";
import type {
  ZaloAdapterConfig,
  ZaloApiResponse,
  ZaloGetMeResponse,
  ZaloInboundMessage,
  ZaloRawMessage,
  ZaloSendResponse,
  ZaloThreadId,
  ZaloWebhookResult,
} from "./types";

/** Maximum message length for Zalo Bot API */
const ZALO_MESSAGE_LIMIT = 2000;

/**
 * Split text into chunks that fit within Zalo's 2000-character message limit,
 * breaking on paragraph boundaries when possible, then line boundaries,
 * and finally at the character limit as a last resort.
 */
export function splitMessage(text: string): string[] {
  if (text.length <= ZALO_MESSAGE_LIMIT) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > ZALO_MESSAGE_LIMIT) {
    const slice = remaining.slice(0, ZALO_MESSAGE_LIMIT);

    // Try to break at a paragraph boundary
    let breakIndex = slice.lastIndexOf("\n\n");
    if (breakIndex === -1 || breakIndex < ZALO_MESSAGE_LIMIT / 2) {
      // Try a line boundary
      breakIndex = slice.lastIndexOf("\n");
    }
    if (breakIndex === -1 || breakIndex < ZALO_MESSAGE_LIMIT / 2) {
      // Hard break at the limit
      breakIndex = ZALO_MESSAGE_LIMIT;
    }

    chunks.push(remaining.slice(0, breakIndex).trimEnd());
    remaining = remaining.slice(breakIndex).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

// Re-export types
export type { ZaloAdapterConfig, ZaloRawMessage, ZaloThreadId } from "./types";

/**
 * Zalo adapter for chat SDK.
 *
 * Supports messaging via the Zalo Bot Platform API.
 * Handles both PRIVATE and GROUP chat types.
 *
 * @example
 * ```typescript
 * import { Chat } from "chat";
 * import { createZaloAdapter } from "@chat-adapter/zalo";
 * import { MemoryState } from "@chat-adapter/state-memory";
 *
 * const chat = new Chat({
 *   userName: "my-bot",
 *   adapters: {
 *     zalo: createZaloAdapter(),
 *   },
 *   state: new MemoryState(),
 * });
 * ```
 */
export class ZaloAdapter implements Adapter<ZaloThreadId, ZaloRawMessage> {
  readonly name = "zalo";
  readonly lockScope = "channel" as const;
  readonly persistMessageHistory = true;
  readonly userName: string;

  private readonly botToken: string;
  private readonly webhookSecret: string;
  private readonly logger: Logger;
  private readonly formatConverter = new ZaloFormatConverter();
  private chat: ChatInstance | null = null;
  private _botUserId: string | null = null;

  /** Bot user ID used for self-message detection */
  get botUserId(): string | undefined {
    return this._botUserId ?? undefined;
  }

  constructor(config: ZaloAdapterConfig) {
    this.botToken = config.botToken;
    this.webhookSecret = config.webhookSecret;
    this.logger = config.logger;
    this.userName = config.userName;
  }

  /**
   * Initialize the adapter and validate the bot token via getMe.
   */
  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    const me = await this.apiRequest<ZaloGetMeResponse>("getMe");
    this._botUserId = me.id;
    this.logger.info("Zalo adapter initialized", {
      botId: me.id,
      accountName: me.account_name,
    });
  }

  /**
   * Handle incoming webhook from Zalo Bot Platform.
   *
   * Verifies the X-Bot-Api-Secret-Token header, parses the payload,
   * and dispatches messages to the Chat instance.
   */
  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    // Verify secret token
    const token = request.headers.get("x-bot-api-secret-token");
    if (!this.verifySecretToken(token)) {
      this.logger.warn("Zalo webhook: invalid secret token");
      return new Response("Unauthorized", { status: 401 });
    }

    const body = await request.text();
    this.logger.debug("Zalo webhook raw body", {
      body: body.substring(0, 500),
    });

    let payload: ZaloWebhookResult;
    try {
      payload = JSON.parse(body) as ZaloWebhookResult;
    } catch {
      this.logger.error("Zalo webhook invalid JSON", {
        bodyPreview: body.substring(0, 200),
      });
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!payload) {
      this.logger.debug("Zalo webhook: payload ok=false or missing result", {
        ok: false,
      });
      return new Response("OK", { status: 200 });
    }

    const { event_name, message } = payload;

    switch (event_name) {
      case "message.text.received":
      case "message.image.received":
      case "message.sticker.received":
        this.handleInboundMessage(message, options);
        break;
      case "message.unsupported.received":
        this.logger.debug("Zalo webhook: unsupported message type, ignoring", {
          messageId: message.message_id,
        });
        break;
      default:
        this.logger.debug("Zalo webhook: unknown event, ignoring", {
          event_name,
        });
    }

    return new Response("OK", { status: 200 });
  }

  /**
   * Handle an inbound message from a user.
   */
  private handleInboundMessage(
    inbound: ZaloInboundMessage,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring message");
      return;
    }

    const threadId = this.encodeThreadId({ chatId: inbound.chat.id });
    const raw: ZaloRawMessage = { message: inbound };
    const message = this.parseMessage(raw);
    this.chat.processMessage(this, threadId, message, options);
  }

  /**
   * Verify the webhook secret token using timing-safe comparison.
   */
  private verifySecretToken(token: string | null): boolean {
    if (!token) {
      return false;
    }

    try {
      return timingSafeEqual(
        Buffer.from(token),
        Buffer.from(this.webhookSecret)
      );
    } catch {
      return false;
    }
  }

  /**
   * Parse platform message format to normalized format.
   */
  parseMessage(raw: ZaloRawMessage): Message<ZaloRawMessage> {
    const { message } = raw;

    // Extract text content based on message type
    let text: string;
    const attachments: Attachment[] = [];

    if (message.text) {
      text = message.text;
    } else if (message.photo) {
      text = message.caption ?? "[Image]";
      attachments.push({ type: "image", url: message.photo });
    } else if (message.sticker) {
      text = "[Sticker]";
    } else {
      text = "[Unsupported message]";
    }

    const threadId = this.encodeThreadId({ chatId: message.chat.id });
    const formatted: FormattedContent = this.formatConverter.toAst(text);

    const author: Author = {
      userId: message.from.id,
      userName: message.from.display_name,
      fullName: message.from.display_name,
      isBot: message.from.is_bot,
      isMe: message.from.id === this._botUserId,
    };

    return new Message<ZaloRawMessage>({
      id: message.message_id,
      threadId,
      text,
      formatted,
      raw,
      author,
      metadata: {
        dateSent: new Date(message.date),
        edited: false,
      },
      attachments,
    });
  }

  /**
   * Send a message to a Zalo chat.
   */
  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<ZaloRawMessage>> {
    const { chatId } = this.decodeThreadId(threadId);

    // Check for photo message
    if (typeof message === "object" && "raw" in message) {
      try {
        const rawMessage = JSON.parse(message.raw) as {
          photo: string;
          caption?: string;
        };

        const response = await this.sendPhoto(
          chatId,
          rawMessage.photo,
          rawMessage.caption
        );
        return {
          id: response.message_id,
          threadId,
          raw: {
            message: {
              message_id: response.message_id,
              date: response.date,
              chat: { id: chatId, chat_type: "PRIVATE" },
              from: {
                id: this._botUserId ?? "",
                display_name: this.userName,
                is_bot: true,
              },
              photo: rawMessage.photo,
              caption: rawMessage.caption,
            },
          },
        };
      } catch (_error) {
        // If parsing fails, throw an error about unsupported message format
        throw new AdapterError(
          "Zalo adapter does not support this message type. Please convert your card to text or image before sending.",
          "zalo"
        );
      }
    }

    const card = extractCard(message);
    if (card) {
      // Zalo doesn't support rich cards, throw an error if the message contains unsupported content
      throw new AdapterError(
        "Zalo adapter does not support card messages. Please convert your card to text or image before sending.",
        "zalo"
      );
    }

    const body = this.formatConverter.renderPostable(message);
    return this.sendTextMessage(threadId, chatId, body);
  }

  /**
   * Split text into chunks at the 2000-character limit.
   */
  splitMessage(text: string): string[] {
    return splitMessage(text);
  }

  /**
   * Send a single text message (must be within 2000-char limit).
   */
  private async sendSingleTextMessage(
    threadId: string,
    chatId: string,
    text: string
  ): Promise<RawMessage<ZaloRawMessage>> {
    const response = await this.apiRequest<ZaloSendResponse>("sendMessage", {
      chat_id: chatId,
      text,
    });

    return {
      id: response.message_id,
      threadId,
      raw: {
        message: {
          message_id: response.message_id,
          date: response.date,
          chat: { id: chatId, chat_type: "PRIVATE" },
          from: {
            id: this._botUserId ?? "",
            display_name: this.userName,
            is_bot: true,
          },
          text,
        },
      },
    };
  }

  /**
   * Send a text message, splitting into multiple messages if it exceeds
   * Zalo's 2000-character limit. Returns the last message sent.
   */
  private async sendTextMessage(
    threadId: string,
    chatId: string,
    text: string
  ): Promise<RawMessage<ZaloRawMessage>> {
    const chunks = this.splitMessage(text);
    let result: RawMessage<ZaloRawMessage> | undefined;

    for (const chunk of chunks) {
      result = await this.sendSingleTextMessage(threadId, chatId, chunk);
    }

    return result as RawMessage<ZaloRawMessage>;
  }

  /**
   * Send a photo to a Zalo chat.
   */
  async sendPhoto(
    chatId: string,
    photoUrl: string,
    caption?: string
  ): Promise<ZaloSendResponse> {
    return this.apiRequest<ZaloSendResponse>("sendPhoto", {
      chat_id: chatId,
      photo: photoUrl,
      ...(caption ? { caption } : {}),
    });
  }

  /**
   * Edit a message. Not supported by Zalo Bot API.
   */
  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage
  ): Promise<RawMessage<ZaloRawMessage>> {
    throw new Error("Zalo does not support editing messages.");
  }

  /**
   * Delete a message. Not supported by Zalo Bot API.
   */
  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    throw new Error("Zalo does not support deleting messages.");
  }

  /**
   * Add a reaction. Not supported by Zalo Bot API.
   */
  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new Error("Zalo does not support reactions.");
  }

  /**
   * Remove a reaction. Not supported by Zalo Bot API.
   */
  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new Error("Zalo does not support reactions.");
  }

  /**
   * Start typing indicator via sendChatAction.
   */
  async startTyping(threadId: string, _status?: string): Promise<void> {
    const { chatId } = this.decodeThreadId(threadId);
    try {
      await this.apiRequest("sendChatAction", {
        chat_id: chatId,
        action: "typing",
      });
    } catch (error) {
      // Typing is best-effort — don't propagate errors
      this.logger.debug("Zalo startTyping failed (non-fatal)", { error });
    }
  }

  /**
   * Stream a message by buffering all chunks and sending as a single message.
   * Zalo doesn't support message editing.
   */
  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    _options?: StreamOptions
  ): Promise<RawMessage<ZaloRawMessage>> {
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
   * Fetch messages. Not supported by Zalo Bot API.
   */
  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions
  ): Promise<FetchResult<ZaloRawMessage>> {
    this.logger.debug(
      "fetchMessages not supported on Zalo - message history is not available via Bot API"
    );
    return { messages: [] };
  }

  /**
   * Fetch thread info from decoded thread ID.
   */
  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { chatId } = this.decodeThreadId(threadId);

    return {
      id: threadId,
      channelId: threadId,
      channelName: `Zalo: ${chatId}`,
      isDM: true,
      metadata: { chatId },
    };
  }

  /**
   * Encode a Zalo thread ID.
   *
   * Format: zalo:{chatId}
   */
  encodeThreadId(platformData: ZaloThreadId): string {
    return `zalo:${platformData.chatId}`;
  }

  /**
   * Decode a Zalo thread ID.
   *
   * Format: zalo:{chatId}
   */
  decodeThreadId(threadId: string): ZaloThreadId {
    if (!threadId.startsWith("zalo:")) {
      throw new ValidationError("zalo", `Invalid Zalo thread ID: ${threadId}`);
    }

    const chatId = threadId.slice(5);
    if (!chatId) {
      throw new ValidationError(
        "zalo",
        `Invalid Zalo thread ID format: ${threadId}`
      );
    }

    return { chatId };
  }

  /**
   * Derive channel ID from a Zalo thread ID.
   * Zalo has no threading — channel === thread.
   */
  channelIdFromThreadId(threadId: string): string {
    return threadId;
  }

  /**
   * Zalo conversations default to DM (PRIVATE).
   * We don't store chat_type in the thread ID.
   */
  isDM(_threadId: string): boolean {
    return true;
  }

  /**
   * Open a DM with a user. Returns the thread ID for the conversation.
   */
  async openDM(userId: string): Promise<string> {
    return this.encodeThreadId({ chatId: userId });
  }

  /**
   * Render formatted content to plain text.
   */
  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  // =============================================================================
  // Private helpers
  // =============================================================================

  /**
   * Make an authenticated request to the Zalo Bot API.
   * Note: bot token is embedded in the URL path — never log it.
   */
  private async apiRequest<T = unknown>(
    method: string,
    body?: unknown
  ): Promise<T> {
    const url = `https://bot-api.zaloplatforms.com/bot${this.botToken}/${method}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (response.status === 429) {
      this.logger.error("Zalo API rate limited", { method });
      throw new AdapterRateLimitError("zalo");
    }

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error("Zalo API HTTP error", {
        status: response.status,
        body: errorBody,
        method,
      });
      throw new AdapterError(
        `Zalo API error: ${response.status} ${errorBody}`,
        "zalo"
      );
    }

    const data = (await response.json()) as ZaloApiResponse<T>;

    if (!data.ok) {
      this.logger.error("Zalo API returned ok=false", {
        error_code: data.error_code,
        description: data.description,
        method,
      });

      if (data.error_code === 429) {
        throw new AdapterRateLimitError("zalo");
      }

      throw new AdapterError(
        `Zalo API error (${data.error_code ?? "unknown"}): ${data.description ?? "unknown error"}`,
        "zalo"
      );
    }

    return data.result as T;
  }
}

/**
 * Factory function to create a Zalo adapter.
 *
 * @example
 * ```typescript
 * const adapter = createZaloAdapter({
 *   botToken: process.env.ZALO_BOT_TOKEN!,
 *   webhookSecret: process.env.ZALO_WEBHOOK_SECRET!,
 * });
 * ```
 */
export function createZaloAdapter(config?: {
  botToken?: string;
  logger?: Logger;
  userName?: string;
  webhookSecret?: string;
}): ZaloAdapter {
  const logger = config?.logger ?? new ConsoleLogger("info").child("zalo");

  const botToken = config?.botToken ?? process.env.ZALO_BOT_TOKEN;
  if (!botToken) {
    throw new ValidationError(
      "zalo",
      "botToken is required. Set ZALO_BOT_TOKEN or provide it in config."
    );
  }

  const webhookSecret =
    config?.webhookSecret ?? process.env.ZALO_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new ValidationError(
      "zalo",
      "webhookSecret is required. Set ZALO_WEBHOOK_SECRET or provide it in config."
    );
  }

  const userName =
    config?.userName ?? process.env.ZALO_BOT_USERNAME ?? "zalo-bot";

  return new ZaloAdapter({ botToken, webhookSecret, userName, logger });
}
