import { AsyncLocalStorage } from "node:async_hooks";
import {
  AdapterError,
  AuthenticationError,
  decodeKey,
  decryptToken,
  type EncryptedTokenData,
  encryptToken,
  isEncryptedTokenData,
  ValidationError,
} from "@chat-adapter/shared";
import type { AgentActivityPayload, Comment } from "@linear/sdk";
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
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Logger,
  MessageSubject,
  RawMessage,
  StreamChunk,
  StreamOptions,
  ThreadInfo,
  UserInfo,
  WebhookOptions,
} from "chat";
import { ConsoleLogger, Message, StreamingMarkdownRenderer } from "chat";
import { LinearFormatConverter } from "./markdown";
import type {
  LinearActorData,
  LinearAdapterAutoConfig,
  LinearAdapterConfig,
  LinearAdapterMode,
  LinearAdapterMultiTenantConfig,
  LinearAgentSessionThreadId,
  LinearClientCredentialsConfig,
  LinearCommentData,
  LinearInstallation,
  LinearOAuthCallbackOptions,
  LinearOAuthTokenResponse,
  LinearRawMessage,
  LinearThreadId,
  LinearWebhookVerifier,
} from "./types";
import {
  assertAgentSessionThread,
  calculateExpiry,
  getUserNameFromProfileUrl,
  renderMessageToLinearMarkdown,
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
  client: LinearClient;
  installation: LinearInstallation;
}

/**
 * Persisted form of LinearInstallation. accessToken / refreshToken may be
 * either a plaintext string (legacy / no encryption configured) or an
 * EncryptedTokenData envelope (when an encryption key is set).
 */
type StoredLinearInstallation = Omit<
  LinearInstallation,
  "accessToken" | "refreshToken"
> & {
  accessToken: string | EncryptedTokenData;
  refreshToken?: string | EncryptedTokenData;
};

// Re-export types
export type {
  LinearAdapterAPIKeyConfig,
  LinearAdapterClientCredentialsConfig,
  LinearAdapterConfig,
  LinearAdapterConnectConfig,
  LinearAdapterMode,
  LinearAdapterMultiTenantConfig,
  LinearAdapterOAuthConfig,
  LinearAgentSessionCommentRawMessage,
  LinearClientCredentialsConfig,
  LinearCommentRawMessage,
  LinearInstallation,
  LinearOAuthCallbackOptions,
  LinearRawMessage,
  LinearThreadId,
  LinearWebhookVerifier,
} from "./types";
export { assertAgentSessionThread } from "./utils";

/**
 * Normalize an `accessToken` config value (string or resolver) to an async
 * resolver invoked per API call.
 */
function normalizeAccessTokenProvider(
  value: string | (() => string | Promise<string>)
): () => Promise<string> {
  if (typeof value === "function") {
    return async () => await value();
  }
  return () => Promise.resolve(value);
}

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

  /**
   * The underlying [`LinearClient`](https://github.com/linear/linear/tree/master/packages/sdk)
   * from `@linear/sdk`, authenticated with the credentials this adapter was
   * configured with. Use this for any Linear API call that isn't covered by
   * the unified Chat SDK surface.
   *
   * Resolution rules:
   * - **API key**, **access token**, and **single-tenant client-credentials**
   *   modes: always returns the same client instance.
   * - **Multi-tenant OAuth** mode: returns the client for the current
   *   webhook request's organization, resolved from `AsyncLocalStorage`.
   *   Calling this getter outside a webhook handler throws, since there is
   *   no organization token to authenticate as.
   *
   * @throws {ValidationError} In multi-tenant OAuth mode when called outside
   * a webhook handler (no per-org installation is in scope).
   *
   * @example
   * ```ts
   * const linear = bot.getAdapter("linear").linearClient;
   * const issue = await linear.issue("ENG-123");
   * const project = await issue.project;
   * ```
   */
  get linearClient(): LinearClient {
    return this.getClient();
  }

  /**
   * @deprecated Use {@link LinearAdapter.linearClient | `linearClient`}
   * instead. This alias is preserved for backwards compatibility and will be
   * removed in a future major release.
   */
  get client(): LinearClient {
    return this.linearClient;
  }

  protected readonly mode: LinearAdapterMode;
  protected readonly webhookSecret?: string;
  protected readonly webhookVerifier?: LinearWebhookVerifier;
  // Vercel Connect access-token resolver (Connect mode only)
  protected readonly accessTokenProvider: (() => Promise<string>) | null = null;
  protected chat: ChatInstance | null = null;
  protected readonly logger: Logger;
  protected defaultBotUserId: string | null = null;
  protected defaultOrganizationId: string | null = null;
  protected readonly formatConverter = new LinearFormatConverter();
  protected readonly requestContext =
    new AsyncLocalStorage<LinearRequestContext>();

  protected defaultClient: LinearClient | null = null;
  protected readonly oauthClientId: string | null = null;
  protected readonly oauthClientSecret: string | null = null;
  protected readonly clientCredentials: {
    clientId: string;
    clientSecret: string;
    scopes: string[];
  } | null = null;
  protected accessTokenExpiry: number | null = null;
  // Custom API base URL
  protected readonly apiUrl?: string;
  // Optional AES-256-GCM key for encrypting OAuth tokens at rest
  protected readonly encryptionKey: Buffer | undefined;

  constructor(config: LinearAdapterConfig = {} as LinearAdapterAutoConfig) {
    const webhookVerifier = config.webhookVerifier;
    // webhookVerifier takes precedence over webhookSecret (config) and the
    // LINEAR_WEBHOOK_SECRET env var. When a verifier is configured we ignore
    // both so an env-configured deployment can't silently shadow it.
    const webhookSecret = webhookVerifier
      ? undefined
      : (config.webhookSecret ?? process.env.LINEAR_WEBHOOK_SECRET);
    if (!(webhookSecret || webhookVerifier)) {
      throw new ValidationError(
        "linear",
        "webhookSecret or webhookVerifier is required. Set LINEAR_WEBHOOK_SECRET, provide webhookSecret in config, or provide a webhookVerifier."
      );
    }
    this.webhookSecret = webhookSecret;
    this.webhookVerifier = webhookVerifier;
    this.logger = config.logger ?? new ConsoleLogger("info").child("linear");
    this.mode = config.mode ?? "comments";
    this.userName =
      config.userName ?? process.env.LINEAR_BOT_USERNAME ?? "linear-bot";
    this.apiUrl = config.apiUrl ?? process.env.LINEAR_API_URL;
    const encryptionKey =
      config.encryptionKey ?? process.env.LINEAR_ENCRYPTION_KEY;
    if (encryptionKey) {
      this.encryptionKey = decodeKey(encryptionKey);
    }

    if ("apiKey" in config && config.apiKey) {
      this.defaultClient = new LinearClient({
        apiKey: config.apiKey,
        ...(this.apiUrl ? { apiUrl: this.apiUrl } : {}),
      });
      return;
    }

    if ("accessToken" in config && config.accessToken) {
      // Function form (e.g. Vercel Connect): resolve a fresh token per call.
      if (typeof config.accessToken === "function") {
        this.accessTokenProvider = normalizeAccessTokenProvider(
          config.accessToken
        );
        return;
      }
      this.defaultClient = new LinearClient({
        accessToken: config.accessToken,
        ...(this.apiUrl ? { apiUrl: this.apiUrl } : {}),
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
      this.defaultClient = new LinearClient({
        apiKey,
        ...(this.apiUrl ? { apiUrl: this.apiUrl } : {}),
      });
      return;
    }

    const accessToken = process.env.LINEAR_ACCESS_TOKEN;
    if (accessToken) {
      this.defaultClient = new LinearClient({
        accessToken,
        ...(this.apiUrl ? { apiUrl: this.apiUrl } : {}),
      });
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
    } else if (this.accessTokenProvider) {
      // Vercel Connect mode: resolve a token once to detect the bot identity
      // so self-message detection works. If this fails (e.g. transient network
      // error at startup), it is retried lazily on the first webhook.
      try {
        await this.resolveConnectIdentity();
        this.logger.info("Linear auth completed (Vercel Connect)", {
          botUserId: this.defaultBotUserId,
          organizationId: this.defaultOrganizationId,
        });
      } catch (error) {
        this.logger.warn(
          "Could not fetch Linear bot user ID (Vercel Connect); will retry on first webhook",
          { error }
        );
      }
    } else if (this.isMultiTenantMode()) {
      this.logger.info("Linear adapter initialized in multi-tenant mode");
    }
  }

  /** Whether the adapter sources tokens from Vercel Connect (function form). */
  protected isConnectMode(): boolean {
    return this.accessTokenProvider !== null;
  }

  /**
   * Build a LinearClient for a resolved Connect token. Not cached: Connect
   * tokens are short-lived and rotate, and the `@vercel/connect` SDK already
   * caches the underlying token fetch, so a fresh client per call is cheap and
   * avoids unbounded growth from accumulating per-token clients.
   */
  protected getConnectClient(token: string): LinearClient {
    return new LinearClient({
      accessToken: token,
      ...(this.apiUrl ? { apiUrl: this.apiUrl } : {}),
    });
  }

  /**
   * Resolve and cache the bot identity (user id + organization id) for Vercel
   * Connect mode by minting a token and querying the viewer. Idempotent-ish:
   * callers gate on {@link defaultBotUserId} being unset.
   */
  protected async resolveConnectIdentity(): Promise<void> {
    const provider = this.accessTokenProvider;
    if (!provider) {
      return;
    }
    const token = await provider();
    const identity = await this.fetchClientIdentity(
      this.getConnectClient(token)
    );
    this.defaultBotUserId = identity.botUserId;
    this.defaultOrganizationId = identity.organizationId;
  }

  /**
   * Run a function with a freshly-resolved Connect client bound to the request
   * context, so getClient()/organizationId/botUserId resolve correctly.
   */
  protected async withConnectClient<T>(
    organizationId: string | undefined,
    fn: () => Promise<T> | T
  ): Promise<T> {
    const provider = this.accessTokenProvider;
    if (!provider) {
      return await fn();
    }

    // Lazily (re)resolve the bot identity if a prior attempt (e.g. at init)
    // failed, so we never bind an empty botUserId (which would disable
    // self-message detection or throw in the botUserId getter).
    if (this.defaultBotUserId === null) {
      try {
        await this.resolveConnectIdentity();
      } catch (error) {
        this.logger.warn(
          "Could not resolve Linear bot identity for Vercel Connect webhook",
          { error }
        );
      }
    }

    if (!this.defaultBotUserId) {
      throw new AuthenticationError(
        "linear",
        "No Linear bot identity available in Vercel Connect mode. The viewer lookup failed — check the connector token and its scopes."
      );
    }

    const token = await provider();
    const client = this.getConnectClient(token);
    const installation: LinearInstallation = {
      accessToken: token,
      botUserId: this.defaultBotUserId,
      expiresAt: null,
      organizationId: organizationId ?? this.defaultOrganizationId ?? "",
    };
    return await this.requestContext.run(
      { client, installation },
      async () => await fn()
    );
  }

  protected normalizeClientCredentials(
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

  /**
   * Get a Linear client for the current request context, or the default client in single-tenant mode.
   */
  protected getClient(): LinearClient {
    const context = this.requestContext.getStore();
    if (context?.client) {
      return context.client;
    }

    if (this.defaultClient) {
      return this.defaultClient;
    }

    throw new AuthenticationError(
      "linear",
      "No Linear access token available. In multi-tenant or Vercel Connect mode, ensure the webhook is being processed, or wrap the call in withInstallation() for out-of-webhook operations (cron jobs, workflows)."
    );
  }

  /**
   * Get the organization ID for the current request context, or the default organization ID in single-tenant mode.
   */
  protected get organizationId(): string {
    const organizationId =
      this.requestContext.getStore()?.installation.organizationId ??
      this.defaultOrganizationId;

    if (!organizationId) {
      throw new AuthenticationError(
        "linear",
        "No Linear organization ID available. Ensure the adapter has been initialized or use withInstallation()."
      );
    }

    return organizationId;
  }

  /**
   * Get the user ID of the chat bot.
   */
  get botUserId(): string {
    const id =
      this.requestContext.getStore()?.installation.botUserId ??
      this.defaultBotUserId;

    if (!id) {
      throw new AdapterError(
        "No bot user ID available in context. Ensure the adapter has been initialized and authenticated properly.",
        "linear"
      );
    }

    return id;
  }

  protected isMultiTenantMode(): boolean {
    return Boolean(this.oauthClientId && this.oauthClientSecret);
  }

  protected installationKey(organizationId: string): string {
    return `${INSTALLATION_KEY_PREFIX}:${organizationId}`;
  }

  /**
   * Save a Linear installation for a given organization ID. Used in multi-tenant mode after successful OAuth exchange.
   */
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

    const dataToStore = this.encryptInstallation(installation);
    await this.chat
      .getState()
      .set(this.installationKey(organizationId), dataToStore);
    this.logger.info("Linear installation saved", { organizationId });
  }

  /**
   * Get a Linear installation for a given organization ID in multi-tenant mode.
   */
  async getInstallation(
    organizationId: string
  ): Promise<LinearInstallation | null> {
    if (!this.chat) {
      throw new ValidationError(
        "linear",
        "Adapter not initialized. Ensure chat.initialize() has been called first."
      );
    }

    const contextInstallation = this.requestContext.getStore();
    if (
      contextInstallation &&
      contextInstallation.installation.organizationId === organizationId
    ) {
      // Optimization to avoid fetching from state if we already have the installation in the request context (e.g. in webhook handlers)
      return contextInstallation.installation;
    }

    const stored = await this.chat
      .getState()
      .get<StoredLinearInstallation>(this.installationKey(organizationId));

    if (!stored) {
      return null;
    }

    return this.decryptInstallation(stored);
  }

  /**
   * Encrypt installation tokens before persisting to the state store, if an
   * encryption key is configured. Without a key, the installation is stored
   * as-is (legacy behavior, with a warning logged at construction time
   * elsewhere is left to the deployer's discretion).
   */
  protected encryptInstallation(
    installation: LinearInstallation
  ): StoredLinearInstallation {
    if (!this.encryptionKey) {
      return installation;
    }
    return {
      ...installation,
      accessToken: encryptToken(installation.accessToken, this.encryptionKey),
      ...(installation.refreshToken
        ? {
            refreshToken: encryptToken(
              installation.refreshToken,
              this.encryptionKey
            ),
          }
        : {}),
    };
  }

  /**
   * Decrypt installation tokens from the state store. Tolerates plaintext
   * values (legacy installs from before encryption was enabled) so rotating
   * keys in is non-breaking.
   */
  protected decryptInstallation(
    stored: StoredLinearInstallation
  ): LinearInstallation {
    const accessToken = this.maybeDecrypt(stored.accessToken);
    const refreshToken =
      stored.refreshToken === undefined
        ? undefined
        : this.maybeDecrypt(stored.refreshToken);
    return {
      botUserId: stored.botUserId,
      expiresAt: stored.expiresAt,
      organizationId: stored.organizationId,
      accessToken,
      ...(refreshToken !== undefined ? { refreshToken } : {}),
    };
  }

  protected maybeDecrypt(value: string | EncryptedTokenData): string {
    if (this.encryptionKey && isEncryptedTokenData(value)) {
      return decryptToken(value, this.encryptionKey);
    }
    return value as string;
  }

  /**
   * Delete a Linear installation for a given organization ID in multi-tenant mode. Used for uninstall handling.
   */
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

  async getUser(userId: string): Promise<UserInfo | null> {
    try {
      await this.ensureValidToken();
      const user = await this.getClient().user(userId);
      return {
        avatarUrl: user.avatarUrl ?? undefined,
        email: user.email ?? undefined,
        fullName: user.name,
        isBot: false,
        userId: user.id,
        userName: user.displayName,
      };
    } catch {
      return null;
    }
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

    const client = new LinearClient({
      accessToken: token.access_token,
      ...(this.apiUrl ? { apiUrl: this.apiUrl } : {}),
    });
    const identity = await this.fetchClientIdentity(client);
    const installation: LinearInstallation = {
      accessToken: token.access_token,
      botUserId: identity.botUserId,
      expiresAt: calculateExpiry(token.expires_in),
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
    organizationId: string | LinearInstallation,
    fn: () => Promise<T> | T
  ): Promise<T> {
    // Vercel Connect mode: resolve a fresh token and bind a request-scoped
    // client so outbound calls work outside webhook handling (cron, workflows).
    if (this.isConnectMode()) {
      const orgId =
        typeof organizationId === "string"
          ? organizationId
          : organizationId.organizationId;
      return await this.withConnectClient(orgId, fn);
    }

    if (!this.isMultiTenantMode()) {
      return await fn();
    }

    const installation =
      typeof organizationId === "string"
        ? await this.requireInstallation(organizationId)
        : await this.refreshInstallation(organizationId);
    const context: LinearRequestContext = {
      installation,
      client: new LinearClient({
        accessToken: installation.accessToken,
        ...(this.apiUrl ? { apiUrl: this.apiUrl } : {}),
      }),
    };

    return await this.requestContext.run(context, async () => await fn());
  }

  /**
   * Get the identity of an authenticated client.
   */
  protected async fetchClientIdentity(client: LinearClient): Promise<{
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

  /**
   * Fetch an OAuth token from Linear.
   */
  protected async fetchOAuthToken(
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

  /**
   * Refresh the access token for a given installation if it's close to expiry. Returns the refreshed installation.
   */
  async refreshInstallation(
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
      expiresAt: calculateExpiry(token.expires_in),
      refreshToken: token.refresh_token ?? installation.refreshToken,
    };

    await this.setInstallation(
      installation.organizationId,
      refreshedInstallation
    );
    return refreshedInstallation;
  }

  /**
   * Get the current installation for an organization, throwing if not found.
   * Used in multi-tenant mode to ensure a valid installation is available in webhook handlers and withInstallation().
   */
  protected async requireInstallation(
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
  protected async refreshClientCredentialsToken(): Promise<void> {
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

    this.defaultClient = new LinearClient({
      accessToken: data.access_token,
      ...(this.apiUrl ? { apiUrl: this.apiUrl } : {}),
    });

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
  protected async ensureValidToken(): Promise<void> {
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
   * Parse a comment from the Linear SDK into a chat message.
   */
  protected async parseMessageFromComment(
    comment: Comment,
    issueId: string,
    agentSessionId?: string
  ): Promise<Message<LinearRawMessage>> {
    let user: LinearActorData;
    if (comment.userId) {
      const fetchedUser = await comment.user;
      if (!fetchedUser) {
        throw new AdapterError(
          `User with ID ${comment.userId} not found for comment ${comment.id}`,
          "linear"
        );
      }
      user = {
        type: "user",
        id: fetchedUser.id,
        displayName: fetchedUser.displayName,
        fullName: fetchedUser.name,
        email: fetchedUser.email,
        avatarUrl: fetchedUser.avatarUrl ?? undefined,
      };
    } else {
      // If the comment has no userId, it was likely created by an app. Use the bot user as fallback.
      const botActor = await comment.botActor;
      if (!botActor) {
        throw new AdapterError(
          `Comment ${comment.id} has no userId and no botActor, cannot determine author.`,
          "linear"
        );
      }
      user = {
        type: "bot",
        id: botActor.id ?? this.botUserId,
        displayName: botActor.userDisplayName ?? botActor.name ?? "unknown",
        fullName: botActor.name ?? botActor.userDisplayName ?? "unknown",
        email: undefined,
        avatarUrl: botActor.avatarUrl ?? undefined,
      };
    }

    const commentData: LinearCommentData = {
      id: comment.id,
      body: comment.body,
      issueId,
      user,
      parentId: comment.parentId ?? undefined,
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
      url: comment.url ?? undefined,
    };

    return this.parseMessage(
      agentSessionId
        ? {
            kind: "agent_session_comment",
            comment: commentData,
            agentSessionId,
            organizationId: this.organizationId,
          }
        : {
            kind: "comment",
            comment: commentData,
            organizationId: this.organizationId,
          }
    );
  }

  /**
   * Parse an agent session event from a Linear webhook into a chat message, if applicable.
   */
  protected parseMessageFromAgentSessionEvent(
    payload: AgentSessionEventWebhookPayload
  ): Message<LinearRawMessage> | null {
    const issueId =
      payload.agentSession.issueId ?? payload.agentSession.issue?.id;
    if (!issueId) {
      return null;
    }

    //
    // When user is posting a new message in an agent session thread
    //
    if (payload.action === "prompted") {
      const { agentActivity } = payload;
      if (!agentActivity) {
        this.logger.warn("Missing agent activity for prompted action", {
          agentSessionId: payload.agentSession.id,
        });
        return null;
      }

      if (!agentActivity.sourceCommentId) {
        this.logger.warn("Missing source comment ID for agent activity", {
          agentSessionId: payload.agentSession.id,
          agentActivityId: agentActivity.id,
        });
        return null;
      }

      const content = agentActivity.content as { type: "prompt"; body: string };
      const commentData: LinearCommentData = {
        id: agentActivity.sourceCommentId,
        body: content.body,
        issueId,
        user: {
          type: "user",
          id: agentActivity.user.id,
          displayName: getUserNameFromProfileUrl(agentActivity.user.url),
          fullName: agentActivity.user.name,
          email: agentActivity.user.email,
          avatarUrl: agentActivity.user.avatarUrl ?? undefined,
        },
        parentId: payload.agentSession.comment?.id,
        createdAt: agentActivity.createdAt,
        updatedAt: agentActivity.createdAt,
        url: payload.agentSession.url ?? undefined,
      };

      return this.parseMessage({
        kind: "agent_session_comment",
        organizationId: payload.organizationId,
        comment: commentData,
        agentSessionId: payload.agentSession.id,
        agentSessionPromptContext: payload.promptContext ?? undefined,
      });
    }

    //
    // When user is mentioning the bot in an issue, creating a new agent session and posting the first message
    //
    if (payload.action === "created") {
      const { agentSession } = payload;

      if (agentSession.appUserId !== this.botUserId) {
        this.logger.warn("Ignoring agent session event from another bot", {
          agentSessionId: payload.agentSession.id,
          appUserId: agentSession.appUserId,
        });
        return null;
      }

      if (!agentSession.comment) {
        this.logger.warn("Missing comment for agent session", {
          agentSessionId: payload.agentSession.id,
        });
        return null;
      }

      const commentData: LinearCommentData = {
        id: agentSession.comment.id,
        body: agentSession.comment.body,
        issueId,
        user: agentSession.creator
          ? {
              type: "user",
              id: agentSession.creator.id,
              displayName: getUserNameFromProfileUrl(agentSession.creator.url),
              fullName: agentSession.creator.name,
              email: agentSession.creator.email,
              avatarUrl: agentSession.creator.avatarUrl ?? undefined,
            }
          : {
              type: "bot",
              id: this.botUserId,
              displayName: this.userName,
              fullName: this.userName,
              email: undefined,
              avatarUrl: undefined,
            },
        parentId: undefined,
        // @ts-expect-error - @linear/sdk types are incorrect as they don't transform string dates to Date objects for webhook payloads
        createdAt: payload.createdAt,
        // @ts-expect-error - @linear/sdk types are incorrect as they don't transform string dates to Date objects for webhook payloads
        updatedAt: payload.createdAt,
        url: payload.agentSession.url ?? undefined,
      };

      return this.parseMessage({
        kind: "agent_session_comment",
        organizationId: payload.organizationId,
        comment: commentData,
        agentSessionId: payload.agentSession.id,
        agentSessionPromptContext: payload.promptContext ?? undefined,
      });
    }

    this.logger.warn("Unsupported agent session event action", {
      action: payload.action,
      agentSessionId: payload.agentSession.id,
      issueId,
    });
    return null;
  }

  /**
   * Create a a chat raw message for a Linear agent activity.
   */
  protected async parseMessageFromAgentActivity(
    threadId: LinearAgentSessionThreadId,
    result: AgentActivityPayload
  ): Promise<RawMessage<LinearRawMessage>> {
    const activity = await result.agentActivity;
    if (!(result.success && activity)) {
      throw new AdapterError(
        `Failed to create Linear agent activity for session ${threadId.agentSessionId}`,
        "linear"
      );
    }

    const sourceComment = await activity.sourceComment;
    if (!sourceComment) {
      throw new AdapterError(
        `Failed to resolve source comment for Linear agent activity ${activity.id}`,
        "linear"
      );
    }

    if (!activity.agentSessionId) {
      throw new AdapterError(
        `Missing agentSessionId for Linear agent activity ${activity.id}`,
        "linear"
      );
    }

    return this.parseMessageFromComment(
      sourceComment,
      threadId.issueId,
      activity.agentSessionId
    );
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
    // Custom verifier (e.g. Vercel Connect OIDC) takes precedence over the
    // Linear webhook-secret signature check.
    if (this.webhookVerifier) {
      return await this.handleVerifiedWebhook(request, options);
    }

    const webhookHandler = new LinearWebhookClient(
      this.webhookSecret as string
    ).createHandler();

    webhookHandler.on(
      "OAuthApp",
      async (payload) => await this.onOAuthAppEvent(payload)
    );
    webhookHandler.on(
      "Comment",
      async (payload) => await this.onCommentEvent(payload, options)
    );
    webhookHandler.on(
      "AgentSessionEvent",
      async (payload) => await this.onAgentSessionEvent(payload, options)
    );
    webhookHandler.on(
      "Reaction",
      async (payload) => await this.onReactionEvent(payload)
    );

    return await webhookHandler(request);
  }

  /**
   * Handle a webhook verified by a custom `webhookVerifier` (no Linear
   * signing secret). Parses the body and dispatches the same event handlers
   * the signature path uses.
   */
  protected async handleVerifiedWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    const body = await request.text();

    let verified: unknown;
    try {
      verified = await this.webhookVerifier?.(request, body);
    } catch (error) {
      this.logger.warn("Linear webhook verifier rejected the request", {
        error,
      });
      return new Response("Invalid webhook", { status: 401 });
    }
    if (!verified) {
      return new Response("Invalid webhook", { status: 401 });
    }

    const rawBody = typeof verified === "string" ? verified : body;
    let payload: {
      type?: string;
      action?: string;
      organizationId?: string;
    };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("Invalid webhook", { status: 400 });
    }

    // Mirror @linear/sdk's LinearWebhookClient, which wraps dispatch in a
    // try/catch and returns 500 on a throwing handler. Without this, a handler
    // throw on the verifier path would escape as an unhandled rejection.
    try {
      await this.dispatchWebhookEvent(payload, options);
    } catch (error) {
      this.logger.error("Linear webhook handler failed", { error });
      return new Response("Internal server error", { status: 500 });
    }
    return new Response("OK", { status: 200 });
  }

  /**
   * Route a parsed webhook payload to the matching event handler. Used by the
   * custom-verifier path; the signature path dispatches via LinearWebhookClient.
   */
  protected async dispatchWebhookEvent(
    payload: { type?: string },
    options?: WebhookOptions
  ): Promise<void> {
    switch (payload.type) {
      case "OAuthApp":
        await this.onOAuthAppEvent(
          payload as { action: string; organizationId: string }
        );
        break;
      case "Comment":
        await this.onCommentEvent(
          payload as unknown as CommentWebhookPayload,
          options
        );
        break;
      case "AgentSessionEvent":
        await this.onAgentSessionEvent(
          payload as unknown as AgentSessionEventWebhookPayload,
          options
        );
        break;
      case "Reaction":
        await this.onReactionEvent(
          payload as unknown as ReactionWebhookPayload
        );
        break;
      default:
        this.logger.debug("Ignoring unhandled Linear webhook type", {
          type: payload.type,
        });
        break;
    }
  }

  protected async onOAuthAppEvent(payload: {
    action: string;
    organizationId: string;
  }): Promise<void> {
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
  }

  protected async onCommentEvent(
    payload: CommentWebhookPayload,
    options?: WebhookOptions
  ): Promise<void> {
    await this.withWebhookInstallation(payload.organizationId, () => {
      if (this.mode !== "comments" || payload.action !== "create") {
        return;
      }

      this.handleCommentCreated(payload, options);
    });
  }

  protected async onAgentSessionEvent(
    payload: AgentSessionEventWebhookPayload,
    options?: WebhookOptions
  ): Promise<void> {
    await this.withWebhookInstallation(payload.organizationId, () => {
      if (this.mode !== "agent-sessions") {
        this.logger.warn(
          "Received AgentSessionEvent webhook but adapter is not in agent-sessions mode, ignoring"
        );
        return;
      }

      this.handleAgentSessionEvent(payload, options);
    });
  }

  protected async onReactionEvent(
    payload: ReactionWebhookPayload
  ): Promise<void> {
    await this.withWebhookInstallation(payload.organizationId, () => {
      this.handleReaction(payload);
    });
  }

  /**
   * Run a webhook handler function with the appropriate installation context based on the organization ID in the payload.
   */
  protected async withWebhookInstallation(
    organizationId: string,
    fn: () => Promise<void> | void
  ): Promise<void> {
    if (this.isConnectMode()) {
      await this.withConnectClient(organizationId, fn);
      return;
    }

    if (!this.isMultiTenantMode()) {
      return await fn();
    }

    const installation = await this.getInstallation(organizationId);
    if (!installation) {
      this.logger.warn("No Linear installation found for organization", {
        organizationId,
      });
      return;
    }
    await this.withInstallation(installation, fn);
  }

  /**
   * Handle a new comment created on an issue.
   *
   * Threading logic:
   * - If the comment has a parentId, it's a reply -> thread under the parent (root comment)
   * - If no parentId, this is a root comment -> thread under this comment's own ID
   */
  protected handleCommentCreated(
    payload: CommentWebhookPayload,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring comment");
      return;
    }

    const { data } = payload;

    // Skip if the comment has no issueId (e.g., project update comment)
    if (!data.issueId) {
      this.logger.debug("Ignoring non-issue comment", {
        commentId: data.id,
      });
      return;
    }
    if (!data.user) {
      this.logger.debug("Ignoring comment with no user", {
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
      user: {
        type: "user",
        id: data.user.id,
        displayName: getUserNameFromProfileUrl(data.user.url),
        fullName: data.user.name,
        email: data.user.email,
        avatarUrl: data.user.avatarUrl ?? undefined,
      },
    };

    // Build message
    const message = this.parseMessage({
      kind: "comment",
      comment,
      organizationId: payload.organizationId,
    });

    this.chat.processMessage(this, threadId, message, options);
  }

  /**
   * Handle a new event in an agent session thread. This can be either:
   * - A user posting a new message in an existing agent session thread (prompted action)
   * - A user mentioning the bot in an issue, creating a new agent session and posting the first message (created action)
   */
  protected handleAgentSessionEvent(
    payload: AgentSessionEventWebhookPayload,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn(
        "Chat instance not initialized, ignoring agent session event"
      );
      return;
    }

    const message = this.parseMessageFromAgentSessionEvent(payload);
    if (!message) {
      this.logger.warn(
        "Unable to build message for Linear agent session event",
        {
          agentSessionId: payload.agentSession.id,
        }
      );
      return;
    }
    this.chat.processMessage(this, message.threadId, message, options);
  }

  /**
   * Handle reaction events (logging only - reactions don't include issueId).
   */
  protected handleReaction(payload: ReactionWebhookPayload): void {
    if (!this.chat) {
      return;
    }

    const { data } = payload;

    // Reactions on comments need a commentId to find the thread.
    // Since reaction webhooks don't include issueId directly,
    // we'd need an additional API call to look it up.
    this.logger.debug("Received reaction webhook", {
      reactionId: data.id,
      emoji: data.emoji,
      commentId: data.commentId,
      action: payload.action,
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
      return await this.parseMessageFromAgentActivity(
        decoded,
        await client.createAgentActivity({
          agentSessionId: decoded.agentSessionId,
          content: {
            type: AgentActivityType.Response,
            body,
          },
        })
      );
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

    return {
      id: comment.id,
      threadId,
      raw: {
        kind: "comment",
        comment: {
          id: comment.id,
          body: comment.body,
          issueId: decoded.issueId,
          parentId: decoded.commentId,
          user: {
            type: "bot",
            id: this.botUserId,
            displayName: this.userName,
            fullName: this.userName,
            email: undefined,
            avatarUrl: undefined,
          },
          createdAt: comment.createdAt.toISOString(),
          updatedAt: comment.updatedAt.toISOString(),
          url: comment.url,
        },
        organizationId: this.organizationId,
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

    return {
      id: comment.id,
      threadId,
      raw: {
        kind: "comment",
        comment: {
          id: comment.id,
          body: comment.body,
          issueId,
          parentId: comment.parentId ?? undefined,
          user: {
            type: "bot",
            id: this.botUserId,
            displayName: this.userName,
            fullName: this.userName,
            email: undefined,
            avatarUrl: undefined,
          },
          createdAt: comment.createdAt.toISOString(),
          updatedAt: comment.updatedAt.toISOString(),
          url: comment.url,
        },
        organizationId: this.organizationId,
      },
    };
  }

  /**
   * Delete a message (delete a comment).
   *
   * Uses LinearClient.deleteComment(id).
   */
  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const { agentSessionId } = this.decodeThreadId(threadId);
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

    if (decoded.agentSessionId) {
      await this.getClient().createAgentActivity({
        agentSessionId: decoded.agentSessionId,
        content: {
          type: AgentActivityType.Thought,
          body: status ?? "Thinking...",
        },
        ephemeral: true,
      });

      return;
    }

    this.logger.warn(
      "startTyping is only supported in agent session threads. Ignoring for comment thread."
    );
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
      return this.streamInAgentSession(decoded, textStream, options);
    }
    return this.streamAsComment(threadId, textStream, options);
  }

  /**
   * Stream text/chunk in an agent session.
   */
  protected async streamInAgentSession(
    decoded: LinearAgentSessionThreadId,
    textStream: AsyncIterable<string | StreamChunk>,
    _options?: StreamOptions
  ): Promise<RawMessage<LinearRawMessage>> {
    const renderer = new StreamingMarkdownRenderer();
    const client = this.getClient();
    assertAgentSessionThread(decoded);

    let lastAppended = "";

    /** Flush the current markdown buffer into a new agent activity */
    const flushMarkdown = async (
      type: AgentActivityType.Response | AgentActivityType.Thought,
      markdown: string = renderer.getCommittableText(),
      force = false
    ) => {
      const delta = markdown.slice(lastAppended.length).trim();
      if (delta || force) {
        lastAppended = markdown;
        return await client.createAgentActivity({
          agentSessionId: decoded.agentSessionId,
          content: {
            type,
            body: delta,
          },
        });
      }
    };

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
        // Flush any buffered markdown before sending the action
        // We push it as thought to differentiate it from the main response content
        // This is a design choice and we might want to allow the caller to specify the type in the future
        await flushMarkdown(AgentActivityType.Thought);

        if (chunk.status === "error") {
          await client.createAgentActivity({
            agentSessionId: decoded.agentSessionId,
            content: {
              type: AgentActivityType.Error,
              body: [chunk.title, chunk.output].filter(Boolean).join("\n"),
            },
          });
        } else {
          await client.createAgentActivity({
            agentSessionId: decoded.agentSessionId,
            content: {
              type: AgentActivityType.Action,
              action: chunk.title,
              parameter: "",
              result: chunk.output,
            },
            ephemeral: chunk.status !== "complete",
          });
        }

        continue;
      }

      if (chunk.type === "plan_update") {
        // https://linear.app/developers/agent-interaction#agent-plans
        await this.getClient().updateAgentSession(decoded.agentSessionId, {
          plan: [
            {
              content: chunk.title,
              status: "completed",
            },
          ],
        });
      }
    }

    const finalActivity = await flushMarkdown(
      AgentActivityType.Response,
      renderer.finish(),
      true
    );
    if (!finalActivity) {
      throw new Error(
        "Failed to flush final markdown delta for agent session stream"
      );
    }

    return await this.parseMessageFromAgentActivity(decoded, finalActivity);
  }

  /**
   * Stream text/chunk as a comment.
   * It posts an initial comment immediately, then edits that comment as new chunks arrive.
   */
  protected async streamAsComment(
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
    const decoded = this.decodeThreadId(threadId);

    if (decoded.agentSessionId) {
      assertAgentSessionThread(decoded);
      return await this.fetchAgentSessionMessages(decoded, options);
    }

    if (decoded.commentId) {
      // Comment-level thread: fetch root comment's children
      return await this.fetchCommentThread(
        decoded.issueId,
        decoded.commentId,
        options
      );
    }

    // Issue-level thread: fetch all top-level comments
    return await this.fetchIssueComments(decoded.issueId, options);
  }

  /**
   * Fetch the visible comment thread associated with an agent session.
   */
  protected async fetchAgentSessionMessages(
    thread: LinearAgentSessionThreadId,
    options?: FetchOptions
  ): Promise<FetchResult<LinearRawMessage>> {
    const linear = this.getClient();
    const agentSession = await linear.agentSession(thread.agentSessionId);
    const issueId = agentSession.issueId ?? thread.issueId;
    if (!issueId) {
      throw new AdapterError(
        `Linear agent session ${thread.agentSessionId} is missing issueId`,
        "linear"
      );
    }

    const rootComment = await agentSession.comment;
    if (!rootComment) {
      throw new AdapterError(
        `Linear agent session ${thread.agentSessionId} is missing a root comment`,
        "linear"
      );
    }

    const childrenConnection = await linear.comments({
      filter: {
        parent: { id: { eq: rootComment.id } },
      },
      ...(options?.direction === "forward"
        ? {
            first: options?.limit ?? 50,
          }
        : {
            last: options?.limit ?? 50,
          }),
    });

    const messages = await this.commentsToMessages(
      [rootComment, ...childrenConnection.nodes],
      issueId,
      agentSession.id
    );

    return {
      messages,
      nextCursor: childrenConnection.pageInfo.hasNextPage
        ? (childrenConnection.pageInfo.endCursor ?? undefined)
        : undefined,
    };
  }

  /**
   * Fetch top-level comments on an issue.
   */
  protected async fetchIssueComments(
    issueId: string,
    options?: FetchOptions
  ): Promise<FetchResult<LinearRawMessage>> {
    const issue = await this.getClient().issue(issueId);
    const commentsConnection = await issue.comments({
      first: options?.limit ?? 50,
    });

    const messages = await this.commentsToMessages(
      commentsConnection.nodes,
      issueId,
      undefined
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
  protected async fetchCommentThread(
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

    // Include the root comment as the first message, then its children
    const rootMessages = await this.commentsToMessages(
      [rootComment],
      issueId,
      undefined
    );
    const childMessages = await this.commentsToMessages(
      childrenConnection.nodes,
      issueId,
      undefined
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
  protected async commentsToMessages(
    comments: Comment[],
    issueId: string,
    agentSessionId: string | undefined
  ): Promise<Message<LinearRawMessage>[]> {
    const messages: Message<LinearRawMessage>[] = [];

    for (const comment of comments) {
      messages.push(
        await this.parseMessageFromComment(comment, issueId, agentSessionId)
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
    const text = raw.comment.body;
    const formatted: FormattedContent = this.formatConverter.toAst(text);

    return new Message<LinearRawMessage>({
      id: raw.comment.id,
      isMention: raw.kind === "agent_session_comment", // Agent session comments are treated as mentions as they directly target the bot
      threadId: this.encodeThreadId({
        issueId: raw.comment.issueId,
        commentId: raw.comment.id,
        agentSessionId:
          raw.kind === "agent_session_comment" ? raw.agentSessionId : undefined,
      }),
      text,
      formatted,
      author: {
        userId: raw.comment.user.id,
        userName: raw.comment.user.displayName,
        fullName: raw.comment.user.fullName,
        isBot: raw.comment.user.type === "bot",
        isMe: raw.comment.user.id === this.botUserId,
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
  protected resolveEmoji(emoji: EmojiValue | string): string {
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

  async fetchSubject(raw: LinearRawMessage): Promise<MessageSubject | null> {
    const linearRaw = raw;
    const issueId = linearRaw.comment?.issueId;
    if (!issueId) {
      return null;
    }

    try {
      await this.ensureValidToken();
      const issue = await this.getClient().issue(issueId);
      const state = await issue.state;
      const assignee = await issue.assignee;
      const labelsConnection = await issue.labels();

      return {
        type: "issue",
        id: issue.identifier,
        title: issue.title,
        description: issue.description ?? undefined,
        status: state?.name,
        url: issue.url,
        assignee: assignee
          ? { id: assignee.id, name: assignee.displayName }
          : undefined,
        labels: labelsConnection.nodes.map((l) => l.name),
        raw: issue,
      };
    } catch (error) {
      this.logger.debug("Failed to fetch subject", { issueId, error });
      return null;
    }
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
