/**
 * WhatsApp Cloud API adapter types.
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api
 */

/**
 * WhatsApp adapter configuration.
 */
export interface WhatsAppAdapterConfig {
  /** Meta access token (permanent or system user token). */
  accessToken: string;
  /** Optional custom API base URL (defaults to https://graph.facebook.com). */
  apiBaseUrl?: string;
  /** Cloud API version (defaults to v21.0). */
  apiVersion?: string;
  /** Optional app secret for X-Hub-Signature-256 webhook verification. */
  appSecret?: string;
  /** Bot's phone number ID from Meta dashboard. */
  phoneNumberId: string;
  /** Optional user-defined secret for webhook verification handshake. */
  verifyToken?: string;
}

/**
 * WhatsApp thread ID components.
 */
export interface WhatsAppThreadId {
  /** Bot's phone number ID. */
  phoneNumberId: string;
  /** User's phone number (recipient). */
  userPhoneNumber: string;
}

/**
 * WhatsApp webhook payload envelope.
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
 */
export interface WhatsAppWebhookPayload {
  entry?: WhatsAppWebhookEntry[];
  object?: string;
}

/**
 * WhatsApp webhook entry.
 */
export interface WhatsAppWebhookEntry {
  changes?: WhatsAppWebhookChange[];
  id?: string;
}

/**
 * WhatsApp webhook change.
 */
export interface WhatsAppWebhookChange {
  field?: string;
  value?: WhatsAppWebhookValue;
}

/**
 * WhatsApp webhook value (messages field).
 */
export interface WhatsAppWebhookValue {
  contacts?: WhatsAppContact[];
  messages?: WhatsAppIncomingMessage[];
  metadata?: WhatsAppWebhookMetadata;
  statuses?: WhatsAppStatus[];
}

/**
 * WhatsApp webhook metadata.
 */
export interface WhatsAppWebhookMetadata {
  display_phone_number?: string;
  phone_number_id?: string;
}

/**
 * WhatsApp contact information from webhook.
 */
export interface WhatsAppContact {
  profile?: { name?: string };
  wa_id?: string;
}

/**
 * WhatsApp incoming message.
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
 */
export interface WhatsAppIncomingMessage {
  audio?: WhatsAppMedia;
  button?: { payload?: string; text?: string };
  context?: { from?: string; id?: string };
  document?: WhatsAppMedia;
  from?: string;
  id?: string;
  image?: WhatsAppMedia;
  interactive?: WhatsAppInteractiveResponse;
  reaction?: { emoji?: string; message_id?: string };
  sticker?: WhatsAppMedia;
  text?: { body?: string };
  timestamp?: string;
  type?: string;
  video?: WhatsAppMedia;
  voice?: WhatsAppMedia;
}

/**
 * WhatsApp media object.
 */
export interface WhatsAppMedia {
  caption?: string;
  filename?: string;
  id?: string;
  mime_type?: string;
  sha256?: string;
}

/**
 * WhatsApp interactive response (button reply or list reply).
 */
export interface WhatsAppInteractiveResponse {
  button_reply?: { id?: string; title?: string };
  list_reply?: { description?: string; id?: string; title?: string };
  type?: string;
}

/**
 * WhatsApp message status update.
 */
export interface WhatsAppStatus {
  id?: string;
  recipient_id?: string;
  status?: string;
  timestamp?: string;
}

/**
 * WhatsApp Cloud API response envelope.
 */
export interface WhatsAppApiResponse {
  error?: WhatsAppApiError;
  messages?: Array<{ id?: string }>;
}

/**
 * WhatsApp Cloud API error.
 */
export interface WhatsAppApiError {
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
  message?: string;
  type?: string;
}

/**
 * WhatsApp outgoing text message payload.
 */
export interface WhatsAppTextMessage {
  messaging_product: "whatsapp";
  preview_url?: boolean;
  recipient_type: "individual";
  text: { body: string };
  to: string;
  type: "text";
}

/**
 * WhatsApp outgoing reaction message payload.
 */
export interface WhatsAppReactionMessage {
  messaging_product: "whatsapp";
  reaction: { emoji: string; message_id: string };
  recipient_type: "individual";
  to: string;
  type: "reaction";
}

/**
 * WhatsApp interactive message button.
 */
export interface WhatsAppInteractiveButton {
  reply: { id: string; title: string };
  type: "reply";
}

/**
 * WhatsApp interactive list row.
 */
export interface WhatsAppInteractiveListRow {
  description?: string;
  id: string;
  title: string;
}

/**
 * WhatsApp interactive list section.
 */
export interface WhatsAppInteractiveListSection {
  rows: WhatsAppInteractiveListRow[];
  title?: string;
}

/**
 * WhatsApp outgoing interactive message payload (buttons or list).
 */
export interface WhatsAppInteractiveMessage {
  interactive:
    | {
        action: { buttons: WhatsAppInteractiveButton[] };
        body: { text: string };
        header?: { text: string; type: "text" };
        type: "button";
      }
    | {
        action: {
          button: string;
          sections: WhatsAppInteractiveListSection[];
        };
        body: { text: string };
        header?: { text: string; type: "text" };
        type: "list";
      };
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "interactive";
}

export type WhatsAppRawMessage = WhatsAppIncomingMessage;
