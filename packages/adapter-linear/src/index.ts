import { AsyncLocalStorage } from "node:async_hooks";
import {
  AdapterError,
  AuthenticationError,
  ValidationError,
} from "@chat-adapter/shared";
import type { LinearFetch, User } from "@linear/sdk";
import { AgentActivityType, LinearClient } from "@linear/sdk";
import {
  type AgentSessionEventWebhookPayload,
  type EntityWebhookPayloadWithCommentData as CommentWebhookPayload,
  LinearWebhookClient,
  type EntityWebhookPayloadWithReactionData as ReactionWebhookPayload,
} from "@linear/sdk/webhooks";
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
  StreamChunk,
  StreamOptions,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import { ConsoleLogger, Message, StreamingMarkdownRenderer } from "chat";
import { LinearFormatConverter } from "./markdown";
import type {
  LinearAdapterAutoConfig,
  LinearAdapterConfig,
  LinearAdapterMode,
  LinearAdapterMultiTenantConfig,
  LinearAgentSessionCommentData,
  LinearAgentSessionData,
  LinearClientCredentialsConfig,
  LinearCommentData,
  LinearInstallation,
  LinearOAuthCallbackOptions,
  LinearOAuthTokenResponse,
  LinearRawMessage,
  LinearThreadId,
} from "./types";
import {
  assertAgentSessionThread,
  buildAgentActivityRawMessage,
  buildAgentSessionEventRawMessage,
  buildCommentRawMessage,
  getAgentActivityText,
  getSessionThreadId,
  type LinearAgentPlanStatus,
  type LinearAgentSessionThreadId,
  normalizeAgentActivityType,
  renderMessageToLinearMarkdown,
  toAgentPlanStatus,
} from "./utils";

const COMMENT_SESSION_THREAD_PATTERN = /^([^:]+):c:([^:]+):s:([^:]+)$/;
const COMMENT_THREAD_PATTERN = /^([^:]+):c:([^:]+)$/;
const ISSUE_SESSION_THREAD_PATTERN = /^([^:]+):s:([^:]+)$/;
const INSTALLATION_KEY_PREFIX = "linear:installation";
const INSTALLATION_REFRESH_BUFFER_MS = 5 * 60 * 1000;

function parseEnvClientCredentialScopes(value?: string): string[] | undefined {
  if (!value) {
    return undefined;
  }

  return value
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
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
  LinearAdapterMode,
  LinearAdapterMultiTenantConfig,
  LinearAdapterOAuthConfig,
  LinearAgentActivityRawMessage,
  LinearAgentSessionEventRawMessage,
  LinearClientCredentialsConfig,
  LinearCommentRawMessage,
  LinearInstallation,
  LinearOAuthCallbackOptions,
  LinearRawMessage,
  LinearThreadId,
} from "./types";
export { assertAgentSessionThread } from "./utils";

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

  private readonly mode: LinearAdapterMode;
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
  get botUserId(): string {
    const id =
      this.requestContext.getStore()?.botUserId ?? this.defaultBotUserId;

    if (!id) {
      throw new AdapterError(
        "No bot user ID available in context. Ensure the adapter has been initialized and authenticated properly.",
        "linear"
      );
    }

    return id;
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
    this.mode = config.mode ?? "comments";
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
      scopes: clientCredentials.scopes ?? [
        "read",
        "write",
        "comments:create",
        "issues:create",
        ...(this.mode === "agent-sessions" ? ["app:mentionable"] : []),
      ],
    };
  }

  private getAgentSessionSourceComment(
    agentSession:
      | LinearAgentSessionData
      | AgentSessionEventWebhookPayload["agentSession"],
    previousComments?:
      | LinearAgentSessionCommentData[]
      | NonNullable<AgentSessionEventWebhookPayload["previousComments"]>
      | null
  ):
    | {
        body?: string | null;
        id: string;
        userId?: string | null;
      }
    | undefined {
    return agentSession.comment ?? previousComments?.at(-1) ?? undefined;
  }

  private getAgentSessionMetadataSourceCommentId(
    sourceMetadata: unknown
  ): string | undefined {
    if (!sourceMetadata || typeof sourceMetadata !== "object") {
      return undefined;
    }

    const metadata = sourceMetadata as {
      agentSessionMetadata?: {
        sourceCommentId?: string | null;
      };
    };

    return metadata.agentSessionMetadata?.sourceCommentId ?? undefined;
  }

  private getAgentSessionSourceCommentId(
    agentSession:
      | LinearAgentSessionData
      | AgentSessionEventWebhookPayload["agentSession"],
    previousComments?:
      | LinearAgentSessionCommentData[]
      | NonNullable<AgentSessionEventWebhookPayload["previousComments"]>
      | null
  ): string | undefined {
    return (
      agentSession.sourceCommentId ??
      this.getAgentSessionMetadataSourceCommentId(
        agentSession.sourceMetadata
      ) ??
      this.getAgentSessionSourceComment(agentSession, previousComments)?.id ??
      agentSession.commentId ??
      undefined
    );
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

  private buildAgentSessionMessage(
    payload: AgentSessionEventWebhookPayload
  ): Message<LinearRawMessage> {
    const raw = buildAgentSessionEventRawMessage(payload);
    const sourceComment = this.getAgentSessionSourceComment(
      payload.agentSession,
      payload.previousComments
    );
    const threadId = getSessionThreadId(payload.agentSession, (thread) =>
      this.encodeThreadId(thread)
    );
    const sourceCommentText = sourceComment?.body?.trim();
    const text =
      payload.action === "created"
        ? sourceCommentText ||
          getAgentActivityText(payload.agentActivity) ||
          payload.promptContext ||
          ""
        : getAgentActivityText(payload.agentActivity) ||
          sourceCommentText ||
          payload.promptContext ||
          "";

    const authorUserId =
      sourceComment?.userId ??
      payload.agentActivity?.userId ??
      payload.agentSession.creator?.id;
    const authorName =
      payload.agentActivity?.user?.name ??
      payload.agentSession.creator?.name ??
      "unknown";

    if (!authorUserId) {
      throw new AdapterError(
        `Unable to determine author user ID for agent session event ${payload.webhookId}`,
        "linear"
      );
    }

    const isMe = authorUserId === this.botUserId;

    const author: Author = {
      userId: authorUserId,
      userName: authorName,
      fullName: authorName,
      isBot: isMe || authorUserId === payload.appUserId,
      isMe,
    };

    const messageId =
      payload.action === "created"
        ? (this.getAgentSessionSourceCommentId(
            payload.agentSession,
            payload.previousComments
          ) ??
          payload.agentActivity?.id ??
          payload.agentSession.id)
        : (payload.agentActivity?.id ?? payload.agentSession.id);

    return new Message<LinearRawMessage>({
      id: messageId,
      threadId,
      text,
      formatted: this.formatConverter.toAst(text),
      raw,
      author,
      isMention: payload.action === "created",
      metadata: {
        dateSent: new Date(
          payload.agentActivity?.createdAt ?? payload.createdAt ?? Date.now()
        ),
        edited: false,
      },
      attachments: [],
    });
  }

  private getWebhookActorName(
    actor: CommentWebhookPayload["actor"] | ReactionWebhookPayload["actor"]
  ): string {
    if (!actor) {
      return "unknown";
    }

    if ("name" in actor && actor.name) {
      return actor.name;
    }

    if ("service" in actor && actor.service) {
      return actor.service;
    }

    return "unknown";
  }

  private async runWebhookWithInstallation(
    organizationId: string,
    handler: () => void | Promise<void>
  ): Promise<void> {
    if (!this.isMultiTenantMode()) {
      await handler();
      return;
    }

    let installation: LinearInstallation | null;
    try {
      installation = await this.getInstallation(organizationId);
    } catch (error) {
      this.logger.error("Failed to resolve Linear installation for webhook", {
        organizationId,
        error,
      });
      throw error;
    }

    if (!installation) {
      this.logger.warn("No Linear installation found for organization", {
        organizationId,
      });
      return;
    }

    let resolvedInstallation: LinearInstallation;
    try {
      resolvedInstallation = await this.refreshInstallation(installation);
    } catch (error) {
      this.logger.error("Failed to refresh Linear installation for webhook", {
        organizationId,
        error,
      });
      throw error;
    }

    const context: LinearRequestContext = {
      accessToken: resolvedInstallation.accessToken,
      botUserId: resolvedInstallation.botUserId,
      client: new LinearClient({
        accessToken: resolvedInstallation.accessToken,
      }),
      organizationId: resolvedInstallation.organizationId,
    };

    await this.requestContext.run(context, handler);
  }

  private async createAgentActivity(
    threadId: LinearAgentSessionThreadId,
    input: Omit<
      Parameters<LinearClient["createAgentActivity"]>[0],
      "agentSessionId"
    >
  ): Promise<RawMessage<LinearRawMessage>> {
    const linear = this.getClient();
    const result = await linear.createAgentActivity({
      agentSessionId: threadId.agentSessionId,
      ...input,
    });

    const [activity, agentSession] = await Promise.all([
      result.agentActivity,
      linear.agentSession(threadId.agentSessionId),
    ]);
    if (!(result.success && activity)) {
      throw new AdapterError(
        `Failed to create Linear agent activity for session ${threadId.agentSessionId}`,
        "linear"
      );
    }

    const organizationId = this.getOrganizationId();

    return {
      id: activity.id,
      threadId: this.encodeThreadId(threadId),
      raw: buildAgentActivityRawMessage(agentSession, activity, organizationId),
    };
  }

  private async updateAgentSession(
    agentSessionId: string,
    input: Parameters<LinearClient["updateAgentSession"]>[1]
  ): Promise<void> {
    const result = await this.getClient().updateAgentSession(
      agentSessionId,
      input
    );

    if (!result.success) {
      throw new AdapterError(
        `Failed to update Linear agent session ${agentSessionId}`,
        "linear"
      );
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
    const webhookHandler = new LinearWebhookClient(
      this.webhookSecret
    ).createHandler();

    webhookHandler.on("OAuthApp", async (payload) => {
      if (payload.action !== "revoked") {
        return;
      }

      try {
        await this.deleteInstallation(payload.organizationId);
      } catch (error) {
        this.logger.error("Failed to delete Linear installation on revoke", {
          organizationId: payload.organizationId,
          error,
        });
      }
    });

    webhookHandler.on("Comment", async (payload) => {
      await this.runWebhookWithInstallation(
        payload.organizationId,
        async () => {
          if (this.mode !== "comments" || payload.action !== "create") {
            return;
          }

          this.handleCommentCreated(payload, options);
        }
      );
    });

    webhookHandler.on("AgentSessionEvent", async (payload) => {
      await this.runWebhookWithInstallation(
        payload.organizationId,
        async () => {
          if (this.mode !== "agent-sessions") {
            return;
          }

          this.handleAgentSessionEvent(payload, options);
        }
      );
    });

    webhookHandler.on("Reaction", async (payload) => {
      await this.runWebhookWithInstallation(
        payload.organizationId,
        async () => {
          this.handleReaction(payload);
        }
      );
    });

    return await webhookHandler(request);
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

    const comment: LinearCommentData = {
      body: data.body,
      createdAt: data.createdAt,
      id: data.id,
      issueId: data.issueId,
      parentId: data.parentId ?? undefined,
      updatedAt: data.updatedAt,
      url: payload.url ?? undefined,
      userId:
        data.userId ??
        (actor && "id" in actor ? actor.id : undefined) ??
        "unknown",
    };

    // Build message
    const message = this.buildMessage(
      comment,
      actor,
      threadId,
      payload.organizationId
    );

    // Skip bot's own messages
    if (comment.userId === this.botUserId) {
      this.logger.debug("Ignoring message from self", {
        messageId: comment.id,
      });
      return;
    }

    this.chat.processMessage(this, threadId, message, options);
  }

  private handleAgentSessionEvent(
    payload: AgentSessionEventWebhookPayload,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn(
        "Chat instance not initialized, ignoring agent session event"
      );
      return;
    }

    if (!payload.agentSession?.id) {
      this.logger.warn("Malformed Linear agent session event", {
        payload,
      });
      return;
    }

    const issueId =
      payload.agentSession.issueId ?? payload.agentSession.issue?.id;
    if (!issueId) {
      this.logger.warn("Ignoring Linear agent session event without issueId", {
        agentSessionId: payload.agentSession.id,
      });
      return;
    }

    const message = this.buildAgentSessionMessage(payload);
    this.chat.processMessage(this, message.threadId, message, options);
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
      actorName: this.getWebhookActorName(actor),
    });
  }

  /**
   * Build a Message from a Linear comment and actor.
   */
  private buildMessage(
    comment: LinearCommentData,
    actor: CommentWebhookPayload["actor"],
    threadId: string,
    organizationId: string
  ): Message<LinearRawMessage> {
    const text = comment.body;
    const authorName = this.getWebhookActorName(actor);

    const author: Author = {
      userId: comment.userId,
      userName: authorName,
      fullName: authorName,
      isBot: actor?.type !== "user",
      isMe: comment.userId === this.botUserId,
    };

    const formatted: FormattedContent = this.formatConverter.toAst(text);

    const raw = buildCommentRawMessage(comment, organizationId);

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
    const decoded = this.decodeThreadId(threadId);
    const body = renderMessageToLinearMarkdown(message, this.formatConverter);

    if (decoded.agentSessionId) {
      assertAgentSessionThread(decoded);
      return await this.createAgentActivity(decoded, {
        content: {
          type: AgentActivityType.Response,
          body,
        },
      });
    }

    // Create the comment via Linear SDK
    // If commentId is present, reply under that comment (comment-level thread)
    const commentPayload = await client.createComment({
      issueId: decoded.issueId,
      body,
      parentId: decoded.commentId,
    });

    const comment = await commentPayload.comment;
    if (!comment) {
      this.logger.error("Linear comment creation returned no comment", {
        issueId: decoded.issueId,
        threadId,
      });
      throw new AdapterError(
        "Failed to create comment on Linear issue",
        "linear"
      );
    }
    const organizationId = this.getOrganizationId();

    return {
      id: comment.id,
      threadId,
      raw: buildCommentRawMessage(
        {
          id: comment.id,
          body: comment.body,
          issueId: decoded.issueId,
          userId: this.botUserId || "",
          createdAt: comment.createdAt.toISOString(),
          updatedAt: comment.updatedAt.toISOString(),
          url: comment.url,
        },
        organizationId
      ),
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
    const { issueId, agentSessionId } = this.decodeThreadId(threadId);

    if (agentSessionId) {
      throw new AdapterError(
        "Linear agent session activities are append-only and cannot be edited",
        "linear"
      );
    }

    const body = renderMessageToLinearMarkdown(message, this.formatConverter);

    // Update the comment via Linear SDK
    const commentPayload = await client.updateComment(messageId, {
      body,
    });

    const comment = await commentPayload.comment;
    if (!comment) {
      this.logger.error("Linear comment update returned no comment", {
        messageId,
        threadId,
      });
      throw new AdapterError("Failed to update comment on Linear", "linear");
    }
    const organizationId = this.getOrganizationId();

    return {
      id: comment.id,
      threadId,
      raw: buildCommentRawMessage(
        {
          id: comment.id,
          body: comment.body,
          issueId,
          userId: this.botUserId || "",
          createdAt: comment.createdAt.toISOString(),
          updatedAt: comment.updatedAt.toISOString(),
          url: comment.url,
        },
        organizationId
      ),
    };
  }

  /**
   * Delete a message (delete a comment).
   *
   * Uses LinearClient.deleteComment(id).
   */
  async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    const { agentSessionId } = this.decodeThreadId(_threadId);
    if (agentSessionId) {
      throw new AdapterError(
        "Linear agent session activities are append-only and cannot be deleted",
        "linear"
      );
    }

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
   * Start typing indicator.
   * For agent-session threads this emits an ephemeral thought activity.
   * For standard comment threads this remains a no-op.
   */
  async startTyping(threadId: string, status?: string): Promise<void> {
    await this.ensureValidToken();
    const decoded = this.decodeThreadId(threadId);

    if (!decoded.agentSessionId) {
      return;
    }

    assertAgentSessionThread(decoded);

    await this.createAgentActivity(decoded, {
      content: {
        type: AgentActivityType.Thought,
        body: status ?? "Thinking...",
      },
      ephemeral: true,
    });
  }

  /**
   * Stream text/chunk to a thread.
   */
  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    options?: StreamOptions
  ): Promise<RawMessage<LinearRawMessage>> {
    await this.ensureValidToken();
    const decoded = this.decodeThreadId(threadId);

    if (decoded.agentSessionId) {
      assertAgentSessionThread(decoded);
      return await this.streamInAgentSession(decoded, textStream, options);
    }
    return await this.streamAsComment(threadId, textStream, options);
  }

  /**
   * Stream text/chunk in an agent session.
   */
  private async streamInAgentSession(
    decoded: LinearAgentSessionThreadId,
    textStream: AsyncIterable<string | StreamChunk>,
    _options?: StreamOptions
  ): Promise<RawMessage<LinearRawMessage>> {
    const renderer = new StreamingMarkdownRenderer();
    const taskPlan = new Map<
      string,
      {
        content: string;
        status: LinearAgentPlanStatus;
      }
    >();
    assertAgentSessionThread(decoded);

    for await (const chunk of textStream) {
      if (typeof chunk === "string") {
        renderer.push(chunk);
        continue;
      }

      if (chunk.type === "markdown_text") {
        renderer.push(chunk.text);
        continue;
      }

      if (chunk.type === "task_update") {
        taskPlan.set(chunk.id, {
          content: chunk.title,
          status: toAgentPlanStatus(chunk.status),
        });

        await this.updateAgentSession(decoded.agentSessionId, {
          plan: Array.from(taskPlan.values()),
        });
      }
    }

    const finalBody = renderer.finish();
    return await this.createAgentActivity(decoded, {
      content: {
        type: AgentActivityType.Response,
        body: finalBody,
      },
    });
  }

  /**
   * Stream text/chunk as a comment.
   * It posts an initial comment immediately, then edits that comment as new chunks arrive.
   */
  private async streamAsComment(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    options?: StreamOptions
  ): Promise<RawMessage<LinearRawMessage>> {
    const intervalMs = options?.updateIntervalMs ?? 500;
    let rawMessage: RawMessage<LinearRawMessage> | null =
      await this.postMessage(threadId, "...");
    let threadIdForEdits = rawMessage.threadId || threadId;
    const renderer = new StreamingMarkdownRenderer();
    let lastEditContent = "...";
    let stopped = false;
    let pendingEdit: Promise<void> | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const scheduleNextEdit = (): void => {
      timerId = setTimeout(() => {
        pendingEdit = doEditAndReschedule();
      }, intervalMs);
    };

    const doEditAndReschedule = async (): Promise<void> => {
      if (stopped || !rawMessage) {
        return;
      }

      const content = renderer.render();
      if (content !== lastEditContent) {
        try {
          rawMessage = await this.editMessage(threadIdForEdits, rawMessage.id, {
            markdown: content,
          });
          lastEditContent = content;
          threadIdForEdits = rawMessage.threadId || threadIdForEdits;
        } catch (error) {
          this.logger.warn("Linear fallback stream edit failed", { error });
        }
      }

      if (!stopped) {
        scheduleNextEdit();
      }
    };

    scheduleNextEdit();

    try {
      for await (const chunk of textStream) {
        if (typeof chunk === "string") {
          renderer.push(chunk);
        } else if (chunk.type === "markdown_text") {
          renderer.push(chunk.text);
        }
      }
    } finally {
      stopped = true;
      if (timerId) {
        clearTimeout(timerId);
      }
    }

    if (pendingEdit) {
      await pendingEdit;
    }

    const finalContent = renderer.finish();
    if (finalContent !== lastEditContent && rawMessage) {
      rawMessage = await this.editMessage(threadIdForEdits, rawMessage.id, {
        markdown: finalContent,
      });
    }

    return rawMessage;
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
    const { issueId, commentId, agentSessionId } =
      this.decodeThreadId(threadId);

    if (agentSessionId) {
      return await this.fetchAgentSessionMessages(threadId, agentSessionId);
    }

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
    const linear = this.getClient();

    const [rootComment, childrenConnection] = await Promise.all([
      linear.comment({ id: commentId }),
      // Get the children (replies) of the root comment
      linear.comments({
        filter: {
          parent: { id: { eq: commentId } },
        },
        ...(options?.direction === "forward"
          ? {
              first: options?.limit ?? 50,
            }
          : {
              last: options?.limit ?? 50,
            }),
      }),
    ]);
    const organizationId = this.getOrganizationId();

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
   * Fetch messages from an agent session thread (agent activities).
   */
  private async fetchAgentSessionMessages(
    threadId: string,
    agentSessionId: string
  ): Promise<FetchResult<LinearRawMessage>> {
    const organizationId = this.getOrganizationId();
    const agentSession = await this.getClient().agentSession(agentSessionId);
    const activitiesConnection = await agentSession.activities();

    const messages = activitiesConnection.nodes
      .sort((a, b) => {
        const aTime = new Date(a.createdAt ?? 0).getTime();
        const bTime = new Date(b.createdAt ?? 0).getTime();
        return aTime - bTime;
      })
      .map((agentActivity) => {
        const activityType = normalizeAgentActivityType(agentActivity.content);
        const text = getAgentActivityText(agentActivity);
        const isAgentMessage = activityType !== AgentActivityType.Prompt;

        return new Message<LinearRawMessage>({
          id: agentActivity.id,
          threadId,
          text,
          formatted: this.formatConverter.toAst(text),
          author: {
            userId: isAgentMessage ? (this.botUserId ?? "self") : "unknown",
            userName: isAgentMessage ? this.userName : "unknown",
            fullName: isAgentMessage ? this.userName : "unknown",
            isBot: isAgentMessage,
            isMe: isAgentMessage,
          },
          metadata: {
            dateSent: new Date(agentActivity.createdAt ?? Date.now()),
            edited: false,
          },
          attachments: [],
          raw: buildAgentActivityRawMessage(
            agentSession,
            agentActivity,
            organizationId
          ),
        });
      });

    return {
      messages,
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
    organizationId: string
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
          raw: buildCommentRawMessage(
            {
              id: comment.id,
              body: comment.body,
              issueId,
              userId: user?.id || "unknown",
              createdAt: comment.createdAt.toISOString(),
              updatedAt: comment.updatedAt.toISOString(),
              url: comment.url,
            },
            organizationId
          ),
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
    const { issueId, agentSessionId } = this.decodeThreadId(threadId);

    const issue = await this.getClient().issue(issueId);

    return {
      id: threadId,
      channelId: issueId,
      channelName: `${issue.identifier}: ${issue.title}`,
      isDM: false,
      metadata: {
        issueId,
        agentSessionId,
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
    if (platformData.agentSessionId) {
      if (platformData.commentId) {
        return `linear:${platformData.issueId}:c:${platformData.commentId}:s:${platformData.agentSessionId}`;
      }

      return `linear:${platformData.issueId}:s:${platformData.agentSessionId}`;
    }

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

    const commentSessionMatch = withoutPrefix.match(
      COMMENT_SESSION_THREAD_PATTERN
    );
    if (commentSessionMatch) {
      return {
        issueId: commentSessionMatch[1],
        commentId: commentSessionMatch[2],
        agentSessionId: commentSessionMatch[3],
      };
    }

    const issueSessionMatch = withoutPrefix.match(ISSUE_SESSION_THREAD_PATTERN);
    if (issueSessionMatch) {
      return {
        issueId: issueSessionMatch[1],
        agentSessionId: issueSessionMatch[2],
      };
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
    switch (raw.kind) {
      case "agent_activity": {
        const text = getAgentActivityText(raw.agentActivity);
        const isAgentMessage =
          normalizeAgentActivityType(raw.agentActivity.content) !==
          AgentActivityType.Prompt;

        return new Message<LinearRawMessage>({
          id: raw.agentActivity.id,
          threadId: "",
          text,
          formatted: this.formatConverter.toAst(text),
          author: {
            userId: isAgentMessage ? (this.botUserId ?? "self") : "unknown",
            userName: isAgentMessage ? this.userName : "unknown",
            fullName: isAgentMessage ? this.userName : "unknown",
            isBot: isAgentMessage,
            isMe: isAgentMessage,
          },
          metadata: {
            dateSent: new Date(raw.agentActivity.createdAt),
            edited: false,
          },
          attachments: [],
          raw,
        });
      }
      case "agent_session_event": {
        const { payload } = raw;
        const sourceComment = this.getAgentSessionSourceComment(
          payload.agentSession,
          payload.previousComments
        );
        const text =
          getAgentActivityText(payload.agentActivity) ||
          sourceComment?.body ||
          payload.promptContext ||
          "";
        const authorUserId =
          sourceComment?.userId ??
          payload.agentActivity?.userId ??
          payload.agentSession.creator?.id ??
          "";
        const authorName =
          payload.agentActivity?.user?.name ??
          payload.agentSession.creator?.name ??
          "unknown";

        const isMe = authorUserId === this.botUserId;

        return new Message<LinearRawMessage>({
          id:
            this.getAgentSessionSourceCommentId(
              payload.agentSession,
              payload.previousComments
            ) ??
            payload.agentActivity?.id ??
            payload.agentSession.id,
          threadId: "",
          text,
          formatted: this.formatConverter.toAst(text),
          author: {
            userId: authorUserId,
            userName: authorName,
            fullName: authorName,
            isBot: isMe || authorUserId === payload.appUserId,
            isMe,
          },
          metadata: {
            dateSent: new Date(
              payload.agentActivity?.createdAt ??
                payload.createdAt ??
                Date.now()
            ),
            edited: false,
          },
          attachments: [],
          isMention: payload.action === "created",
          raw,
        });
      }
      case "comment": {
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
      default: {
        throw new ValidationError(
          "linear",
          "Unsupported Linear raw message kind"
        );
      }
    }
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
