import type { Logger } from "chat";
import type { GmailToken } from "./api";
import type { GmailEmail } from "./format";
import type { GmailWebhookOptions } from "./webhook";

export interface GmailAdapterConfig {
  accessToken?: GmailToken;
  clientId?: string;
  clientSecret?: string;
  fetch?: typeof globalThis.fetch;
  labelId?: string;
  logger?: Logger;
  mailbox?: string;
  pubsubAudience?: string;
  pubsubServiceAccountEmail?: string;
  refreshToken?: string;
  replyAll?: boolean;
  subscription?: string;
  topicName?: string;
  webhookVerifier?: GmailWebhookOptions["webhookVerifier"];
}

export type GmailThreadId = { mailbox: string } & (
  | { threadId: string; recipient?: never }
  | { recipient: string; threadId?: never }
);

export type GmailRawMessage = GmailEmail;
