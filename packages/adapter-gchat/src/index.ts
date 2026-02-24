import {
  AdapterRateLimitError,
  AuthenticationError,
  extractCard,
  extractFiles,
  NetworkError,
  ValidationError,
} from "@chat-adapter/shared";
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
  FormattedContent,
  ListThreadsOptions,
  ListThreadsResult,
  Logger,
  RawMessage,
  ReactionEvent,
  StateAdapter,
  ThreadInfo,
  ThreadSummary,
  WebhookOptions,
} from "chat";
import {
  ConsoleLogger,
  convertEmojiPlaceholders,
  defaultEmojiResolver,
  Message,
} from "chat";
import { type chat_v1, google } from "googleapis";
import { cardToGoogleCard } from "./cards";
import { GoogleChatFormatConverter } from "./markdown";
import {
  decodeThreadId,
  encodeThreadId,
  type GoogleChatThreadId,
  isDMThread,
} from "./thread-utils";
import { UserInfoCache } from "./user-info";
import {
  createSpaceSubscription,
  decodePubSubMessage,
  listSpaceSubscriptions,
  type PubSubPushMessage,
  type WorkspaceEventNotification,
  type WorkspaceEventsAuthOptions,
} from "./workspace-events";

/** How long before expiry to refresh subscriptions (1 hour) */
const SUBSCRIPTION_REFRESH_BUFFER_MS = 60 * 60 * 1000;
/** TTL for subscription cache entries (25 hours - longer than max subscription lifetime) */
const SUBSCRIPTION_CACHE_TTL_MS = 25 * 60 * 60 * 1000;
/** Key prefix for space subscription cache */
const SPACE_SUB_KEY_PREFIX = "gchat:space-sub:";
const REACTION_MESSAGE_NAME_PATTERN = /(spaces\/[^/]+\/messages\/[^/]+)/;

/** Service account credentials for JWT auth */
export interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  project_id?: string;
}

/** Base config options shared by all auth methods */
export interface GoogleChatAdapterBaseConfig {
  /**
   * HTTP endpoint URL for button click actions.
   * Required for HTTP endpoint apps - button clicks will be routed to this URL.
   * Should be the full URL of your webhook endpoint (e.g., "https://your-app.vercel.app/api/webhooks/gchat")
   */
  endpointUrl?: string;
  /**
   * User email to impersonate for Workspace Events API calls.
   * Required when using domain-wide delegation.
   * This user must have access to the Chat spaces you want to subscribe to.
   */
  impersonateUser?: string;
  /** Logger instance for error reporting */
  logger: Logger;
  /**
   * Pub/Sub topic for receiving all messages via Workspace Events.
   * When set, the adapter will automatically create subscriptions when added to a space.
   * Format: "projects/my-project/topics/my-topic"
   */
  pubsubTopic?: string;
  /** Override bot username (optional) */
  userName?: string;
}

/** Config using service account credentials (JSON key file) */
export interface GoogleChatAdapterServiceAccountConfig
  extends GoogleChatAdapterBaseConfig {
  auth?: never;
  /** Service account credentials JSON */
  credentials: ServiceAccountCredentials;
  useApplicationDefaultCredentials?: never;
}

/** Config using Application Default Credentials (ADC) or Workload Identity Federation */
export interface GoogleChatAdapterADCConfig
  extends GoogleChatAdapterBaseConfig {
  auth?: never;
  credentials?: never;
  /**
   * Use Application Default Credentials.
   * Works with:
   * - GOOGLE_APPLICATION_CREDENTIALS env var pointing to a JSON key file
   * - Workload Identity Federation (external_account JSON)
   * - GCE/Cloud Run/Cloud Functions default service account
   * - gcloud auth application-default login (local development)
   */
  useApplicationDefaultCredentials: true;
}

/** Config using a custom auth client */
export interface GoogleChatAdapterCustomAuthConfig
  extends GoogleChatAdapterBaseConfig {
  /** Custom auth client (JWT, OAuth2, GoogleAuth, etc.) */
  auth: Parameters<typeof google.chat>[0]["auth"];
  credentials?: never;
  useApplicationDefaultCredentials?: never;
}

export type GoogleChatAdapterConfig =
  | GoogleChatAdapterServiceAccountConfig
  | GoogleChatAdapterADCConfig
  | GoogleChatAdapterCustomAuthConfig;

// Re-export GoogleChatThreadId from thread-utils
export type { GoogleChatThreadId } from "./thread-utils";

/** Google Chat message structure */
export interface GoogleChatMessage {
  annotations?: Array<{
    type: string;
    startIndex?: number;
    length?: number;
    userMention?: {
      user: { name: string; displayName?: string; type: string };
      type: string;
    };
  }>;
  argumentText?: string;
  attachment?: Array<{
    name: string;
    contentName: string;
    contentType: string;
    downloadUri?: string;
  }>;
  createTime: string;
  formattedText?: string;
  name: string;
  sender: {
    name: string;
    displayName: string;
    type: string;
    email?: string;
  };
  space?: {
    name: string;
    type: string;
    displayName?: string;
  };
  text: string;
  thread?: {
    name: string;
  };
}

/** Google Chat space structure */
export interface GoogleChatSpace {
  displayName?: string;
  name: string;
  /** Whether this is a single-user DM with the bot */
  singleUserBotDm?: boolean;
  spaceThreadingState?: string;
  /** Space type in newer API format: "SPACE", "GROUP_CHAT", "DIRECT_MESSAGE" */
  spaceType?: string;
  type: string;
}

/** Google Chat user structure */
export interface GoogleChatUser {
  displayName: string;
  email?: string;
  name: string;
  type: string;
}

/**
 * Google Workspace Add-ons event format.
 * This is the format used when configuring the app via Google Cloud Console.
 */
export interface GoogleChatEvent {
  chat?: {
    user?: GoogleChatUser;
    eventTime?: string;
    messagePayload?: {
      space: GoogleChatSpace;
      message: GoogleChatMessage;
    };
    /** Present when the bot is added to a space */
    addedToSpacePayload?: {
      space: GoogleChatSpace;
    };
    /** Present when the bot is removed from a space */
    removedFromSpacePayload?: {
      space: GoogleChatSpace;
    };
    /** Present when a card button is clicked */
    buttonClickedPayload?: {
      space: GoogleChatSpace;
      message: GoogleChatMessage;
      user: GoogleChatUser;
    };
  };
  commonEventObject?: {
    userLocale?: string;
    hostApp?: string;
    platform?: string;
    /** The function name invoked (for card clicks) */
    invokedFunction?: string;
    /** Parameters passed to the function */
    parameters?: Record<string, string>;
  };
}

/** Cached subscription info */
interface SpaceSubscriptionInfo {
  expireTime: number; // Unix timestamp ms
  subscriptionName: string;
}

export class GoogleChatAdapter implements Adapter<GoogleChatThreadId, unknown> {
  readonly name = "gchat";
  readonly userName: string;
  /** Bot's user ID (e.g., "users/123...") - learned from annotations */
  botUserId?: string;

  private readonly chatApi: chat_v1.Chat;
  private chat: ChatInstance | null = null;
  private state: StateAdapter | null = null;
  private readonly logger: Logger;
  private readonly formatConverter = new GoogleChatFormatConverter();
  private readonly pubsubTopic?: string;
  private readonly credentials?: ServiceAccountCredentials;
  private readonly useADC: boolean = false;
  /** Custom auth client (e.g., Vercel OIDC) */
  private readonly customAuth?: Parameters<typeof google.chat>[0]["auth"];
  /** Auth client for making authenticated requests */
  private readonly authClient!: Parameters<typeof google.chat>[0]["auth"];
  /** User email to impersonate for Workspace Events API (domain-wide delegation) */
  private readonly impersonateUser?: string;
  /** In-progress subscription creations to prevent duplicate requests */
  private readonly pendingSubscriptions = new Map<string, Promise<void>>();
  /** Chat API client with impersonation for user-context operations (DMs, etc.) */
  private readonly impersonatedChatApi?: chat_v1.Chat;
  /** HTTP endpoint URL for button click actions */
  private endpointUrl?: string;
  /** User info cache for display name lookups - initialized later in initialize() */
  private userInfoCache: UserInfoCache;

  constructor(config: GoogleChatAdapterConfig) {
    this.logger = config.logger;
    this.userName = config.userName || "bot";
    // Initialize with null state - will be updated in initialize()
    this.userInfoCache = new UserInfoCache(null, this.logger);
    this.pubsubTopic = config.pubsubTopic;
    this.impersonateUser = config.impersonateUser;
    this.endpointUrl = config.endpointUrl;

    let auth: Parameters<typeof google.chat>[0]["auth"];

    // Scopes needed for full bot functionality including reactions and DMs
    // Note: chat.spaces.create requires domain-wide delegation to work
    const scopes = [
      "https://www.googleapis.com/auth/chat.bot",
      "https://www.googleapis.com/auth/chat.messages.readonly",
      "https://www.googleapis.com/auth/chat.messages.reactions.create",
      "https://www.googleapis.com/auth/chat.messages.reactions",
      "https://www.googleapis.com/auth/chat.spaces.create",
    ];

    if ("credentials" in config && config.credentials) {
      // Service account credentials (JWT)
      this.credentials = config.credentials;
      auth = new google.auth.JWT({
        email: config.credentials.client_email,
        key: config.credentials.private_key,
        scopes,
      });
    } else if (
      "useApplicationDefaultCredentials" in config &&
      config.useApplicationDefaultCredentials
    ) {
      // Application Default Credentials (ADC)
      // Works with Workload Identity Federation, GCE metadata, GOOGLE_APPLICATION_CREDENTIALS env var
      this.useADC = true;
      auth = new google.auth.GoogleAuth({
        scopes,
      });
    } else if ("auth" in config && config.auth) {
      // Custom auth client provided directly (e.g., Vercel OIDC)
      this.customAuth = config.auth;
      auth = config.auth;
    } else {
      throw new ValidationError(
        "gchat",
        "GoogleChatAdapter requires one of: credentials, useApplicationDefaultCredentials, or auth"
      );
    }

    this.authClient = auth;
    this.chatApi = google.chat({ version: "v1", auth });

    // Create impersonated Chat API for user-context operations (DMs)
    // Domain-wide delegation requires setting the `subject` claim to the impersonated user
    if (this.impersonateUser) {
      if (this.credentials) {
        const impersonatedAuth = new google.auth.JWT({
          email: this.credentials.client_email,
          key: this.credentials.private_key,
          scopes: [
            "https://www.googleapis.com/auth/chat.spaces",
            "https://www.googleapis.com/auth/chat.spaces.create",
            "https://www.googleapis.com/auth/chat.messages.readonly",
          ],
          subject: this.impersonateUser,
        });
        this.impersonatedChatApi = google.chat({
          version: "v1",
          auth: impersonatedAuth,
        });
      } else if (this.useADC) {
        // ADC with impersonation (requires clientOptions.subject support)
        const impersonatedAuth = new google.auth.GoogleAuth({
          scopes: [
            "https://www.googleapis.com/auth/chat.spaces",
            "https://www.googleapis.com/auth/chat.spaces.create",
            "https://www.googleapis.com/auth/chat.messages.readonly",
          ],
          clientOptions: {
            subject: this.impersonateUser,
          },
        });
        this.impersonatedChatApi = google.chat({
          version: "v1",
          auth: impersonatedAuth,
        });
      }
    }
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.state = chat.getState();
    // Update userInfoCache to use the state adapter for persistence
    this.userInfoCache = new UserInfoCache(this.state, this.logger);

    // Restore persisted bot user ID from state (for serverless environments)
    if (!this.botUserId) {
      const savedBotUserId = await this.state.get<string>("gchat:botUserId");
      if (savedBotUserId) {
        this.botUserId = savedBotUserId;
        this.logger.debug("Restored bot user ID from state", {
          botUserId: this.botUserId,
        });
      }
    }
  }

  /**
   * Called when a thread is subscribed to.
   * Ensures the space has a Workspace Events subscription so we receive all messages.
   */
  async onThreadSubscribe(threadId: string): Promise<void> {
    this.logger.info("onThreadSubscribe called", {
      threadId,
      hasPubsubTopic: !!this.pubsubTopic,
      pubsubTopic: this.pubsubTopic,
    });

    if (!this.pubsubTopic) {
      this.logger.warn(
        "No pubsubTopic configured, skipping space subscription. Set GOOGLE_CHAT_PUBSUB_TOPIC env var."
      );
      return;
    }

    const { spaceName } = this.decodeThreadId(threadId);
    await this.ensureSpaceSubscription(spaceName);
  }

  /**
   * Ensure a Workspace Events subscription exists for a space.
   * Creates one if it doesn't exist or is about to expire.
   */
  private async ensureSpaceSubscription(spaceName: string): Promise<void> {
    this.logger.info("ensureSpaceSubscription called", {
      spaceName,
      hasPubsubTopic: !!this.pubsubTopic,
      hasState: !!this.state,
      hasCredentials: !!this.credentials,
      hasADC: this.useADC,
    });

    if (!(this.pubsubTopic && this.state)) {
      this.logger.warn("ensureSpaceSubscription skipped - missing config", {
        hasPubsubTopic: !!this.pubsubTopic,
        hasState: !!this.state,
      });
      return;
    }

    const cacheKey = `${SPACE_SUB_KEY_PREFIX}${spaceName}`;

    // Check if we already have a valid subscription
    const cached = await this.state.get<SpaceSubscriptionInfo>(cacheKey);
    if (cached) {
      const timeUntilExpiry = cached.expireTime - Date.now();
      if (timeUntilExpiry > SUBSCRIPTION_REFRESH_BUFFER_MS) {
        this.logger.debug("Space subscription still valid", {
          spaceName,
          expiresIn: Math.round(timeUntilExpiry / 1000 / 60),
        });
        return;
      }
      this.logger.debug("Space subscription expiring soon, will refresh", {
        spaceName,
        expiresIn: Math.round(timeUntilExpiry / 1000 / 60),
      });
    }

    // Check if we're already creating a subscription for this space
    const pending = this.pendingSubscriptions.get(spaceName);
    if (pending) {
      this.logger.debug("Subscription creation already in progress", {
        spaceName,
      });
      return pending;
    }

    // Create the subscription
    const createPromise = this.createSpaceSubscriptionWithCache(
      spaceName,
      cacheKey
    );
    this.pendingSubscriptions.set(spaceName, createPromise);

    try {
      await createPromise;
    } finally {
      this.pendingSubscriptions.delete(spaceName);
    }
  }

  /**
   * Create a Workspace Events subscription and cache the result.
   */
  private async createSpaceSubscriptionWithCache(
    spaceName: string,
    cacheKey: string
  ): Promise<void> {
    const authOptions = this.getAuthOptions();
    this.logger.info("createSpaceSubscriptionWithCache", {
      spaceName,
      hasAuthOptions: !!authOptions,
      hasCredentials: !!this.credentials,
      hasADC: this.useADC,
    });

    if (!authOptions) {
      this.logger.error(
        "Cannot create subscription: no auth configured. Use GOOGLE_CHAT_CREDENTIALS, GOOGLE_CHAT_USE_ADC=true, or custom auth."
      );
      return;
    }

    const pubsubTopic = this.pubsubTopic;
    if (!pubsubTopic) {
      return;
    }

    try {
      // First check if a subscription already exists via the API
      const existing = await this.findExistingSubscription(
        spaceName,
        authOptions
      );
      if (existing) {
        this.logger.debug("Found existing subscription", {
          spaceName,
          subscriptionName: existing.subscriptionName,
        });
        // Cache it
        if (this.state) {
          await this.state.set<SpaceSubscriptionInfo>(
            cacheKey,
            existing,
            SUBSCRIPTION_CACHE_TTL_MS
          );
        }
        return;
      }

      this.logger.info("Creating Workspace Events subscription", {
        spaceName,
        pubsubTopic,
      });

      const result = await createSpaceSubscription(
        { spaceName, pubsubTopic },
        authOptions
      );

      const subscriptionInfo: SpaceSubscriptionInfo = {
        subscriptionName: result.name,
        expireTime: new Date(result.expireTime).getTime(),
      };

      // Cache the subscription info
      if (this.state) {
        await this.state.set<SpaceSubscriptionInfo>(
          cacheKey,
          subscriptionInfo,
          SUBSCRIPTION_CACHE_TTL_MS
        );
      }

      this.logger.info("Workspace Events subscription created", {
        spaceName,
        subscriptionName: result.name,
        expireTime: result.expireTime,
      });
    } catch (error) {
      this.logger.error("Failed to create Workspace Events subscription", {
        spaceName,
        error,
      });
      // Don't throw - subscription failure shouldn't break the main flow
    }
  }

  /**
   * Check if a subscription already exists for this space.
   */
  private async findExistingSubscription(
    spaceName: string,
    authOptions: WorkspaceEventsAuthOptions
  ): Promise<SpaceSubscriptionInfo | null> {
    try {
      const subscriptions = await listSpaceSubscriptions(
        spaceName,
        authOptions
      );
      for (const sub of subscriptions) {
        // Check if this subscription is still valid
        const expireTime = new Date(sub.expireTime).getTime();
        if (expireTime > Date.now() + SUBSCRIPTION_REFRESH_BUFFER_MS) {
          return {
            subscriptionName: sub.name,
            expireTime,
          };
        }
      }
    } catch (error) {
      this.logger.error("Error checking existing subscriptions", { error });
    }
    return null;
  }

  /**
   * Get auth options for Workspace Events API calls.
   */
  private getAuthOptions(): WorkspaceEventsAuthOptions | null {
    if (this.credentials) {
      return {
        credentials: this.credentials,
        impersonateUser: this.impersonateUser,
      };
    }
    if (this.useADC) {
      return {
        useApplicationDefaultCredentials: true as const,
        impersonateUser: this.impersonateUser,
      };
    }
    if (this.customAuth) {
      return { auth: this.customAuth };
    }
    return null;
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    // Auto-detect endpoint URL from incoming request for button click routing
    // This allows HTTP endpoint apps to work without manual endpointUrl configuration
    if (!this.endpointUrl) {
      try {
        const url = new URL(request.url);
        // Preserve the full URL including query strings
        this.endpointUrl = url.toString();
        this.logger.debug("Auto-detected endpoint URL", {
          endpointUrl: this.endpointUrl,
        });
      } catch {
        // URL parsing failed, endpointUrl will remain undefined
      }
    }

    const body = await request.text();
    this.logger.debug("GChat webhook raw body", { body });

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Check if this is a Pub/Sub push message (from Workspace Events subscription)
    const maybePubSub = parsed as PubSubPushMessage;
    if (maybePubSub.message?.data && maybePubSub.subscription) {
      return this.handlePubSubMessage(maybePubSub, options);
    }

    // Otherwise, treat as a direct Google Chat webhook event
    const event = parsed as GoogleChatEvent;

    // Handle ADDED_TO_SPACE - automatically create subscription
    const addedPayload = event.chat?.addedToSpacePayload;
    if (addedPayload) {
      this.logger.debug("Bot added to space", {
        space: addedPayload.space.name,
        spaceType: addedPayload.space.type,
      });
      this.handleAddedToSpace(addedPayload.space, options);
    }

    // Handle REMOVED_FROM_SPACE (for logging)
    const removedPayload = event.chat?.removedFromSpacePayload;
    if (removedPayload) {
      this.logger.debug("Bot removed from space", {
        space: removedPayload.space.name,
      });
    }

    // Handle card button clicks
    const buttonClickedPayload = event.chat?.buttonClickedPayload;
    const invokedFunction = event.commonEventObject?.invokedFunction;
    if (buttonClickedPayload || invokedFunction) {
      this.handleCardClick(event, options);
      // For HTTP endpoint apps (Workspace Add-ons), return empty JSON to acknowledge.
      // The RenderActions format expects cards in google.apps.card.v1 format,
      // actionResponse is for the older Google Chat API format.
      // Returning {} acknowledges the action without changing the card.
      return Response.json({});
    }

    // Check for message payload in the Add-ons format
    const messagePayload = event.chat?.messagePayload;
    if (messagePayload) {
      this.logger.debug("message event", {
        space: messagePayload.space.name,
        sender: messagePayload.message.sender?.displayName,
        text: messagePayload.message.text?.slice(0, 50),
      });
      this.handleMessageEvent(event, options);
    } else if (!(addedPayload || removedPayload)) {
      this.logger.debug("Non-message event received", {
        hasChat: !!event.chat,
        hasCommonEventObject: !!event.commonEventObject,
      });
    }

    // Google Chat expects an empty response or a message response
    return Response.json({});
  }

  /**
   * Handle Pub/Sub push messages from Workspace Events subscriptions.
   * These contain all messages in a space, not just @mentions.
   */
  private handlePubSubMessage(
    pushMessage: PubSubPushMessage,
    options?: WebhookOptions
  ): Response {
    // Early filter: Check event type BEFORE base64 decoding to save CPU
    // The ce-type attribute is available in message.attributes
    const eventType = pushMessage.message?.attributes?.["ce-type"];
    const allowedEventTypes = [
      "google.workspace.chat.message.v1.created",
      "google.workspace.chat.reaction.v1.created",
      "google.workspace.chat.reaction.v1.deleted",
    ];
    if (eventType && !allowedEventTypes.includes(eventType)) {
      this.logger.debug("Skipping unsupported Pub/Sub event", { eventType });
      return Response.json({ success: true });
    }

    try {
      const notification = decodePubSubMessage(pushMessage);
      this.logger.debug("Pub/Sub notification decoded", {
        eventType: notification.eventType,
        messageId: notification.message?.name,
        reactionName: notification.reaction?.name,
      });

      // Handle message.created events
      if (notification.message) {
        this.handlePubSubMessageEvent(notification, options);
      }

      // Handle reaction events
      if (notification.reaction) {
        this.handlePubSubReactionEvent(notification, options);
      }

      // Acknowledge the message
      return Response.json({ success: true });
    } catch (error) {
      this.logger.error("Error processing Pub/Sub message", { error });
      // Return 200 to avoid retries for malformed messages
      return new Response(JSON.stringify({ error: "Processing failed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  /**
   * Handle message events received via Pub/Sub (Workspace Events).
   */
  private handlePubSubMessageEvent(
    notification: WorkspaceEventNotification,
    options?: WebhookOptions
  ): void {
    if (!(this.chat && notification.message)) {
      return;
    }

    const message = notification.message;
    // Extract space name from targetResource: "//chat.googleapis.com/spaces/AAAA"
    const spaceName = notification.targetResource?.replace(
      "//chat.googleapis.com/",
      ""
    );
    const threadName = message.thread?.name || message.name;
    const threadId = this.encodeThreadId({
      spaceName: spaceName || message.space?.name || "",
      threadName,
    });

    // Refresh subscription if needed (runs in background)
    const resolvedSpaceName = spaceName || message.space?.name;
    if (resolvedSpaceName && options?.waitUntil) {
      options.waitUntil(
        this.ensureSpaceSubscription(resolvedSpaceName).catch((err) => {
          this.logger.error("Subscription refresh failed", {
            spaceName: resolvedSpaceName,
            error: err,
          });
        })
      );
    }

    // Let Chat class handle async processing and waitUntil
    // Use factory function since parsePubSubMessage is async (user display name lookup)
    this.chat.processMessage(
      this,
      threadId,
      () => this.parsePubSubMessage(notification, threadId),
      options
    );
  }

  /**
   * Handle reaction events received via Pub/Sub (Workspace Events).
   * Fetches the message to get thread context for proper reply threading.
   */
  private handlePubSubReactionEvent(
    notification: WorkspaceEventNotification,
    options?: WebhookOptions
  ): void {
    if (!(this.chat && notification.reaction)) {
      return;
    }

    const reaction = notification.reaction;
    const rawEmoji = reaction.emoji?.unicode || "";
    const normalizedEmoji = defaultEmojiResolver.fromGChat(rawEmoji);

    // Extract message name from reaction name
    // Format: spaces/{space}/messages/{message}/reactions/{reaction}
    const reactionName = reaction.name || "";
    const messageNameMatch = reactionName.match(REACTION_MESSAGE_NAME_PATTERN);
    const messageName = messageNameMatch ? messageNameMatch[1] : "";

    // Extract space name from targetResource
    const spaceName = notification.targetResource?.replace(
      "//chat.googleapis.com/",
      ""
    );

    // Check if reaction is from this bot
    const isMe =
      this.botUserId !== undefined && reaction.user?.name === this.botUserId;

    // Determine if this is an add or remove
    const added = notification.eventType.includes("created");

    // We need to fetch the message to get its thread context
    // This is done lazily when the reaction is processed
    const chat = this.chat;
    const buildReactionEvent = async (): Promise<
      Omit<ReactionEvent, "adapter" | "thread"> & { adapter: GoogleChatAdapter }
    > => {
      let threadId: string;

      // Fetch the message to get its thread name
      if (messageName) {
        try {
          const messageResponse = await this.chatApi.spaces.messages.get({
            name: messageName,
          });
          const threadName = messageResponse.data.thread?.name;
          threadId = this.encodeThreadId({
            spaceName: spaceName || "",
            threadName: threadName ?? undefined,
          });
          this.logger.debug("Fetched thread context for reaction", {
            messageName,
            threadName,
            threadId,
          });
        } catch (error) {
          this.logger.warn("Failed to fetch message for thread context", {
            messageName,
            error,
          });
          // Fall back to space-only thread ID
          threadId = this.encodeThreadId({
            spaceName: spaceName || "",
          });
        }
      } else {
        threadId = this.encodeThreadId({
          spaceName: spaceName || "",
        });
      }

      return {
        emoji: normalizedEmoji,
        rawEmoji,
        added,
        user: {
          userId: reaction.user?.name || "unknown",
          userName: reaction.user?.displayName || "unknown",
          fullName: reaction.user?.displayName || "unknown",
          isBot: reaction.user?.type === "BOT",
          isMe,
        },
        messageId: messageName,
        threadId,
        raw: notification,
        adapter: this,
      };
    };

    // Process reaction with lazy thread resolution
    const processTask = buildReactionEvent().then((reactionEvent) => {
      chat.processReaction(reactionEvent, options);
    });

    if (options?.waitUntil) {
      options.waitUntil(processTask);
    }
  }

  /**
   * Parse a Pub/Sub message into the standard Message format.
   * Resolves user display names from cache since Pub/Sub messages don't include them.
   */
  private async parsePubSubMessage(
    notification: WorkspaceEventNotification,
    threadId: string
  ): Promise<Message<unknown>> {
    const message = notification.message;
    if (!message) {
      throw new ValidationError("gchat", "PubSub notification missing message");
    }
    const text = this.normalizeBotMentions(message);
    const isBot = message.sender?.type === "BOT";
    const isMe = this.isMessageFromSelf(message);

    // Pub/Sub messages don't include displayName - resolve from cache
    const userId = message.sender?.name || "unknown";
    const displayName = await this.userInfoCache.resolveDisplayName(
      userId,
      message.sender?.displayName,
      this.botUserId,
      this.userName
    );

    const parsedMessage = new Message({
      id: message.name,
      threadId,
      text: this.formatConverter.extractPlainText(text),
      formatted: this.formatConverter.toAst(text),
      raw: notification,
      author: {
        userId,
        userName: displayName,
        fullName: displayName,
        isBot,
        isMe,
      },
      metadata: {
        dateSent: new Date(message.createTime),
        edited: false,
      },
      attachments: (message.attachment || []).map((att) =>
        this.createAttachment(att)
      ),
    });

    this.logger.debug("Pub/Sub parsed message", {
      threadId,
      messageId: parsedMessage.id,
      text: parsedMessage.text,
      author: parsedMessage.author.fullName,
      isBot: parsedMessage.author.isBot,
      isMe: parsedMessage.author.isMe,
    });

    return parsedMessage;
  }

  /**
   * Handle bot being added to a space - create Workspace Events subscription.
   */
  private handleAddedToSpace(
    space: GoogleChatSpace,
    options?: WebhookOptions
  ): void {
    const subscribeTask = this.ensureSpaceSubscription(space.name);

    if (options?.waitUntil) {
      options.waitUntil(subscribeTask);
    }
  }

  /**
   * Handle card button clicks.
   * For HTTP endpoint apps, the actionId is passed via parameters (since function is the URL).
   * For other deployments, actionId may be in invokedFunction.
   */
  private handleCardClick(
    event: GoogleChatEvent,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring card click");
      return;
    }

    const buttonPayload = event.chat?.buttonClickedPayload;
    const commonEvent = event.commonEventObject;

    // Get action ID - for HTTP endpoints it's in parameters.actionId,
    // for other deployments it may be in invokedFunction
    const actionId =
      commonEvent?.parameters?.actionId || commonEvent?.invokedFunction;
    if (!actionId) {
      this.logger.debug("Card click missing actionId", {
        parameters: commonEvent?.parameters,
        invokedFunction: commonEvent?.invokedFunction,
      });
      return;
    }

    // Get value from parameters
    const value = commonEvent?.parameters?.value;

    // Get space and message info from buttonClickedPayload
    const space = buttonPayload?.space;
    const message = buttonPayload?.message;
    const user = buttonPayload?.user || event.chat?.user;

    if (!space) {
      this.logger.warn("Card click missing space info");
      return;
    }

    const threadName = message?.thread?.name || message?.name;
    const threadId = this.encodeThreadId({
      spaceName: space.name,
      threadName,
    });

    const actionEvent: Omit<ActionEvent, "thread" | "openModal"> & {
      adapter: GoogleChatAdapter;
    } = {
      actionId,
      value,
      user: {
        userId: user?.name || "unknown",
        userName: user?.displayName || "unknown",
        fullName: user?.displayName || "unknown",
        isBot: user?.type === "BOT",
        isMe: false,
      },
      messageId: message?.name || "",
      threadId,
      adapter: this,
      raw: event,
    };

    this.logger.debug("Processing GChat card click", {
      actionId,
      value,
      messageId: actionEvent.messageId,
      threadId,
    });

    this.chat.processAction(actionEvent, options);
  }

  /**
   * Handle direct webhook message events (Add-ons format).
   */
  private handleMessageEvent(
    event: GoogleChatEvent,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring event");
      return;
    }

    const messagePayload = event.chat?.messagePayload;
    if (!messagePayload) {
      this.logger.debug("Ignoring event without messagePayload");
      return;
    }

    const message = messagePayload.message;
    // For DMs, use space-only thread ID so all messages in the DM
    // match the DM subscription created by openDM(). This treats the entire DM
    // conversation as a single "thread" for subscription purposes.
    const isDM =
      messagePayload.space.type === "DM" ||
      messagePayload.space.spaceType === "DIRECT_MESSAGE";
    const threadName = isDM ? undefined : message.thread?.name || message.name;
    const threadId = this.encodeThreadId({
      spaceName: messagePayload.space.name,
      threadName,
      isDM,
    });

    // Let Chat class handle async processing and waitUntil
    this.chat.processMessage(
      this,
      threadId,
      this.parseGoogleChatMessage(event, threadId),
      options
    );
  }

  private parseGoogleChatMessage(
    event: GoogleChatEvent,
    threadId: string
  ): Message<unknown> {
    const message = event.chat?.messagePayload?.message;
    if (!message) {
      throw new ValidationError("gchat", "Event has no message payload");
    }

    // Normalize bot mentions: replace @BotDisplayName with @{userName}
    // so the Chat SDK's mention detection works properly
    const text = this.normalizeBotMentions(message);

    const isBot = message.sender?.type === "BOT";
    const isMe = this.isMessageFromSelf(message);

    // Cache user info for future Pub/Sub messages (which don't include displayName)
    const userId = message.sender?.name || "unknown";
    const displayName = message.sender?.displayName || "unknown";
    if (userId !== "unknown" && displayName !== "unknown") {
      this.userInfoCache
        .set(userId, displayName, message.sender?.email)
        .catch((error) => {
          this.logger.error("Failed to cache user info", { userId, error });
        });
    }

    return new Message({
      id: message.name,
      threadId,
      text: this.formatConverter.extractPlainText(text),
      formatted: this.formatConverter.toAst(text),
      raw: event,
      author: {
        userId,
        userName: displayName,
        fullName: displayName,
        isBot,
        isMe,
      },
      metadata: {
        dateSent: new Date(message.createTime),
        edited: false,
      },
      attachments: (message.attachment || []).map((att) =>
        this.createAttachment(att)
      ),
    });
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<unknown>> {
    const { spaceName, threadName } = this.decodeThreadId(threadId);

    try {
      // Check for files - currently not implemented for GChat
      const files = extractFiles(message);
      if (files.length > 0) {
        this.logger.warn(
          "File uploads are not yet supported for Google Chat. Files will be ignored.",
          { fileCount: files.length }
        );
        // TODO: Implement using Google Chat media.upload API
      }

      // Check if message contains a card
      const card = extractCard(message);

      if (card) {
        // Render card as Google Chat Card
        // cardId is required for interactive cards (button clicks)
        // endpointUrl is required for HTTP endpoint apps to route button clicks
        const cardId = `card-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const googleCard = cardToGoogleCard(card, {
          cardId,
          endpointUrl: this.endpointUrl,
        });

        this.logger.debug("GChat API: spaces.messages.create (card)", {
          spaceName,
          threadName,
          googleCard: JSON.stringify(googleCard),
        });

        const response = await this.chatApi.spaces.messages.create({
          parent: spaceName,
          messageReplyOption: threadName
            ? "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD"
            : undefined,
          requestBody: {
            // Don't include text - GChat shows both text and card if text is present
            cardsV2: [googleCard],
            thread: threadName ? { name: threadName } : undefined,
          },
        });

        this.logger.debug("GChat API: spaces.messages.create response", {
          messageName: response.data.name,
        });

        return {
          id: response.data.name || "",
          threadId,
          raw: response.data,
        };
      }

      // Regular text message
      const text = convertEmojiPlaceholders(
        this.formatConverter.renderPostable(message),
        "gchat"
      );

      this.logger.debug("GChat API: spaces.messages.create", {
        spaceName,
        threadName,
        textLength: text.length,
      });

      const response = await this.chatApi.spaces.messages.create({
        parent: spaceName,
        // Required to reply in an existing thread
        messageReplyOption: threadName
          ? "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD"
          : undefined,
        requestBody: {
          text,
          thread: threadName ? { name: threadName } : undefined,
        },
      });

      this.logger.debug("GChat API: spaces.messages.create response", {
        messageName: response.data.name,
      });

      return {
        id: response.data.name || "",
        threadId,
        raw: response.data,
      };
    } catch (error) {
      this.handleGoogleChatError(error, "postMessage");
    }
  }

  async postEphemeral(
    threadId: string,
    userId: string,
    message: AdapterPostableMessage
  ): Promise<EphemeralMessage> {
    const { spaceName, threadName } = this.decodeThreadId(threadId);

    try {
      // Check if message contains a card
      const card = extractCard(message);

      const requestBody: chat_v1.Schema$Message = {
        // privateMessageViewer makes the message visible only to this user
        privateMessageViewer: { name: userId },
        thread: threadName ? { name: threadName } : undefined,
      };

      if (card) {
        // Render card as Google Chat Card
        const cardId = `card-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const googleCard = cardToGoogleCard(card, {
          cardId,
          endpointUrl: this.endpointUrl,
        });

        requestBody.cardsV2 = [googleCard];

        this.logger.debug(
          "GChat API: spaces.messages.create (ephemeral card)",
          {
            spaceName,
            threadName,
            userId,
          }
        );
      } else {
        // Regular text message
        requestBody.text = convertEmojiPlaceholders(
          this.formatConverter.renderPostable(message),
          "gchat"
        );

        this.logger.debug("GChat API: spaces.messages.create (ephemeral)", {
          spaceName,
          threadName,
          userId,
          textLength: requestBody.text.length,
        });
      }

      const response = await this.chatApi.spaces.messages.create({
        parent: spaceName,
        messageReplyOption: threadName
          ? "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD"
          : undefined,
        requestBody,
      });

      this.logger.debug(
        "GChat API: spaces.messages.create ephemeral response",
        {
          messageName: response.data.name,
        }
      );

      return {
        id: response.data.name || "",
        threadId,
        usedFallback: false,
        raw: response.data,
      };
    } catch (error) {
      this.handleGoogleChatError(error, "postEphemeral");
    }
  }

  /**
   * Create an Attachment object from a Google Chat attachment.
   */
  private createAttachment(att: {
    contentType?: string | null;
    downloadUri?: string | null;
    contentName?: string | null;
    thumbnailUri?: string | null;
  }): Attachment {
    const url = att.downloadUri || undefined;
    const authClient = this.authClient;

    // Determine type based on contentType
    let type: Attachment["type"] = "file";
    if (att.contentType?.startsWith("image/")) {
      type = "image";
    } else if (att.contentType?.startsWith("video/")) {
      type = "video";
    } else if (att.contentType?.startsWith("audio/")) {
      type = "audio";
    }

    // Capture auth client for use in fetchData closure
    const auth = authClient;

    return {
      type,
      url,
      name: att.contentName || undefined,
      mimeType: att.contentType || undefined,
      fetchData: url
        ? async () => {
            // Get access token for authenticated download
            if (typeof auth === "string" || !auth) {
              throw new AuthenticationError(
                "gchat",
                "Cannot fetch file: no auth client configured"
              );
            }
            const tokenResult = await auth.getAccessToken();
            const token =
              typeof tokenResult === "string"
                ? tokenResult
                : tokenResult?.token;
            if (!token) {
              throw new AuthenticationError(
                "gchat",
                "Failed to get access token"
              );
            }
            const response = await fetch(url, {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            });
            if (!response.ok) {
              throw new NetworkError(
                "gchat",
                `Failed to fetch file: ${response.status} ${response.statusText}`
              );
            }
            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
          }
        : undefined,
    };
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<unknown>> {
    try {
      // Check if message contains a card
      const card = extractCard(message);

      if (card) {
        // Render card as Google Chat Card
        // cardId is required for interactive cards (button clicks)
        // endpointUrl is required for HTTP endpoint apps to route button clicks
        const cardId = `card-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const googleCard = cardToGoogleCard(card, {
          cardId,
          endpointUrl: this.endpointUrl,
        });

        this.logger.debug("GChat API: spaces.messages.update (card)", {
          messageId,
          cardId,
        });

        const response = await this.chatApi.spaces.messages.update({
          name: messageId,
          updateMask: "cardsV2",
          requestBody: {
            // Don't include text - GChat shows both text and card if text is present
            cardsV2: [googleCard],
          },
        });

        this.logger.debug("GChat API: spaces.messages.update response", {
          messageName: response.data.name,
        });

        return {
          id: response.data.name || "",
          threadId,
          raw: response.data,
        };
      }

      // Regular text message
      const text = convertEmojiPlaceholders(
        this.formatConverter.renderPostable(message),
        "gchat"
      );

      this.logger.debug("GChat API: spaces.messages.update", {
        messageId,
        textLength: text.length,
      });

      const response = await this.chatApi.spaces.messages.update({
        name: messageId,
        updateMask: "text",
        requestBody: {
          text,
        },
      });

      this.logger.debug("GChat API: spaces.messages.update response", {
        messageName: response.data.name,
      });

      return {
        id: response.data.name || "",
        threadId,
        raw: response.data,
      };
    } catch (error) {
      this.handleGoogleChatError(error, "editMessage");
    }
  }

  async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    try {
      this.logger.debug("GChat API: spaces.messages.delete", { messageId });

      await this.chatApi.spaces.messages.delete({
        name: messageId,
      });

      this.logger.debug("GChat API: spaces.messages.delete response", {
        ok: true,
      });
    } catch (error) {
      this.handleGoogleChatError(error, "deleteMessage");
    }
  }

  async addReaction(
    _threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    // Convert emoji (EmojiValue or string) to GChat unicode format
    const gchatEmoji = defaultEmojiResolver.toGChat(emoji);

    try {
      this.logger.debug("GChat API: spaces.messages.reactions.create", {
        messageId,
        emoji: gchatEmoji,
      });

      await this.chatApi.spaces.messages.reactions.create({
        parent: messageId,
        requestBody: {
          emoji: { unicode: gchatEmoji },
        },
      });

      this.logger.debug(
        "GChat API: spaces.messages.reactions.create response",
        {
          ok: true,
        }
      );
    } catch (error) {
      this.handleGoogleChatError(error, "addReaction");
    }
  }

  async removeReaction(
    _threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    // Convert emoji (EmojiValue or string) to GChat unicode format
    const gchatEmoji = defaultEmojiResolver.toGChat(emoji);

    try {
      // Google Chat requires the reaction resource name to delete it.
      // We need to list reactions and find the one with matching emoji.
      this.logger.debug("GChat API: spaces.messages.reactions.list", {
        messageId,
      });

      const response = await this.chatApi.spaces.messages.reactions.list({
        parent: messageId,
      });

      this.logger.debug("GChat API: spaces.messages.reactions.list response", {
        reactionCount: response.data.reactions?.length || 0,
      });

      const reaction = response.data.reactions?.find(
        (r) => r.emoji?.unicode === gchatEmoji
      );

      if (!reaction?.name) {
        this.logger.debug("Reaction not found to remove", {
          messageId,
          emoji: gchatEmoji,
        });
        return;
      }

      this.logger.debug("GChat API: spaces.messages.reactions.delete", {
        reactionName: reaction.name,
      });

      await this.chatApi.spaces.messages.reactions.delete({
        name: reaction.name,
      });

      this.logger.debug(
        "GChat API: spaces.messages.reactions.delete response",
        {
          ok: true,
        }
      );
    } catch (error) {
      this.handleGoogleChatError(error, "removeReaction");
    }
  }

  async startTyping(_threadId: string): Promise<void> {
    // Google Chat doesn't have a typing indicator API for bots
  }

  /**
   * Open a direct message conversation with a user.
   * Returns a thread ID that can be used to post messages.
   *
   * For Google Chat, this first tries to find an existing DM space with the user.
   * If no DM exists, it creates one using spaces.setup.
   *
   * @param userId - The user's resource name (e.g., "users/123456")
   */
  async openDM(userId: string): Promise<string> {
    try {
      // First, try to find an existing DM space with this user
      // This works with the bot's own credentials (no impersonation needed)
      this.logger.debug("GChat API: spaces.findDirectMessage", { userId });

      const findResponse = await this.chatApi.spaces.findDirectMessage({
        name: userId,
      });

      if (findResponse.data.name) {
        this.logger.debug("GChat API: Found existing DM space", {
          spaceName: findResponse.data.name,
        });
        return this.encodeThreadId({
          spaceName: findResponse.data.name,
          isDM: true,
        });
      }
    } catch (error) {
      // 404 means no DM exists yet - we'll try to create one
      const gError = error as { code?: number };
      if (gError.code !== 404) {
        this.logger.debug("GChat API: findDirectMessage failed", { error });
      }
    }

    // No existing DM found - try to create one
    // Use impersonated API if available (required for creating new DMs)
    const chatApi = this.impersonatedChatApi || this.chatApi;

    if (!this.impersonatedChatApi) {
      this.logger.warn(
        "openDM: No existing DM found and no impersonation configured. " +
          "Creating new DMs requires domain-wide delegation. " +
          "Set 'impersonateUser' in adapter config."
      );
    }

    try {
      this.logger.debug("GChat API: spaces.setup (DM)", {
        userId,
        hasImpersonation: !!this.impersonatedChatApi,
        impersonateUser: this.impersonateUser,
      });

      // Create a DM space between the impersonated user and the target user
      // Don't use singleUserBotDm - that's for DMs with the bot itself
      const response = await chatApi.spaces.setup({
        requestBody: {
          space: {
            spaceType: "DIRECT_MESSAGE",
          },
          memberships: [
            {
              member: {
                name: userId,
                type: "HUMAN",
              },
            },
          ],
        },
      });

      const spaceName = response.data.name;

      if (!spaceName) {
        throw new NetworkError(
          "gchat",
          "Failed to create DM - no space name returned"
        );
      }

      this.logger.debug("GChat API: spaces.setup response", { spaceName });

      return this.encodeThreadId({ spaceName, isDM: true });
    } catch (error) {
      this.handleGoogleChatError(error, "openDM");
    }
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<unknown>> {
    const { spaceName, threadName } = this.decodeThreadId(threadId);
    const direction = options.direction ?? "backward";
    const limit = options.limit || 100;

    // Use impersonated client if available (has better permissions for listing messages)
    const api = this.impersonatedChatApi || this.chatApi;

    try {
      // Build filter to scope to specific thread if threadName is available
      const filter = threadName ? `thread.name = "${threadName}"` : undefined;

      if (direction === "forward") {
        // Forward direction: fetch oldest messages first
        // GChat API always returns newest first, so we need to work around this
        return await this.fetchMessagesForward(
          api,
          spaceName,
          threadId,
          filter,
          limit,
          options.cursor
        );
      }

      // Backward direction (default): most recent messages first
      // GChat API returns newest first, which matches this use case
      return await this.fetchMessagesBackward(
        api,
        spaceName,
        threadId,
        filter,
        limit,
        options.cursor
      );
    } catch (error) {
      this.handleGoogleChatError(error, "fetchMessages");
    }
  }

  /**
   * Fetch messages in backward direction (most recent first).
   * GChat API defaults to createTime ASC (oldest first), so we request DESC
   * to get the most recent messages, then reverse for chronological order within page.
   */
  private async fetchMessagesBackward(
    api: chat_v1.Chat,
    spaceName: string,
    threadId: string,
    filter: string | undefined,
    limit: number,
    cursor?: string
  ): Promise<FetchResult<unknown>> {
    this.logger.debug("GChat API: spaces.messages.list (backward)", {
      spaceName,
      filter,
      pageSize: limit,
      cursor,
    });

    const response = await api.spaces.messages.list({
      parent: spaceName,
      pageSize: limit,
      pageToken: cursor,
      filter,
      orderBy: "createTime desc", // Get newest messages first
    });

    // API returns newest first (DESC), reverse to get chronological order within page
    const rawMessages = (response.data.messages || []).reverse();

    this.logger.debug("GChat API: spaces.messages.list response (backward)", {
      messageCount: rawMessages.length,
      hasNextPageToken: !!response.data.nextPageToken,
    });

    const messages = await Promise.all(
      rawMessages.map((msg) =>
        this.parseGChatListMessage(msg, spaceName, threadId)
      )
    );

    return {
      messages,
      // nextPageToken points to older messages (backward pagination)
      nextCursor: response.data.nextPageToken ?? undefined,
    };
  }

  /**
   * Fetch messages in forward direction (oldest first).
   *
   * GChat API defaults to createTime ASC (oldest first), which is what we want.
   * For forward pagination, we:
   * 1. If no cursor: Fetch ALL messages (already in chronological order)
   * 2. If cursor: Cursor is a message name, skip to after that message
   *
   * Note: This is less efficient than backward for large message histories,
   * as it requires fetching all messages to find the cursor position.
   */
  private async fetchMessagesForward(
    api: chat_v1.Chat,
    spaceName: string,
    threadId: string,
    filter: string | undefined,
    limit: number,
    cursor?: string
  ): Promise<FetchResult<unknown>> {
    this.logger.debug("GChat API: spaces.messages.list (forward)", {
      spaceName,
      filter,
      limit,
      cursor,
    });

    // Fetch all messages (GChat defaults to createTime ASC = oldest first)
    const allRawMessages: chat_v1.Schema$Message[] = [];
    let pageToken: string | undefined;

    do {
      const response = await api.spaces.messages.list({
        parent: spaceName,
        pageSize: 1000, // Max page size for efficiency
        pageToken,
        filter,
        // Default orderBy is createTime ASC (oldest first) - what we want
      });

      const pageMessages = response.data.messages || [];
      allRawMessages.push(...pageMessages);
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    // Messages are already in chronological order (oldest first) from API

    this.logger.debug(
      "GChat API: fetched all messages for forward pagination",
      {
        totalCount: allRawMessages.length,
      }
    );

    // Find starting position based on cursor
    let startIndex = 0;
    if (cursor) {
      // Cursor is a message name - find the index after it
      const cursorIndex = allRawMessages.findIndex(
        (msg) => msg.name === cursor
      );
      if (cursorIndex >= 0) {
        startIndex = cursorIndex + 1;
      }
    }

    // Get the requested slice
    const selectedMessages = allRawMessages.slice(
      startIndex,
      startIndex + limit
    );

    const messages = await Promise.all(
      selectedMessages.map((msg) =>
        this.parseGChatListMessage(msg, spaceName, threadId)
      )
    );

    // Determine nextCursor - use message name of last returned message
    let nextCursor: string | undefined;
    if (
      startIndex + limit < allRawMessages.length &&
      selectedMessages.length > 0
    ) {
      const lastMsg = selectedMessages.at(-1);
      if (lastMsg?.name) {
        nextCursor = lastMsg.name;
      }
    }

    return {
      messages,
      nextCursor,
    };
  }

  /**
   * Parse a message from the list API into the standard Message format.
   * Resolves user display names and properly determines isMe.
   */
  private async parseGChatListMessage(
    msg: chat_v1.Schema$Message,
    spaceName: string,
    _threadId: string
  ): Promise<Message<unknown>> {
    const msgThreadId = this.encodeThreadId({
      spaceName,
      threadName: msg.thread?.name ?? undefined,
    });
    const msgIsBot = msg.sender?.type === "BOT";

    // Resolve display name - the list API may not include it
    const userId = msg.sender?.name || "unknown";
    const displayName = await this.userInfoCache.resolveDisplayName(
      userId,
      msg.sender?.displayName ?? undefined,
      this.botUserId,
      this.userName
    );

    // Use isMessageFromSelf for proper isMe determination
    const isMe = this.isMessageFromSelf(msg as GoogleChatMessage);

    return new Message({
      id: msg.name || "",
      threadId: msgThreadId,
      text: this.formatConverter.extractPlainText(msg.text || ""),
      formatted: this.formatConverter.toAst(msg.text || ""),
      raw: msg,
      author: {
        userId,
        userName: displayName,
        fullName: displayName,
        isBot: msgIsBot,
        isMe,
      },
      metadata: {
        dateSent: msg.createTime ? new Date(msg.createTime) : new Date(),
        edited: false,
      },
      attachments: [],
    });
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { spaceName } = this.decodeThreadId(threadId);

    try {
      this.logger.debug("GChat API: spaces.get", { spaceName });

      const response = await this.chatApi.spaces.get({ name: spaceName });

      this.logger.debug("GChat API: spaces.get response", {
        displayName: response.data.displayName,
      });

      return {
        id: threadId,
        channelId: spaceName,
        channelName: response.data.displayName ?? undefined,
        metadata: {
          space: response.data,
        },
      };
    } catch (error) {
      this.handleGoogleChatError(error, "fetchThread");
    }
  }

  /**
   * Derive channel ID from a Google Chat thread ID.
   * gchat:{spaceName}:{encodedThreadName} -> gchat:{spaceName}
   */
  channelIdFromThreadId(threadId: string): string {
    const { spaceName } = this.decodeThreadId(threadId);
    return `gchat:${spaceName}`;
  }

  /**
   * Fetch channel-level messages (top-level posts only, not thread replies).
   *
   * Google Chat doesn't support server-side filtering for thread roots,
   * so we fetch messages and filter client-side. A message is a thread root
   * when the message ID prefix (before the dot) matches its thread ID.
   * For example: message "spaces/X/messages/ABC.ABC" in thread "spaces/X/threads/ABC"
   * is a root, while "spaces/X/messages/ABC.DEF" is a reply.
   */
  async fetchChannelMessages(
    channelId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<unknown>> {
    // Channel ID format: "gchat:spaces/ABC123"
    const spaceName = channelId.split(":").slice(1).join(":");
    if (!spaceName) {
      throw new ValidationError(
        "gchat",
        `Invalid Google Chat channel ID: ${channelId}`
      );
    }

    const api = this.impersonatedChatApi || this.chatApi;
    const direction = options.direction ?? "backward";
    const limit = options.limit || 100;

    try {
      if (direction === "backward") {
        return await this.fetchChannelMessagesBackward(
          api,
          spaceName,
          channelId,
          limit,
          options.cursor
        );
      }

      return await this.fetchChannelMessagesForward(
        api,
        spaceName,
        channelId,
        limit,
        options.cursor
      );
    } catch (error) {
      this.handleGoogleChatError(error, "fetchChannelMessages");
    }
  }

  /**
   * Check if a GChat message is a thread root (not a reply).
   *
   * Thread root messages have a name like "spaces/X/messages/THREAD_ID.THREAD_ID"
   * where both parts of the dotted message ID match. Thread replies have
   * "spaces/X/messages/THREAD_ID.DIFFERENT_ID".
   *
   * Messages without a thread field (e.g., in non-threaded spaces) are always top-level.
   */
  private isThreadRoot(msg: chat_v1.Schema$Message): boolean {
    // Messages without thread info are top-level
    if (!(msg.thread?.name && msg.name)) {
      return true;
    }

    // Extract the thread ID from thread.name: "spaces/X/threads/THREAD_ID"
    const threadParts = msg.thread.name.split("/");
    const threadId = threadParts.at(-1);

    // Extract message ID parts from name: "spaces/X/messages/THREAD_ID.MSG_ID"
    const msgParts = msg.name.split("/");
    const msgIdFull = msgParts.at(-1) || "";
    const dotIndex = msgIdFull.indexOf(".");
    if (dotIndex === -1) {
      return true; // No dot = top-level
    }

    const msgThreadPart = msgIdFull.slice(0, dotIndex);
    const msgIdPart = msgIdFull.slice(dotIndex + 1);

    // Thread root: both parts match the thread ID
    return msgThreadPart === msgIdPart && msgThreadPart === threadId;
  }

  /**
   * Fetch channel messages backward (most recent first), filtered to thread roots only.
   * Over-fetches and filters client-side since the API doesn't support this filter.
   */
  private async fetchChannelMessagesBackward(
    api: chat_v1.Chat,
    spaceName: string,
    channelId: string,
    limit: number,
    cursor?: string
  ): Promise<FetchResult<unknown>> {
    this.logger.debug("GChat API: spaces.messages.list (channel, backward)", {
      spaceName,
      limit,
      cursor,
    });

    // Over-fetch to compensate for filtered-out thread replies
    const topLevel: chat_v1.Schema$Message[] = [];
    let pageToken = cursor;
    let apiNextPageToken: string | undefined;

    // Keep fetching pages until we have enough top-level messages
    while (topLevel.length < limit) {
      const response = await api.spaces.messages.list({
        parent: spaceName,
        pageSize: Math.min(limit * 3, 1000),
        pageToken,
        orderBy: "createTime desc",
      });

      const pageMessages = response.data.messages || [];
      if (pageMessages.length === 0) {
        break;
      }

      for (const msg of pageMessages) {
        if (this.isThreadRoot(msg)) {
          topLevel.push(msg);
        }
      }

      apiNextPageToken = response.data.nextPageToken ?? undefined;
      if (!apiNextPageToken) {
        break;
      }
      pageToken = apiNextPageToken;
    }

    // Take only the requested limit and reverse to chronological order
    const selected = topLevel.slice(0, limit).reverse();

    const messages = await Promise.all(
      selected.map((msg) =>
        this.parseGChatListMessage(msg, spaceName, channelId)
      )
    );

    return {
      messages,
      nextCursor: topLevel.length >= limit ? apiNextPageToken : undefined,
    };
  }

  /**
   * Fetch channel messages forward (oldest first), filtered to thread roots only.
   */
  private async fetchChannelMessagesForward(
    api: chat_v1.Chat,
    spaceName: string,
    channelId: string,
    limit: number,
    cursor?: string
  ): Promise<FetchResult<unknown>> {
    this.logger.debug("GChat API: spaces.messages.list (channel, forward)", {
      spaceName,
      limit,
      cursor,
    });

    // Fetch all messages and filter to thread roots
    const allRawMessages: chat_v1.Schema$Message[] = [];
    let pageToken: string | undefined;

    do {
      const response = await api.spaces.messages.list({
        parent: spaceName,
        pageSize: 1000,
        pageToken,
      });
      allRawMessages.push(...(response.data.messages || []));
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    // Filter to thread roots only
    const topLevel = allRawMessages.filter((msg) => this.isThreadRoot(msg));

    let startIndex = 0;
    if (cursor) {
      const cursorIndex = topLevel.findIndex((msg) => msg.name === cursor);
      if (cursorIndex >= 0) {
        startIndex = cursorIndex + 1;
      }
    }

    const selectedMessages = topLevel.slice(startIndex, startIndex + limit);

    const messages = await Promise.all(
      selectedMessages.map((msg) =>
        this.parseGChatListMessage(msg, spaceName, channelId)
      )
    );

    let nextCursor: string | undefined;
    if (startIndex + limit < topLevel.length && selectedMessages.length > 0) {
      const lastMsg = selectedMessages.at(-1);
      if (lastMsg?.name) {
        nextCursor = lastMsg.name;
      }
    }

    return { messages, nextCursor };
  }

  /**
   * List threads in a Google Chat space.
   * Fetches messages and deduplicates by thread name.
   */
  async listThreads(
    channelId: string,
    options: ListThreadsOptions = {}
  ): Promise<ListThreadsResult<unknown>> {
    const spaceName = channelId.split(":").slice(1).join(":");
    if (!spaceName) {
      throw new ValidationError(
        "gchat",
        `Invalid Google Chat channel ID: ${channelId}`
      );
    }

    const api = this.impersonatedChatApi || this.chatApi;
    const limit = options.limit || 50;

    try {
      this.logger.debug("GChat API: spaces.messages.list (listThreads)", {
        spaceName,
        limit,
        cursor: options.cursor,
      });

      // Fetch recent messages ordered by createTime desc
      const response = await api.spaces.messages.list({
        parent: spaceName,
        pageSize: Math.min(limit * 3, 1000), // Fetch more to account for dedup
        pageToken: options.cursor,
        orderBy: "createTime desc",
      });

      const rawMessages = response.data.messages || [];

      // Group by thread name, keeping the first (most recent) message per thread
      const threadMap = new Map<
        string,
        { rootMsg: chat_v1.Schema$Message; count: number }
      >();
      for (const msg of rawMessages) {
        const threadName = msg.thread?.name;
        if (!threadName) {
          continue;
        }
        const existing = threadMap.get(threadName);
        if (existing) {
          existing.count++;
        } else {
          threadMap.set(threadName, { rootMsg: msg, count: 1 });
        }
      }

      // Convert to ThreadSummary (limited)
      const threads: ThreadSummary[] = [];
      let count = 0;
      for (const [threadName, { rootMsg, count: replyCount }] of threadMap) {
        if (count >= limit) {
          break;
        }

        const threadId = this.encodeThreadId({
          spaceName,
          threadName,
        });

        const message = await this.parseGChatListMessage(
          rootMsg,
          spaceName,
          threadId
        );

        threads.push({
          id: threadId,
          rootMessage: message,
          replyCount,
          lastReplyAt: rootMsg.createTime
            ? new Date(rootMsg.createTime)
            : undefined,
        });
        count++;
      }

      this.logger.debug("GChat API: listThreads result", {
        threadCount: threads.length,
      });

      return {
        threads,
        nextCursor: response.data.nextPageToken ?? undefined,
      };
    } catch (error) {
      this.handleGoogleChatError(error, "listThreads");
    }
  }

  /**
   * Fetch Google Chat space info/metadata.
   */
  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const spaceName = channelId.split(":").slice(1).join(":");
    if (!spaceName) {
      throw new ValidationError(
        "gchat",
        `Invalid Google Chat channel ID: ${channelId}`
      );
    }

    try {
      this.logger.debug("GChat API: spaces.get (channelInfo)", { spaceName });

      const response = await this.chatApi.spaces.get({ name: spaceName });
      const space = response.data;

      // Try to get member count
      let memberCount: number | undefined;
      try {
        const membersResponse = await this.chatApi.spaces.members.list({
          parent: spaceName,
          pageSize: 1,
        });
        // The API doesn't return total count directly, but we can check if there are members
        if (membersResponse.data.memberships) {
          memberCount = membersResponse.data.memberships.length;
        }
      } catch {
        // Member list may not be accessible
      }

      return {
        id: channelId,
        name: space.displayName ?? undefined,
        isDM:
          space.spaceType === "DIRECT_MESSAGE" ||
          space.singleUserBotDm === true,
        memberCount,
        metadata: {
          spaceType: space.spaceType,
          spaceThreadingState: space.spaceThreadingState,
          raw: space,
        },
      };
    } catch (error) {
      this.handleGoogleChatError(error, "fetchChannelInfo");
    }
  }

  /**
   * Post a message to a space top-level (starts a new conversation, not in a thread).
   */
  async postChannelMessage(
    channelId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<unknown>> {
    const spaceName = channelId.split(":").slice(1).join(":");
    if (!spaceName) {
      throw new ValidationError(
        "gchat",
        `Invalid Google Chat channel ID: ${channelId}`
      );
    }

    try {
      const card = extractCard(message);

      if (card) {
        const cardId = `card-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const googleCard = cardToGoogleCard(card, {
          cardId,
          endpointUrl: this.endpointUrl,
        });

        this.logger.debug("GChat API: spaces.messages.create (channel, card)", {
          spaceName,
        });

        const response = await this.chatApi.spaces.messages.create({
          parent: spaceName,
          requestBody: {
            cardsV2: [googleCard],
            // No thread field - creates a new conversation
          },
        });

        return {
          id: response.data.name || "",
          threadId: channelId,
          raw: response.data,
        };
      }

      // Regular text message
      const text = convertEmojiPlaceholders(
        this.formatConverter.renderPostable(message),
        "gchat"
      );

      this.logger.debug("GChat API: spaces.messages.create (channel)", {
        spaceName,
        textLength: text.length,
      });

      const response = await this.chatApi.spaces.messages.create({
        parent: spaceName,
        requestBody: {
          text,
          // No thread field - creates a new conversation
        },
      });

      return {
        id: response.data.name || "",
        threadId: channelId,
        raw: response.data,
      };
    } catch (error) {
      this.handleGoogleChatError(error, "postChannelMessage");
    }
  }

  encodeThreadId(platformData: GoogleChatThreadId): string {
    return encodeThreadId(platformData);
  }

  /**
   * Check if a thread is a direct message conversation.
   */
  isDM(threadId: string): boolean {
    return isDMThread(threadId);
  }

  decodeThreadId(threadId: string): GoogleChatThreadId {
    return decodeThreadId(threadId);
  }

  parseMessage(raw: unknown): Message<unknown> {
    const event = raw as GoogleChatEvent;
    const messagePayload = event.chat?.messagePayload;
    if (!messagePayload) {
      throw new ValidationError("gchat", "Cannot parse non-message event");
    }
    const threadName =
      messagePayload.message.thread?.name || messagePayload.message.name;
    const threadId = this.encodeThreadId({
      spaceName: messagePayload.space.name,
      threadName,
    });
    return this.parseGoogleChatMessage(event, threadId);
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  /**
   * Normalize bot mentions in message text.
   * Google Chat uses the bot's display name (e.g., "@Chat SDK Demo") but the
   * Chat SDK expects "@{userName}" format. This method replaces bot mentions
   * with the adapter's userName so mention detection works properly.
   * Also learns the bot's user ID from annotations for isMe detection.
   */
  private normalizeBotMentions(message: GoogleChatMessage): string {
    let text = message.text || "";

    // Find bot mentions in annotations and replace with @{userName}
    const annotations = message.annotations || [];
    for (const annotation of annotations) {
      if (
        annotation.type === "USER_MENTION" &&
        annotation.userMention?.user?.type === "BOT"
      ) {
        const botUser = annotation.userMention.user;
        const botDisplayName = botUser.displayName;

        // Learn our bot's user ID from mentions and persist to state
        if (botUser.name && !this.botUserId) {
          this.botUserId = botUser.name;
          this.logger.info("Learned bot user ID from mention", {
            botUserId: this.botUserId,
          });
          // Persist to state for serverless environments
          this.state
            ?.set("gchat:botUserId", this.botUserId)
            .catch((err) =>
              this.logger.error("Failed to persist botUserId", { error: err })
            );
        }

        // Replace the bot mention with @{userName}
        // Pub/Sub messages don't include displayName, so use startIndex/length
        if (
          annotation.startIndex !== undefined &&
          annotation.length !== undefined
        ) {
          const startIndex = annotation.startIndex;
          const length = annotation.length;
          const mentionText = text.slice(startIndex, startIndex + length);
          text =
            text.slice(0, startIndex) +
            `@${this.userName}` +
            text.slice(startIndex + length);
          this.logger.debug("Normalized bot mention", {
            original: mentionText,
            replacement: `@${this.userName}`,
          });
        } else if (botDisplayName) {
          // Fallback: use displayName if available (direct webhook)
          const mentionText = `@${botDisplayName}`;
          text = text.replace(mentionText, `@${this.userName}`);
        }
      }
    }

    return text;
  }

  /**
   * Check if a message is from this bot.
   *
   * Bot user ID is learned dynamically from message annotations when the bot
   * is @mentioned. Until we learn the ID, we cannot reliably determine isMe.
   *
   * This is safer than the previous approach of assuming all BOT messages are
   * from self, which would incorrectly filter messages from other bots in
   * multi-bot spaces (especially via Pub/Sub).
   */
  private isMessageFromSelf(message: GoogleChatMessage): boolean {
    const senderId = message.sender?.name;

    // Use exact match when we know our bot ID
    if (this.botUserId && senderId) {
      return senderId === this.botUserId;
    }

    // If we don't know our bot ID yet, we can't reliably determine isMe.
    // Log a debug message and return false - better to process a self-message
    // than to incorrectly filter out messages from other bots.
    if (!this.botUserId && message.sender?.type === "BOT") {
      this.logger.debug(
        "Cannot determine isMe - bot user ID not yet learned. " +
          "Bot ID is learned from @mentions. Assuming message is not from self.",
        { senderId }
      );
    }

    return false;
  }

  private handleGoogleChatError(error: unknown, context?: string): never {
    const gError = error as {
      code?: number;
      message?: string;
      errors?: unknown;
    };

    // Log the error at error level for visibility
    this.logger.error(`GChat API error${context ? ` (${context})` : ""}`, {
      code: gError.code,
      message: gError.message,
      errors: gError.errors,
      error,
    });

    if (gError.code === 429) {
      throw new AdapterRateLimitError("gchat");
    }

    throw error;
  }
}

export function createGoogleChatAdapter(config?: {
  auth?: Parameters<typeof google.chat>[0]["auth"];
  credentials?: ServiceAccountCredentials;
  endpointUrl?: string;
  impersonateUser?: string;
  logger?: Logger;
  pubsubTopic?: string;
  useApplicationDefaultCredentials?: boolean;
  userName?: string;
}): GoogleChatAdapter {
  const logger = config?.logger ?? new ConsoleLogger("info").child("gchat");

  // Auto-detect auth mode. Only fall back to env vars for auth fields when
  // the caller hasn't provided ANY auth field, so we don't mix auth modes.
  const hasAuthConfig = !!(
    config?.auth ||
    config?.credentials ||
    config?.useApplicationDefaultCredentials
  );

  if (config?.auth) {
    return new GoogleChatAdapter({
      auth: config.auth,
      endpointUrl: config.endpointUrl,
      impersonateUser:
        config.impersonateUser ?? process.env.GOOGLE_CHAT_IMPERSONATE_USER,
      logger,
      pubsubTopic: config.pubsubTopic ?? process.env.GOOGLE_CHAT_PUBSUB_TOPIC,
      userName: config.userName,
    });
  }

  // Service account credentials from config or env
  let credentialsJson = config?.credentials;
  if (
    !(credentialsJson || hasAuthConfig) &&
    process.env.GOOGLE_CHAT_CREDENTIALS
  ) {
    credentialsJson = JSON.parse(
      process.env.GOOGLE_CHAT_CREDENTIALS
    ) as ServiceAccountCredentials;
  }
  if (credentialsJson) {
    return new GoogleChatAdapter({
      credentials: credentialsJson,
      endpointUrl: config?.endpointUrl,
      impersonateUser:
        config?.impersonateUser ?? process.env.GOOGLE_CHAT_IMPERSONATE_USER,
      logger,
      pubsubTopic: config?.pubsubTopic ?? process.env.GOOGLE_CHAT_PUBSUB_TOPIC,
      userName: config?.userName,
    });
  }

  // Application Default Credentials
  if (
    config?.useApplicationDefaultCredentials ||
    (!hasAuthConfig && process.env.GOOGLE_CHAT_USE_ADC === "true")
  ) {
    return new GoogleChatAdapter({
      useApplicationDefaultCredentials: true,
      endpointUrl: config?.endpointUrl,
      impersonateUser:
        config?.impersonateUser ?? process.env.GOOGLE_CHAT_IMPERSONATE_USER,
      logger,
      pubsubTopic: config?.pubsubTopic ?? process.env.GOOGLE_CHAT_PUBSUB_TOPIC,
      userName: config?.userName,
    });
  }

  throw new ValidationError(
    "gchat",
    "Authentication is required. Set GOOGLE_CHAT_CREDENTIALS or GOOGLE_CHAT_USE_ADC=true, or provide credentials/auth in config."
  );
}

// Re-export card converter for advanced use
export { cardToFallbackText, cardToGoogleCard } from "./cards";
export { GoogleChatFormatConverter } from "./markdown";

export {
  type CreateSpaceSubscriptionOptions,
  createSpaceSubscription,
  decodePubSubMessage,
  deleteSpaceSubscription,
  listSpaceSubscriptions,
  type PubSubPushMessage,
  type SpaceSubscriptionResult,
  verifyPubSubRequest,
  type WorkspaceEventNotification,
  type WorkspaceEventsAuthOptions,
} from "./workspace-events";
