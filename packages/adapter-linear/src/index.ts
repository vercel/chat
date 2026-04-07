import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  AdapterError,
  AuthenticationError,
  extractCard,
  ValidationError,
} from "@chat-adapter/shared";
import type { LinearFetch, User } from "@linear/sdk";
import { LinearClient } from "@linear/sdk";
import type {
  Adapter,
  AdapterPostableMessage,
  Author,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Logger,
  RawMessage,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import { ConsoleLogger, convertEmojiPlaceholders, Message } from "chat";
import { cardToLinearMarkdown } from "./cards";
import { LinearFormatConverter } from "./markdown";
import type {
  CommentWebhookPayload,
  LinearAdapterAutoConfig,
  LinearAdapterConfig,
  LinearAdapterMultiTenantConfig,
  LinearClientCredentialsConfig,
  LinearCommentData,
  LinearInstallation,
  LinearOAuthCallbackOptions,
  LinearRawMessage,
  LinearThreadId,
  LinearWebhookActor,
  LinearWebhookPayload,
  ReactionWebhookPayload,
} from "./types";

const COMMENT_THREAD_PATTERN = /^([^:]+):c:([^:]+)$/;
const INSTALLATION_KEY_PREFIX = "linear:installation";
const INSTALLATION_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const DEFAULT_CLIENT_CREDENTIAL_SCOPES = [
  "read",
  "write",
  "comments:create",
  "issues:create",
];

function parseEnvClientCredentialScopes(value?: string): string[] | undefined {
  if (!value) {
    return undefined;
  }

  return value
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

interface LinearOAuthTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
}

interface LinearRequestContext {
  accessToken: string;
  botUserId: string;
  client: LinearClient;
  organizationId: string;
}

// Re-export types
export type {
  LinearAdapterAPIKeyConfig,
  LinearAdapterClientCredentialsConfig,
  LinearAdapterConfig,
  LinearAdapterMultiTenantConfig,
  LinearAdapterOAuthConfig,
  LinearClientCredentialsConfig,
  LinearInstallation,
  LinearOAuthCallbackOptions,
  LinearRawMessage,
  LinearThreadId,
} from "./types";

/**
 * Linear adapter for chat SDK.
 *
 * Supports comment threads on Linear issues.
 * Authentication via personal API key or OAuth access token.
 *
 * @example API Key auth
 * ```typescript
 * import { Chat } from "chat";
 * import { createLinearAdapter } from "@chat-adapter/linear";
 * import { MemoryState } from "@chat-adapter/state-memory";
 *
 * const chat = new Chat({
 *   userName: "my-bot",
 *   adapters: {
 *     linear: createLinearAdapter({
 *       apiKey: process.env.LINEAR_API_KEY!,
 *       webhookSecret: process.env.LINEAR_WEBHOOK_SECRET!,
 *       userName: "my-bot",
 *       logger: console,
 *     }),
 *   },
 *   state: new MemoryState(),
 *   logger: "info",
 * });
 * ```
 *
 * @example OAuth auth
 * ```typescript
 * const chat = new Chat({
 *   userName: "my-bot",
 *   adapters: {
 *     linear: createLinearAdapter({
 *       accessToken: process.env.LINEAR_ACCESS_TOKEN!,
 *       webhookSecret: process.env.LINEAR_WEBHOOK_SECRET!,
 *       userName: "my-bot",
 *       logger: console,
 *     }),
 *   },
 *   state: new MemoryState(),
 *   logger: "info",
 * });
 * ```
 */
export class LinearAdapter
  implements Adapter<LinearThreadId, LinearRawMessage>
{
  readonly name = "linear";
  readonly userName: string;

  private readonly webhookSecret: string;
  private chat: ChatInstance | null = null;
  private readonly logger: Logger;
  private defaultBotUserId: string | null = null;
  private defaultOrganizationId: string | null = null;
  private readonly formatConverter = new LinearFormatConverter();
  private readonly requestContext =
    new AsyncLocalStorage<LinearRequestContext>();

  private defaultClient: LinearClient | null = null;
  private readonly oauthClientId: string | null = null;
  private readonly oauthClientSecret: string | null = null;
  private readonly clientCredentials: {
    clientId: string;
    clientSecret: string;
    scopes: string[];
  } | null = null;
  private accessTokenExpiry: number | null = null;

  /** Bot user ID used for self-message detection */
  get botUserId(): string | undefined {
    return (
      this.requestContext.getStore()?.botUserId ??
      this.defaultBotUserId ??
      undefined
    );
  }

  constructor(config: LinearAdapterConfig = {} as LinearAdapterAutoConfig) {
    const webhookSecret =
      config.webhookSecret ?? process.env.LINEAR_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new ValidationError(
        "linear",
        "webhookSecret is required. Set LINEAR_WEBHOOK_SECRET or provide it in config."
      );
    }
    this.webhookSecret = webhookSecret;
    this.logger = config.logger ?? new ConsoleLogger("info").child("linear");
    this.userName =
      config.userName ?? process.env.LINEAR_BOT_USERNAME ?? "linear-bot";

    if ("apiKey" in config && config.apiKey) {
      this.defaultClient = new LinearClient({ apiKey: config.apiKey });
      return;
    }

    if ("accessToken" in config && config.accessToken) {
      this.defaultClient = new LinearClient({
        accessToken: config.accessToken,
      });
      return;
    }

    if ("clientCredentials" in config && config.clientCredentials) {
      const normalized = this.normalizeClientCredentials(
        config.clientCredentials,
        "config"
      );
      this.clientCredentials = normalized;
      return;
    }

    if ("clientId" in config || "clientSecret" in config) {
      const oauthConfig = config as LinearAdapterMultiTenantConfig;
      if (!(oauthConfig.clientId && oauthConfig.clientSecret)) {
        throw new ValidationError(
          "linear",
          "clientId and clientSecret are required together for multi-tenant OAuth."
        );
      }

      this.oauthClientId = oauthConfig.clientId;
      this.oauthClientSecret = oauthConfig.clientSecret;
      return;
    }

    const apiKey = process.env.LINEAR_API_KEY;
    if (apiKey) {
      this.defaultClient = new LinearClient({ apiKey });
      return;
    }

    const accessToken = process.env.LINEAR_ACCESS_TOKEN;
    if (accessToken) {
      this.defaultClient = new LinearClient({ accessToken });
      return;
    }

    const clientCredentialsClientId =
      process.env.LINEAR_CLIENT_CREDENTIALS_CLIENT_ID;
    const clientCredentialsClientSecret =
      process.env.LINEAR_CLIENT_CREDENTIALS_CLIENT_SECRET;
    if (clientCredentialsClientId && clientCredentialsClientSecret) {
      this.clientCredentials = this.normalizeClientCredentials(
        {
          clientId: clientCredentialsClientId,
          clientSecret: clientCredentialsClientSecret,
          scopes: parseEnvClientCredentialScopes(
            process.env.LINEAR_CLIENT_CREDENTIALS_SCOPES
          ),
        },
        "env"
      );
      return;
    }

    const oauthClientId = process.env.LINEAR_CLIENT_ID;
    const oauthClientSecret = process.env.LINEAR_CLIENT_SECRET;
    if (oauthClientId && oauthClientSecret) {
      this.oauthClientId = oauthClientId;
      this.oauthClientSecret = oauthClientSecret;
      return;
    }

    throw new ValidationError(
      "linear",
      "Authentication is required. Set LINEAR_API_KEY, LINEAR_ACCESS_TOKEN, LINEAR_CLIENT_CREDENTIALS_CLIENT_ID/LINEAR_CLIENT_CREDENTIALS_CLIENT_SECRET, or LINEAR_CLIENT_ID/LINEAR_CLIENT_SECRET, or provide auth in config."
    );
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    // For client credentials mode, fetch an access token first
    if (this.clientCredentials) {
      await this.refreshClientCredentialsToken();
    }

    if (this.defaultClient) {
      try {
        const identity = await this.fetchClientIdentity(this.defaultClient);
        this.defaultBotUserId = identity.botUserId;
        this.defaultOrganizationId = identity.organizationId;
        this.logger.info("Linear auth completed", {
          botUserId: this.defaultBotUserId,
          displayName: identity.displayName,
          organizationId: this.defaultOrganizationId,
        });
      } catch (error) {
        this.logger.warn("Could not fetch Linear bot user ID", { error });
      }
    } else if (this.isMultiTenantMode()) {
      this.logger.info("Linear adapter initialized in multi-tenant mode");
    }
  }

  private normalizeClientCredentials(
    clientCredentials: LinearClientCredentialsConfig,
    source: "config" | "env"
  ) {
    if (!(clientCredentials.clientId && clientCredentials.clientSecret)) {
      throw new ValidationError(
        "linear",
        `clientCredentials.clientId and clientCredentials.clientSecret are required in ${source}.`
      );
    }

    return {
      clientId: clientCredentials.clientId,
      clientSecret: clientCredentials.clientSecret,
      scopes: clientCredentials.scopes ?? DEFAULT_CLIENT_CREDENTIAL_SCOPES,
    };
  }

  private getClient(): LinearClient {
    const context = this.requestContext.getStore();
    if (context?.client) {
      return context.client;
    }

    if (this.defaultClient) {
      return this.defaultClient;
    }

    throw new AuthenticationError(
      "linear",
      "No Linear access token available. In multi-tenant mode, ensure the webhook is being processed or use withInstallation()."
    );
  }

  private getOrganizationId(): string {
    const organizationId =
      this.requestContext.getStore()?.organizationId ??
      this.defaultOrganizationId;

    if (!organizationId) {
      throw new AuthenticationError(
        "linear",
        "No Linear organization ID available. Ensure the adapter has been initialized or use withInstallation()."
      );
    }

    return organizationId;
  }

  private isMultiTenantMode(): boolean {
    return Boolean(this.oauthClientId && this.oauthClientSecret);
  }

  private installationKey(organizationId: string): string {
    return `${INSTALLATION_KEY_PREFIX}:${organizationId}`;
  }

  async setInstallation(
    organizationId: string,
    installation: LinearInstallation
  ): Promise<void> {
    if (!this.chat) {
      throw new ValidationError(
        "linear",
        "Adapter not initialized. Ensure chat.initialize() has been called first."
      );
    }

    await this.chat
      .getState()
      .set(this.installationKey(organizationId), installation);
    this.logger.info("Linear installation saved", { organizationId });
  }

  async getInstallation(
    organizationId: string
  ): Promise<LinearInstallation | null> {
    if (!this.chat) {
      throw new ValidationError(
        "linear",
        "Adapter not initialized. Ensure chat.initialize() has been called first."
      );
    }

    const installation = await this.chat
      .getState()
      .get<LinearInstallation>(this.installationKey(organizationId));

    return installation ?? null;
  }

  async deleteInstallation(organizationId: string): Promise<void> {
    if (!this.chat) {
      throw new ValidationError(
        "linear",
        "Adapter not initialized. Ensure chat.initialize() has been called first."
      );
    }

    await this.chat.getState().delete(this.installationKey(organizationId));
    this.logger.info("Linear installation deleted", { organizationId });
  }

  /**
   * Handle the Linear OAuth callback.
   * Accepts the incoming request, extracts the authorization code,
   * exchanges it for tokens, and saves the installation.
   */
  async handleOAuthCallback(
    request: Request,
    options: LinearOAuthCallbackOptions
  ): Promise<{ installation: LinearInstallation; organizationId: string }> {
    if (!(this.oauthClientId && this.oauthClientSecret)) {
      throw new ValidationError(
        "linear",
        "clientId and clientSecret are required for OAuth. Pass them in createLinearAdapter()."
      );
    }

    if (!options.redirectUri) {
      throw new ValidationError(
        "linear",
        "redirectUri is required for handleOAuthCallback()."
      );
    }

    const url = new URL(request.url);
    const error = url.searchParams.get("error");
    if (error) {
      const description = url.searchParams.get("error_description");
      throw new AuthenticationError(
        "linear",
        `Linear OAuth failed: ${description ? `${error} - ${description}` : error}`
      );
    }

    const code = url.searchParams.get("code");
    if (!code) {
      throw new ValidationError(
        "linear",
        "Missing 'code' query parameter in OAuth callback request."
      );
    }

    const token = await this.fetchOAuthToken(
      new URLSearchParams({
        code,
        redirect_uri: options.redirectUri,
        client_id: this.oauthClientId,
        client_secret: this.oauthClientSecret,
        grant_type: "authorization_code",
      }),
      "Failed to exchange Linear OAuth code"
    );

    const client = new LinearClient({ accessToken: token.access_token });
    const identity = await this.fetchClientIdentity(client);
    const installation: LinearInstallation = {
      accessToken: token.access_token,
      botUserId: identity.botUserId,
      expiresAt: this.calculateExpiry(token.expires_in),
      organizationId: identity.organizationId,
      refreshToken: token.refresh_token,
    };

    await this.setInstallation(identity.organizationId, installation);

    return { organizationId: identity.organizationId, installation };
  }

  /**
   * Run a function with a specific installation in context.
   * Use this for operations outside webhook handling (cron jobs, workflows).
   */
  async withInstallation<T>(
    organizationId: string,
    fn: () => Promise<T> | T
  ): Promise<T> {
    const installation = await this.requireInstallation(organizationId);
    const context: LinearRequestContext = {
      accessToken: installation.accessToken,
      botUserId: installation.botUserId,
      client: new LinearClient({ accessToken: installation.accessToken }),
      organizationId: installation.organizationId,
    };

    return await this.requestContext.run(context, async () => await fn());
  }

  private async fetchClientIdentity(client: LinearClient): Promise<{
    botUserId: string;
    displayName: string;
    organizationId: string;
  }> {
    const result = await client.client.rawRequest<
      {
        viewer: {
          id: string;
          displayName: string;
          organization: {
            id: string;
          };
        };
      },
      Record<string, never>
    >(/* GraphQL */ `
        query LinearAdapterViewerOrganization {
          viewer {
            id
            displayName
            organization {
              id
            }
          }
        }
      `);

    if (!result.data) {
      throw new AuthenticationError(
        "linear",
        "Failed to resolve client identity for Linear installation."
      );
    }

    return {
      botUserId: result.data.viewer.id,
      displayName: result.data.viewer.displayName,
      organizationId: result.data.viewer.organization.id,
    };
  }

  private calculateExpiry(expiresIn?: number): number | null {
    return typeof expiresIn === "number" ? Date.now() + expiresIn * 1000 : null;
  }

  private async fetchOAuthToken(
    body: URLSearchParams,
    errorMessage: string
  ): Promise<LinearOAuthTokenResponse> {
    const response = await fetch("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new AuthenticationError(
        "linear",
        `${errorMessage}: ${response.status} ${errorBody}`
      );
    }

    return (await response.json()) as LinearOAuthTokenResponse;
  }

  private async refreshInstallation(
    installation: LinearInstallation
  ): Promise<LinearInstallation> {
    if (
      !(
        installation.refreshToken &&
        this.oauthClientId &&
        this.oauthClientSecret
      )
    ) {
      return installation;
    }

    if (
      installation.expiresAt !== null &&
      installation.expiresAt > Date.now() + INSTALLATION_REFRESH_BUFFER_MS
    ) {
      return installation;
    }

    const token = await this.fetchOAuthToken(
      new URLSearchParams({
        refresh_token: installation.refreshToken,
        grant_type: "refresh_token",
        client_id: this.oauthClientId,
        client_secret: this.oauthClientSecret,
      }),
      "Failed to refresh Linear OAuth token"
    );

    const refreshedInstallation: LinearInstallation = {
      ...installation,
      accessToken: token.access_token,
      expiresAt: this.calculateExpiry(token.expires_in),
      refreshToken: token.refresh_token ?? installation.refreshToken,
    };

    await this.setInstallation(
      installation.organizationId,
      refreshedInstallation
    );
    return refreshedInstallation;
  }

  private async requireInstallation(
    organizationId: string
  ): Promise<LinearInstallation> {
    const installation = await this.getInstallation(organizationId);
    if (!installation) {
      throw new AuthenticationError(
        "linear",
        `No installation found for organization ${organizationId}`
      );
    }

    return await this.refreshInstallation(installation);
  }

  /**
   * Fetch a new access token using client credentials grant.
   * The token is valid for 30 days. The adapter auto-refreshes on 401.
   *
   * @see https://linear.app/developers/oauth-2-0-authentication#client-credentials-tokens
   */
  private async refreshClientCredentialsToken(): Promise<void> {
    if (!this.clientCredentials) {
      return;
    }

    const { clientId, clientSecret, scopes } = this.clientCredentials;
    const data = await this.fetchOAuthToken(
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: scopes.join(","),
      }),
      "Failed to fetch Linear client credentials token"
    );

    this.defaultClient = new LinearClient({ accessToken: data.access_token });

    // Track expiry so we can proactively refresh (with 1 hour buffer)
    this.accessTokenExpiry =
      typeof data.expires_in === "number"
        ? Date.now() + data.expires_in * 1000 - 3600000
        : null;

    this.logger.info("Linear client credentials token obtained", {
      expiresIn:
        typeof data.expires_in === "number"
          ? `${Math.round(data.expires_in / 86400)} days`
          : "unknown",
    });
  }

  /**
   * Ensure the client credentials token is still valid. Refresh if expired.
   */
  private async ensureValidToken(): Promise<void> {
    if (this.requestContext.getStore()) {
      return;
    }

    if (
      this.clientCredentials &&
      this.accessTokenExpiry &&
      Date.now() > this.accessTokenExpiry
    ) {
      this.logger.info("Linear access token expired, refreshing...");
      await this.refreshClientCredentialsToken();
    }
  }

  /**
   * Handle incoming webhook from Linear.
   *
   * @see https://linear.app/developers/webhooks
   */
  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    const body = await request.text();
    this.logger.debug("Linear webhook raw body", {
      body: body.substring(0, 500),
    });

    // Verify request signature (Linear-Signature header)
    // @see https://linear.app/developers/webhooks#securing-webhooks
    const signature = request.headers.get("linear-signature");
    if (!this.verifySignature(body, signature)) {
      return new Response("Invalid signature", { status: 401 });
    }

    // Parse the JSON payload
    let payload: LinearWebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      this.logger.error("Linear webhook invalid JSON", {
        contentType: request.headers.get("content-type"),
        bodyPreview: body.substring(0, 200),
      });
      return new Response("Invalid JSON", { status: 400 });
    }

    // Validate webhook timestamp to prevent replay attacks (within 5 minutes)
    if (payload.webhookTimestamp) {
      const timeDiff = Math.abs(Date.now() - payload.webhookTimestamp);
      if (timeDiff > 5 * 60 * 1000) {
        this.logger.warn("Linear webhook timestamp too old", {
          webhookTimestamp: payload.webhookTimestamp,
          timeDiff,
        });
        return new Response("Webhook expired", { status: 401 });
      }
    }

    if (payload.type === "OAuthApp" && payload.action === "revoked") {
      try {
        await this.deleteInstallation(payload.organizationId);
      } catch (error) {
        this.logger.error("Failed to delete Linear installation on revoke", {
          organizationId: payload.organizationId,
          error,
        });
      }

      return new Response("ok", { status: 200 });
    }

    const processPayload = async (): Promise<Response> => {
      if (payload.type === "Comment") {
        const commentPayload = payload as CommentWebhookPayload;
        if (commentPayload.action === "create") {
          this.handleCommentCreated(commentPayload, options);
        }
      } else if (payload.type === "Reaction") {
        const reactionPayload = payload as ReactionWebhookPayload;
        this.handleReaction(reactionPayload);
      }

      return new Response("ok", { status: 200 });
    };

    if (!this.isMultiTenantMode()) {
      return await processPayload();
    }

    let installation: LinearInstallation | null;
    try {
      installation = await this.getInstallation(payload.organizationId);
    } catch (error) {
      this.logger.error("Failed to resolve Linear installation for webhook", {
        organizationId: payload.organizationId,
        error,
      });
      return new Response("Installation lookup failed", { status: 500 });
    }

    if (!installation) {
      this.logger.warn("No Linear installation found for organization", {
        organizationId: payload.organizationId,
      });
      return new Response("ok", { status: 200 });
    }

    let resolvedInstallation: LinearInstallation;
    try {
      resolvedInstallation = await this.refreshInstallation(installation);
    } catch (error) {
      this.logger.error("Failed to refresh Linear installation for webhook", {
        organizationId: payload.organizationId,
        error,
      });
      return new Response("Installation refresh failed", { status: 500 });
    }

    const context: LinearRequestContext = {
      accessToken: resolvedInstallation.accessToken,
      botUserId: resolvedInstallation.botUserId,
      client: new LinearClient({
        accessToken: resolvedInstallation.accessToken,
      }),
      organizationId: resolvedInstallation.organizationId,
    };

    return await this.requestContext.run(context, processPayload);
  }

  /**
   * Verify Linear webhook signature using HMAC-SHA256.
   *
   * @see https://linear.app/developers/webhooks#securing-webhooks
   */
  private verifySignature(body: string, signature: string | null): boolean {
    if (!signature) {
      return false;
    }

    const computedSignature = createHmac("sha256", this.webhookSecret)
      .update(body)
      .digest("hex");

    try {
      return timingSafeEqual(
        Buffer.from(computedSignature, "hex"),
        Buffer.from(signature, "hex")
      );
    } catch {
      return false;
    }
  }

  /**
   * Handle a new comment created on an issue.
   *
   * Threading logic:
   * - If the comment has a parentId, it's a reply -> thread under the parent (root comment)
   * - If no parentId, this is a root comment -> thread under this comment's own ID
   */
  private handleCommentCreated(
    payload: CommentWebhookPayload,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring comment");
      return;
    }

    const { data, actor } = payload;

    // Skip if the comment has no issueId (e.g., project update comment)
    if (!data.issueId) {
      this.logger.debug("Ignoring non-issue comment", {
        commentId: data.id,
      });
      return;
    }

    // Determine thread: use parentId as root if it's a reply, otherwise this comment is the root
    const rootCommentId = data.parentId || data.id;
    const threadId = this.encodeThreadId({
      issueId: data.issueId,
      commentId: rootCommentId,
    });

    // Build message
    const message = this.buildMessage(
      data,
      actor,
      threadId,
      payload.organizationId
    );

    // Skip bot's own messages
    if (data.userId === this.botUserId) {
      this.logger.debug("Ignoring message from self", {
        messageId: data.id,
      });
      return;
    }

    this.chat.processMessage(this, threadId, message, options);
  }

  /**
   * Handle reaction events (logging only - reactions don't include issueId).
   */
  private handleReaction(payload: ReactionWebhookPayload): void {
    if (!this.chat) {
      return;
    }

    const { data, actor } = payload;

    // Reactions on comments need a commentId to find the thread.
    // Since reaction webhooks don't include issueId directly,
    // we'd need an additional API call to look it up.
    this.logger.debug("Received reaction webhook", {
      reactionId: data.id,
      emoji: data.emoji,
      commentId: data.commentId,
      action: payload.action,
      actorName: actor.name,
    });
  }

  /**
   * Build a Message from a Linear comment and actor.
   */
  private buildMessage(
    comment: LinearCommentData,
    actor: LinearWebhookActor,
    threadId: string,
    organizationId: string
  ): Message<LinearRawMessage> {
    const text = comment.body || "";

    const author: Author = {
      userId: comment.userId,
      userName: actor.name || "unknown",
      fullName: actor.name || "unknown",
      isBot: actor.type !== "user",
      isMe: comment.userId === this.botUserId,
    };

    const formatted: FormattedContent = this.formatConverter.toAst(text);

    const raw: LinearRawMessage = {
      comment,
      organizationId,
    };

    return new Message<LinearRawMessage>({
      id: comment.id,
      threadId,
      text,
      formatted,
      raw,
      author,
      metadata: {
        dateSent: comment.createdAt ? new Date(comment.createdAt) : new Date(),
        edited: comment.createdAt !== comment.updatedAt,
        editedAt:
          comment.createdAt !== comment.updatedAt && comment.updatedAt
            ? new Date(comment.updatedAt)
            : undefined,
      },
      attachments: [],
    });
  }

  /**
   * Post a message to a thread (create a comment on an issue).
   *
   * For comment-level threads, uses parentId to reply under the root comment.
   * For issue-level threads, creates a top-level comment.
   *
   * Uses LinearClient.createComment({ issueId, body, parentId? }).
   * @see https://linear.app/developers/sdk-fetching-and-modifying-data#mutations
   */
  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<LinearRawMessage>> {
    await this.ensureValidToken();
    const client = this.getClient();
    const { issueId, commentId } = this.decodeThreadId(threadId);

    // Render message to markdown
    let body: string;
    const card = extractCard(message);
    if (card) {
      body = cardToLinearMarkdown(card);
    } else {
      body = this.formatConverter.renderPostable(message);
    }

    // Convert emoji placeholders to unicode
    body = convertEmojiPlaceholders(body, "linear");

    // Create the comment via Linear SDK
    // If commentId is present, reply under that comment (comment-level thread)
    const commentPayload = await client.createComment({
      issueId,
      body,
      parentId: commentId,
    });

    const comment = await commentPayload.comment;
    if (!comment) {
      throw new AdapterError(
        "Failed to create comment on Linear issue",
        "linear"
      );
    }
    const organizationId = this.getOrganizationId();

    return {
      id: comment.id,
      threadId,
      raw: {
        comment: {
          id: comment.id,
          body: comment.body,
          issueId,
          userId: this.botUserId || "",
          createdAt: comment.createdAt.toISOString(),
          updatedAt: comment.updatedAt.toISOString(),
          url: comment.url,
        },
        organizationId,
      },
    };
  }

  /**
   * Edit an existing message (update a comment).
   *
   * Uses LinearClient.updateComment(id, { body }).
   * @see https://linear.app/developers/sdk-fetching-and-modifying-data#mutations
   */
  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<LinearRawMessage>> {
    await this.ensureValidToken();
    const client = this.getClient();
    const { issueId } = this.decodeThreadId(threadId);

    // Render message to markdown
    let body: string;
    const card = extractCard(message);
    if (card) {
      body = cardToLinearMarkdown(card);
    } else {
      body = this.formatConverter.renderPostable(message);
    }

    // Convert emoji placeholders to unicode
    body = convertEmojiPlaceholders(body, "linear");

    // Update the comment via Linear SDK
    const commentPayload = await client.updateComment(messageId, {
      body,
    });

    const comment = await commentPayload.comment;
    if (!comment) {
      throw new AdapterError("Failed to update comment on Linear", "linear");
    }
    const organizationId = this.getOrganizationId();

    return {
      id: comment.id,
      threadId,
      raw: {
        comment: {
          id: comment.id,
          body: comment.body,
          issueId,
          userId: this.botUserId || "",
          createdAt: comment.createdAt.toISOString(),
          updatedAt: comment.updatedAt.toISOString(),
          url: comment.url,
        },
        organizationId,
      },
    };
  }

  /**
   * Delete a message (delete a comment).
   *
   * Uses LinearClient.deleteComment(id).
   */
  async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    await this.ensureValidToken();
    await this.getClient().deleteComment(messageId);
  }

  /**
   * Add a reaction to a comment.
   *
   * Uses LinearClient.createReaction({ commentId, emoji }).
   * Linear reactions use emoji strings (unicode).
   */
  async addReaction(
    _threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    await this.ensureValidToken();
    const emojiStr = this.resolveEmoji(emoji);
    await this.getClient().createReaction({
      commentId: messageId,
      emoji: emojiStr,
    });
  }

  /**
   * Remove a reaction from a comment.
   *
   * Linear doesn't have a direct "remove reaction by emoji + user" API.
   * Removing requires knowing the reaction ID, which would require fetching
   * the comment's reactions first. This is a known limitation.
   */
  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    this.logger.warn(
      "removeReaction is not fully supported on Linear - reaction ID lookup would be required"
    );
  }

  /**
   * Start typing indicator. Not supported by Linear.
   */
  async startTyping(_threadId: string, _status?: string): Promise<void> {
    // Linear doesn't support typing indicators
  }

  /**
   * Fetch messages from a thread.
   *
   * For issue-level threads: fetches all top-level issue comments.
   * For comment-level threads: fetches the root comment and its children (replies).
   */
  async fetchMessages(
    threadId: string,
    options?: FetchOptions
  ): Promise<FetchResult<LinearRawMessage>> {
    await this.ensureValidToken();
    const { issueId, commentId } = this.decodeThreadId(threadId);

    if (commentId) {
      // Comment-level thread: fetch root comment's children
      return this.fetchCommentThread(threadId, issueId, commentId, options);
    }

    // Issue-level thread: fetch all top-level comments
    return this.fetchIssueComments(threadId, issueId, options);
  }

  /**
   * Fetch top-level comments on an issue.
   */
  private async fetchIssueComments(
    threadId: string,
    issueId: string,
    options?: FetchOptions
  ): Promise<FetchResult<LinearRawMessage>> {
    const issue = await this.getClient().issue(issueId);
    const organizationId = this.getOrganizationId();
    const commentsConnection = await issue.comments({
      first: options?.limit ?? 50,
    });

    const messages = await this.commentsToMessages(
      commentsConnection.nodes,
      threadId,
      issueId,
      organizationId
    );

    return {
      messages,
      nextCursor: commentsConnection.pageInfo.hasNextPage
        ? (commentsConnection.pageInfo.endCursor ?? undefined)
        : undefined,
    };
  }

  /**
   * Fetch a comment thread (root comment + its children/replies).
   */
  private async fetchCommentThread(
    threadId: string,
    issueId: string,
    commentId: string,
    options?: FetchOptions
  ): Promise<FetchResult<LinearRawMessage>> {
    const rootComment = await this.getClient().comment({ id: commentId });
    if (!rootComment) {
      return { messages: [] };
    }
    const organizationId = this.getOrganizationId();

    // Get the children (replies) of the root comment
    const childrenConnection = await rootComment.children({
      first: options?.limit ?? 50,
    });

    // Include the root comment as the first message, then its children
    const rootMessages = await this.commentsToMessages(
      [rootComment],
      threadId,
      issueId,
      organizationId
    );
    const childMessages = await this.commentsToMessages(
      childrenConnection.nodes,
      threadId,
      issueId,
      organizationId
    );

    return {
      messages: [...rootMessages, ...childMessages],
      nextCursor: childrenConnection.pageInfo.hasNextPage
        ? (childrenConnection.pageInfo.endCursor ?? undefined)
        : undefined,
    };
  }

  /**
   * Convert an array of Linear SDK Comment objects to Message instances.
   */
  private async commentsToMessages(
    comments: Array<{
      id: string;
      body: string;
      createdAt: Date;
      updatedAt: Date;
      url: string;
      user: LinearFetch<User> | undefined;
    }>,
    threadId: string,
    issueId: string,
    organizationId?: string
  ): Promise<Message<LinearRawMessage>[]> {
    const messages: Message<LinearRawMessage>[] = [];

    for (const comment of comments) {
      const user = await comment.user;
      const author: Author = {
        userId: user?.id || "unknown",
        userName: user?.displayName || "unknown",
        fullName: user?.name || user?.displayName || "unknown",
        isBot: false,
        isMe: user?.id === this.botUserId,
      };

      const formatted: FormattedContent = this.formatConverter.toAst(
        comment.body
      );

      messages.push(
        new Message<LinearRawMessage>({
          id: comment.id,
          threadId,
          text: comment.body,
          formatted,
          author,
          metadata: {
            dateSent: new Date(comment.createdAt),
            edited: comment.createdAt.getTime() !== comment.updatedAt.getTime(),
            editedAt:
              comment.createdAt.getTime() !== comment.updatedAt.getTime()
                ? new Date(comment.updatedAt)
                : undefined,
          },
          attachments: [],
          raw: {
            comment: {
              id: comment.id,
              body: comment.body,
              issueId,
              userId: user?.id || "unknown",
              createdAt: comment.createdAt.toISOString(),
              updatedAt: comment.updatedAt.toISOString(),
              url: comment.url,
            },
            organizationId,
          },
        })
      );
    }

    return messages;
  }

  /**
   * Fetch thread info for a Linear issue.
   */
  async fetchThread(threadId: string): Promise<ThreadInfo> {
    await this.ensureValidToken();
    const { issueId } = this.decodeThreadId(threadId);

    const issue = await this.getClient().issue(issueId);

    return {
      id: threadId,
      channelId: issueId,
      channelName: `${issue.identifier}: ${issue.title}`,
      isDM: false,
      metadata: {
        issueId,
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
      },
    };
  }

  /**
   * Encode a Linear thread ID.
   *
   * Formats:
   * - Issue-level: linear:{issueId}
   * - Comment thread: linear:{issueId}:c:{commentId}
   */
  encodeThreadId(platformData: LinearThreadId): string {
    if (platformData.commentId) {
      return `linear:${platformData.issueId}:c:${platformData.commentId}`;
    }
    return `linear:${platformData.issueId}`;
  }

  /**
   * Decode a Linear thread ID.
   *
   * Formats:
   * - Issue-level: linear:{issueId}
   * - Comment thread: linear:{issueId}:c:{commentId}
   */
  decodeThreadId(threadId: string): LinearThreadId {
    if (!threadId.startsWith("linear:")) {
      throw new ValidationError(
        "linear",
        `Invalid Linear thread ID: ${threadId}`
      );
    }

    const withoutPrefix = threadId.slice(7);
    if (!withoutPrefix) {
      throw new ValidationError(
        "linear",
        `Invalid Linear thread ID format: ${threadId}`
      );
    }

    // Check for comment thread format: {issueId}:c:{commentId}
    const commentMatch = withoutPrefix.match(COMMENT_THREAD_PATTERN);
    if (commentMatch) {
      return {
        issueId: commentMatch[1],
        commentId: commentMatch[2],
      };
    }

    // Issue-level format: {issueId}
    return { issueId: withoutPrefix };
  }

  /**
   * Derive channel ID from a Linear thread ID.
   * linear:{issueId}:c:{commentId} -> linear:{issueId}
   * linear:{issueId} -> linear:{issueId}
   */
  channelIdFromThreadId(threadId: string): string {
    const { issueId } = this.decodeThreadId(threadId);
    return `linear:${issueId}`;
  }

  /**
   * Parse platform message format to normalized format.
   */
  parseMessage(raw: LinearRawMessage): Message<LinearRawMessage> {
    const text = raw.comment.body || "";
    const formatted: FormattedContent = this.formatConverter.toAst(text);

    return new Message<LinearRawMessage>({
      id: raw.comment.id,
      threadId: "",
      text,
      formatted,
      author: {
        userId: raw.comment.userId,
        userName: "unknown",
        fullName: "unknown",
        isBot: false,
        isMe: raw.comment.userId === this.botUserId,
      },
      metadata: {
        dateSent: raw.comment.createdAt
          ? new Date(raw.comment.createdAt)
          : new Date(),
        edited: raw.comment.createdAt !== raw.comment.updatedAt,
        editedAt:
          raw.comment.createdAt !== raw.comment.updatedAt &&
          raw.comment.updatedAt
            ? new Date(raw.comment.updatedAt)
            : undefined,
      },
      attachments: [],
      raw,
    });
  }

  /**
   * Render formatted content to Linear markdown.
   */
  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  /**
   * Resolve an emoji value to a unicode string.
   * Linear uses standard unicode emoji for reactions.
   */
  private resolveEmoji(emoji: EmojiValue | string): string {
    const emojiName = typeof emoji === "string" ? emoji : emoji.name;

    const mapping: Record<string, string> = {
      thumbs_up: "\u{1F44D}",
      thumbs_down: "\u{1F44E}",
      heart: "\u{2764}\u{FE0F}",
      fire: "\u{1F525}",
      rocket: "\u{1F680}",
      eyes: "\u{1F440}",
      check: "\u{2705}",
      warning: "\u{26A0}\u{FE0F}",
      sparkles: "\u{2728}",
      wave: "\u{1F44B}",
      raised_hands: "\u{1F64C}",
      laugh: "\u{1F604}",
      hooray: "\u{1F389}",
      confused: "\u{1F615}",
    };

    return mapping[emojiName] || emojiName;
  }
}

/**
 * Factory function to create a Linear adapter.
 *
 * @example
 * ```typescript
 * const adapter = createLinearAdapter({
 *   apiKey: process.env.LINEAR_API_KEY!,
 *   webhookSecret: process.env.LINEAR_WEBHOOK_SECRET!,
 *   userName: "my-bot",
 *   logger: console,
 * });
 * ```
 */
export function createLinearAdapter(
  config?: LinearAdapterConfig
): LinearAdapter {
  return new LinearAdapter(config);
}
