import type { Logger } from "chat";

/** Configuration for createZoomAdapter factory. All fields fall back to env vars. */
export interface ZoomAdapterConfig {
  accountId?: string;
  clientId?: string;
  clientSecret?: string;
  logger?: Logger;
  robotJid?: string;
  webhookSecretToken?: string;
}

/** Internal config with all required fields resolved. */
export interface ZoomAdapterInternalConfig {
  accountId: string;
  clientId: string;
  clientSecret: string;
  logger: Logger;
  robotJid: string;
  webhookSecretToken: string;
}

/** Zoom CRC URL validation challenge payload shape. */
export interface ZoomCrcPayload {
  event: "endpoint.url_validation";
  payload: {
    plainToken: string;
  };
}

/** Top-level Zoom webhook payload (discriminated union on `event`). */
export type ZoomWebhookPayload =
  | ZoomCrcPayload
  | {
      event: string;
      payload: Record<string, unknown>;
      event_ts?: number;
    };
