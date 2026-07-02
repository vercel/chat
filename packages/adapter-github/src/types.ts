/**
 * Type definitions for the GitHub adapter.
 */

import type { Logger } from "chat";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Custom webhook verifier used in place of the GitHub webhook secret.
 *
 * Receives the incoming request and its raw body. Return a truthy value
 * to accept the request; throw or return a falsy value to reject it
 * (the adapter responds `401`). Used for verifying Vercel Connect
 * trigger-forwarded webhooks via the Vercel OIDC token Connect attaches.
 */
export type GitHubWebhookVerifier = (
  request: Request,
  body: string
) => Promise<unknown> | unknown;

/**
 * Base configuration options shared by all auth methods.
 */
interface GitHubAdapterBaseConfig {
  /** Override the GitHub API base URL (e.g. "https://github.example.com/api/v3" for GitHub Enterprise). Defaults to GITHUB_API_URL env var. */
  apiUrl?: string;
  /**
   * Bot's GitHub user ID (numeric). Used for self-message detection.
   * Defaults to the `GITHUB_BOT_USER_ID` env var. If still unset, the adapter
   * tries to auto-detect it (and, in Vercel Connect mode, learns it from the
   * first comment it posts). Set it explicitly in Connect mode — auto-detection
   * can't run with only an installation token, and without it the adapter may
   * reply to its own comments (especially across serverless instances).
   */
  botUserId?: number;
  /** Logger instance for error reporting. Defaults to ConsoleLogger. */
  logger?: Logger;
  /**
   * Bot username (e.g., "my-bot" or "my-bot[bot]" for GitHub Apps).
   * Used for @-mention detection.
   * Defaults to GITHUB_BOT_USERNAME env var or "github-bot".
   */
  userName?: string;
  /**
   * Webhook secret for HMAC-SHA256 verification.
   * Set this in your GitHub webhook settings.
   * Defaults to GITHUB_WEBHOOK_SECRET env var.
   */
  webhookSecret?: string;
  /**
   * Custom webhook verifier used in place of `webhookSecret`. When set, it
   * takes precedence over `webhookSecret` and the `GITHUB_WEBHOOK_SECRET`
   * env var. Useful when webhooks arrive via Vercel Connect trigger
   * forwarding (verified with a Vercel OIDC token rather than GitHub's
   * webhook secret).
   */
  webhookVerifier?: GitHubWebhookVerifier;
}

/**
 * Configuration using a Personal Access Token (PAT).
 * Simpler setup, suitable for personal bots or testing.
 */
export interface GitHubAdapterPATConfig extends GitHubAdapterBaseConfig {
  appId?: never;
  installationId?: never;
  installationToken?: never;
  privateKey?: never;
  /** Personal Access Token with appropriate scopes (repo, write:discussion) */
  token: string;
}

/**
 * Configuration using a GitHub App with a fixed installation.
 * Use this when your bot is only installed on a single org/repo.
 */
export interface GitHubAdapterAppConfig extends GitHubAdapterBaseConfig {
  /** GitHub App ID */
  appId: string;
  /** Installation ID for the app (for single-tenant apps) */
  installationId: number;
  installationToken?: never;
  /** GitHub App private key (PEM format) */
  privateKey: string;
  token?: never;
}

/**
 * Configuration using a GitHub App for multi-tenant (public) apps.
 * The installation ID is automatically extracted from each webhook payload.
 * Use this when your bot can be installed by anyone.
 */
export interface GitHubAdapterMultiTenantAppConfig
  extends GitHubAdapterBaseConfig {
  /** GitHub App ID */
  appId: string;
  /** Omit installationId to enable multi-tenant mode */
  installationId?: never;
  installationToken?: never;
  /** GitHub App private key (PEM format) */
  privateKey: string;
  token?: never;
}

/**
 * Configuration backed by Vercel Connect.
 *
 * Supplies installation access tokens directly (skipping the GitHub App
 * JWT exchange) and verifies inbound webhooks with a custom
 * `webhookVerifier` instead of a webhook secret. Pair with
 * `connectGitHubAdapter()` from `@vercel/connect/chat`.
 *
 * @see https://vercel.com/docs/connect
 */
export interface GitHubAdapterConnectConfig extends GitHubAdapterBaseConfig {
  appId?: never;
  installationId?: never;
  /**
   * Installation access token, or a resolver invoked per API call.
   * The adapter sends it directly as the bearer credential and skips the
   * GitHub App private-key JWT exchange. The function form composes with
   * Vercel Connect's short-lived tokens (`getToken`).
   */
  installationToken: string | (() => string | Promise<string>);
  privateKey?: never;
  token?: never;
  /** Connect verifies webhooks via OIDC, so a webhook secret is not used. */
  webhookSecret?: never;
  /**
   * Required. Connect-forwarded webhooks are verified with a Vercel OIDC
   * token rather than GitHub's webhook secret.
   */
  webhookVerifier: GitHubWebhookVerifier;
}

/**
 * Configuration with no auth fields - will auto-detect from env vars.
 */
export interface GitHubAdapterAutoConfig extends GitHubAdapterBaseConfig {
  appId?: never;
  installationId?: never;
  installationToken?: never;
  privateKey?: never;
  token?: never;
}

/**
 * GitHub adapter configuration - PAT, single-tenant App, multi-tenant App,
 * or Vercel Connect.
 */
export type GitHubAdapterConfig =
  | GitHubAdapterPATConfig
  | GitHubAdapterAppConfig
  | GitHubAdapterMultiTenantAppConfig
  | GitHubAdapterConnectConfig
  | GitHubAdapterAutoConfig;

// =============================================================================
// Thread ID
// =============================================================================

/**
 * Decoded thread ID for GitHub.
 *
 * Thread types:
 * - PR-level: Comments in the "Conversation" tab (issue_comment API)
 * - Review comment: Line-specific comments in "Files changed" tab (pull request review comment API)
 * - Issue-level: Comments on GitHub issues (issue_comment API)
 */
export interface GitHubThreadId {
  /** Repository owner (user or organization) */
  owner: string;
  /**
   * Issue or pull request number.
   * GitHub uses a shared number space, so this works for both PRs and issues.
   */
  prNumber: number;
  /** Repository name */
  repo: string;
  /**
   * Root review comment ID for line-specific threads.
   * If present, this is a review comment thread.
   * If absent, this is a PR-level or issue-level comment thread.
   * Only valid when type is "pr" or omitted.
   */
  reviewCommentId?: number;
  /**
   * Thread context type.
   * - "pr": PR conversation tab or review comment thread (default)
   * - "issue": GitHub issue comment thread
   *
   * Omitting this field is equivalent to "pr" for backward compatibility.
   */
  type?: "pr" | "issue";
}

// =============================================================================
// Webhook Payloads
// =============================================================================

/**
 * GitHub user object (simplified).
 */
export interface GitHubUser {
  avatar_url?: string;
  id: number;
  login: string;
  type: "User" | "Bot" | "Organization";
}

/**
 * GitHub repository object (simplified).
 */
export interface GitHubRepository {
  full_name: string;
  id: number;
  name: string;
  owner: GitHubUser;
}

/**
 * GitHub pull request object (simplified).
 */
export interface GitHubPullRequest {
  body: string | null;
  html_url: string;
  id: number;
  number: number;
  state: "open" | "closed";
  title: string;
  user: GitHubUser;
}

/**
 * GitHub issue comment (PR-level comment in Conversation tab).
 */
export interface GitHubIssueComment {
  body: string;
  created_at: string;
  html_url: string;
  id: number;
  /** Reactions summary */
  reactions?: {
    url: string;
    total_count: number;
    "+1": number;
    "-1": number;
    laugh: number;
    hooray: number;
    confused: number;
    heart: number;
    rocket: number;
    eyes: number;
  };
  updated_at: string;
  user: GitHubUser;
}

/**
 * GitHub pull request review comment (line-specific comment in Files Changed tab).
 */
export interface GitHubReviewComment {
  body: string;
  /** The commit SHA the comment is associated with */
  commit_id: string;
  created_at: string;
  /** The diff hunk the comment applies to */
  diff_hunk: string;
  html_url: string;
  id: number;
  /**
   * The ID of the comment this is a reply to.
   * If present, this is a reply in an existing thread.
   * If absent, this is the root of a new thread.
   */
  in_reply_to_id?: number;
  /** Line number in the diff */
  line?: number;
  /** The original commit SHA (for outdated comments) */
  original_commit_id: string;
  /** Original line number */
  original_line?: number;
  /** Path to the file being commented on */
  path: string;
  /** Reactions summary */
  reactions?: GitHubIssueComment["reactions"];
  /** Side of the diff (LEFT or RIGHT) */
  side?: "LEFT" | "RIGHT";
  /** Start line for multi-line comments */
  start_line?: number | null;
  /** Start side for multi-line comments */
  start_side?: "LEFT" | "RIGHT" | null;
  updated_at: string;
  user: GitHubUser;
}

/**
 * GitHub App installation info included in webhooks.
 */
export interface GitHubInstallation {
  id: number;
  node_id?: string;
}

/**
 * Webhook payload for issue_comment events.
 */
export interface IssueCommentWebhookPayload {
  action: "created" | "edited" | "deleted";
  comment: GitHubIssueComment;
  /** Present when webhook is from a GitHub App */
  installation?: GitHubInstallation;
  issue: {
    number: number;
    title: string;
    pull_request?: {
      url: string;
    };
  };
  repository: GitHubRepository;
  sender: GitHubUser;
}

/**
 * Webhook payload for pull_request_review_comment events.
 */
export interface PullRequestReviewCommentWebhookPayload {
  action: "created" | "edited" | "deleted";
  comment: GitHubReviewComment;
  /** Present when webhook is from a GitHub App */
  installation?: GitHubInstallation;
  pull_request: GitHubPullRequest;
  repository: GitHubRepository;
  sender: GitHubUser;
}

// =============================================================================
// Raw Message Type
// =============================================================================

/**
 * Platform-specific raw message type for GitHub.
 * Can be either an issue comment or a review comment.
 */
export type GitHubRawMessage =
  | {
      type: "issue_comment";
      comment: GitHubIssueComment;
      repository: GitHubRepository;
      prNumber: number;
      /**
       * Whether this comment is on a PR or a plain issue.
       * Defaults to "pr" when omitted for backward compatibility.
       */
      threadType?: "pr" | "issue";
    }
  | {
      type: "review_comment";
      comment: GitHubReviewComment;
      repository: GitHubRepository;
      prNumber: number;
    };

// =============================================================================
// GitHub API Response Types
// =============================================================================

/**
 * Reaction content types supported by GitHub.
 */
export type GitHubReactionContent =
  | "+1"
  | "-1"
  | "laugh"
  | "confused"
  | "heart"
  | "hooray"
  | "rocket"
  | "eyes";
