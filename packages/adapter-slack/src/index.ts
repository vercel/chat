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
  ChatInstance,
  EmojiValue,
  EphemeralMessage,
  FetchOptions,
  FetchResult,
  FileUpload,
  FormattedContent,
  Logger,
  ModalElement,
  ModalResponse,
  RawMessage,
  ReactionEvent,
  StreamOptions,
  ThreadInfo,
  WebhookOptions,
} from "chat";

import {
  ChatError,
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
import { modalToSlackView, type SlackModalResponse } from "./modals";

export interface SlackAdapterConfig {
  /** Bot token (xoxb-...). Required for single-workspace mode. Omit for multi-workspace. */
  botToken?: string;
  /** Signing secret for webhook verification */
  signingSecret: string;
  /** Logger instance for error reporting */
  logger: Logger;
  /** Override bot username (optional) */
  userName?: string;
  /** Bot user ID (will be fetched if not provided) */
  botUserId?: string;
  /**
   * Base64-encoded 32-byte AES-256-GCM encryption key.
   * If provided, bot tokens stored via setInstallation() will be encrypted at rest.
   */
  encryptionKey?: string;
  /** Slack app client ID (required for OAuth / multi-workspace) */
  clientId?: string;
  /** Slack app client secret (required for OAuth / multi-workspace) */
  clientSecret?: string;
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
  type: string;
  user?: string;
  bot_id?: string;
  channel?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  subtype?: string;
  username?: string;
  edited?: { ts: string };
  /** Channel type: "channel", "group", "mpim", or "im" (DM) */
  channel_type?: string;
  files?: Array<{
    id?: string;
    mimetype?: string;
    url_private?: string;
    name?: string;
    size?: number;
    original_w?: number;
    original_h?: number;
  }>;
  team?: string;
  team_id?: string;
}

/** Slack reaction event payload */
export interface SlackReactionEvent {
  type: "reaction_added" | "reaction_removed";
  user: string;
  reaction: string;
  item_user?: string;
  item: {
    type: string;
    channel: string;
    ts: string;
  };
  event_ts: string;
}

/** Slack webhook payload envelope */
interface SlackWebhookPayload {
  type: string;
  challenge?: string;
  event?: SlackEvent | SlackReactionEvent;
  event_id?: string;
  event_time?: number;
  team_id?: string;
}

/** Slack interactive payload (block_actions) for button clicks */
interface SlackBlockActionsPayload {
  type: "block_actions";
  trigger_id: string;
  user: {
    id: string;
    username: string;
    name?: string;
  };
  container: {
    type: string;
    message_ts: string;
    channel_id: string;
    is_ephemeral?: boolean;
  };
  channel: {
    id: string;
    name: string;
  };
  message: {
    ts: string;
    thread_ts?: string;
  };
  actions: Array<{
    type: string;
    action_id: string;
    block_id?: string;
    value?: string;
    action_ts?: string;
  }>;
  response_url?: string;
}

interface SlackViewSubmissionPayload {
  type: "view_submission";
  trigger_id: string;
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

  private client: WebClient;
  private signingSecret: string;
  private defaultBotToken: string | undefined;
  private chat: ChatInstance | null = null;
  private logger: Logger;
  private _botUserId: string | null = null;
  private _botId: string | null = null; // Bot app ID (B_xxx) - different from user ID
  private formatConverter = new SlackFormatConverter();
  private static USER_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  // Multi-workspace support
  private clientId: string | undefined;
  private clientSecret: string | undefined;
  private encryptionKey: Buffer | undefined;
  private requestContext = new AsyncLocalStorage<{
    token: string;
    botUserId?: string;
  }>();

  /** Bot user ID (e.g., U_BOT_123) used for mention detection */
  get botUserId(): string | undefined {
    const ctx = this.requestContext.getStore();
    if (ctx?.botUserId) return ctx.botUserId;
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
    if (ctx?.token) return ctx.token;
    if (this.defaultBotToken) return this.defaultBotToken;
    throw new ChatError(
      "No bot token available. In multi-workspace mode, ensure the webhook is being processed.",
      "MISSING_BOT_TOKEN",
    );
  }

  /**
   * Add the current token to API call options.
   * Workaround for Slack WebClient types not including `token` in per-method args.
   */
  // biome-ignore lint/suspicious/noExplicitAny: Slack types don't include token in method args
  private withToken<T extends Record<string, any>>(
    options: T,
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
    installation: SlackInstallation,
  ): Promise<void> {
    if (!this.chat) {
      throw new ChatError(
        "Adapter not initialized. Ensure chat.initialize() has been called first.",
        "NOT_INITIALIZED",
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
        "NOT_INITIALIZED",
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

    if (!stored) return null;

    if (this.encryptionKey && isEncryptedTokenData(stored.botToken)) {
      return {
        ...stored,
        botToken: decryptToken(
          stored.botToken as EncryptedTokenData,
          this.encryptionKey,
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
    request: Request,
  ): Promise<{ teamId: string; installation: SlackInstallation }> {
    if (!this.clientId || !this.clientSecret) {
      throw new ChatError(
        "clientId and clientSecret are required for OAuth. Pass them in createSlackAdapter().",
        "MISSING_OAUTH_CONFIG",
      );
    }

    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    if (!code) {
      throw new ChatError(
        "Missing 'code' query parameter in OAuth callback request.",
        "MISSING_OAUTH_CODE",
      );
    }

    const redirectUri = url.searchParams.get("redirect_uri") ?? undefined;

    const result = await this.client.oauth.v2.access({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: redirectUri,
    });

    if (!result.ok || !result.access_token || !result.team?.id) {
      throw new ChatError(
        `Slack OAuth failed: ${result.error || "missing access_token or team.id"}`,
        "OAUTH_FAILED",
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
        "NOT_INITIALIZED",
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
    teamId: string,
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
      if (!payloadStr) return null;
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
    userId: string,
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
        this.withToken({ user: userId }),
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
            SlackAdapter.USER_CACHE_TTL_MS,
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
    options?: WebhookOptions,
  ): Promise<Response> {
    const body = await request.text();
    this.logger.debug("Slack webhook raw body", { body });

    // Verify request signature
    const timestamp = request.headers.get("x-slack-request-timestamp");
    const signature = request.headers.get("x-slack-signature");

    if (!this.verifySignature(body, timestamp, signature)) {
      return new Response("Invalid signature", { status: 401 });
    }

    // Check if this is a form-urlencoded interactive payload
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      // In multi-workspace mode, resolve token before processing
      if (!this.defaultBotToken) {
        const teamId = this.extractTeamIdFromInteractive(body);
        if (teamId) {
          const ctx = await this.resolveTokenForTeam(teamId);
          if (ctx) {
            return this.requestContext.run(ctx, () =>
              this.handleInteractivePayload(body, options),
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
      return new Response(JSON.stringify({ challenge: payload.challenge }), {
        headers: { "Content-Type": "application/json" },
      });
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
    options?: WebhookOptions,
  ): void {
    if (payload.type === "event_callback" && payload.event) {
      const event = payload.event;

      if (event.type === "message" || event.type === "app_mention") {
        const slackEvent = event as SlackEvent;
        if (!slackEvent.team && !slackEvent.team_id && payload.team_id) {
          slackEvent.team_id = payload.team_id;
        }
        this.handleMessageEvent(slackEvent, options);
      } else if (
        event.type === "reaction_added" ||
        event.type === "reaction_removed"
      ) {
        this.handleReactionEvent(event as SlackReactionEvent, options);
      }
    }
  }

  /**
   * Handle Slack interactive payloads (button clicks, view submissions, etc.).
   * These are sent as form-urlencoded with a `payload` JSON field.
   */
  private handleInteractivePayload(
    body: string,
    options?: WebhookOptions,
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
   * Handle block_actions payload (button clicks in Block Kit).
   */
  private handleBlockActions(
    payload: SlackBlockActionsPayload,
    options?: WebhookOptions,
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring action");
      return;
    }

    const channel = payload.channel?.id || payload.container?.channel_id;
    const messageTs = payload.message?.ts || payload.container?.message_ts;
    const threadTs = payload.message?.thread_ts || messageTs;

    if (!channel || !messageTs) {
      this.logger.warn("Missing channel or message_ts in block_actions", {
        channel,
        messageTs,
      });
      return;
    }

    const threadId = this.encodeThreadId({
      channel,
      threadTs: threadTs || messageTs,
    });

    // Process each action (usually just one, but can be multiple)
    for (const action of payload.actions) {
      const actionEvent: Omit<ActionEvent, "thread" | "openModal"> & {
        adapter: SlackAdapter;
      } = {
        actionId: action.action_id,
        value: action.value,
        user: {
          userId: payload.user.id,
          userName: payload.user.username || payload.user.name || "unknown",
          fullName: payload.user.name || payload.user.username || "unknown",
          isBot: false,
          isMe: false,
        },
        messageId: messageTs,
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
    options?: WebhookOptions,
  ): Promise<Response> {
    if (!this.chat) {
      this.logger.warn(
        "Chat instance not initialized, ignoring view submission",
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

    // The contextId is stored in private_metadata
    const contextId = payload.view.private_metadata || undefined;

    const event = {
      callbackId: payload.view.callback_id,
      viewId: payload.view.id,
      values,
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
      options,
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
    options?: WebhookOptions,
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring view closed");
      return;
    }

    // The contextId is stored in private_metadata
    const contextId = payload.view.private_metadata || undefined;

    const event = {
      callbackId: payload.view.callback_id,
      viewId: payload.view.id,
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
    contextId?: string,
  ): SlackModalResponse {
    switch (response.action) {
      case "close":
        return {};
      case "errors":
        return { response_action: "errors", errors: response.errors };
      case "update": {
        const modal = this.convertModalJSX(response.modal);
        const view = modalToSlackView(modal, contextId);
        return {
          response_action: "update",
          view,
        };
      }
      case "push": {
        const modal = this.convertModalJSX(response.modal);
        const view = modalToSlackView(modal, contextId);
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
    signature: string | null,
  ): boolean {
    if (!timestamp || !signature) {
      return false;
    }

    // Check timestamp is recent (within 5 minutes)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
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
        Buffer.from(expectedSignature),
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
    options?: WebhookOptions,
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

    if (!event.channel || !event.ts) {
      this.logger.debug("Ignoring event without channel or ts", {
        channel: event.channel,
        ts: event.ts,
      });
      return;
    }

    // For DMs (channel_type: "im"), use empty threadTs so all messages in the DM
    // match the DM subscription created by openDM(). This treats the entire DM
    // conversation as a single "thread" for subscription purposes.
    const isDM = event.channel_type === "im";
    const threadTs = isDM ? "" : event.thread_ts || event.ts;
    const threadId = this.encodeThreadId({
      channel: event.channel,
      threadTs,
    });

    // Let Chat class handle async processing, waitUntil, and isMe filtering
    // Use factory function since parseSlackMessage is async (user lookup)
    this.chat.processMessage(
      this,
      threadId,
      () => this.parseSlackMessage(event, threadId),
      options,
    );
  }

  /**
   * Handle reaction events from Slack (reaction_added, reaction_removed).
   */
  private handleReactionEvent(
    event: SlackReactionEvent,
    options?: WebhookOptions,
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

  private async parseSlackMessage(
    event: SlackEvent,
    threadId: string,
  ): Promise<Message<unknown>> {
    const isMe = this.isMessageFromSelf(event);

    const text = event.text || "";

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
        dateSent: new Date(parseFloat(event.ts || "0") * 1000),
        edited: !!event.edited,
        editedAt: event.edited
          ? new Date(parseFloat(event.edited.ts) * 1000)
          : undefined,
      },
      attachments: (event.files || []).map((file) =>
        this.createAttachment(file),
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
                `Failed to fetch file: ${response.status} ${response.statusText}`,
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
    message: AdapterPostableMessage,
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

        if (!hasText && !card) {
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
          }),
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
        "slack",
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
        }),
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
    message: AdapterPostableMessage,
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
          }),
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
        "slack",
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
        }),
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
    contextId?: string,
  ): Promise<{ viewId: string }> {
    const view = modalToSlackView(modal, contextId);

    this.logger.debug("Slack API: views.open", {
      triggerId,
      callbackId: modal.callbackId,
    });

    try {
      const result = await this.client.views.open(
        this.withToken({
          trigger_id: triggerId,
          view,
        }),
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
    modal: ModalElement,
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
        }),
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
    threadTs?: string,
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
    message: AdapterPostableMessage,
  ): Promise<RawMessage<unknown>> {
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
          }),
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
        "slack",
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
        }),
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
    const { channel } = this.decodeThreadId(threadId);

    try {
      this.logger.debug("Slack API: chat.delete", { channel, messageId });

      await this.client.chat.delete(
        this.withToken({
          channel,
          ts: messageId,
        }),
      );

      this.logger.debug("Slack API: chat.delete response", { ok: true });
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string,
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
        }),
      );

      this.logger.debug("Slack API: reactions.add response", { ok: true });
    } catch (error) {
      this.handleSlackError(error);
    }
  }

  async removeReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string,
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
        }),
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
    options?: StreamOptions,
  ): Promise<RawMessage<unknown>> {
    if (!options?.recipientUserId || !options?.recipientTeamId) {
      throw new ChatError(
        "Slack streaming requires recipientUserId and recipientTeamId in options",
        "MISSING_STREAM_OPTIONS",
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
    const result = await streamer.stop();
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
        this.withToken({ users: userId }),
      );

      if (!result.channel?.id) {
        throw new NetworkError(
          "slack",
          "Failed to open DM - no channel returned",
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
    options: FetchOptions = {},
  ): Promise<FetchResult<unknown>> {
    const { channel, threadTs } = this.decodeThreadId(threadId);
    const direction = options.direction ?? "backward";
    const limit = options.limit || 100;

    try {
      if (direction === "forward") {
        // Forward direction: fetch oldest messages first, cursor moves to newer
        // Uses native Slack cursor pagination which is efficient
        return this.fetchMessagesForward(
          channel,
          threadTs,
          threadId,
          limit,
          options.cursor,
        );
      }
      // Backward direction: fetch most recent messages first, cursor moves to older
      // Slack API returns oldest-first, so we need to work around this
      return this.fetchMessagesBackward(
        channel,
        threadTs,
        threadId,
        limit,
        options.cursor,
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
    cursor?: string,
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
      }),
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
      slackMessages.map((msg) => this.parseSlackMessage(msg, threadId)),
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
    cursor?: string,
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
      }),
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
      selectedMessages.map((msg) => this.parseSlackMessage(msg, threadId)),
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
        this.withToken({ channel }),
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
    messageId: string,
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
        }),
      );

      const messages = (result.messages || []) as SlackEvent[];
      const target = messages.find((msg) => msg.ts === messageId);
      if (!target) return null;

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
    if (parts.length !== 3 || parts[0] !== "slack") {
      throw new ValidationError(
        "slack",
        `Invalid Slack thread ID: ${threadId}`,
      );
    }
    return {
      channel: parts[1] as string,
      threadTs: parts[2] as string,
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
    threadId: string,
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
        dateSent: new Date(parseFloat(event.ts || "0") * 1000),
        edited: !!event.edited,
        editedAt: event.edited
          ? new Date(parseFloat(event.edited.ts) * 1000)
          : undefined,
      },
      attachments: (event.files || []).map((file) =>
        this.createAttachment(file),
      ),
    });
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

    if (slackError.code === "slack_webapi_platform_error") {
      if (slackError.data?.error === "ratelimited") {
        throw new AdapterRateLimitError("slack");
      }
    }

    throw error;
  }
}

export function createSlackAdapter(config: SlackAdapterConfig): SlackAdapter {
  return new SlackAdapter(config);
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
