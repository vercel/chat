import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  AdapterRateLimitError,
  AuthenticationError,
  extractCard,
  extractFiles,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
  ValidationError,
} from "@chat-adapter/shared";
import type {
  Adapter,
  AdapterPostableMessage,
  Author,
  ChannelInfo,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FileUpload,
  FormattedContent,
  ListThreadsOptions,
  ListThreadsResult,
  Logger,
  MessageSubject,
  RawMessage,
  StreamChunk,
  StreamOptions,
  ThreadInfo,
  UserInfo,
  WebhookOptions,
} from "chat";
import {
  ConsoleLogger,
  convertEmojiPlaceholders,
  defaultEmojiResolver,
  Message,
} from "chat";
import { cardToGitLabMarkdown } from "./cards";
import { GitLabFormatConverter } from "./markdown";
import type {
  GitLabAdapterConfig,
  GitLabAwardEmoji,
  GitLabDiscussion,
  GitLabEmojiWebhookPayload,
  GitLabIssue,
  GitLabMergeRequest,
  GitLabNote,
  GitLabNoteableType,
  GitLabNoteWebhookPayload,
  GitLabProject,
  GitLabRawMessage,
  GitLabThreadId,
  GitLabUser,
  GitLabWebhookUser,
  GitLabWebhookVerifier,
} from "./types";

export { cardToGitLabMarkdown } from "./cards";
export { GitLabFormatConverter } from "./markdown";
export type {
  GitLabAdapterConfig,
  GitLabAwardEmoji,
  GitLabDiscussion,
  GitLabEmojiWebhookPayload,
  GitLabIssue,
  GitLabMergeRequest,
  GitLabNote,
  GitLabNoteableType,
  GitLabNoteType,
  GitLabNoteWebhookPayload,
  GitLabProject,
  GitLabRawMessage,
  GitLabThreadId,
  GitLabUser,
  GitLabWebhookVerifier,
} from "./types";

const DEFAULT_API_URL = "https://gitlab.com/api/v4";
const DEFAULT_USER_NAME = "gitlab-bot";
const THREAD_ID_PATTERN = /^gitlab:(\d+):(mr|issue):(\d+)(?::([0-9a-f]+))?$/;
const CHANNEL_ID_PATTERN = /^gitlab:(\d+)$/;
const LEGACY_DATE_PATTERN = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/;
const PROJECT_BOT_USERNAME_PATTERN = /^(project|group)_\d+_bot/;
const TRAILING_SLASH_PATTERN = /\/+$/;
const SIGNING_TOKEN_PREFIX = "whsec_";
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;
const MAX_PAGES = 20;

/**
 * GitLab award emoji names for normalized emoji whose Slack-style shortcode
 * differs from GitLab's canonical name. Everything else falls back to the
 * Slack-style shortcode, which GitLab shares for most emoji.
 */
const GITLAB_EMOJI_NAMES: Record<string, string> = {
  thumbs_up: "thumbsup",
  thumbs_down: "thumbsdown",
  thinking: "thinking",
};

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

/**
 * GitLab adapter for Chat SDK.
 *
 * Handles comments on merge requests and issues. Top-level comments map to a
 * merge request or issue thread; replies, started threads, and diff comments
 * map to a discussion thread.
 *
 * @example
 * ```typescript
 * import { Chat } from "chat";
 * import { createGitLabAdapter } from "@chat-adapter/gitlab";
 * import { createMemoryState } from "@chat-adapter/state-memory";
 *
 * const bot = new Chat({
 *   userName: "my-bot",
 *   adapters: { gitlab: createGitLabAdapter() },
 *   state: createMemoryState(),
 * });
 * ```
 */
export class GitLabAdapter
  implements Adapter<GitLabThreadId, GitLabRawMessage>
{
  readonly name = "gitlab";

  protected readonly apiUrl: string;
  protected readonly token: string;
  protected readonly webhookSecret?: string;
  protected readonly webhookSigningKey?: Buffer;
  protected readonly webhookVerifier?: GitLabWebhookVerifier;
  protected readonly logger: Logger;
  protected readonly formatConverter = new GitLabFormatConverter();
  protected chat: ChatInstance | null = null;
  protected _botUserId: number | null;
  protected _userName: string;
  protected readonly hasExplicitUserName: boolean;

  /** Bot username used for @-mention detection. */
  get userName(): string {
    return this._userName;
  }

  /** Bot user ID (numeric, as a string) used for self-message detection. */
  get botUserId(): string | undefined {
    return this._botUserId?.toString();
  }

  constructor(config: GitLabAdapterConfig = {}) {
    const webhookVerifier = config.webhookVerifier;
    // A custom verifier takes precedence over both tokens and their env vars,
    // so an env-configured deployment can't silently shadow it.
    const webhookSecret = webhookVerifier
      ? undefined
      : (config.webhookSecret ?? process.env.GITLAB_WEBHOOK_SECRET);
    const webhookSigningToken = webhookVerifier
      ? undefined
      : (config.webhookSigningToken ??
        process.env.GITLAB_WEBHOOK_SIGNING_TOKEN);

    if (!(webhookSecret || webhookSigningToken || webhookVerifier)) {
      throw new ValidationError(
        "gitlab",
        "Webhook verification is required. Set GITLAB_WEBHOOK_SIGNING_TOKEN or GITLAB_WEBHOOK_SECRET, or provide webhookSigningToken, webhookSecret, or webhookVerifier in config."
      );
    }

    const token = config.token ?? process.env.GITLAB_TOKEN;
    if (!token) {
      throw new ValidationError(
        "gitlab",
        "Authentication is required. Set GITLAB_TOKEN or provide token in config."
      );
    }

    this.token = token;
    this.webhookSecret = webhookSecret;
    this.webhookSigningKey = webhookSigningToken
      ? decodeSigningToken(webhookSigningToken)
      : undefined;
    this.webhookVerifier = webhookVerifier;
    this.apiUrl = (
      config.apiUrl ??
      process.env.GITLAB_API_URL ??
      DEFAULT_API_URL
    ).replace(TRAILING_SLASH_PATTERN, "");
    this.logger = config.logger ?? new ConsoleLogger("info").child("gitlab");

    const userName = config.userName ?? process.env.GITLAB_BOT_USERNAME;
    this.hasExplicitUserName = !!userName;
    this._userName = userName ?? DEFAULT_USER_NAME;

    const envBotUserId = process.env.GITLAB_BOT_USER_ID
      ? Number.parseInt(process.env.GITLAB_BOT_USER_ID, 10)
      : undefined;
    this._botUserId =
      config.botUserId ??
      (envBotUserId !== undefined && !Number.isNaN(envBotUserId)
        ? envBotUserId
        : null);
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    if (this._botUserId === null || !this.hasExplicitUserName) {
      await this.detectBotUser();
    }
  }

  /**
   * Look up the token's user with `GET /user` to learn the bot's numeric ID
   * and, when no username is configured, its username. Best-effort: errors are
   * logged so they don't block initialization.
   */
  protected async detectBotUser(): Promise<void> {
    try {
      const user = await this.request<GitLabUser>("GET", "/user");
      if (this._botUserId === null) {
        this._botUserId = user.id;
      }
      if (!this.hasExplicitUserName && user.username) {
        this._userName = user.username;
      }
      this.logger.info("GitLab bot user detected", {
        botUserId: this._botUserId,
        userName: this._userName,
      });
    } catch (error) {
      this.logger.warn("Could not auto-detect GitLab bot user", { error });
    }
  }

  /**
   * Learn the bot's own user ID from a note it just created, so self-message
   * detection works even when `GET /user` failed during initialization.
   */
  protected captureBotUserId(user: GitLabUser | null | undefined): void {
    if (this._botUserId === null && typeof user?.id === "number") {
      this._botUserId = user.id;
      this.logger.info("GitLab bot user ID learned from posted note", {
        botUserId: this._botUserId,
      });
    }
  }

  // ===========================================================================
  // REST API
  // ===========================================================================

  /**
   * Call the GitLab REST API with the adapter's credentials.
   *
   * `path` is relative to the API base URL, for example
   * `/projects/42/merge_requests`. Use this for any GitLab API call that isn't
   * covered by the Chat SDK surface.
   *
   * @example
   * ```ts
   * const gitlab = bot.getAdapter("gitlab");
   * const pipelines = await gitlab.request("GET", "/projects/42/pipelines", {
   *   query: { ref: "main" },
   * });
   * ```
   */
  async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const response = await this.rawRequest(method, path, options);
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  /**
   * Fetch every page of a list endpoint by following GitLab's `x-next-page`
   * header, up to a fixed page cap.
   */
  protected async requestAll<T>(
    path: string,
    query: Record<string, string | number | undefined> = {}
  ): Promise<T[]> {
    const results: T[] = [];
    let page: string | null = "1";
    let pages = 0;
    while (page && pages < MAX_PAGES) {
      const response = await this.rawRequest("GET", path, {
        query: { ...query, per_page: 100, page },
      });
      results.push(...((await response.json()) as T[]));
      page = response.headers.get("x-next-page") || null;
      pages += 1;
    }
    return results;
  }

  protected async rawRequest(
    method: string,
    path: string,
    options: RequestOptions = {}
  ): Promise<Response> {
    const url = new URL(`${this.apiUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      accept: "application/json",
    };
    let body: FormData | string | undefined;
    if (options.body instanceof FormData) {
      body = options.body;
    } else if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await fetch(url, { method, headers, body });
    } catch (error) {
      throw new NetworkError(
        "gitlab",
        `GitLab API request failed: ${method} ${path}`,
        error instanceof Error ? error : undefined
      );
    }

    if (!response.ok) {
      await this.throwApiError(response, method, path);
    }
    return response;
  }

  protected async throwApiError(
    response: Response,
    method: string,
    path: string
  ): Promise<never> {
    const detail = await response.text().catch(() => "");
    this.logger.debug("GitLab API error", {
      method,
      path,
      status: response.status,
      detail,
    });
    switch (response.status) {
      case 401:
        throw new AuthenticationError(
          "gitlab",
          "GitLab rejected the access token. Check that GITLAB_TOKEN is valid and has the api scope."
        );
      case 403:
        throw new PermissionError("gitlab", `${method} ${path}`, "api");
      case 404:
        throw new ResourceNotFoundError("gitlab", "resource", path);
      case 429: {
        const retryAfter = Number.parseInt(
          response.headers.get("retry-after") ?? "",
          10
        );
        throw new AdapterRateLimitError(
          "gitlab",
          Number.isNaN(retryAfter) ? undefined : retryAfter
        );
      }
      default:
        throw new NetworkError(
          "gitlab",
          `GitLab API error ${response.status} for ${method} ${path}`
        );
    }
  }

  /** REST path segment for a merge request or issue. */
  protected noteablePath(
    projectId: number,
    noteableType: GitLabNoteableType,
    noteableIid: number
  ): string {
    const collection =
      noteableType === "merge_request" ? "merge_requests" : "issues";
    return `/projects/${projectId}/${collection}/${noteableIid}`;
  }

  // ===========================================================================
  // Webhooks
  // ===========================================================================

  /**
   * Handle an incoming webhook from GitLab.
   */
  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    const body = await request.text();
    const eventType = request.headers.get("x-gitlab-event");

    if (!(await this.verifyRequest(request, body))) {
      this.logger.debug("GitLab webhook verification failed", { eventType });
      return new Response("Invalid signature", { status: 401 });
    }

    let payload: GitLabNoteWebhookPayload | GitLabEmojiWebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      this.logger.error("GitLab webhook invalid JSON", { eventType });
      return new Response("Invalid JSON", { status: 400 });
    }

    if (eventType === "Note Hook" && payload.object_kind === "note") {
      this.handleNoteEvent(payload, options);
    } else if (eventType === "Emoji Hook" && payload.object_kind === "emoji") {
      this.handleEmojiEvent(payload, options);
    } else {
      this.logger.debug("Ignoring GitLab webhook event", { eventType });
    }

    return new Response("ok", { status: 200 });
  }

  /**
   * Verify a webhook request. A custom verifier takes precedence. Otherwise a
   * `webhook-signature` header is checked against the signing token, and the
   * `X-Gitlab-Token` header against the secret token.
   */
  protected async verifyRequest(
    request: Request,
    body: string
  ): Promise<boolean> {
    if (this.webhookVerifier) {
      try {
        return !!(await this.webhookVerifier(request, body));
      } catch (error) {
        this.logger.warn("GitLab webhook verifier rejected the request", {
          error,
        });
        return false;
      }
    }

    const signature = request.headers.get("webhook-signature");
    if (this.webhookSigningKey && signature) {
      return this.verifySignature(
        body,
        request.headers.get("webhook-id"),
        request.headers.get("webhook-timestamp"),
        signature
      );
    }

    if (this.webhookSecret) {
      return this.verifySecretToken(request.headers.get("x-gitlab-token"));
    }

    return false;
  }

  /**
   * Verify the `X-Gitlab-Token` header against the configured secret token.
   */
  protected verifySecretToken(token: string | null): boolean {
    if (!(this.webhookSecret && token)) {
      return false;
    }
    // Hash both values so the comparison is constant-time regardless of length.
    const expected = createHash("sha256").update(this.webhookSecret).digest();
    const received = createHash("sha256").update(token).digest();
    return timingSafeEqual(expected, received);
  }

  /**
   * Verify a Standard Webhooks `webhook-signature` header. The signature is an
   * HMAC-SHA256 over `{webhook-id}.{webhook-timestamp}.{body}`, and the
   * timestamp must be within five minutes of now.
   */
  protected verifySignature(
    body: string,
    messageId: string | null,
    timestamp: string | null,
    signatureHeader: string
  ): boolean {
    if (!(this.webhookSigningKey && messageId && timestamp)) {
      return false;
    }

    const timestampSeconds = Number.parseInt(timestamp, 10);
    if (
      Number.isNaN(timestampSeconds) ||
      Math.abs(Date.now() / 1000 - timestampSeconds) >
        SIGNATURE_TOLERANCE_SECONDS
    ) {
      return false;
    }

    const expected = Buffer.from(
      `v1,${createHmac("sha256", this.webhookSigningKey)
        .update(`${messageId}.${timestamp}.${body}`)
        .digest("base64")}`
    );

    return signatureHeader.split(" ").some((candidate) => {
      const received = Buffer.from(candidate);
      return (
        received.length === expected.length &&
        timingSafeEqual(received, expected)
      );
    });
  }

  /**
   * Handle a comment (`Note Hook`) event. Only newly created, public,
   * non-system comments on merge requests and issues are dispatched.
   */
  protected handleNoteEvent(
    payload: GitLabNoteWebhookPayload,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring comment");
      return;
    }

    const attrs = payload.object_attributes;
    if (attrs.action && attrs.action !== "create") {
      return;
    }
    if (attrs.system) {
      return;
    }
    // Never answer internal notes or comments on confidential issues: a reply
    // could expose their content to people who can't see the original.
    if (
      attrs.internal ||
      attrs.confidential ||
      payload.event_type === "confidential_note" ||
      payload.issue?.confidential
    ) {
      this.logger.debug("Ignoring internal or confidential GitLab note", {
        noteId: attrs.id,
      });
      return;
    }

    const noteable = this.resolveNoteable(
      attrs.noteable_type,
      payload.merge_request,
      payload.issue
    );
    if (!noteable) {
      this.logger.debug("Ignoring GitLab note on unsupported noteable", {
        noteableType: attrs.noteable_type,
      });
      return;
    }

    const note: GitLabNote = {
      id: attrs.id,
      body: attrs.note,
      author: toGitLabUser(payload.user),
      created_at: attrs.created_at,
      updated_at: attrs.updated_at,
      system: attrs.system,
      type: attrs.type ?? null,
      internal: attrs.internal,
      discussion_id: attrs.discussion_id,
      noteable_type: attrs.noteable_type,
      noteable_iid: noteable.iid,
    };

    const raw: GitLabRawMessage = {
      note,
      projectId: payload.project_id ?? payload.project.id,
      noteableType: noteable.type,
      noteableIid: noteable.iid,
      discussionId: threadDiscussionId(note),
    };

    if (payload.user.id === this._botUserId) {
      this.logger.debug("Ignoring message from self", { noteId: note.id });
      return;
    }

    const message = this.parseMessage(raw);
    this.chat.processMessage(this, message.threadId, message, options);
  }

  /**
   * Handle an emoji (`Emoji Hook`) event on a merge request or issue comment.
   */
  protected handleEmojiEvent(
    payload: GitLabEmojiWebhookPayload,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring reaction");
      return;
    }

    const attrs = payload.object_attributes;
    const note = payload.note;
    if (attrs.awardable_type !== "Note" || !note) {
      return;
    }
    // Same rule as comments: never react to internal notes or confidential
    // issues, where a handler's public reply could expose their content.
    if (note.internal || note.confidential || payload.issue?.confidential) {
      return;
    }

    const noteable = this.resolveNoteable(
      note.noteable_type,
      payload.merge_request,
      payload.issue
    );
    if (!noteable) {
      return;
    }

    if (payload.user.id === this._botUserId) {
      return;
    }

    const threadId = this.encodeThreadId({
      projectId: payload.project_id ?? payload.project.id,
      noteableType: noteable.type,
      noteableIid: noteable.iid,
      discussionId: note.type ? note.discussion_id : undefined,
    });

    const task = this.chat.processReaction(
      {
        adapter: this,
        added: attrs.action === "award",
        emoji: defaultEmojiResolver.fromSlack(attrs.name),
        messageId: String(note.id),
        raw: payload,
        rawEmoji: attrs.name,
        threadId,
        user: this.parseAuthor(toGitLabUser(payload.user)),
      },
      options
    );
    // processReaction already logs handler errors; keep the returned promise
    // from surfacing as an unhandled rejection.
    Promise.resolve(task).catch(() => undefined);
  }

  protected resolveNoteable(
    noteableType: string,
    mergeRequest: { iid: number } | undefined,
    issue: { iid: number } | undefined
  ): { iid: number; type: GitLabNoteableType } | null {
    if (noteableType === "MergeRequest" && mergeRequest) {
      return { iid: mergeRequest.iid, type: "merge_request" };
    }
    if (noteableType === "Issue" && issue) {
      return { iid: issue.iid, type: "issue" };
    }
    return null;
  }

  // ===========================================================================
  // Parsing
  // ===========================================================================

  /**
   * Parse a raw GitLab message into a normalized Message.
   */
  parseMessage(raw: GitLabRawMessage): Message<GitLabRawMessage> {
    const { note } = raw;
    const threadId = this.encodeThreadId({
      projectId: raw.projectId,
      noteableType: raw.noteableType,
      noteableIid: raw.noteableIid,
      discussionId: raw.discussionId,
    });
    const edited = note.created_at !== note.updated_at;

    return new Message({
      id: note.id.toString(),
      threadId,
      text: this.formatConverter.extractPlainText(note.body),
      formatted: this.formatConverter.toAst(note.body),
      raw,
      author: this.parseAuthor(note.author),
      metadata: {
        dateSent: parseGitLabDate(note.created_at),
        edited,
        editedAt: edited ? parseGitLabDate(note.updated_at) : undefined,
      },
      attachments: [],
    });
  }

  /**
   * Parse a GitLab user into an Author.
   */
  protected parseAuthor(user: GitLabUser): Author {
    return {
      userId: user.id.toString(),
      userName: user.username,
      fullName: user.name || user.username,
      isBot:
        user.bot === true || PROJECT_BOT_USERNAME_PATTERN.test(user.username),
      isMe: user.id === this._botUserId,
    };
  }

  protected toRawMessage(
    note: GitLabNote,
    thread: GitLabThreadId
  ): GitLabRawMessage {
    return {
      note,
      projectId: thread.projectId,
      noteableType: thread.noteableType,
      noteableIid: thread.noteableIid,
      discussionId: thread.discussionId,
    };
  }

  // ===========================================================================
  // Messages
  // ===========================================================================

  /**
   * Render a postable message to a GitLab comment body.
   */
  protected renderBody(message: AdapterPostableMessage): string {
    const card = extractCard(message);
    const body = card
      ? cardToGitLabMarkdown(card)
      : this.formatConverter.renderPostable(message);
    return convertEmojiPlaceholders(body, "gitlab");
  }

  /**
   * Upload files to the project and return their markdown references.
   */
  protected async uploadFiles(
    projectId: number,
    files: FileUpload[]
  ): Promise<string[]> {
    const references: string[] = [];
    for (const file of files) {
      const form = new FormData();
      const blob =
        file.data instanceof Blob
          ? file.data
          : new Blob([new Uint8Array(file.data)], {
              type: file.mimeType ?? "application/octet-stream",
            });
      form.append("file", blob, file.filename);
      const upload = await this.request<{ markdown: string }>(
        "POST",
        `/projects/${projectId}/uploads`,
        { body: form }
      );
      references.push(upload.markdown);
    }
    return references;
  }

  /**
   * Post a message to a thread. Top-level threads get a new comment on the
   * merge request or issue; discussion threads get a reply in the discussion.
   */
  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<GitLabRawMessage>> {
    const thread = this.decodeThreadId(threadId);
    const { projectId, noteableType, noteableIid, discussionId } = thread;

    let body = this.renderBody(message);
    const files = extractFiles(message);
    if (files.length > 0) {
      const references = await this.uploadFiles(projectId, files);
      body = [body, ...references].filter(Boolean).join("\n\n");
    }

    const basePath = this.noteablePath(projectId, noteableType, noteableIid);
    const path = discussionId
      ? `${basePath}/discussions/${discussionId}/notes`
      : `${basePath}/notes`;
    const note = await this.request<GitLabNote>("POST", path, {
      body: { body },
    });

    this.captureBotUserId(note.author);

    return {
      id: note.id.toString(),
      threadId,
      raw: this.toRawMessage(note, thread),
    };
  }

  /**
   * Edit an existing comment.
   */
  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<GitLabRawMessage>> {
    const thread = this.decodeThreadId(threadId);
    const note = await this.request<GitLabNote>(
      "PUT",
      `${this.noteablePath(thread.projectId, thread.noteableType, thread.noteableIid)}/notes/${messageId}`,
      { body: { body: this.renderBody(message) } }
    );

    return {
      id: note.id.toString(),
      threadId,
      raw: this.toRawMessage(note, thread),
    };
  }

  /**
   * Stream a message by accumulating text and posting once.
   *
   * GitLab rejects empty comment bodies, so the default post-then-edit
   * fallback can't post a placeholder before the first token arrives.
   */
  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    _options?: StreamOptions
  ): Promise<RawMessage<GitLabRawMessage>> {
    let text = "";
    for await (const chunk of textStream) {
      if (typeof chunk === "string") {
        text += chunk;
      } else if (chunk.type === "markdown_text") {
        text += chunk.text;
      }
    }
    return this.postMessage(threadId, { markdown: text });
  }

  /**
   * Delete a comment.
   */
  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const { projectId, noteableType, noteableIid } =
      this.decodeThreadId(threadId);
    await this.request<void>(
      "DELETE",
      `${this.noteablePath(projectId, noteableType, noteableIid)}/notes/${messageId}`
    );
  }

  /**
   * Add an emoji reaction to a comment.
   */
  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const { projectId, noteableType, noteableIid } =
      this.decodeThreadId(threadId);
    await this.request<GitLabAwardEmoji>(
      "POST",
      `${this.noteablePath(projectId, noteableType, noteableIid)}/notes/${messageId}/award_emoji`,
      { body: { name: this.toGitLabEmoji(emoji) } }
    );
  }

  /**
   * Remove the bot's emoji reaction from a comment.
   */
  async removeReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const { projectId, noteableType, noteableIid } =
      this.decodeThreadId(threadId);
    const name = this.toGitLabEmoji(emoji);
    const awardPath = `${this.noteablePath(projectId, noteableType, noteableIid)}/notes/${messageId}/award_emoji`;

    if (this._botUserId === null) {
      await this.detectBotUser();
    }

    const awards = await this.requestAll<GitLabAwardEmoji>(awardPath);
    const award = awards.find(
      (a) => a.name === name && a.user?.id === this._botUserId
    );
    if (award) {
      await this.request<void>("DELETE", `${awardPath}/${award.id}`);
    }
  }

  /**
   * Convert an SDK emoji to a GitLab award emoji name.
   */
  protected toGitLabEmoji(emoji: EmojiValue | string): string {
    const name = typeof emoji === "string" ? emoji : emoji.name;
    return GITLAB_EMOJI_NAMES[name] ?? defaultEmojiResolver.toSlack(name);
  }

  /**
   * Show typing indicator (no-op for GitLab).
   */
  async startTyping(_threadId: string, _status?: string): Promise<void> {
    // GitLab doesn't support typing indicators
  }

  /**
   * Fetch comments in a thread, oldest first. Merge request and issue threads
   * return top-level comments; discussion threads return the discussion's
   * comments. System notes are excluded.
   */
  async fetchMessages(
    threadId: string,
    options?: FetchOptions
  ): Promise<FetchResult<GitLabRawMessage>> {
    const thread = this.decodeThreadId(threadId);
    const { projectId, noteableType, noteableIid, discussionId } = thread;
    const limit = options?.limit ?? 100;
    const direction = options?.direction ?? "backward";
    const basePath = this.noteablePath(projectId, noteableType, noteableIid);

    let notes: GitLabNote[];
    if (discussionId) {
      const discussion = await this.request<GitLabDiscussion>(
        "GET",
        `${basePath}/discussions/${discussionId}`
      );
      notes = discussion.notes;
    } else {
      const discussions = await this.requestAll<GitLabDiscussion>(
        `${basePath}/discussions`
      );
      notes = discussions
        .filter((discussion) => discussion.individual_note)
        .flatMap((discussion) => discussion.notes);
    }

    let messages = notes
      .filter((note) => !note.system)
      .map((note) => this.parseMessage(this.toRawMessage(note, thread)));

    messages.sort(
      (a, b) => a.metadata.dateSent.getTime() - b.metadata.dateSent.getTime()
    );

    if (messages.length > limit) {
      messages =
        direction === "backward"
          ? messages.slice(-limit)
          : messages.slice(0, limit);
    }

    return { messages, nextCursor: undefined };
  }

  /**
   * Fetch a single comment by ID.
   */
  async fetchMessage(
    threadId: string,
    messageId: string
  ): Promise<Message<GitLabRawMessage> | null> {
    const thread = this.decodeThreadId(threadId);
    try {
      const note = await this.request<GitLabNote>(
        "GET",
        `${this.noteablePath(thread.projectId, thread.noteableType, thread.noteableIid)}/notes/${messageId}`
      );
      return this.parseMessage(this.toRawMessage(note, thread));
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Fetch thread metadata from the merge request or issue.
   */
  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { projectId, noteableType, noteableIid, discussionId } =
      this.decodeThreadId(threadId);
    const noteable = await this.request<GitLabMergeRequest | GitLabIssue>(
      "GET",
      this.noteablePath(projectId, noteableType, noteableIid)
    );
    const reference = noteableType === "merge_request" ? "!" : "#";

    return {
      id: threadId,
      channelId: `gitlab:${projectId}`,
      channelName: noteable.references?.full ?? `${reference}${noteableIid}`,
      isDM: false,
      metadata: {
        projectId,
        noteableType,
        noteableIid,
        discussionId,
        title: noteable.title,
        state: noteable.state,
        webUrl: noteable.web_url,
      },
    };
  }

  /**
   * Encode platform data into a thread ID string.
   *
   * Thread ID formats:
   * - Merge request comments: `gitlab:{projectId}:mr:{iid}`
   * - Issue comments: `gitlab:{projectId}:issue:{iid}`
   * - Threaded discussion: `gitlab:{projectId}:{mr|issue}:{iid}:{discussionId}`
   */
  encodeThreadId(platformData: GitLabThreadId): string {
    const { projectId, noteableType, noteableIid, discussionId } = platformData;
    const kind = noteableType === "merge_request" ? "mr" : "issue";
    const base = `gitlab:${projectId}:${kind}:${noteableIid}`;
    return discussionId ? `${base}:${discussionId}` : base;
  }

  /**
   * Decode a thread ID string back to platform data.
   */
  decodeThreadId(threadId: string): GitLabThreadId {
    const match = threadId.match(THREAD_ID_PATTERN);
    if (!match) {
      throw new ValidationError(
        "gitlab",
        `Invalid GitLab thread ID: ${threadId}`
      );
    }
    return {
      projectId: Number.parseInt(match[1], 10),
      noteableType: match[2] === "mr" ? "merge_request" : "issue",
      noteableIid: Number.parseInt(match[3], 10),
      ...(match[4] ? { discussionId: match[4] } : {}),
    };
  }

  /**
   * Derive the channel (project) ID from a thread ID.
   * `gitlab:{projectId}:mr:{iid}...` -> `gitlab:{projectId}`
   */
  channelIdFromThreadId(threadId: string): string {
    return `gitlab:${this.decodeThreadId(threadId).projectId}`;
  }

  protected decodeChannelId(channelId: string): number {
    const match = channelId.match(CHANNEL_ID_PATTERN);
    if (!match) {
      throw new ValidationError(
        "gitlab",
        `Invalid GitLab channel ID: ${channelId}`
      );
    }
    return Number.parseInt(match[1], 10);
  }

  /**
   * List open merge requests in a project as threads, most recently updated
   * first. Issue threads are created reactively from webhooks.
   */
  async listThreads(
    channelId: string,
    options: ListThreadsOptions = {}
  ): Promise<ListThreadsResult<GitLabRawMessage>> {
    const projectId = this.decodeChannelId(channelId);
    const limit = options.limit || 30;
    const page = options.cursor ? Number.parseInt(options.cursor, 10) : 1;

    const mergeRequests = await this.request<GitLabMergeRequest[]>(
      "GET",
      `/projects/${projectId}/merge_requests`,
      {
        query: {
          state: "opened",
          order_by: "updated_at",
          sort: "desc",
          per_page: limit,
          page,
        },
      }
    );

    const threads = mergeRequests.map((mr) => {
      const thread: GitLabThreadId = {
        projectId,
        noteableType: "merge_request",
        noteableIid: mr.iid,
      };
      const rootMessage = this.parseMessage(
        this.toRawMessage(
          {
            id: mr.id,
            body: mr.description || mr.title,
            author: mr.author,
            created_at: mr.created_at,
            updated_at: mr.updated_at,
            system: false,
            type: null,
          },
          thread
        )
      );
      return {
        id: this.encodeThreadId(thread),
        rootMessage,
        lastReplyAt: parseGitLabDate(mr.updated_at),
      };
    });

    const nextCursor =
      mergeRequests.length === limit ? String(page + 1) : undefined;
    return { threads, nextCursor };
  }

  /**
   * Fetch GitLab project info as channel metadata.
   */
  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const projectId = this.decodeChannelId(channelId);
    const project = await this.request<GitLabProject>(
      "GET",
      `/projects/${projectId}`
    );

    return {
      id: channelId,
      name: project.path_with_namespace,
      isDM: false,
      metadata: {
        projectId,
        description: project.description,
        visibility: project.visibility,
        defaultBranch: project.default_branch,
        openIssuesCount: project.open_issues_count,
        webUrl: project.web_url,
      },
    };
  }

  /**
   * Render formatted content to GitLab markdown.
   */
  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  /**
   * Look up a GitLab user by numeric ID.
   */
  async getUser(userId: string): Promise<UserInfo | null> {
    try {
      const user = await this.request<GitLabUser>("GET", `/users/${userId}`);
      return {
        avatarUrl: user.avatar_url ?? undefined,
        email: user.public_email || undefined,
        fullName: user.name || user.username,
        isBot:
          user.bot === true || PROJECT_BOT_USERNAME_PATTERN.test(user.username),
        userId: String(user.id),
        userName: user.username,
      };
    } catch (error) {
      this.logger.debug("Failed to fetch user", { userId, error });
      return null;
    }
  }

  /**
   * Resolve the merge request or issue a comment belongs to.
   */
  async fetchSubject(raw: GitLabRawMessage): Promise<MessageSubject | null> {
    const { projectId, noteableType, noteableIid } = raw;
    try {
      const data = await this.request<GitLabMergeRequest | GitLabIssue>(
        "GET",
        this.noteablePath(projectId, noteableType, noteableIid)
      );
      const assignee = data.assignees?.[0];
      return {
        type: noteableType,
        id: String(data.iid),
        title: data.title,
        description: data.description ?? undefined,
        status: data.state,
        url: data.web_url,
        author: data.author
          ? { id: String(data.author.id), name: data.author.username }
          : undefined,
        assignee: assignee
          ? { id: String(assignee.id), name: assignee.username }
          : undefined,
        labels: data.labels,
        raw: data,
      };
    } catch (error) {
      this.logger.debug("Failed to fetch subject", {
        projectId,
        noteableType,
        noteableIid,
        error,
      });
      return null;
    }
  }
}

/**
 * Decode a GitLab signing token (`whsec_` followed by base64) to the raw
 * HMAC key.
 */
function decodeSigningToken(token: string): Buffer {
  const encoded = token.startsWith(SIGNING_TOKEN_PREFIX)
    ? token.slice(SIGNING_TOKEN_PREFIX.length)
    : token;
  const key = Buffer.from(encoded, "base64");
  if (key.length === 0) {
    throw new ValidationError(
      "gitlab",
      "webhookSigningToken is not a valid GitLab signing token. Copy the whsec_ value shown when you generate the token."
    );
  }
  return key;
}

/**
 * Parse a GitLab timestamp. Accepts ISO 8601 and the legacy
 * `YYYY-MM-DD HH:MM:SS UTC` format used by older webhook payloads.
 */
function parseGitLabDate(value: string): Date {
  const legacy = value.match(LEGACY_DATE_PATTERN);
  return new Date(legacy ? `${legacy[1]}T${legacy[2]}Z` : value);
}

/**
 * The discussion a note's thread is keyed on. Top-level comments (note type
 * `null`) belong to the merge request or issue thread instead.
 */
function threadDiscussionId(note: GitLabNote): string | undefined {
  return note.type ? note.discussion_id : undefined;
}

function toGitLabUser(user: GitLabWebhookUser): GitLabUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    avatar_url: user.avatar_url,
    email: user.email,
  };
}

/**
 * Create a new GitLab adapter instance.
 *
 * @example
 * ```typescript
 * const bot = new Chat({
 *   userName: "my-bot",
 *   adapters: {
 *     gitlab: createGitLabAdapter({
 *       token: process.env.GITLAB_TOKEN!,
 *       webhookSecret: process.env.GITLAB_WEBHOOK_SECRET!,
 *     }),
 *   },
 *   state: createMemoryState(),
 * });
 * ```
 */
export function createGitLabAdapter(
  config?: GitLabAdapterConfig
): GitLabAdapter {
  return new GitLabAdapter(config);
}
