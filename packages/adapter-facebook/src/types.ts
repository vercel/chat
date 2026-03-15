export interface FacebookAdapterConfig {
  apiVersion?: string;
  appSecret: string;
  pageAccessToken: string;
  verifyToken: string;
}

export interface FacebookThreadId {
  recipientId: string;
}

export interface FacebookSender {
  id: string;
}

export interface FacebookRecipient {
  id: string;
}

export interface FacebookAttachmentPayload {
  sticker_id?: number;
  url?: string;
}

export interface FacebookAttachment {
  payload?: FacebookAttachmentPayload;
  type: "image" | "video" | "audio" | "file" | "fallback" | "location";
}

export interface FacebookQuickReply {
  payload: string;
}

export interface FacebookMessagePayload {
  attachments?: FacebookAttachment[];
  is_echo?: boolean;
  mid: string;
  quick_reply?: FacebookQuickReply;
  text?: string;
}

export interface FacebookDelivery {
  mids?: string[];
  watermark: number;
}

export interface FacebookRead {
  watermark: number;
}

export interface FacebookPostback {
  mid?: string;
  payload: string;
  title: string;
}

export interface FacebookReaction {
  action: "react" | "unreact";
  emoji: string;
  mid: string;
  reaction: string;
}

export interface FacebookMessagingEvent {
  delivery?: FacebookDelivery;
  message?: FacebookMessagePayload;
  postback?: FacebookPostback;
  reaction?: FacebookReaction;
  read?: FacebookRead;
  recipient: FacebookRecipient;
  sender: FacebookSender;
  timestamp: number;
}

export interface FacebookWebhookEntry {
  id: string;
  messaging: FacebookMessagingEvent[];
  time: number;
}

export interface FacebookWebhookPayload {
  entry: FacebookWebhookEntry[];
  object: string;
}

export interface FacebookSendApiResponse {
  message_id: string;
  recipient_id: string;
}

export interface FacebookUserProfile {
  first_name?: string;
  id: string;
  last_name?: string;
  profile_pic?: string;
}

export type FacebookRawMessage = FacebookMessagingEvent;
