import { createHmac, timingSafeEqual } from "node:crypto";
import { extractCard, ValidationError } from "@chat-adapter/shared";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type {
  Adapter,
  AdapterPostableMessage,
  Author,
  ChannelInfo,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  ListThreadsOptions,
  ListThreadsResult,
  Logger,
  RawMessage,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import { ConsoleLogger, convertEmojiPlaceholders, Message } from "chat";
import { cardToGitHubMarkdown } from "./cards";
import { GitHubFormatConverter } from "./markdown";
import type {
  GitHubAdapterConfig,
  GitHubIssueComment,
  GitHubRawMessage,
  GitHubReactionContent,
  GitHubReviewComment,
  GitHubThreadId,
  GitHubUser,
  IssueCommentWebhookPayload,
  PullRequestReviewCommentWebhookPayload,
} from "./types";

const REVIEW_COMMENT_THREAD_PATTERN = /^([^/]+)\/([^:]+):(\d+):rc:(\d+)$/;
const PR_THREAD_PATTERN = /^([^/]+)\/([^:]+):(\d+)$/;

// Re-export types
export type {
  GitHubAdapterAppConfig,
  GitHubAdapterConfig,
  GitHubAdapterMultiTenantAppConfig,
  GitHubAdapterPATConfig,
  GitHubRawMessage,
  GitHubThreadId,
} from "./types";

/**
 * GitHub adapter for chat SDK.
 *
 * Supports both PR-level comments (Conversation tab) and review comment threads
 * (Files Changed tab - line-specific).
 *
 * @example Single-tenant (your own org)
 * ```typescript
 * import { Chat } from "chat";
 * import { GitHubAdapter } from "@chat-adapter/github";
 * import { MemoryState } from "@chat-adapter/state-memory";
 *
 * const chat = new Chat({
 *   userName: "my-bot",
 *   adapters: {
 *     github: new GitHubAdapter({
 *       token: process.env.GITHUB_TOKEN!,
 *       webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
 *       userName: "my-bot",
 *       logger: console,
 *     }),
 *   },
 *   state: new MemoryState(),
 *   logger: "info",
 * });
 * ```
 *
 * @example Multi-tenant (public app anyone can install)
 * ```typescript
 * const chat = new Chat({
 *   userName: "my-bot[bot]",
 *   adapters: {
 *     github: new GitHubAdapter({
 *       appId: process.env.GITHUB_APP_ID!,
 *       privateKey: process.env.GITHUB_PRIVATE_KEY!,
 *       // No installationId - automatically extracted from webhooks
 *       webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
 *       userName: "my-bot[bot]",
 *       logger: console,
 *     }),
 *   },
 *   state: new MemoryState(),
 *   logger: "info",
 * });
 * ```
 */
export class GitHubAdapter
  implements Adapter<GitHubThreadId, GitHubRawMessage>
{
  readonly name = "github";
  readonly userName: string;

  // Single Octokit instance for PAT or single-tenant app mode
  private readonly octokit: Octokit | null = null;
  // App credentials for multi-tenant mode
  private readonly appCredentials: {
    appId: string;
    privateKey: string;
  } | null = null;
  // Cache of Octokit instances per installation (for multi-tenant)
  private readonly installationClients = new Map<number, Octokit>();

  private readonly webhookSecret: string;
  private chat: ChatInstance | null = null;
  private readonly logger: Logger;
  private _botUserId: number | null = null;
  private readonly formatConverter = new GitHubFormatConverter();

  /** Bot user ID (numeric) used for self-message detection */
  get botUserId(): string | undefined {
    return this._botUserId?.toString();
  }

  /** Whether this adapter is in multi-tenant mode (no fixed installation ID) */
  get isMultiTenant(): boolean {
    return this.appCredentials !== null && this.octokit === null;
  }

  constructor(config: GitHubAdapterConfig) {
    this.webhookSecret = config.webhookSecret;
    this.logger = config.logger;
    this.userName = config.userName;
    this._botUserId = config.botUserId ?? null;

    // Create Octokit instance based on auth method
    if ("token" in config && config.token) {
      // PAT mode - single Octokit instance
      this.octokit = new Octokit({ auth: config.token });
    } else if ("appId" in config && config.appId) {
      if ("installationId" in config && config.installationId) {
        // Single-tenant app mode - fixed installation
        this.octokit = new Octokit({
          authStrategy: createAppAuth,
          auth: {
            appId: config.appId,
            privateKey: config.privateKey,
            installationId: config.installationId,
          },
        });
      } else {
        // Multi-tenant app mode - create clients per installation
        this.appCredentials = {
          appId: config.appId,
          privateKey: config.privateKey,
        };
        this.logger.info(
          "GitHub adapter initialized in multi-tenant mode (installation ID will be extracted from webhooks)"
        );
      }
    } else {
      throw new Error(
        "GitHubAdapter requires either token or appId/privateKey"
      );
    }
  }

  /**
   * Get or create an Octokit instance for a specific installation.
   * For single-tenant mode, returns the single instance.
   * For multi-tenant mode, creates/caches instances per installation.
   */
  private getOctokit(installationId?: number): Octokit {
    // Single-tenant mode - return the single instance
    if (this.octokit) {
      return this.octokit;
    }

    // Multi-tenant mode - need an installation ID
    if (!this.appCredentials) {
      throw new Error("Adapter not properly configured");
    }

    if (!installationId) {
      throw new Error(
        "Installation ID required for multi-tenant mode. " +
          "This usually means you're trying to make an API call outside of a webhook context. " +
          "For proactive messages, use thread IDs from previous webhook interactions."
      );
    }

    // Check cache
    let client = this.installationClients.get(installationId);
    if (!client) {
      // Create new client for this installation
      client = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: this.appCredentials.appId,
          privateKey: this.appCredentials.privateKey,
          installationId,
        },
      });
      this.installationClients.set(installationId, client);
      this.logger.debug("Created Octokit client for installation", {
        installationId,
      });
    }

    return client;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    // Fetch bot user ID if not provided (only works for single-tenant or PAT mode)
    if (!this._botUserId && this.octokit) {
      try {
        const { data: user } = await this.octokit.users.getAuthenticated();
        this._botUserId = user.id;
        this.logger.info("GitHub auth completed", {
          botUserId: this._botUserId,
          login: user.login,
        });
      } catch (error) {
        this.logger.warn("Could not fetch bot user ID", { error });
      }
    }
  }

  /**
   * Get the state key for storing installation ID for a repository.
   */
  private getInstallationKey(owner: string, repo: string): string {
    return `github:install:${owner}/${repo}`;
  }

  /**
   * Store the installation ID for a repository (for multi-tenant mode).
   */
  private async storeInstallationId(
    owner: string,
    repo: string,
    installationId: number
  ): Promise<void> {
    if (!(this.chat && this.isMultiTenant)) {
      return;
    }

    const key = this.getInstallationKey(owner, repo);
    await this.chat.getState().set(key, installationId);
    this.logger.debug("Stored installation ID", {
      owner,
      repo,
      installationId,
    });
  }

  /**
   * Get the installation ID for a repository (for multi-tenant mode).
   */
  private async getInstallationId(
    owner: string,
    repo: string
  ): Promise<number | undefined> {
    if (!(this.chat && this.isMultiTenant)) {
      return undefined;
    }

    const key = this.getInstallationKey(owner, repo);
    return (await this.chat.getState().get<number>(key)) ?? undefined;
  }

  /**
   * Handle incoming webhook from GitHub.
   */
  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    const body = await request.text();
    this.logger.debug("GitHub webhook raw body", {
      body: body.substring(0, 500),
    });

    // Verify request signature
    const signature = request.headers.get("x-hub-signature-256");
    if (!this.verifySignature(body, signature)) {
      return new Response("Invalid signature", { status: 401 });
    }

    // Get event type from header
    const eventType = request.headers.get("x-github-event");
    this.logger.debug("GitHub webhook event type", { eventType });

    // Handle ping event (webhook verification)
    if (eventType === "ping") {
      this.logger.info("GitHub webhook ping received");
      return new Response("pong", { status: 200 });
    }

    // Parse the JSON payload
    let payload:
      | IssueCommentWebhookPayload
      | PullRequestReviewCommentWebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      this.logger.error("GitHub webhook invalid JSON", {
        contentType: request.headers.get("content-type"),
        bodyPreview: body.substring(0, 200),
      });
      return new Response(
        "Invalid JSON. Make sure webhook Content-Type is set to application/json",
        { status: 400 }
      );
    }

    // Extract and store installation ID for multi-tenant mode
    const installationId = (payload as { installation?: { id: number } })
      .installation?.id;
    if (installationId && this.isMultiTenant) {
      const repo = payload.repository;
      await this.storeInstallationId(
        repo.owner.login,
        repo.name,
        installationId
      );
    }

    // Handle events
    if (eventType === "issue_comment") {
      const issuePayload = payload as IssueCommentWebhookPayload;
      // Only process comments on PRs (they have a pull_request field)
      if (
        issuePayload.action === "created" &&
        issuePayload.issue.pull_request
      ) {
        this.handleIssueComment(issuePayload, installationId, options);
      }
    } else if (eventType === "pull_request_review_comment") {
      const reviewPayload = payload as PullRequestReviewCommentWebhookPayload;
      if (reviewPayload.action === "created") {
        this.handleReviewComment(reviewPayload, installationId, options);
      }
    }

    return new Response("ok", { status: 200 });
  }

  /**
   * Verify GitHub webhook signature using HMAC-SHA256.
   */
  private verifySignature(body: string, signature: string | null): boolean {
    if (!signature) {
      return false;
    }

    // GitHub signature format: sha256=<hex>
    const expected = `sha256=${createHmac("sha256", this.webhookSecret)
      .update(body)
      .digest("hex")}`;

    // Use timing-safe comparison
    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  /**
   * Handle issue_comment webhook (PR-level comments in Conversation tab).
   */
  private handleIssueComment(
    payload: IssueCommentWebhookPayload,
    _installationId: number | undefined,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring comment");
      return;
    }

    const { comment, issue, repository, sender } = payload;

    // Build thread ID (PR-level)
    const threadId = this.encodeThreadId({
      owner: repository.owner.login,
      repo: repository.name,
      prNumber: issue.number,
    });

    // Build message
    const message = this.parseIssueComment(
      comment,
      repository,
      issue.number,
      threadId
    );

    // Check if this is from the bot itself
    if (sender.id === this._botUserId) {
      this.logger.debug("Ignoring message from self", {
        messageId: comment.id,
      });
      return;
    }

    this.chat.processMessage(this, threadId, message, options);
  }

  /**
   * Handle pull_request_review_comment webhook (line-specific comments).
   */
  private handleReviewComment(
    payload: PullRequestReviewCommentWebhookPayload,
    _installationId: number | undefined,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring comment");
      return;
    }

    const { comment, pull_request, repository, sender } = payload;

    // Determine root comment ID for thread
    // If in_reply_to_id exists, use that (this is a reply in existing thread)
    // Otherwise, this comment is the root of a new thread
    const rootCommentId = comment.in_reply_to_id ?? comment.id;

    // Build thread ID (review comment thread)
    const threadId = this.encodeThreadId({
      owner: repository.owner.login,
      repo: repository.name,
      prNumber: pull_request.number,
      reviewCommentId: rootCommentId,
    });

    // Build message
    const message = this.parseReviewComment(
      comment,
      repository,
      pull_request.number,
      threadId
    );

    // Check if this is from the bot itself
    if (sender.id === this._botUserId) {
      this.logger.debug("Ignoring message from self", {
        messageId: comment.id,
      });
      return;
    }

    this.chat.processMessage(this, threadId, message, options);
  }

  /**
   * Parse an issue comment into a normalized Message.
   */
  private parseIssueComment(
    comment: GitHubIssueComment,
    repository: { owner: GitHubUser; name: string },
    prNumber: number,
    threadId: string
  ): Message<GitHubRawMessage> {
    const author = this.parseAuthor(comment.user);

    return new Message({
      id: comment.id.toString(),
      threadId,
      text: this.formatConverter.extractPlainText(comment.body),
      formatted: this.formatConverter.toAst(comment.body),
      raw: {
        type: "issue_comment",
        comment,
        repository: {
          id: 0, // Not needed for raw storage
          name: repository.name,
          full_name: `${repository.owner.login}/${repository.name}`,
          owner: repository.owner,
        },
        prNumber,
      },
      author,
      metadata: {
        dateSent: new Date(comment.created_at),
        edited: comment.created_at !== comment.updated_at,
        editedAt:
          comment.created_at !== comment.updated_at
            ? new Date(comment.updated_at)
            : undefined,
      },
      attachments: [],
    });
  }

  /**
   * Parse a review comment into a normalized Message.
   */
  private parseReviewComment(
    comment: GitHubReviewComment,
    repository: { owner: GitHubUser; name: string },
    prNumber: number,
    threadId: string
  ): Message<GitHubRawMessage> {
    const author = this.parseAuthor(comment.user);

    return new Message({
      id: comment.id.toString(),
      threadId,
      text: this.formatConverter.extractPlainText(comment.body),
      formatted: this.formatConverter.toAst(comment.body),
      raw: {
        type: "review_comment",
        comment,
        repository: {
          id: 0,
          name: repository.name,
          full_name: `${repository.owner.login}/${repository.name}`,
          owner: repository.owner,
        },
        prNumber,
      },
      author,
      metadata: {
        dateSent: new Date(comment.created_at),
        edited: comment.created_at !== comment.updated_at,
        editedAt:
          comment.created_at !== comment.updated_at
            ? new Date(comment.updated_at)
            : undefined,
      },
      attachments: [],
    });
  }

  /**
   * Parse a GitHub user into an Author.
   */
  private parseAuthor(user: GitHubUser): Author {
    return {
      userId: user.id.toString(),
      userName: user.login,
      fullName: user.login, // GitHub doesn't always expose real names
      isBot: user.type === "Bot",
      isMe: user.id === this._botUserId,
    };
  }

  /**
   * Get the Octokit client for a specific thread.
   * In multi-tenant mode, looks up the installation ID from state.
   */
  private async getOctokitForThread(
    owner: string,
    repo: string
  ): Promise<Octokit> {
    const installationId = await this.getInstallationId(owner, repo);
    return this.getOctokit(installationId);
  }

  /**
   * Post a message to a thread.
   */
  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<GitHubRawMessage>> {
    const { owner, repo, prNumber, reviewCommentId } =
      this.decodeThreadId(threadId);

    const octokit = await this.getOctokitForThread(owner, repo);

    // Render message to GitHub markdown
    let body: string;
    const card = extractCard(message);
    if (card) {
      body = cardToGitHubMarkdown(card);
    } else {
      body = this.formatConverter.renderPostable(message);
    }

    // Convert emoji placeholders to unicode
    body = convertEmojiPlaceholders(body, "github");

    if (reviewCommentId) {
      // Review comment thread - reply with in_reply_to
      const { data: comment } = await octokit.pulls.createReplyForReviewComment(
        {
          owner,
          repo,
          pull_number: prNumber,
          comment_id: reviewCommentId,
          body,
        }
      );

      return {
        id: comment.id.toString(),
        threadId,
        raw: {
          type: "review_comment",
          comment: comment as GitHubReviewComment,
          repository: {
            id: 0,
            name: repo,
            full_name: `${owner}/${repo}`,
            owner: { id: 0, login: owner, type: "User" },
          },
          prNumber,
        },
      };
    }
    // PR-level thread - issue comment
    const { data: comment } = await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });

    return {
      id: comment.id.toString(),
      threadId,
      raw: {
        type: "issue_comment",
        comment: comment as GitHubIssueComment,
        repository: {
          id: 0,
          name: repo,
          full_name: `${owner}/${repo}`,
          owner: { id: 0, login: owner, type: "User" },
        },
        prNumber,
      },
    };
  }

  /**
   * Edit an existing message.
   */
  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<GitHubRawMessage>> {
    const { owner, repo, prNumber, reviewCommentId } =
      this.decodeThreadId(threadId);
    const commentId = Number.parseInt(messageId, 10);

    const octokit = await this.getOctokitForThread(owner, repo);

    // Render message to GitHub markdown
    let body: string;
    const card = extractCard(message);
    if (card) {
      body = cardToGitHubMarkdown(card);
    } else {
      body = this.formatConverter.renderPostable(message);
    }

    // Convert emoji placeholders to unicode
    body = convertEmojiPlaceholders(body, "github");

    if (reviewCommentId) {
      // Review comment
      const { data: comment } = await octokit.pulls.updateReviewComment({
        owner,
        repo,
        comment_id: commentId,
        body,
      });

      return {
        id: comment.id.toString(),
        threadId,
        raw: {
          type: "review_comment",
          comment: comment as GitHubReviewComment,
          repository: {
            id: 0,
            name: repo,
            full_name: `${owner}/${repo}`,
            owner: { id: 0, login: owner, type: "User" },
          },
          prNumber,
        },
      };
    }
    // Issue comment
    const { data: comment } = await octokit.issues.updateComment({
      owner,
      repo,
      comment_id: commentId,
      body,
    });

    return {
      id: comment.id.toString(),
      threadId,
      raw: {
        type: "issue_comment",
        comment: comment as GitHubIssueComment,
        repository: {
          id: 0,
          name: repo,
          full_name: `${owner}/${repo}`,
          owner: { id: 0, login: owner, type: "User" },
        },
        prNumber,
      },
    };
  }

  /**
   * Delete a message.
   */
  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const { owner, repo, reviewCommentId } = this.decodeThreadId(threadId);
    const commentId = Number.parseInt(messageId, 10);

    const octokit = await this.getOctokitForThread(owner, repo);

    if (reviewCommentId) {
      await octokit.pulls.deleteReviewComment({
        owner,
        repo,
        comment_id: commentId,
      });
    } else {
      await octokit.issues.deleteComment({
        owner,
        repo,
        comment_id: commentId,
      });
    }
  }

  /**
   * Add a reaction to a message.
   */
  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const { owner, repo, reviewCommentId } = this.decodeThreadId(threadId);
    const commentId = Number.parseInt(messageId, 10);

    const octokit = await this.getOctokitForThread(owner, repo);

    // Convert emoji to GitHub reaction content
    const content = this.emojiToGitHubReaction(emoji);

    if (reviewCommentId) {
      await octokit.reactions.createForPullRequestReviewComment({
        owner,
        repo,
        comment_id: commentId,
        content,
      });
    } else {
      await octokit.reactions.createForIssueComment({
        owner,
        repo,
        comment_id: commentId,
        content,
      });
    }
  }

  /**
   * Remove a reaction from a message.
   */
  async removeReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const { owner, repo, reviewCommentId } = this.decodeThreadId(threadId);
    const commentId = Number.parseInt(messageId, 10);
    const content = this.emojiToGitHubReaction(emoji);

    const octokit = await this.getOctokitForThread(owner, repo);

    // List reactions to find the one to delete
    const reactions = reviewCommentId
      ? (
          await octokit.reactions.listForPullRequestReviewComment({
            owner,
            repo,
            comment_id: commentId,
          })
        ).data
      : (
          await octokit.reactions.listForIssueComment({
            owner,
            repo,
            comment_id: commentId,
          })
        ).data;

    // Find the bot's reaction with matching content
    const reaction = reactions.find(
      (r) => r.content === content && r.user?.id === this._botUserId
    );

    if (reaction) {
      if (reviewCommentId) {
        await octokit.reactions.deleteForPullRequestComment({
          owner,
          repo,
          comment_id: commentId,
          reaction_id: reaction.id,
        });
      } else {
        await octokit.reactions.deleteForIssueComment({
          owner,
          repo,
          comment_id: commentId,
          reaction_id: reaction.id,
        });
      }
    }
  }

  /**
   * Convert SDK emoji to GitHub reaction content.
   */
  private emojiToGitHubReaction(
    emoji: EmojiValue | string
  ): GitHubReactionContent {
    const emojiName = typeof emoji === "string" ? emoji : emoji.name;

    // Map common emoji names to GitHub reactions
    const mapping: Record<string, GitHubReactionContent> = {
      thumbs_up: "+1",
      "+1": "+1",
      thumbs_down: "-1",
      "-1": "-1",
      laugh: "laugh",
      smile: "laugh",
      confused: "confused",
      thinking: "confused",
      heart: "heart",
      love_eyes: "heart",
      hooray: "hooray",
      party: "hooray",
      confetti: "hooray",
      rocket: "rocket",
      eyes: "eyes",
    };

    return mapping[emojiName] || "+1";
  }

  /**
   * Show typing indicator (no-op for GitHub).
   */
  async startTyping(_threadId: string): Promise<void> {
    // GitHub doesn't support typing indicators
  }

  /**
   * Fetch messages from a thread.
   */
  async fetchMessages(
    threadId: string,
    options?: FetchOptions
  ): Promise<FetchResult<GitHubRawMessage>> {
    const { owner, repo, prNumber, reviewCommentId } =
      this.decodeThreadId(threadId);
    const limit = options?.limit ?? 100;
    const direction = options?.direction ?? "backward";

    const octokit = await this.getOctokitForThread(owner, repo);

    let messages: Message<GitHubRawMessage>[];

    if (reviewCommentId) {
      // Fetch review comments for the PR and filter by thread
      const { data: allComments } = await octokit.pulls.listReviewComments({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100, // Fetch more to filter
      });

      // Filter to comments in this thread (same in_reply_to_id or the root itself)
      const threadComments = allComments.filter(
        (c) => c.id === reviewCommentId || c.in_reply_to_id === reviewCommentId
      );

      messages = threadComments.map((comment) =>
        this.parseReviewComment(
          comment as GitHubReviewComment,
          {
            owner: { id: 0, login: owner, type: "User", avatar_url: "" },
            name: repo,
          },
          prNumber,
          threadId
        )
      );
    } else {
      // Fetch issue comments
      const { data: comments } = await octokit.issues.listComments({
        owner,
        repo,
        issue_number: prNumber,
        per_page: limit,
      });

      messages = comments.map((comment) =>
        this.parseIssueComment(
          comment as GitHubIssueComment,
          {
            owner: { id: 0, login: owner, type: "User", avatar_url: "" },
            name: repo,
          },
          prNumber,
          threadId
        )
      );
    }

    // Sort chronologically (oldest first)
    messages.sort(
      (a, b) => a.metadata.dateSent.getTime() - b.metadata.dateSent.getTime()
    );

    // For backward direction, take the last N messages
    if (direction === "backward" && messages.length > limit) {
      messages = messages.slice(-limit);
    } else if (direction === "forward" && messages.length > limit) {
      messages = messages.slice(0, limit);
    }

    return {
      messages,
      nextCursor: undefined, // Simplified pagination for now
    };
  }

  /**
   * Fetch thread metadata.
   */
  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { owner, repo, prNumber, reviewCommentId } =
      this.decodeThreadId(threadId);

    const octokit = await this.getOctokitForThread(owner, repo);

    const { data: pr } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    return {
      id: threadId,
      channelId: `${owner}/${repo}`,
      channelName: `${repo} #${prNumber}`,
      isDM: false,
      metadata: {
        owner,
        repo,
        prNumber,
        prTitle: pr.title,
        prState: pr.state,
        reviewCommentId,
      },
    };
  }

  /**
   * Encode platform data into a thread ID string.
   *
   * Thread ID formats:
   * - PR-level: `github:{owner}/{repo}:{prNumber}`
   * - Review comment: `github:{owner}/{repo}:{prNumber}:rc:{reviewCommentId}`
   */
  encodeThreadId(platformData: GitHubThreadId): string {
    const { owner, repo, prNumber, reviewCommentId } = platformData;

    if (reviewCommentId) {
      return `github:${owner}/${repo}:${prNumber}:rc:${reviewCommentId}`;
    }
    return `github:${owner}/${repo}:${prNumber}`;
  }

  /**
   * Decode thread ID string back to platform data.
   */
  decodeThreadId(threadId: string): GitHubThreadId {
    if (!threadId.startsWith("github:")) {
      throw new ValidationError(
        "github",
        `Invalid GitHub thread ID: ${threadId}`
      );
    }

    const withoutPrefix = threadId.slice(7); // Remove "github:"

    // Check for review comment thread format
    const rcMatch = withoutPrefix.match(REVIEW_COMMENT_THREAD_PATTERN);
    if (rcMatch) {
      return {
        owner: rcMatch[1],
        repo: rcMatch[2],
        prNumber: Number.parseInt(rcMatch[3], 10),
        reviewCommentId: Number.parseInt(rcMatch[4], 10),
      };
    }

    // PR-level thread format
    const prMatch = withoutPrefix.match(PR_THREAD_PATTERN);
    if (prMatch) {
      return {
        owner: prMatch[1],
        repo: prMatch[2],
        prNumber: Number.parseInt(prMatch[3], 10),
      };
    }

    throw new ValidationError(
      "github",
      `Invalid GitHub thread ID format: ${threadId}`
    );
  }

  /**
   * Derive channel ID from a GitHub thread ID.
   * github:{owner}/{repo}:{prNumber}... -> github:{owner}/{repo}
   */
  channelIdFromThreadId(threadId: string): string {
    const { owner, repo } = this.decodeThreadId(threadId);
    return `github:${owner}/${repo}`;
  }

  /**
   * List threads (PRs) in a GitHub repository.
   * Each open PR is treated as a thread.
   */
  async listThreads(
    channelId: string,
    options: ListThreadsOptions = {}
  ): Promise<ListThreadsResult<GitHubRawMessage>> {
    // Channel ID format: "github:{owner}/{repo}"
    const withoutPrefix = channelId.slice(7); // Remove "github:"
    const slashIndex = withoutPrefix.indexOf("/");
    if (slashIndex === -1) {
      throw new ValidationError(
        "github",
        `Invalid GitHub channel ID: ${channelId}`
      );
    }
    const owner = withoutPrefix.slice(0, slashIndex);
    const repo = withoutPrefix.slice(slashIndex + 1);

    const octokit = await this.getOctokitForThread(owner, repo);
    const limit = options.limit || 30;

    this.logger.debug("GitHub API: pulls.list", { owner, repo, limit });

    const { data: pulls } = await octokit.pulls.list({
      owner,
      repo,
      state: "open",
      sort: "updated",
      direction: "desc",
      per_page: limit,
      page: options.cursor ? Number.parseInt(options.cursor, 10) : 1,
    });

    const threads: ListThreadsResult<GitHubRawMessage>["threads"] = pulls.map(
      (pr) => {
        const threadId = this.encodeThreadId({
          owner,
          repo,
          prNumber: pr.number,
        });

        const rootMessage = new Message<GitHubRawMessage>({
          id: pr.number.toString(),
          threadId,
          text: pr.title,
          formatted: this.formatConverter.toAst(pr.title),
          raw: {
            type: "issue_comment",
            comment: {
              id: pr.number,
              body: pr.body || pr.title,
              user: pr.user as GitHubUser,
              created_at: pr.created_at,
              updated_at: pr.updated_at,
              html_url: pr.html_url,
            } as GitHubIssueComment,
            repository: {
              id: 0,
              name: repo,
              full_name: `${owner}/${repo}`,
              owner: { id: 0, login: owner, type: "User" },
            },
            prNumber: pr.number,
          },
          author: this.parseAuthor(pr.user as GitHubUser),
          metadata: {
            dateSent: new Date(pr.created_at),
            edited: pr.created_at !== pr.updated_at,
          },
          attachments: [],
        });

        return {
          id: threadId,
          rootMessage,
          lastReplyAt: new Date(pr.updated_at),
        };
      }
    );

    // Simple page-based cursor
    const currentPage = options.cursor
      ? Number.parseInt(options.cursor, 10)
      : 1;
    const nextCursor =
      pulls.length === limit ? String(currentPage + 1) : undefined;

    return { threads, nextCursor };
  }

  /**
   * Fetch GitHub repository info as channel metadata.
   */
  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    // Channel ID format: "github:{owner}/{repo}"
    const withoutPrefix = channelId.slice(7);
    const slashIndex = withoutPrefix.indexOf("/");
    if (slashIndex === -1) {
      throw new ValidationError(
        "github",
        `Invalid GitHub channel ID: ${channelId}`
      );
    }
    const owner = withoutPrefix.slice(0, slashIndex);
    const repo = withoutPrefix.slice(slashIndex + 1);

    const octokit = await this.getOctokitForThread(owner, repo);

    this.logger.debug("GitHub API: repos.get", { owner, repo });

    const { data: repoData } = await octokit.repos.get({ owner, repo });

    return {
      id: channelId,
      name: repoData.full_name,
      isDM: false,
      metadata: {
        owner,
        repo,
        description: repoData.description,
        visibility: repoData.visibility,
        defaultBranch: repoData.default_branch,
        openIssuesCount: repoData.open_issues_count,
      },
    };
  }

  /**
   * Parse a raw message into normalized format.
   */
  parseMessage(raw: GitHubRawMessage): Message<GitHubRawMessage> {
    if (raw.type === "issue_comment") {
      const threadId = this.encodeThreadId({
        owner: raw.repository.owner.login,
        repo: raw.repository.name,
        prNumber: raw.prNumber,
      });
      return this.parseIssueComment(
        raw.comment,
        { owner: raw.repository.owner, name: raw.repository.name },
        raw.prNumber,
        threadId
      );
    }
    const rootCommentId = raw.comment.in_reply_to_id ?? raw.comment.id;
    const threadId = this.encodeThreadId({
      owner: raw.repository.owner.login,
      repo: raw.repository.name,
      prNumber: raw.prNumber,
      reviewCommentId: rootCommentId,
    });
    return this.parseReviewComment(
      raw.comment,
      { owner: raw.repository.owner, name: raw.repository.name },
      raw.prNumber,
      threadId
    );
  }

  /**
   * Render formatted content to GitHub markdown.
   */
  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }
}

/**
 * Create a new GitHub adapter instance.
 *
 * @example
 * ```typescript
 * const chat = new Chat({
 *   adapters: {
 *     github: createGitHubAdapter({
 *       token: process.env.GITHUB_TOKEN!,
 *       webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
 *       userName: "my-bot",
 *       logger: console,
 *     }),
 *   },
 * });
 * ```
 */
export function createGitHubAdapter(config?: {
  appId?: string;
  botUserId?: number;
  installationId?: number;
  logger?: Logger;
  privateKey?: string;
  token?: string;
  userName?: string;
  webhookSecret?: string;
}): GitHubAdapter {
  const logger = config?.logger ?? new ConsoleLogger("info").child("github");
  const webhookSecret =
    config?.webhookSecret ?? process.env.GITHUB_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new ValidationError(
      "github",
      "webhookSecret is required. Set GITHUB_WEBHOOK_SECRET or provide it in config."
    );
  }
  const userName =
    config?.userName ?? process.env.GITHUB_BOT_USERNAME ?? "github-bot";

  // Auto-detect auth mode. Only fall back to env vars for auth fields when
  // the caller hasn't provided ANY auth field, so we don't mix auth modes.
  const hasAuthConfig = !!(
    config?.token ||
    config?.appId ||
    config?.privateKey
  );

  const token =
    config?.token ?? (hasAuthConfig ? undefined : process.env.GITHUB_TOKEN);
  if (token) {
    return new GitHubAdapter({
      token,
      webhookSecret,
      userName,
      botUserId: config?.botUserId,
      logger,
    });
  }

  const appId =
    config?.appId ?? (hasAuthConfig ? undefined : process.env.GITHUB_APP_ID);
  const privateKey =
    config?.privateKey ??
    (hasAuthConfig ? undefined : process.env.GITHUB_PRIVATE_KEY);
  if (appId && privateKey) {
    const installationIdRaw =
      config?.installationId ??
      (process.env.GITHUB_INSTALLATION_ID
        ? Number.parseInt(process.env.GITHUB_INSTALLATION_ID, 10)
        : undefined);
    if (installationIdRaw) {
      // Single-tenant app mode
      return new GitHubAdapter({
        appId,
        privateKey,
        installationId: installationIdRaw,
        webhookSecret,
        userName,
        botUserId: config?.botUserId,
        logger,
      });
    }
    // Multi-tenant app mode
    return new GitHubAdapter({
      appId,
      privateKey,
      webhookSecret,
      userName,
      botUserId: config?.botUserId,
      logger,
    });
  }

  throw new ValidationError(
    "github",
    "Authentication is required. Set GITHUB_TOKEN or GITHUB_APP_ID/GITHUB_PRIVATE_KEY, or provide token/appId+privateKey in config."
  );
}
