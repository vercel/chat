/**
 * Type definitions for the GitHub adapter.
 */

import type { Logger } from "chat";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Base configuration options shared by all auth methods.
 */
interface GitHubAdapterBaseConfig {
  /** Logger instance for error reporting */
  logger: Logger;
  /**
   * Webhook secret for HMAC-SHA256 verification.
   * Set this in your GitHub webhook settings.
   */
  webhookSecret: string;
  /**
   * Bot username (e.g., "my-bot" or "my-bot[bot]" for GitHub Apps).
   * Used for @-mention detection.
   */
  userName: string;
  /**
   * Bot's GitHub user ID (numeric).
   * Used for self-message detection. If not provided, will be fetched on first API call.
   */
  botUserId?: number;
}

/**
 * Configuration using a Personal Access Token (PAT).
 * Simpler setup, suitable for personal bots or testing.
 */
export interface GitHubAdapterPATConfig extends GitHubAdapterBaseConfig {
  /** Personal Access Token with appropriate scopes (repo, write:discussion) */
  token: string;
  appId?: never;
  privateKey?: never;
  installationId?: never;
}

/**
 * Configuration using a GitHub App with a fixed installation.
 * Use this when your bot is only installed on a single org/repo.
 */
export interface GitHubAdapterAppConfig extends GitHubAdapterBaseConfig {
  /** GitHub App ID */
  appId: string;
  /** GitHub App private key (PEM format) */
  privateKey: string;
  /** Installation ID for the app (for single-tenant apps) */
  installationId: number;
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
  /** GitHub App private key (PEM format) */
  privateKey: string;
  /** Omit installationId to enable multi-tenant mode */
  installationId?: never;
  token?: never;
}

/**
 * GitHub adapter configuration - PAT, single-tenant App, or multi-tenant App.
 */
export type GitHubAdapterConfig =
  | GitHubAdapterPATConfig
  | GitHubAdapterAppConfig
  | GitHubAdapterMultiTenantAppConfig;

// =============================================================================
// Thread ID
// =============================================================================

/**
 * Decoded thread ID for GitHub.
 *
 * Thread types:
 * - PR-level: Comments in the "Conversation" tab (issue_comment API)
 * - Review comment: Line-specific comments in "Files changed" tab (pull request review comment API)
 */
export interface GitHubThreadId {
  /** Repository owner (user or organization) */
  owner: string;
  /** Repository name */
  repo: string;
  /** Pull request number */
  prNumber: number;
  /**
   * Root review comment ID for line-specific threads.
   * If present, this is a review comment thread.
   * If absent, this is a PR-level (issue comment) thread.
   */
  reviewCommentId?: number;
}

// =============================================================================
// Webhook Payloads
// =============================================================================

/**
 * GitHub user object (simplified).
 */
export interface GitHubUser {
  id: number;
  login: string;
  avatar_url?: string;
  type: "User" | "Bot" | "Organization";
}

/**
 * GitHub repository object (simplified).
 */
export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  owner: GitHubUser;
}

/**
 * GitHub pull request object (simplified).
 */
export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  user: GitHubUser;
  html_url: string;
}

/**
 * GitHub issue comment (PR-level comment in Conversation tab).
 */
export interface GitHubIssueComment {
  id: number;
  body: string;
  user: GitHubUser;
  created_at: string;
  updated_at: string;
  html_url: string;
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
}

/**
 * GitHub pull request review comment (line-specific comment in Files Changed tab).
 */
export interface GitHubReviewComment {
  id: number;
  body: string;
  user: GitHubUser;
  created_at: string;
  updated_at: string;
  html_url: string;
  /** The commit SHA the comment is associated with */
  commit_id: string;
  /** The original commit SHA (for outdated comments) */
  original_commit_id: string;
  /** The diff hunk the comment applies to */
  diff_hunk: string;
  /** Path to the file being commented on */
  path: string;
  /** Line number in the diff */
  line?: number;
  /** Original line number */
  original_line?: number;
  /** Side of the diff (LEFT or RIGHT) */
  side?: "LEFT" | "RIGHT";
  /** Start line for multi-line comments */
  start_line?: number | null;
  /** Start side for multi-line comments */
  start_side?: "LEFT" | "RIGHT" | null;
  /**
   * The ID of the comment this is a reply to.
   * If present, this is a reply in an existing thread.
   * If absent, this is the root of a new thread.
   */
  in_reply_to_id?: number;
  /** Reactions summary */
  reactions?: GitHubIssueComment["reactions"];
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
  issue: {
    number: number;
    title: string;
    pull_request?: {
      url: string;
    };
  };
  repository: GitHubRepository;
  sender: GitHubUser;
  /** Present when webhook is from a GitHub App */
  installation?: GitHubInstallation;
}

/**
 * Webhook payload for pull_request_review_comment events.
 */
export interface PullRequestReviewCommentWebhookPayload {
  action: "created" | "edited" | "deleted";
  comment: GitHubReviewComment;
  pull_request: GitHubPullRequest;
  repository: GitHubRepository;
  sender: GitHubUser;
  /** Present when webhook is from a GitHub App */
  installation?: GitHubInstallation;
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
