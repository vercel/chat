import type { Logger } from "chat";

export interface InstagramAdapterConfig {
  /** Instagram User access token. Defaults to INSTAGRAM_ACCESS_TOKEN. */
  accessToken?: string;
  /** Instagram professional account ID. Defaults to INSTAGRAM_ACCOUNT_ID. */
  accountId?: string;
  /** Instagram Graph API version. Defaults to v26.0. */
  apiVersion?: string;
  /** Meta app secret used to verify webhook signatures. Defaults to INSTAGRAM_APP_SECRET. */
  appSecret?: string;
  /** Logger instance. Defaults to ConsoleLogger. */
  logger?: Logger;
  /** Override the bot username. */
  userName?: string;
  /** Webhook verification token. Defaults to INSTAGRAM_VERIFY_TOKEN. */
  verifyToken?: string;
}

export interface InstagramPostOptions {
  /**
   * Send outside the standard 24-hour window as a human agent.
   * Meta audits use of this tag and permits it for human support only.
   */
  messageTag?: "HUMAN_AGENT";
}

export interface InstagramThreadId {
  accountId: string;
  recipientId: string;
}

export interface InstagramSender {
  id: string;
}

export interface InstagramRecipient {
  id: string;
}

export interface InstagramAttachmentPayload {
  attachment_id?: string;
  id?: string;
  url?: string;
}

export interface InstagramAttachment {
  payload?: InstagramAttachmentPayload;
  type:
    | "audio"
    | "file"
    | "ig_post"
    | "ig_reel"
    | "image"
    | "reel"
    | "share"
    | "story_mention"
    | "video";
}

export interface InstagramStoryReference {
  id?: string;
  url?: string;
}

export interface InstagramMessagePayload {
  attachments?: InstagramAttachment[];
  is_deleted?: boolean;
  is_echo?: boolean;
  is_unsupported?: boolean;
  mid: string;
  quick_reply?: { payload: string };
  reply_to?: {
    mid?: string;
    story?: InstagramStoryReference;
  };
  text?: string;
}

export interface InstagramPostback {
  mid?: string;
  payload: string;
  title: string;
}

export interface InstagramReaction {
  action: "react" | "unreact";
  emoji?: string;
  mid: string;
  reaction?: string;
}

export interface InstagramMessagingEvent {
  delivery?: { mids?: string[]; watermark: number };
  message?: InstagramMessagePayload;
  postback?: InstagramPostback;
  reaction?: InstagramReaction;
  read?: { watermark: number };
  recipient: InstagramRecipient;
  sender: InstagramSender;
  timestamp: number;
}

export interface InstagramWebhookEntry {
  id: string;
  messaging: InstagramMessagingEvent[];
  time: number;
}

export interface InstagramWebhookPayload {
  entry: InstagramWebhookEntry[];
  object: string;
}

export interface InstagramSendApiResponse {
  message_id: string;
  recipient_id: string;
}

export interface InstagramUserProfile {
  id: string;
  name?: string;
  profile_picture_url?: string;
  username?: string;
}

export interface InstagramButton {
  payload?: string;
  title: string;
  type: "postback" | "web_url";
  url?: string;
}

export interface InstagramQuickReply {
  content_type: "text";
  payload: string;
  title: string;
}

export interface InstagramTemplateElement {
  buttons?: InstagramButton[];
  image_url?: string;
  subtitle?: string;
  title: string;
}

export interface InstagramGenericTemplatePayload {
  elements: InstagramTemplateElement[];
  template_type: "generic";
}

export interface InstagramButtonTemplatePayload {
  buttons: InstagramButton[];
  template_type: "button";
  text: string;
}

export type InstagramTemplatePayload =
  | InstagramGenericTemplatePayload
  | InstagramButtonTemplatePayload;

export type InstagramRawMessage = InstagramMessagingEvent;
