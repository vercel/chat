/**
 * Type definitions for the WhatsApp adapter.
 *
 * Based on the WhatsApp Business Cloud API (Meta Graph API).
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api
 */

import type { Logger } from "chat";

// =============================================================================
// Configuration
// =============================================================================

/**
 * WhatsApp adapter configuration.
 *
 * Requires a System User access token for API calls and an App Secret
 * for webhook signature verification.
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/get-started
 */
export interface WhatsAppAdapterConfig {
  /** Access token (System User token) for WhatsApp Cloud API calls. Defaults to WHATSAPP_ACCESS_TOKEN env var. */
  accessToken?: string;
  /** Override the Meta Graph API base URL (e.g. for on-premise deployments). Defaults to "https://graph.facebook.com". */
  apiUrl?: string;
  /** Meta Graph API version (default: "v25.0") */
  apiVersion?: string;
  /** Meta App Secret for webhook HMAC-SHA256 signature verification. Defaults to WHATSAPP_APP_SECRET env var. */
  appSecret?: string;
  /** Logger instance for error reporting */
  logger?: Logger;
  /** WhatsApp Business phone number ID (not the phone number itself). Defaults to WHATSAPP_PHONE_NUMBER_ID env var. */
  phoneNumberId?: string;
  /** Bot display name used for identification */
  userName?: string;
  /** Verify token for webhook challenge-response verification. Defaults to WHATSAPP_VERIFY_TOKEN env var. */
  verifyToken?: string;
}

// =============================================================================
// Thread ID
// =============================================================================

/**
 * Decoded thread ID for WhatsApp.
 *
 * WhatsApp conversations are always 1:1 between a business phone number
 * and a user. There is no concept of threads or channels.
 *
 * Format: whatsapp:{phoneNumberId}:{userWaId}
 */
export interface WhatsAppThreadId {
  /** Business phone number ID */
  phoneNumberId: string;
  /** User's WhatsApp ID (their phone number) */
  userWaId: string;
}

// =============================================================================
// Webhook Payloads
// =============================================================================

/**
 * Top-level webhook notification envelope from Meta.
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
 */
export interface WhatsAppWebhookPayload {
  entry: WhatsAppWebhookEntry[];
  object: "whatsapp_business_account";
}

/**
 * A single entry in the webhook notification.
 */
export interface WhatsAppWebhookEntry {
  changes: WhatsAppWebhookChange[];
  id: string;
}

/**
 * A change object containing the actual event data.
 */
export interface WhatsAppWebhookChange {
  field: "messages";
  value: WhatsAppWebhookValue;
}

/**
 * The value payload containing messages, contacts, and statuses.
 */
export interface WhatsAppWebhookValue {
  contacts?: WhatsAppContact[];
  messages?: WhatsAppInboundMessage[];
  messaging_product: "whatsapp";
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  statuses?: WhatsAppStatus[];
}

/**
 * Contact information from an inbound message.
 */
export interface WhatsAppContact {
  profile: { name: string };
  wa_id: string;
}

/**
 * Inbound message from a user.
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
 */
export interface WhatsAppInboundMessage {
  /** Audio message content */
  audio?: {
    id: string;
    mime_type: string;
    sha256: string;
    voice?: boolean;
  };
  /** Legacy button response (from template quick replies) */
  button?: {
    payload: string;
    text: string;
  };
  /** Context for quoted replies */
  context?: {
    from: string;
    id: string;
  };
  /** Document message content */
  document?: {
    caption?: string;
    filename?: string;
    id: string;
    mime_type: string;
    sha256: string;
  };
  /** Sender's WhatsApp ID */
  from: string;
  /** Unique message ID */
  id: string;
  /** Image message content */
  image?: {
    caption?: string;
    id: string;
    mime_type: string;
    sha256: string;
  };
  /** Interactive message reply */
  interactive?: {
    button_reply?: {
      id: string;
      title: string;
    };
    list_reply?: {
      description?: string;
      id: string;
      title: string;
    };
    type: "button_reply" | "list_reply";
  };
  /** Location message content */
  location?: {
    address?: string;
    latitude: number;
    longitude: number;
    name?: string;
    url?: string;
  };
  /** Reaction to a message */
  reaction?: {
    emoji: string;
    message_id: string;
  };
  /** Sticker message content */
  sticker?: {
    animated: boolean;
    id: string;
    mime_type: string;
    sha256: string;
  };
  /** Text message content */
  text?: {
    body: string;
  };
  /** Unix timestamp string */
  timestamp: string;
  /** Message type */
  type:
    | "text"
    | "image"
    | "document"
    | "audio"
    | "video"
    | "voice"
    | "sticker"
    | "location"
    | "contacts"
    | "interactive"
    | "button"
    | "reaction"
    | "order"
    | "system"
    | "template";
  /** Video message content */
  video?: {
    caption?: string;
    id: string;
    mime_type: string;
    sha256: string;
  };
  /** Voice message content */
  voice?: {
    id: string;
    mime_type: string;
    sha256: string;
  };
}

/**
 * Response from the media URL endpoint.
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media#get-media-url
 */
export interface WhatsAppMediaResponse {
  file_size: number;
  id: string;
  messaging_product: "whatsapp";
  mime_type: string;
  sha256: string;
  url: string;
}

/**
 * Response from uploading media via the Cloud API.
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media#upload-media
 */
export interface WhatsAppMediaUploadResponse {
  id: string;
}

/**
 * Message delivery/read status update.
 */
export interface WhatsAppStatus {
  conversation?: {
    expiration_timestamp?: string;
    id: string;
    origin: { type: string };
  };
  id: string;
  pricing?: {
    billable: boolean;
    category: string;
    pricing_model: string;
  };
  recipient_id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
}

// =============================================================================
// API Response Types
// =============================================================================

/**
 * Response from sending a message via the Cloud API.
 */
export interface WhatsAppSendResponse {
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
  messaging_product: "whatsapp";
}

/**
 * Response from sending a typing indicator via the Cloud API.
 */
export interface WhatsAppTypingIndicatorResponse {
  success: boolean;
}

/**
 * Interactive message payload for sending buttons or lists.
 */
export interface WhatsAppInteractiveMessage {
  action:
    | {
        button?: never;
        buttons: Array<{
          reply: {
            id: string;
            title: string;
          };
          type: "reply";
        }>;
        sections?: never;
      }
    | {
        button: string;
        buttons?: never;
        sections: Array<{
          rows: Array<{
            description?: string;
            id: string;
            title: string;
          }>;
          title: string;
        }>;
      };
  body: { text: string };
  footer?: { text: string };
  header?: { text: string; type: "text" };
  type: "button" | "list";
}

// =============================================================================
// Template Messages
// =============================================================================

/**
 * Parameter for a template header or body component.
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages#parameter-object
 */
export type WhatsAppTemplateParameter =
  | { text: string; type: "text" }
  | {
      currency: {
        amount_1000: number;
        code: string;
        fallback_value: string;
      };
      type: "currency";
    }
  | {
      date_time: { fallback_value: string };
      type: "date_time";
    }
  | { image: { id?: string; link?: string }; type: "image" }
  | {
      document: { filename?: string; id?: string; link?: string };
      type: "document";
    }
  | { type: "video"; video: { id?: string; link?: string } };

/**
 * Parameter for a template button component.
 *
 * URL buttons take a text parameter substituted into the button's URL;
 * quick reply buttons take a payload echoed back in the button response.
 */
export type WhatsAppTemplateButtonParameter =
  | { text: string; type: "text" }
  | { payload: string; type: "payload" };

/**
 * A component of a template message carrying variable substitutions.
 */
export type WhatsAppTemplateComponent =
  | { parameters: WhatsAppTemplateParameter[]; type: "header" }
  | { parameters: WhatsAppTemplateParameter[]; type: "body" }
  | {
      index: number;
      parameters: WhatsAppTemplateButtonParameter[];
      sub_type: "url" | "quick_reply";
      type: "button";
    };

/**
 * A pre-approved template message.
 *
 * Templates are the only message type the Cloud API accepts outside the
 * 24-hour customer service window, so they are required for
 * business-initiated conversations.
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates
 */
export interface WhatsAppTemplateMessage {
  /** Variable substitutions for the template's components. Omit for templates without variables. */
  components?: WhatsAppTemplateComponent[];
  /** Template language code (e.g. "en", "en_US") */
  language: string;
  /** Name of the approved template */
  name: string;
}

// =============================================================================
// Raw Message Type
// =============================================================================

/**
 * Platform-specific raw message type for WhatsApp.
 */
export interface WhatsAppRawMessage {
  /** Contact info from the webhook */
  contact?: WhatsAppContact;
  /** The raw inbound message data */
  message: WhatsAppInboundMessage;
  /** Phone number ID that received the message */
  phoneNumberId: string;
}
