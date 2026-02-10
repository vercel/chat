/**
 * Type definitions for the Linear adapter.
 *
 * Uses types from @linear/sdk wherever possible.
 * Only defines adapter-specific config, thread IDs, and webhook payloads.
 */

import type { Logger } from "chat";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Base configuration options shared by all auth methods.
 */
interface LinearAdapterBaseConfig {
  /** Logger instance for error reporting */
  logger: Logger;
  /**
   * Webhook signing secret for HMAC-SHA256 verification.
   * Found on the webhook detail page in Linear settings.
   */
  webhookSecret: string;
  /**
   * Bot display name used for @-mention detection.
   * For API key auth, this is typically the user's display name.
   * For OAuth app auth with actor=app, this is the app name.
   */
  userName: string;
}

/**
 * Configuration using a personal API key.
 * Simplest setup, suitable for personal bots or testing.
 *
 * @see https://linear.app/docs/api-and-webhooks
 */
export interface LinearAdapterAPIKeyConfig extends LinearAdapterBaseConfig {
  /** Personal API key from Linear Settings > Security & Access */
  apiKey: string;
  accessToken?: never;
}

/**
 * Configuration using an OAuth access token (pre-obtained).
 * Use this if you've already obtained an access token through the OAuth flow.
 *
 * @see https://linear.app/developers/oauth-2-0-authentication
 */
export interface LinearAdapterOAuthConfig extends LinearAdapterBaseConfig {
  /** OAuth access token obtained through the OAuth flow */
  accessToken: string;
  apiKey?: never;
  clientId?: never;
  clientSecret?: never;
}

/**
 * Configuration using OAuth client credentials (recommended for apps).
 * The adapter handles token management internally - no need to store tokens.
 *
 * Uses the client_credentials grant type to obtain an app-level token.
 * The token is valid for 30 days and auto-refreshes on 401.
 *
 * @see https://linear.app/developers/oauth-2-0-authentication#client-credentials-tokens
 */
export interface LinearAdapterAppConfig extends LinearAdapterBaseConfig {
  /** OAuth application client ID */
  clientId: string;
  /** OAuth application client secret */
  clientSecret: string;
  apiKey?: never;
  accessToken?: never;
}

/**
 * Linear adapter configuration - API Key, OAuth token, or OAuth App (client credentials).
 */
export type LinearAdapterConfig =
  | LinearAdapterAPIKeyConfig
  | LinearAdapterOAuthConfig
  | LinearAdapterAppConfig;

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
  /** Linear issue UUID */
  issueId: string;
  /**
   * Root comment ID for comment-level threads.
   * If present, this is a comment thread (replies nest under this comment).
   * If absent, this is an issue-level thread (top-level comment).
   */
  commentId?: string;
}

// =============================================================================
// Webhook Payloads
// =============================================================================

/**
 * Actor who triggered the webhook event.
 *
 * @see https://linear.app/developers/webhooks#data-change-events-payload
 */
export interface LinearWebhookActor {
  id: string;
  type: "user" | "application" | "integration";
  name: string;
  email?: string;
  url?: string;
}

/**
 * Base fields present on all Linear webhook payloads.
 *
 * @see https://linear.app/developers/webhooks#data-change-events-payload
 */
interface LinearWebhookBase {
  /** Action type: create, update, or remove */
  action: "create" | "update" | "remove";
  /** Entity type that triggered the event */
  type: string;
  /** Actor who triggered the action */
  actor: LinearWebhookActor;
  /** ISO 8601 date when the action took place */
  createdAt: string;
  /** URL of the subject entity */
  url: string;
  /** UNIX timestamp (ms) when the webhook was sent */
  webhookTimestamp: number;
  /** UUID uniquely identifying this webhook */
  webhookId: string;
  /** Organization ID */
  organizationId: string;
  /** For update actions, previous values of changed properties */
  updatedFrom?: Record<string, unknown>;
}

/**
 * Comment data from a webhook payload.
 *
 * Verified against Linear's Webhooks Schema Explorer and
 * example payloads from the official documentation.
 *
 * @see https://linear.app/developers/webhooks#webhook-payload
 */
export interface LinearCommentData {
  /** Comment UUID */
  id: string;
  /** Comment body in markdown format */
  body: string;
  /** Issue UUID the comment is associated with */
  issueId: string;
  /** User UUID who wrote the comment */
  userId: string;
  /** Parent comment UUID (for nested/threaded replies) */
  parentId?: string;
  /** ISO 8601 creation date */
  createdAt: string;
  /** ISO 8601 last update date */
  updatedAt: string;
  /** Direct URL to the comment */
  url?: string;
}

/**
 * Webhook payload for Comment events.
 *
 * @see https://linear.app/developers/webhooks#data-change-events-payload
 */
export interface CommentWebhookPayload extends LinearWebhookBase {
  type: "Comment";
  data: LinearCommentData;
}

/**
 * Reaction data from a webhook payload.
 */
export interface LinearReactionData {
  /** Reaction UUID */
  id: string;
  /** Emoji string */
  emoji: string;
  /** Comment UUID the reaction is on */
  commentId?: string;
  /** User UUID who reacted */
  userId: string;
}

/**
 * Webhook payload for Reaction events.
 */
export interface ReactionWebhookPayload extends LinearWebhookBase {
  type: "Reaction";
  data: LinearReactionData;
}

/**
 * Union of webhook payload types we handle.
 */
export type LinearWebhookPayload =
  | CommentWebhookPayload
  | ReactionWebhookPayload;

// =============================================================================
// Raw Message Type
// =============================================================================

/**
 * Platform-specific raw message type for Linear.
 */
export interface LinearRawMessage {
  /** The raw comment data from webhook or API */
  comment: LinearCommentData;
  /** Organization ID from the webhook */
  organizationId?: string;
}
