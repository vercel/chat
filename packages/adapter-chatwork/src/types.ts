/**
 * Chatwork adapter types.
 */

/**
 * Chatwork adapter configuration.
 */
export interface ChatworkAdapterConfig {
  /** Chatwork API token for sending messages */
  apiToken: string;
  /** Webhook token for verifying incoming webhook requests */
  webhookToken?: string;
  /** Bot's Chatwork account ID (used to detect own messages) */
  botAccountId?: string;
  /** Bot display name override */
  userName?: string;
}

/**
 * Chatwork thread ID components.
 * Chatwork uses rooms as the primary conversation unit.
 * Messages can optionally reference a parent message for threaded replies.
 */
export interface ChatworkThreadId {
  /** Room ID */
  roomId: string;
}

/**
 * Chatwork webhook event payload.
 * @see https://developer.chatwork.com/docs/webhook
 */
export interface ChatworkWebhookPayload {
  /** Webhook event type */
  webhook_event_type: ChatworkWebhookEventType;
  /** Webhook event */
  webhook_event: ChatworkWebhookEvent;
  /** Webhook setting ID */
  webhook_setting_id: string;
}

export type ChatworkWebhookEventType =
  | "message_created"
  | "message_updated"
  | "message_deleted"
  | "mention_to_me";

/**
 * Chatwork webhook event body.
 */
export interface ChatworkWebhookEvent {
  /** Message ID */
  message_id: string;
  /** Room ID */
  room_id: number;
  /** Account info of the message sender */
  account_id: number;
  /** Message body text */
  body: string;
  /** Send time (Unix timestamp) */
  send_time: number;
  /** Update time (Unix timestamp) */
  update_time: number;
}

/**
 * Chatwork API message response.
 */
export interface ChatworkApiMessage {
  /** Message ID */
  message_id: string;
  /** Account info */
  account: {
    account_id: number;
    name: string;
    avatar_image_url: string;
  };
  /** Message body */
  body: string;
  /** Send time (Unix timestamp) */
  send_time: number;
  /** Update time (Unix timestamp) */
  update_time: number;
}

/**
 * Chatwork API room response.
 */
export interface ChatworkApiRoom {
  room_id: number;
  name: string;
  type: "my" | "direct" | "group";
  icon_path: string;
  description?: string;
}

/**
 * Chatwork send message response.
 */
export interface ChatworkSendMessageResponse {
  message_id: string;
}
