import type { Logger } from "chat";
import type {
  TwilioCredential,
  TwilioFetch,
  TwilioMessageResource,
} from "./api";
import type {
  TwilioWebhookPayload,
  TwilioWebhookUrl,
  TwilioWebhookVerifier,
} from "./webhook";

export interface TwilioThreadId {
  recipient: string;
  sender: string;
}

export interface TwilioAdapterConfig {
  accountSid?: TwilioCredential;
  apiUrl?: string;
  authToken?: TwilioCredential;
  fetch?: TwilioFetch;
  logger?: Logger;
  messagingServiceSid?: string;
  phoneNumber?: string;
  statusCallbackUrl?: string;
  userName?: string;
  webhookUrl?: TwilioWebhookUrl;
  webhookVerifier?: TwilioWebhookVerifier;
}

export type TwilioRawMessage = TwilioMessageResource | TwilioWebhookPayload;
