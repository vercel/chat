import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  AdapterRateLimitError,
  extractCard,
  extractFiles,
  NetworkError,
  toBuffer,
  ValidationError,
} from "@chat-adapter/shared";
import { WebClient } from "@slack/web-api";
import type {
  ActionEvent,
  Adapter,
  AdapterPostableMessage,
  Attachment,
  ChannelInfo,
  ChatInstance,
  EmojiValue,
  EphemeralMessage,
  FetchOptions,
  FetchResult,
  FileUpload,
  FormattedContent,
  ListThreadsOptions,
  ListThreadsResult,
  Logger,
  ModalElement,
  ModalResponse,
  RawMessage,
  ReactionEvent,
  StreamOptions,
  ThreadInfo,
  ThreadSummary,
  WebhookOptions,
} from "chat";

import {
  ChatError,
  ConsoleLogger,
  convertEmojiPlaceholders,
  defaultEmojiResolver,
  isJSX,
  Message,
  toModalElement,
} from "chat";
import { cardToBlockKit, cardToFallbackText } from "./cards";
import type { EncryptedTokenData } from "./crypto";
import {
  decodeKey,
  decryptToken,
  encryptToken,
  isEncryptedTokenData,
} from "./crypto";
import { SlackFormatConverter } from "./markdown";
import {
  decodeModalMetadata,
  encodeModalMetadata,
  modalToSlackView,
  type SlackModalResponse,
} from "./modals";

export interface SlackAdapterConfig {
  /** Bot token (xoxb-...). Required for single-workspace mode. Omit for multi-workspace. */
  botToken?: string;
  /** Bot user ID (will be fetched if not provided) */
  botUserId?: string;
  /** Slack app client ID (required for OAuth / multi-workspace) */
  clientId?: string;
  /** Slack app client secret (required for OAuth / multi-workspace) */
  clientSecret?: string;
  /**
   * Base64-encoded 32-byte AES-256-GCM encryption key.
   * If provided, bot tokens stored via setInstallation() will be encrypted at rest.
   */
  encryptionKey?: string;
  /** Logger instance for error reporting */
  logger: Logger;
  /** Signing secret for webhook verification */
  signingSecret: string;
  /** Override bot username (optional) */
  userName?: string;
}

/** Data stored per Slack workspace installation */
export interface SlackInstallation {
  botToken: string;
  botUserId?: string;
  teamName?: string;
}

/** Slack-specific thread ID data */
export interface SlackThreadId {
  channel: string;
  threadTs: string;
}

/** Slack event payload (raw message format) */
export interface SlackEvent {
  bot_id?: string;
  channel?: string;
  /** Channel type: "channel", "group", "mpim", or "im" (DM) */
  channel_type?: string;
  edited?: { ts: string };
  files?: Array<{
    id?: string;
    mimetype?: string;
    url_private?: string;
    name?: string;
    size?: number;
    original_w?: number;
    original_h?: number;
  }>;
  /** Timestamp of the latest reply (present on thread parent messages) */
  latest_reply?: string;
  /** Number of replies in the thread (present on thread parent messages) */
  reply_count?: number;
  subtype?: string;
  team?: string;
  team_id?: string;
  text?: string;
  thread_ts?: string;
  ts?: string;
  type: string;
  user?: string;
  username?: string;
}

/** Slack reaction event payload */
export interface SlackReactionEvent {
  event_ts: string;
  item: {
    type: string;
    channel: string;
    ts: string;
  };
  item_user?: string;
  reaction: string;
  type: "reaction_added" | "reaction_removed";
  user: string;
}

/** Slack assistant_thread_started event payload */
interface SlackAssistantThreadStartedEvent {
  assistant_thread: {
    user_id: string;
    channel_id: string;
    thread_ts: string;
    context: {
      channel_id?: string;
      team_id?: string;
      enterprise_id?: string;
      thread_entry_point?: string;
      force_search?: boolean;
    };
  };
  event_ts: string;
  type: "assistant_thread_started";
}

/** Slack assistant_thread_context_changed event payload */
interface SlackAssistantContextChangedEvent {
  assistant_thread: {
    user_id: string;
    channel_id: string;
    thread_ts: string;
    context: {
      channel_id?: string;
      team_id?: string;
      enterprise_id?: string;
      thread_entry_point?: string;
      force_search?: boolean;
    };
  };
  event_ts: string;
  type: "assistant_thread_context_changed";
}

/** Slack app_home_opened event payload */
interface SlackAppHomeOpenedEvent {
  channel: string;
  event_ts: string;
  tab: string;
  type: "app_home_opened";
  user: string;
}

/** Slack webhook payload envelope */
interface SlackWebhookPayload {
  challenge?: string;
  event?:
    | SlackEvent
    | SlackReactionEvent
    | SlackAssistantThreadStartedEvent
    | SlackAssistantContextChangedEvent
    | SlackAppHomeOpenedEvent;
  event_id?: string;
  event_time?: number;
  team_id?: string;
  type: string;
}

/** Slack interactive payload (block_actions) for button clicks */
interface SlackBlockActionsPayload {
  actions: Array<{
    type: string;
    action_id: string;
    block_id?: string;
    value?: string;
    action_ts?: string;
    selected_option?: { value: string };
  }>;
  channel: {
    id: string;
    name: string;
  };
  container: {
    type: string;
    message_ts: string;
    channel_id: string;
    is_ephemeral?: boolean;
    thread_ts?: string;
  };
  message: {
    ts: string;
    thread_ts?: string;
  };
  response_url?: string;
  trigger_id: string;
  type: "block_actions";
  user: {
    id: string;
    username: string;
    name?: string;
  };
}

interface SlackViewSubmissionPayload {
  trigger_id: string;
  type: "view_submission";
  user: {
    id: string;
    username: string;
    name?: string;
  };
  view: {
    id: string;
    callback_id: string;
    private_metadata?: string;
    state: {
      values: Record<
        string,
        Record<string, { value?: string; selected_option?: { value: string } }>
      >;
    };
  };
}

interface SlackViewClosedPayload {
  type: "view_closed";
  user: {
    id: string;
    username: string;
    name?: string;
  };
  view: {
    id: string;
    callback_id: string;
    private_metadata?: string;
  };
}

type SlackInteractivePayload =
  | SlackBlockActionsPayload
  | SlackViewSubmissionPayload
  | SlackViewClosedPayload;

/** Cached user info */
interface CachedUser {
  displayName: string;
  realName: string;
}

export class SlackAdapter implements Adapter<SlackThreadId, unknown> {
  readonly name = "slack";
  readonly userName: string;

  private readonly client: WebClient;
  private readonly signingSecret: string;
  private readonly defaultBotToken: string | undefined;
  private chat: ChatInstance | null = null;
  private readonly logger: Logger;
  private _botUserId: string | null = null;
  private _botId: string | null = null; // Bot app ID (B_xxx) - different from user ID
  private readonly formatConverter = new SlackFormatConverter();
  private static USER_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  // Multi-workspace support
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly encryptionKey: Buffer | undefined;
  private readonly requestContext = new AsyncLocalStorage<{
    token: string;
    botUserId?: string;
  }>();

  /** Bot user ID (e.g., U_BOT_123) used for mention detection */
  get botUserId(): string | undefined {
    const ctx = this.requestContext.getStore();
    if (ctx?.botUserId) {
      return ctx.botUserId;
    }
    return this._botUserId || undefined;
  }

  constructor(config: SlackAdapterConfig) {
    this.client = new WebClient(config.botToken);
    this.signingSecret = config.signingSecret;
    this.defaultBotToken = config.botToken;
    this.logger = config.logger;
    this.userName = config.userName || "bot";
    this._botUserId = config.botUserId || null;

    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;

    if (config.encryptionKey) {
      this.encryptionKey = decodeKey(config.encryptionKey);
    }
  }

  /**
   * Get the current bot token for API calls.
   * Checks request context (multi-workspace) → default token (single-workspace) → throws.
   */
  private getToken(): string {
    const ctx = this.requestContext.getStore();
    if (ctx?.token) {
      return ctx.token;
    }
    if (this.defaultBotToken) {
      return this.defaultBotToken;
    }
    throw new ChatError(
      "No bot token available. In multi-workspace mode, ensure the webhook is being processed.",
      "MISSING_BOT_TOKEN"
    );
  }

  /**
   * Add the current token to API call options.
   * Workaround for Slack WebClient types not including `token` in per-method args.
   */
  // biome-ignore lint/suspicious/noExplicitAny: Slack types don't include token in method args
  private withToken<T extends Record<string, any>>(
    options: T
  ): T & { token: string } {
    return { ...options, token: this.getToken() };
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    // Only fetch bot user ID in single-workspace mode (when default token is available)
    if (this.defaultBotToken && !this._botUserId) {
      try {
        const authResult = await this.client.auth.test(this.withToken({}));
        this._botUserId = authResult.user_id as string;
        this._botId = (authResult.bot_id as string) || null;
        if (authResult.user) {
          (this as { userName: string }).userName = authResult.user as string;
        }
        this.logger.info("Slack auth completed", {
          botUserId: this._botUserId,
          botId: this._botId,
        });
      } catch (error) {
        this.logger.warn("Could not fetch bot user ID", { error });
      }
    }

    if (!this.defaultBotToken) {
      this.logger.info("Slack adapter initialized in multi-workspace mode");
    }
  }

  // ===========================================================================
  // Multi-workspace installation management
  // ===========================================================================

  private installationKey(teamId: string): string {
    return `slack:installation:${teamId}`;
  }

  /**
   * Save a Slack workspace installation.
   * Call this from your OAuth callback route after a successful installation.
   */
  async setInstallation(
    teamId: string,
    installation: SlackInstallation
  ): Promise<void> {
    if (!this.chat) {
      throw new ChatError(
        "Adapter not initialized. Ensure chat.initialize() has been called first.",
        "NOT_INITIALIZED"
      );
    }

    const state = this.chat.getState();
    const key = this.installationKey(teamId);

    const dataToStore = this.encryptionKey
      ? {
          ...installation,
          botToken: encryptToken(installation.botToken, this.encryptionKey),
        }
      : installation;

    await state.set(key, dataToStore);
    this.logger.info("Slack installation saved", {
      teamId,
      teamName: installation.teamName,
    });
  }

  /**
   * Retrieve a Slack workspace installation.
   */
  async getInstallation(teamId: string): Promise<SlackInstallation | null> {
    if (!this.chat) {
      throw new ChatError(
        "Adapter not initialized. Ensure chat.initialize() has been called first.",
        "NOT_INITIALIZED"
      );
    }

    const state = this.chat.getState();
    const key = this.installationKey(teamId);
    const stored = await state.get<
      | SlackInstallation
      | (Omit<SlackInstallation, "botToken"> & {
          botToken: EncryptedTokenData;
        })
    >(key);

    if (!stored) {
      return null;
    }

    if (this.encryptionKey && isEncryptedTokenData(stored.botToken)) {
      return {
        ...stored,
        botToken: decryptToken(
          stored.botToken as EncryptedTokenData,
          this.encryptionKey
        ),
      };
    }

    return stored as SlackInstallation;
  }

  /**
   * Handle the Slack OAuth V2 callback.
   * Accepts the incoming request, extracts the authorization code,
   * exchanges it for tokens, and saves the installation.
   */
  async handleOAuthCallback(
    request: Request
  ): Promise<{ teamId: string; installation: SlackInstallation }> {
    if (!(this.clientId && this.clientSecret)) {
      throw new ChatError(
        "clientId and clientSecret are required for OAuth. Pass them in createSlackAdapter().",
        "MISSING_OAUTH_CONFIG"
      );
    }

    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    if (!code) {
      throw new ChatError(
        "Missing 'code' query parameter in OAuth callback request.",
        "MISSING_OAUTH_CODE"
      );
    }

    const redirectUri = url.searchParams.get("redirect_uri") ?? undefined;

    const result = await this.client.oauth.v2.access({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: redirectUri,
    });

    if (!(result.ok && result.access_token && result.team?.id)) {
      throw new ChatError(
        `Slack OAuth failed: ${result.error || "missing access_token or team.id"}`,
        "OAUTH_FAILED"
      );
    }

    const teamId = result.team.id;
    const installation: SlackInstallation = {
      botToken: result.access_token,
      botUserId: result.bot_user_id,
      teamName: result.team.name,
    };

    await this.setInstallation(teamId, installation);

    return { teamId, installation };
  }

  /**
   * Remove a Slack workspace installation.
   */
  async deleteInstallation(teamId: string): Promise<void> {
    if (!this.chat) {
      throw new ChatError(
        "Adapter not initialized. Ensure chat.initialize() has been called first.",
        "NOT_INITIALIZED"
      );
    }

    const state = this.chat.getState();
    await state.delete(this.installationKey(teamId));
    this.logger.info("Slack installation deleted", { teamId });
  }

  /**
   * Run a function with a specific bot token in context.
   * Use this for operations outside webhook handling (cron jobs, workflows).
   */
  withBotToken<T>(token: string, fn: () => T): T {
    return this.requestContext.run({ token }, fn);
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * Resolve the bot token for a team from the state adapter.
   */
  private async resolveTokenForTeam(
    teamId: string
  ): Promise<{ token: string; botUserId?: string } | null> {
    try {
      const installation = await this.getInstallation(teamId);
      if (installation) {
        return {
          token: installation.botToken,
          botUserId: installation.botUserId,
        };
      }
      this.logger.warn("No installation found for team", { teamId });
      return null;
    } catch (error) {
      this.logger.error("Failed to resolve token for team", {
        teamId,
        error,
      });
      return null;
    }
  }

  /**
   * Extract team_id from an interactive payload (form-urlencoded).
   */
  private extractTeamIdFromInteractive(body: string): string | null {
    try {
      const params = new URLSearchParams(body);
      const payloadStr = params.get("payload");
      if (!payloadStr) {
        return null;
      }
      const payload = JSON.parse(payloadStr);
      return payload.team?.id || payload.team_id || null;
    } catch {
      return null;
    }
  }

  /**
   * Look up user info from Slack API with caching via state adapter.
   * Returns display name and real name, or falls back to user ID.
   */
  private async lookupUser(
    userId: string
  ): Promise<{ displayName: string; realName: string }> {
    const cacheKey = `slack:user:${userId}`;

    // Check cache first (via state adapter for serverless compatibility)
    if (this.chat) {
      const cached = await this.chat.getState().get<CachedUser>(cacheKey);
      if (cached) {
        return { displayName: cached.displayName, realName: cached.realName };
      }
    }

    try {
      const result = await this.client.users.info(
        this.withToken({ user: userId })
      );
      const user = result.user as {
        name?: string;
        real_name?: string;
        profile?: { display_name?: string; real_name?: string };
      };

      // Slack user naming: profile.display_name > profile.real_name > real_name > name > userId
      const displayName =
        user?.profile?.display_name ||
        user?.profile?.real_name ||
        user?.real_name ||
        user?.name ||
        userId;
      const realName =
        user?.real_name || user?.profile?.real_name || displayName;

      // Cache the result via state adapter
      if (this.chat) {
        await this.chat
          .getState()
          .set<CachedUser>(
            cacheKey,
            { displayName, realName },
            SlackAdapter.USER_CACHE_TTL_MS
          );
      }

      this.logger.debug("Fetched user info", {
        userId,
        displayName,
        realName,
      });
      return { displayName, realName };
    } catch (error) {
      this.logger.warn("Could not fetch user info", { userId, error });
      // Fall back to user ID
      return { displayName: userId, realName: userId };
    }
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    const body = await request.text();
    this.logger.debug("Slack webhook raw body", { body });

    // Verify request signature
    const timestamp = request.headers.get("x-slack-request-timestamp");
    const signature = request.headers.get("x-slack-signature");

    if (!this.verifySignature(body, timestamp, signature)) {
      return new Response("Invalid signature", { status: 401 });
    }

    // Check if this is a form-urlencoded payload
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(body);
      if (params.has("command") && !params.has("payload")) {
        const teamId = params.get("team_id");
        if (!this.defaultBotToken && teamId) {
          const ctx = await this.resolveTokenForTeam(teamId);
          if (ctx) {
            return this.requestContext.run(ctx, () =>
              this.handleSlashCommand(params, options)
            );
          }
          this.logger.warn("Could not resolve token for slash command");
        }
        return this.handleSlashCommand(params, options);
      }
      // In multi-workspace mode, resolve token before processing
      if (!this.defaultBotToken) {
        const teamId = this.extractTeamIdFromInteractive(body);
        if (teamId) {
          const ctx = await this.resolveTokenForTeam(teamId);
          if (ctx) {
            return this.requestContext.run(ctx, () =>
              this.handleInteractivePayload(body, options)
            );
          }
        }
        this.logger.warn("Could not resolve token for interactive payload");
      }
      return this.handleInteractivePayload(body, options);
    }

    // Parse the JSON payload
    let payload: SlackWebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Handle URL verification challenge (no token needed)
    if (payload.type === "url_verification" && payload.challenge) {
      return Response.json({ challenge: payload.challenge });
    }

    // In multi-workspace mode, resolve token from team_id before processing events
    if (!this.defaultBotToken && payload.type === "event_callback") {
      const teamId = payload.team_id;
      if (teamId) {
        const ctx = await this.resolveTokenForTeam(teamId);
        if (ctx) {
          return this.requestContext.run(ctx, () => {
            this.processEventPayload(payload, options);
            return new Response("ok", { status: 200 });
          });
        }
        this.logger.warn("Could not resolve token for team", { teamId });
        return new Response("ok", { status: 200 });
      }
    }

    // Single-workspace mode or fallback
    this.processEventPayload(payload, options);
    return new Response("ok", { status: 200 });
  }

  /** Extract and dispatch events from a validated payload */
  private processEventPayload(
    payload: SlackWebhookPayload,
    options?: WebhookOptions
  ): void {
    if (payload.type === "event_callback" && payload.event) {
      const event = payload.event;

      if (event.type === "message" || event.type === "app_mention") {
        const slackEvent = event as SlackEvent;
        if (!(slackEvent.team || slackEvent.team_id) && payload.team_id) {
          slackEvent.team_id = payload.team_id;
        }
        this.handleMessageEvent(slackEvent, options);
      } else if (
        event.type === "reaction_added" ||
        event.type === "reaction_removed"
      ) {
        this.handleReactionEvent(event as SlackReactionEvent, options);
      } else if (event.type === "assistant_thread_started") {
        this.handleAssistantThreadStarted(
          event as SlackAssistantThreadStartedEvent,
          options
        );
      } else if (event.type === "assistant_thread_context_changed") {
        this.handleAssistantContextChanged(
          event as SlackAssistantContextChangedEvent,
          options
        );
      } else if (
        event.type === "app_home_opened" &&
        (event as SlackAppHomeOpenedEvent).tab === "home"
      ) {
        this.handleAppHomeOpened(event as SlackAppHomeOpenedEvent, options);
      }
    }
  }

  /**
   * Handle Slack interactive payloads (button clicks, view submissions, etc.).
   * These are sent as form-urlencoded with a `payload` JSON field.
   */
  private handleInteractivePayload(
    body: string,
    options?: WebhookOptions
  ): Response | Promise<Response> {
    const params = new URLSearchParams(body);
    const payloadStr = params.get("payload");

    if (!payloadStr) {
      return new Response("Missing payload", { status: 400 });
    }

    let payload: SlackInteractivePayload;
    try {
      payload = JSON.parse(payloadStr);
    } catch {
      return new Response("Invalid payload JSON", { status: 400 });
    }

    switch (payload.type) {
      case "block_actions":
        this.handleBlockActions(payload, options);
        return new Response("", { status: 200 });

      case "view_submission":
        return this.handleViewSubmission(payload, options);

      case "view_closed":
        this.handleViewClosed(payload, options);
        return new Response("", { status: 200 });

      default:
        return new Response("", { status: 200 });
    }
  }

  /**
   * Handle Slack slash command payloads.
   * Slash commands are sent as form-urlencoded with command, text, user_id, channel_id, etc.
   */
  private async handleSlashCommand(
    params: URLSearchParams,
    options?: WebhookOptions
  ): Promise<Response> {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring slash command");
      return new Response("", { status: 200 });
    }

    const command = params.get("command") || "";
    const text = params.get("text") || "";
    const userId = params.get("user_id") || "";
    const channelId = params.get("channel_id") || "";
    const triggerId = params.get("trigger_id") || undefined;

    this.logger.debug("Processing Slack slash command", {
      command,
      text,
      userId,
      channelId,
      triggerId,
    });
    const userInfo = await this.lookupUser(userId);
    const event = {
      command,
      text,
      user: {
        userId,
        userName: userInfo.displayName,
        fullName: userInfo.realName,
        isBot: false,
        isMe: false,
      },
      adapter: this as Adapter,
      raw: Object.fromEntries(params),
      triggerId,
      channelId: channelId ? `slack:${channelId}` : "",
    };
    this.chat.processSlashCommand(event, options);
    return new Response("", { status: 200 });
  }

  /**
   * Handle block_actions payload (button clicks in Block Kit).
   */
  private handleBlockActions(
    payload: SlackBlockActionsPayload,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring action");
      return;
    }

    const channel = payload.channel?.id || payload.container?.channel_id;
    const messageTs = payload.message?.ts || payload.container?.message_ts;
    const threadTs =
      payload.message?.thread_ts || payload.container?.thread_ts || messageTs;

    // Actions from Home tab views don't have channel/messageTs
    const isViewAction = payload.container?.type === "view";

    if (!(isViewAction || channel)) {
      this.logger.warn("Missing channel in block_actions", { channel });
      return;
    }

    const threadId =
      channel && (threadTs || messageTs)
        ? this.encodeThreadId({
            channel,
            threadTs: threadTs || messageTs || "",
          })
        : "";

    const isEphemeral = payload.container?.is_ephemeral === true;
    const responseUrl = payload.response_url;
    const messageId =
      isEphemeral && responseUrl && messageTs
        ? this.encodeEphemeralMessageId(messageTs, responseUrl, payload.user.id)
        : messageTs || "";

    // Process each action (usually just one, but can be multiple)
    for (const action of payload.actions) {
      const actionValue = action.selected_option?.value ?? action.value;
      const actionEvent: Omit<ActionEvent, "thread" | "openModal"> & {
        adapter: SlackAdapter;
      } = {
        actionId: action.action_id,
        value: actionValue,
        user: {
          userId: payload.user.id,
          userName: payload.user.username || payload.user.name || "unknown",
          fullName: payload.user.name || payload.user.username || "unknown",
          isBot: false,
          isMe: false,
        },
        messageId,
        threadId,
        adapter: this,
        raw: payload,
        triggerId: payload.trigger_id,
      };

      this.logger.debug("Processing Slack block action", {
        actionId: action.action_id,
        value: action.value,
        messageId: messageTs,
        threadId,
        triggerId: payload.trigger_id,
      });

      this.chat.processAction(actionEvent, options);
    }
  }

  private async handleViewSubmission(
    payload: SlackViewSubmissionPayload,
    options?: WebhookOptions
  ): Promise<Response> {
    if (!this.chat) {
      this.logger.warn(
        "Chat instance not initialized, ignoring view submission"
      );
      return new Response("", { status: 200 });
    }

    // Flatten values from Slack's nested structure
    const values: Record<string, string> = {};
    for (const blockValues of Object.values(payload.view.state.values)) {
      for (const [actionId, input] of Object.entries(blockValues)) {
        values[actionId] = input.value ?? input.selected_option?.value ?? "";
      }
    }

    // Decode contextId and user privateMetadata from private_metadata
    const { contextId, privateMetadata } = decodeModalMetadata(
      payload.view.private_metadata || undefined
    );

    const event = {
      callbackId: payload.view.callback_id,
      viewId: payload.view.id,
      values,
      privateMetadata,
      user: {
        userId: payload.user.id,
        userName: payload.user.username || payload.user.name || "unknown",
        fullName: payload.user.name || payload.user.username || "unknown",
        isBot: false,
        isMe: false,
      },
      adapter: this as Adapter,
      raw: payload,
    };

    const response = await this.chat.processModalSubmit(
      event,
      contextId,
      options
    );

    if (response) {
      const slackResponse = this.modalResponseToSlack(response, contextId);
      return new Response(JSON.stringify(slackResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("", { status: 200 });
  }

  private handleViewClosed(
    payload: SlackViewClosedPayload,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring view closed");
      return;
    }

    // Decode contextId and user privateMetadata from private_metadata
    const { contextId, privateMetadata } = decodeModalMetadata(
      payload.view.private_metadata || undefined
    );

    const event = {
      callbackId: payload.view.callback_id,
      viewId: payload.view.id,
      privateMetadata,
      user: {
        userId: payload.user.id,
        userName: payload.user.username || payload.user.name || "unknown",
        fullName: payload.user.name || payload.user.username || "unknown",
        isBot: false,
        isMe: false,
      },
      adapter: this as Adapter,
      raw: payload,
    };

    this.chat.processModalClose(event, contextId, options);
  }

  private modalResponseToSlack(
    response: ModalResponse,
    contextId?: string
  ): SlackModalResponse {
    switch (response.action) {
      case "close":
        return {};
      case "errors":
        return { response_action: "errors", errors: response.errors };
      case "update": {
        const modal = this.convertModalJSX(response.modal);
        const metadata = encodeModalMetadata({
          contextId,
          privateMetadata: modal.privateMetadata,
        });
        const view = modalToSlackView(modal, metadata);
        return {
          response_action: "update",
          view,
        };
      }
      case "push": {
        const modal = this.convertModalJSX(response.modal);
        const metadata = encodeModalMetadata({
          contextId,
          privateMetadata: modal.privateMetadata,
        });
        const view = modalToSlackView(modal, metadata);
        return {
          response_action: "push",
          view,
        };
      }
      default:
        return {};
    }
  }

  private convertModalJSX(modal: ModalElement): ModalElement {
    if (isJSX(modal)) {
      const converted = toModalElement(modal);
      if (!converted) {
        throw new Error("Invalid JSX element: must be a Modal element");
      }
      return converted;
    }
    return modal;
  }

  private verifySignature(
    body: string,
    timestamp: string | null,
    signature: string | null
  ): boolean {
    if (!(timestamp && signature)) {
      return false;
    }

    // Check timestamp is recent (within 5 minutes)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number.parseInt(timestamp, 10)) > 300) {
      return false;
    }

    // Compute expected signature
    const sigBasestring = `v0:${timestamp}:${body}`;
    const expectedSignature =
      "v0=" +
      createHmac("sha256", this.signingSecret)
        .update(sigBasestring)
        .digest("hex");

    // Compare signatures using timing-safe comparison
    try {
      return timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch {
      return false;
    }
  }

  /**
   * Handle message events from Slack.
   * Bot message filtering (isMe) is handled centrally by the Chat class.
   */
  private handleMessageEvent(
    event: SlackEvent,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring event");
      return;
    }

    // Skip message subtypes we don't handle (edits, deletes, etc.)
    // Note: bot_message subtype is allowed through - Chat class filters via isMe
    if (event.subtype && event.subtype !== "bot_message") {
      this.logger.debug("Ignoring message subtype", {
        subtype: event.subtype,
      });
      return;
    }

    if (!(event.channel && event.ts)) {
      this.logger.debug("Ignoring event without channel or ts", {
        channel: event.channel,
        ts: event.ts,
      });
      return;
    }

    // For DMs: top-level messages use empty threadTs (matches openDM subscriptions),
    // thread replies use thread_ts for per-conversation isolation.
    // For channels: always use thread_ts or ts for per-thread IDs.
    const isDM = event.channel_type === "im";
    const threadTs = isDM ? event.thread_ts || "" : event.thread_ts || event.ts;
    const threadId = this.encodeThreadId({
      channel: event.channel,
      threadTs,
    });

    // Let Chat class handle async processing, waitUntil, and isMe filtering
    // Use factory function since parseSlackMessage is async (user lookup)
    //
    // In multi-workspace mode, the request context (token + botUserId) is set via
    // AsyncLocalStorage during synchronous webhook handling. processMessage creates
    // an async task (via waitUntil) that may run after requestContext.run() returns.
    // Node.js AsyncLocalStorage propagates context to async continuations as long as
    // the Promise is created within the run() callback. We call processMessage inside
    // run() so the async task and all its awaits inherit the context.
    const isMention = isDM || event.type === "app_mention";
    const factory = async (): Promise<Message<unknown>> => {
      const msg = await this.parseSlackMessage(event, threadId);
      if (isMention) {
        msg.isMention = true;
      }
      return msg;
    };

    this.chat.processMessage(this, threadId, factory, options);
  }

  /**
   * Handle reaction events from Slack (reaction_added, reaction_removed).
   */
  private handleReactionEvent(
    event: SlackReactionEvent,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring reaction");
      return;
    }

    // Only handle reactions to messages (not files, etc.)
    if (event.item.type !== "message") {
      this.logger.debug("Ignoring reaction to non-message item", {
        itemType: event.item.type,
      });
      return;
    }

    // Build thread ID from the reacted message
    const threadId = this.encodeThreadId({
      channel: event.item.channel,
      threadTs: event.item.ts,
    });

    // Message ID is just the timestamp (Slack uses ts as message ID)
    const messageId = event.item.ts;

    // Normalize emoji
    const rawEmoji = event.reaction;
    const normalizedEmoji = defaultEmojiResolver.fromSlack(rawEmoji);

    // Check if reaction is from this bot (check request context for multi-workspace)
    const ctx = this.requestContext.getStore();
    const isMe =
      (ctx?.botUserId && event.user === ctx.botUserId) ||
      (this._botUserId !== null && event.user === this._botUserId) ||
      (this._botId !== null && event.user === this._botId);

    // Build reaction event
    const reactionEvent: Omit<ReactionEvent, "adapter" | "thread"> = {
      emoji: normalizedEmoji,
      rawEmoji,
      added: event.type === "reaction_added",
      user: {
        userId: event.user,
        userName: event.user, // Will be resolved below if possible
        fullName: event.user,
        isBot: false, // Users add reactions, not bots typically
        isMe,
      },
      messageId,
      threadId,
      raw: event,
    };

    // Process reaction
    this.chat.processReaction({ ...reactionEvent, adapter: this }, options);
  }

  /**
   * Handle assistant_thread_started events from Slack's Assistants API.
   * Fires when a user opens a new assistant thread (DM with the bot).
   */
  private handleAssistantThreadStarted(
    event: SlackAssistantThreadStartedEvent,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn(
        "Chat instance not initialized, ignoring assistant_thread_started"
      );
      return;
    }

    if (!event.assistant_thread) {
      this.logger.warn(
        "Malformed assistant_thread_started: missing assistant_thread"
      );
      return;
    }

    const { channel_id, thread_ts, user_id, context } = event.assistant_thread;
    const threadId = this.encodeThreadId({
      channel: channel_id,
      threadTs: thread_ts,
    });

    this.chat.processAssistantThreadStarted(
      {
        threadId,
        userId: user_id,
        channelId: channel_id,
        threadTs: thread_ts,
        context: {
          channelId: context.channel_id,
          teamId: context.team_id,
          enterpriseId: context.enterprise_id,
          threadEntryPoint: context.thread_entry_point,
          forceSearch: context.force_search,
        },
        adapter: this,
      },
      options
    );
  }

  /**
   * Handle assistant_thread_context_changed events from Slack's Assistants API.
   * Fires when a user navigates to a different channel with the assistant panel open.
   */
  private handleAssistantContextChanged(
    event: SlackAssistantContextChangedEvent,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn(
        "Chat instance not initialized, ignoring assistant_thread_context_changed"
      );
      return;
    }

    if (!event.assistant_thread) {
      this.logger.warn(
        "Malformed assistant_thread_context_changed: missing assistant_thread"
      );
      return;
    }

    const { channel_id, thread_ts, user_id, context } = event.assistant_thread;
    const threadId = this.encodeThreadId({
      channel: channel_id,
      threadTs: thread_ts,
    });

    this.chat.processAssistantContextChanged(
      {
        threadId,
        userId: user_id,
        channelId: channel_id,
        threadTs: thread_ts,
        context: {
          channelId: context.channel_id,
          teamId: context.team_id,
          enterpriseId: context.enterprise_id,
          threadEntryPoint: context.thread_entry_point,
          forceSearch: context.force_search,
        },
        adapter: this,
      },
      options
    );
  }

  /**
   * Handle app_home_opened events from Slack.
   * Fires when a user opens the bot's Home tab.
   */
  private handleAppHomeOpened(
    event: SlackAppHomeOpenedEvent,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn(
        "Chat instance not initialized, ignoring app_home_opened"
      );
      return;
    }

    this.chat.processAppHomeOpened(
      {
        userId: event.user,
        channelId: event.channel,
        adapter: this,
      },
      options
    );
  }

  /**
   * Publish a Home tab view for a user.
   * Slack API: views.publish
   */
  async publishHomeView(
    userId: string,
    view: Record<string, unknown>
  ): Promise<void> {
    await this.client.views.publish(
      // biome-ignore lint/suspicious/noExplicitAny: view blocks are consumer-defined
      this.withToken({ user_id: userId, view }) as any
    );
  }

  /**
   * Set suggested prompts for an assistant thread.
   * Slack Assistants API: assistant.threads.setSuggestedPrompts
   */
  async setSuggestedPrompts(
    channelId: string,
    threadTs: string,
    prompts: Array<{ title: string; message: string }>,
    title?: string
  ): Promise<void> {
    await this.client.assistant.threads.setSuggestedPrompts(
      this.withToken({
        channel_id: channelId,
        thread_ts: threadTs,
        prompts,
        title,
      })
    );
  }

  /**
   * Set status/thinking indicator for an assistant thread.
   * Slack Assistants API: assistant.threads.setStatus
   */
  async setAssistantStatus(
    channelId: string,
    threadTs: string,
    status: string,
    loadingMessages?: string[]
  ): Promise<void> {
    await this.client.assistant.threads.setStatus(
      this.withToken({
        channel_id: channelId,
        thread_ts: threadTs,
        status,
        ...(loadingMessages && { loading_messages: loadingMessages }),
      })
    );
  }

  /**
   * Set title for an assistant thread (shown in History tab).
   * Slack Assistants API: assistant.threads.setTitle
   */
  async setAssistantTitle(
    channelId: string,
    threadTs: string,
    title: string
  ): Promise<void> {
    await this.client.assistant.threads.setTitle(
      this.withToken({
        channel_id: channelId,
        thread_ts: threadTs,
        title,
      })
    );
  }

  /**
   * Resolve inline user mentions in Slack mrkdwn text.
   * Converts <@U123> to <@U123|displayName> so that toAst/extractPlainText
   * renders them as @displayName instead of @U123.
   *
   * @param skipSelfMention - When true, skips the bot's own user ID so that
   *   mention detection (which looks for @botUserId in the text) continues to
   *   work. Set to false when parsing historical/channel messages where mention
   *   detection doesn't apply.
   */
  private async resolveInlineMentions(
    text: string,
    skipSelfMention: boolean
  ): Promise<string> {
    const mentionPattern = /<@([A-Z0-9]+)(?:\|[^>]*)?>/g;
    const userIds = new Set<string>();
    let match: RegExpExecArray | null = mentionPattern.exec(text);
    while (match) {
      userIds.add(match[1]);
      match = mentionPattern.exec(text);
    }
    if (userIds.size === 0) {
      return text;
    }

    // Don't resolve the bot's own mention when processing incoming webhooks —
    // detectMention needs @botUserId in the text
    if (skipSelfMention && this._botUserId) {
      userIds.delete(this._botUserId);
    }
    if (userIds.size === 0) {
      return text;
    }

    // Look up all mentioned users in parallel
    const lookups = await Promise.all(
      [...userIds].map(async (uid) => {
        const info = await this.lookupUser(uid);
        return [uid, info.displayName] as const;
      })
    );
    const nameMap = new Map(lookups);

    // Replace <@U123> and <@U123|old> with <@U123|resolvedName>
    return text.replace(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g, (_m, uid: string) => {
      const name = nameMap.get(uid);
      return name ? `<@${uid}|${name}>` : `<@${uid}>`;
    });
  }

  private async parseSlackMessage(
    event: SlackEvent,
    threadId: string,
    options?: { skipSelfMention?: boolean }
  ): Promise<Message<unknown>> {
    const isMe = this.isMessageFromSelf(event);
    const skipSelfMention = options?.skipSelfMention ?? true;

    const rawText = event.text || "";

    // Get user info - for human users we need to look up the display name
    // since Slack events only include the user ID, not the username
    let userName = event.username || "unknown";
    let fullName = event.username || "unknown";

    // If we have a user ID but no username, look up the user info
    if (event.user && !event.username) {
      const userInfo = await this.lookupUser(event.user);
      userName = userInfo.displayName;
      fullName = userInfo.realName;
    }

    // Resolve inline @mentions to display names
    const text = await this.resolveInlineMentions(rawText, skipSelfMention);

    return new Message({
      id: event.ts || "",
      threadId,
      text: this.formatConverter.extractPlainText(text),
      formatted: this.formatConverter.toAst(text),
      raw: event,
      author: {
        userId: event.user || event.bot_id || "unknown",
        userName,
        fullName,
        isBot: !!event.bot_id,
        isMe,
      },
      metadata: {
        dateSent: new Date(Number.parseFloat(event.ts || "0") * 1000),
        edited: !!event.edited,
        editedAt: event.edited
          ? new Date(Number.parseFloat(event.edited.ts) * 1000)
          : undefined,
      },
      attachments: (event.files || []).map((file) =>
        this.createAttachment(file)
      ),
    });
  }

  /**
   * Create an Attachment object from a Slack file.
   * Includes a fetchData method that uses the bot token for auth.
   */
  private createAttachment(file: {
    id?: string;
    mimetype?: string;
    url_private?: string;
    name?: string;
    size?: number;
    original_w?: number;
    original_h?: number;
  }): Attachment {
    const url = file.url_private;
    // Capture token at attachment creation time (during webhook processing context)
    const botToken = this.getToken();

    // Determine type based on mimetype
    let type: Attachment["type"] = "file";
    if (file.mimetype?.startsWith("image/")) {
      type = "image";
    } else if (file.mimetype?.startsWith("video/")) {
      type = "video";
    } else if (file.mimetype?.startsWith("audio/")) {
      type = "audio";
    }

    return {
      type,
      url,
      name: file.name,
      mimeType: file.mimetype,
      size: file.size,
      width: file.original_w,
      height: file.original_h,
      fetchData: url
        ? async () => {
            const response = await fetch(url, {
              headers: {
                Authorization: `Bearer ${botToken}`,
              },
            });
            if (!response.ok) {
              throw new NetworkError(
                "slack",
                `Failed to fetch file: ${response.status} ${response.statusText}`
              );
            }
            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
          }
        : undefined,
    };
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<unknown>> {
    const { channel, threadTs } = this.decodeThreadId(threadId);

    try {
      // Check for files to upload
      const files = extractFiles(message);
      if (files.length > 0) {
        // Upload files first (they're shared to the channel automatically)
        await this.uploadFiles(files, channel, threadTs || undefined);

        // If message only has files (no text/card), return early
        const hasText =
          typeof message === "string" ||
          (typeof message === "object" &&
            message !== null &&
            ("raw" in message || "markdown" in message || "ast" in message));
        const card = extractCard(message);

        if (!(hasText || card)) {
          // Return a synthetic message ID since files.uploadV2 handles sharing
          return {
            id: `file-${Date.now()}`,
            threadId,
            raw: { files },
          };
        }
      }

      // Check if message contains a card
      const card = extractCard(message);

      if (card) {
        // Render card as Block Kit
        const blocks = cardToBlockKit(card);
        const fallbackText = cardToFallbackText(card);

        this.logger.debug("Slack API: chat.postMessage (blocks)", {
          channel,
          threadTs,
          blockCount: blocks.length,
        });

        const result = await this.client.chat.postMessage(
          this.withToken({
            channel,
            thread_ts: threadTs,
            text: fallbackText, // Fallback for notifications
            blocks,
            unfurl_links: false,
            unfurl_media: false,
          })
        );

        this.logger.debug("Slack API: chat.postMessage response", {
          messageId: result.ts,
          ok: result.ok,
        });

        return {
          id: result.ts as string,
          threadId,
          raw: result,
        };
      }

      // Regular text message
      const text = convertEmojiPlaceholders(
        this.formatConverter.renderPostable(message),
        "slack"
      );

      this.logger.debug("Slack API: chat.postMessage", {
        channel,
        threadTs,
        textLength: text.length,
      });

      const result = await this.client.chat.postMessage(
        this.withToken({
          channel,
          thread_ts: threadTs,
          text,
          unfurl_links: false,
          unfurl_media: false,
        })
      );

      this.logger.debug("Slack API: chat.postMessage response", {
        messageId: result.ts,
        ok: result.ok,
      });

      return {
        id: result.ts as string,
        threadId,
        raw: result,
      };
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  async postEphemeral(
    threadId: string,
    userId: string,
    message: AdapterPostableMessage
  ): Promise<EphemeralMessage> {
    const { channel, threadTs } = this.decodeThreadId(threadId);

    try {
      // Check if message contains a card
      const card = extractCard(message);

      if (card) {
        // Render card as Block Kit
        const blocks = cardToBlockKit(card);
        const fallbackText = cardToFallbackText(card);

        this.logger.debug("Slack API: chat.postEphemeral (blocks)", {
          channel,
          threadTs,
          userId,
          blockCount: blocks.length,
        });

        const result = await this.client.chat.postEphemeral(
          this.withToken({
            channel,
            thread_ts: threadTs || undefined,
            user: userId,
            text: fallbackText,
            blocks,
          })
        );

        this.logger.debug("Slack API: chat.postEphemeral response", {
          messageTs: result.message_ts,
          ok: result.ok,
        });

        return {
          id: result.message_ts || "",
          threadId,
          usedFallback: false,
          raw: result,
        };
      }

      // Regular text message
      const text = convertEmojiPlaceholders(
        this.formatConverter.renderPostable(message),
        "slack"
      );

      this.logger.debug("Slack API: chat.postEphemeral", {
        channel,
        threadTs,
        userId,
        textLength: text.length,
      });

      const result = await this.client.chat.postEphemeral(
        this.withToken({
          channel,
          thread_ts: threadTs || undefined,
          user: userId,
          text,
        })
      );

      this.logger.debug("Slack API: chat.postEphemeral response", {
        messageTs: result.message_ts,
        ok: result.ok,
      });

      return {
        id: result.message_ts || "",
        threadId,
        usedFallback: false,
        raw: result,
      };
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  async openModal(
    triggerId: string,
    modal: ModalElement,
    contextId?: string
  ): Promise<{ viewId: string }> {
    const metadata = encodeModalMetadata({
      contextId,
      privateMetadata: modal.privateMetadata,
    });
    const view = modalToSlackView(modal, metadata);

    this.logger.debug("Slack API: views.open", {
      triggerId,
      callbackId: modal.callbackId,
    });

    try {
      const result = await this.client.views.open(
        this.withToken({
          trigger_id: triggerId,
          view,
        })
      );

      this.logger.debug("Slack API: views.open response", {
        viewId: result.view?.id,
        ok: result.ok,
      });

      return { viewId: result.view?.id as string };
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  async updateModal(
    viewId: string,
    modal: ModalElement
  ): Promise<{ viewId: string }> {
    const view = modalToSlackView(modal);

    this.logger.debug("Slack API: views.update", {
      viewId,
      callbackId: modal.callbackId,
    });

    try {
      const result = await this.client.views.update(
        this.withToken({
          view_id: viewId,
          view,
        })
      );

      this.logger.debug("Slack API: views.update response", {
        viewId: result.view?.id,
        ok: result.ok,
      });

      return { viewId: result.view?.id as string };
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  /**
   * Upload files to Slack and share them to a channel.
   * Returns the file IDs of uploaded files.
   */
  private async uploadFiles(
    files: FileUpload[],
    channel: string,
    threadTs?: string
  ): Promise<string[]> {
    const fileIds: string[] = [];

    for (const file of files) {
      try {
        // Convert data to Buffer using shared utility
        const fileBuffer = await toBuffer(file.data, { platform: "slack" });
        if (!fileBuffer) {
          continue;
        }

        this.logger.debug("Slack API: files.uploadV2", {
          filename: file.filename,
          size: fileBuffer.length,
          mimeType: file.mimeType,
        });

        // biome-ignore lint/suspicious/noExplicitAny: Slack API types don't match actual usage
        const uploadArgs: any = {
          channel_id: channel,
          filename: file.filename,
          file: fileBuffer,
        };
        if (threadTs) {
          uploadArgs.thread_ts = threadTs;
        }

        uploadArgs.token = this.getToken();
        const result = (await this.client.files.uploadV2(uploadArgs)) as {
          ok: boolean;
          files?: Array<{ id?: string }>;
        };

        this.logger.debug("Slack API: files.uploadV2 response", {
          ok: result.ok,
        });

        // Extract file IDs from the response
        if (result.files && Array.isArray(result.files)) {
          for (const uploadedFile of result.files) {
            if (uploadedFile.id) {
              fileIds.push(uploadedFile.id);
            }
          }
        }
      } catch (error) {
        this.logger.error("Failed to upload file", {
          filename: file.filename,
          error,
        });
        throw error;
      }
    }

    return fileIds;
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<unknown>> {
    const ephemeral = this.decodeEphemeralMessageId(messageId);
    if (ephemeral) {
      const { threadTs } = this.decodeThreadId(threadId);
      const result = await this.sendToResponseUrl(
        ephemeral.responseUrl,
        "replace",
        {
          message,
          threadTs,
        }
      );
      return {
        id: ephemeral.messageTs,
        threadId,
        raw: { ephemeral: true, ...result },
      };
    }

    const { channel } = this.decodeThreadId(threadId);

    try {
      // Check if message contains a card
      const card = extractCard(message);

      if (card) {
        // Render card as Block Kit
        const blocks = cardToBlockKit(card);
        const fallbackText = cardToFallbackText(card);

        this.logger.debug("Slack API: chat.update (blocks)", {
          channel,
          messageId,
          blockCount: blocks.length,
        });

        const result = await this.client.chat.update(
          this.withToken({
            channel,
            ts: messageId,
            text: fallbackText,
            blocks,
          })
        );

        this.logger.debug("Slack API: chat.update response", {
          messageId: result.ts,
          ok: result.ok,
        });

        return {
          id: result.ts as string,
          threadId,
          raw: result,
        };
      }

      // Regular text message
      const text = convertEmojiPlaceholders(
        this.formatConverter.renderPostable(message),
        "slack"
      );

      this.logger.debug("Slack API: chat.update", {
        channel,
        messageId,
        textLength: text.length,
      });

      const result = await this.client.chat.update(
        this.withToken({
          channel,
          ts: messageId,
          text,
        })
      );

      this.logger.debug("Slack API: chat.update response", {
        messageId: result.ts,
        ok: result.ok,
      });

      return {
        id: result.ts as string,
        threadId,
        raw: result,
      };
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const ephemeral = this.decodeEphemeralMessageId(messageId);
    if (ephemeral) {
      await this.sendToResponseUrl(ephemeral.responseUrl, "delete");
      return;
    }
    const { channel } = this.decodeThreadId(threadId);

    try {
      this.logger.debug("Slack API: chat.delete", { channel, messageId });

      await this.client.chat.delete(
        this.withToken({
          channel,
          ts: messageId,
        })
      );

      this.logger.debug("Slack API: chat.delete response", { ok: true });
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const { channel } = this.decodeThreadId(threadId);
    // Convert emoji (EmojiValue or string) to Slack format, strip colons
    const slackEmoji = defaultEmojiResolver.toSlack(emoji);
    const name = slackEmoji.replace(/:/g, "");

    try {
      this.logger.debug("Slack API: reactions.add", {
        channel,
        messageId,
        emoji: name,
      });

      await this.client.reactions.add(
        this.withToken({
          channel,
          timestamp: messageId,
          name,
        })
      );

      this.logger.debug("Slack API: reactions.add response", { ok: true });
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  async removeReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const { channel } = this.decodeThreadId(threadId);
    // Convert emoji (EmojiValue or string) to Slack format, strip colons
    const slackEmoji = defaultEmojiResolver.toSlack(emoji);
    const name = slackEmoji.replace(/:/g, "");

    try {
      this.logger.debug("Slack API: reactions.remove", {
        channel,
        messageId,
        emoji: name,
      });

      await this.client.reactions.remove(
        this.withToken({
          channel,
          timestamp: messageId,
          name,
        })
      );

      this.logger.debug("Slack API: reactions.remove response", { ok: true });
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  async startTyping(_threadId: string): Promise<void> {
    // Slack doesn't have a direct typing indicator API for bots
  }

  /**
   * Stream a message using Slack's native streaming API.
   *
   * Consumes an async iterable of text chunks and streams them to Slack.
   * Requires `recipientUserId` and `recipientTeamId` in options.
   */
  async stream(
    threadId: string,
    textStream: AsyncIterable<string>,
    options?: StreamOptions
  ): Promise<RawMessage<unknown>> {
    if (!(options?.recipientUserId && options?.recipientTeamId)) {
      throw new ChatError(
        "Slack streaming requires recipientUserId and recipientTeamId in options",
        "MISSING_STREAM_OPTIONS"
      );
    }
    const { channel, threadTs } = this.decodeThreadId(threadId);
    this.logger.debug("Slack: starting stream", { channel, threadTs });

    const token = this.getToken();
    const streamer = this.client.chatStream({
      channel,
      thread_ts: threadTs,
      recipient_user_id: options.recipientUserId,
      recipient_team_id: options.recipientTeamId,
    });

    let first = true;
    for await (const chunk of textStream) {
      if (first) {
        // Pass token on first append so the streamer uses it for all subsequent calls
        // biome-ignore lint/suspicious/noExplicitAny: ChatStreamer types don't include token
        await streamer.append({ markdown_text: chunk, token } as any);
        first = false;
      } else {
        await streamer.append({ markdown_text: chunk });
      }
    }
    const result = await streamer.stop(
      // biome-ignore lint/suspicious/noExplicitAny: stopBlocks are platform-specific Block Kit elements
      options?.stopBlocks ? { blocks: options.stopBlocks as any[] } : undefined
    );
    const messageTs = (result.message?.ts ?? result.ts) as string;

    this.logger.debug("Slack: stream complete", { messageId: messageTs });

    return {
      id: messageTs,
      threadId,
      raw: result,
    };
  }

  /**
   * Open a direct message conversation with a user.
   * Returns a thread ID that can be used to post messages.
   */
  async openDM(userId: string): Promise<string> {
    try {
      this.logger.debug("Slack API: conversations.open", { userId });

      const result = await this.client.conversations.open(
        this.withToken({ users: userId })
      );

      if (!result.channel?.id) {
        throw new NetworkError(
          "slack",
          "Failed to open DM - no channel returned"
        );
      }

      const channelId = result.channel.id;

      this.logger.debug("Slack API: conversations.open response", {
        channelId,
        ok: result.ok,
      });

      // Encode as thread ID (no threadTs for new DM - messages will start new threads)
      return this.encodeThreadId({
        channel: channelId,
        threadTs: "", // Empty threadTs indicates top-level channel messages
      });
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<unknown>> {
    const { channel, threadTs } = this.decodeThreadId(threadId);
    const direction = options.direction ?? "backward";
    const limit = options.limit || 100;

    try {
      if (direction === "forward") {
        // Forward direction: fetch oldest messages first, cursor moves to newer
        // Uses native Slack cursor pagination which is efficient
        return await this.fetchMessagesForward(
          channel,
          threadTs,
          threadId,
          limit,
          options.cursor
        );
      }
      // Backward direction: fetch most recent messages first, cursor moves to older
      // Slack API returns oldest-first, so we need to work around this
      return await this.fetchMessagesBackward(
        channel,
        threadTs,
        threadId,
        limit,
        options.cursor
      );
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  /**
   * Fetch messages in forward direction (oldest first, efficient).
   * Uses native Slack cursor pagination.
   */
  private async fetchMessagesForward(
    channel: string,
    threadTs: string,
    threadId: string,
    limit: number,
    cursor?: string
  ): Promise<FetchResult<unknown>> {
    this.logger.debug("Slack API: conversations.replies (forward)", {
      channel,
      threadTs,
      limit,
      cursor,
    });

    const result = await this.client.conversations.replies(
      this.withToken({
        channel,
        ts: threadTs,
        limit,
        cursor,
      })
    );

    const slackMessages = (result.messages || []) as SlackEvent[];
    const nextCursor = (
      result as { response_metadata?: { next_cursor?: string } }
    ).response_metadata?.next_cursor;

    this.logger.debug("Slack API: conversations.replies response", {
      messageCount: slackMessages.length,
      ok: result.ok,
      hasNextCursor: !!nextCursor,
    });

    const messages = await Promise.all(
      slackMessages.map((msg) => this.parseSlackMessage(msg, threadId))
    );

    return {
      messages,
      nextCursor: nextCursor || undefined,
    };
  }

  /**
   * Fetch messages in backward direction (most recent first).
   *
   * Slack's API returns oldest-first, so for backward direction we:
   * 1. Use `latest` parameter to fetch messages before a timestamp (cursor)
   * 2. Fetch up to 1000 messages (API limit) and take the last N
   * 3. Return messages in chronological order (oldest first within the page)
   *
   * Note: For very large threads (>1000 messages), the first backward call
   * may not return the absolute most recent messages. This is a Slack API limitation.
   */
  private async fetchMessagesBackward(
    channel: string,
    threadTs: string,
    threadId: string,
    limit: number,
    cursor?: string
  ): Promise<FetchResult<unknown>> {
    // Cursor is a timestamp - fetch messages before this time
    // For the initial call (no cursor), we want the most recent messages
    const latest = cursor || undefined;

    this.logger.debug("Slack API: conversations.replies (backward)", {
      channel,
      threadTs,
      limit,
      latest,
    });

    // Fetch a larger batch to ensure we can return the last `limit` messages
    // Slack API max is 1000 messages per request
    const fetchLimit = Math.min(1000, Math.max(limit * 2, 200));

    const result = await this.client.conversations.replies(
      this.withToken({
        channel,
        ts: threadTs,
        limit: fetchLimit,
        latest,
        inclusive: false, // Don't include the cursor message itself
      })
    );

    const slackMessages = (result.messages || []) as SlackEvent[];

    this.logger.debug("Slack API: conversations.replies response (backward)", {
      messageCount: slackMessages.length,
      ok: result.ok,
      hasMore: result.has_more,
    });

    // If we have more messages than requested, take the last `limit`
    // This gives us the most recent messages
    const startIndex = Math.max(0, slackMessages.length - limit);
    const selectedMessages = slackMessages.slice(startIndex);

    const messages = await Promise.all(
      selectedMessages.map((msg) => this.parseSlackMessage(msg, threadId))
    );

    // For backward pagination, nextCursor points to older messages
    // Use the timestamp of the oldest message we're NOT returning
    let nextCursor: string | undefined;
    if (startIndex > 0 || result.has_more) {
      // There are more (older) messages available
      // Use the timestamp of the oldest message in our selection as the cursor
      const oldestSelected = selectedMessages[0];
      if (oldestSelected?.ts) {
        nextCursor = oldestSelected.ts;
      }
    }

    return {
      messages,
      nextCursor,
    };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { channel, threadTs } = this.decodeThreadId(threadId);

    try {
      this.logger.debug("Slack API: conversations.info", { channel });

      const result = await this.client.conversations.info(
        this.withToken({ channel })
      );
      const channelInfo = result.channel as { name?: string } | undefined;

      this.logger.debug("Slack API: conversations.info response", {
        channelName: channelInfo?.name,
        ok: result.ok,
      });

      return {
        id: threadId,
        channelId: channel,
        channelName: channelInfo?.name,
        metadata: {
          threadTs,
          channel: result.channel,
        },
      };
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  /**
   * Fetch a single message by ID (timestamp).
   */
  async fetchMessage(
    threadId: string,
    messageId: string
  ): Promise<Message<unknown> | null> {
    const { channel, threadTs } = this.decodeThreadId(threadId);

    try {
      const result = await this.client.conversations.replies(
        this.withToken({
          channel,
          ts: threadTs,
          oldest: messageId,
          inclusive: true,
          limit: 1,
        })
      );

      const messages = (result.messages || []) as SlackEvent[];
      const target = messages.find((msg) => msg.ts === messageId);
      if (!target) {
        return null;
      }

      return this.parseSlackMessage(target, threadId);
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  encodeThreadId(platformData: SlackThreadId): string {
    return `slack:${platformData.channel}:${platformData.threadTs}`;
  }

  /**
   * Check if a thread is a direct message conversation.
   * Slack DM channel IDs start with 'D'.
   */
  isDM(threadId: string): boolean {
    const { channel } = this.decodeThreadId(threadId);
    return channel.startsWith("D");
  }

  decodeThreadId(threadId: string): SlackThreadId {
    const parts = threadId.split(":");
    if (parts.length < 2 || parts.length > 3 || parts[0] !== "slack") {
      throw new ValidationError(
        "slack",
        `Invalid Slack thread ID: ${threadId}`
      );
    }
    return {
      channel: parts[1] as string,
      threadTs: parts.length === 3 ? (parts[2] as string) : "",
    };
  }

  parseMessage(raw: SlackEvent): Message<unknown> {
    const event = raw;
    const threadTs = event.thread_ts || event.ts || "";
    const threadId = this.encodeThreadId({
      channel: event.channel || "",
      threadTs,
    });
    // Use synchronous version without user lookup for interface compliance
    return this.parseSlackMessageSync(event, threadId);
  }

  /**
   * Synchronous message parsing without user lookup.
   * Used for parseMessage interface - falls back to user ID for username.
   */
  private parseSlackMessageSync(
    event: SlackEvent,
    threadId: string
  ): Message<unknown> {
    const isMe = this.isMessageFromSelf(event);

    const text = event.text || "";
    // Without async lookup, fall back to user ID for human users
    const userName = event.username || event.user || "unknown";
    const fullName = event.username || event.user || "unknown";

    return new Message({
      id: event.ts || "",
      threadId,
      text: this.formatConverter.extractPlainText(text),
      formatted: this.formatConverter.toAst(text),
      raw: event,
      author: {
        userId: event.user || event.bot_id || "unknown",
        userName,
        fullName,
        isBot: !!event.bot_id,
        isMe,
      },
      metadata: {
        dateSent: new Date(Number.parseFloat(event.ts || "0") * 1000),
        edited: !!event.edited,
        editedAt: event.edited
          ? new Date(Number.parseFloat(event.edited.ts) * 1000)
          : undefined,
      },
      attachments: (event.files || []).map((file) =>
        this.createAttachment(file)
      ),
    });
  }

  // =========================================================================
  // Channel-level methods
  // =========================================================================

  /**
   * Derive channel ID from a Slack thread ID.
   * Slack thread IDs are "slack:CHANNEL:THREAD_TS", channel ID is "slack:CHANNEL".
   */
  channelIdFromThreadId(threadId: string): string {
    const { channel } = this.decodeThreadId(threadId);
    return `slack:${channel}`;
  }

  /**
   * Fetch channel-level messages (conversations.history, not thread replies).
   */
  async fetchChannelMessages(
    channelId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<unknown>> {
    // Channel ID format: "slack:CHANNEL"
    const channel = channelId.split(":")[1];
    if (!channel) {
      throw new ValidationError(
        "slack",
        `Invalid Slack channel ID: ${channelId}`
      );
    }

    const direction = options.direction ?? "backward";
    const limit = options.limit || 100;

    try {
      if (direction === "forward") {
        return await this.fetchChannelMessagesForward(
          channel,
          limit,
          options.cursor
        );
      }
      return await this.fetchChannelMessagesBackward(
        channel,
        limit,
        options.cursor
      );
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  private async fetchChannelMessagesForward(
    channel: string,
    limit: number,
    cursor?: string
  ): Promise<FetchResult<unknown>> {
    this.logger.debug("Slack API: conversations.history (forward)", {
      channel,
      limit,
      cursor,
    });

    const result = await this.client.conversations.history(
      this.withToken({
        channel,
        limit,
        oldest: cursor,
        inclusive: cursor ? false : undefined,
      })
    );

    const slackMessages = ((result.messages || []) as SlackEvent[]).reverse(); // Slack returns newest-first, we want oldest-first

    const messages = await Promise.all(
      slackMessages.map((msg) => {
        const threadTs = msg.thread_ts || msg.ts || "";
        const threadId = `slack:${channel}:${threadTs}`;
        return this.parseSlackMessage(msg, threadId, {
          skipSelfMention: false,
        });
      })
    );

    // For forward pagination, cursor points to newer messages
    let nextCursor: string | undefined;
    if (result.has_more && slackMessages.length > 0) {
      const newest = slackMessages.at(-1);
      if (newest?.ts) {
        nextCursor = newest.ts;
      }
    }

    return {
      messages,
      nextCursor,
    };
  }

  private async fetchChannelMessagesBackward(
    channel: string,
    limit: number,
    cursor?: string
  ): Promise<FetchResult<unknown>> {
    this.logger.debug("Slack API: conversations.history (backward)", {
      channel,
      limit,
      cursor,
    });

    const result = await this.client.conversations.history(
      this.withToken({
        channel,
        limit,
        latest: cursor,
        inclusive: cursor ? false : undefined,
      })
    );

    const slackMessages = (result.messages || []) as SlackEvent[];
    // Slack returns newest-first for conversations.history; reverse for chronological
    const chronological = [...slackMessages].reverse();

    const messages = await Promise.all(
      chronological.map((msg) => {
        const threadTs = msg.thread_ts || msg.ts || "";
        const threadId = `slack:${channel}:${threadTs}`;
        return this.parseSlackMessage(msg, threadId, {
          skipSelfMention: false,
        });
      })
    );

    // For backward pagination, cursor points to older messages
    let nextCursor: string | undefined;
    if (result.has_more && chronological.length > 0) {
      const oldest = chronological[0];
      if (oldest?.ts) {
        nextCursor = oldest.ts;
      }
    }

    return {
      messages,
      nextCursor,
    };
  }

  /**
   * List threads in a Slack channel.
   * Fetches channel history and filters for messages with replies.
   */
  async listThreads(
    channelId: string,
    options: ListThreadsOptions = {}
  ): Promise<ListThreadsResult<unknown>> {
    const channel = channelId.split(":")[1];
    if (!channel) {
      throw new ValidationError(
        "slack",
        `Invalid Slack channel ID: ${channelId}`
      );
    }

    const limit = options.limit || 50;

    try {
      this.logger.debug("Slack API: conversations.history (listThreads)", {
        channel,
        limit,
        cursor: options.cursor,
      });

      const result = await this.client.conversations.history(
        this.withToken({
          channel,
          limit: Math.min(limit * 3, 200), // Fetch extra since not all have threads
          cursor: options.cursor,
        })
      );

      const slackMessages = (result.messages || []) as SlackEvent[];

      // Filter messages that have replies (they are thread parents)
      const threadMessages = slackMessages.filter(
        (msg) => (msg.reply_count ?? 0) > 0
      );

      // Take up to `limit` threads
      const selected = threadMessages.slice(0, limit);

      const threads: ThreadSummary[] = await Promise.all(
        selected.map(async (msg) => {
          const threadTs = msg.ts || "";
          const threadId = `slack:${channel}:${threadTs}`;
          const rootMessage = await this.parseSlackMessage(msg, threadId, {
            skipSelfMention: false,
          });

          return {
            id: threadId,
            rootMessage,
            replyCount: msg.reply_count,
            lastReplyAt: msg.latest_reply
              ? new Date(Number.parseFloat(msg.latest_reply) * 1000)
              : undefined,
          };
        })
      );

      const nextCursor = (
        result as { response_metadata?: { next_cursor?: string } }
      ).response_metadata?.next_cursor;

      return {
        threads,
        nextCursor: nextCursor || undefined,
      };
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  /**
   * Fetch Slack channel info/metadata.
   */
  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const channel = channelId.split(":")[1];
    if (!channel) {
      throw new ValidationError(
        "slack",
        `Invalid Slack channel ID: ${channelId}`
      );
    }

    try {
      this.logger.debug("Slack API: conversations.info (channel)", { channel });

      const result = await this.client.conversations.info(
        this.withToken({ channel })
      );

      const info = result.channel as {
        id?: string;
        name?: string;
        is_im?: boolean;
        is_mpim?: boolean;
        num_members?: number;
        purpose?: { value?: string };
        topic?: { value?: string };
      };

      return {
        id: channelId,
        name: info?.name ? `#${info.name}` : undefined,
        isDM: Boolean(info?.is_im || info?.is_mpim),
        memberCount: info?.num_members,
        metadata: {
          purpose: info?.purpose?.value,
          topic: info?.topic?.value,
        },
      };
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  /**
   * Post a top-level message to a channel (not in a thread).
   */
  async postChannelMessage(
    channelId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<unknown>> {
    const channel = channelId.split(":")[1];
    if (!channel) {
      throw new ValidationError(
        "slack",
        `Invalid Slack channel ID: ${channelId}`
      );
    }

    // Use the existing postMessage logic but with no threadTs
    // Build a synthetic thread ID with empty threadTs
    const syntheticThreadId = `slack:${channel}:`;
    return await this.postMessage(syntheticThreadId, message);
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  /**
   * Check if a Slack event is from this bot.
   *
   * Slack messages can come from:
   * - User messages: have `user` field (U_xxx format)
   * - Bot messages: have `bot_id` field (B_xxx format)
   *
   * We check both because:
   * - _botUserId is the user ID (U_xxx) - matches event.user
   * - _botId is the bot ID (B_xxx) - matches event.bot_id
   */
  private isMessageFromSelf(event: SlackEvent): boolean {
    // Check request context first (multi-workspace)
    const ctx = this.requestContext.getStore();
    if (ctx?.botUserId && event.user === ctx.botUserId) {
      return true;
    }

    // Primary check: user ID match (for messages sent as the bot user)
    if (this._botUserId && event.user === this._botUserId) {
      return true;
    }

    // Secondary check: bot ID match (for bot_message subtypes)
    if (this._botId && event.bot_id === this._botId) {
      return true;
    }

    return false;
  }

  private handleSlackError(error: unknown): never {
    const slackError = error as { data?: { error?: string }; code?: string };

    if (
      slackError.code === "slack_webapi_platform_error" &&
      slackError.data?.error === "ratelimited"
    ) {
      throw new AdapterRateLimitError("slack");
    }

    throw error;
  }

  /**
   * Encode response_url and userId into messageId for ephemeral messages.
   * This allows edit/delete operations to work via response_url.
   */
  private encodeEphemeralMessageId(
    messageTs: string,
    responseUrl: string,
    userId: string
  ): string {
    const data = JSON.stringify({ responseUrl, userId });
    return `ephemeral:${messageTs}:${btoa(data)}`;
  }

  /**
   * Decode ephemeral messageId to extract messageTs, responseUrl, and userId.
   * Returns null if the messageId is not an ephemeral encoding.
   */
  private decodeEphemeralMessageId(
    messageId: string
  ): { messageTs: string; responseUrl: string; userId: string } | null {
    if (!messageId.startsWith("ephemeral:")) {
      return null;
    }
    const parts = messageId.split(":");
    if (parts.length < 3) {
      return null;
    }
    const messageTs = parts[1];
    const encodedData = parts.slice(2).join(":");
    try {
      const decoded = atob(encodedData);
      try {
        const data = JSON.parse(decoded);
        if (data.responseUrl && data.userId) {
          return {
            messageTs,
            responseUrl: data.responseUrl,
            userId: data.userId,
          };
        }
      } catch {
        return { messageTs, responseUrl: decoded, userId: "" };
      }
      return null;
    } catch {
      this.logger.warn("Failed to decode ephemeral messageId", { messageId });
      return null;
    }
  }

  /**
   * Send a request to Slack's response_url to modify an ephemeral message.
   */
  private async sendToResponseUrl(
    responseUrl: string,
    action: "replace" | "delete",
    options?: { message?: AdapterPostableMessage; threadTs?: string }
  ): Promise<Record<string, unknown>> {
    let payload: Record<string, unknown>;

    if (action === "delete") {
      payload = { delete_original: true };
    } else {
      const message = options?.message;
      if (!message) {
        throw new ChatError(
          "Message required for replace action",
          "INVALID_ARGS"
        );
      }
      const card = extractCard(message);
      if (card) {
        payload = {
          replace_original: true,
          text: cardToFallbackText(card),
          blocks: cardToBlockKit(card),
        };
      } else {
        payload = {
          replace_original: true,
          text: convertEmojiPlaceholders(
            this.formatConverter.renderPostable(message),
            "slack"
          ),
        };
      }
      if (options?.threadTs) {
        payload.thread_ts = options.threadTs;
      }
    }
    this.logger.debug("Slack response_url request", {
      action,
      threadTs: options?.threadTs,
    });
    const response = await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error("Slack response_url failed", {
        action,
        status: response.status,
        body: errorText,
      });
      throw new ChatError(
        `Failed to ${action} via response_url: ${errorText}`,
        response.status.toString()
      );
    }
    const responseText = await response.text();
    if (responseText) {
      try {
        return JSON.parse(responseText) as Record<string, unknown>;
      } catch {
        return { raw: responseText };
      }
    }
    return {};
  }
}

export function createSlackAdapter(
  config?: Partial<SlackAdapterConfig>
): SlackAdapter {
  const signingSecret =
    config?.signingSecret ?? process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    throw new ValidationError(
      "slack",
      "signingSecret is required. Set SLACK_SIGNING_SECRET or provide it in config."
    );
  }
  // Auth fields (botToken, clientId, clientSecret) are modal: botToken's
  // presence selects single-workspace mode, its absence selects multi-workspace
  // (per-team token lookup via installations). Only fall back to env vars
  // in zero-config mode (no config provided at all).
  const zeroConfig = !config;

  const resolved: SlackAdapterConfig = {
    signingSecret,
    botToken:
      config?.botToken ??
      (zeroConfig ? process.env.SLACK_BOT_TOKEN : undefined),
    clientId:
      config?.clientId ??
      (zeroConfig ? process.env.SLACK_CLIENT_ID : undefined),
    clientSecret:
      config?.clientSecret ??
      (zeroConfig ? process.env.SLACK_CLIENT_SECRET : undefined),
    encryptionKey: config?.encryptionKey ?? process.env.SLACK_ENCRYPTION_KEY,
    logger: config?.logger ?? new ConsoleLogger("info").child("slack"),
    userName: config?.userName,
    botUserId: config?.botUserId,
  };
  return new SlackAdapter(resolved);
}

// Re-export card converter for advanced use
export { cardToBlockKit, cardToFallbackText } from "./cards";
export type { EncryptedTokenData } from "./crypto";
// Re-export crypto utilities for advanced use
export { decodeKey } from "./crypto";
// Re-export format converter for advanced use
export {
  SlackFormatConverter,
  SlackFormatConverter as SlackMarkdownConverter,
} from "./markdown";
