import type { AdapterPostableMessage, FileUpload, Logger } from "chat";

export interface TeamsAuthCertificate {
  /** PEM-encoded certificate private key */
  certificatePrivateKey: string;
  /** Hex-encoded certificate thumbprint (optional when x5c is provided) */
  certificateThumbprint?: string;
  /** Public certificate for subject-name validation (optional) */
  x5c?: string;
}

/** Federated (workload identity) authentication config */
export interface TeamsAuthFederated {
  /** Audience for the federated credential (defaults to api://AzureADTokenExchange) */
  clientAudience?: string;
  /** Client ID for the managed identity assigned to the bot */
  clientId: string;
}

/**
 * Verify a forwarded webhook instead of Microsoft's native JWT.
 * Return a truthy value to accept; throw or return a falsy value to reject.
 */
export type TeamsWebhookVerifier = (
  request: Request,
  body: string
) => unknown | Promise<unknown>;

export interface TeamsAdapterConfig {
  /** Override the Teams Bot Framework service URL (e.g. for GCC-High environments). Defaults to TEAMS_API_URL env var. */
  apiUrl?: string;
  /** Microsoft App ID or resolver, resolved during initialize(). Defaults to TEAMS_APP_ID env var. */
  appId?: string | (() => string | Promise<string>);
  /** Microsoft App Password. Defaults to TEAMS_APP_PASSWORD env var. */
  appPassword?: string;
  /** Microsoft App Tenant ID. Defaults to TEAMS_APP_TENANT_ID env var. */
  appTenantId?: string;
  /** Microsoft App Type */
  appType?: "MultiTenant" | "SingleTenant";
  /** @deprecated Certificate auth is not yet supported by the Teams SDK. Throws at startup. */
  certificate?: TeamsAuthCertificate;
  /** Timeout in ms for the handler to call openModal() after a task/fetch trigger. Defaults to 5000. */
  dialogOpenTimeoutMs?: number;
  /** Federated (workload identity) authentication. Maps to managedIdentityClientId in the Teams SDK. */
  federated?: TeamsAuthFederated;
  /** Logger instance for error reporting. Defaults to ConsoleLogger. */
  logger?: Logger;
  /**
   * Custom token factory for outbound Bot Framework/Graph calls. Maps to the underlying
   * Teams SDK's AppOptions.token. Use this on runtimes that can't reach Azure IMDS (so
   * `federated` managed identity isn't reachable) but still need to mint access tokens
   * through an external mechanism (e.g. a workload-identity federation bridge).
   *
   * Takes precedence over appPassword, federated credentials, and client-secret
   * environment variables, including CLIENT_SECRET.
   */
  token?: (
    scope: string | string[],
    tenantId?: string
  ) => string | Promise<string>;
  /** Override bot username (optional) */
  userName?: string;
  /** Custom verifier used instead of Microsoft JWT verification for inbound webhooks. */
  webhookVerifier?: TeamsWebhookVerifier;
}

/** Teams-specific thread ID data */
export interface TeamsThreadId {
  conversationId: string;
  conversationType?: "channel" | "groupChat" | "personal";
  replyToId?: string;
  serviceUrl: string;
}

/** Teams channel context extracted from activity.channelData */
export interface TeamsChannelContext {
  channelId: string;
  teamId: string;
  /** Discriminator — absent for channel (backwards-compat with existing cache). */
  type?: "channel";
}

/** DM context with the resolved Graph API chat ID */
export interface TeamsDmContext {
  graphChatId: string;
  type: "dm";
}

/**
 * Discriminated union for Graph API resolution context.
 * Group chats are not included — their conversation ID works as-is with Graph.
 */
export type TeamsGraphContext = TeamsChannelContext | TeamsDmContext;

/**
 * An Adaptive Card that Teams renders as is, for card features that Chat SDK
 * cards don't cover.
 */
export interface TeamsPostableAdaptiveCard {
  /**
   * The Adaptive Card: its JSON, or a card built with `@microsoft/teams.cards`
   * or `cardToAdaptiveCard`.
   */
  adaptiveCard: object;
  /** Mark the message as AI-generated. */
  aiGenerated?: boolean;
  /** Activity summary, shown in notifications and in clients that can't render the card. */
  fallbackText?: string;
  /** Show Teams' native thumbs up/down feedback buttons. */
  feedbackButtons?: boolean;
  /** Files to upload. `editMessage` doesn't upload files, as with any other message. */
  files?: FileUpload[];
}

/** A message the Teams adapter can post or edit. */
export type TeamsPostableMessage =
  | AdapterPostableMessage
  | TeamsPostableAdaptiveCard;
