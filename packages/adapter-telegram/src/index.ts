import {
  extractCard,
  extractFiles,
  NetworkError,
  ValidationError,
} from "@chat-adapter/shared";
import type {
  ActionEvent,
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
import { ConsoleLogger, defaultEmojiResolver, Message } from "chat";
import { Api, InputFile } from "grammy";
import { cardToFallbackText, cardToTelegram } from "./cards";
import { TelegramFormatConverter } from "./markdown";
import type {
  TelegramAdapterConfig,
  TelegramCallbackQuery,
  TelegramRawMessage,
  TelegramThreadId,
  TelegramUpdate,
} from "./types";

export { cardToFallbackText, cardToTelegram } from "./cards";
export { TelegramFormatConverter } from "./markdown";
export type {
  TelegramAdapterConfig,
  TelegramCallbackQuery,
  TelegramRawMessage,
  TelegramThreadId,
  TelegramUpdate,
} from "./types";

export class TelegramAdapter
  implements Adapter<TelegramThreadId, TelegramRawMessage>
{
  readonly name = "telegram";
  readonly userName: string;

  private readonly api: Api;
  private readonly botToken: string;
  private readonly secretToken: string | undefined;
  private chat: ChatInstance | null = null;
  private readonly logger: Logger;
  private readonly formatConverter = new TelegramFormatConverter();
  private _botUserId: string | null = null;
  private _botUsername: string | null = null;

  get botUserId(): string | undefined {
    return this._botUserId || undefined;
  }

  constructor(config: TelegramAdapterConfig) {
    this.botToken = config.botToken;
    this.secretToken = config.secretToken;
    this.logger = config.logger;
    this.userName = config.userName || "bot";
    this.api = new Api(config.botToken);
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    try {
      const me = await this.api.getMe();
      this._botUserId = String(me.id);
      this._botUsername = me.username || null;
      if (me.username) {
        (this as { userName: string }).userName = me.username;
      }
      this.logger.info("Telegram auth completed", {
        botUserId: this._botUserId,
        botUsername: this._botUsername,
      });
    } catch (error) {
      this.logger.warn("Could not fetch bot info via getMe", { error });
    }
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    const body = await request.text();
    this.logger.debug("Telegram webhook raw body", { body });

    // Verify secret token if configured
    if (this.secretToken) {
      const headerToken = request.headers.get(
        "x-telegram-bot-api-secret-token"
      );
      if (headerToken !== this.secretToken) {
        return new Response("Invalid secret token", { status: 401 });
      }
    }

    let update: TelegramUpdate;
    try {
      update = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Route based on update type
    if (update.message) {
      this.handleMessage(update.message, options);
    } else if (update.callback_query) {
      this.handleCallbackQuery(update.callback_query, options);
    } else if (update.edited_message) {
      // Process edited messages as regular messages
      this.handleMessage(update.edited_message, options);
    }

    // Telegram expects fast 200 OK acknowledgment
    return new Response("ok", { status: 200 });
  }

  private handleMessage(
    message: TelegramRawMessage,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn(
        "Chat instance not initialized, ignoring Telegram message"
      );
      return;
    }

    // Skip messages without text (stickers, service messages, etc.)
    if (!message.text) {
      this.logger.debug("Skipping non-text Telegram message", {
        messageId: message.message_id,
      });
      return;
    }

    const threadId = this.encodeThreadId({
      chatId: message.chat.id,
      messageThreadId: message.message_thread_id || 0,
    });

    const parsedMessage = this.parseTelegramMessage(message, threadId);

    this.chat.processMessage(this, threadId, parsedMessage, options);
  }

  private handleCallbackQuery(
    callbackQuery: TelegramCallbackQuery,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn(
        "Chat instance not initialized, ignoring callback query"
      );
      return;
    }

    if (!callbackQuery.message) {
      this.logger.debug("Callback query without message, ignoring");
      return;
    }

    const message = callbackQuery.message;
    const threadId = this.encodeThreadId({
      chatId: message.chat.id,
      messageThreadId: message.message_thread_id || 0,
    });

    // Parse callback_data as "actionId:value" or just "actionId"
    const data = callbackQuery.data || "";
    const colonIndex = data.indexOf(":");
    const actionId = colonIndex >= 0 ? data.slice(0, colonIndex) : data;
    const value = colonIndex >= 0 ? data.slice(colonIndex + 1) : undefined;

    const actionEvent: Omit<ActionEvent, "thread" | "openModal"> & {
      adapter: TelegramAdapter;
    } = {
      actionId,
      value,
      user: {
        userId: String(callbackQuery.from.id),
        userName:
          callbackQuery.from.username ||
          callbackQuery.from.first_name ||
          "unknown",
        fullName:
          [callbackQuery.from.first_name, callbackQuery.from.last_name]
            .filter(Boolean)
            .join(" ") || "unknown",
        isBot: callbackQuery.from.is_bot ?? false,
        isMe: String(callbackQuery.from.id) === this._botUserId,
      },
      messageId: String(message.message_id),
      threadId,
      adapter: this,
      raw: callbackQuery,
    };

    this.logger.debug("Processing Telegram callback query", {
      actionId,
      value,
      callbackQueryId: callbackQuery.id,
    });

    // Answer the callback query to remove the loading spinner
    this.api
      .answerCallbackQuery(callbackQuery.id)
      .catch((error: unknown) =>
        this.logger.warn("Failed to answer callback query", { error })
      );

    this.chat.processAction(actionEvent, options);
  }

  private parseTelegramMessage(
    raw: TelegramRawMessage,
    threadId: string
  ): Message<TelegramRawMessage> {
    const text = raw.text || "";
    const from = raw.from;
    const isMe = from ? String(from.id) === this._botUserId : false;

    // Check if bot is mentioned via @username or via entity
    let isMention = false;
    if (this._botUsername && text.includes(`@${this._botUsername}`)) {
      isMention = true;
    }
    if (raw.entities) {
      for (const entity of raw.entities) {
        if (
          entity.type === "mention" &&
          this._botUsername &&
          text
            .slice(entity.offset, entity.offset + entity.length)
            .toLowerCase() === `@${this._botUsername.toLowerCase()}`
        ) {
          isMention = true;
        }
      }
    }

    // Extract attachments from photos
    const attachments: Attachment[] = [];
    if (raw.photo && raw.photo.length > 0) {
      // Use the largest photo (last in array)
      const largestPhoto = raw.photo.at(-1);
      if (largestPhoto) {
        attachments.push({
          type: "image",
          name: `photo_${largestPhoto.file_id}`,
          width: largestPhoto.width,
          height: largestPhoto.height,
          size: largestPhoto.file_size,
        });
      }
    }

    return new Message({
      id: String(raw.message_id),
      threadId,
      text: this.formatConverter.extractPlainText(text),
      formatted: this.formatConverter.toAst(text),
      author: {
        userId: from ? String(from.id) : "unknown",
        userName: from?.username || from?.first_name || "unknown",
        fullName:
          [from?.first_name, from?.last_name].filter(Boolean).join(" ") ||
          "unknown",
        isBot: from?.is_bot ?? false,
        isMe,
      },
      attachments,
      isMention,
      metadata: {
        dateSent: new Date(raw.date * 1000),
        edited: false,
      },
      raw,
    });
  }

  encodeThreadId(platformData: TelegramThreadId): string {
    return `telegram:${platformData.chatId}:${platformData.messageThreadId}`;
  }

  decodeThreadId(threadId: string): TelegramThreadId {
    const parts = threadId.split(":");
    if (parts.length !== 3 || parts[0] !== "telegram") {
      throw new ValidationError(
        "telegram",
        `Invalid Telegram thread ID: ${threadId}`
      );
    }
    return {
      chatId: Number(parts[1]),
      messageThreadId: Number(parts[2]),
    };
  }

  parseMessage(raw: TelegramRawMessage): Message<TelegramRawMessage> {
    const threadId = this.encodeThreadId({
      chatId: raw.chat.id,
      messageThreadId: raw.message_thread_id || 0,
    });
    return this.parseTelegramMessage(raw, threadId);
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<TelegramRawMessage>> {
    const { chatId, messageThreadId } = this.decodeThreadId(threadId);

    try {
      // Check for card content
      const card = extractCard(message);
      if (card) {
        const telegramCard = cardToTelegram(card);
        const result = await this.api.sendMessage(
          chatId,
          telegramCard.text || cardToFallbackText(card),
          {
            parse_mode: "MarkdownV2",
            ...(messageThreadId > 0 && {
              message_thread_id: messageThreadId,
            }),
            ...(telegramCard.reply_markup && {
              reply_markup: telegramCard.reply_markup,
            }),
          }
        );

        return {
          id: String(result.message_id),
          threadId,
          raw: result as unknown as TelegramRawMessage,
        };
      }

      // Check for file uploads
      const files = extractFiles(message);
      if (files.length > 0) {
        const file = files[0];
        if (file) {
          const text = this.formatConverter.renderPostable(message);
          // Convert data to Buffer for grammy compatibility
          let buffer: Buffer;
          if (Buffer.isBuffer(file.data)) {
            buffer = file.data;
          } else if (file.data instanceof ArrayBuffer) {
            buffer = Buffer.from(file.data);
          } else {
            // Blob
            buffer = Buffer.from(await (file.data as Blob).arrayBuffer());
          }
          const inputFile = new InputFile(buffer, file.filename);
          const result = await this.api.sendDocument(chatId, inputFile, {
            caption: text.slice(0, 1024), // Telegram caption limit
            ...(messageThreadId > 0 && {
              message_thread_id: messageThreadId,
            }),
          });
          return {
            id: String(result.message_id),
            threadId,
            raw: result as unknown as TelegramRawMessage,
          };
        }
      }

      // Regular text message
      const text = this.formatConverter.renderPostable(message);
      const result = await this.api.sendMessage(chatId, text, {
        parse_mode: "MarkdownV2",
        ...(messageThreadId > 0 && { message_thread_id: messageThreadId }),
      });

      return {
        id: String(result.message_id),
        threadId,
        raw: result as unknown as TelegramRawMessage,
      };
    } catch (error) {
      this.logger.error("Telegram sendMessage failed", { error, threadId });
      throw new NetworkError(
        "telegram",
        "Failed to send message",
        error instanceof Error ? error : undefined
      );
    }
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<TelegramRawMessage>> {
    const { chatId } = this.decodeThreadId(threadId);

    try {
      const text = this.formatConverter.renderPostable(message);

      // Check for card content (update inline keyboard)
      const card = extractCard(message);
      const telegramCard = card ? cardToTelegram(card) : null;

      const result = await this.api.editMessageText(
        chatId,
        Number(messageId),
        telegramCard?.text || text,
        {
          parse_mode: "MarkdownV2",
          ...(telegramCard?.reply_markup && {
            reply_markup: telegramCard.reply_markup,
          }),
        }
      );

      // editMessageText can return true for inline messages
      const rawResult =
        typeof result === "boolean" ? ({} as TelegramRawMessage) : result;

      return {
        id: messageId,
        threadId,
        raw: rawResult as unknown as TelegramRawMessage,
      };
    } catch (error) {
      this.logger.error("Telegram editMessageText failed", {
        error,
        threadId,
        messageId,
      });
      throw new NetworkError(
        "telegram",
        "Failed to edit message",
        error instanceof Error ? error : undefined
      );
    }
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const { chatId } = this.decodeThreadId(threadId);

    try {
      await this.api.deleteMessage(chatId, Number(messageId));
    } catch (error) {
      this.logger.error("Telegram deleteMessage failed", {
        error,
        threadId,
        messageId,
      });
      throw new NetworkError(
        "telegram",
        "Failed to delete message",
        error instanceof Error ? error : undefined
      );
    }
  }

  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const { chatId } = this.decodeThreadId(threadId);
    // Telegram uses unicode emoji - use toGChat which returns unicode
    const emojiStr =
      typeof emoji === "string" ? emoji : defaultEmojiResolver.toGChat(emoji);

    try {
      await this.api.setMessageReaction(chatId, Number(messageId), [
        // biome-ignore lint/suspicious/noExplicitAny: Telegram API expects specific emoji literals
        { type: "emoji", emoji: emojiStr as any },
      ]);
    } catch (error) {
      this.logger.error("Telegram setMessageReaction failed", {
        error,
        threadId,
        messageId,
      });
      throw new NetworkError(
        "telegram",
        "Failed to add reaction",
        error instanceof Error ? error : undefined
      );
    }
  }

  async removeReaction(
    threadId: string,
    messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    const { chatId } = this.decodeThreadId(threadId);

    try {
      // Telegram removes reactions by setting an empty reaction list
      await this.api.setMessageReaction(chatId, Number(messageId), []);
    } catch (error) {
      this.logger.error("Telegram removeReaction failed", {
        error,
        threadId,
        messageId,
      });
      throw new NetworkError(
        "telegram",
        "Failed to remove reaction",
        error instanceof Error ? error : undefined
      );
    }
  }

  async startTyping(threadId: string, _status?: string): Promise<void> {
    const { chatId } = this.decodeThreadId(threadId);

    try {
      await this.api.sendChatAction(chatId, "typing");
    } catch (error) {
      this.logger.warn("Telegram sendChatAction failed", {
        error,
        threadId,
      });
    }
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions
  ): Promise<FetchResult<TelegramRawMessage>> {
    // Telegram Bot API does not support fetching message history
    return {
      messages: [],
    };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { chatId } = this.decodeThreadId(threadId);

    try {
      const chatInfo = await this.api.getChat(chatId);
      const title =
        "title" in chatInfo
          ? (chatInfo.title as string)
          : [
              (chatInfo as { first_name?: string }).first_name,
              (chatInfo as { last_name?: string }).last_name,
            ]
              .filter(Boolean)
              .join(" ") || "Chat";

      return {
        id: threadId,
        channelId: `telegram:${chatId}`,
        channelName: title,
        metadata: {},
      };
    } catch (error) {
      this.logger.error("Telegram getChat failed", { error, threadId });
      throw new NetworkError(
        "telegram",
        "Failed to fetch thread info",
        error instanceof Error ? error : undefined
      );
    }
  }

  isDM(threadId: string): boolean {
    const { chatId } = this.decodeThreadId(threadId);
    // In Telegram, private chats have positive chat IDs
    // Groups and supergroups have negative chat IDs
    // We check by fetching chat type, but for a quick heuristic:
    // positive IDs are usually private chats
    return chatId > 0;
  }
}

/**
 * Factory function to create a TelegramAdapter with config from env vars.
 */
export function createTelegramAdapter(
  config?: Partial<TelegramAdapterConfig>
): TelegramAdapter {
  const botToken = config?.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new ValidationError(
      "telegram",
      "Telegram bot token is required. Set TELEGRAM_BOT_TOKEN env var or pass botToken in config."
    );
  }

  const secretToken =
    config?.secretToken ?? process.env.TELEGRAM_SECRET_TOKEN ?? undefined;

  return new TelegramAdapter({
    botToken,
    secretToken,
    logger: config?.logger ?? new ConsoleLogger("warn"),
    userName: config?.userName ?? process.env.BOT_USERNAME,
  });
}
