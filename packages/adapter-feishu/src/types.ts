/**
 * Feishu Open API type definitions.
 *
 * These types model the Feishu IM v1 API responses and event structures.
 * Event format follows Feishu Event v2.0 schema.
 */

// =============================================================================
// Event Subscription Types (v2.0)
// =============================================================================

/** Top-level event envelope for v2.0 events */
export interface FeishuEventEnvelope {
  event: unknown;
  header: FeishuEventHeader;
  schema: "2.0";
}

export interface FeishuEventHeader {
  app_id: string;
  create_time: string;
  event_id: string;
  event_type: string;
  tenant_key: string;
  token: string;
}

/** URL verification challenge request */
export interface FeishuUrlVerification {
  challenge: string;
  token: string;
  type: "url_verification";
}

/** Encrypted event payload */
export interface FeishuEncryptedEvent {
  encrypt: string;
}

// =============================================================================
// Message Event Types
// =============================================================================

export interface FeishuMessageReceiveEvent {
  message: FeishuEventMessage;
  sender: FeishuEventSender;
}

export interface FeishuEventSender {
  sender_id: {
    open_id: string;
    union_id?: string;
    user_id?: string;
  };
  sender_type: "user" | "app";
  tenant_key?: string;
}

export interface FeishuEventMessage {
  chat_id: string;
  chat_type: "p2p" | "group";
  content: string;
  create_time: string;
  mentions?: FeishuMention[];
  message_id: string;
  message_type: FeishuMessageType;
  parent_id?: string;
  root_id?: string;
  update_time?: string;
}

export interface FeishuMention {
  id: {
    open_id?: string;
    union_id?: string;
    user_id?: string;
  };
  key: string;
  name: string;
  tenant_key?: string;
}

export type FeishuMessageType =
  | "text"
  | "post"
  | "image"
  | "file"
  | "audio"
  | "media"
  | "sticker"
  | "interactive"
  | "share_chat"
  | "share_user"
  | "system";

// =============================================================================
// Reaction Event Types
// =============================================================================

export interface FeishuReactionCreatedEvent {
  action_time: string;
  message_id: string;
  operator_type: "user" | "app";
  reaction_type: { emoji_type: string };
  user_id: {
    open_id: string;
    union_id?: string;
    user_id?: string;
  };
}

export interface FeishuReactionDeletedEvent {
  action_time: string;
  message_id: string;
  operator_type: "user" | "app";
  reaction_type: { emoji_type: string };
  user_id: {
    open_id: string;
    union_id?: string;
    user_id?: string;
  };
}

// =============================================================================
// API Response Types
// =============================================================================

export interface FeishuApiResponse<T = unknown> {
  code: number;
  data?: T;
  msg: string;
}

export interface FeishuMessageResponse {
  body: {
    content: string;
  };
  chat_id: string;
  create_time: string;
  deleted: boolean;
  mentions?: FeishuMention[];
  message_id: string;
  msg_type: string;
  parent_id?: string;
  root_id?: string;
  sender: {
    id: string;
    id_type: string;
    sender_type: string;
    tenant_key?: string;
  };
  update_time?: string;
  updated: boolean;
}

export interface FeishuMessageListResponse {
  has_more: boolean;
  items: FeishuMessageResponse[];
  page_token?: string;
}

export interface FeishuChatInfo {
  chat_id: string;
  chat_mode?: string;
  chat_type?: string;
  description?: string;
  external?: boolean;
  name: string;
  owner_id?: string;
  owner_id_type?: string;
  tenant_key?: string;
}

export interface FeishuReactionResponse {
  action_time: string;
  operator: {
    operator_id: string;
    operator_type: string;
  };
  reaction_id: string;
  reaction_type: {
    emoji_type: string;
  };
}

export interface FeishuReactionListResponse {
  has_more: boolean;
  items: FeishuReactionResponse[];
  page_token?: string;
}

export interface FeishuBotInfo {
  app_name: string;
  open_id: string;
}

export interface FeishuTokenResponse {
  code: number;
  expire: number;
  msg: string;
  tenant_access_token: string;
}

// =============================================================================
// Rich Text (Post) Format Types
// =============================================================================

export interface FeishuPostContent {
  [locale: string]: {
    title?: string;
    content: FeishuPostParagraph[];
  };
}

export type FeishuPostParagraph = FeishuPostElement[];

export type FeishuPostElement =
  | FeishuPostText
  | FeishuPostLink
  | FeishuPostAt
  | FeishuPostImage
  | FeishuPostMedia
  | FeishuPostEmotion
  | FeishuPostCodeBlock
  | FeishuPostHr;

interface FeishuPostText {
  style?: FeishuTextStyle[];
  tag: "text";
  text: string;
}

interface FeishuPostLink {
  href: string;
  style?: FeishuTextStyle[];
  tag: "a";
  text: string;
}

interface FeishuPostAt {
  style?: FeishuTextStyle[];
  tag: "at";
  user_id: string;
  user_name?: string;
}

interface FeishuPostImage {
  image_key: string;
  tag: "img";
}

interface FeishuPostMedia {
  file_key: string;
  image_key?: string;
  tag: "media";
}

interface FeishuPostEmotion {
  emoji_type: string;
  tag: "emotion";
}

interface FeishuPostCodeBlock {
  language?: string;
  tag: "code_block";
  text: string;
}

interface FeishuPostHr {
  tag: "hr";
}

type FeishuTextStyle = "bold" | "italic" | "underline" | "lineThrough";

// =============================================================================
// Interactive Card Types
// =============================================================================

export interface FeishuInteractiveCard {
  config?: {
    wide_screen_mode?: boolean;
  };
  elements: FeishuCardElement[];
  header?: {
    title: { tag: "plain_text"; content: string };
    template?: string;
  };
}

export type FeishuCardElement =
  | FeishuCardMarkdown
  | FeishuCardDiv
  | FeishuCardHr
  | FeishuCardImage
  | FeishuCardAction;

interface FeishuCardMarkdown {
  content: string;
  tag: "markdown";
}

interface FeishuCardDiv {
  fields?: Array<{
    is_short: boolean;
    text: { tag: "plain_text" | "lark_md"; content: string };
  }>;
  tag: "div";
  text?: { tag: "plain_text" | "lark_md"; content: string };
}

interface FeishuCardHr {
  tag: "hr";
}

interface FeishuCardImage {
  alt: { tag: "plain_text"; content: string };
  img_key: string;
  tag: "img";
}

export interface FeishuCardAction {
  actions: FeishuCardButton[];
  tag: "action";
}

export interface FeishuCardButton {
  tag: "button";
  text: { tag: "plain_text"; content: string };
  type?: "default" | "primary" | "danger";
  url?: string;
  value?: Record<string, unknown>;
}
