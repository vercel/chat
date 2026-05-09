import type { Logger } from "chat";

export interface MessengerAdapterConfig {
  /** Messenger Graph API version. Defaults to a recent stable version. */
  apiVersion?: string;
  /** Facebook app secret for webhook signature verification. Defaults to FACEBOOK_APP_SECRET env var. */
  appSecret?: string;
  /** Logger instance for error reporting. Defaults to ConsoleLogger. */
  logger?: Logger;
  /** Facebook page access token. Defaults to FACEBOOK_PAGE_ACCESS_TOKEN env var. */
  pageAccessToken?: string;
  /** Override bot username (optional) */
  userName?: string;
  /** Token used to verify webhook subscription. Defaults to FACEBOOK_VERIFY_TOKEN env var. */
  verifyToken?: string;
}

export interface MessengerThreadId {
  recipientId: string;
}

export interface MessengerSender {
  id: string;
}

export interface MessengerRecipient {
  id: string;
}

export interface MessengerAttachmentPayload {
  sticker_id?: number;
  url?: string;
}

export interface MessengerAttachment {
  payload?: MessengerAttachmentPayload;
  type: "image" | "video" | "audio" | "file" | "fallback" | "location";
}

export interface MessengerQuickReply {
  payload: string;
}

export interface MessengerMessagePayload {
  attachments?: MessengerAttachment[];
  is_echo?: boolean;
  mid: string;
  quick_reply?: MessengerQuickReply;
  text?: string;
}

export interface MessengerDelivery {
  mids?: string[];
  watermark: number;
}

export interface MessengerRead {
  watermark: number;
}

export interface MessengerPostback {
  mid?: string;
  payload: string;
  title: string;
}

export interface MessengerReaction {
  action: "react" | "unreact";
  emoji: string;
  mid: string;
  reaction: string;
}

export interface MessengerMessagingEvent {
  delivery?: MessengerDelivery;
  message?: MessengerMessagePayload;
  postback?: MessengerPostback;
  reaction?: MessengerReaction;
  read?: MessengerRead;
  recipient: MessengerRecipient;
  sender: MessengerSender;
  timestamp: number;
}

export interface MessengerWebhookEntry {
  id: string;
  messaging: MessengerMessagingEvent[];
  time: number;
}

export interface MessengerWebhookPayload {
  entry: MessengerWebhookEntry[];
  object: string;
}

export interface MessengerSendApiResponse {
  message_id: string;
  recipient_id: string;
}

export interface MessengerUserProfile {
  first_name?: string;
  id: string;
  last_name?: string;
  profile_pic?: string;
}

export type MessengerRawMessage = MessengerMessagingEvent;

export interface MessengerButton {
  payload?: string;
  title: string;
  type: "postback" | "web_url";
  url?: string;
}

export interface MessengerTemplateElement {
  buttons?: MessengerButton[];
  image_url?: string;
  subtitle?: string;
  title: string;
}

export interface MessengerGenericTemplatePayload {
  elements: MessengerTemplateElement[];
  template_type: "generic";
}

export interface MessengerButtonTemplatePayload {
  buttons: MessengerButton[];
  template_type: "button";
  text: string;
}

export type MessengerTemplatePayload =
  | MessengerGenericTemplatePayload
  | MessengerButtonTemplatePayload;
