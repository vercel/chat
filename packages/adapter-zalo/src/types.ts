/**
 * Type definitions for the Zalo adapter.
 *
 * Based on the Zalo Bot Platform API.
 * @see https://bot.zapps.me/docs
 */

import type { Logger } from "chat";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Zalo adapter configuration.
 */
export interface ZaloAdapterConfig {
  /** Bot token in format: 12345689:abc-xyz */
  botToken: string;
  /** Logger instance for error reporting */
  logger: Logger;
  /** Bot display name used for identification */
  userName: string;
  /** Secret token for webhook verification (8-256 chars) */
  webhookSecret: string;
}

// =============================================================================
// Thread ID
// =============================================================================

/**
 * Decoded thread ID for Zalo.
 *
 * Zalo has no threading concept. Each conversation is identified by chat.id.
 *
 * Format: zalo:{chatId}
 */
export interface ZaloThreadId {
  /** Conversation/chat ID */
  chatId: string;
}

// =============================================================================
// Webhook Payloads
// =============================================================================

/**
 * The result object within the webhook notification.
 */
export interface ZaloWebhookResult {
  event_name: string;
  message: ZaloInboundMessage;
}

/**
 * Inbound message from a user via Zalo webhook.
 */
export interface ZaloInboundMessage {
  /** Optional caption for image messages */
  caption?: string;
  /** Chat context */
  chat: {
    chat_type: "PRIVATE" | "GROUP";
    id: string;
  };
  /** Unix timestamp in milliseconds */
  date: number;
  /** Message sender */
  from: {
    display_name: string;
    id: string;
    is_bot: boolean;
  };
  /** Unique message ID */
  message_id: string;
  /** Photo URL (image messages) */
  photo?: string;
  /** Sticker ID */
  sticker?: string;
  /** Text content (text messages) */
  text?: string;
}

// =============================================================================
// Raw Message Type
// =============================================================================

/**
 * Platform-specific raw message type for Zalo.
 */
export interface ZaloRawMessage {
  /** The raw inbound message data */
  message: ZaloInboundMessage;
}

// =============================================================================
// API Response Types
// =============================================================================

/**
 * Generic Zalo Bot API response envelope.
 */
export interface ZaloApiResponse<T = unknown> {
  description?: string;
  error_code?: number;
  ok: boolean;
  result?: T;
}

/**
 * Response from sendMessage / sendPhoto / sendSticker.
 */
export interface ZaloSendResponse {
  date: number;
  message_id: string;
  message_type: "TEXT" | "CHAT_PHOTO" | "STICKER";
}

/**
 * Response from getMe.
 */
export interface ZaloGetMeResponse {
  account_name: string;
  account_type: string;
  can_join_groups: boolean;
  id: string;
}
