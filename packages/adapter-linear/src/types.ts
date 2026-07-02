/**
 * Type definitions for the Linear adapter.
 *
 * Uses types from @linear/sdk wherever possible.
 * Only defines adapter-specific config, thread IDs, normalized raw-message data,
 * and GraphQL response shapes specific to this adapter.
 */

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
 * Custom webhook verifier used in place of the Linear webhook secret.
 *
 * Receives the incoming request and its raw body. Return a truthy value
 * to accept the request (returning a string substitutes the verified
 * body used for downstream parsing); throw or return a falsy value to
 * reject it (the adapter responds `401`). Used for verifying Vercel
 * Connect trigger-forwarded webhooks via the Vercel OIDC token Connect
 * attaches.
 */
export type LinearWebhookVerifier = (
  request: Request,
  body: string
) => Promise<unknown> | unknown;

/**
 * Base configuration options shared by all auth methods.
 */
interface LinearAdapterBaseConfig {
  /** Override the Linear API base URL. Defaults to LINEAR_API_URL env var. */
  apiUrl?: string;
  /**
   * Optional 32-byte AES-256-GCM key used to encrypt OAuth `accessToken` and
   * `refreshToken` values at rest in the state store. Accepts either a 64-char
   * hex string or a 44-char base64 string. Defaults to the
   * `LINEAR_ENCRYPTION_KEY` env var. Strongly recommended for multi-tenant
   * deployments — without it, a state-store compromise yields plaintext per-
   * tenant Linear API tokens.
   */
  encryptionKey?: string;
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
  /**
   * Custom webhook verifier used in place of `webhookSecret`. When set, it
   * takes precedence over `webhookSecret` and the `LINEAR_WEBHOOK_SECRET`
   * env var. Useful when webhooks arrive via Vercel Connect trigger
   * forwarding (verified with a Vercel OIDC token rather than Linear's
   * webhook secret).
   */
  webhookVerifier?: LinearWebhookVerifier;
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
 * Configuration backed by Vercel Connect.
 *
 * Supplies the Linear access token directly (as a string or a resolver
 * invoked per API call) and verifies inbound webhooks with a custom
 * `webhookVerifier` instead of a webhook secret. Pair with
 * `connectLinearAdapter()` from `@vercel/connect/chat`.
 *
 * @see https://vercel.com/docs/connect
 */
export interface LinearAdapterConnectConfig extends LinearAdapterBaseConfig {
  /**
   * Linear access token, or a resolver invoked per API call. The function
   * form composes with Vercel Connect's short-lived tokens (`getToken`).
   */
  accessToken: string | (() => string | Promise<string>);
  apiKey?: never;
  clientCredentials?: never;
  clientId?: never;
  clientSecret?: never;
  /**
   * Required. Connect-forwarded webhooks are verified with a Vercel OIDC
   * token rather than Linear's webhook secret.
   */
  webhookVerifier: LinearWebhookVerifier;
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
 * Linear adapter configuration - API Key, OAuth token, multi-tenant OAuth app,
 * explicit client credentials, or Vercel Connect.
 */
export type LinearAdapterConfig =
  | LinearAdapterAPIKeyConfig
  | LinearAdapterOAuthConfig
  | LinearAdapterMultiTenantConfig
  | LinearAdapterClientCredentialsConfig
  | LinearAdapterConnectConfig
  | LinearAdapterAutoConfig;

// =============================================================================
// Auth
// =============================================================================

export interface LinearOAuthTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
}

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

/**
 * Decoded thread ID for Linear threads associated with agent sessions.
 */
export type LinearAgentSessionThreadId = LinearThreadId & {
  agentSessionId: string;
};

// =============================================================================
// Raw Message Type
// =============================================================================

/**
 * Data associated with a Linear actor.
 */
export interface LinearActorData {
  /** URL to the actor's avatar image */
  avatarUrl: string | undefined;
  /** Actor's display name */
  displayName: string;
  /** Actor's email address */
  email: string | undefined;
  /** Actor's full name */
  fullName: string;
  /** Actor UUID */
  id: string;
  type: "user" | "bot";
}

/**
 * Comment data stored in a LinearRawMessage, normalized from webhook payloads and API responses.
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
  parentId: string | undefined;
  /** ISO 8601 last update date */
  updatedAt: string;
  /** Direct URL to the comment */
  url: string | undefined;
  /** User who wrote the comment */
  user: LinearActorData;
}

interface LinearRawMessageBase {
  /** Raw message kind. */
  kind: "agent_session_comment" | "comment";
  /** Organization ID from the webhook or request context. */
  organizationId: string;
}

/** Platform-specific raw message for a standard Linear comment. */
export interface LinearCommentRawMessage extends LinearRawMessageBase {
  /** Raw comment data from webhook or API. */
  comment: LinearCommentData;
  kind: "comment";
}

/** Platform-specific raw message for a comment backed by an agent session. */
export interface LinearAgentSessionCommentRawMessage
  extends LinearRawMessageBase {
  /** The agent session the comment belongs to. */
  agentSessionId: string;
  /** The prompt context associated with this agent session comment. */
  agentSessionPromptContext?: string;
  /** The visible Linear comment backing this message. */
  comment: LinearCommentData;
  kind: "agent_session_comment";
}

/**
 * Platform-specific raw message type for Linear.
 */
export type LinearRawMessage =
  | LinearAgentSessionCommentRawMessage
  | LinearCommentRawMessage;
