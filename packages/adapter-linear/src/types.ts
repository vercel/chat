/**
 * Type definitions for the Linear adapter.
 *
 * Uses types from @linear/sdk wherever possible.
 * Only defines adapter-specific config, thread IDs, normalized raw-message data,
 * and GraphQL response shapes specific to this adapter.
 */

import type {
  AgentActivity,
  CommentChildWebhookPayload,
  IssueWithDescriptionChildWebhookPayload,
  UserChildWebhookPayload,
} from "@linear/sdk";
import type { AgentSessionEventWebhookPayload } from "@linear/sdk/webhooks";
import type { Logger } from "chat";

// =============================================================================
// Configuration
// =============================================================================

/** Explicit config for single-tenant client credentials auth. */
export interface LinearClientCredentialsConfig {
  /** OAuth application client ID. */
  clientId: string;
  /** OAuth application client secret. */
  clientSecret: string;
  /**
   * OAuth scopes to request when using client credentials auth.
   * Defaults to ["read", "write", "comments:create", "issues:create"].
   */
  scopes?: string[];
}

/** Data stored per Linear workspace installation in multi-tenant mode. */
export interface LinearInstallation {
  accessToken: string;
  botUserId: string;
  expiresAt: number | null;
  organizationId: string;
  refreshToken?: string;
}

/** Options for the OAuth callback exchange. */
export interface LinearOAuthCallbackOptions {
  /** The exact redirect URI used in the authorize request. */
  redirectUri: string;
}

/** Incoming webhook handling mode for the Linear adapter. */
export type LinearAdapterMode = "agent-sessions" | "comments";

/**
 * Base configuration options shared by all auth methods.
 */
interface LinearAdapterBaseConfig {
  /** Logger instance for error reporting. Defaults to ConsoleLogger. */
  logger?: Logger;
  /**
   * Controls which inbound Linear webhook model should trigger message handling.
   * Defaults to "comments". Use "agent-sessions" for app-actor installs.
   */
  mode?: LinearAdapterMode;
  /**
   * Bot display name used for @-mention detection.
   * For API key auth, this is typically the user's display name.
   * For OAuth app auth with actor=app, this is the app name.
   * Defaults to LINEAR_BOT_USERNAME env var or "linear-bot".
   */
  userName?: string;
  /**
   * Webhook signing secret for HMAC-SHA256 verification.
   * Found on the webhook detail page in Linear settings.
   * Defaults to LINEAR_WEBHOOK_SECRET env var.
   */
  webhookSecret?: string;
}

/**
 * Configuration using a personal API key.
 * Simplest setup, suitable for personal bots or testing.
 *
 * @see https://linear.app/docs/api-and-webhooks
 */
export interface LinearAdapterAPIKeyConfig extends LinearAdapterBaseConfig {
  accessToken?: never;
  /** Personal API key from Linear Settings > Security & Access. Defaults to LINEAR_API_KEY env var. */
  apiKey: string;
  clientCredentials?: never;
  clientId?: never;
  clientSecret?: never;
}

/**
 * Configuration using an OAuth access token (pre-obtained).
 * Use this if you've already obtained an access token through the OAuth flow.
 *
 * @see https://linear.app/developers/oauth-2-0-authentication
 */
export interface LinearAdapterOAuthConfig extends LinearAdapterBaseConfig {
  /** OAuth access token obtained through the OAuth flow. Defaults to LINEAR_ACCESS_TOKEN env var. */
  accessToken: string;
  apiKey?: never;
  clientCredentials?: never;
  clientId?: never;
  clientSecret?: never;
}

/**
 * Configuration using top-level OAuth app credentials for multi-tenant installs.
 * Use with handleOAuthCallback() to exchange and persist per-organization installs.
 *
 * @see https://linear.app/developers/oauth-2-0-authentication
 */
export interface LinearAdapterMultiTenantConfig
  extends LinearAdapterBaseConfig {
  accessToken?: never;
  apiKey?: never;
  clientCredentials?: never;
  /** OAuth application client ID. Defaults to LINEAR_CLIENT_ID env var in zero-config mode. */
  clientId: string;
  /** OAuth application client secret. Defaults to LINEAR_CLIENT_SECRET env var in zero-config mode. */
  clientSecret: string;
}

/**
 * Configuration using explicit single-tenant client credentials auth.
 * The adapter handles token management internally - no need to store tokens.
 *
 * @see https://linear.app/developers/oauth-2-0-authentication#client-credentials-tokens
 */
export interface LinearAdapterClientCredentialsConfig
  extends LinearAdapterBaseConfig {
  accessToken?: never;
  apiKey?: never;
  clientCredentials: LinearClientCredentialsConfig;
  clientId?: never;
  clientSecret?: never;
}

/**
 * Configuration with no auth fields - will auto-detect from env vars.
 */
export interface LinearAdapterAutoConfig extends LinearAdapterBaseConfig {
  accessToken?: never;
  apiKey?: never;
  clientCredentials?: never;
  clientId?: never;
  clientSecret?: never;
}

/**
 * Linear adapter configuration - API Key, OAuth token, multi-tenant OAuth app, or explicit client credentials.
 */
export type LinearAdapterConfig =
  | LinearAdapterAPIKeyConfig
  | LinearAdapterOAuthConfig
  | LinearAdapterMultiTenantConfig
  | LinearAdapterClientCredentialsConfig
  | LinearAdapterAutoConfig;

// =============================================================================
// Thread ID
// =============================================================================

/**
 * Decoded thread ID for Linear.
 *
 * Thread types:
 * - Issue-level: Top-level comments on the issue (no commentId)
 * - Comment thread: Replies nested under a specific root comment (has commentId)
 */
export interface LinearThreadId {
  /** Agent session UUID for app-actor interactions. */
  agentSessionId?: string;
  /**
   * Root comment ID for comment-level threads.
   * If present, this is a comment thread (replies nest under this comment).
   * If absent, this is an issue-level thread (top-level comment).
   */
  commentId?: string;
  /** Linear issue UUID */
  issueId: string;
}

// =============================================================================
// Normalized Webhook Data
// =============================================================================

/**
 * Comment data from a webhook payload.
 *
 * Normalized for adapter use. SDK webhook payloads still expose these fields
 * as optional because not every comment is attached to an issue.
 */
export interface LinearCommentData {
  /** Comment body in markdown format */
  body: string;
  /** ISO 8601 creation date */
  createdAt: string;
  /** Comment UUID */
  id: string;
  /** Issue UUID the comment is associated with */
  issueId: string;
  /** Parent comment UUID (for nested/threaded replies) */
  parentId?: string;
  /** ISO 8601 last update date */
  updatedAt: string;
  /** Direct URL to the comment */
  url?: string;
  /** User UUID who wrote the comment */
  userId: string;
}

/** Minimal issue data attached to agent session payloads. */
export type LinearAgentSessionIssueData = Pick<
  IssueWithDescriptionChildWebhookPayload,
  "id" | "identifier" | "title" | "url"
>;

/** Minimal comment snapshot attached to agent session payloads. */
export interface LinearAgentSessionCommentData {
  body?: CommentChildWebhookPayload["body"];
  createdAt?: string;
  id: CommentChildWebhookPayload["id"];
  issueId?: string;
  parentId?: string;
  projectUpdateId?: string;
  updatedAt?: string;
  url?: string;
  userId?: CommentChildWebhookPayload["userId"];
}

/** Minimal creator snapshot attached to agent session payloads. */
export type LinearAgentSessionCreatorData = Pick<
  UserChildWebhookPayload,
  "avatarUrl" | "email" | "id" | "name" | "url"
>;

/** Additional source metadata attached to agent sessions. */
export interface LinearAgentSessionSourceMetadata {
  agentSessionMetadata?: {
    sourceCommentId?: string | null;
  };
  type?: string;
  [key: string]: unknown;
}

/** Agent session data from Linear webhooks and GraphQL queries. */
export interface LinearAgentSessionData {
  comment?: LinearAgentSessionCommentData;
  commentId?: string;
  creator?: LinearAgentSessionCreatorData;
  id: string;
  issue?: LinearAgentSessionIssueData;
  issueId?: string;
  sourceCommentId?: string | null;
  sourceMetadata?: LinearAgentSessionSourceMetadata;
  status?: string;
  summary?: string;
}

/** Agent activity snapshot used in adapter-built raw activity messages. */
export type LinearRawAgentActivityData = Pick<
  AgentActivity,
  "content" | "createdAt" | "id" | "updatedAt"
> & {
  body?: string;
};

// =============================================================================
// Raw Message Type
// =============================================================================

interface LinearRawMessageBase {
  /** Raw message kind. */
  kind: "agent_activity" | "agent_session_event" | "comment";
  /** Organization ID from the webhook or request context. */
  organizationId: string;
}

/** Agent-session snapshot guaranteed by adapter-built raw activity messages. */
export type LinearRawAgentSessionData = LinearAgentSessionData & {
  issueId: string;
};

/** Platform-specific raw message for a standard Linear comment. */
export interface LinearCommentRawMessage extends LinearRawMessageBase {
  /** Raw comment data from webhook or API. */
  comment: LinearCommentData;
  kind: "comment";
}

/** Platform-specific raw message for an agent activity fetched from Linear. */
export interface LinearAgentActivityRawMessage extends LinearRawMessageBase {
  /** Agent activity payload. */
  agentActivity: LinearRawAgentActivityData;
  /** Agent session payload. */
  agentSession: LinearRawAgentSessionData;
  kind: "agent_activity";
}

/** Platform-specific raw message for an agent session webhook event. */
export interface LinearAgentSessionEventRawMessage
  extends LinearRawMessageBase {
  kind: "agent_session_event";
  /** Raw agent-session webhook payload from the SDK. */
  payload: AgentSessionEventWebhookPayload;
}

/**
 * Platform-specific raw message type for Linear.
 */
export type LinearRawMessage =
  | LinearAgentActivityRawMessage
  | LinearAgentSessionEventRawMessage
  | LinearCommentRawMessage;
