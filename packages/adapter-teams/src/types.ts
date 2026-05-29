import type { Logger } from "chat";

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

export interface TeamsAdapterConfig {
  /** Override the Teams Bot Framework service URL (e.g. for GCC-High environments). Defaults to TEAMS_API_URL env var. */
  apiUrl?: string;
  /** Microsoft App ID. Defaults to TEAMS_APP_ID env var. */
  appId?: string;
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
  /** Override bot username (optional) */
  userName?: string;
}

/** Teams-specific thread ID data */
export interface TeamsThreadId {
  conversationId: string;
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
