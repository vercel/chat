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
  /** Override the Telegram API base URL. Alias for apiBaseUrl — apiUrl takes precedence if both are set. Defaults to TELEGRAM_API_BASE_URL env var. */
  apiUrl?: string;
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

export interface TelegramAnimation extends TelegramFile {
  duration: number;
  file_name?: string;
  height: number;
  mime_type?: string;
  thumbnail?: TelegramPhotoSize;
  width: number;
}

export interface TelegramAudio extends TelegramFile {
  duration: number;
  file_name?: string;
  mime_type?: string;
  performer?: string;
  thumbnail?: TelegramPhotoSize;
  title?: string;
}

export interface TelegramLocation {
  heading?: number;
  horizontal_accuracy?: number;
  latitude: number;
  live_period?: number;
  longitude: number;
  proximity_alert_radius?: number;
}

export interface TelegramVideoQuality extends TelegramFile {
  codec: string;
  height: number;
  width: number;
}

export interface TelegramVideo extends TelegramFile {
  cover?: TelegramPhotoSize[];
  duration: number;
  file_name?: string;
  height: number;
  mime_type?: string;
  qualities?: TelegramVideoQuality[];
  start_timestamp?: number;
  thumbnail?: TelegramPhotoSize;
  width: number;
}

export interface TelegramVoice extends TelegramFile {
  duration: number;
  mime_type?: string;
}

/**
 * Rich formatted text received from Telegram.
 * @see https://core.telegram.org/bots/api#richtext
 */
export type TelegramRichText =
  | string
  | TelegramRichText[]
  | {
      type:
        | "bold"
        | "italic"
        | "underline"
        | "strikethrough"
        | "spoiler"
        | "subscript"
        | "superscript"
        | "marked"
        | "code";
      text: TelegramRichText;
    }
  | {
      type: "date_time";
      text: TelegramRichText;
      unix_time: number;
      date_time_format: string;
    }
  | {
      type: "text_mention";
      text: TelegramRichText;
      user: TelegramUser;
    }
  | {
      type: "custom_emoji";
      alternative_text: string;
      custom_emoji_id: string;
    }
  | {
      type: "mathematical_expression";
      expression: string;
    }
  | {
      type: "url";
      text: TelegramRichText;
      url: string;
    }
  | {
      type: "email_address";
      email_address: string;
      text: TelegramRichText;
    }
  | {
      type: "phone_number";
      phone_number: string;
      text: TelegramRichText;
    }
  | {
      type: "bank_card_number";
      bank_card_number: string;
      text: TelegramRichText;
    }
  | {
      type: "mention";
      text: TelegramRichText;
      username: string;
    }
  | {
      type: "hashtag";
      hashtag: string;
      text: TelegramRichText;
    }
  | {
      type: "cashtag";
      cashtag: string;
      text: TelegramRichText;
    }
  | {
      type: "bot_command";
      bot_command: string;
      text: TelegramRichText;
    }
  | {
      type: "anchor";
      name: string;
    }
  | {
      type: "anchor_link";
      anchor_name: string;
      text: TelegramRichText;
    }
  | {
      type: "reference";
      name: string;
      text: TelegramRichText;
    }
  | {
      type: "reference_link";
      reference_name: string;
      text: TelegramRichText;
    };

/**
 * Caption attached to a rich message block.
 * @see https://core.telegram.org/bots/api#richblockcaption
 */
export interface TelegramRichCaption {
  credit?: TelegramRichText;
  text: TelegramRichText;
}

/**
 * Cell in a rich message table.
 * @see https://core.telegram.org/bots/api#richblocktablecell
 */
export interface TelegramRichCell {
  align: "left" | "center" | "right";
  colspan?: number;
  is_header?: true;
  rowspan?: number;
  text?: TelegramRichText;
  valign: "top" | "middle" | "bottom";
}

/**
 * Item in a rich message list.
 * @see https://core.telegram.org/bots/api#richblocklistitem
 */
export interface TelegramRichItem {
  blocks: TelegramRichBlock[];
  has_checkbox?: true;
  is_checked?: true;
  label: string;
  type?: "a" | "A" | "i" | "I" | "1";
  value?: number;
}

/**
 * Structured block in a rich message received from Telegram.
 * @see https://core.telegram.org/bots/api#richblock
 */
export type TelegramRichBlock =
  | {
      type: "paragraph" | "footer" | "thinking";
      text: TelegramRichText;
    }
  | {
      type: "heading";
      size: number;
      text: TelegramRichText;
    }
  | {
      type: "pre";
      language?: string;
      text: TelegramRichText;
    }
  | {
      type: "divider";
    }
  | {
      type: "mathematical_expression";
      expression: string;
    }
  | {
      type: "anchor";
      name: string;
    }
  | {
      type: "list";
      items: TelegramRichItem[];
    }
  | {
      type: "blockquote";
      blocks: TelegramRichBlock[];
      credit?: TelegramRichText;
    }
  | {
      type: "pullquote";
      credit?: TelegramRichText;
      text: TelegramRichText;
    }
  | {
      type: "collage" | "slideshow";
      blocks: TelegramRichBlock[];
      caption?: TelegramRichCaption;
    }
  | {
      type: "table";
      caption?: TelegramRichText;
      cells: TelegramRichCell[][];
      is_bordered?: true;
      is_striped?: true;
    }
  | {
      type: "details";
      blocks: TelegramRichBlock[];
      is_open?: true;
      summary: TelegramRichText;
    }
  | {
      type: "map";
      caption?: TelegramRichCaption;
      height: number;
      location: TelegramLocation;
      width: number;
      zoom: number;
    }
  | {
      type: "animation";
      animation: TelegramAnimation;
      caption?: TelegramRichCaption;
      has_spoiler?: true;
    }
  | {
      type: "audio";
      audio: TelegramAudio;
      caption?: TelegramRichCaption;
    }
  | {
      type: "photo";
      caption?: TelegramRichCaption;
      has_spoiler?: true;
      photo: TelegramPhotoSize[];
    }
  | {
      type: "video";
      caption?: TelegramRichCaption;
      has_spoiler?: true;
      video: TelegramVideo;
    }
  | {
      type: "voice_note";
      caption?: TelegramRichCaption;
      voice_note: TelegramVoice;
    };

/**
 * Rich formatted message received from Telegram.
 * @see https://core.telegram.org/bots/api#richmessage
 */
export interface TelegramRichMessage {
  blocks: TelegramRichBlock[];
  is_rtl?: boolean;
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
  rich_message?: TelegramRichMessage;
  sender_chat?: TelegramChat;
  sticker?: TelegramFile & { emoji?: string };
  text?: string;
  video?: TelegramVideo;
  video_note?: TelegramFile & { length?: number; duration?: number };
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
