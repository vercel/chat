/**
 * Feishu (Lark) adapter types.
 */

/**
 * Feishu adapter configuration.
 */
export interface FeishuAdapterConfig {
  /** Feishu application ID */
  appId: string;
  /** Feishu application secret */
  appSecret: string;
  /** Encryption key for event subscription verification */
  encryptKey?: string;
  /** Verification token for event subscription verification */
  verificationToken?: string;
}

/**
 * Feishu thread ID components.
 * Used for encoding/decoding thread IDs.
 */
export interface FeishuThreadId {
  /** Chat (group) ID, e.g. "oc_xxx" */
  chatId: string;
  /** Root message ID for thread, e.g. "om_xxx" */
  messageId: string;
}

// ============================================================================
// Feishu Event Types
// ============================================================================

/**
 * Feishu event callback wrapper.
 * @see https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-challenge-event
 */
export interface FeishuEventCallback {
  /** Challenge token for URL verification */
  challenge?: string;
  /** Event data */
  event?: FeishuEvent;
  /** Event header */
  header?: FeishuEventHeader;
  /** Schema version */
  schema?: string;
  /** Token for verification (v1 events) */
  token?: string;
  /** Event type (v1 events) */
  type?: string;
}

/**
 * Feishu event header.
 */
export interface FeishuEventHeader {
  /** Application ID */
  app_id: string;
  /** Timestamp string */
  create_time: string;
  /** Unique event ID */
  event_id: string;
  /** Event type, e.g. "im.message.receive_v1" */
  event_type: string;
  /** Tenant key */
  tenant_key: string;
  /** Token */
  token: string;
}

/**
 * Feishu event data for im.message.receive_v1.
 */
export interface FeishuEvent {
  /** Message data */
  message: FeishuEventMessage;
  /** Sender data */
  sender: FeishuEventSender;
}

/**
 * Feishu message data from event.
 */
export interface FeishuEventMessage {
  /** Chat ID where the message was sent */
  chat_id: string;
  /** Chat type: "group" or "p2p" */
  chat_type: string;
  /** Message content (JSON string) */
  content: string;
  /** ISO timestamp when the message was created */
  create_time: string;
  /** Mentions in the message */
  mentions?: FeishuMention[];
  /** Unique message ID */
  message_id: string;
  /** Message type: "text", "post", "interactive", "image", etc. */
  message_type: string;
  /** Parent message ID (for replies in thread) */
  parent_id?: string;
  /** Root message ID (for thread root) */
  root_id?: string;
  /** Update time */
  update_time?: string;
}

/**
 * Feishu mention data.
 */
export interface FeishuMention {
  /** Mention ID (user open_id or chat_id) */
  id: {
    open_id?: string;
    union_id?: string;
    user_id?: string;
  };
  /** Key used in content, e.g. "@_user_1" */
  key: string;
  /** Display name */
  name: string;
  /** Tenant key */
  tenant_key?: string;
}

/**
 * Feishu sender data from event.
 */
export interface FeishuEventSender {
  /** Sender ID */
  sender_id: {
    open_id: string;
    union_id?: string;
    user_id?: string;
  };
  /** Sender type: "user" or "app" */
  sender_type: string;
  /** Tenant key */
  tenant_key?: string;
}

// ============================================================================
// Feishu API Response Types
// ============================================================================

/**
 * Feishu interactive card content.
 * @see https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-components
 */
export interface FeishuInteractiveCard {
  config?: {
    wide_screen_mode?: boolean;
  };
  elements: FeishuCardElement[];
  header?: {
    template?: string;
    title: {
      content: string;
      tag: "plain_text" | "lark_md";
    };
  };
}

/**
 * Feishu card element (simplified).
 */
export type FeishuCardElement =
  | FeishuCardDivElement
  | FeishuCardHrElement
  | FeishuCardActionElement;

/**
 * Feishu card div element (text block).
 */
interface FeishuCardDivElement {
  tag: "div";
  text: {
    content: string;
    tag: "plain_text" | "lark_md";
  };
}

/**
 * Feishu card hr (divider) element.
 */
interface FeishuCardHrElement {
  tag: "hr";
}

/**
 * Feishu card action element (buttons).
 */
export interface FeishuCardActionElement {
  actions: FeishuCardButtonElement[];
  tag: "action";
}

/**
 * Feishu card button element.
 */
export interface FeishuCardButtonElement {
  tag: "button";
  text: {
    content: string;
    tag: "plain_text";
  };
  type?: "default" | "primary" | "danger";
  url?: string;
  value?: Record<string, string>;
}
