import type { TwilioCredential } from "../api";

export type TwilioHeaderValue = readonly string[] | string | null | undefined;

export type TwilioHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, TwilioHeaderValue>;

export type TwilioWebhookUrl =
  | string
  | ((request: Request) => Promise<string> | string);

export type TwilioWebhookVerifier = (
  request: Request,
  body: string
) => Promise<boolean | string> | boolean | string;

export interface TwilioVerifyOptions {
  authToken?: TwilioCredential;
  webhookUrl?: TwilioWebhookUrl;
  webhookVerifier?: TwilioWebhookVerifier;
}

export interface TwilioReadOptions extends TwilioVerifyOptions {}

export interface TwilioVerifiedRequest {
  body: string;
  params: URLSearchParams;
}

export interface TwilioTextPayload {
  accountSid?: string;
  address?: string;
  body: string;
  channelMetadata?: import("../channel").TwilioChannelMetadata;
  from: string;
  label?: string;
  latitude?: string;
  longitude?: string;
  media: TwilioMediaPayload[];
  messageSid?: string;
  raw: URLSearchParams;
  to: string;
}

export interface TwilioActionPayload {
  accountSid?: string;
  buttonPayload: string;
  buttonText?: string;
  channelMetadata?: import("../channel").TwilioChannelMetadata;
  from: string;
  messageSid?: string;
  raw: URLSearchParams;
  to: string;
}

export interface TwilioStatusPayload {
  accountSid?: string;
  channelPrefix?: string;
  eventType?: string;
  from?: string;
  messageSid?: string;
  messageStatus: string;
  raw: URLSearchParams;
  to?: string;
}

export interface TwilioUnsupportedPayload {
  kind: "unsupported";
  raw: URLSearchParams;
}

export interface TwilioMediaPayload {
  contentType?: string;
  url: string;
}

export type TwilioWebhookPayload =
  | ({ kind: "action" } & TwilioActionPayload)
  | ({ kind: "status" } & TwilioStatusPayload)
  | ({ kind: "text" } & TwilioTextPayload)
  | TwilioUnsupportedPayload;

export class TwilioWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwilioWebhookError";
  }
}

export class TwilioWebhookParseError extends TwilioWebhookError {
  constructor(message: string) {
    super(message);
    this.name = "TwilioWebhookParseError";
  }
}

export class TwilioWebhookVerificationError extends TwilioWebhookError {
  constructor(message: string) {
    super(message);
    this.name = "TwilioWebhookVerificationError";
  }
}
