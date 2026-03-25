/**
 * Telegram adapter types.
 */

import type { Logger } from "chat";

/**
 * Telegram adapter configuration.
 */
export interface TelegramAdapterConfig {
  /** Optional custom API base URL (defaults to https://api.telegram.org). Defaults to TELEGRAM_API_BASE_URL env var. */
  apiBaseUrl?: string;
  /** Telegram bot token from BotFather. Defaults to TELEGRAM_BOT_TOKEN env var. */
  botToken?: string;
  /** Logger instance for error reporting. Defaults to ConsoleLogger. */
  logger?: Logger;
  /** Optional long-polling configuration for getUpdates flow. */
  longPolling?: TelegramLongPollingConfig;
  /**
   * Adapter runtime mode:
   * - auto: choose webhook vs polling based on webhook registration/runtime (default)
   * - webhook: webhook-only mode
   * - polling: polling-only mode
   */
  mode?: TelegramAdapterMode;
  /** Optional webhook secret token checked against x-telegram-bot-api-secret-token. Defaults to TELEGRAM_WEBHOOK_SECRET_TOKEN env var. */
  secretToken?: string;
  /** Override bot username (optional). Defaults to TELEGRAM_BOT_USERNAME env var. */
  userName?: string;
}

export type TelegramAdapterMode = "auto" | "webhook" | "polling";

/**
 * Telegram long-polling configuration.
 * @see https://core.telegram.org/bots/api#getupdates
 */
export interface TelegramLongPollingConfig {
  /** Allowed update types passed to getUpdates. */
  allowedUpdates?: string[];
  /**
   * Delete webhook before polling starts.
   * Telegram requires this when switching from webhook mode to getUpdates.
   * @default true
   */
  deleteWebhook?: boolean;
  /** Passed to deleteWebhook as drop_pending_updates when deleting webhook. */
  dropPendingUpdates?: boolean;
  /**
   * Maximum number of updates per getUpdates call.
   * Telegram range: 1-100.
   * @default 100
   */
  limit?: number;
  /** Delay before retrying polling after errors. @default 1000 */
  retryDelayMs?: number;
  /** Long-poll timeout in seconds for getUpdates. @default 30 */
  timeout?: number;
}

/**
 * Telegram thread ID components.
 */
export interface TelegramThreadId {
  /** Telegram chat ID. */
  chatId: string;
  /** Optional forum topic ID for supergroup topics. */
  messageThreadId?: number;
}

/**
 * Telegram user object.
 * @see https://core.telegram.org/bots/api#user
 */
export interface TelegramUser {
  first_name: string;
  id: number;
  is_bot: boolean;
  language_code?: string;
  last_name?: string;
  username?: string;
}

/**
 * Telegram chat object.
 * @see https://core.telegram.org/bots/api#chat
 */
export interface TelegramChat {
  first_name?: string;
  id: number;
  last_name?: string;
  title?: string;
  type: "private" | "group" | "supergroup" | "channel";
  username?: string;
}

/**
 * Telegram message entity (mentions, links, commands, etc).
 * @see https://core.telegram.org/bots/api#messageentity
 */
export interface TelegramMessageEntity {
  language?: string;
  length: number;
  offset: number;
  type: string;
  url?: string;
  user?: TelegramUser;
}

/**
 * Telegram file metadata.
 */
export interface TelegramFile {
  file_id: string;
  file_path?: string;
  file_size?: number;
  file_unique_id?: string;
}

/**
 * Telegram photo size object.
 */
export interface TelegramPhotoSize extends TelegramFile {
  height: number;
  width: number;
}

/**
 * Telegram message.
 * @see https://core.telegram.org/bots/api#message
 */
export interface TelegramMessage {
  audio?: TelegramFile & {
    duration?: number;
    performer?: string;
    title?: string;
    mime_type?: string;
    file_name?: string;
  };
  caption?: string;
  caption_entities?: TelegramMessageEntity[];
  chat: TelegramChat;
  date: number;
  document?: TelegramFile & { file_name?: string; mime_type?: string };
  edit_date?: number;
  entities?: TelegramMessageEntity[];
  from?: TelegramUser;
  message_id: number;
  message_thread_id?: number;
  photo?: TelegramPhotoSize[];
  sender_chat?: TelegramChat;
  sticker?: TelegramFile & { emoji?: string };
  text?: string;
  video?: TelegramFile & {
    width?: number;
    height?: number;
    mime_type?: string;
    file_name?: string;
  };
  voice?: TelegramFile & { duration?: number; mime_type?: string };
}

/**
 * Telegram inline keyboard button.
 * @see https://core.telegram.org/bots/api#inlinekeyboardbutton
 */
export interface TelegramInlineKeyboardButton {
  callback_data?: string;
  text: string;
  url?: string;
}

/**
 * Telegram inline keyboard markup.
 * @see https://core.telegram.org/bots/api#inlinekeyboardmarkup
 */
export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

/**
 * Telegram callback query (inline keyboard button click).
 * @see https://core.telegram.org/bots/api#callbackquery
 */
export interface TelegramCallbackQuery {
  chat_instance: string;
  data?: string;
  from: TelegramUser;
  id: string;
  inline_message_id?: string;
  message?: TelegramMessage;
}

/**
 * Telegram reaction types.
 */
export type TelegramReactionType =
  | {
      emoji: string;
      type: "emoji";
    }
  | {
      custom_emoji_id: string;
      type: "custom_emoji";
    };

/**
 * Telegram message reaction update.
 * @see https://core.telegram.org/bots/api#messagereactionupdated
 */
export interface TelegramMessageReactionUpdated {
  actor_chat?: TelegramChat;
  chat: TelegramChat;
  date: number;
  message_id: number;
  message_thread_id?: number;
  new_reaction: TelegramReactionType[];
  old_reaction: TelegramReactionType[];
  user?: TelegramUser;
}

/**
 * Telegram webhook update payload.
 * @see https://core.telegram.org/bots/api#update
 */
export interface TelegramUpdate {
  callback_query?: TelegramCallbackQuery;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  edited_message?: TelegramMessage;
  message?: TelegramMessage;
  message_reaction?: TelegramMessageReactionUpdated;
  update_id: number;
}

/**
 * Telegram API response envelope.
 */
export interface TelegramApiResponse<TResult> {
  description?: string;
  error_code?: number;
  ok: boolean;
  parameters?: {
    retry_after?: number;
  };
  result?: TResult;
}

/**
 * Telegram webhook info response.
 * @see https://core.telegram.org/bots/api#getwebhookinfo
 */
export interface TelegramWebhookInfo {
  allowed_updates?: string[];
  has_custom_certificate: boolean;
  ip_address?: string;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  pending_update_count: number;
  url: string;
}

export type TelegramRawMessage = TelegramMessage;
