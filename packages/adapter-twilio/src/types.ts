import type { Logger } from "chat";

export interface TwilioThreadId {
  recipientNumber: string;
  twilioNumber: string;
}

export interface TwilioAdapterConfig {
  accountSid?: string;
  authToken?: string;
  logger?: Logger;
  phoneNumber?: string;
  userName?: string;
  webhookUrl?: string;
}

export interface TwilioWebhookPayload {
  AccountSid: string;
  ApiVersion?: string;
  Body: string;
  From: string;
  FromCity?: string;
  FromCountry?: string;
  FromState?: string;
  FromZip?: string;
  MessageSid: string;
  MessageStatus?: string;
  NumMedia: string;
  NumSegments?: string;
  SmsStatus?: string;
  To: string;
  ToCity?: string;
  ToCountry?: string;
  ToState?: string;
  ToZip?: string;
  [key: string]: string | undefined;
}

export type TwilioRawMessage = TwilioWebhookPayload;
