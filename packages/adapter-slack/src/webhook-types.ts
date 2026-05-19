export type SlackHeaderValue = readonly string[] | string | null | undefined;

export type SlackHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, SlackHeaderValue>;

export type SlackWebhookVerifier = (
  request: Request,
  body: string
) => Promise<unknown> | unknown;

export interface SlackVerifyOptions {
  maxSkewSeconds?: number;
  now?: () => number;
  signingSecret?: string;
  webhookVerifier?: SlackWebhookVerifier;
}

export interface SlackParseOptions {
  contentType?: string | null;
  headers?: SlackHeaders;
}

export interface SlackReadOptions
  extends SlackParseOptions,
    SlackVerifyOptions {}

export interface SlackRetry {
  num: number;
  reason?: string;
}

export interface SlackContinuation {
  channelId: string;
  enterpriseId?: string;
  teamId?: string;
  threadTs: string;
}

export type SlackWebhookPayload =
  | SlackAppMentionPayload
  | SlackBlockActionsPayload
  | SlackBlockSuggestionPayload
  | SlackDirectMessagePayload
  | SlackSlashCommandPayload
  | SlackUnsupportedPayload
  | SlackUrlVerificationPayload
  | SlackViewClosedPayload
  | SlackViewSubmissionPayload;

export interface SlackUrlVerificationPayload {
  challenge: string;
  kind: "url_verification";
  raw: Record<string, unknown>;
  retry?: SlackRetry;
}

export interface SlackEventBasePayload {
  apiAppId?: string;
  channelId: string;
  continuation: SlackContinuation;
  enterpriseId?: string;
  eventId?: string;
  eventTime?: number;
  isExtSharedChannel?: boolean;
  raw: Record<string, unknown>;
  retry?: SlackRetry;
  teamId?: string;
  text: string;
  threadTs: string;
  ts: string;
  userId?: string;
}

export interface SlackAppMentionPayload extends SlackEventBasePayload {
  eventType: "app_mention";
  kind: "app_mention";
}

export interface SlackDirectMessagePayload extends SlackEventBasePayload {
  botId?: string;
  eventType: "message";
  kind: "direct_message";
  subtype?: string;
}

export interface SlackSlashCommandPayload {
  channelId: string;
  channelName?: string;
  command: string;
  enterpriseId?: string;
  isEnterpriseInstall: boolean;
  kind: "slash_command";
  raw: Record<string, string>;
  responseUrl?: string;
  retry?: SlackRetry;
  teamId?: string;
  text: string;
  triggerId?: string;
  userId: string;
  userName?: string;
}

export interface SlackAction {
  actionId: string;
  blockId?: string;
  label?: string;
  raw: Record<string, unknown>;
  selectedOptionValue?: string;
  type: string;
  value?: string;
}

export interface SlackBlockActionsPayload {
  actions: SlackAction[];
  channelId?: string;
  continuation?: SlackContinuation;
  enterpriseId?: string;
  isEnterpriseInstall?: boolean;
  kind: "block_actions";
  messageTs?: string;
  raw: Record<string, unknown>;
  responseUrl?: string;
  retry?: SlackRetry;
  teamId?: string;
  threadTs?: string;
  triggerId?: string;
  userId: string;
  userName?: string;
}

export interface SlackBlockSuggestionPayload {
  actionId: string;
  blockId: string;
  channelId?: string;
  enterpriseId?: string;
  kind: "block_suggestion";
  raw: Record<string, unknown>;
  retry?: SlackRetry;
  teamId?: string;
  userId: string;
  value: string;
}

export interface SlackViewSubmissionPayload {
  enterpriseId?: string;
  kind: "view_submission";
  raw: Record<string, unknown>;
  responseUrls?: unknown[];
  retry?: SlackRetry;
  teamId?: string;
  userId: string;
  view: Record<string, unknown>;
}

export interface SlackViewClosedPayload {
  enterpriseId?: string;
  kind: "view_closed";
  raw: Record<string, unknown>;
  retry?: SlackRetry;
  teamId?: string;
  userId: string;
  view: Record<string, unknown>;
}

export interface SlackUnsupportedPayload {
  kind: "unsupported";
  raw: unknown;
  retry?: SlackRetry;
  type: string;
}

export class SlackWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlackWebhookError";
  }
}

export class SlackWebhookVerificationError extends SlackWebhookError {
  constructor(message: string) {
    super(message);
    this.name = "SlackWebhookVerificationError";
  }
}

export class SlackWebhookParseError extends SlackWebhookError {
  constructor(message: string) {
    super(message);
    this.name = "SlackWebhookParseError";
  }
}
