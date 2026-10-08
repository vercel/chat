/**
 * Type definitions for the GitLab adapter.
 */

import type { Logger } from "chat";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Custom webhook verifier used in place of the GitLab webhook tokens.
 *
 * Receives the incoming request and its raw body. Return a truthy value to
 * accept the request; throw or return a falsy value to reject it (the adapter
 * responds `401`).
 */
export type GitLabWebhookVerifier = (
  request: Request,
  body: string
) => Promise<unknown> | unknown;

/**
 * Configuration for the GitLab adapter.
 *
 * Every field is optional and falls back to an environment variable, so
 * `createGitLabAdapter()` works with no arguments when the environment is set.
 */
export interface GitLabAdapterConfig {
  /**
   * GitLab REST API base URL, including the `/api/v4` suffix.
   * Set this for GitLab Self-Managed or GitLab Dedicated.
   * Defaults to the `GITLAB_API_URL` env var, then `https://gitlab.com/api/v4`.
   */
  apiUrl?: string;
  /**
   * Numeric ID of the bot user. Used to ignore the bot's own comments.
   * Defaults to the `GITLAB_BOT_USER_ID` env var. If unset, the adapter looks
   * it up with `GET /user` during initialization.
   */
  botUserId?: number;
  /** Logger instance for error reporting. Defaults to ConsoleLogger. */
  logger?: Logger;
  /**
   * Access token used for REST API calls: a personal, project, or group
   * access token with the `api` scope, or an OAuth access token.
   * Defaults to the `GITLAB_TOKEN` env var.
   */
  token?: string;
  /**
   * Bot username used for @-mention detection.
   * Defaults to the `GITLAB_BOT_USERNAME` env var. If unset, the adapter uses
   * the username returned by `GET /user` during initialization, then falls
   * back to `"gitlab-bot"`.
   */
  userName?: string;
  /**
   * Webhook secret token, compared against the `X-Gitlab-Token` header.
   * Defaults to the `GITLAB_WEBHOOK_SECRET` env var.
   */
  webhookSecret?: string;
  /**
   * Webhook signing token (`whsec_…`), used to verify the HMAC-SHA256
   * `webhook-signature` header. Available in GitLab 19.0 and later.
   * Defaults to the `GITLAB_WEBHOOK_SIGNING_TOKEN` env var.
   */
  webhookSigningToken?: string;
  /**
   * Custom webhook verifier. When set, it takes precedence over
   * `webhookSigningToken`, `webhookSecret`, and their env vars.
   */
  webhookVerifier?: GitLabWebhookVerifier;
}

// =============================================================================
// Thread ID
// =============================================================================

/** The kind of GitLab object a comment thread belongs to. */
export type GitLabNoteableType = "merge_request" | "issue";

/**
 * Decoded thread ID for GitLab.
 *
 * Thread ID formats:
 * - Merge request comments: `gitlab:{projectId}:mr:{iid}`
 * - Issue comments: `gitlab:{projectId}:issue:{iid}`
 * - Threaded discussion: `gitlab:{projectId}:{mr|issue}:{iid}:{discussionId}`
 */
export interface GitLabThreadId {
  /**
   * Discussion ID for a threaded discussion (a diff comment, a started
   * thread, or a reply to a comment). Omit for top-level comments.
   */
  discussionId?: string;
  /** Internal ID (`iid`) of the merge request or issue within the project. */
  noteableIid: number;
  /** Whether the thread is on a merge request or an issue. */
  noteableType: GitLabNoteableType;
  /** Numeric project ID. */
  projectId: number;
}

// =============================================================================
// GitLab API objects
// =============================================================================

/** GitLab user as returned by the REST API and webhook payloads. */
export interface GitLabUser {
  avatar_url?: string | null;
  /** Present on REST user objects. `true` for bot users. */
  bot?: boolean;
  email?: string | null;
  id: number;
  name: string;
  public_email?: string | null;
  username: string;
}

/** Note (comment) type. `null` for a top-level comment. */
export type GitLabNoteType = "DiscussionNote" | "DiffNote" | null;

/**
 * Note (comment) in the shape of the REST Notes API.
 * Webhook notes are normalized into this shape.
 */
export interface GitLabNote {
  author: GitLabUser;
  body: string;
  created_at: string;
  /** Set on webhook notes. The REST Notes API doesn't return it. */
  discussion_id?: string;
  id: number;
  internal?: boolean;
  noteable_iid?: number | null;
  noteable_type?: string;
  system: boolean;
  type: GitLabNoteType;
  updated_at: string;
}

/** Discussion returned by the REST Discussions API. */
export interface GitLabDiscussion {
  id: string;
  individual_note: boolean;
  notes: GitLabNote[];
}

/** Emoji reaction (award emoji) returned by the REST API. */
export interface GitLabAwardEmoji {
  id: number;
  name: string;
  user: GitLabUser;
}

/** Subset of the merge request object returned by the REST API. */
export interface GitLabMergeRequest {
  assignees?: GitLabUser[];
  author: GitLabUser;
  created_at: string;
  description: string | null;
  id: number;
  iid: number;
  labels?: string[];
  project_id: number;
  references?: { full?: string; short?: string };
  state: string;
  title: string;
  updated_at: string;
  web_url: string;
}

/** Subset of the issue object returned by the REST API. */
export interface GitLabIssue {
  assignees?: GitLabUser[];
  author: GitLabUser;
  created_at: string;
  description: string | null;
  id: number;
  iid: number;
  labels?: string[];
  project_id: number;
  references?: { full?: string; short?: string };
  state: string;
  title: string;
  updated_at: string;
  web_url: string;
}

/** Subset of the project object returned by the REST API. */
export interface GitLabProject {
  default_branch?: string | null;
  description?: string | null;
  id: number;
  name: string;
  open_issues_count?: number;
  path_with_namespace: string;
  visibility?: string;
  web_url: string;
}

// =============================================================================
// Raw message
// =============================================================================

/** Platform-specific raw message stored on every `Message` from GitLab. */
export interface GitLabRawMessage {
  /** Discussion ID when the message belongs to a threaded discussion. */
  discussionId?: string;
  /** The note (comment) itself. */
  note: GitLabNote;
  /** Internal ID of the merge request or issue. */
  noteableIid: number;
  /** Whether the note is on a merge request or an issue. */
  noteableType: GitLabNoteableType;
  /** Numeric project ID. */
  projectId: number;
}

// =============================================================================
// Webhook payloads
// =============================================================================

/** Project object included in webhook payloads. */
export interface GitLabWebhookProject {
  id: number;
  name: string;
  path_with_namespace: string;
  web_url: string;
}

/** Webhook user (the actor that triggered the event). */
export interface GitLabWebhookUser {
  avatar_url?: string | null;
  email?: string | null;
  id: number;
  name: string;
  username: string;
}

/** `object_attributes` of a comment (`Note Hook`) event. */
export interface GitLabNoteAttributes {
  action?: "create" | "update";
  author_id: number;
  confidential?: boolean;
  created_at: string;
  discussion_id?: string;
  id: number;
  internal?: boolean;
  note: string;
  noteable_id?: number | null;
  noteable_type: "MergeRequest" | "Issue" | "Commit" | "Snippet" | string;
  project_id: number;
  system: boolean;
  type?: GitLabNoteType;
  updated_at: string;
  url?: string;
}

/** Comment (`Note Hook`) webhook payload. */
export interface GitLabNoteWebhookPayload {
  event_type?: string;
  issue?: { confidential?: boolean; id: number; iid: number; title?: string };
  merge_request?: { id: number; iid: number; title?: string };
  object_attributes: GitLabNoteAttributes;
  object_kind: "note";
  project: GitLabWebhookProject;
  project_id: number;
  user: GitLabWebhookUser;
}

/** Emoji (`Emoji Hook`) webhook payload. */
export interface GitLabEmojiWebhookPayload {
  event_type?: "award" | "revoke";
  issue?: { confidential?: boolean; id: number; iid: number };
  merge_request?: { id: number; iid: number };
  note?: {
    author_id: number;
    confidential?: boolean;
    created_at: string;
    discussion_id?: string;
    id: number;
    internal?: boolean;
    note: string;
    noteable_type: string;
    system?: boolean;
    type?: GitLabNoteType;
    updated_at: string;
  };
  object_attributes: {
    action: "award" | "revoke";
    awardable_id: number;
    awardable_type: string;
    id: number;
    name: string;
    user_id: number;
  };
  object_kind: "emoji";
  project: GitLabWebhookProject;
  project_id: number;
  user: GitLabWebhookUser;
}
