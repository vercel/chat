/**
 * Telegram adapter types.
 */

/**
 * Telegram adapter configuration.
 */
export interface TelegramAdapterConfig {
  /** Optional custom API base URL (defaults to https://api.telegram.org). */
  apiBaseUrl?: string;
  /** Telegram bot token from BotFather. */
  botToken: string;
  /** Optional webhook secret token checked against x-telegram-bot-api-secret-token. */
  secretToken?: string;
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
  length: number;
  offset: number;
  type: string;
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

export type TelegramRawMessage = TelegramMessage;
