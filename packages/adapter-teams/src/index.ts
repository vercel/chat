import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import {
  TokenCredentialAuthenticationProvider,
  type TokenCredentialAuthenticationProviderOptions,
} from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";
import type { Activity, ConversationReference } from "botbuilder";
import {
  ActivityTypes,
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  TeamsInfo,
  type TurnContext,
} from "botbuilder";

/** Extended CloudAdapter that exposes processActivity for serverless environments */
class ServerlessCloudAdapter extends CloudAdapter {
  handleActivity(
    authHeader: string,
    activity: Activity,
    logic: (context: TurnContext) => Promise<void>,
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
  RawMessage,
  ReactionEvent,
  ThreadInfo,
  ThreadSummary,
  WebhookOptions,
} from "chat";
import {
  convertEmojiPlaceholders,
  defaultEmojiResolver,
  Message,
  NotImplementedError,
} from "chat";
import { cardToAdaptiveCard } from "./cards";
import { TeamsFormatConverter } from "./markdown";

/** Microsoft Graph API chat message type */
interface GraphChatMessage {
  id: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  replyToId?: string; // ID of parent message for channel threads
  body?: {
    content?: string;
    contentType?: "text" | "html";
  };
  from?: {
    user?: {
      id?: string;
      displayName?: string;
    };
    application?: {
      id?: string;
      displayName?: string;
    };
  };
  attachments?: Array<{
    id?: string;
    contentType?: string;
    contentUrl?: string;
    content?: string; // JSON string for adaptive cards
    name?: string;
  }>;
}

export interface TeamsAdapterConfig {
  /** Microsoft App ID */
  appId: string;
  /** Microsoft App Password */
  appPassword: string;
  /** Logger instance for error reporting */
  logger: Logger;
  /** Microsoft App Type */
  appType?: "MultiTenant" | "SingleTenant";
  /** Microsoft App Tenant ID */
  appTenantId?: string;
  /** Override bot username (optional) */
  userName?: string;
}

/** Teams-specific thread ID data */
export interface TeamsThreadId {
  conversationId: string;
  serviceUrl: string;
  replyToId?: string;
}

/** Teams channel context extracted from activity.channelData */
interface TeamsChannelContext {
  teamId: string;
  channelId: string;
  tenantId: string;
}

export class TeamsAdapter implements Adapter<TeamsThreadId, unknown> {
  readonly name = "teams";
  readonly userName: string;
  readonly botUserId?: string;

  private botAdapter: ServerlessCloudAdapter;
  private graphClient: Client | null = null;
  private chat: ChatInstance | null = null;
  private logger: Logger;
  private formatConverter = new TeamsFormatConverter();
  private config: TeamsAdapterConfig;

  constructor(config: TeamsAdapterConfig) {
    this.config = config;
    this.logger = config.logger;
    this.userName = config.userName || "bot";

    if (config.appType === "SingleTenant" && !config.appTenantId) {
      throw new ValidationError(
        "teams",
        "appTenantId is required for SingleTenant app type",
      );
    }

    // Pass empty config object, credentials go via factory
    const auth = new ConfigurationBotFrameworkAuthentication({
      MicrosoftAppId: config.appId,
      MicrosoftAppPassword: config.appPassword,
      MicrosoftAppType: config.appType || "MultiTenant",
      MicrosoftAppTenantId:
        config.appType === "SingleTenant" ? config.appTenantId : undefined,
    });

    this.botAdapter = new ServerlessCloudAdapter(auth);

    // Initialize Microsoft Graph client for message history (requires tenant ID)
    if (config.appTenantId) {
      const credential = new ClientSecretCredential(
        config.appTenantId,
        config.appId,
        config.appPassword,
      );

      const authProvider = new TokenCredentialAuthenticationProvider(
        credential,
        {
          scopes: ["https://graph.microsoft.com/.default"],
        } as TokenCredentialAuthenticationProviderOptions,
      );

      this.graphClient = Client.initWithMiddleware({ authProvider });
    }
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions,
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

    // Get the auth header for token validation
    const authHeader = request.headers.get("authorization") || "";

    try {
      // Use handleActivity which takes the activity directly
      // instead of mocking Node.js req/res objects
      await this.botAdapter.handleActivity(
        authHeader,
        activity,
        async (context) => {
          await this.handleTurn(context, options);
        },
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

  private async handleTurn(
    context: TurnContext,
    options?: WebhookOptions,
  ): Promise<void> {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring event");
      return;
    }

    const activity = context.activity;

    // Cache serviceUrl and tenantId for the user - needed for opening DMs later
    if (activity.from?.id && activity.serviceUrl) {
      const userId = activity.from.id;
      const channelData = activity.channelData as {
        tenant?: { id?: string };
        team?: { id?: string };
        channel?: { id?: string };
      };
      const tenantId = channelData?.tenant?.id;
      const ttl = 30 * 24 * 60 * 60 * 1000; // 30 days

      // Store serviceUrl and tenantId for DM creation
      this.chat
        .getState()
        .set(`teams:serviceUrl:${userId}`, activity.serviceUrl, ttl)
        .catch((err) => {
          this.logger.error("Failed to cache serviceUrl", {
            userId,
            error: err,
          });
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

      // Cache team/channel context for proper message fetching in channel threads
      // This allows fetchMessages to use the channel-specific endpoint for thread filtering
      // The Graph API requires aadGroupId (GUID format), not the Teams thread-style ID
      // Note: The botbuilder types don't include aadGroupId, but it's present at runtime
      // aadGroupId is only available in installationUpdate/conversationUpdate events
      const team = channelData?.team as
        | { id?: string; aadGroupId?: string }
        | undefined;
      const teamAadGroupId = team?.aadGroupId;
      const teamThreadId = team?.id; // Thread-style ID like "19:xxx@thread.tacv2"
      const conversationId = activity.conversation?.id || "";
      const baseChannelId = conversationId.replace(/;messageid=\d+/, "");

      if (teamAadGroupId && channelData?.channel?.id && tenantId) {
        // We have aadGroupId (from installationUpdate/conversationUpdate) - cache it
        const context: TeamsChannelContext = {
          teamId: teamAadGroupId, // Use aadGroupId (GUID) for Graph API
          channelId: channelData.channel.id,
          tenantId,
        };
        const contextJson = JSON.stringify(context);

        // Cache by conversation ID (channel)
        this.chat
          .getState()
          .set(`teams:channelContext:${baseChannelId}`, contextJson, ttl)
          .catch((err) => {
            this.logger.error("Failed to cache channel context", {
              conversationId: baseChannelId,
              error: err,
            });
          });

        // Also cache by team thread-style ID for lookup from regular messages
        // (which don't have aadGroupId but do have team.id)
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
            teamGuid: context.teamId,
            channelId: context.channelId,
          },
        );
      } else if (teamThreadId && channelData?.channel?.id && tenantId) {
        // Regular message event - no aadGroupId, but try to look up from previous cache
        const cachedTeamContext = await this.chat
          .getState()
          .get<string>(`teams:teamContext:${teamThreadId}`);

        if (cachedTeamContext) {
          // Found cached context from installation event - also cache by channel ID
          this.chat
            .getState()
            .set(
              `teams:channelContext:${baseChannelId}`,
              cachedTeamContext,
              ttl,
            )
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
          // No cached context - try to fetch team details via Bot Framework API
          // TeamsInfo.getTeamDetails() calls /v3/teams/{teamId} and returns aadGroupId
          try {
            const teamDetails = await TeamsInfo.getTeamDetails(context);
            if (teamDetails?.aadGroupId) {
              const fetchedContext: TeamsChannelContext = {
                teamId: teamDetails.aadGroupId,
                channelId: channelData.channel.id,
                tenantId,
              };
              const contextJson = JSON.stringify(fetchedContext);

              // Cache by conversation ID
              this.chat
                .getState()
                .set(`teams:channelContext:${baseChannelId}`, contextJson, ttl)
                .catch((err) => {
                  this.logger.error("Failed to cache fetched channel context", {
                    conversationId: baseChannelId,
                    error: err,
                  });
                });

              // Also cache by team thread-style ID
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
                },
              );
            }
          } catch (error) {
            // TeamsInfo.getTeamDetails() only works in team scope
            this.logger.debug(
              "Could not fetch team details (may not be a team scope)",
              { teamThreadId, error },
            );
          }
        }
      }
    }

    // Handle message reactions
    if (activity.type === ActivityTypes.MessageReaction) {
      this.handleReactionActivity(activity, options);
      return;
    }

    // Handle adaptive card actions (button clicks)
    if (activity.type === ActivityTypes.Invoke) {
      await this.handleInvokeActivity(context, options);
      return;
    }

    // Only handle message activities
    if (activity.type !== ActivityTypes.Message) {
      this.logger.debug("Ignoring non-message activity", {
        type: activity.type,
      });
      return;
    }

    // Check if this message activity is actually a button click (Action.Submit)
    // Teams sends Action.Submit as a message with value.actionId
    const actionValue = activity.value as
      | { actionId?: string; value?: string }
      | undefined;
    if (actionValue?.actionId) {
      this.handleMessageAction(activity, actionValue, options);
      return;
    }

    const threadId = this.encodeThreadId({
      conversationId: activity.conversation?.id || "",
      serviceUrl: activity.serviceUrl || "",
      replyToId: activity.replyToId,
    });

    // Let Chat class handle async processing and waitUntil
    this.chat.processMessage(
      this,
      threadId,
      this.parseTeamsMessage(activity, threadId),
      options,
    );
  }

  /**
   * Handle Action.Submit button clicks sent as message activities.
   * Teams sends these with type "message" and value.actionId.
   */
  private handleMessageAction(
    activity: Activity,
    actionValue: { actionId?: string; value?: string },
    options?: WebhookOptions,
  ): void {
    if (!this.chat || !actionValue.actionId) return;

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

    this.logger.debug("Processing Teams message action (Action.Submit)", {
      actionId: actionValue.actionId,
      value: actionValue.value,
      messageId: actionEvent.messageId,
      threadId,
    });

    this.chat.processAction(actionEvent, options);
  }

  /**
   * Handle invoke activities (adaptive card actions, etc.).
   */
  private async handleInvokeActivity(
    context: TurnContext,
    options?: WebhookOptions,
  ): Promise<void> {
    const activity = context.activity;

    // Handle adaptive card action invokes
    if (activity.name === "adaptiveCard/action") {
      await this.handleAdaptiveCardAction(context, activity, options);
      return;
    }

    this.logger.debug("Ignoring unsupported invoke", {
      name: activity.name,
    });
  }

  /**
   * Handle adaptive card button clicks.
   * The action data is in activity.value with our { actionId, value } structure.
   */
  private async handleAdaptiveCardAction(
    context: TurnContext,
    activity: Activity,
    options?: WebhookOptions,
  ): Promise<void> {
    if (!this.chat) return;

    // Activity.value contains our action data
    const actionData = activity.value?.action?.data as
      | { actionId?: string; value?: string }
      | undefined;

    if (!actionData?.actionId) {
      this.logger.debug("Adaptive card action missing actionId", {
        value: activity.value,
      });
      // Send acknowledgment response
      await context.sendActivity({
        type: ActivityTypes.InvokeResponse,
        value: { status: 200 },
      });
      return;
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

    this.logger.debug("Processing Teams adaptive card action", {
      actionId: actionData.actionId,
      value: actionData.value,
      messageId: actionEvent.messageId,
      threadId,
    });

    this.chat.processAction(actionEvent, options);

    // Send acknowledgment response to prevent timeout
    await context.sendActivity({
      type: ActivityTypes.InvokeResponse,
      value: { status: 200 },
    });
  }

  /**
   * Handle Teams reaction events (reactionsAdded/reactionsRemoved).
   */
  private handleReactionActivity(
    activity: Activity,
    options?: WebhookOptions,
  ): void {
    if (!this.chat) return;

    // Extract the message ID from conversation ID
    // Format: "19:xxx@thread.tacv2;messageid=1767297849909"
    const conversationId = activity.conversation?.id || "";
    const messageIdMatch = conversationId.match(/messageid=(\d+)/);
    const messageId = messageIdMatch?.[1] || activity.replyToId || "";

    // Build thread ID - KEEP the full conversation ID including ;messageid=XXX
    // This is required for Teams to reply in the correct thread
    const threadId = this.encodeThreadId({
      conversationId: conversationId,
      serviceUrl: activity.serviceUrl || "",
    });

    const user = {
      userId: activity.from?.id || "unknown",
      userName: activity.from?.name || "unknown",
      fullName: activity.from?.name,
      isBot: false,
      isMe: this.isMessageFromSelf(activity),
    };

    // Process added reactions
    const reactionsAdded = activity.reactionsAdded || [];
    for (const reaction of reactionsAdded) {
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

      this.logger.debug("Processing Teams reaction added", {
        emoji: emojiValue.name,
        rawEmoji,
        messageId,
      });

      this.chat.processReaction({ ...event, adapter: this }, options);
    }

    // Process removed reactions
    const reactionsRemoved = activity.reactionsRemoved || [];
    for (const reaction of reactionsRemoved) {
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

      this.logger.debug("Processing Teams reaction removed", {
        emoji: emojiValue.name,
        rawEmoji,
        messageId,
      });

      this.chat.processReaction({ ...event, adapter: this }, options);
    }
  }

  private parseTeamsMessage(
    activity: Activity,
    threadId: string,
  ): Message<unknown> {
    const text = activity.text || "";
    // Normalize mentions - format converter will convert <at>name</at> to @name
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
            // Filter out adaptive cards (handled separately as cards, not attachments)
            att.contentType !== "application/vnd.microsoft.card.adaptive" &&
            // Filter out text/html without contentUrl - this is just the formatted
            // version of the message text, not an actual file attachment.
            // Real HTML file attachments would have a contentUrl.
            !(att.contentType === "text/html" && !att.contentUrl),
        )
        .map((att) => this.createAttachment(att)),
    });
  }

  /**
   * Create an Attachment object from a Teams attachment.
   */
  private createAttachment(att: {
    contentType?: string;
    contentUrl?: string;
    name?: string;
  }): Attachment {
    const url = att.contentUrl;

    // Determine type based on contentType
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
                `Failed to fetch file: ${response.status} ${response.statusText}`,
              );
            }
            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
          }
        : undefined,
    };
  }

  private normalizeMentions(text: string, _activity: Activity): string {
    // Don't strip mentions - the format converter will convert <at>name</at> to @name
    // Just trim any leading/trailing whitespace that might result from mention placement
    return text.trim();
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<unknown>> {
    const { conversationId, serviceUrl } = this.decodeThreadId(threadId);

    // Check for files to upload
    const files = extractFiles(message);
    const fileAttachments =
      files.length > 0 ? await this.filesToAttachments(files) : [];

    // Check if message contains a card
    const card = extractCard(message);
    let activity: Partial<Activity>;

    if (card) {
      // Render card as Adaptive Card
      const adaptiveCard = cardToAdaptiveCard(card);

      activity = {
        type: ActivityTypes.Message,
        // Don't include text - Teams shows both text and card if text is present
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
      // Regular text message
      const text = convertEmojiPlaceholders(
        this.formatConverter.renderPostable(message),
        "teams",
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

    // Use the adapter to send the message
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
        },
      );
    } catch (error) {
      this.logger.error("Teams API: sendActivity failed", {
        conversationId,
        error,
      });
      this.handleTeamsError(error, "postMessage");
    }

    this.logger.debug("Teams API: sendActivity response", { messageId });

    return {
      id: messageId,
      threadId,
      raw: activity,
    };
  }

  /**
   * Convert files to Teams attachments.
   * Uses inline data URIs for small files.
   */
  private async filesToAttachments(
    files: FileUpload[],
  ): Promise<Array<{ contentType: string; contentUrl: string; name: string }>> {
    const attachments: Array<{
      contentType: string;
      contentUrl: string;
      name: string;
    }> = [];

    for (const file of files) {
      // Convert data to Buffer using shared utility
      const buffer = await toBuffer(file.data, {
        platform: "teams",
        throwOnUnsupported: false,
      });
      if (!buffer) {
        continue;
      }

      // Create data URI using shared utility
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

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<unknown>> {
    const { conversationId, serviceUrl } = this.decodeThreadId(threadId);

    // Check if message contains a card
    const card = extractCard(message);
    let activity: Partial<Activity>;

    if (card) {
      // Render card as Adaptive Card
      const adaptiveCard = cardToAdaptiveCard(card);

      activity = {
        id: messageId,
        type: ActivityTypes.Message,
        // Don't include text - Teams shows both text and card if text is present
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
      // Regular text message
      const text = convertEmojiPlaceholders(
        this.formatConverter.renderPostable(message),
        "teams",
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
        },
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

    return {
      id: messageId,
      threadId,
      raw: activity,
    };
  }

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
        },
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

  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    throw new NotImplementedError(
      "Teams Bot Framework does not expose reaction APIs",
      "addReaction",
    );
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    throw new NotImplementedError(
      "Teams Bot Framework does not expose reaction APIs",
      "removeReaction",
    );
  }

  async startTyping(threadId: string): Promise<void> {
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
          await context.sendActivity({ type: ActivityTypes.Typing });
        },
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

  /**
   * Open a direct message conversation with a user.
   * Returns a thread ID that can be used to post messages.
   *
   * The serviceUrl and tenantId are automatically resolved from cached user interactions.
   * If no cached values are found, defaults are used (which may not work for all tenants).
   */
  async openDM(userId: string): Promise<string> {
    // Look up cached serviceUrl and tenantId for this user from state
    const cachedServiceUrl = await this.chat
      ?.getState()
      .get<string>(`teams:serviceUrl:${userId}`);
    const cachedTenantId = await this.chat
      ?.getState()
      .get<string>(`teams:tenantId:${userId}`);

    const serviceUrl =
      cachedServiceUrl || "https://smba.trafficmanager.net/teams/";
    // Use cached tenant ID, config tenant ID, or undefined (will fail for multi-tenant)
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
        "Cannot open DM: tenant ID not found. User must interact with the bot first (via @mention) to cache their tenant ID.",
      );
    }

    let conversationId = "";

    // Create the 1:1 conversation using createConversationAsync
    // The conversation ID is captured from within the callback, not from the return value
    // biome-ignore lint/suspicious/noExplicitAny: BotBuilder types are incomplete
    await (this.botAdapter as any).createConversationAsync(
      this.config.appId,
      "msteams",
      serviceUrl,
      "", // empty audience
      {
        isGroup: false,
        bot: { id: this.config.appId, name: this.userName },
        members: [{ id: userId }],
        tenantId,
        channelData: {
          tenant: { id: tenantId },
        },
      },
      async (turnContext: TurnContext) => {
        // Capture the conversation ID from the new context
        conversationId = turnContext?.activity?.conversation?.id || "";
        this.logger.debug("Teams: conversation created in callback", {
          conversationId,
          activityId: turnContext?.activity?.id,
        });
      },
    );

    if (!conversationId) {
      throw new NetworkError(
        "teams",
        "Failed to create 1:1 conversation - no ID returned",
      );
    }

    this.logger.debug("Teams: 1:1 conversation created", { conversationId });

    return this.encodeThreadId({
      conversationId,
      serviceUrl,
    });
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {},
  ): Promise<FetchResult<unknown>> {
    if (!this.graphClient) {
      throw new NotImplementedError(
        "Teams fetchMessages requires appTenantId to be configured for Microsoft Graph API access.",
        "fetchMessages",
      );
    }

    const { conversationId } = this.decodeThreadId(threadId);
    const limit = options.limit || 50;
    const cursor = options.cursor;
    const direction = options.direction ?? "backward";

    // Extract message ID for thread filtering (format: "19:xxx@thread.tacv2;messageid=123456")
    const messageIdMatch = conversationId.match(/;messageid=(\d+)/);
    const threadMessageId = messageIdMatch?.[1];

    // Strip ;messageid= from conversation ID
    const baseConversationId = conversationId.replace(/;messageid=\d+/, "");

    // Try to get cached channel context for proper thread-level message fetching
    let channelContext: TeamsChannelContext | null = null;
    if (threadMessageId && this.chat) {
      const cachedContext = await this.chat
        .getState()
        .get<string>(`teams:channelContext:${baseConversationId}`);
      if (cachedContext) {
        try {
          channelContext = JSON.parse(cachedContext) as TeamsChannelContext;
        } catch {
          // Invalid cached data, ignore
        }
      }

      // Note: Team GUID is cached during webhook handling via TeamsInfo.getTeamDetails()
      // If no cached context, we'll fall back to the chat endpoint (less accurate for channels)
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

      // If we have channel context and a thread message ID, use the channel replies endpoint
      // This gives us proper thread-level filtering instead of all messages in the channel
      if (channelContext && threadMessageId) {
        return this.fetchChannelThreadMessages(
          channelContext,
          threadMessageId,
          threadId,
          options,
        );
      }

      // Teams conversation IDs:
      // - Channels: "19:xxx@thread.tacv2"
      // - Group chats: "19:xxx@thread.v2"
      // - 1:1 chats: other formats (e.g., "a]xxx", "8:orgid:xxx")
      // For Graph API, we use /chats/{chat-id}/messages for all chat types

      // Note: Teams Graph API only supports orderby("createdDateTime desc")
      // Ascending order is not supported, so we work around this limitation.
      // Also, max page size is 50 messages per request.

      let graphMessages: GraphChatMessage[];
      let hasMoreMessages = false;

      if (direction === "forward") {
        // Forward direction: need to fetch ALL messages to find the oldest ones
        // since API only supports descending order. Paginate with max 50 per request.
        const allMessages: GraphChatMessage[] = [];
        let nextLink: string | undefined;
        const apiUrl = `/chats/${encodeURIComponent(baseConversationId)}/messages`;

        do {
          const request = nextLink
            ? this.graphClient.api(nextLink)
            : this.graphClient
                .api(apiUrl)
                .top(50) // Max allowed by Teams API
                .orderby("createdDateTime desc");

          const response = await request.get();
          const pageMessages = (response.value || []) as GraphChatMessage[];
          allMessages.push(...pageMessages);
          nextLink = response["@odata.nextLink"];
        } while (nextLink);

        // Reverse to get chronological order (oldest first)
        allMessages.reverse();

        // Find starting position based on cursor (cursor is a timestamp)
        let startIndex = 0;
        if (cursor) {
          startIndex = allMessages.findIndex(
            (msg) => msg.createdDateTime && msg.createdDateTime > cursor,
          );
          if (startIndex === -1) startIndex = allMessages.length;
        }

        // Check if there are more messages beyond our slice
        hasMoreMessages = startIndex + limit < allMessages.length;
        // Take only the requested limit
        graphMessages = allMessages.slice(startIndex, startIndex + limit);
      } else {
        // Backward direction: simple pagination
        let request = this.graphClient
          .api(`/chats/${encodeURIComponent(baseConversationId)}/messages`)
          .top(limit)
          .orderby("createdDateTime desc");

        if (cursor) {
          // Get messages older than cursor
          request = request.filter(`createdDateTime lt ${cursor}`);
        }

        const response = await request.get();
        graphMessages = (response.value || []) as GraphChatMessage[];

        // API returns newest first, reverse to get chronological order
        graphMessages.reverse();

        // We have more if we got a full page
        hasMoreMessages = graphMessages.length >= limit;
      }

      // For group chats (non-channel), filter to only messages from the "thread" onwards.
      // Teams group chats don't have real threading - the messageid in the conversation ID
      // is just UI context. We filter by message ID (which is a timestamp) to simulate threading.
      if (threadMessageId && !channelContext) {
        graphMessages = graphMessages.filter((msg) => {
          // Include messages with ID >= thread message ID (IDs are timestamps)
          return msg.id && msg.id >= threadMessageId;
        });
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

      const messages = graphMessages.map((msg: GraphChatMessage) => {
        const isFromBot =
          msg.from?.application?.id === this.config.appId ||
          msg.from?.user?.id === this.config.appId;

        return new Message({
          id: msg.id,
          threadId,
          text: this.extractTextFromGraphMessage(msg),
          formatted: this.formatConverter.toAst(
            this.extractTextFromGraphMessage(msg),
          ),
          raw: msg,
          author: {
            userId:
              msg.from?.user?.id || msg.from?.application?.id || "unknown",
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
      });

      // Determine nextCursor based on direction
      let nextCursor: string | undefined;
      if (hasMoreMessages && graphMessages.length > 0) {
        if (direction === "forward") {
          // Forward: use the newest message's timestamp (last in returned slice)
          const lastMsg = graphMessages[graphMessages.length - 1];
          if (lastMsg?.createdDateTime) {
            nextCursor = lastMsg.createdDateTime;
          }
        } else {
          // Backward: use the oldest message's timestamp (first in returned array)
          const oldestMsg = graphMessages[0];
          if (oldestMsg?.createdDateTime) {
            nextCursor = oldestMsg.createdDateTime;
          }
        }
      }

      return { messages, nextCursor };
    } catch (error) {
      this.logger.error("Teams Graph API: fetchMessages error", { error });

      // Check if it's a permission error
      if (error instanceof Error && error.message?.includes("403")) {
        throw new NotImplementedError(
          "Teams fetchMessages requires one of these Azure AD app permissions: ChatMessage.Read.Chat, Chat.Read.All, or Chat.Read.WhereInstalled",
          "fetchMessages",
        );
      }

      throw error;
    }
  }

  /**
   * Fetch messages from a Teams channel thread using the channel-specific Graph API endpoint.
   * This provides proper thread-level filtering by fetching only replies to a specific message.
   *
   * Endpoint: GET /teams/{team-id}/channels/{channel-id}/messages/{message-id}/replies
   */
  private async fetchChannelThreadMessages(
    context: TeamsChannelContext,
    threadMessageId: string,
    threadId: string,
    options: FetchOptions,
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

    // Build the endpoint URLs:
    // Parent message: /teams/{team-id}/channels/{channel-id}/messages/{message-id}
    // Replies: /teams/{team-id}/channels/{channel-id}/messages/{message-id}/replies
    const parentUrl = `/teams/${encodeURIComponent(context.teamId)}/channels/${encodeURIComponent(context.channelId)}/messages/${encodeURIComponent(threadMessageId)}`;
    const repliesUrl = `${parentUrl}/replies`;

    const graphClient = this.graphClient;
    if (!graphClient) {
      throw new AuthenticationError("teams", "Graph client not initialized");
    }

    // Fetch the parent message (the original message that started the thread)
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

    if (direction === "forward") {
      // Forward direction: fetch all replies and paginate in chronological order (oldest first)
      // Graph API returns messages in descending order (newest first), so we must reverse
      const allReplies: GraphChatMessage[] = [];
      let nextLink: string | undefined;

      do {
        const request = nextLink
          ? graphClient.api(nextLink)
          : graphClient.api(repliesUrl).top(50);

        const response = await request.get();
        const pageMessages = (response.value || []) as GraphChatMessage[];
        allReplies.push(...pageMessages);
        nextLink = response["@odata.nextLink"];
      } while (nextLink);

      // Reverse replies to get chronological order (oldest first)
      allReplies.reverse();

      // Prepend parent message (it's the oldest - started the thread)
      const allMessages = parentMessage
        ? [parentMessage, ...allReplies]
        : allReplies;

      // Find starting position based on cursor
      let startIndex = 0;
      if (cursor) {
        startIndex = allMessages.findIndex(
          (msg) => msg.createdDateTime && msg.createdDateTime > cursor,
        );
        if (startIndex === -1) startIndex = allMessages.length;
      }

      hasMoreMessages = startIndex + limit < allMessages.length;
      graphMessages = allMessages.slice(startIndex, startIndex + limit);
    } else {
      // Backward direction: return most recent messages in chronological order
      // Graph API returns messages in descending order (newest first)
      const allReplies: GraphChatMessage[] = [];
      let nextLink: string | undefined;

      do {
        const request = nextLink
          ? graphClient.api(nextLink)
          : graphClient.api(repliesUrl).top(50);

        const response = await request.get();
        const pageMessages = (response.value || []) as GraphChatMessage[];
        allReplies.push(...pageMessages);
        nextLink = response["@odata.nextLink"];
      } while (nextLink);

      // Reverse replies to get chronological order (oldest first)
      allReplies.reverse();

      // Prepend parent message (it's the oldest - started the thread)
      const allMessages = parentMessage
        ? [parentMessage, ...allReplies]
        : allReplies;

      if (cursor) {
        // Find position of cursor (cursor is timestamp of the oldest message in previous batch)
        // We want messages OLDER than cursor (earlier in chronological order)
        const cursorIndex = allMessages.findIndex(
          (msg) => msg.createdDateTime && msg.createdDateTime >= cursor,
        );
        if (cursorIndex > 0) {
          // Take messages before the cursor position
          const sliceStart = Math.max(0, cursorIndex - limit);
          graphMessages = allMessages.slice(sliceStart, cursorIndex);
          hasMoreMessages = sliceStart > 0;
        } else {
          // Cursor not found or at start - take the most recent (end of array)
          graphMessages = allMessages.slice(-limit);
          hasMoreMessages = allMessages.length > limit;
        }
      } else {
        // No cursor - get the most recent messages (end of chronological array)
        graphMessages = allMessages.slice(-limit);
        hasMoreMessages = allMessages.length > limit;
      }
    }

    this.logger.debug("Teams Graph API: fetched channel thread messages", {
      count: graphMessages.length,
      direction,
      hasMoreMessages,
    });

    const messages = graphMessages.map((msg: GraphChatMessage) => {
      const isFromBot =
        msg.from?.application?.id === this.config.appId ||
        msg.from?.user?.id === this.config.appId;

      return new Message({
        id: msg.id,
        threadId,
        text: this.extractTextFromGraphMessage(msg),
        formatted: this.formatConverter.toAst(
          this.extractTextFromGraphMessage(msg),
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
    });

    // Determine nextCursor
    let nextCursor: string | undefined;
    if (hasMoreMessages && graphMessages.length > 0) {
      if (direction === "forward") {
        const lastMsg = graphMessages[graphMessages.length - 1];
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

  /**
   * Extract plain text from a Graph API message.
   */
  private extractTextFromGraphMessage(msg: GraphChatMessage): string {
    // body.content contains the message text (HTML or text depending on contentType)
    if (msg.body?.contentType === "text") {
      return msg.body.content || "";
    }

    // For HTML content, strip tags (basic implementation)
    let text = "";
    if (msg.body?.content) {
      text = msg.body.content.replace(/<[^>]*>/g, "").trim();
    }

    // If text is empty but message has adaptive card attachments, try to extract card title
    if (!text && msg.attachments?.length) {
      for (const att of msg.attachments) {
        if (att.contentType === "application/vnd.microsoft.card.adaptive") {
          try {
            const card = JSON.parse(att.content || "{}");
            // Look for title in common locations
            const title = this.extractCardTitle(card);
            if (title) {
              return title;
            }
            return "[Card]";
          } catch {
            return "[Card]";
          }
        }
      }
    }

    return text;
  }

  /**
   * Extract a title/summary from an Adaptive Card structure.
   */
  private extractCardTitle(card: unknown): string | null {
    if (!card || typeof card !== "object") return null;

    const cardObj = card as Record<string, unknown>;

    // Check for body array and find first TextBlock with large/bolder style (likely title)
    if (Array.isArray(cardObj.body)) {
      for (const element of cardObj.body) {
        if (
          element &&
          typeof element === "object" &&
          (element as Record<string, unknown>).type === "TextBlock"
        ) {
          const textBlock = element as Record<string, unknown>;
          // Title blocks often have weight: "bolder" or size: "large"
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
      // Fallback: just get first TextBlock's text
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

  /**
   * Extract attachments from a Graph API message.
   */
  private extractAttachmentsFromGraphMessage(
    msg: GraphChatMessage,
  ): Attachment[] {
    if (!msg.attachments?.length) {
      return [];
    }

    return msg.attachments.map((att) => ({
      type: att.contentType?.includes("image") ? "image" : "file",
      name: att.name || undefined,
      url: att.contentUrl || undefined,
      mimeType: att.contentType || undefined,
    }));
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { conversationId } = this.decodeThreadId(threadId);

    return {
      id: threadId,
      channelId: conversationId,
      metadata: {},
    };
  }

  /**
   * Derive channel ID from a Teams thread ID.
   * Teams conversation IDs may include ";messageid=XXX" for threading.
   * Strip the messageid part to get the base channel/conversation.
   */
  channelIdFromThreadId(threadId: string): string {
    const { conversationId, serviceUrl } = this.decodeThreadId(threadId);
    // Strip ;messageid=XXX from conversation ID
    const baseConversationId = conversationId.replace(/;messageid=\d+/, "");
    return this.encodeThreadId({
      conversationId: baseConversationId,
      serviceUrl,
    });
  }

  /**
   * Fetch channel-level messages (all messages in the conversation, not filtered by thread).
   * Uses the Graph API for chat messages.
   */
  async fetchChannelMessages(
    channelId: string,
    options: FetchOptions = {},
  ): Promise<FetchResult<unknown>> {
    if (!this.graphClient) {
      throw new NotImplementedError(
        "Teams fetchChannelMessages requires appTenantId for Microsoft Graph API access.",
        "fetchChannelMessages",
      );
    }

    const { conversationId } = this.decodeThreadId(channelId);
    const baseConversationId = conversationId.replace(/;messageid=\d+/, "");
    const limit = options.limit || 50;
    const direction = options.direction ?? "backward";

    try {
      // Check if we have channel context (team channel vs group chat)
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
        // Team channel: use /teams/{teamId}/channels/{channelId}/messages
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
            const cursor = options.cursor;
            startIndex = allMessages.findIndex(
              (msg) => msg.createdDateTime && msg.createdDateTime > cursor,
            );
            if (startIndex === -1) startIndex = allMessages.length;
          }
          hasMoreMessages = startIndex + limit < allMessages.length;
          graphMessages = allMessages.slice(startIndex, startIndex + limit);
        } else {
          const request = this.graphClient.api(apiUrl).top(limit);
          const response = await request.get();
          graphMessages = (response.value || []) as GraphChatMessage[];
          graphMessages.reverse();
          hasMoreMessages = graphMessages.length >= limit;
        }
      } else {
        // Group chat / 1:1: use /chats/{chatId}/messages
        const apiUrl = `/chats/${encodeURIComponent(baseConversationId)}/messages`;

        if (direction === "forward") {
          const allMessages: GraphChatMessage[] = [];
          let nextLink: string | undefined;
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
            const cursor = options.cursor;
            startIndex = allMessages.findIndex(
              (msg) => msg.createdDateTime && msg.createdDateTime > cursor,
            );
            if (startIndex === -1) startIndex = allMessages.length;
          }
          hasMoreMessages = startIndex + limit < allMessages.length;
          graphMessages = allMessages.slice(startIndex, startIndex + limit);
        } else {
          let request = this.graphClient
            .api(apiUrl)
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
      }

      const messages = graphMessages.map((msg) => {
        const isFromBot =
          msg.from?.application?.id === this.config.appId ||
          msg.from?.user?.id === this.config.appId;
        return new Message({
          id: msg.id,
          threadId: channelId,
          text: this.extractTextFromGraphMessage(msg),
          formatted: this.formatConverter.toAst(
            this.extractTextFromGraphMessage(msg),
          ),
          raw: msg,
          author: {
            userId:
              msg.from?.user?.id || msg.from?.application?.id || "unknown",
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
      });

      let nextCursor: string | undefined;
      if (hasMoreMessages && graphMessages.length > 0) {
        if (direction === "forward") {
          const lastMsg = graphMessages[graphMessages.length - 1];
          if (lastMsg?.createdDateTime) nextCursor = lastMsg.createdDateTime;
        } else {
          const oldestMsg = graphMessages[0];
          if (oldestMsg?.createdDateTime)
            nextCursor = oldestMsg.createdDateTime;
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

  /**
   * List threads in a Teams channel.
   * For team channels, fetches messages and filters for those with replies.
   * For group chats, threads are based on message IDs in conversation references.
   */
  async listThreads(
    channelId: string,
    options: ListThreadsOptions = {},
  ): Promise<ListThreadsResult<unknown>> {
    if (!this.graphClient) {
      throw new NotImplementedError(
        "Teams listThreads requires appTenantId for Microsoft Graph API access.",
        "listThreads",
      );
    }

    const { conversationId, serviceUrl } = this.decodeThreadId(channelId);
    const baseConversationId = conversationId.replace(/;messageid=\d+/, "");
    const limit = options.limit || 50;

    try {
      // Check for channel context
      let channelContext: TeamsChannelContext | null = null;
      if (this.chat) {
        const cachedContext = await this.chat
          .getState()
          .get<string>(`teams:channelContext:${baseConversationId}`);
        if (cachedContext) {
          try {
            channelContext = JSON.parse(cachedContext) as TeamsChannelContext;
          } catch {
            // Ignore
          }
        }
      }

      this.logger.debug("Teams Graph API: listThreads", {
        conversationId: baseConversationId,
        hasChannelContext: !!channelContext,
        limit,
      });

      const threads: ThreadSummary[] = [];

      if (channelContext) {
        // Team channel: fetch messages and find those with replies
        const apiUrl = `/teams/${encodeURIComponent(channelContext.teamId)}/channels/${encodeURIComponent(channelContext.channelId)}/messages`;
        const response = await this.graphClient.api(apiUrl).top(limit).get();
        const messages = (response.value || []) as (GraphChatMessage & {
          replies?: GraphChatMessage[];
        })[];

        for (const msg of messages) {
          if (!msg.id) continue;
          const threadId = this.encodeThreadId({
            conversationId: `${baseConversationId};messageid=${msg.id}`,
            serviceUrl,
          });

          const isFromBot =
            msg.from?.application?.id === this.config.appId ||
            msg.from?.user?.id === this.config.appId;

          threads.push({
            id: threadId,
            rootMessage: new Message({
              id: msg.id,
              threadId,
              text: this.extractTextFromGraphMessage(msg),
              formatted: this.formatConverter.toAst(
                this.extractTextFromGraphMessage(msg),
              ),
              raw: msg,
              author: {
                userId:
                  msg.from?.user?.id || msg.from?.application?.id || "unknown",
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
            }),
            lastReplyAt: msg.lastModifiedDateTime
              ? new Date(msg.lastModifiedDateTime)
              : undefined,
          });
        }
      } else {
        // Group chat: list recent messages as "threads"
        const apiUrl = `/chats/${encodeURIComponent(baseConversationId)}/messages`;
        const response = await this.graphClient
          .api(apiUrl)
          .top(limit)
          .orderby("createdDateTime desc")
          .get();

        const messages = (response.value || []) as GraphChatMessage[];

        for (const msg of messages) {
          if (!msg.id) continue;
          const threadId = this.encodeThreadId({
            conversationId: `${baseConversationId};messageid=${msg.id}`,
            serviceUrl,
          });

          const isFromBot =
            msg.from?.application?.id === this.config.appId ||
            msg.from?.user?.id === this.config.appId;

          threads.push({
            id: threadId,
            rootMessage: new Message({
              id: msg.id,
              threadId,
              text: this.extractTextFromGraphMessage(msg),
              formatted: this.formatConverter.toAst(
                this.extractTextFromGraphMessage(msg),
              ),
              raw: msg,
              author: {
                userId:
                  msg.from?.user?.id || msg.from?.application?.id || "unknown",
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
            }),
          });
        }
      }

      this.logger.debug("Teams Graph API: listThreads result", {
        threadCount: threads.length,
      });

      return { threads };
    } catch (error) {
      this.logger.error("Teams Graph API: listThreads error", { error });
      throw error;
    }
  }

  /**
   * Fetch Teams channel/conversation info.
   */
  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const { conversationId } = this.decodeThreadId(channelId);
    const baseConversationId = conversationId.replace(/;messageid=\d+/, "");

    // Check for channel context
    let channelContext: TeamsChannelContext | null = null;
    if (this.chat) {
      const cachedContext = await this.chat
        .getState()
        .get<string>(`teams:channelContext:${baseConversationId}`);
      if (cachedContext) {
        try {
          channelContext = JSON.parse(cachedContext) as TeamsChannelContext;
        } catch {
          // Ignore
        }
      }
    }

    if (channelContext && this.graphClient) {
      try {
        this.logger.debug("Teams Graph API: GET channel info", {
          teamId: channelContext.teamId,
          channelId: channelContext.channelId,
        });

        const response = await this.graphClient
          .api(
            `/teams/${encodeURIComponent(channelContext.teamId)}/channels/${encodeURIComponent(channelContext.channelId)}`,
          )
          .get();

        return {
          id: channelId,
          name: response.displayName,
          isDM: false,
          memberCount: response.memberCount,
          metadata: {
            membershipType: response.membershipType,
            description: response.description,
            raw: response,
          },
        };
      } catch (error) {
        this.logger.warn("Teams Graph API: channel info failed", { error });
      }
    }

    // Fallback for group chats or when Graph API is not available
    return {
      id: channelId,
      isDM: this.isDM(channelId),
      metadata: {
        conversationId: baseConversationId,
      },
    };
  }

  /**
   * Post a message to the channel top-level (not in a thread).
   * Uses a conversation reference without ;messageid= to post at the top level.
   */
  async postChannelMessage(
    channelId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<unknown>> {
    const { conversationId, serviceUrl } = this.decodeThreadId(channelId);
    // Ensure we use the base conversation ID (no messageid)
    const baseConversationId = conversationId.replace(/;messageid=\d+/, "");

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
    } else {
      const text = convertEmojiPlaceholders(
        this.formatConverter.renderPostable(message),
        "teams",
      );
      activity = {
        type: ActivityTypes.Message,
        text,
        textFormat: "markdown",
        attachments: fileAttachments.length > 0 ? fileAttachments : undefined,
      };
    }

    const conversationReference = {
      channelId: "msteams",
      serviceUrl,
      conversation: { id: baseConversationId },
    };

    let messageId = "";

    try {
      await this.botAdapter.continueConversationAsync(
        this.config.appId,
        conversationReference as Partial<ConversationReference>,
        async (context) => {
          const response = await context.sendActivity(activity);
          messageId = response?.id || "";
        },
      );
    } catch (error) {
      this.logger.error("Teams API: postChannelMessage failed", {
        conversationId: baseConversationId,
        error,
      });
      this.handleTeamsError(error, "postChannelMessage");
    }

    this.logger.debug("Teams API: postChannelMessage response", { messageId });

    return {
      id: messageId,
      threadId: channelId,
      raw: activity,
    };
  }

  encodeThreadId(platformData: TeamsThreadId): string {
    // Base64 encode both since conversationId and serviceUrl can contain special characters
    const encodedConversationId = Buffer.from(
      platformData.conversationId,
    ).toString("base64url");
    const encodedServiceUrl = Buffer.from(platformData.serviceUrl).toString(
      "base64url",
    );
    return `teams:${encodedConversationId}:${encodedServiceUrl}`;
  }

  /**
   * Check if a thread is a direct message conversation.
   * Teams DMs have conversation IDs that don't start with "19:" (which is for groups/channels).
   */
  isDM(threadId: string): boolean {
    const { conversationId } = this.decodeThreadId(threadId);
    // Group chats and channels start with "19:", DMs don't
    return !conversationId.startsWith("19:");
  }

  decodeThreadId(threadId: string): TeamsThreadId {
    const parts = threadId.split(":");
    if (parts.length !== 3 || parts[0] !== "teams") {
      throw new ValidationError(
        "teams",
        `Invalid Teams thread ID: ${threadId}`,
      );
    }
    const conversationId = Buffer.from(
      parts[1] as string,
      "base64url",
    ).toString("utf-8");
    const serviceUrl = Buffer.from(parts[2] as string, "base64url").toString(
      "utf-8",
    );
    return { conversationId, serviceUrl };
  }

  parseMessage(raw: unknown): Message<unknown> {
    const activity = raw as Activity;
    const threadId = this.encodeThreadId({
      conversationId: activity.conversation?.id || "",
      serviceUrl: activity.serviceUrl || "",
    });
    return this.parseTeamsMessage(activity, threadId);
  }

  /**
   * Check if a Teams activity is from this bot.
   *
   * Teams bot IDs can appear in different formats:
   * - Just the app ID: "abc123-def456-..."
   * - With prefix: "28:abc123-def456-..."
   *
   * We check both exact match and suffix match (after colon delimiter)
   * to handle all formats safely.
   */
  private isMessageFromSelf(activity: Activity): boolean {
    const fromId = activity.from?.id;
    if (!fromId || !this.config.appId) {
      return false;
    }

    // Exact match (bot ID is just the app ID)
    if (fromId === this.config.appId) {
      return true;
    }

    // Teams format: "28:{appId}" or similar prefix patterns
    // Check if it ends with our appId after a colon delimiter
    if (fromId.endsWith(`:${this.config.appId}`)) {
      return true;
    }

    return false;
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  /**
   * Convert Teams/BotBuilder errors to standardized AdapterError types.
   */
  private handleTeamsError(error: unknown, operation: string): never {
    // Handle BotBuilder errors with status codes
    if (error && typeof error === "object") {
      const err = error as Record<string, unknown>;

      // Check for HTTP status code
      const statusCode =
        (err.statusCode as number) ||
        (err.status as number) ||
        (err.code as number);

      if (statusCode === 401 || statusCode === 403) {
        throw new AuthenticationError(
          "teams",
          `Authentication failed for ${operation}: ${err.message || "unauthorized"}`,
        );
      }

      if (statusCode === 404) {
        throw new NetworkError(
          "teams",
          `Resource not found during ${operation}: conversation or message may no longer exist`,
          error instanceof Error ? error : undefined,
        );
      }

      if (statusCode === 429) {
        const retryAfter =
          typeof err.retryAfter === "number" ? err.retryAfter : undefined;
        throw new AdapterRateLimitError("teams", retryAfter);
      }

      // Permission errors
      if (
        statusCode === 403 ||
        (err.message &&
          typeof err.message === "string" &&
          err.message.toLowerCase().includes("permission"))
      ) {
        throw new PermissionError("teams", operation);
      }

      // Generic error with message
      if (err.message && typeof err.message === "string") {
        throw new NetworkError(
          "teams",
          `Teams API error during ${operation}: ${err.message}`,
          error instanceof Error ? error : undefined,
        );
      }
    }

    // Fallback for unknown error types
    throw new NetworkError(
      "teams",
      `Teams API error during ${operation}: ${String(error)}`,
      error instanceof Error ? error : undefined,
    );
  }
}

export function createTeamsAdapter(config: TeamsAdapterConfig): TeamsAdapter {
  return new TeamsAdapter(config);
}

// Re-export card converter for advanced use
export { cardToAdaptiveCard, cardToFallbackText } from "./cards";
export { TeamsFormatConverter } from "./markdown";
