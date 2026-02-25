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
  /**
   * Bot's GitHub user ID (numeric).
   * Used for self-message detection. If not provided, will be fetched on first API call.
   */
  botUserId?: number;
  /** Logger instance for error reporting */
  logger: Logger;
  /**
   * Bot username (e.g., "my-bot" or "my-bot[bot]" for GitHub Apps).
   * Used for @-mention detection.
   */
  userName: string;
  /**
   * Webhook secret for HMAC-SHA256 verification.
   * Set this in your GitHub webhook settings.
   */
  webhookSecret: string;
}

/**
 * Configuration using a Personal Access Token (PAT).
 * Simpler setup, suitable for personal bots or testing.
 */
export interface GitHubAdapterPATConfig extends GitHubAdapterBaseConfig {
  appId?: never;
  installationId?: never;
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
  /** GitHub App private key (PEM format) */
  privateKey: string;
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
  /** Pull request number */
  prNumber: number;
  /** Repository name */
  repo: string;
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
