import type { TokenCredential } from "@azure/identity";
import {
  ClientCertificateCredential,
  ClientSecretCredential,
  DefaultAzureCredential,
} from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import {
  TokenCredentialAuthenticationProvider,
  type TokenCredentialAuthenticationProviderOptions,
} from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";
// teams.ts Activity type — used to cast botbuilder Activity for Router
import type { Activity as TeamsApiActivity } from "@microsoft/teams.api";
// teams.ts API Client — used to create HttpStream per conversation
import { Client as TeamsApiClient } from "@microsoft/teams.api";
// HttpStream is the battle-tested streaming implementation from teams.ts
import { HttpStream } from "@microsoft/teams.apps";

// ─── teams.ts imports ────────────────────────────────────────────────────────
// Router handles all inbound activity dispatch — replaces the if/else chain in handleTurn()
// Router is not re-exported from the main @microsoft/teams.apps index;
// access via the direct dist path which is published in the package.
import { Router } from "@microsoft/teams.apps/dist/router/index.js";
import type { Activity, ConversationReference } from "botbuilder";
import {
  ActivityTypes,
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  TeamsInfo,
  type TurnContext,
} from "botbuilder";
import {
  CertificateServiceClientCredentialsFactory,
  FederatedServiceClientCredentialsFactory,
} from "botframework-connector";

// ─────────────────────────────────────────────────────────────────────────────

/** Extended CloudAdapter that exposes processActivity for serverless environments */
class ServerlessCloudAdapter extends CloudAdapter {
  handleActivity(
    authHeader: string,
    activity: Activity,
    logic: (context: TurnContext) => Promise<void>
  ) {
    return this.processActivity(authHeader, activity, logic);
  }
}

import {
  AdapterRateLimitError,
  AuthenticationError,
  bufferToDataUri,
  extractCard,
  extractFiles,
  NetworkError,
  PermissionError,
  toBuffer,
  ValidationError,
} from "@chat-adapter/shared";
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
  RawMessage,
  ReactionEvent,
  StreamChunk,
  StreamOptions,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import {
  ConsoleLogger,
  convertEmojiPlaceholders,
  defaultEmojiResolver,
  Message,
  NotImplementedError,
} from "chat";
import { cardToAdaptiveCard } from "./cards";
import { TeamsFormatConverter } from "./markdown";

const MESSAGEID_CAPTURE_PATTERN = /messageid=(\d+)/;
const MESSAGEID_STRIP_PATTERN = /;messageid=\d+/;
const SEMICOLON_MESSAGEID_CAPTURE_PATTERN = /;messageid=(\d+)/;

/** Microsoft Graph API chat message type */
interface GraphChatMessage {
  attachments?: Array<{
    id?: string;
    contentType?: string;
    contentUrl?: string;
    content?: string;
    name?: string;
  }>;
  body?: {
    content?: string;
    contentType?: "text" | "html";
  };
  createdDateTime?: string;
  from?: {
    user?: { id?: string; displayName?: string };
    application?: { id?: string; displayName?: string };
  };
  id: string;
  lastModifiedDateTime?: string;
  replyToId?: string;
}

/** Certificate-based authentication config */
export interface TeamsAuthCertificate {
  certificatePrivateKey: string;
  certificateThumbprint?: string;
  x5c?: string;
}

/** Federated (workload identity) authentication config */
export interface TeamsAuthFederated {
  clientAudience?: string;
  clientId: string;
}

export interface TeamsAdapterConfig {
  /** Microsoft App ID. Defaults to TEAMS_APP_ID env var. */
  appId?: string;
  /** Microsoft App Password. Defaults to TEAMS_APP_PASSWORD env var. */
  appPassword?: string;
  /** Microsoft App Tenant ID. Defaults to TEAMS_APP_TENANT_ID env var. */
  appTenantId?: string;
  /** Microsoft App Type */
  appType?: "MultiTenant" | "SingleTenant";
  /** Certificate-based authentication */
  certificate?: TeamsAuthCertificate;
  /** Federated (workload identity) authentication */
  federated?: TeamsAuthFederated;
  /** Logger instance. Defaults to ConsoleLogger. */
  logger?: Logger;
  /** Override bot username (optional) */
  userName?: string;
}

/** Teams-specific thread ID data */
export interface TeamsThreadId {
  conversationId: string;
  replyToId?: string;
  serviceUrl: string;
}

/** Teams channel context extracted from activity.channelData */
interface TeamsChannelContext {
  channelId: string;
  teamId: string;
  tenantId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TeamsAdapter v2
// ─────────────────────────────────────────────────────────────────────────────
// Key changes vs v1:
//   1. handleTurn() replaced by teams.ts Router registered in setupRouter()
//      – Every Teams activity type has a typed route handler
//      – Lifecycle events (install.add/remove, messageDelete, messageUpdate,
//        conversationUpdate member joins) are now surfaced to Chat handlers
//   2. stream() implemented using teams.ts HttpStream
//      – HttpStream manages queue, flush cadence, retry (5x), event emitting
//      – No re-implementation needed; we construct a TeamsApiClient per-call
//   3. addReaction/removeReaction implemented via Microsoft Graph API
//   4. postEphemeral implemented via Teams targeted messages
// ─────────────────────────────────────────────────────────────────────────────

export class TeamsAdapter implements Adapter<TeamsThreadId, unknown> {
  readonly name = "teams";
  readonly userName: string;
  readonly botUserId?: string;

  private readonly botAdapter: ServerlessCloudAdapter;
  private readonly graphClient: Client | null = null;
  private chat: ChatInstance | null = null;
  private readonly logger: Logger;
  private readonly formatConverter = new TeamsFormatConverter();
  private readonly config: Required<Pick<TeamsAdapterConfig, "appId">> &
    TeamsAdapterConfig;

  // ── teams.ts Router ────────────────────────────────────────────────────────
  // Owns all inbound activity dispatch. Replaces the if/else chain in v1.
  private readonly router = new Router();

  constructor(config: TeamsAdapterConfig = {}) {
    const appId = config.appId ?? process.env.TEAMS_APP_ID;
    if (!appId) {
      throw new ValidationError(
        "teams",
        "appId is required. Set TEAMS_APP_ID or provide it in config."
      );
    }
    const hasExplicitAuth =
      config.appPassword || config.certificate || config.federated;
    const appPassword = hasExplicitAuth
      ? config.appPassword
      : (config.appPassword ?? process.env.TEAMS_APP_PASSWORD);
    const appTenantId = config.appTenantId ?? process.env.TEAMS_APP_TENANT_ID;

    this.config = { ...config, appId, appPassword, appTenantId };
    this.logger = config.logger ?? new ConsoleLogger("info").child("teams");
    this.userName = config.userName || "bot";

    const authMethodCount = [
      appPassword,
      config.certificate,
      config.federated,
    ].filter(Boolean).length;

    if (authMethodCount === 0) {
      throw new ValidationError(
        "teams",
        "One of appPassword, certificate, or federated must be provided"
      );
    }
    if (authMethodCount > 1) {
      throw new ValidationError(
        "teams",
        "Only one of appPassword, certificate, or federated can be provided"
      );
    }
    if (config.appType === "SingleTenant" && !appTenantId) {
      throw new ValidationError(
        "teams",
        "appTenantId is required for SingleTenant app type"
      );
    }

    const botFrameworkConfig = {
      MicrosoftAppId: appId,
      MicrosoftAppType: config.appType || "MultiTenant",
      MicrosoftAppTenantId:
        config.appType === "SingleTenant" ? appTenantId : undefined,
    };

    let credentialsFactory:
      | CertificateServiceClientCredentialsFactory
      | FederatedServiceClientCredentialsFactory
      | undefined;
    let graphCredential: TokenCredential | undefined;

    if (config.certificate) {
      const { certificatePrivateKey, certificateThumbprint, x5c } =
        config.certificate;
      if (x5c) {
        credentialsFactory = new CertificateServiceClientCredentialsFactory(
          appId,
          x5c,
          certificatePrivateKey,
          appTenantId
        );
      } else if (certificateThumbprint) {
        credentialsFactory = new CertificateServiceClientCredentialsFactory(
          appId,
          certificateThumbprint,
          certificatePrivateKey,
          appTenantId
        );
      } else {
        throw new ValidationError(
          "teams",
          "Certificate auth requires either certificateThumbprint or x5c"
        );
      }
      if (appTenantId) {
        graphCredential = new ClientCertificateCredential(appTenantId, appId, {
          certificate: certificatePrivateKey,
        });
      }
    } else if (config.federated) {
      credentialsFactory = new FederatedServiceClientCredentialsFactory(
        appId,
        config.federated.clientId,
        appTenantId,
        config.federated.clientAudience
      );
      if (appTenantId) {
        graphCredential = new DefaultAzureCredential();
      }
    } else if (appPassword && appTenantId) {
      graphCredential = new ClientSecretCredential(
        appTenantId,
        appId,
        appPassword
      );
    }

    const auth = new ConfigurationBotFrameworkAuthentication(
      {
        ...botFrameworkConfig,
        ...(appPassword ? { MicrosoftAppPassword: appPassword } : {}),
      },
      credentialsFactory
    );

    this.botAdapter = new ServerlessCloudAdapter(auth);

    if (graphCredential) {
      const authProvider = new TokenCredentialAuthenticationProvider(
        graphCredential,
        {
          scopes: ["https://graph.microsoft.com/.default"],
        } as TokenCredentialAuthenticationProviderOptions
      );
      this.graphClient = Client.initWithMiddleware({ authProvider });
    }

    // Register all route handlers on construction so they are ready
    // before the first webhook arrives.
    this.setupRouter();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
  }

  // ── Webhook entry point ────────────────────────────────────────────────────

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    const body = await request.text();
    this.logger.debug("Teams webhook raw body", { body });

    let activity: Activity;
    try {
      activity = JSON.parse(body);
    } catch (e) {
      this.logger.error("Failed to parse request body", { error: e });
      return new Response("Invalid JSON", { status: 400 });
    }

    const authHeader = request.headers.get("authorization") || "";

    try {
      await this.botAdapter.handleActivity(
        authHeader,
        activity,
        async (context) => {
          // ── Phase 1: cache context (serviceUrl, tenantId, team GUID) ────────
          // Must run for EVERY activity type — needed for later DM/fetchMessages.
          await this.cacheActivityContext(context, options);

          // ── Phase 2: dispatch via Router ─────────────────────────────────────
          // Router.select() returns all matching handlers (can be >1, e.g. message + mention).
          // We chain them with a next() pattern consistent with how teams.ts App.process() works.
          // Cast from botbuilder Activity to teams.ts Activity — both model the same Teams JSON.
          const handlers = this.router.select(
            activity as unknown as TeamsApiActivity
          );
          if (handlers.length === 0) {
            this.logger.debug("Teams: no router handlers matched", {
              type: activity.type,
              name: (activity as { name?: string }).name,
            });
            return;
          }

          // Build a minimal context object the handlers can use
          const routeCtx = this.buildRouteContext(context, options);

          let i = -1;
          const next = async (): Promise<void> => {
            i++;
            if (i < handlers.length) {
              await (
                handlers[i] as unknown as (
                  ctx: typeof routeCtx
                ) => Promise<void>
              )(routeCtx);
            }
          };
          routeCtx.next = next;
          await next();
        }
      );

      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      this.logger.error("Bot adapter process error", { error });
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // ── Router setup ───────────────────────────────────────────────────────────
  /**
   * Register all inbound Teams activity routes.
   *
   * Route selection logic is owned entirely by teams.ts Router.select().
   * Each handler receives a minimal RouteContext (activity + next) and
   * bridges into the vercel/chat ChatInstance process* methods.
   *
   * Route registration order matters for middleware-style handlers (use()).
   * Specific on() handlers are independent and do NOT fall through to each
   * other unless next() is called explicitly.
   *
   * Activity types covered:
   *   message             → processMessage / processAction (Action.Submit)
   *   mention             → same as message (router fires both; de-duped by processMessage)
   *   messageReaction     → processReaction
   *   invoke (adaptiveCard/action) → processAction + InvokeResponse 200
   *   install.add         → processInstallation (add)
   *   install.remove      → processInstallation (remove)
   *   messageUpdate       → processMessageUpdated
   *   messageDelete       → processMessageDeleted
   *   conversationUpdate  → processMemberJoinedChannel (for human joins)
   *   meetingStart/End    → logged (extensible)
   *   activity (catch-all)→ debug log
   */
  private setupRouter(): void {
    // ── message ───────────────────────────────────────────────────────────────
    // Teams sends both plain messages AND Action.Submit button clicks as type=message.
    // Distinguish by checking activity.value.actionId.
    this.router.on("message", async (ctx) => {
      if (!this.chat) {
        return;
      }
      // Cast from teams.ts IMessageActivity to botbuilder Activity — same JSON shape
      const activity = ctx.activity as unknown as Activity;

      const actionValue = activity.value as
        | { actionId?: string; value?: string }
        | undefined;

      if (actionValue?.actionId) {
        // Action.Submit from a Legacy card — treat as an action event
        this.handleMessageAction(
          activity,
          actionValue,
          (ctx as { _options?: WebhookOptions })._options
        );
        return;
      }

      const threadId = this.encodeThreadId({
        conversationId: activity.conversation?.id || "",
        serviceUrl: activity.serviceUrl || "",
        replyToId: activity.replyToId,
      });

      this.chat.processMessage(
        this,
        threadId,
        this.parseTeamsMessage(activity, threadId),
        (ctx as { _options?: WebhookOptions })._options
      );
    });

    // ── mention ───────────────────────────────────────────────────────────────
    // Router fires 'mention' in ADDITION to 'message' when the bot is @-mentioned.
    // We call next() to let the 'message' handler above do the actual routing.
    // This avoids double-processing while keeping the route open for future hooks.
    this.router.on("mention", async (ctx) => {
      await ctx.next();
    });

    // ── messageReaction ───────────────────────────────────────────────────────
    this.router.on("messageReaction", async (ctx) => {
      // Cast from teams.ts IMessageReactionActivity to botbuilder Activity — same JSON shape
      const activity = ctx.activity as unknown as Activity;
      this.handleReactionActivity(
        activity,
        (ctx as { _options?: WebhookOptions })._options
      );
    });

    // ── card.action (adaptiveCard/action invoke) ─────────────────────────────
    // Router maps invoke name="adaptiveCard/action" to the "card.action" route alias.
    this.router.on("card.action", async (ctx) => {
      if (!this.chat) {
        return;
      }
      // Cast from teams.ts InvokeActivity to botbuilder Activity — same JSON shape
      const activity = ctx.activity as unknown as Activity;

      const actionData = activity.value?.action?.data as
        | { actionId?: string; value?: string }
        | undefined;

      if (!actionData?.actionId) {
        this.logger.debug("Adaptive card action missing actionId", {
          value: activity.value,
        });
        // Send required invoke acknowledgment even without actionId
        await (
          ctx as { _turnContext?: TurnContext }
        )._turnContext?.sendActivity({
          type: ActivityTypes.InvokeResponse,
          value: { status: 200 },
        });
        return { status: 200 };
      }

      const threadId = this.encodeThreadId({
        conversationId: activity.conversation?.id || "",
        serviceUrl: activity.serviceUrl || "",
      });

      const actionEvent: Omit<ActionEvent, "thread" | "openModal"> & {
        adapter: TeamsAdapter;
      } = {
        actionId: actionData.actionId,
        value: actionData.value,
        user: {
          userId: activity.from?.id || "unknown",
          userName: activity.from?.name || "unknown",
          fullName: activity.from?.name || "unknown",
          isBot: false,
          isMe: false,
        },
        messageId: activity.replyToId || activity.id || "",
        threadId,
        adapter: this,
        raw: activity,
      };

      this.logger.debug("Teams: adaptive card action", {
        actionId: actionData.actionId,
        threadId,
      });

      this.chat.processAction(
        actionEvent,
        (ctx as { _options?: WebhookOptions })._options
      );

      // Acknowledge the invoke to prevent client timeout
      await (ctx as { _turnContext?: TurnContext })._turnContext?.sendActivity({
        type: ActivityTypes.InvokeResponse,
        value: { status: 200 },
      });

      // Return the invoke response to satisfy teams.ts Router return type
      return { status: 200 };
    });

    // ── install.add ───────────────────────────────────────────────────────────
    // Router maps installationUpdate + action="add" to this route.
    this.router.on("install.add", async (ctx) => {
      if (!this.chat) {
        return;
      }
      // Cast from teams.ts Activity to botbuilder Activity — same JSON shape
      const activity = ctx.activity as unknown as Activity;
      const channelData = activity.channelData as {
        tenant?: { id?: string };
        team?: { id?: string };
        channel?: { id?: string };
      };

      this.logger.info("Teams: bot installed", {
        teamId: channelData?.team?.id,
        tenantId: channelData?.tenant?.id,
      });

      if ("processInstallation" in this.chat) {
        (
          this.chat as unknown as {
            processInstallation: (
              event: {
                action: "add" | "remove";
                adapter: TeamsAdapter;
                raw: unknown;
                teamId?: string;
                channelId?: string;
                tenantId?: string;
              },
              options?: WebhookOptions
            ) => void;
          }
        ).processInstallation(
          {
            action: "add",
            adapter: this,
            raw: activity,
            teamId: channelData?.team?.id,
            channelId: channelData?.channel?.id,
            tenantId: channelData?.tenant?.id,
          },
          (ctx as { _options?: WebhookOptions })._options
        );
      }
    });

    // ── install.remove ────────────────────────────────────────────────────────
    this.router.on("install.remove", async (ctx) => {
      if (!this.chat) {
        return;
      }
      // Cast from teams.ts Activity to botbuilder Activity — same JSON shape
      const activity = ctx.activity as unknown as Activity;
      const channelData = activity.channelData as {
        tenant?: { id?: string };
        team?: { id?: string };
        channel?: { id?: string };
      };

      this.logger.info("Teams: bot uninstalled", {
        teamId: channelData?.team?.id,
        tenantId: channelData?.tenant?.id,
      });

      if ("processInstallation" in this.chat) {
        (
          this.chat as unknown as {
            processInstallation: (
              event: {
                action: "add" | "remove";
                adapter: TeamsAdapter;
                raw: unknown;
                teamId?: string;
                channelId?: string;
                tenantId?: string;
              },
              options?: WebhookOptions
            ) => void;
          }
        ).processInstallation(
          {
            action: "remove",
            adapter: this,
            raw: activity,
            teamId: channelData?.team?.id,
            channelId: channelData?.channel?.id,
            tenantId: channelData?.tenant?.id,
          },
          (ctx as { _options?: WebhookOptions })._options
        );
      }
    });

    // ── messageUpdate ─────────────────────────────────────────────────────────
    // Router maps messageUpdate activities to this route.
    this.router.on("messageUpdate", async (ctx) => {
      if (!this.chat) {
        return;
      }
      // Cast from teams.ts IMessageUpdateActivity to botbuilder Activity — same JSON shape
      const activity = ctx.activity as unknown as Activity;
      const threadId = this.encodeThreadId({
        conversationId: activity.conversation?.id || "",
        serviceUrl: activity.serviceUrl || "",
      });

      this.logger.debug("Teams: messageUpdate", {
        messageId: activity.id,
        threadId,
      });

      if ("processMessageUpdated" in this.chat) {
        (
          this.chat as unknown as {
            processMessageUpdated: (
              event: {
                adapter: TeamsAdapter;
                messageId: string;
                threadId: string;
                newText: string;
                user: {
                  userId: string;
                  userName: string;
                  fullName: string;
                  isBot: boolean;
                  isMe: boolean;
                };
                raw: unknown;
              },
              options?: WebhookOptions
            ) => void;
          }
        ).processMessageUpdated(
          {
            adapter: this,
            messageId: activity.id || "",
            threadId,
            newText: this.formatConverter.extractPlainText(activity.text || ""),
            user: this.activityToAuthor(activity),
            raw: activity,
          },
          (ctx as { _options?: WebhookOptions })._options
        );
      }
    });

    // ── messageDelete ─────────────────────────────────────────────────────────
    this.router.on("messageDelete", async (ctx) => {
      if (!this.chat) {
        return;
      }
      // Cast from teams.ts IMessageDeleteActivity to botbuilder Activity — same JSON shape
      const activity = ctx.activity as unknown as Activity;
      const threadId = this.encodeThreadId({
        conversationId: activity.conversation?.id || "",
        serviceUrl: activity.serviceUrl || "",
      });

      this.logger.debug("Teams: messageDelete", {
        messageId: activity.id,
        threadId,
      });

      if ("processMessageDeleted" in this.chat) {
        (
          this.chat as unknown as {
            processMessageDeleted: (
              event: {
                adapter: TeamsAdapter;
                messageId: string;
                threadId: string;
                user: {
                  userId: string;
                  userName: string;
                  fullName: string;
                  isBot: boolean;
                  isMe: boolean;
                };
                raw: unknown;
              },
              options?: WebhookOptions
            ) => void;
          }
        ).processMessageDeleted(
          {
            adapter: this,
            messageId: activity.id || "",
            threadId,
            user: this.activityToAuthor(activity),
            raw: activity,
          },
          (ctx as { _options?: WebhookOptions })._options
        );
      }
    });

    // ── conversationUpdate ────────────────────────────────────────────────────
    // Fires when members join/leave a team or channel.
    // We surface human member joins as processMemberJoinedChannel.
    this.router.on("conversationUpdate", async (ctx) => {
      if (!this.chat) {
        return;
      }
      // Cast from teams.ts Activity to botbuilder Activity — same JSON shape
      const activity = ctx.activity as unknown as Activity;
      const membersAdded = activity.membersAdded || [];

      for (const member of membersAdded) {
        // Skip the bot itself being added (that's an install event)
        if (member.id === this.config.appId) {
          continue;
        }
        if (member.id?.includes(this.config.appId)) {
          continue;
        }

        const threadId = this.encodeThreadId({
          conversationId: activity.conversation?.id || "",
          serviceUrl: activity.serviceUrl || "",
        });

        this.logger.debug("Teams: member joined channel", {
          userId: member.id,
          threadId,
        });

        this.chat.processMemberJoinedChannel(
          {
            adapter: this,
            userId: member.id || "",
            channelId: threadId,
          },
          (ctx as { _options?: WebhookOptions })._options
        );
      }
    });

    // ── meetingStart ──────────────────────────────────────────────────────────
    // Router maps event name="application/vnd.microsoft.meetingStart" → meetingStart
    this.router.on("meetingStart", async (ctx) => {
      this.logger.debug("Teams: meetingStart", { id: ctx.activity.id });
      // Extensible: subclasses or plugins can add logic here
    });

    // ── meetingEnd ────────────────────────────────────────────────────────────
    this.router.on("meetingEnd", async (ctx) => {
      this.logger.debug("Teams: meetingEnd", { id: ctx.activity.id });
    });

    // ── catch-all ─────────────────────────────────────────────────────────────
    // Fires for every activity — used for unhandled types.
    // Lower priority than specific routes because Router processes ALL matching
    // routes (not first-match). We only log if nothing else matched.
    this.router.on("activity", async (ctx) => {
      // 'activity' matches everything. Only log types we haven't explicitly handled.
      const handledTypes = new Set([
        "message",
        "messageReaction",
        "invoke",
        "installationUpdate",
        "messageUpdate",
        "messageDelete",
        "conversationUpdate",
        "event", // meetingStart/End/etc.
      ]);
      if (!handledTypes.has(ctx.activity.type)) {
        this.logger.debug("Teams: unhandled activity type (catch-all)", {
          type: ctx.activity.type,
          name: (ctx.activity as { name?: string }).name,
        });
      }
    });
  }

  // ── Context caching (runs before router dispatch) ──────────────────────────
  /**
   * Cache serviceUrl, tenantId, and team GUID from every activity.
   * Must run before router dispatch so context is available for
   * later DM creation and fetchMessages calls.
   *
   * This logic is identical to the v1 handleTurn() caching block —
   * extracted into its own method and called first in handleWebhook().
   */
  private async cacheActivityContext(
    context: TurnContext,
    _options?: WebhookOptions
  ): Promise<void> {
    const activity = context.activity;

    if (!(activity.from?.id && activity.serviceUrl && this.chat)) {
      return;
    }

    const userId = activity.from.id;
    const channelData = activity.channelData as {
      tenant?: { id?: string };
      team?: { id?: string; aadGroupId?: string };
      channel?: { id?: string };
    };
    const tenantId = channelData?.tenant?.id;
    const ttl = 30 * 24 * 60 * 60 * 1000; // 30 days

    this.chat
      .getState()
      .set(`teams:serviceUrl:${userId}`, activity.serviceUrl, ttl)
      .catch((err) => {
        this.logger.error("Failed to cache serviceUrl", { userId, error: err });
      });

    if (tenantId) {
      this.chat
        .getState()
        .set(`teams:tenantId:${userId}`, tenantId, ttl)
        .catch((err) => {
          this.logger.error("Failed to cache tenantId", {
            userId,
            error: err,
          });
        });
    }

    const team = channelData?.team as
      | { id?: string; aadGroupId?: string }
      | undefined;
    const teamAadGroupId = team?.aadGroupId;
    const teamThreadId = team?.id;
    const conversationId = activity.conversation?.id || "";
    const baseChannelId = conversationId.replace(MESSAGEID_STRIP_PATTERN, "");

    if (teamAadGroupId && channelData?.channel?.id && tenantId) {
      const ctx: TeamsChannelContext = {
        teamId: teamAadGroupId,
        channelId: channelData.channel.id,
        tenantId,
      };
      const contextJson = JSON.stringify(ctx);

      this.chat
        .getState()
        .set(`teams:channelContext:${baseChannelId}`, contextJson, ttl)
        .catch((err) => {
          this.logger.error("Failed to cache channel context", {
            conversationId: baseChannelId,
            error: err,
          });
        });

      if (teamThreadId) {
        this.chat
          .getState()
          .set(`teams:teamContext:${teamThreadId}`, contextJson, ttl)
          .catch((err) => {
            this.logger.error("Failed to cache team context", {
              teamThreadId,
              error: err,
            });
          });
      }

      this.logger.info(
        "Cached Teams team GUID from installation/update event",
        {
          activityType: activity.type,
          conversationId: baseChannelId,
          teamThreadId,
          teamGuid: ctx.teamId,
          channelId: ctx.channelId,
        }
      );
    } else if (teamThreadId && channelData?.channel?.id && tenantId) {
      const cachedTeamContext = await this.chat
        .getState()
        .get<string>(`teams:teamContext:${teamThreadId}`);

      if (cachedTeamContext) {
        this.chat
          .getState()
          .set(`teams:channelContext:${baseChannelId}`, cachedTeamContext, ttl)
          .catch((err) => {
            this.logger.error("Failed to cache channel context from team", {
              conversationId: baseChannelId,
              error: err,
            });
          });
        this.logger.info("Using cached Teams team GUID for channel", {
          conversationId: baseChannelId,
          teamThreadId,
        });
      } else {
        try {
          const teamDetails = await TeamsInfo.getTeamDetails(context);
          if (teamDetails?.aadGroupId) {
            const fetchedContext: TeamsChannelContext = {
              teamId: teamDetails.aadGroupId,
              channelId: channelData.channel.id,
              tenantId,
            };
            const contextJson = JSON.stringify(fetchedContext);

            this.chat
              .getState()
              .set(`teams:channelContext:${baseChannelId}`, contextJson, ttl)
              .catch((err) => {
                this.logger.error("Failed to cache fetched channel context", {
                  conversationId: baseChannelId,
                  error: err,
                });
              });

            this.chat
              .getState()
              .set(`teams:teamContext:${teamThreadId}`, contextJson, ttl)
              .catch((err) => {
                this.logger.error("Failed to cache fetched team context", {
                  teamThreadId,
                  error: err,
                });
              });

            this.logger.info(
              "Fetched and cached Teams team GUID via TeamsInfo API",
              {
                conversationId: baseChannelId,
                teamThreadId,
                teamGuid: teamDetails.aadGroupId,
                teamName: teamDetails.name,
              }
            );
          }
        } catch (error) {
          this.logger.debug(
            "Could not fetch team details (may not be a team scope)",
            { teamThreadId, error }
          );
        }
      }
    }
  }

  // ── Route context builder ──────────────────────────────────────────────────
  /**
   * Build a minimal context object compatible with teams.ts route handler signatures.
   * We extend it with _turnContext (needed for invoke acknowledgments) and
   * _options (needed to pass WebhookOptions down to Chat process* calls).
   *
   * We do NOT use teams.ts ActivityContext here because that pulls in its full
   * dependency chain (GraphClient, storage, etc.) which is not what we want.
   * Our handlers only need: activity, next(), _turnContext, _options.
   */
  private buildRouteContext(
    context: TurnContext,
    options?: WebhookOptions
  ): {
    activity: Activity;
    next: () => Promise<void>;
    _turnContext: TurnContext;
    _options?: WebhookOptions;
  } {
    return {
      activity: context.activity,
      // next is replaced in handleWebhook() before the first call
      next: async () => {},
      _turnContext: context,
      _options: options,
    };
  }

  // ── Action.Submit helper ───────────────────────────────────────────────────
  /**
   * Handle Action.Submit button clicks sent as message activities.
   * Identical to v1 — called from the 'message' route handler.
   */
  private handleMessageAction(
    activity: Activity,
    actionValue: { actionId?: string; value?: string },
    options?: WebhookOptions
  ): void {
    if (!(this.chat && actionValue.actionId)) {
      return;
    }

    const threadId = this.encodeThreadId({
      conversationId: activity.conversation?.id || "",
      serviceUrl: activity.serviceUrl || "",
    });

    const actionEvent: Omit<ActionEvent, "thread" | "openModal"> & {
      adapter: TeamsAdapter;
    } = {
      actionId: actionValue.actionId,
      value: actionValue.value,
      user: {
        userId: activity.from?.id || "unknown",
        userName: activity.from?.name || "unknown",
        fullName: activity.from?.name || "unknown",
        isBot: false,
        isMe: false,
      },
      messageId: activity.replyToId || activity.id || "",
      threadId,
      adapter: this,
      raw: activity,
    };

    this.logger.debug("Teams: message action (Action.Submit)", {
      actionId: actionValue.actionId,
      threadId,
    });

    this.chat.processAction(actionEvent, options);
  }

  // ── Reaction helper ────────────────────────────────────────────────────────
  /**
   * Handle Teams reaction events (reactionsAdded / reactionsRemoved).
   * Called from the 'messageReaction' route handler.
   */
  private handleReactionActivity(
    activity: Activity,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      return;
    }

    const conversationId = activity.conversation?.id || "";
    const messageIdMatch = conversationId.match(MESSAGEID_CAPTURE_PATTERN);
    const messageId = messageIdMatch?.[1] || activity.replyToId || "";

    const threadId = this.encodeThreadId({
      conversationId,
      serviceUrl: activity.serviceUrl || "",
    });

    const user = {
      userId: activity.from?.id || "unknown",
      userName: activity.from?.name || "unknown",
      fullName: activity.from?.name || "unknown",
      isBot: false,
      isMe: this.isMessageFromSelf(activity),
    };

    for (const reaction of activity.reactionsAdded || []) {
      const rawEmoji = reaction.type || "";
      const emojiValue = defaultEmojiResolver.fromTeams(rawEmoji);

      const event: Omit<ReactionEvent, "adapter" | "thread"> = {
        emoji: emojiValue,
        rawEmoji,
        added: true,
        user,
        messageId,
        threadId,
        raw: activity,
      };

      this.logger.debug("Teams: reaction added", {
        emoji: emojiValue.name,
        rawEmoji,
        messageId,
      });

      this.chat.processReaction({ ...event, adapter: this }, options);
    }

    for (const reaction of activity.reactionsRemoved || []) {
      const rawEmoji = reaction.type || "";
      const emojiValue = defaultEmojiResolver.fromTeams(rawEmoji);

      const event: Omit<ReactionEvent, "adapter" | "thread"> = {
        emoji: emojiValue,
        rawEmoji,
        added: false,
        user,
        messageId,
        threadId,
        raw: activity,
      };

      this.logger.debug("Teams: reaction removed", {
        emoji: emojiValue.name,
        rawEmoji,
        messageId,
      });

      this.chat.processReaction({ ...event, adapter: this }, options);
    }
  }

  // ── Author helper ──────────────────────────────────────────────────────────
  private activityToAuthor(activity: Activity): {
    userId: string;
    userName: string;
    fullName: string;
    isBot: boolean;
    isMe: boolean;
  } {
    return {
      userId: activity.from?.id || "unknown",
      userName: activity.from?.name || "unknown",
      fullName: activity.from?.name || "unknown",
      isBot: activity.from?.role === "bot",
      isMe: this.isMessageFromSelf(activity),
    };
  }

  // ── Message parsing ────────────────────────────────────────────────────────

  private parseTeamsMessage(
    activity: Activity,
    threadId: string
  ): Message<unknown> {
    const text = activity.text || "";
    const normalizedText = this.normalizeMentions(text, activity);
    const isMe = this.isMessageFromSelf(activity);

    return new Message({
      id: activity.id || "",
      threadId,
      text: this.formatConverter.extractPlainText(normalizedText),
      formatted: this.formatConverter.toAst(normalizedText),
      raw: activity,
      author: {
        userId: activity.from?.id || "unknown",
        userName: activity.from?.name || "unknown",
        fullName: activity.from?.name || "unknown",
        isBot: activity.from?.role === "bot",
        isMe,
      },
      metadata: {
        dateSent: activity.timestamp
          ? new Date(activity.timestamp)
          : new Date(),
        edited: false,
      },
      attachments: (activity.attachments || [])
        .filter(
          (att) =>
            att.contentType !== "application/vnd.microsoft.card.adaptive" &&
            !(att.contentType === "text/html" && !att.contentUrl)
        )
        .map((att) => this.createAttachment(att)),
    });
  }

  private createAttachment(att: {
    contentType?: string;
    contentUrl?: string;
    name?: string;
  }): Attachment {
    const url = att.contentUrl;
    let type: Attachment["type"] = "file";
    if (att.contentType?.startsWith("image/")) {
      type = "image";
    } else if (att.contentType?.startsWith("video/")) {
      type = "video";
    } else if (att.contentType?.startsWith("audio/")) {
      type = "audio";
    }

    return {
      type,
      url,
      name: att.name,
      mimeType: att.contentType,
      fetchData: url
        ? async () => {
            const response = await fetch(url);
            if (!response.ok) {
              throw new NetworkError(
                "teams",
                `Failed to fetch file: ${response.status} ${response.statusText}`
              );
            }
            return Buffer.from(await response.arrayBuffer());
          }
        : undefined,
    };
  }

  private normalizeMentions(text: string, _activity: Activity): string {
    return text.trim();
  }

  // ── postMessage ────────────────────────────────────────────────────────────

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<unknown>> {
    const { conversationId, serviceUrl } = this.decodeThreadId(threadId);

    const files = extractFiles(message);
    const fileAttachments =
      files.length > 0 ? await this.filesToAttachments(files) : [];

    const card = extractCard(message);
    let activity: Partial<Activity>;

    if (card) {
      const adaptiveCard = cardToAdaptiveCard(card);
      activity = {
        type: ActivityTypes.Message,
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: adaptiveCard,
          },
          ...fileAttachments,
        ],
      };
      this.logger.debug("Teams API: sendActivity (adaptive card)", {
        conversationId,
        serviceUrl,
        fileCount: fileAttachments.length,
      });
    } else {
      const text = convertEmojiPlaceholders(
        this.formatConverter.renderPostable(message),
        "teams"
      );
      activity = {
        type: ActivityTypes.Message,
        text,
        textFormat: "markdown",
        attachments: fileAttachments.length > 0 ? fileAttachments : undefined,
      };
      this.logger.debug("Teams API: sendActivity (message)", {
        conversationId,
        serviceUrl,
        textLength: text.length,
        fileCount: fileAttachments.length,
      });
    }

    const conversationReference = {
      channelId: "msteams",
      serviceUrl,
      conversation: { id: conversationId },
    };

    let messageId = "";

    try {
      await this.botAdapter.continueConversationAsync(
        this.config.appId,
        conversationReference as Partial<ConversationReference>,
        async (context) => {
          const response = await context.sendActivity(activity);
          messageId = response?.id || "";
        }
      );
    } catch (error) {
      this.logger.error("Teams API: sendActivity failed", {
        conversationId,
        error,
      });
      this.handleTeamsError(error, "postMessage");
    }

    this.logger.debug("Teams API: sendActivity response", { messageId });

    return { id: messageId, threadId, raw: activity };
  }

  // ── stream() ───────────────────────────────────────────────────────────────
  /**
   * Native Teams streaming using teams.ts HttpStream.
   *
   * HttpStream manages the full Teams Live Streaming protocol:
   *   informative → streaming chunks (queue/flush/retry) → final message
   *
   * We construct a TeamsApiClient per conversation serviceUrl, then call
   * ActivitySender.createStream() which returns an HttpStream instance.
   * HttpStream uses promises.retry() (5 attempts, 500ms doubling backoff)
   * internally — we get that for free.
   *
   * The stream() method on the Adapter interface is optional. When present,
   * ThreadImpl will call it instead of the fallback post+edit path.
   */
  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    options?: StreamOptions
  ): Promise<RawMessage<unknown>> {
    const { conversationId, serviceUrl } = this.decodeThreadId(threadId);

    // Build a teams.ts Client pointing at the Bot Connector serviceUrl
    // TeamsApiClient is a lightweight HTTP client — safe to construct per-call
    const teamsApiClient = new TeamsApiClient(serviceUrl);

    // ConversationReference required by HttpStream
    const ref = {
      bot: { id: this.config.appId, name: this.userName, role: "bot" as const },
      conversation: {
        id: conversationId,
        conversationType: "channel",
        isGroup: true,
      },
      channelId: "msteams",
      serviceUrl,
    };

    // Create the HttpStream — this is the real teams.ts implementation
    const httpStream = new HttpStream(
      teamsApiClient,
      ref,
      // Adapt our Logger to teams.ts ILogger interface
      this.toTeamsLogger()
    );

    // Send informative status label before content begins (optional)
    if (options?.updateIntervalMs !== undefined) {
      // No-op: updateIntervalMs is a fallback-mode hint; not used for native streaming
    }

    this.logger.debug("Teams API: stream start", { conversationId });

    // Consume the async iterable and feed text into HttpStream
    for await (const chunk of textStream) {
      if (typeof chunk === "string") {
        httpStream.emit(chunk);
      } else if (chunk.type === "markdown_text") {
        // markdown_text StreamChunks carry text content — emit as text
        httpStream.emit(chunk.text);
      }
      // task_update and plan_update are Slack-specific structured chunks.
      // Teams has no equivalent — silently skip (consistent with fallback path behaviour).
    }

    // Close the stream: HttpStream flushes queue, waits for streamId, sends final message
    const result = await httpStream.close();
    const finalId = result?.id ?? "";

    this.logger.debug("Teams API: stream complete", {
      conversationId,
      messageId: finalId,
    });

    return { id: finalId, threadId, raw: result };
  }

  /**
   * Emit a streaming informative status update ("Thinking...") before content starts.
   * Called by ThreadImpl when a status string is available. This delegates
   * directly to HttpStream.update() which sends an informative TypingActivity.
   *
   * NOTE: This is only relevant if you want to send the informative label
   * outside the stream() call itself. Most callers will pass statusText
   * via StreamOptions. See thread.ts startTyping() for how this is triggered.
   */
  async startTyping(threadId: string, status?: string): Promise<void> {
    const { conversationId, serviceUrl } = this.decodeThreadId(threadId);

    const conversationReference = {
      channelId: "msteams",
      serviceUrl,
      conversation: { id: conversationId },
    };

    this.logger.debug("Teams API: sendActivity (typing)", { conversationId });

    try {
      await this.botAdapter.continueConversationAsync(
        this.config.appId,
        conversationReference as Partial<ConversationReference>,
        async (context) => {
          if (status) {
            // Send informative typing with status text
            await context.sendActivity({
              type: ActivityTypes.Typing,
              text: status,
              channelData: { streamType: "informative" },
            });
          } else {
            await context.sendActivity({ type: ActivityTypes.Typing });
          }
        }
      );
    } catch (error) {
      this.logger.error("Teams API: sendActivity (typing) failed", {
        conversationId,
        error,
      });
      this.handleTeamsError(error, "startTyping");
    }

    this.logger.debug("Teams API: sendActivity (typing) response", {
      ok: true,
    });
  }

  // ── editMessage ────────────────────────────────────────────────────────────

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<unknown>> {
    const { conversationId, serviceUrl } = this.decodeThreadId(threadId);

    const card = extractCard(message);
    let activity: Partial<Activity>;

    if (card) {
      const adaptiveCard = cardToAdaptiveCard(card);
      activity = {
        id: messageId,
        type: ActivityTypes.Message,
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: adaptiveCard,
          },
        ],
      };
      this.logger.debug("Teams API: updateActivity (adaptive card)", {
        conversationId,
        messageId,
      });
    } else {
      const text = convertEmojiPlaceholders(
        this.formatConverter.renderPostable(message),
        "teams"
      );
      activity = {
        id: messageId,
        type: ActivityTypes.Message,
        text,
        textFormat: "markdown",
      };
      this.logger.debug("Teams API: updateActivity", {
        conversationId,
        messageId,
        textLength: text.length,
      });
    }

    const conversationReference = {
      channelId: "msteams",
      serviceUrl,
      conversation: { id: conversationId },
    };

    try {
      await this.botAdapter.continueConversationAsync(
        this.config.appId,
        conversationReference as Partial<ConversationReference>,
        async (context) => {
          await context.updateActivity(activity);
        }
      );
    } catch (error) {
      this.logger.error("Teams API: updateActivity failed", {
        conversationId,
        messageId,
        error,
      });
      this.handleTeamsError(error, "editMessage");
    }

    this.logger.debug("Teams API: updateActivity response", { ok: true });

    return { id: messageId, threadId, raw: activity };
  }

  // ── deleteMessage ──────────────────────────────────────────────────────────

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const { conversationId, serviceUrl } = this.decodeThreadId(threadId);

    const conversationReference = {
      channelId: "msteams",
      serviceUrl,
      conversation: { id: conversationId },
    };

    this.logger.debug("Teams API: deleteActivity", {
      conversationId,
      messageId,
    });

    try {
      await this.botAdapter.continueConversationAsync(
        this.config.appId,
        conversationReference as Partial<ConversationReference>,
        async (context) => {
          await context.deleteActivity(messageId);
        }
      );
    } catch (error) {
      this.logger.error("Teams API: deleteActivity failed", {
        conversationId,
        messageId,
        error,
      });
      this.handleTeamsError(error, "deleteMessage");
    }

    this.logger.debug("Teams API: deleteActivity response", { ok: true });
  }

  // ── addReaction / removeReaction ───────────────────────────────────────────
  /**
   * Add a reaction to a message via Microsoft Graph API.
   *
   * Requires: appTenantId configured + one of:
   *   - ChatMessage.ReadWrite (for 1:1 / group chats)
   *   - ChannelMessage.ReadWrite (for channel messages)
   *
   * Graph endpoint: POST /chats/{chatId}/messages/{messageId}/setReaction
   */
  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    if (!this.graphClient) {
      throw new NotImplementedError(
        "Teams addReaction requires appTenantId to be configured for Microsoft Graph API access.",
        "addReaction"
      );
    }

    const { conversationId } = this.decodeThreadId(threadId);
    const baseConversationId = conversationId.replace(
      MESSAGEID_STRIP_PATTERN,
      ""
    );

    const reactionType = this.resolveReactionType(emoji);

    this.logger.debug("Teams Graph API: setReaction", {
      conversationId: baseConversationId,
      messageId,
      reactionType,
    });

    try {
      await this.graphClient
        .api(
          `/chats/${encodeURIComponent(baseConversationId)}/messages/${encodeURIComponent(messageId)}/setReaction`
        )
        .post({ reactionType });
    } catch (error) {
      this.logger.error("Teams Graph API: setReaction failed", { error });
      this.handleTeamsError(error, "addReaction");
    }
  }

  /** Resolve an EmojiValue or plain string to the Teams reaction type string. */
  private resolveReactionType(emoji: EmojiValue | string): string {
    return typeof emoji === "string" ? emoji : (emoji as EmojiValue).name;
  }

  /**
   * Remove a reaction from a message via Microsoft Graph API.
   *
   * Graph endpoint: POST /chats/{chatId}/messages/{messageId}/unsetReaction
   */
  async removeReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    if (!this.graphClient) {
      throw new NotImplementedError(
        "Teams removeReaction requires appTenantId to be configured for Microsoft Graph API access.",
        "removeReaction"
      );
    }

    const { conversationId } = this.decodeThreadId(threadId);
    const baseConversationId = conversationId.replace(
      MESSAGEID_STRIP_PATTERN,
      ""
    );

    const reactionType = this.resolveReactionType(emoji);

    this.logger.debug("Teams Graph API: unsetReaction", {
      conversationId: baseConversationId,
      messageId,
      reactionType,
    });

    try {
      await this.graphClient
        .api(
          `/chats/${encodeURIComponent(baseConversationId)}/messages/${encodeURIComponent(messageId)}/unsetReaction`
        )
        .post({ reactionType });
    } catch (error) {
      this.logger.error("Teams Graph API: unsetReaction failed", { error });
      this.handleTeamsError(error, "removeReaction");
    }
  }

  // ── postEphemeral ──────────────────────────────────────────────────────────
  /**
   * Post a message visible only to a specific user in a shared conversation.
   *
   * Uses Teams targeted messages (experimental):
   *   activity.channelData.OnBehalfOf = [{ mentionType: "person", mri: userId }]
   *
   * Falls back to thread.ts DM path if this fails (handled by ThreadImpl).
   *
   * @experimental Teams targeted messages API is in preview.
   */
  async postEphemeral(
    threadId: string,
    userId: string,
    message: AdapterPostableMessage
  ): Promise<EphemeralMessage<Partial<Activity>>> {
    const { conversationId, serviceUrl } = this.decodeThreadId(threadId);

    const card = extractCard(message);
    let activity: Partial<Activity>;

    if (card) {
      const adaptiveCard = cardToAdaptiveCard(card);
      activity = {
        type: ActivityTypes.Message,
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: adaptiveCard,
          },
        ],
      };
    } else {
      const text = convertEmojiPlaceholders(
        this.formatConverter.renderPostable(message),
        "teams"
      );
      activity = {
        type: ActivityTypes.Message,
        text,
        textFormat: "markdown",
      };
    }

    // Teams targeted message: only the specified user sees it in the shared conversation
    activity.channelData = {
      ...(typeof activity.channelData === "object" &&
      activity.channelData !== null
        ? activity.channelData
        : {}),
      OnBehalfOf: [{ itemId: 0, mentionType: "person", mri: userId }],
    };

    const conversationReference = {
      channelId: "msteams",
      serviceUrl,
      conversation: { id: conversationId },
    };

    let messageId = "";

    this.logger.debug("Teams API: postEphemeral (targeted message)", {
      conversationId,
      userId,
    });

    try {
      await this.botAdapter.continueConversationAsync(
        this.config.appId,
        conversationReference as Partial<ConversationReference>,
        async (context) => {
          const response = await context.sendActivity(activity);
          messageId = response?.id || "";
        }
      );
    } catch (error) {
      this.logger.error("Teams API: postEphemeral failed", {
        conversationId,
        userId,
        error,
      });
      this.handleTeamsError(error, "postEphemeral");
    }

    this.logger.debug("Teams API: postEphemeral response", { messageId });

    return { id: messageId, threadId, raw: activity, usedFallback: false };
  }

  // ── openDM ────────────────────────────────────────────────────────────────

  async openDM(userId: string): Promise<string> {
    const cachedServiceUrl = await this.chat
      ?.getState()
      .get<string>(`teams:serviceUrl:${userId}`);
    const cachedTenantId = await this.chat
      ?.getState()
      .get<string>(`teams:tenantId:${userId}`);

    const serviceUrl =
      cachedServiceUrl || "https://smba.trafficmanager.net/teams/";
    const tenantId = cachedTenantId || this.config.appTenantId;

    this.logger.debug("Teams: creating 1:1 conversation", {
      userId,
      serviceUrl,
      tenantId,
      cachedServiceUrl: !!cachedServiceUrl,
      cachedTenantId: !!cachedTenantId,
    });

    if (!tenantId) {
      throw new ValidationError(
        "teams",
        "Cannot open DM: tenant ID not found. User must interact with the bot first (via @mention) to cache their tenant ID."
      );
    }

    let conversationId = "";

    // biome-ignore lint/suspicious/noExplicitAny: BotBuilder types are incomplete
    await (this.botAdapter as any).createConversationAsync(
      this.config.appId,
      "msteams",
      serviceUrl,
      "",
      {
        isGroup: false,
        bot: { id: this.config.appId, name: this.userName },
        members: [{ id: userId }],
        tenantId,
        channelData: { tenant: { id: tenantId } },
      },
      async (turnContext: TurnContext) => {
        conversationId = turnContext?.activity?.conversation?.id || "";
        this.logger.debug("Teams: conversation created in callback", {
          conversationId,
          activityId: turnContext?.activity?.id,
        });
      }
    );

    if (!conversationId) {
      throw new NetworkError(
        "teams",
        "Failed to create 1:1 conversation - no ID returned"
      );
    }

    this.logger.debug("Teams: 1:1 conversation created", { conversationId });

    return this.encodeThreadId({ conversationId, serviceUrl });
  }

  // ── fetchMessages ──────────────────────────────────────────────────────────

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<unknown>> {
    if (!this.graphClient) {
      throw new NotImplementedError(
        "Teams fetchMessages requires appTenantId to be configured for Microsoft Graph API access.",
        "fetchMessages"
      );
    }

    const { conversationId } = this.decodeThreadId(threadId);
    const limit = options.limit || 50;
    const cursor = options.cursor;
    const direction = options.direction ?? "backward";

    const messageIdMatch = conversationId.match(
      SEMICOLON_MESSAGEID_CAPTURE_PATTERN
    );
    const threadMessageId = messageIdMatch?.[1];

    const baseConversationId = conversationId.replace(
      MESSAGEID_STRIP_PATTERN,
      ""
    );

    let channelContext: TeamsChannelContext | null = null;
    if (threadMessageId && this.chat) {
      const cachedContext = await this.chat
        .getState()
        .get<string>(`teams:channelContext:${baseConversationId}`);
      if (cachedContext) {
        try {
          channelContext = JSON.parse(cachedContext) as TeamsChannelContext;
        } catch {
          // Invalid cached data
        }
      }
    }

    try {
      this.logger.debug("Teams Graph API: fetching messages", {
        conversationId: baseConversationId,
        threadMessageId,
        hasChannelContext: !!channelContext,
        limit,
        cursor,
        direction,
      });

      if (channelContext && threadMessageId) {
        return this.fetchChannelThreadMessages(
          channelContext,
          threadMessageId,
          threadId,
          options
        );
      }

      let graphMessages: GraphChatMessage[];
      let hasMoreMessages = false;

      if (direction === "forward") {
        const allMessages: GraphChatMessage[] = [];
        let nextLink: string | undefined;
        const apiUrl = `/chats/${encodeURIComponent(baseConversationId)}/messages`;

        do {
          const request = nextLink
            ? this.graphClient.api(nextLink)
            : this.graphClient
                .api(apiUrl)
                .top(50)
                .orderby("createdDateTime desc");

          const response = await request.get();
          const pageMessages = (response.value || []) as GraphChatMessage[];
          allMessages.push(...pageMessages);
          nextLink = response["@odata.nextLink"];
        } while (nextLink);

        allMessages.reverse();

        let startIndex = 0;
        if (cursor) {
          startIndex = allMessages.findIndex(
            (msg) => msg.createdDateTime && msg.createdDateTime > cursor
          );
          if (startIndex === -1) {
            startIndex = allMessages.length;
          }
        }

        hasMoreMessages = startIndex + limit < allMessages.length;
        graphMessages = allMessages.slice(startIndex, startIndex + limit);
      } else {
        let request = this.graphClient
          .api(`/chats/${encodeURIComponent(baseConversationId)}/messages`)
          .top(limit)
          .orderby("createdDateTime desc");

        if (cursor) {
          request = request.filter(`createdDateTime lt ${cursor}`);
        }

        const response = await request.get();
        graphMessages = (response.value || []) as GraphChatMessage[];
        graphMessages.reverse();
        hasMoreMessages = graphMessages.length >= limit;
      }

      if (threadMessageId && !channelContext) {
        graphMessages = graphMessages.filter(
          (msg) => msg.id && msg.id >= threadMessageId
        );
        this.logger.debug("Filtered group chat messages to thread", {
          threadMessageId,
          filteredCount: graphMessages.length,
        });
      }

      this.logger.debug("Teams Graph API: fetched messages", {
        count: graphMessages.length,
        direction,
        hasMoreMessages,
      });

      const messages = graphMessages.map((msg) =>
        this.graphMessageToMessage(msg, threadId)
      );

      let nextCursor: string | undefined;
      if (hasMoreMessages && graphMessages.length > 0) {
        if (direction === "forward") {
          const lastMsg = graphMessages.at(-1);
          if (lastMsg?.createdDateTime) {
            nextCursor = lastMsg.createdDateTime;
          }
        } else {
          const oldestMsg = graphMessages[0];
          if (oldestMsg?.createdDateTime) {
            nextCursor = oldestMsg.createdDateTime;
          }
        }
      }

      return { messages, nextCursor };
    } catch (error) {
      this.logger.error("Teams Graph API: fetchMessages error", { error });

      if (error instanceof Error && error.message?.includes("403")) {
        throw new NotImplementedError(
          "Teams fetchMessages requires one of these Azure AD app permissions: ChatMessage.Read.Chat, Chat.Read.All, or Chat.Read.WhereInstalled",
          "fetchMessages"
        );
      }

      throw error;
    }
  }

  private async fetchChannelThreadMessages(
    context: TeamsChannelContext,
    threadMessageId: string,
    threadId: string,
    options: FetchOptions
  ): Promise<FetchResult<unknown>> {
    const limit = options.limit || 50;
    const cursor = options.cursor;
    const direction = options.direction ?? "backward";

    this.logger.debug("Teams Graph API: fetching channel thread messages", {
      teamId: context.teamId,
      channelId: context.channelId,
      threadMessageId,
      limit,
      cursor,
      direction,
    });

    const parentUrl = `/teams/${encodeURIComponent(context.teamId)}/channels/${encodeURIComponent(context.channelId)}/messages/${encodeURIComponent(threadMessageId)}`;
    const repliesUrl = `${parentUrl}/replies`;

    const graphClient = this.graphClient;
    if (!graphClient) {
      throw new AuthenticationError("teams", "Graph client not initialized");
    }

    let parentMessage: GraphChatMessage | null = null;
    try {
      parentMessage = (await graphClient
        .api(parentUrl)
        .get()) as GraphChatMessage;
    } catch (err) {
      this.logger.warn("Failed to fetch parent message", {
        threadMessageId,
        err,
      });
    }

    let graphMessages: GraphChatMessage[];
    let hasMoreMessages = false;

    const fetchAllReplies = async (): Promise<GraphChatMessage[]> => {
      const all: GraphChatMessage[] = [];
      let nextLink: string | undefined;
      do {
        const request = nextLink
          ? graphClient.api(nextLink)
          : graphClient.api(repliesUrl).top(50);
        const response = await request.get();
        all.push(...((response.value || []) as GraphChatMessage[]));
        nextLink = response["@odata.nextLink"];
      } while (nextLink);
      return all;
    };

    const allReplies = await fetchAllReplies();
    allReplies.reverse(); // chronological (oldest first)

    const allMessages = parentMessage
      ? [parentMessage, ...allReplies]
      : allReplies;

    if (direction === "forward") {
      let startIndex = 0;
      if (cursor) {
        startIndex = allMessages.findIndex(
          (msg) => msg.createdDateTime && msg.createdDateTime > cursor
        );
        if (startIndex === -1) {
          startIndex = allMessages.length;
        }
      }
      hasMoreMessages = startIndex + limit < allMessages.length;
      graphMessages = allMessages.slice(startIndex, startIndex + limit);
    } else if (cursor) {
      const cursorIndex = allMessages.findIndex(
        (msg) => msg.createdDateTime && msg.createdDateTime >= cursor
      );
      if (cursorIndex > 0) {
        const sliceStart = Math.max(0, cursorIndex - limit);
        graphMessages = allMessages.slice(sliceStart, cursorIndex);
        hasMoreMessages = sliceStart > 0;
      } else {
        graphMessages = allMessages.slice(-limit);
        hasMoreMessages = allMessages.length > limit;
      }
    } else {
      graphMessages = allMessages.slice(-limit);
      hasMoreMessages = allMessages.length > limit;
    }

    this.logger.debug("Teams Graph API: fetched channel thread messages", {
      count: graphMessages.length,
      direction,
      hasMoreMessages,
    });

    const messages = graphMessages.map((msg) =>
      this.graphMessageToMessage(msg, threadId)
    );

    let nextCursor: string | undefined;
    if (hasMoreMessages && graphMessages.length > 0) {
      if (direction === "forward") {
        const lastMsg = graphMessages.at(-1);
        if (lastMsg?.createdDateTime) {
          nextCursor = lastMsg.createdDateTime;
        }
      } else {
        const oldestMsg = graphMessages[0];
        if (oldestMsg?.createdDateTime) {
          nextCursor = oldestMsg.createdDateTime;
        }
      }
    }

    return { messages, nextCursor };
  }

  /** Convert a raw Graph message to a vercel/chat Message */
  private graphMessageToMessage(
    msg: GraphChatMessage,
    threadId: string
  ): Message<unknown> {
    const isFromBot =
      msg.from?.application?.id === this.config.appId ||
      msg.from?.user?.id === this.config.appId;

    return new Message({
      id: msg.id,
      threadId,
      text: this.extractTextFromGraphMessage(msg),
      formatted: this.formatConverter.toAst(
        this.extractTextFromGraphMessage(msg)
      ),
      raw: msg,
      author: {
        userId: msg.from?.user?.id || msg.from?.application?.id || "unknown",
        userName:
          msg.from?.user?.displayName ||
          msg.from?.application?.displayName ||
          "unknown",
        fullName:
          msg.from?.user?.displayName ||
          msg.from?.application?.displayName ||
          "unknown",
        isBot: !!msg.from?.application,
        isMe: isFromBot,
      },
      metadata: {
        dateSent: msg.createdDateTime
          ? new Date(msg.createdDateTime)
          : new Date(),
        edited: !!msg.lastModifiedDateTime,
      },
      attachments: this.extractAttachmentsFromGraphMessage(msg),
    });
  }

  private extractTextFromGraphMessage(msg: GraphChatMessage): string {
    if (msg.body?.contentType === "text") {
      return msg.body.content || "";
    }

    let text = "";
    if (msg.body?.content) {
      let stripped = "";
      let inTag = false;
      for (const ch of msg.body.content) {
        if (ch === "<") {
          inTag = true;
        } else if (ch === ">") {
          inTag = false;
        } else if (!inTag) {
          stripped += ch;
        }
      }
      text = stripped.trim();
    }

    if (!text && msg.attachments?.length) {
      for (const att of msg.attachments) {
        if (att.contentType === "application/vnd.microsoft.card.adaptive") {
          try {
            const card = JSON.parse(att.content || "{}");
            const title = this.extractCardTitle(card);
            return title || "[Card]";
          } catch {
            return "[Card]";
          }
        }
      }
    }

    return text;
  }

  private extractCardTitle(card: unknown): string | null {
    if (!card || typeof card !== "object") {
      return null;
    }
    const cardObj = card as Record<string, unknown>;
    if (Array.isArray(cardObj.body)) {
      for (const element of cardObj.body) {
        if (
          element &&
          typeof element === "object" &&
          (element as Record<string, unknown>).type === "TextBlock"
        ) {
          const textBlock = element as Record<string, unknown>;
          if (
            textBlock.weight === "bolder" ||
            textBlock.size === "large" ||
            textBlock.size === "extraLarge"
          ) {
            const text = textBlock.text;
            if (typeof text === "string") {
              return text;
            }
          }
        }
      }
      for (const element of cardObj.body) {
        if (
          element &&
          typeof element === "object" &&
          (element as Record<string, unknown>).type === "TextBlock"
        ) {
          const text = (element as Record<string, unknown>).text;
          if (typeof text === "string") {
            return text;
          }
        }
      }
    }
    return null;
  }

  private extractAttachmentsFromGraphMessage(
    msg: GraphChatMessage
  ): Attachment[] {
    if (!msg.attachments?.length) {
      return [];
    }
    return msg.attachments.map((att) => ({
      type: (att.contentType?.includes("image")
        ? "image"
        : "file") as Attachment["type"],
      name: att.name || undefined,
      url: att.contentUrl || undefined,
      mimeType: att.contentType || undefined,
    }));
  }

  // ── fetchThread / channelIdFromThreadId / fetchChannelMessages ─────────────

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { conversationId } = this.decodeThreadId(threadId);
    return { id: threadId, channelId: conversationId, metadata: {} };
  }

  channelIdFromThreadId(threadId: string): string {
    const { conversationId, serviceUrl } = this.decodeThreadId(threadId);
    const baseConversationId = conversationId.replace(
      MESSAGEID_STRIP_PATTERN,
      ""
    );
    return this.encodeThreadId({
      conversationId: baseConversationId,
      serviceUrl,
    });
  }

  async fetchChannelMessages(
    channelId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<unknown>> {
    if (!this.graphClient) {
      throw new NotImplementedError(
        "Teams fetchChannelMessages requires appTenantId for Microsoft Graph API access.",
        "fetchChannelMessages"
      );
    }

    const { conversationId } = this.decodeThreadId(channelId);
    const baseConversationId = conversationId.replace(
      MESSAGEID_STRIP_PATTERN,
      ""
    );
    const limit = options.limit || 50;
    const direction = options.direction ?? "backward";

    try {
      let channelContext: TeamsChannelContext | null = null;
      if (this.chat) {
        const cachedContext = await this.chat
          .getState()
          .get<string>(`teams:channelContext:${baseConversationId}`);
        if (cachedContext) {
          try {
            channelContext = JSON.parse(cachedContext) as TeamsChannelContext;
          } catch {
            // Ignore invalid cache
          }
        }
      }

      this.logger.debug("Teams Graph API: fetchChannelMessages", {
        conversationId: baseConversationId,
        hasChannelContext: !!channelContext,
        limit,
        direction,
      });

      let graphMessages: GraphChatMessage[];
      let hasMoreMessages = false;

      if (channelContext) {
        const apiUrl = `/teams/${encodeURIComponent(channelContext.teamId)}/channels/${encodeURIComponent(channelContext.channelId)}/messages`;

        if (direction === "forward") {
          const allMessages: GraphChatMessage[] = [];
          let nextLink: string | undefined;
          do {
            const request = nextLink
              ? this.graphClient.api(nextLink)
              : this.graphClient.api(apiUrl).top(50);
            const response = await request.get();
            allMessages.push(...((response.value || []) as GraphChatMessage[]));
            nextLink = response["@odata.nextLink"];
          } while (nextLink);

          allMessages.reverse();
          let startIndex = 0;
          if (options.cursor) {
            const cur = options.cursor;
            startIndex = allMessages.findIndex(
              (msg) => msg.createdDateTime && msg.createdDateTime > cur
            );
            if (startIndex === -1) {
              startIndex = allMessages.length;
            }
          }
          hasMoreMessages = startIndex + limit < allMessages.length;
          graphMessages = allMessages.slice(startIndex, startIndex + limit);
        } else {
          let request = this.graphClient.api(apiUrl).top(limit);
          if (options.cursor) {
            request = request.filter(`createdDateTime lt ${options.cursor}`);
          }
          const response = await request.get();
          graphMessages = (response.value || []) as GraphChatMessage[];
          graphMessages.reverse();
          hasMoreMessages = graphMessages.length >= limit;
        }
      } else if (direction === "forward") {
        // Group chat / 1:1 — use chats endpoint, forward direction
        const allMessages: GraphChatMessage[] = [];
        let nextLink: string | undefined;
        const apiUrl = `/chats/${encodeURIComponent(baseConversationId)}/messages`;
        do {
          const request = nextLink
            ? this.graphClient.api(nextLink)
            : this.graphClient
                .api(apiUrl)
                .top(50)
                .orderby("createdDateTime desc");
          const response = await request.get();
          allMessages.push(...((response.value || []) as GraphChatMessage[]));
          nextLink = response["@odata.nextLink"];
        } while (nextLink);

        allMessages.reverse();
        let startIndex = 0;
        if (options.cursor) {
          const cur = options.cursor;
          startIndex = allMessages.findIndex(
            (msg) => msg.createdDateTime && msg.createdDateTime > cur
          );
          if (startIndex === -1) {
            startIndex = allMessages.length;
          }
        }
        hasMoreMessages = startIndex + limit < allMessages.length;
        graphMessages = allMessages.slice(startIndex, startIndex + limit);
      } else {
        // Group chat / 1:1 — use chats endpoint, backward direction
        let request = this.graphClient
          .api(`/chats/${encodeURIComponent(baseConversationId)}/messages`)
          .top(limit)
          .orderby("createdDateTime desc");
        if (options.cursor) {
          request = request.filter(`createdDateTime lt ${options.cursor}`);
        }
        const response = await request.get();
        graphMessages = (response.value || []) as GraphChatMessage[];
        graphMessages.reverse();
        hasMoreMessages = graphMessages.length >= limit;
      }

      const messages = graphMessages.map((msg) =>
        this.graphMessageToMessage(msg, channelId)
      );

      let nextCursor: string | undefined;
      if (hasMoreMessages && graphMessages.length > 0) {
        if (direction === "forward") {
          const lastMsg = graphMessages.at(-1);
          if (lastMsg?.createdDateTime) {
            nextCursor = lastMsg.createdDateTime;
          }
        } else {
          const oldestMsg = graphMessages[0];
          if (oldestMsg?.createdDateTime) {
            nextCursor = oldestMsg.createdDateTime;
          }
        }
      }

      return { messages, nextCursor };
    } catch (error) {
      this.logger.error("Teams Graph API: fetchChannelMessages error", {
        error,
      });
      throw error;
    }
  }

  // ── File uploads ───────────────────────────────────────────────────────────

  private async filesToAttachments(
    files: FileUpload[]
  ): Promise<Array<{ contentType: string; contentUrl: string; name: string }>> {
    const attachments: Array<{
      contentType: string;
      contentUrl: string;
      name: string;
    }> = [];

    for (const file of files) {
      const buffer = await toBuffer(file.data, {
        platform: "teams",
        throwOnUnsupported: false,
      });
      if (!buffer) {
        continue;
      }

      const mimeType = file.mimeType || "application/octet-stream";
      const dataUri = bufferToDataUri(buffer, mimeType);

      attachments.push({
        contentType: mimeType,
        contentUrl: dataUri,
        name: file.filename,
      });
    }

    return attachments;
  }

  // ── Thread ID encoding ────────────────────────────────────────────────────

  encodeThreadId(platformData: TeamsThreadId): string {
    const encodedConversationId = Buffer.from(
      platformData.conversationId
    ).toString("base64url");
    const encodedServiceUrl = Buffer.from(platformData.serviceUrl).toString(
      "base64url"
    );
    return `teams:${encodedConversationId}:${encodedServiceUrl}`;
  }

  decodeThreadId(threadId: string): TeamsThreadId {
    const parts = threadId.split(":");
    if (parts.length !== 3 || parts[0] !== "teams") {
      throw new ValidationError(
        "teams",
        `Invalid Teams thread ID: ${threadId}`
      );
    }
    const conversationId = Buffer.from(
      parts[1] as string,
      "base64url"
    ).toString("utf-8");
    const serviceUrl = Buffer.from(parts[2] as string, "base64url").toString(
      "utf-8"
    );
    return { conversationId, serviceUrl };
  }

  isDM(threadId: string): boolean {
    const { conversationId } = this.decodeThreadId(threadId);
    return !conversationId.startsWith("19:");
  }

  parseMessage(raw: unknown): Message<unknown> {
    const activity = raw as Activity;
    const threadId = this.encodeThreadId({
      conversationId: activity.conversation?.id || "",
      serviceUrl: activity.serviceUrl || "",
    });
    return this.parseTeamsMessage(activity, threadId);
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  // ── Self-detection ─────────────────────────────────────────────────────────

  private isMessageFromSelf(activity: Activity): boolean {
    const fromId = activity.from?.id;
    if (!(fromId && this.config.appId)) {
      return false;
    }
    if (fromId === this.config.appId) {
      return true;
    }
    if (fromId.endsWith(`:${this.config.appId}`)) {
      return true;
    }
    return false;
  }

  // ── teams.ts ILogger adapter ───────────────────────────────────────────────
  /**
   * Adapt vercel/chat Logger to the teams.ts ILogger interface.
   * HttpStream expects: debug(), info(), warn(), error(), trace(), log(), child()
   */
  private toTeamsLogger(): {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
    trace(...args: unknown[]): void;
    log(level: string, ...args: unknown[]): void;
    child(prefix: string): ReturnType<TeamsAdapter["toTeamsLogger"]>;
  } {
    const log = this.logger;
    const adapt = (
      parentLog: Logger
    ): ReturnType<TeamsAdapter["toTeamsLogger"]> => ({
      debug: (...args: unknown[]) =>
        parentLog.debug(String(args[0]), args[1] as object),
      info: (...args: unknown[]) =>
        parentLog.info(String(args[0]), args[1] as object),
      warn: (...args: unknown[]) =>
        parentLog.warn(String(args[0]), args[1] as object),
      error: (...args: unknown[]) =>
        parentLog.error(String(args[0]), args[1] as object),
      trace: (...args: unknown[]) =>
        parentLog.debug(String(args[0]), args[1] as object),
      log: (level: string, ...args: unknown[]) => {
        const msg = String(args[0]);
        const meta = args[1] as object;
        if (level === "error") {
          parentLog.error(msg, meta);
        } else if (level === "warn") {
          parentLog.warn(msg, meta);
        } else if (level === "debug" || level === "trace") {
          parentLog.debug(msg, meta);
        } else {
          parentLog.info(msg, meta);
        }
      },
      child: (prefix: string) => adapt(parentLog.child(prefix)),
    });
    return adapt(log);
  }

  // ── Error normalization ────────────────────────────────────────────────────

  private handleTeamsError(error: unknown, operation: string): never {
    if (error && typeof error === "object") {
      const err = error as Record<string, unknown>;
      const statusCode =
        (err.statusCode as number) ||
        (err.status as number) ||
        (err.code as number);

      if (statusCode === 401 || statusCode === 403) {
        throw new AuthenticationError(
          "teams",
          `Authentication failed for ${operation}: ${err.message || "unauthorized"}`
        );
      }

      if (statusCode === 404) {
        throw new NetworkError(
          "teams",
          `Resource not found during ${operation}: conversation or message may no longer exist`,
          error instanceof Error ? error : undefined
        );
      }

      if (statusCode === 429) {
        const retryAfter =
          typeof err.retryAfter === "number" ? err.retryAfter : undefined;
        throw new AdapterRateLimitError("teams", retryAfter);
      }

      if (
        statusCode === 403 ||
        (err.message &&
          typeof err.message === "string" &&
          err.message.toLowerCase().includes("permission"))
      ) {
        throw new PermissionError("teams", operation);
      }

      if (err.message && typeof err.message === "string") {
        throw new NetworkError(
          "teams",
          `Teams API error during ${operation}: ${err.message}`,
          error instanceof Error ? error : undefined
        );
      }
    }

    throw new NetworkError(
      "teams",
      `Teams API error during ${operation}: ${String(error)}`,
      error instanceof Error ? error : undefined
    );
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createTeamsAdapter(config?: TeamsAdapterConfig): TeamsAdapter {
  return new TeamsAdapter(config ?? {});
}

export { cardToAdaptiveCard, cardToFallbackText } from "./cards";
export { TeamsFormatConverter } from "./markdown";
