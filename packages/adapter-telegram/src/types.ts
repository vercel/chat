import type { Logger } from "chat";

/** Telegram adapter configuration */
export interface TelegramAdapterConfig {
  /** Telegram Bot API token from @BotFather */
  botToken: string;
  /** Logger instance for error reporting */
  logger: Logger;
  /**
   * Secret token for webhook verification.
   * Set via `setWebhook` API's `secret_token` parameter.
   * If provided, the adapter verifies the `X-Telegram-Bot-Api-Secret-Token` header.
   */
  secretToken?: string;
  /** Override bot username (optional, fetched via getMe if not set) */
  userName?: string;
}

/** Telegram-specific thread ID data */
export interface TelegramThreadId {
  /** Telegram chat ID */
  chatId: number;
  /** Forum topic thread ID (0 for regular chats) */
  messageThreadId: number;
}

/** Telegram message entity (bold, italic, link, mention, etc.) */
export interface TelegramEntity {
  length: number;
  offset: number;
  type: string;
  url?: string;
  user?: {
    first_name?: string;
    id: number;
    is_bot?: boolean;
    last_name?: string;
    username?: string;
  };
}

/** Telegram raw message (subset of Telegram Update.message) */
export interface TelegramRawMessage {
  chat: {
    first_name?: string;
    id: number;
    last_name?: string;
    title?: string;
    type: "channel" | "group" | "private" | "supergroup";
    username?: string;
  };
  date: number;
  entities?: TelegramEntity[];
  from?: {
    first_name?: string;
    id: number;
    is_bot?: boolean;
    last_name?: string;
    username?: string;
  };
  message_id: number;
  message_thread_id?: number;
  photo?: Array<{
    file_id: string;
    file_size?: number;
    file_unique_id: string;
    height: number;
    width: number;
  }>;
  reply_to_message?: TelegramRawMessage;
  text?: string;
}

/** Telegram callback query (button clicks) */
export interface TelegramCallbackQuery {
  chat_instance: string;
  data?: string;
  from: {
    first_name?: string;
    id: number;
    is_bot?: boolean;
    last_name?: string;
    username?: string;
  };
  id: string;
  message?: TelegramRawMessage;
}

/** Telegram Update object (webhook payload) */
export interface TelegramUpdate {
  callback_query?: TelegramCallbackQuery;
  edited_message?: TelegramRawMessage;
  message?: TelegramRawMessage;
  update_id: number;
}
