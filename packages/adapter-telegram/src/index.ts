import { timingSafeEqual } from "node:crypto";
import {
  AdapterRateLimitError,
  AuthenticationError,
  cardToFallbackText,
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
  UserInfo,
  WebhookOptions,
} from "chat";
import {
  ConsoleLogger,
  convertEmojiPlaceholders,
  defaultEmojiResolver,
  getEmoji,
  Message,
  markdownToPlainText,
  NotImplementedError,
  StreamingMarkdownRenderer,
  stringifyMarkdown,
  toPlainText,
} from "chat";
import {
  cardToTelegramInlineKeyboard,
  decodeTelegramCallbackData,
  emptyTelegramInlineKeyboard,
} from "./cards";
import {
  TELEGRAM_CAPTION_LIMIT,
  TELEGRAM_MESSAGE_LIMIT,
  TelegramFormatConverter,
  type TelegramParseMode,
  toBotApiParseMode,
  truncateForTelegram,
} from "./markdown";
import {
  richMessageMedia,
  richMessageToMarkdown,
  richMessageToText,
  truncateRichMarkdown,
} from "./rich";
import type {
  TelegramAdapterConfig,
  TelegramAdapterMode,
  TelegramApiResponse,
  TelegramCallbackQuery,
  TelegramChat,
  TelegramFile,
  TelegramInlineKeyboardMarkup,
  TelegramLongPollingConfig,
  TelegramMessage,
  TelegramMessageEntity,
  TelegramMessageReactionUpdated,
  TelegramRawMessage,
  TelegramReactionType,
  TelegramThreadId,
  TelegramUpdate,
  TelegramUser,
  TelegramWebhookInfo,
} from "./types";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const TELEGRAM_SECRET_TOKEN_HEADER = "x-telegram-bot-api-secret-token";
const MESSAGE_ID_PATTERN = /^([^:]+):(\d+)$/;
const trimTrailingSlashes = (url: string): string => {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") {
    end--;
  }
  return url.slice(0, end);
};
const MESSAGE_SEQUENCE_PATTERN = /:(\d+)$/;
const ATTACHMENT_UPLOADS = {
  audio: { field: "audio", method: "sendAudio" },
  file: { field: "document", method: "sendDocument" },
  image: { field: "photo", method: "sendPhoto" },
  video: { field: "video", method: "sendVideo" },
} as const satisfies Record<
  Attachment["type"],
  { field: string; method: string }
>;
const LEADING_AT_PATTERN = /^@+/;
const EMOJI_PLACEHOLDER_PATTERN = /^\{\{emoji:([a-z0-9_]+)\}\}$/i;
const EMOJI_NAME_PATTERN = /^[a-z0-9_+-]+$/i;
const TELEGRAM_DEFAULT_POLLING_TIMEOUT_SECONDS = 30;
const TELEGRAM_DEFAULT_POLLING_LIMIT = 100;
const TELEGRAM_DEFAULT_POLLING_RETRY_DELAY_MS = 1000;
const TELEGRAM_DEFAULT_STREAM_UPDATE_INTERVAL_MS = 250;
const TELEGRAM_MARKDOWN_PARSE_ERROR_PATTERN =
  /can't parse (?:caption )?entities/i;
const TELEGRAM_MAX_POLLING_LIMIT = 100;
const TELEGRAM_MIN_POLLING_LIMIT = 1;
const TELEGRAM_MIN_POLLING_TIMEOUT_SECONDS = 0;
const TELEGRAM_MAX_POLLING_TIMEOUT_SECONDS = 300;
interface TelegramMessageAuthor {
  fullName: string;
  isBot: boolean | "unknown";
  isMe: boolean;
  userId: string;
  userName: string;
}

interface ResolvedTelegramLongPollingConfig {
  allowedUpdates?: string[];
  deleteWebhook: boolean;
  dropPendingUpdates: boolean;
  limit: number;
  retryDelayMs: number;
  timeout: number;
}

type TelegramRuntimeMode = "webhook" | "polling";

/**
 * Escape standard-markdown special characters inside inbound entity text.
 *
 * Used only by `applyTelegramEntities` below (inbound path). Outbound
 * MarkdownV2 escaping lives in `markdown.ts` (`escapeMarkdownV2`).
 */
const escapeMarkdownInEntity = (text: string): string =>
  text.replace(/([[\]()\\])/g, "\\$1");

/**
 * Convert Telegram message entities (inbound) to standard markdown.
 *
 * Telegram delivers formatting as separate entity objects alongside plain text.
 * This function reconstructs **standard** markdown (`**bold**`, `~~strike~~`,
 * etc.) so the result can be fed into the SDK's `parseMarkdown` — which is
 * the canonical AST producer. The outbound direction (AST → MarkdownV2) is
 * handled separately by `TelegramFormatConverter.fromAst`.
 *
 * Entities use UTF-16 offsets, which match JavaScript's native string indexing.
 */
export function applyTelegramEntities(
  text: string,
  entities: TelegramMessageEntity[]
): string {
  if (entities.length === 0) {
    return text;
  }

  // Sort entities by offset descending so replacements don't shift later offsets
  const sorted = [...entities].sort((a, b) => {
    const offsetDiff = b.offset - a.offset;
    // For entities at the same offset, apply the shorter (inner) one first
    if (offsetDiff !== 0) {
      return offsetDiff;
    }
    return a.length - b.length;
  });

  let result = text;

  for (const entity of sorted) {
    const start = entity.offset;
    const end = entity.offset + entity.length;
    const entityText = result.slice(start, end);

    let replacement: string | undefined;

    switch (entity.type) {
      case "text_link": {
        if (entity.url) {
          replacement = `[${escapeMarkdownInEntity(entityText)}](${entity.url})`;
        }
        break;
      }
      case "bold": {
        replacement = `**${entityText}**`;
        break;
      }
      case "italic": {
        replacement = `*${entityText}*`;
        break;
      }
      case "code": {
        replacement = `\`${entityText}\``;
        break;
      }
      case "pre": {
        const lang = entity.language ?? "";
        replacement = `\`\`\`${lang}\n${entityText}\n\`\`\``;
        break;
      }
      case "strikethrough": {
        replacement = `~~${entityText}~~`;
        break;
      }
      default:
        // url, mention, bot_command, etc. are already present in the text as-is
        break;
    }

    if (replacement !== undefined) {
      result = result.slice(0, start) + replacement + result.slice(end);
    }
  }

  return result;
}

export class TelegramAdapter
  implements Adapter<TelegramThreadId, TelegramRawMessage>
{
  readonly name = "telegram";
  readonly lockScope = "channel" as const;
  readonly persistThreadHistory = true;

  protected readonly botToken: string;
  protected readonly apiBaseUrl: string;
  protected readonly secretToken?: string;
  private warnedNoVerification = false;
  protected readonly logger: Logger;
  protected readonly formatConverter = new TelegramFormatConverter();
  private readonly messageCache = new Map<
    string,
    Message<TelegramRawMessage>[]
  >();

  protected chat: ChatInstance | null = null;
  protected _botUserId?: string;
  protected _userName: string;
  protected readonly hasExplicitUserName: boolean;
  protected readonly mode: TelegramAdapterMode;
  protected readonly longPolling?: TelegramLongPollingConfig;
  private _runtimeMode: TelegramRuntimeMode = "webhook";
  private pollingAbortController: AbortController | null = null;
  private pollingTask: Promise<void> | null = null;
  private pollingActive = false;
  private nextDraftId = Math.max(1, Date.now() % 2_147_483_647);
  private richMessagesAvailable = true;

  get botUserId(): string | undefined {
    return this._botUserId;
  }

  get userName(): string {
    return this._userName;
  }

  get isPolling(): boolean {
    return this.pollingActive;
  }

  get runtimeMode(): TelegramRuntimeMode {
    return this._runtimeMode;
  }

  constructor(config: TelegramAdapterConfig = {}) {
    const botToken = config.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new ValidationError(
        "telegram",
        "botToken is required. Set TELEGRAM_BOT_TOKEN or provide it in config."
      );
    }

    this.botToken = botToken;
    this.apiBaseUrl = trimTrailingSlashes(
      config.apiUrl ??
        config.apiBaseUrl ??
        process.env.TELEGRAM_API_BASE_URL ??
        TELEGRAM_API_BASE
    );
    this.secretToken =
      config.secretToken ?? process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN;
    this.logger = config.logger ?? new ConsoleLogger("info").child("telegram");
    const userName = config.userName ?? process.env.TELEGRAM_BOT_USERNAME;
    this._userName = this.normalizeUserName(userName ?? "bot");
    this.hasExplicitUserName = Boolean(userName);
    this.mode = config.mode ?? "auto";
    this.longPolling = config.longPolling;

    if (!["auto", "webhook", "polling"].includes(this.mode)) {
      throw new ValidationError(
        "telegram",
        `Invalid mode: ${this.mode}. Expected "auto", "webhook", or "polling".`
      );
    }
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    if (!this.hasExplicitUserName) {
      // Runtime JS consumers can omit Chat.userName even though TS marks it required.
      // Keep a safe fallback here and let getMe() refine the username when available.
      const chatUserName = chat.getUserName?.();
      if (typeof chatUserName === "string" && chatUserName.trim()) {
        this._userName = this.normalizeUserName(chatUserName);
      }
    }

    try {
      const me = await this.telegramFetch<TelegramUser>("getMe");
      this._botUserId = String(me.id);
      if (!this.hasExplicitUserName && me.username) {
        this._userName = this.normalizeUserName(me.username);
      }

      this.logger.info("Telegram adapter initialized", {
        botUserId: this._botUserId,
        userName: this._userName,
      });
    } catch (error) {
      this.logger.warn("Failed to fetch Telegram bot identity", {
        error: String(error),
      });
    }

    const runtimeMode = await this.resolveRuntimeMode();
    this._runtimeMode = runtimeMode;

    if (runtimeMode === "polling") {
      const pollingConfig = this.longPolling;

      if (this.mode === "auto") {
        await this.startPolling(
          pollingConfig
            ? { ...pollingConfig, deleteWebhook: false }
            : { deleteWebhook: false }
        );
      } else {
        await this.startPolling(pollingConfig);
      }
    }
  }

  async getUser(userId: string): Promise<UserInfo | null> {
    try {
      const chat = await this.telegramFetch<TelegramChat>("getChat", {
        chat_id: userId,
      });
      // Only private chats represent users — groups/channels are not user lookups
      if (chat.type !== "private") {
        return null;
      }
      const fullName = [chat.first_name, chat.last_name]
        .filter(Boolean)
        .join(" ");
      return {
        email: undefined,
        fullName: fullName || String(chat.id),
        // Telegram's getChat API doesn't expose is_bot (only available on TelegramUser).
        // Always returns false — callers needing bot detection should use message.author.isBot instead.
        isBot: false,
        userId: String(chat.id),
        userName: chat.username || chat.first_name || String(chat.id),
      };
    } catch {
      return null;
    }
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    if (this.secretToken) {
      const headerToken = request.headers.get(TELEGRAM_SECRET_TOKEN_HEADER);
      let valid = false;
      try {
        valid =
          !!headerToken &&
          timingSafeEqual(
            Buffer.from(headerToken),
            Buffer.from(this.secretToken)
          );
      } catch {
        // Length mismatch throws — treat as invalid
      }
      if (!valid) {
        this.logger.warn(
          "Telegram webhook rejected due to invalid secret token"
        );
        return new Response("Invalid secret token", { status: 401 });
      }
    } else if (!this.warnedNoVerification) {
      this.warnedNoVerification = true;
      this.logger.warn(
        "Telegram webhook verification is disabled. Set TELEGRAM_WEBHOOK_SECRET_TOKEN or secretToken to verify incoming requests."
      );
    }

    let update: TelegramUpdate;
    try {
      update = (await request.json()) as TelegramUpdate;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!this.chat) {
      this.logger.warn(
        "Chat instance not initialized, ignoring Telegram webhook"
      );
      return new Response("OK", { status: 200 });
    }

    try {
      this.processUpdate(update, options);
    } catch (error) {
      this.logger.warn("Failed to process Telegram webhook update", {
        error: String(error),
        updateId: update.update_id,
      });
    }

    return new Response("OK", { status: 200 });
  }

  async startPolling(config?: TelegramLongPollingConfig): Promise<void> {
    if (!this.chat) {
      throw new ValidationError(
        "telegram",
        "Cannot start polling before initialize()"
      );
    }

    if (this.pollingActive) {
      this.logger.debug("Telegram polling already active");
      return;
    }

    const resolvedConfig = this.resolvePollingConfig(config);
    const previousRuntimeMode = this._runtimeMode;
    this.pollingActive = true;

    try {
      if (resolvedConfig.deleteWebhook) {
        await this.resetWebhook(resolvedConfig.dropPendingUpdates);
      }

      this._runtimeMode = "polling";
    } catch (error) {
      this.pollingActive = false;
      this._runtimeMode = previousRuntimeMode;
      throw error;
    }

    this.logger.info("Telegram polling started", {
      limit: resolvedConfig.limit,
      timeout: resolvedConfig.timeout,
      allowedUpdates: resolvedConfig.allowedUpdates,
    });

    this.pollingTask = this.pollingLoop(resolvedConfig).finally(() => {
      this.pollingActive = false;
      this.pollingAbortController = null;
      this.pollingTask = null;
    });
  }

  async stopPolling(): Promise<void> {
    if (!this.pollingActive) {
      return;
    }

    this.pollingActive = false;
    this.pollingAbortController?.abort();

    if (this.pollingTask) {
      await this.pollingTask;
    }

    this.logger.info("Telegram polling stopped");
  }

  async resetWebhook(dropPendingUpdates = false): Promise<void> {
    await this.telegramFetch<boolean>("deleteWebhook", {
      drop_pending_updates: dropPendingUpdates,
    });

    this.logger.info("Telegram webhook reset", {
      dropPendingUpdates,
    });
  }

  protected async resolveRuntimeMode(): Promise<TelegramRuntimeMode> {
    if (this.mode === "webhook") {
      return "webhook";
    }

    if (this.mode === "polling") {
      return "polling";
    }

    const webhookInfo = await this.fetchWebhookInfo();
    if (!webhookInfo) {
      this.logger.warn(
        "Telegram auto mode could not verify webhook status; keeping webhook mode"
      );
      return "webhook";
    }

    if (typeof webhookInfo.url === "string" && webhookInfo.url.trim()) {
      this.logger.debug("Telegram auto mode selected webhook mode", {
        webhookUrl: webhookInfo.url,
      });
      return "webhook";
    }

    if (this.isLikelyServerlessRuntime()) {
      this.logger.warn(
        "Telegram auto mode detected serverless runtime without webhook URL; keeping webhook mode"
      );
      return "webhook";
    }

    this.logger.info("Telegram auto mode selected polling mode");
    return "polling";
  }

  protected async fetchWebhookInfo(): Promise<TelegramWebhookInfo | null> {
    try {
      return await this.telegramFetch<TelegramWebhookInfo>("getWebhookInfo");
    } catch (error) {
      this.logger.warn("Failed to fetch Telegram webhook info", {
        error: String(error),
      });
      return null;
    }
  }

  protected isLikelyServerlessRuntime(): boolean {
    if (typeof process === "undefined" || !process.env) {
      return false;
    }

    return Boolean(
      process.env.VERCEL ||
        process.env.AWS_LAMBDA_FUNCTION_NAME ||
        process.env.AWS_EXECUTION_ENV?.includes("AWS_Lambda") ||
        process.env.FUNCTIONS_WORKER_RUNTIME ||
        process.env.NETLIFY ||
        process.env.K_SERVICE
    );
  }

  protected processUpdate(
    update: TelegramUpdate,
    options?: WebhookOptions
  ): void {
    const messageUpdate =
      update.message ??
      update.edited_message ??
      update.channel_post ??
      update.edited_channel_post;

    const handledSlashCommand =
      update.message !== undefined &&
      this.handleSlashCommandUpdate(update.message, options);

    if (messageUpdate && !handledSlashCommand) {
      this.handleIncomingMessageUpdate(messageUpdate, options);
    }

    if (update.callback_query) {
      this.handleCallbackQuery(update.callback_query, options);
    }

    if (update.message_reaction) {
      this.handleMessageReactionUpdate(update.message_reaction, options);
    }
  }

  protected handleIncomingMessageUpdate(
    telegramMessage: TelegramMessage,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      return;
    }

    const threadId = this.encodeThreadId({
      chatId: String(telegramMessage.chat.id),
      messageThreadId: telegramMessage.message_thread_id,
    });

    const parsedMessage = this.parseTelegramMessage(telegramMessage, threadId);
    this.cacheMessage(parsedMessage);

    this.chat.processMessage(this, threadId, parsedMessage, options);
  }

  protected handleSlashCommandUpdate(
    telegramMessage: TelegramMessage,
    options?: WebhookOptions
  ): boolean {
    if (!this.chat) {
      return false;
    }

    const slashCommand = this.parseSlashCommand(telegramMessage);
    if (!slashCommand) {
      return false;
    }

    const threadId = this.encodeThreadId({
      chatId: String(telegramMessage.chat.id),
      messageThreadId: telegramMessage.message_thread_id,
    });

    const parsedMessage = this.parseTelegramMessage(telegramMessage, threadId);
    this.cacheMessage(parsedMessage);

    this.chat.processSlashCommand(
      {
        adapter: this,
        channelId: threadId,
        command: slashCommand.command,
        text: slashCommand.text,
        user: parsedMessage.author,
        raw: telegramMessage,
      },
      options
    );

    return true;
  }

  protected parseSlashCommand(
    telegramMessage: TelegramMessage
  ): { command: string; text: string } | null {
    const hasText = telegramMessage.text !== undefined;
    const text = hasText ? telegramMessage.text : telegramMessage.caption;
    const entities = hasText
      ? (telegramMessage.entities ?? [])
      : (telegramMessage.caption_entities ?? []);

    if (!text) {
      return null;
    }

    const commandEntity = entities.find(
      (entity) => entity.type === "bot_command" && entity.offset === 0
    );

    if (!commandEntity) {
      return null;
    }

    const rawCommand = this.entityText(text, commandEntity);
    if (!rawCommand.startsWith("/")) {
      return null;
    }

    const commandWithoutSlash = rawCommand.slice(1);
    const atIndex = commandWithoutSlash.indexOf("@");
    const commandName =
      atIndex === -1
        ? commandWithoutSlash
        : commandWithoutSlash.slice(0, atIndex);
    const targetBot =
      atIndex === -1 ? undefined : commandWithoutSlash.slice(atIndex + 1);

    if (!commandName) {
      return null;
    }

    if (targetBot && targetBot.toLowerCase() !== this.userName.toLowerCase()) {
      return null;
    }

    return {
      command: `/${commandName}`,
      text: text.slice(commandEntity.offset + commandEntity.length).trimStart(),
    };
  }

  protected handleCallbackQuery(
    callbackQuery: TelegramCallbackQuery,
    options?: WebhookOptions
  ): void {
    if (!(this.chat && callbackQuery.message)) {
      return;
    }

    const threadId = this.encodeThreadId({
      chatId: String(callbackQuery.message.chat.id),
      messageThreadId: callbackQuery.message.message_thread_id,
    });

    const messageId = this.encodeMessageId(
      String(callbackQuery.message.chat.id),
      callbackQuery.message.message_id
    );

    const { actionId, value } = decodeTelegramCallbackData(callbackQuery.data);

    this.chat.processAction(
      {
        adapter: this,
        actionId,
        value,
        messageId,
        threadId,
        user: this.toAuthor(callbackQuery.from),
        raw: callbackQuery,
      },
      options
    );

    const ackTask = this.telegramFetch<boolean>("answerCallbackQuery", {
      callback_query_id: callbackQuery.id,
    }).catch((error) => {
      this.logger.warn("Failed to acknowledge Telegram callback query", {
        callbackQueryId: callbackQuery.id,
        error: String(error),
      });
    });

    if (options?.waitUntil) {
      options.waitUntil(ackTask);
    }
  }

  protected handleMessageReactionUpdate(
    reactionUpdate: TelegramMessageReactionUpdated,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      return;
    }

    const threadId = this.encodeThreadId({
      chatId: String(reactionUpdate.chat.id),
      messageThreadId: reactionUpdate.message_thread_id,
    });

    const messageId = this.encodeMessageId(
      String(reactionUpdate.chat.id),
      reactionUpdate.message_id
    );

    const oldReactions = new Set(
      reactionUpdate.old_reaction.map((reaction) => this.reactionKey(reaction))
    );
    const newReactions = new Set(
      reactionUpdate.new_reaction.map((reaction) => this.reactionKey(reaction))
    );

    const actor = reactionUpdate.user
      ? this.toAuthor(reactionUpdate.user)
      : this.toReactionActorAuthor(reactionUpdate.chat);

    for (const reaction of reactionUpdate.new_reaction) {
      const key = this.reactionKey(reaction);
      if (!oldReactions.has(key)) {
        this.chat.processReaction(
          {
            adapter: this,
            threadId,
            messageId,
            emoji: this.reactionToEmojiValue(reaction),
            rawEmoji: key,
            added: true,
            user: actor,
            raw: reactionUpdate,
          },
          options
        );
      }
    }

    for (const reaction of reactionUpdate.old_reaction) {
      const key = this.reactionKey(reaction);
      if (!newReactions.has(key)) {
        this.chat.processReaction(
          {
            adapter: this,
            threadId,
            messageId,
            emoji: this.reactionToEmojiValue(reaction),
            rawEmoji: key,
            added: false,
            user: actor,
            raw: reactionUpdate,
          },
          options
        );
      }
    }
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<TelegramRawMessage>> {
    const parsedThread = this.resolveThreadId(threadId);

    const card = extractCard(message);
    const replyMarkup = card ? cardToTelegramInlineKeyboard(card) : undefined;
    const parseMode = this.resolveParseMode(message, card);
    const plainText = truncateForTelegram(
      convertEmojiPlaceholders(
        this.renderPlainTextMessage(message, card),
        "gchat"
      ),
      TELEGRAM_MESSAGE_LIMIT,
      "plain"
    );
    const text = truncateForTelegram(
      convertEmojiPlaceholders(
        card
          ? this.formatConverter.fromMarkdown(
              cardToFallbackText(card, { boldFormat: "**" })
            )
          : this.formatConverter.renderPostable(message),
        "gchat"
      ),
      TELEGRAM_MESSAGE_LIMIT,
      parseMode
    );

    const files = extractFiles(message);
    if (files.length > 1) {
      throw new ValidationError(
        "telegram",
        "Telegram adapter supports a single file upload per message"
      );
    }

    const attachments = extractPostableAttachments(message);
    if (attachments.length > 1) {
      throw new ValidationError(
        "telegram",
        "Telegram adapter supports a single attachment upload per message"
      );
    }

    if (files.length > 0 && attachments.length > 0) {
      throw new ValidationError(
        "telegram",
        "Telegram adapter does not support mixing file uploads and attachments in one message"
      );
    }

    const rich = this.resolveRichMessage(
      message,
      card,
      files.length,
      attachments.length
    );
    let rawMessage: TelegramMessage;

    if (files.length === 1) {
      const [file] = files;
      if (!file) {
        throw new ValidationError("telegram", "File upload payload is empty");
      }
      rawMessage = await this.sendDocument(
        parsedThread,
        file,
        text,
        plainText,
        replyMarkup,
        parseMode
      );
    } else if (attachments.length === 1) {
      const [attachment] = attachments;
      if (!attachment) {
        throw new ValidationError(
          "telegram",
          "Attachment upload payload is empty"
        );
      }
      rawMessage = await this.sendAttachment(
        parsedThread,
        attachment,
        text,
        plainText,
        replyMarkup,
        parseMode
      );
    } else {
      if (!text.trim()) {
        throw new ValidationError("telegram", "Message text cannot be empty");
      }

      const sendRegular = () =>
        this.sendRegularMessage(
          parsedThread,
          text,
          plainText,
          parseMode,
          replyMarkup,
          threadId
        );

      rawMessage = rich
        ? await this.withTelegramRichFallback(
            () =>
              this.telegramFetch<TelegramMessage>("sendRichMessage", {
                chat_id: parsedThread.chatId,
                message_thread_id: parsedThread.messageThreadId,
                rich_message: {
                  markdown: rich.markdown,
                },
                reply_markup: replyMarkup,
              }),
            sendRegular,
            {
              method: "sendRichMessage",
              threadId,
            }
          )
        : await sendRegular();
    }

    const resultingThreadId = this.encodeThreadId({
      chatId: String(rawMessage.chat.id),
      messageThreadId:
        rawMessage.message_thread_id ?? parsedThread.messageThreadId,
    });

    const parsedMessage = this.parseTelegramMessage(
      rawMessage,
      resultingThreadId,
      rich
        ? {
            formatted: rich.formatted,
            text: rich.text,
          }
        : undefined
    );
    this.cacheMessage(parsedMessage);

    return {
      id: parsedMessage.id,
      threadId: parsedMessage.threadId,
      raw: rawMessage,
    };
  }

  async postChannelMessage(
    channelId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<TelegramRawMessage>> {
    return this.postMessage(channelId, message);
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<TelegramRawMessage>> {
    const parsedThread = this.resolveThreadId(threadId);
    const {
      chatId,
      messageId: telegramMessageId,
      compositeId,
    } = this.decodeCompositeMessageId(messageId, parsedThread.chatId);

    const card = extractCard(message);
    const replyMarkup = card ? cardToTelegramInlineKeyboard(card) : undefined;
    const parseMode = this.resolveParseMode(message, card);
    const plainText = truncateForTelegram(
      convertEmojiPlaceholders(
        this.renderPlainTextMessage(message, card),
        "gchat"
      ),
      TELEGRAM_MESSAGE_LIMIT,
      "plain"
    );
    const text = truncateForTelegram(
      convertEmojiPlaceholders(
        card
          ? this.formatConverter.fromMarkdown(
              cardToFallbackText(card, { boldFormat: "**" })
            )
          : this.formatConverter.renderPostable(message),
        "gchat"
      ),
      TELEGRAM_MESSAGE_LIMIT,
      parseMode
    );
    const rich = this.resolveRichMessage(message, card, 0, 0);

    if (!text.trim()) {
      throw new ValidationError("telegram", "Message text cannot be empty");
    }

    const editRegular = () =>
      this.withTelegramMarkdownFallback(
        parseMode,
        (resolvedParseMode, resolvedText) =>
          this.telegramFetch<TelegramMessage | true>("editMessageText", {
            chat_id: chatId,
            message_id: telegramMessageId,
            text: resolvedText,
            reply_markup: replyMarkup ?? emptyTelegramInlineKeyboard(),
            parse_mode: toBotApiParseMode(resolvedParseMode),
          }),
        {
          initialText: text,
          fallbackText: plainText,
          messageId,
          method: "editMessageText",
          threadId,
        }
      );

    const result = rich
      ? await this.withTelegramRichFallback(
          () =>
            this.telegramFetch<TelegramMessage | true>("editMessageText", {
              chat_id: chatId,
              message_id: telegramMessageId,
              rich_message: {
                markdown: rich.markdown,
              },
              reply_markup: replyMarkup ?? emptyTelegramInlineKeyboard(),
            }),
          editRegular,
          {
            messageId,
            method: "editMessageText",
            threadId,
          }
        )
      : await editRegular();

    if (result === true) {
      const existing = this.findCachedMessage(compositeId);
      if (!existing) {
        throw new NotImplementedError(
          "Telegram returned a non-message edit result and no cached message was found",
          "editMessage"
        );
      }

      const updated = new Message<TelegramRawMessage>({
        ...existing,
        text: rich?.text ?? text,
        formatted: rich?.formatted ?? this.formatConverter.toAst(text),
        metadata: {
          ...existing.metadata,
          edited: true,
          editedAt: new Date(),
        },
      });

      this.cacheMessage(updated);

      return {
        id: updated.id,
        threadId: updated.threadId,
        raw: updated.raw,
      };
    }

    const resultingThreadId = this.encodeThreadId({
      chatId: String(result.chat.id),
      messageThreadId: result.message_thread_id ?? parsedThread.messageThreadId,
    });

    const parsedMessage = this.parseTelegramMessage(
      result,
      resultingThreadId,
      rich
        ? {
            formatted: rich.formatted,
            text: rich.text,
          }
        : undefined
    );
    this.cacheMessage(parsedMessage);

    return {
      id: parsedMessage.id,
      threadId: parsedMessage.threadId,
      raw: result,
    };
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const parsedThread = this.resolveThreadId(threadId);
    const {
      chatId,
      messageId: telegramMessageId,
      compositeId,
    } = this.decodeCompositeMessageId(messageId, parsedThread.chatId);

    await this.telegramFetch<boolean>("deleteMessage", {
      chat_id: chatId,
      message_id: telegramMessageId,
    });

    this.deleteCachedMessage(compositeId);
  }

  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const parsedThread = this.resolveThreadId(threadId);
    const { chatId, messageId: telegramMessageId } =
      this.decodeCompositeMessageId(messageId, parsedThread.chatId);

    await this.telegramFetch<boolean>("setMessageReaction", {
      chat_id: chatId,
      message_id: telegramMessageId,
      reaction: [this.toTelegramReaction(emoji)],
    });
  }

  async removeReaction(
    threadId: string,
    messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    const parsedThread = this.resolveThreadId(threadId);
    const { chatId, messageId: telegramMessageId } =
      this.decodeCompositeMessageId(messageId, parsedThread.chatId);

    await this.telegramFetch<boolean>("setMessageReaction", {
      chat_id: chatId,
      message_id: telegramMessageId,
      reaction: [],
    });
  }

  async startTyping(threadId: string): Promise<void> {
    const parsedThread = this.resolveThreadId(threadId);
    await this.telegramFetch<boolean>("sendChatAction", {
      chat_id: parsedThread.chatId,
      message_thread_id: parsedThread.messageThreadId,
      action: "typing",
    });
  }

  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    options?: StreamOptions
  ): Promise<RawMessage<TelegramRawMessage> | null> {
    if (!this.isDM(threadId)) {
      return null;
    }

    const parsedThread = this.resolveThreadId(threadId);
    const updateIntervalMs = this.clampInteger(
      options?.updateIntervalMs,
      TELEGRAM_DEFAULT_STREAM_UPDATE_INTERVAL_MS,
      0,
      Number.MAX_SAFE_INTEGER
    );

    const renderer = new StreamingMarkdownRenderer();
    const draftId = this.createDraftId();
    let accumulated = "";
    let lastDraftText: string | null = null;
    let lastFlushAt = 0;
    let draftStreamingEnabled = true;
    let streamUsesMarkdown = true;
    let streamUsesRich = this.richMessagesAvailable;

    const renderMarkdownForTelegram = (text: string): string =>
      convertEmojiPlaceholders(
        this.formatConverter.fromMarkdown(text),
        "gchat"
      );

    const renderMarkdownText = (text: string): string =>
      truncateForTelegram(
        renderMarkdownForTelegram(text),
        TELEGRAM_MESSAGE_LIMIT,
        "MarkdownV2"
      );

    const renderPlainText = (text: string): string =>
      truncateForTelegram(
        this.resolveTelegramFallbackText(text, markdownToPlainText(text)),
        TELEGRAM_MESSAGE_LIMIT,
        "plain"
      );

    const sendDraft = async (
      text: string,
      useMarkdown: boolean
    ): Promise<void> => {
      if (!draftStreamingEnabled || text === lastDraftText) {
        return;
      }

      let draftText = text;
      if (streamUsesRich) {
        try {
          await this.telegramFetch<boolean>("sendRichMessageDraft", {
            chat_id: parsedThread.chatId,
            message_thread_id: parsedThread.messageThreadId,
            draft_id: draftId,
            rich_message: {
              markdown: text,
            },
          });
          lastDraftText = text;
          lastFlushAt = Date.now();
          return;
        } catch (error) {
          if (!this.canFallbackFromRichMessage(error, "sendRichMessageDraft")) {
            draftStreamingEnabled = false;
            this.logger.warn("Telegram rich draft streaming update failed", {
              error: String(error),
              threadId,
            });
            return;
          }

          this.rememberRichMessageFailure(error, "sendRichMessageDraft");
          this.logger.warn(
            "Telegram rich draft failed; retrying with a regular draft",
            {
              error: String(error),
              threadId,
            }
          );
          streamUsesRich = false;
          draftText = useMarkdown
            ? renderMarkdownText(renderer.render())
            : renderPlainText(accumulated);
        }
      }

      try {
        if (useMarkdown) {
          await this.telegramFetch<boolean>("sendMessageDraft", {
            chat_id: parsedThread.chatId,
            message_thread_id: parsedThread.messageThreadId,
            draft_id: draftId,
            text: draftText,
            parse_mode: toBotApiParseMode("MarkdownV2"),
          });
        } else {
          await this.telegramFetch<boolean>("sendMessageDraft", {
            chat_id: parsedThread.chatId,
            message_thread_id: parsedThread.messageThreadId,
            draft_id: draftId,
            text: draftText,
          });
        }
        lastDraftText = draftText;
        lastFlushAt = Date.now();
      } catch (error) {
        if (useMarkdown && this.isTelegramMarkdownParseError(error)) {
          streamUsesMarkdown = false;

          const plainDraftText = renderPlainText(accumulated);

          try {
            await this.telegramFetch<boolean>("sendMessageDraft", {
              chat_id: parsedThread.chatId,
              message_thread_id: parsedThread.messageThreadId,
              draft_id: draftId,
              text: plainDraftText,
            });
            lastDraftText = plainDraftText;
            lastFlushAt = Date.now();
          } catch (retryError) {
            draftStreamingEnabled = false;
            this.logger.warn("Telegram draft streaming update failed", {
              error: String(retryError),
              threadId,
            });
          }
          return;
        }

        draftStreamingEnabled = false;
        this.logger.warn("Telegram draft streaming update failed", {
          error: String(error),
          threadId,
        });
      }
    };

    const flushDraft = async (): Promise<void> => {
      if (!draftStreamingEnabled) {
        return;
      }

      let draftText = renderPlainText(accumulated);
      if (streamUsesRich) {
        draftText = truncateRichMarkdown(renderer.render());
      } else if (streamUsesMarkdown) {
        draftText = renderMarkdownText(renderer.render());
      }
      await sendDraft(draftText, streamUsesMarkdown);
    };

    for await (const chunk of textStream) {
      let text: string | null = null;
      if (typeof chunk === "string") {
        text = chunk;
      } else if (chunk.type === "markdown_text") {
        text = chunk.text;
      }

      if (text === null) {
        continue;
      }

      accumulated += text;
      renderer.push(text);

      if (Date.now() - lastFlushAt >= updateIntervalMs) {
        await flushDraft();
      }
    }

    if (!accumulated.trim()) {
      throw new ValidationError(
        "telegram",
        "Telegram streaming requires text content"
      );
    }

    const finalMarkdown = renderer.finish();
    await flushDraft();

    if (streamUsesRich) {
      const markdown = truncateRichMarkdown(finalMarkdown);
      try {
        const raw = await this.telegramFetch<TelegramMessage>(
          "sendRichMessage",
          {
            chat_id: parsedThread.chatId,
            message_thread_id: parsedThread.messageThreadId,
            rich_message: {
              markdown,
            },
          }
        );
        const resultingThreadId = this.encodeThreadId({
          chatId: String(raw.chat.id),
          messageThreadId:
            raw.message_thread_id ?? parsedThread.messageThreadId,
        });
        const formatted = this.formatConverter.toAst(accumulated);
        const message = this.parseTelegramMessage(raw, resultingThreadId, {
          formatted,
          text: toPlainText(formatted),
        });
        this.cacheMessage(message);
        return {
          id: message.id,
          threadId: message.threadId,
          raw,
        };
      } catch (error) {
        if (!this.canFallbackFromRichMessage(error, "sendRichMessage")) {
          throw error;
        }
        this.rememberRichMessageFailure(error, "sendRichMessage");
      }
    }

    const regularText = streamUsesMarkdown
      ? renderMarkdownText(finalMarkdown)
      : renderPlainText(accumulated);
    const plainText = renderPlainText(accumulated);
    const raw = await this.sendRegularMessage(
      parsedThread,
      regularText,
      plainText,
      streamUsesMarkdown ? "MarkdownV2" : "plain",
      undefined,
      threadId
    );
    const resultingThreadId = this.encodeThreadId({
      chatId: String(raw.chat.id),
      messageThreadId: raw.message_thread_id ?? parsedThread.messageThreadId,
    });
    const message = this.parseTelegramMessage(raw, resultingThreadId);
    this.cacheMessage(message);
    return {
      id: message.id,
      threadId: message.threadId,
      raw,
    };
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<TelegramRawMessage>> {
    const messages = [...(this.messageCache.get(threadId) ?? [])].sort((a, b) =>
      this.compareMessages(a, b)
    );

    return this.paginateMessages(messages, options);
  }

  async fetchChannelMessages(
    channelId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<TelegramRawMessage>> {
    const byId = new Map<string, Message<TelegramRawMessage>>();

    for (const [threadId, messages] of this.messageCache.entries()) {
      let decoded: TelegramThreadId;
      try {
        decoded = this.decodeThreadId(threadId);
      } catch {
        continue;
      }

      if (decoded.chatId !== channelId) {
        continue;
      }

      for (const message of messages) {
        byId.set(message.id, message);
      }
    }

    const allMessages = [...byId.values()].sort((a, b) =>
      this.compareMessages(a, b)
    );
    return this.paginateMessages(allMessages, options);
  }

  async fetchMessage(
    _threadId: string,
    messageId: string
  ): Promise<Message<TelegramRawMessage> | null> {
    return this.findCachedMessage(messageId) ?? null;
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const parsedThread = this.resolveThreadId(threadId);
    const chat = await this.telegramFetch<TelegramChat>("getChat", {
      chat_id: parsedThread.chatId,
    });

    return {
      id: this.encodeThreadId(parsedThread),
      channelId: String(chat.id),
      channelName: this.chatDisplayName(chat),
      isDM: chat.type === "private",
      metadata: {
        chat,
        messageThreadId: parsedThread.messageThreadId,
      },
    };
  }

  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const chat = await this.telegramFetch<TelegramChat>("getChat", {
      chat_id: channelId,
    });

    let memberCount: number | undefined;
    try {
      memberCount = await this.telegramFetch<number>("getChatMemberCount", {
        chat_id: channelId,
      });
    } catch {
      // Some chats disallow member count queries for bot scopes.
      memberCount = undefined;
    }

    return {
      id: String(chat.id),
      name: this.chatDisplayName(chat),
      isDM: chat.type === "private",
      memberCount,
      metadata: {
        chat,
      },
    };
  }

  channelIdFromThreadId(threadId: string): string {
    const { chatId } = this.resolveThreadId(threadId);
    return `telegram:${chatId}`;
  }

  async openDM(userId: string): Promise<string> {
    return this.encodeThreadId({ chatId: userId });
  }

  isDM(threadId: string): boolean {
    const { chatId } = this.resolveThreadId(threadId);
    return !chatId.startsWith("-");
  }

  encodeThreadId(platformData: TelegramThreadId): string {
    if (typeof platformData.messageThreadId === "number") {
      return `telegram:${platformData.chatId}:${platformData.messageThreadId}`;
    }

    return `telegram:${platformData.chatId}`;
  }

  decodeThreadId(threadId: string): TelegramThreadId {
    const parts = threadId.split(":");
    if (parts[0] !== "telegram" || parts.length < 2 || parts.length > 3) {
      throw new ValidationError(
        "telegram",
        `Invalid Telegram thread ID: ${threadId}`
      );
    }

    const chatId = parts[1];
    if (!chatId) {
      throw new ValidationError(
        "telegram",
        `Invalid Telegram thread ID: ${threadId}`
      );
    }

    const messageThreadPart = parts[2];
    if (!messageThreadPart) {
      return { chatId };
    }

    const messageThreadId = Number.parseInt(messageThreadPart, 10);
    if (!Number.isFinite(messageThreadId)) {
      throw new ValidationError(
        "telegram",
        `Invalid Telegram thread topic ID in thread ID: ${threadId}`
      );
    }

    return {
      chatId,
      messageThreadId,
    };
  }

  parseMessage(raw: TelegramRawMessage): Message<TelegramRawMessage> {
    const threadId = this.encodeThreadId({
      chatId: String(raw.chat.id),
      messageThreadId: raw.message_thread_id,
    });

    const message = this.parseTelegramMessage(raw, threadId);
    this.cacheMessage(message);
    return message;
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  protected parseTelegramMessage(
    raw: TelegramMessage,
    threadId: string,
    content?: {
      formatted: FormattedContent;
      text: string;
    }
  ): Message<TelegramRawMessage> {
    const richMarkdown = raw.rich_message
      ? richMessageToMarkdown(raw.rich_message)
      : "";
    const plainText =
      content?.text ??
      raw.text ??
      raw.caption ??
      (raw.rich_message ? richMessageToText(raw.rich_message) : "");
    const entities = raw.entities ?? raw.caption_entities ?? [];
    const text = content?.text
      ? content.text
      : applyTelegramEntities(plainText, entities);
    let author: TelegramMessageAuthor;

    if (raw.from) {
      author = this.toAuthor(raw.from);
    } else if (raw.sender_chat) {
      author = this.toReactionActorAuthor(raw.sender_chat);
    } else {
      const fallbackName =
        this.chatDisplayName(raw.chat) ?? String(raw.chat.id);
      author = {
        userId: String(raw.chat.id),
        userName: fallbackName,
        fullName: fallbackName,
        isBot: "unknown" as const,
        isMe: false,
      };
    }

    const message = new Message<TelegramRawMessage>({
      id: this.encodeMessageId(String(raw.chat.id), raw.message_id),
      threadId,
      text,
      formatted:
        content?.formatted ?? this.formatConverter.toAst(richMarkdown || text),
      raw,
      author,
      metadata: {
        dateSent: new Date(raw.date * 1000),
        edited: raw.edit_date !== undefined,
        editedAt:
          raw.edit_date !== undefined
            ? new Date(raw.edit_date * 1000)
            : undefined,
      },
      attachments: this.extractAttachments(raw),
      isMention: this.isBotMentioned(raw, plainText),
    });

    return message;
  }

  protected extractAttachments(raw: TelegramMessage): Attachment[] {
    const attachments: Attachment[] = [];

    const photo = raw.photo?.at(-1);
    if (photo) {
      attachments.push(
        this.createAttachment("image", photo.file_id, {
          size: photo.file_size,
          width: photo.width,
          height: photo.height,
        })
      );
    }

    if (raw.video) {
      attachments.push(
        this.createAttachment("video", raw.video.file_id, {
          size: raw.video.file_size,
          width: raw.video.width,
          height: raw.video.height,
          name: raw.video.file_name,
          mimeType: raw.video.mime_type,
        })
      );
    }

    if (raw.audio) {
      attachments.push(
        this.createAttachment("audio", raw.audio.file_id, {
          size: raw.audio.file_size,
          name: raw.audio.file_name,
          mimeType: raw.audio.mime_type,
        })
      );
    }

    if (raw.voice) {
      attachments.push(
        this.createAttachment("audio", raw.voice.file_id, {
          size: raw.voice.file_size,
          mimeType: raw.voice.mime_type,
        })
      );
    }

    if (raw.document) {
      attachments.push(
        this.createAttachment("file", raw.document.file_id, {
          size: raw.document.file_size,
          name: raw.document.file_name,
          mimeType: raw.document.mime_type,
        })
      );
    }

    if (raw.video_note) {
      attachments.push(
        this.createAttachment("video", raw.video_note.file_id, {
          size: raw.video_note.file_size,
          width: raw.video_note.length,
          height: raw.video_note.length,
        })
      );
    }

    if (raw.rich_message) {
      for (const media of richMessageMedia(raw.rich_message)) {
        attachments.push(
          this.createAttachment(media.type, media.file.file_id, {
            size: media.file.file_size,
            width: media.width,
            height: media.height,
            name: media.name,
            mimeType: media.mimeType,
          })
        );
      }
    }

    return attachments;
  }

  protected createAttachment(
    type: Attachment["type"],
    fileId: string,
    metadata?: {
      size?: number;
      width?: number;
      height?: number;
      name?: string;
      mimeType?: string;
    }
  ): Attachment {
    return {
      type,
      size: metadata?.size,
      width: metadata?.width,
      height: metadata?.height,
      name: metadata?.name,
      mimeType: metadata?.mimeType,
      fetchMetadata: { fileId },
      fetchData: async () => this.downloadFile(fileId),
    };
  }

  rehydrateAttachment(attachment: Attachment): Attachment {
    const fileId = attachment.fetchMetadata?.fileId;
    if (!fileId) {
      return attachment;
    }
    return {
      ...attachment,
      fetchData: async () => this.downloadFile(fileId),
    };
  }

  protected async downloadFile(fileId: string): Promise<Buffer> {
    const file = await this.telegramFetch<TelegramFile>("getFile", {
      file_id: fileId,
    });

    if (!file.file_path) {
      throw new ResourceNotFoundError("telegram", "file", fileId);
    }

    const fileUrl = `${this.apiBaseUrl}/file/bot${this.botToken}/${file.file_path}`;

    let response: Response;
    try {
      response = await fetch(fileUrl);
    } catch (error) {
      throw new NetworkError(
        "telegram",
        `Failed to download Telegram file ${fileId}`,
        error instanceof Error ? error : undefined
      );
    }

    if (!response.ok) {
      throw new NetworkError(
        "telegram",
        `Failed to download Telegram file ${fileId}: ${response.status}`
      );
    }

    return Buffer.from(await response.arrayBuffer());
  }

  protected async sendDocument(
    thread: TelegramThreadId,
    file: {
      filename: string;
      data: Buffer | Blob | ArrayBuffer;
      mimeType?: string;
    },
    text: string,
    plainText: string,
    replyMarkup?: TelegramInlineKeyboardMarkup,
    parseMode: TelegramParseMode = "plain"
  ): Promise<TelegramMessage> {
    const buffer = await this.toTelegramBuffer(file.data);

    return this.withTelegramMarkdownFallback(
      parseMode,
      (resolvedParseMode, resolvedText) =>
        this.telegramFetch<TelegramMessage>(
          "sendDocument",
          this.createTelegramDocumentFormData(
            thread,
            file,
            buffer,
            resolvedText,
            replyMarkup,
            resolvedParseMode
          )
        ),
      {
        initialText: text,
        fallbackText: plainText,
        method: "sendDocument",
        threadId: this.encodeThreadId(thread),
      }
    );
  }

  private createTelegramDocumentFormData(
    thread: TelegramThreadId,
    file: {
      filename: string;
      mimeType?: string;
    },
    buffer: Buffer,
    text: string,
    replyMarkup?: TelegramInlineKeyboardMarkup,
    parseMode: TelegramParseMode = "plain"
  ): FormData {
    const formData = new FormData();
    formData.append("chat_id", thread.chatId);
    if (typeof thread.messageThreadId === "number") {
      formData.append("message_thread_id", String(thread.messageThreadId));
    }

    if (text.trim()) {
      formData.append(
        "caption",
        truncateForTelegram(text, TELEGRAM_CAPTION_LIMIT, parseMode)
      );
      const botApiParseMode = toBotApiParseMode(parseMode);
      if (botApiParseMode) {
        formData.append("parse_mode", botApiParseMode);
      }
    }

    const blob = new Blob([new Uint8Array(buffer)], {
      type: file.mimeType ?? "application/octet-stream",
    });
    formData.append("document", blob, file.filename);
    if (replyMarkup) {
      formData.append("reply_markup", JSON.stringify(replyMarkup));
    }

    return formData;
  }

  protected async sendAttachment(
    thread: TelegramThreadId,
    attachment: Attachment,
    text: string,
    plainText: string,
    replyMarkup?: TelegramInlineKeyboardMarkup,
    parseMode: TelegramParseMode = "plain"
  ): Promise<TelegramMessage> {
    const upload = ATTACHMENT_UPLOADS[attachment.type];
    const data =
      attachment.data ??
      (attachment.fetchData ? await attachment.fetchData() : undefined);

    if (!(data || attachment.url)) {
      throw new ValidationError(
        "telegram",
        `Attachment data or URL required for ${attachment.type}`
      );
    }

    const buffer = data ? await this.toTelegramBuffer(data) : undefined;

    return this.withTelegramMarkdownFallback(
      parseMode,
      (resolvedParseMode, resolvedText) => {
        if (!buffer) {
          const payload: Record<string, unknown> = {
            chat_id: thread.chatId,
            [upload.field]: attachment.url,
          };

          if (typeof thread.messageThreadId === "number") {
            payload.message_thread_id = thread.messageThreadId;
          }

          if (resolvedText.trim()) {
            payload.caption = truncateForTelegram(
              resolvedText,
              TELEGRAM_CAPTION_LIMIT,
              resolvedParseMode
            );
            const botApiParseMode = toBotApiParseMode(resolvedParseMode);
            if (botApiParseMode) {
              payload.parse_mode = botApiParseMode;
            }
          }

          if (attachment.type === "video") {
            if (Number.isInteger(attachment.width)) {
              payload.width = attachment.width;
            }
            if (Number.isInteger(attachment.height)) {
              payload.height = attachment.height;
            }
          }

          if (replyMarkup) {
            payload.reply_markup = replyMarkup;
          }

          return this.telegramFetch<TelegramMessage>(upload.method, payload);
        }

        const formData = new FormData();

        formData.append("chat_id", thread.chatId);
        if (typeof thread.messageThreadId === "number") {
          formData.append("message_thread_id", String(thread.messageThreadId));
        }

        if (resolvedText.trim()) {
          formData.append(
            "caption",
            truncateForTelegram(
              resolvedText,
              TELEGRAM_CAPTION_LIMIT,
              resolvedParseMode
            )
          );
          const botApiParseMode = toBotApiParseMode(resolvedParseMode);
          if (botApiParseMode) {
            formData.append("parse_mode", botApiParseMode);
          }
        }

        if (attachment.type === "video") {
          if (Number.isInteger(attachment.width)) {
            formData.append("width", String(attachment.width));
          }
          if (Number.isInteger(attachment.height)) {
            formData.append("height", String(attachment.height));
          }
        }

        const blob = new Blob([new Uint8Array(buffer)], {
          type: attachment.mimeType ?? "application/octet-stream",
        });
        formData.append(upload.field, blob, attachment.name ?? "attachment");
        if (replyMarkup) {
          formData.append("reply_markup", JSON.stringify(replyMarkup));
        }

        return this.telegramFetch<TelegramMessage>(upload.method, formData);
      },
      {
        initialText: text,
        fallbackText: plainText,
        method: upload.method,
        threadId: this.encodeThreadId(thread),
      }
    );
  }

  protected async toTelegramBuffer(
    data: Buffer | Blob | ArrayBuffer
  ): Promise<Buffer> {
    if (Buffer.isBuffer(data)) {
      return data;
    }
    if (data instanceof ArrayBuffer) {
      return Buffer.from(data);
    }
    if (data instanceof Blob) {
      return Buffer.from(await data.arrayBuffer());
    }
    throw new ValidationError("telegram", "Unsupported file data type");
  }

  protected paginateMessages(
    messages: Message<TelegramRawMessage>[],
    options: FetchOptions
  ): FetchResult<TelegramRawMessage> {
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

  protected cacheMessage(message: Message<TelegramRawMessage>): void {
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

  protected findCachedMessage(
    messageId: string
  ): Message<TelegramRawMessage> | undefined {
    for (const messages of this.messageCache.values()) {
      const found = messages.find((message) => message.id === messageId);
      if (found) {
        return found;
      }
    }

    return undefined;
  }

  protected deleteCachedMessage(messageId: string): void {
    for (const [threadId, messages] of this.messageCache.entries()) {
      const filtered = messages.filter((message) => message.id !== messageId);
      if (filtered.length === 0) {
        this.messageCache.delete(threadId);
      } else if (filtered.length !== messages.length) {
        this.messageCache.set(threadId, filtered);
      }
    }
  }

  protected compareMessages(
    a: Message<TelegramRawMessage>,
    b: Message<TelegramRawMessage>
  ): number {
    const timeDiff =
      a.metadata.dateSent.getTime() - b.metadata.dateSent.getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }

    return this.messageSequence(a.id) - this.messageSequence(b.id);
  }

  protected messageSequence(messageId: string): number {
    const match = messageId.match(MESSAGE_SEQUENCE_PATTERN);
    return match ? Number.parseInt(match[1], 10) : 0;
  }

  protected createDraftId(): number {
    this.nextDraftId =
      this.nextDraftId >= 2_147_483_647 ? 1 : this.nextDraftId + 1;
    return this.nextDraftId;
  }

  protected resolveThreadId(value: string): TelegramThreadId {
    if (value.startsWith("telegram:")) {
      return this.decodeThreadId(value);
    }

    return { chatId: value };
  }

  protected encodeMessageId(chatId: string, messageId: number): string {
    return `${chatId}:${messageId}`;
  }

  protected decodeCompositeMessageId(
    messageId: string,
    expectedChatId?: string
  ): { chatId: string; messageId: number; compositeId: string } {
    const compositeMatch = messageId.match(MESSAGE_ID_PATTERN);

    if (compositeMatch) {
      const [, chatId, rawMessageId] = compositeMatch;
      const parsedMessageId = Number.parseInt(rawMessageId, 10);

      if (expectedChatId && chatId !== expectedChatId) {
        throw new ValidationError(
          "telegram",
          `Message ID chat mismatch: expected ${expectedChatId}, got ${chatId}`
        );
      }

      return {
        chatId,
        messageId: parsedMessageId,
        compositeId: `${chatId}:${parsedMessageId}`,
      };
    }

    if (!expectedChatId) {
      throw new ValidationError(
        "telegram",
        `Telegram message ID must be in <chatId>:<messageId> format, got: ${messageId}`
      );
    }

    const parsedMessageId = Number.parseInt(messageId, 10);
    if (!Number.isFinite(parsedMessageId)) {
      throw new ValidationError(
        "telegram",
        `Invalid Telegram message ID: ${messageId}`
      );
    }

    return {
      chatId: expectedChatId,
      messageId: parsedMessageId,
      compositeId: `${expectedChatId}:${parsedMessageId}`,
    };
  }

  protected toAuthor(user: TelegramUser): TelegramMessageAuthor {
    const fullName = [user.first_name, user.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();

    return {
      userId: String(user.id),
      userName: user.username ?? user.first_name ?? String(user.id),
      fullName: fullName || user.username || String(user.id),
      isBot: user.is_bot,
      isMe: String(user.id) === this._botUserId,
    };
  }

  protected toReactionActorAuthor(chat: TelegramChat): TelegramMessageAuthor {
    const name = this.chatDisplayName(chat) ?? String(chat.id);
    return {
      userId: `chat:${chat.id}`,
      userName: name,
      fullName: name,
      isBot: "unknown" as const,
      isMe: false,
    };
  }

  protected chatDisplayName(chat: TelegramChat): string | undefined {
    if (chat.title) {
      return chat.title;
    }

    const privateName = [chat.first_name, chat.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (privateName) {
      return privateName;
    }

    return chat.username;
  }

  protected isBotMentioned(message: TelegramMessage, text: string): boolean {
    if (!text) {
      return false;
    }

    const username = this._userName;

    const entities = message.entities ?? message.caption_entities ?? [];
    for (const entity of entities) {
      if (entity.type === "mention") {
        const mentionText = this.entityText(text, entity);
        if (mentionText.toLowerCase() === `@${username.toLowerCase()}`) {
          return true;
        }
      }

      if (
        entity.type === "text_mention" &&
        entity.user &&
        this._botUserId &&
        String(entity.user.id) === this._botUserId
      ) {
        return true;
      }

      if (entity.type === "bot_command") {
        const commandText = this.entityText(text, entity);
        if (commandText.toLowerCase().endsWith(`@${username.toLowerCase()}`)) {
          return true;
        }
      }
    }

    const mentionRegex = new RegExp(`@${this.escapeRegex(username)}\\b`, "i");
    return mentionRegex.test(text);
  }

  protected entityText(text: string, entity: TelegramMessageEntity): string {
    return text.slice(entity.offset, entity.offset + entity.length);
  }

  protected escapeRegex(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  protected normalizeUserName(value: unknown): string {
    if (typeof value !== "string") {
      return "bot";
    }

    return value.replace(LEADING_AT_PATTERN, "").trim() || "bot";
  }

  protected resolveParseMode(
    message: AdapterPostableMessage,
    card: ReturnType<typeof extractCard>
  ): TelegramParseMode {
    // Cards and any message routed through the format converter are rendered
    // as MarkdownV2, so Telegram must parse them with MarkdownV2.
    if (card) {
      return "MarkdownV2";
    }
    // Plain strings and raw messages ship verbatim — no markdown parsing.
    if (typeof message === "string") {
      return "plain";
    }
    if (typeof message === "object" && message !== null && "raw" in message) {
      return "plain";
    }
    // Every other shape ({markdown}, {ast}, JSX, etc.) flows through
    // formatConverter.renderPostable, which emits MarkdownV2.
    return "MarkdownV2";
  }

  protected resolveRichMessage(
    message: AdapterPostableMessage,
    card: ReturnType<typeof extractCard>,
    fileCount: number,
    attachmentCount: number
  ): {
    formatted: FormattedContent;
    markdown: string;
    text: string;
  } | null {
    if (
      !this.richMessagesAvailable ||
      card ||
      fileCount > 0 ||
      attachmentCount > 0 ||
      typeof message === "string" ||
      "raw" in message
    ) {
      return null;
    }

    if ("markdown" in message) {
      const formatted = this.formatConverter.toAst(message.markdown);
      return {
        formatted,
        markdown: truncateRichMarkdown(
          convertEmojiPlaceholders(message.markdown, "gchat")
        ),
        text: toPlainText(formatted),
      };
    }

    if ("ast" in message) {
      return {
        formatted: message.ast,
        markdown: truncateRichMarkdown(
          convertEmojiPlaceholders(stringifyMarkdown(message.ast), "gchat")
        ),
        text: toPlainText(message.ast),
      };
    }

    return null;
  }

  protected renderPlainTextMessage(
    message: AdapterPostableMessage,
    card: ReturnType<typeof extractCard>
  ): string {
    if (card) {
      return cardToFallbackText(card);
    }
    if (typeof message === "string") {
      return message;
    }
    if ("raw" in message) {
      return message.raw;
    }
    if ("markdown" in message) {
      return this.resolveTelegramFallbackText(
        message.markdown,
        markdownToPlainText(message.markdown)
      );
    }
    if ("ast" in message) {
      return toPlainText(message.ast);
    }
    return this.formatConverter.renderPostable(message);
  }

  protected resolveTelegramFallbackText(
    originalText: string,
    fallbackText: string
  ): string {
    return fallbackText.trim() ? fallbackText : originalText;
  }

  protected async sendRegularMessage(
    thread: TelegramThreadId,
    text: string,
    plainText: string,
    parseMode: TelegramParseMode,
    replyMarkup: TelegramInlineKeyboardMarkup | undefined,
    threadId: string
  ): Promise<TelegramMessage> {
    return this.withTelegramMarkdownFallback(
      parseMode,
      (resolvedParseMode, resolvedText) =>
        this.telegramFetch<TelegramMessage>("sendMessage", {
          chat_id: thread.chatId,
          message_thread_id: thread.messageThreadId,
          text: resolvedText,
          reply_markup: replyMarkup,
          parse_mode: toBotApiParseMode(resolvedParseMode),
        }),
      {
        initialText: text,
        fallbackText: plainText,
        method: "sendMessage",
        threadId,
      }
    );
  }

  protected canFallbackFromRichMessage(
    error: unknown,
    method: string
  ): boolean {
    const message =
      error instanceof ValidationError ? error.message.toLowerCase() : "";
    const missingMethod =
      message.includes("method") && message.includes("not found");
    const unsupportedRich =
      message.includes("rich message") && message.includes("unsupported");

    return (
      (method.startsWith("sendRichMessage") &&
        error instanceof ResourceNotFoundError) ||
      (error instanceof ValidationError &&
        (message.includes("can't parse") || missingMethod || unsupportedRich))
    );
  }

  protected rememberRichMessageFailure(error: unknown, method: string): void {
    const message =
      error instanceof ValidationError ? error.message.toLowerCase() : "";
    const missingMethod =
      message.includes("method") && message.includes("not found");
    const unsupportedRich =
      message.includes("rich message") && message.includes("unsupported");

    if (
      (method.startsWith("sendRichMessage") &&
        error instanceof ResourceNotFoundError) ||
      (error instanceof ValidationError && (missingMethod || unsupportedRich))
    ) {
      this.richMessagesAvailable = false;
    }
  }

  protected toTelegramReaction(
    emoji: EmojiValue | string
  ): TelegramReactionType {
    if (typeof emoji !== "string") {
      return {
        type: "emoji",
        emoji: defaultEmojiResolver.toGChat(emoji.name),
      };
    }

    if (emoji.startsWith("custom:")) {
      return {
        type: "custom_emoji",
        custom_emoji_id: emoji.slice("custom:".length),
      };
    }

    const placeholderMatch = emoji.match(EMOJI_PLACEHOLDER_PATTERN);
    if (placeholderMatch) {
      return {
        type: "emoji",
        emoji: defaultEmojiResolver.toGChat(placeholderMatch[1]),
      };
    }

    if (EMOJI_NAME_PATTERN.test(emoji)) {
      return {
        type: "emoji",
        emoji: defaultEmojiResolver.toGChat(emoji.toLowerCase()),
      };
    }

    return {
      type: "emoji",
      emoji,
    };
  }

  protected reactionKey(reaction: TelegramReactionType): string {
    if (reaction.type === "emoji") {
      return reaction.emoji;
    }

    return `custom:${reaction.custom_emoji_id}`;
  }

  protected reactionToEmojiValue(reaction: TelegramReactionType): EmojiValue {
    if (reaction.type === "emoji") {
      return defaultEmojiResolver.fromGChat(reaction.emoji);
    }

    return getEmoji(`custom:${reaction.custom_emoji_id}`);
  }

  protected async pollingLoop(
    config: ResolvedTelegramLongPollingConfig
  ): Promise<void> {
    let offset: number | undefined;
    let consecutiveFailures = 0;
    const MAX_BACKOFF_MS = 30_000;

    while (this.pollingActive) {
      this.pollingAbortController = new AbortController();

      try {
        const updates = await this.telegramFetch<TelegramUpdate[]>(
          "getUpdates",
          {
            allowed_updates: config.allowedUpdates,
            limit: config.limit,
            offset,
            timeout: config.timeout,
          },
          { signal: this.pollingAbortController.signal }
        );

        consecutiveFailures = 0;

        for (const update of updates) {
          offset = update.update_id + 1;

          try {
            this.processUpdate(update);
          } catch (error) {
            this.logger.warn("Failed to process Telegram polled update", {
              error: String(error),
              updateId: update.update_id,
            });
          }
        }
      } catch (error) {
        if (this.isAbortError(error)) {
          return;
        }

        consecutiveFailures++;
        const backoffMs = Math.min(
          config.retryDelayMs * 2 ** (consecutiveFailures - 1),
          MAX_BACKOFF_MS
        );

        this.logger.warn("Telegram polling request failed", {
          error: String(error),
          retryDelayMs: backoffMs,
          consecutiveFailures,
        });

        if (!this.pollingActive) {
          return;
        }

        await this.sleep(backoffMs);
      } finally {
        this.pollingAbortController = null;
      }
    }
  }

  protected resolvePollingConfig(
    override?: TelegramLongPollingConfig
  ): ResolvedTelegramLongPollingConfig {
    const baseConfig = this.longPolling ?? {};
    const merged = {
      ...baseConfig,
      ...override,
    };

    return {
      allowedUpdates:
        merged.allowedUpdates && merged.allowedUpdates.length > 0
          ? [...merged.allowedUpdates]
          : undefined,
      deleteWebhook: merged.deleteWebhook ?? true,
      dropPendingUpdates: merged.dropPendingUpdates ?? false,
      limit: this.clampInteger(
        merged.limit,
        TELEGRAM_DEFAULT_POLLING_LIMIT,
        TELEGRAM_MIN_POLLING_LIMIT,
        TELEGRAM_MAX_POLLING_LIMIT
      ),
      retryDelayMs: this.clampInteger(
        merged.retryDelayMs,
        TELEGRAM_DEFAULT_POLLING_RETRY_DELAY_MS,
        0,
        Number.MAX_SAFE_INTEGER
      ),
      timeout: this.clampInteger(
        merged.timeout,
        TELEGRAM_DEFAULT_POLLING_TIMEOUT_SECONDS,
        TELEGRAM_MIN_POLLING_TIMEOUT_SECONDS,
        TELEGRAM_MAX_POLLING_TIMEOUT_SECONDS
      ),
    };
  }

  protected clampInteger(
    value: number | undefined,
    fallback: number,
    min: number,
    max: number
  ): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fallback;
    }

    const parsed = Math.trunc(value);
    return Math.max(min, Math.min(max, parsed));
  }

  protected isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }

  protected async sleep(delayMs: number): Promise<void> {
    if (delayMs <= 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  protected async telegramFetch<TResult>(
    method: string,
    payload?: Record<string, unknown> | FormData,
    request?: {
      signal?: AbortSignal;
    }
  ): Promise<TResult> {
    const url = `${this.apiBaseUrl}/bot${this.botToken}/${method}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers:
          payload instanceof FormData
            ? undefined
            : {
                "Content-Type": "application/json",
              },
        body:
          payload instanceof FormData ? payload : JSON.stringify(payload ?? {}),
        signal: request?.signal,
      });
    } catch (error) {
      if (this.isAbortError(error)) {
        throw error;
      }

      throw new NetworkError(
        "telegram",
        `Network error calling Telegram ${method}`,
        error instanceof Error ? error : undefined
      );
    }

    let data: TelegramApiResponse<TResult>;
    try {
      data = (await response.json()) as TelegramApiResponse<TResult>;
    } catch {
      throw new NetworkError(
        "telegram",
        `Failed to parse Telegram API response for ${method}`
      );
    }

    if (!(response.ok && data.ok)) {
      this.throwTelegramApiError(method, response.status, data);
    }

    if (typeof data.result === "undefined") {
      throw new NetworkError(
        "telegram",
        `Telegram API ${method} returned no result`
      );
    }

    return data.result;
  }

  protected throwTelegramApiError(
    method: string,
    status: number,
    data: TelegramApiResponse<unknown>
  ): never {
    const errorCode = data.error_code ?? status;
    const description = data.description ?? `Telegram API ${method} failed`;

    if (errorCode === 429) {
      throw new AdapterRateLimitError("telegram", data.parameters?.retry_after);
    }

    if (errorCode === 401) {
      throw new AuthenticationError("telegram", description);
    }

    if (errorCode === 403) {
      throw new PermissionError("telegram", method);
    }

    if (errorCode === 404) {
      throw new ResourceNotFoundError("telegram", method);
    }

    if (errorCode >= 400 && errorCode < 500) {
      throw new ValidationError("telegram", description);
    }

    throw new NetworkError(
      "telegram",
      `${description} (status ${status}, error ${errorCode})`
    );
  }

  protected async withTelegramMarkdownFallback<TResult>(
    parseMode: TelegramParseMode,
    operation: (parseMode: TelegramParseMode, text: string) => Promise<TResult>,
    context: {
      initialText: string;
      fallbackText: string;
      method: string;
      messageId?: string;
      threadId?: string;
    }
  ): Promise<TResult> {
    try {
      return await operation(parseMode, context.initialText);
    } catch (error) {
      if (
        parseMode !== "MarkdownV2" ||
        !this.isTelegramMarkdownParseError(error)
      ) {
        throw error;
      }

      this.logger.warn(
        "Telegram markdown parse failed; retrying without parse mode",
        {
          error: String(error),
          ...context,
        }
      );

      return operation(
        "plain",
        this.resolveTelegramFallbackText(
          context.initialText,
          context.fallbackText
        )
      );
    }
  }

  protected isTelegramMarkdownParseError(error: unknown): boolean {
    return (
      error instanceof ValidationError &&
      error.adapter === "telegram" &&
      TELEGRAM_MARKDOWN_PARSE_ERROR_PATTERN.test(error.message)
    );
  }

  protected async withTelegramRichFallback<TResult>(
    operation: () => Promise<TResult>,
    fallback: () => Promise<TResult>,
    context: {
      method: string;
      messageId?: string;
      threadId?: string;
    }
  ): Promise<TResult> {
    try {
      return await operation();
    } catch (error) {
      if (!this.canFallbackFromRichMessage(error, context.method)) {
        throw error;
      }

      this.rememberRichMessageFailure(error, context.method);
      this.logger.warn(
        "Telegram rich message failed; retrying with a regular message",
        {
          error: String(error),
          ...context,
        }
      );
      return fallback();
    }
  }
}

export function createTelegramAdapter(
  config?: TelegramAdapterConfig
): TelegramAdapter {
  return new TelegramAdapter(config ?? {});
}

export { escapeMarkdownV2, TelegramFormatConverter } from "./markdown";
export type {
  TelegramAdapterConfig,
  TelegramAdapterMode,
  TelegramAnimation,
  TelegramAudio,
  TelegramCallbackQuery,
  TelegramChat,
  TelegramLocation,
  TelegramLongPollingConfig,
  TelegramMessage,
  TelegramMessageReactionUpdated,
  TelegramRawMessage,
  TelegramReactionType,
  TelegramRichBlock,
  TelegramRichCaption,
  TelegramRichCell,
  TelegramRichItem,
  TelegramRichMessage,
  TelegramRichText,
  TelegramThreadId,
  TelegramUpdate,
  TelegramUser,
  TelegramVideo,
  TelegramVideoQuality,
  TelegramVoice,
  TelegramWebhookInfo,
} from "./types";
