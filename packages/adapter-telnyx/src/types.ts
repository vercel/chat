import type { Logger } from "chat";

export interface TelnyxAdapterConfig {
  /** Telnyx API key. Defaults to TELNYX_API_KEY env var. */
  apiKey?: string;
  /** Logger instance. Defaults to ConsoleLogger. */
  logger?: Logger;
  /** Telnyx messaging profile ID (optional, for advanced routing). */
  messagingProfileId?: string;
  /** Telnyx phone number to send from. Defaults to TELNYX_FROM_NUMBER env var. */
  phoneNumber?: string;
  /** Telnyx webhook public key for Ed25519 signature verification. Defaults to TELNYX_PUBLIC_KEY env var. */
  publicKey?: string;
  /** Override bot username. Defaults to BOT_USERNAME env var. */
  userName?: string;
}

export interface TelnyxThreadId {
  recipientNumber: string;
  telnyxNumber: string;
}

export interface TelnyxWebhookPayload {
  data: {
    event_type: string;
    id: string;
    occurred_at: string;
    payload: TelnyxMessagePayload;
    record_type: string;
  };
  meta: {
    attempt: number;
    delivered_to: string;
  };
}

export interface TelnyxMessagePayload {
  completed_at?: string;
  cost?: { amount: string; currency: string } | null;
  direction: "inbound" | "outbound";
  encoding?: string;
  errors?: unknown[];
  from: TelnyxPhoneNumber;
  id: string;
  media?: TelnyxMedia[];
  messaging_profile_id?: string;
  organization_id?: string;
  parts?: number;
  received_at?: string;
  record_type?: string;
  sent_at?: string;
  tags?: string[];
  text: string;
  to: TelnyxPhoneNumber[];
  type: "SMS" | "MMS";
  valid_until?: string;
  webhook_token?: string;
  webhook_url?: string;
}

export interface TelnyxPhoneNumber {
  carrier?: string;
  line_type?: string;
  phone_number: string;
  status?: string;
}

export interface TelnyxMedia {
  content_type: string;
  hash_sha256?: string;
  size?: number;
  url: string;
}

export type TelnyxRawMessage = TelnyxMessagePayload;
