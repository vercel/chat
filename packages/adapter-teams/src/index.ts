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
  Activity,
  IAdaptiveCardActionInvokeActivity,
  IMessageActivity,
  IMessageReactionActivity,
  MessageReactionType,
} from "@microsoft/teams.api";
import { MessageActivity, TypingActivity } from "@microsoft/teams.api";
import type {
  AppOptions,
  IActivityContext,
  IHttpServerRequest,
  IPlugin,
} from "@microsoft/teams.apps";
import { App } from "@microsoft/teams.apps";
import { chats, teams } from "@microsoft/teams.graph-endpoints";
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
  StreamChunk,
  StreamOptions,
  ThreadInfo,
  ThreadSummary,
  WebhookOptions,
} from "chat";
import {
  ConsoleLogger,
  convertEmojiPlaceholders,
  defaultEmojiResolver,
  Message,
  NotImplementedError,
} from "chat";
import { BridgeHttpAdapter } from "./bridge-adapter";
import { cardToAdaptiveCard } from "./cards";
import { TeamsFormatConverter } from "./markdown";

const MESSAGEID_CAPTURE_PATTERN = /messageid=(\d+)/;
const MESSAGEID_STRIP_PATTERN = /;messageid=\d+/;
const SEMICOLON_MESSAGEID_CAPTURE_PATTERN = /;messageid=(\d+)/;

/**
 * Graph API chat message — uses the shape returned by @microsoft/teams.graph-endpoints.
 * Nullable fields are accessed via `??` / `||` at usage sites.
 */
/** Infer the chat message type from the graph-endpoints list response */
type ChatMessageListResponse = Awaited<
  ReturnType<typeof App.prototype.graph.call<typeof chats.messages.list>>
>;
type GraphMessage = NonNullable<ChatMessageListResponse["value"]>[number];

export type TeamsAdapterConfig = Pick<
  AppOptions<IPlugin>,
  | "clientId"
  | "clientSecret"
  | "tenantId"
  | "token"
  | "managedIdentityClientId"
  | "serviceUrl"
> & {
  /** Logger instance for error reporting. Defaults to ConsoleLogger. */
  logger?: Logger;
  /** Override bot username (optional) */
  userName?: string;
};

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

export class TeamsAdapter implements Adapter<TeamsThreadId, unknown> {
  readonly name = "teams";
  readonly userName: string;
  readonly botUserId?: string;

  private readonly app: App;
  private readonly bridgeAdapter: BridgeHttpAdapter;
  private chat: ChatInstance | null = null;
  private readonly logger: Logger;
  private readonly formatConverter = new TeamsFormatConverter();
  private readonly config: TeamsAdapterConfig;

  /** Request-scoped webhook options for passing waitUntil to handlers */
  private currentWebhookOptions: WebhookOptions | undefined;

  constructor(config: TeamsAdapterConfig = {}) {
    this.config = config;
    this.logger = config.logger ?? new ConsoleLogger("info").child("teams");
    this.userName = config.userName || "bot";

    // Create the BridgeHttpAdapter for serverless dispatch
    this.bridgeAdapter = new BridgeHttpAdapter();

    // Pass config through to App — it resolves CLIENT_ID, CLIENT_SECRET, TENANT_ID from env
    const { logger: _logger, userName: _userName, ...appConfig } = config;
    this.app = new App({
      ...appConfig,
      httpServerAdapter: this.bridgeAdapter,
    });
  }

  /**
   * Register TeamsSDK event handlers.
   * Called from initialize() after this.chat is set.
   */
  private registerEventHandlers(): void {
    this.app.on("message", async (ctx) => {
      this.cacheUserContext(ctx.activity);
      await this.handleMessageActivity(ctx);
    });

    this.app.on("messageReaction", async (ctx) => {
      this.cacheUserContext(ctx.activity);
      this.handleReactionFromContext(ctx);
    });

    this.app.on("card.action", async (ctx) => {
      this.cacheUserContext(ctx.activity);
      await this.handleAdaptiveCardAction(ctx);
      return {
        statusCode: 200,
        type: "application/vnd.microsoft.activity.message",
        value: "",
      };
    });

    this.app.on("conversationUpdate", async (ctx) => {
      this.cacheUserContext(ctx.activity);
    });

    this.app.on("installationUpdate", async (ctx) => {
      this.cacheUserContext(ctx.activity);
    });
  }

  /**
   * Cache serviceUrl, tenantId, and channel context from activity metadata.
   * Called inline from each event handler (not middleware).
   */
  private cacheUserContext(activity: Activity): void {
    if (!(this.chat && activity.from?.id)) {
      return;
    }

    const userId = activity.from.id;
    const ttl = 30 * 24 * 60 * 60 * 1000; // 30 days

    // Cache serviceUrl for DM creation
    if (activity.serviceUrl) {
      this.chat
        .getState()
        .set(`teams:serviceUrl:${userId}`, activity.serviceUrl, ttl)
        .catch(() => {});
    }

    const channelData = activity.channelData as
      | {
          tenant?: { id?: string };
          team?: { id?: string; aadGroupId?: string };
          channel?: { id?: string };
        }
      | undefined;
    const tenantId = channelData?.tenant?.id;

    if (tenantId) {
      this.chat
        .getState()
        .set(`teams:tenantId:${userId}`, tenantId, ttl)
        .catch(() => {});
    }

    // Cache channel context for Graph API message fetching
    const teamAadGroupId = channelData?.team?.aadGroupId;
    const conversationId = activity.conversation?.id || "";
    const baseChannelId = conversationId.replace(MESSAGEID_STRIP_PATTERN, "");

    if (teamAadGroupId && channelData?.channel?.id && tenantId) {
      const context: TeamsChannelContext = {
        teamId: teamAadGroupId,
        channelId: channelData.channel.id,
        tenantId,
      };
      this.chat
        .getState()
        .set(
          `teams:channelContext:${baseChannelId}`,
          JSON.stringify(context),
          ttl
        )
        .catch(() => {});
    }
  }

  /**
   * Handle message activities (normal messages + Action.Submit button clicks).
   */
  private async handleMessageActivity(
    ctx: IActivityContext<IMessageActivity>
  ): Promise<void> {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring event");
      return;
    }

    const activity = ctx.activity;

    // Check if this message activity is actually a button click (Action.Submit)
    const actionValue = activity.value as
      | { actionId?: string; value?: string }
      | undefined;
    if (actionValue?.actionId) {
      this.handleMessageAction(activity, actionValue);
      return;
    }

    const threadId = this.encodeThreadId({
      conversationId: activity.conversation?.id || "",
      serviceUrl: activity.serviceUrl || "",
      replyToId: activity.replyToId,
    });

    const message = this.parseTeamsMessage(activity, threadId);

    // Detect @mention by checking if any mentioned entity matches our app ID
    const entities = activity.entities || [];
    const isMention = entities.some(
      (e: { type?: string; mentioned?: { id?: string } }) =>
        e.type === "mention" &&
        e.mentioned?.id &&
        (e.mentioned.id === this.app.id ||
          e.mentioned.id.endsWith(`:${this.app.id}`))
    );
    if (isMention) {
      message.isMention = true;
    }

    this.chat.processMessage(
      this,
      threadId,
      message,
      this.currentWebhookOptions
    );
  }

  /**
   * Handle Action.Submit button clicks sent as message activities.
   */
  private handleMessageAction(
    activity: Activity,
    actionValue: { actionId?: string; value?: string }
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

    this.logger.debug("Processing Teams message action (Action.Submit)", {
      actionId: actionValue.actionId,
      value: actionValue.value,
      messageId: actionEvent.messageId,
      threadId,
    });

    this.chat.processAction(actionEvent, this.currentWebhookOptions);
  }

  /**
   * Handle adaptive card button clicks (invoke-based).
   */
  private async handleAdaptiveCardAction(
    ctx: IActivityContext<IAdaptiveCardActionInvokeActivity>
  ): Promise<void> {
    if (!this.chat) {
      return;
    }

    const activity = ctx.activity;
    const actionData = activity.value.action.data as {
      actionId?: string;
      value?: string;
    };

    if (!actionData.actionId) {
      this.logger.debug("Adaptive card action missing actionId", {
        value: activity.value,
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

    this.chat.processAction(actionEvent, this.currentWebhookOptions);
  }

  /**
   * Handle Teams reaction events.
   */
  private handleReactionFromContext(
    ctx: IActivityContext<IMessageReactionActivity>
  ): void {
    if (!this.chat) {
      return;
    }

    const activity = ctx.activity;
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
      fullName: activity.from?.name,
      isBot: false,
      isMe: this.isMessageFromSelf(activity),
    };

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

      this.chat.processReaction(
        { ...event, adapter: this },
        this.currentWebhookOptions
      );
    }

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

      this.chat.processReaction(
        { ...event, adapter: this },
        this.currentWebhookOptions
      );
    }
  }

  private parseTeamsMessage(
    activity: Activity,
    threadId: string
  ): Message<unknown> {
    const text = (activity as MessageActivity).text || "";
    const normalizedText = this.normalizeMentions(text);

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
        isBot: false, // TeamsSDK doesn't expose role directly; we check isMe instead
        isMe,
      },
      metadata: {
        dateSent: activity.timestamp
          ? new Date(activity.timestamp)
          : new Date(),
        edited: false,
      },
      attachments: ((activity as MessageActivity).attachments || [])
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
            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
          }
        : undefined,
    };
  }

  private normalizeMentions(text: string): string {
    return text.trim();
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.registerEventHandlers();
    await this.app.initialize();
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    const body = await request.text();
    this.logger.debug("Teams webhook raw body", { body });

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(body);
    } catch (e) {
      this.logger.error("Failed to parse request body", { error: e });
      return new Response("Invalid JSON", { status: 400 });
    }

    // Build IHttpServerRequest for the bridge adapter
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const serverRequest: IHttpServerRequest = {
      body: parsedBody,
      headers,
    };

    // Store webhook options for handler access
    this.currentWebhookOptions = options;

    try {
      const serverResponse = await this.bridgeAdapter.dispatch(serverRequest);

      return new Response(
        serverResponse.body ? JSON.stringify(serverResponse.body) : "{}",
        {
          status: serverResponse.status,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      this.logger.error("Bridge adapter dispatch error", { error });
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    } finally {
      this.currentWebhookOptions = undefined;
    }
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<unknown>> {
    const { conversationId } = this.decodeThreadId(threadId);

    const files = extractFiles(message);
    const fileAttachments =
      files.length > 0 ? await this.filesToAttachments(files) : [];

    const card = extractCard(message);

    if (card) {
      const adaptiveCard = cardToAdaptiveCard(card);
      const activity = new MessageActivity();
      activity.attachments = [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: adaptiveCard,
        },
        ...fileAttachments,
      ];

      this.logger.debug("Teams API: send (adaptive card)", {
        conversationId,
        fileCount: fileAttachments.length,
      });

      try {
        const sent = await this.app.send(conversationId, activity);

        return {
          id: sent.id || "",
          threadId,
          raw: activity,
        };
      } catch (error) {
        this.logger.error("Teams API: send failed", { conversationId, error });
        this.handleTeamsError(error, "postMessage");
      }
    }

    // Regular text message
    const text = convertEmojiPlaceholders(
      this.formatConverter.renderPostable(message),
      "teams"
    );

    const activity = new MessageActivity(text);
    activity.textFormat = "markdown";
    if (fileAttachments.length > 0) {
      activity.attachments = fileAttachments;
    }

    this.logger.debug("Teams API: send (message)", {
      conversationId,
      textLength: text.length,
      fileCount: fileAttachments.length,
    });

    try {
      const sent = await this.app.send(conversationId, activity);

      this.logger.debug("Teams API: send response", { messageId: sent.id });

      return {
        id: sent.id || "",
        threadId,
        raw: activity,
      };
    } catch (error) {
      this.logger.error("Teams API: send failed", { conversationId, error });
      this.handleTeamsError(error, "postMessage");
    }
  }

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

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<unknown>> {
    const { conversationId } = this.decodeThreadId(threadId);

    const card = extractCard(message);

    if (card) {
      const adaptiveCard = cardToAdaptiveCard(card);
      const activity = new MessageActivity();
      activity.attachments = [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: adaptiveCard,
        },
      ];

      this.logger.debug("Teams API: updateActivity (adaptive card)", {
        conversationId,
        messageId,
      });

      try {
        await this.app.api.conversations
          .activities(conversationId)
          .update(messageId, activity);
      } catch (error) {
        this.logger.error("Teams API: updateActivity failed", {
          conversationId,
          messageId,
          error,
        });
        this.handleTeamsError(error, "editMessage");
      }

      return { id: messageId, threadId, raw: activity };
    }

    const text = convertEmojiPlaceholders(
      this.formatConverter.renderPostable(message),
      "teams"
    );

    const activity = new MessageActivity(text);
    activity.textFormat = "markdown";

    this.logger.debug("Teams API: updateActivity", {
      conversationId,
      messageId,
      textLength: text.length,
    });

    try {
      await this.app.api.conversations
        .activities(conversationId)
        .update(messageId, activity);
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

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const { conversationId } = this.decodeThreadId(threadId);

    this.logger.debug("Teams API: deleteActivity", {
      conversationId,
      messageId,
    });

    try {
      await this.app.api.conversations
        .activities(conversationId)
        .delete(messageId);
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
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const { conversationId } = this.decodeThreadId(threadId);
    const reactionType = typeof emoji === "string" ? emoji : emoji.name;

    this.logger.debug("Teams API: addReaction", {
      conversationId,
      messageId,
      reactionType,
    });

    try {
      await this.app.api.reactions.add(
        conversationId,
        messageId,
        reactionType as MessageReactionType
      );
    } catch (error) {
      this.logger.error("Teams API: addReaction failed", {
        conversationId,
        messageId,
        error,
      });
      this.handleTeamsError(error, "addReaction");
    }
  }

  async removeReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const { conversationId } = this.decodeThreadId(threadId);
    const reactionType = typeof emoji === "string" ? emoji : emoji.name;

    this.logger.debug("Teams API: removeReaction", {
      conversationId,
      messageId,
      reactionType,
    });

    try {
      await this.app.api.reactions.remove(
        conversationId,
        messageId,
        reactionType as MessageReactionType
      );
    } catch (error) {
      this.logger.error("Teams API: removeReaction failed", {
        conversationId,
        messageId,
        error,
      });
      this.handleTeamsError(error, "removeReaction");
    }
  }

  async startTyping(threadId: string, _status?: string): Promise<void> {
    const { conversationId } = this.decodeThreadId(threadId);

    this.logger.debug("Teams API: send (typing)", { conversationId });

    try {
      await this.app.send(conversationId, new TypingActivity());
    } catch (error) {
      this.logger.error("Teams API: send (typing) failed", {
        conversationId,
        error,
      });
      this.handleTeamsError(error, "startTyping");
    }

    this.logger.debug("Teams API: send (typing) response", { ok: true });
  }

  /**
   * Stream responses via post+edit.
   * TODO: Use native HttpStream for DMs once @microsoft/teams.apps exports it.
   */
  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    _options?: StreamOptions
  ): Promise<RawMessage<unknown>> {
    const { conversationId } = this.decodeThreadId(threadId);
    let accumulated = "";
    let messageId: string | undefined;

    for await (const chunk of textStream) {
      let text = "";
      if (typeof chunk === "string") {
        text = chunk;
      } else if (chunk.type === "markdown_text") {
        text = chunk.text;
      }
      if (!text) {
        continue;
      }

      accumulated += text;

      if (messageId) {
        const activity = new MessageActivity(accumulated);
        activity.textFormat = "markdown";
        await this.app.api.conversations
          .activities(conversationId)
          .update(messageId, activity);
      } else {
        const activity = new MessageActivity(accumulated);
        activity.textFormat = "markdown";
        const res = await this.app.send(conversationId, activity);
        messageId = res.id ?? "";
      }
    }

    return { id: messageId ?? "", threadId, raw: { text: accumulated } };
  }

  async openDM(userId: string): Promise<string> {
    // Look up cached serviceUrl and tenantId for this user from state
    const cachedServiceUrl = await this.chat
      ?.getState()
      .get<string>(`teams:serviceUrl:${userId}`);
    const cachedTenantId = await this.chat
      ?.getState()
      .get<string>(`teams:tenantId:${userId}`);

    const serviceUrl =
      cachedServiceUrl ||
      this.app.api.serviceUrl ||
      "https://smba.trafficmanager.net/teams/";
    const tenantId = cachedTenantId || this.config.tenantId;

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

    try {
      const result = await this.app.api.conversations.create({
        isGroup: false,
        bot: { id: this.app.id, name: this.userName },
        // Account requires role/name but Teams API only needs id for DM members
        members: [{ id: userId, name: "", role: "user" }],
        tenantId,
        channelData: {
          tenant: { id: tenantId },
        },
      });

      const conversationId = result?.id;
      if (!conversationId) {
        throw new NetworkError(
          "teams",
          "Failed to create 1:1 conversation - no ID returned"
        );
      }

      this.logger.debug("Teams: 1:1 conversation created", { conversationId });

      return this.encodeThreadId({
        conversationId,
        serviceUrl,
      });
    } catch (error) {
      if (error instanceof ValidationError || error instanceof NetworkError) {
        throw error;
      }
      this.logger.error("Teams: openDM failed", { userId, error });
      this.handleTeamsError(error, "openDM");
    }
  }

  /**
   * Make a Graph API GET request using the app's Graph client.
   * Returns the typed response from the Graph API endpoint.
   */
  /**
   * Fetch all replies for a channel message, following pagination.
   */
  private async fetchAllChannelReplies(params: {
    "team-id": string;
    "channel-id": string;
    "chatMessage-id": string;
  }): Promise<GraphMessage[]> {
    const allReplies: GraphMessage[] = [];

    const firstPage = await this.app.graph.call(
      teams.channels.messages.replies.list,
      { ...params, $top: 50 }
    );
    allReplies.push(...(firstPage.value || []));

    let nextLink = firstPage["@odata.nextLink"] ?? undefined;
    while (nextLink) {
      const page = await this.graphGetNextLink<typeof firstPage>(nextLink);
      allReplies.push(...(page.value || []));
      nextLink = page["@odata.nextLink"] ?? undefined;
    }

    return allReplies;
  }

  /**
   * Follow a Graph API @odata.nextLink URL for pagination.
   * Uses the graph client's HTTP client directly to avoid URL re-encoding issues.
   */
  private async graphGetNextLink<T>(nextLinkUrl: string): Promise<T> {
    // @ts-expect-error — accessing protected `http` on GraphClient for raw nextLink pagination
    const res = await this.app.graph.http.get<T>(nextLinkUrl);
    return res.data;
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<unknown>> {
    if (!this.config.tenantId) {
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

      let graphMessages: GraphMessage[];
      let hasMoreMessages = false;

      if (direction === "forward") {
        const allMessages: GraphMessage[] = [];

        const firstPage = await this.app.graph.call(chats.messages.list, {
          "chat-id": baseConversationId,
          $top: 50,
          $orderby: ["createdDateTime desc"],
        });
        allMessages.push(...(firstPage.value || []));

        let nextLink = firstPage["@odata.nextLink"] ?? undefined;
        while (nextLink) {
          const page = await this.graphGetNextLink<typeof firstPage>(nextLink);
          allMessages.push(...(page.value || []));
          nextLink = page["@odata.nextLink"] ?? undefined;
        }

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
        const response = await this.app.graph.call(chats.messages.list, {
          "chat-id": baseConversationId,
          $top: limit,
          $orderby: ["createdDateTime desc"],
          $filter: cursor ? `createdDateTime lt ${cursor}` : undefined,
        });
        graphMessages = (response.value || []) as GraphMessage[];
        graphMessages.reverse();
        hasMoreMessages = graphMessages.length >= limit;
      }

      if (threadMessageId && !channelContext) {
        graphMessages = graphMessages.filter((msg) => {
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

      const messages = graphMessages
        .filter((msg) => msg.id)
        .map((msg) => {
          const isFromBot =
            msg.from?.application?.id === this.app.id ||
            msg.from?.user?.id === this.app.id;

          return new Message({
            id: msg.id as string,
            threadId,
            text: this.extractTextFromGraphMessage(msg),
            formatted: this.formatConverter.toAst(
              this.extractTextFromGraphMessage(msg)
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

    const channelMsgParams = {
      "team-id": context.teamId,
      "channel-id": context.channelId,
      "chatMessage-id": threadMessageId,
    };

    let parentMessage: GraphMessage | null = null;
    try {
      parentMessage = await this.app.graph.call(
        teams.channels.messages.get,
        channelMsgParams
      );
    } catch (err) {
      this.logger.warn("Failed to fetch parent message", {
        threadMessageId,
        err,
      });
    }

    let graphMessages: GraphMessage[];
    let hasMoreMessages = false;

    if (direction === "forward") {
      const allReplies = await this.fetchAllChannelReplies(channelMsgParams);
      allReplies.reverse();
      const allMessages = parentMessage
        ? [parentMessage, ...allReplies]
        : allReplies;

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
      const allReplies = await this.fetchAllChannelReplies(channelMsgParams);
      allReplies.reverse();
      const allMessages = parentMessage
        ? [parentMessage, ...allReplies]
        : allReplies;

      if (cursor) {
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
    }

    this.logger.debug("Teams Graph API: fetched channel thread messages", {
      count: graphMessages.length,
      direction,
      hasMoreMessages,
    });

    const messages = graphMessages
      .filter((msg) => msg.id)
      .map((msg) => {
        const isFromBot =
          msg.from?.application?.id === this.app.id ||
          msg.from?.user?.id === this.app.id;

        return new Message({
          id: msg.id as string,
          threadId,
          text: this.extractTextFromGraphMessage(msg),
          formatted: this.formatConverter.toAst(
            this.extractTextFromGraphMessage(msg)
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

  private extractTextFromGraphMessage(msg: GraphMessage): string {
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

  private extractAttachmentsFromGraphMessage(msg: GraphMessage): Attachment[] {
    if (!msg.attachments?.length) {
      return [];
    }

    return msg.attachments.map(
      (att: {
        contentType?: string | null;
        contentUrl?: string | null;
        name?: string | null;
      }) => ({
        type: att.contentType?.includes("image") ? "image" : "file",
        name: att.name ?? undefined,
        url: att.contentUrl ?? undefined,
        mimeType: att.contentType ?? undefined,
      })
    );
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { conversationId } = this.decodeThreadId(threadId);

    return {
      id: threadId,
      channelId: conversationId,
      metadata: {},
    };
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
    if (!this.config.tenantId) {
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
            // Ignore
          }
        }
      }

      this.logger.debug("Teams Graph API: fetchChannelMessages", {
        conversationId: baseConversationId,
        hasChannelContext: !!channelContext,
        limit,
        direction,
      });

      let graphMessages: GraphMessage[];
      let hasMoreMessages = false;

      if (channelContext) {
        const channelParams = {
          "team-id": channelContext.teamId,
          "channel-id": channelContext.channelId,
        };

        if (direction === "forward") {
          const allMessages: GraphMessage[] = [];
          const firstPage = await this.app.graph.call(
            teams.channels.messages.list,
            {
              ...channelParams,
              $top: 50,
            }
          );
          allMessages.push(...(firstPage.value || []));
          let nextLink = firstPage["@odata.nextLink"] ?? undefined;
          while (nextLink) {
            const page = await this.graphGetNextLink<{
              value: GraphMessage[];
              "@odata.nextLink"?: string;
            }>(nextLink);
            allMessages.push(...(page.value || []));
            nextLink = page["@odata.nextLink"] ?? undefined;
          }

          allMessages.reverse();
          let startIndex = 0;
          if (options.cursor) {
            const cursorVal = options.cursor;
            startIndex = allMessages.findIndex(
              (msg) => msg.createdDateTime && msg.createdDateTime > cursorVal
            );
            if (startIndex === -1) {
              startIndex = allMessages.length;
            }
          }
          hasMoreMessages = startIndex + limit < allMessages.length;
          graphMessages = allMessages.slice(startIndex, startIndex + limit);
        } else {
          const response = await this.app.graph.call(
            teams.channels.messages.list,
            {
              ...channelParams,
              $top: limit,
            }
          );
          graphMessages = (response.value || []) as GraphMessage[];
          graphMessages.reverse();
          hasMoreMessages = graphMessages.length >= limit;
        }
      } else if (direction === "forward") {
        const allMessages: GraphMessage[] = [];
        const firstPage = await this.app.graph.call(chats.messages.list, {
          "chat-id": baseConversationId,
          $top: 50,
          $orderby: ["createdDateTime desc"],
        });
        allMessages.push(...(firstPage.value || []));
        let nextLink = firstPage["@odata.nextLink"] ?? undefined;
        while (nextLink) {
          const page = await this.graphGetNextLink<{
            value: GraphMessage[];
            "@odata.nextLink"?: string;
          }>(nextLink);
          allMessages.push(...(page.value || []));
          nextLink = page["@odata.nextLink"] ?? undefined;
        }

        allMessages.reverse();
        let startIndex = 0;
        if (options.cursor) {
          const cursorVal = options.cursor;
          startIndex = allMessages.findIndex(
            (msg) => msg.createdDateTime && msg.createdDateTime > cursorVal
          );
          if (startIndex === -1) {
            startIndex = allMessages.length;
          }
        }
        hasMoreMessages = startIndex + limit < allMessages.length;
        graphMessages = allMessages.slice(startIndex, startIndex + limit);
      } else {
        const response = await this.app.graph.call(chats.messages.list, {
          "chat-id": baseConversationId,
          $top: limit,
          $orderby: ["createdDateTime desc"],
          $filter: options.cursor
            ? `createdDateTime lt ${options.cursor}`
            : undefined,
        });
        graphMessages = (response.value || []) as GraphMessage[];
        graphMessages.reverse();
        hasMoreMessages = graphMessages.length >= limit;
      }

      const messages = graphMessages
        .filter((msg) => msg.id)
        .map((msg) => {
          const isFromBot =
            msg.from?.application?.id === this.app.id ||
            msg.from?.user?.id === this.app.id;
          return new Message({
            id: msg.id as string,
            threadId: channelId,
            text: this.extractTextFromGraphMessage(msg),
            formatted: this.formatConverter.toAst(
              this.extractTextFromGraphMessage(msg)
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

  async listThreads(
    channelId: string,
    options: ListThreadsOptions = {}
  ): Promise<ListThreadsResult<unknown>> {
    if (!this.config.tenantId) {
      throw new NotImplementedError(
        "Teams listThreads requires appTenantId for Microsoft Graph API access.",
        "listThreads"
      );
    }

    const { conversationId, serviceUrl } = this.decodeThreadId(channelId);
    const baseConversationId = conversationId.replace(
      MESSAGEID_STRIP_PATTERN,
      ""
    );
    const limit = options.limit || 50;

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
        const response = await this.app.graph.call(
          teams.channels.messages.list,
          {
            "team-id": channelContext.teamId,
            "channel-id": channelContext.channelId,
            $top: limit,
          }
        );
        const messages = response.value || [];

        for (const msg of messages) {
          if (!msg.id) {
            continue;
          }
          const threadId = this.encodeThreadId({
            conversationId: `${baseConversationId};messageid=${msg.id}`,
            serviceUrl,
          });

          const isFromBot =
            msg.from?.application?.id === this.app.id ||
            msg.from?.user?.id === this.app.id;

          threads.push({
            id: threadId,
            rootMessage: new Message({
              id: msg.id as string,
              threadId,
              text: this.extractTextFromGraphMessage(msg),
              formatted: this.formatConverter.toAst(
                this.extractTextFromGraphMessage(msg)
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
        const response = await this.app.graph.call(chats.messages.list, {
          "chat-id": baseConversationId,
          $top: limit,
          $orderby: ["createdDateTime desc"],
        });
        const messages = response.value || [];

        for (const msg of messages) {
          if (!msg.id) {
            continue;
          }
          const threadId = this.encodeThreadId({
            conversationId: `${baseConversationId};messageid=${msg.id}`,
            serviceUrl,
          });

          const isFromBot =
            msg.from?.application?.id === this.app.id ||
            msg.from?.user?.id === this.app.id;

          threads.push({
            id: threadId,
            rootMessage: new Message({
              id: msg.id as string,
              threadId,
              text: this.extractTextFromGraphMessage(msg),
              formatted: this.formatConverter.toAst(
                this.extractTextFromGraphMessage(msg)
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

  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const { conversationId } = this.decodeThreadId(channelId);
    const baseConversationId = conversationId.replace(
      MESSAGEID_STRIP_PATTERN,
      ""
    );

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

    if (channelContext && this.config.tenantId) {
      try {
        this.logger.debug("Teams Graph API: GET channel info", {
          teamId: channelContext.teamId,
          channelId: channelContext.channelId,
        });

        const response = await this.app.graph.call(teams.channels.get, {
          "team-id": channelContext.teamId,
          "channel-id": channelContext.channelId,
        });

        return {
          id: channelId,
          name: response.displayName,
          isDM: false,
          memberCount: (response as { memberCount?: number }).memberCount,
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

    return {
      id: channelId,
      isDM: this.isDM(channelId),
      metadata: {
        conversationId: baseConversationId,
      },
    };
  }

  async postChannelMessage(
    channelId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<unknown>> {
    const { conversationId } = this.decodeThreadId(channelId);
    const baseConversationId = conversationId.replace(
      MESSAGEID_STRIP_PATTERN,
      ""
    );

    const files = extractFiles(message);
    const fileAttachments =
      files.length > 0 ? await this.filesToAttachments(files) : [];

    const card = extractCard(message);

    if (card) {
      const adaptiveCard = cardToAdaptiveCard(card);
      const activity = new MessageActivity();
      activity.attachments = [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: adaptiveCard,
        },
        ...fileAttachments,
      ];

      try {
        const sent = await this.app.send(baseConversationId, activity);
        return { id: sent.id || "", threadId: channelId, raw: activity };
      } catch (error) {
        this.logger.error("Teams API: postChannelMessage failed", {
          conversationId: baseConversationId,
          error,
        });
        this.handleTeamsError(error, "postChannelMessage");
      }
    }

    const text = convertEmojiPlaceholders(
      this.formatConverter.renderPostable(message),
      "teams"
    );
    const activity = new MessageActivity(text);
    activity.textFormat = "markdown";
    if (fileAttachments.length > 0) {
      activity.attachments = fileAttachments;
    }

    try {
      const sent = await this.app.send(baseConversationId, activity);
      this.logger.debug("Teams API: postChannelMessage response", {
        messageId: sent.id,
      });
      return { id: sent.id || "", threadId: channelId, raw: activity };
    } catch (error) {
      this.logger.error("Teams API: postChannelMessage failed", {
        conversationId: baseConversationId,
        error,
      });
      this.handleTeamsError(error, "postChannelMessage");
    }
  }

  encodeThreadId(platformData: TeamsThreadId): string {
    const encodedConversationId = Buffer.from(
      platformData.conversationId
    ).toString("base64url");
    const encodedServiceUrl = Buffer.from(platformData.serviceUrl).toString(
      "base64url"
    );
    return `teams:${encodedConversationId}:${encodedServiceUrl}`;
  }

  isDM(threadId: string): boolean {
    const { conversationId } = this.decodeThreadId(threadId);
    return !conversationId.startsWith("19:");
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

  parseMessage(raw: unknown): Message<unknown> {
    const activity = raw as Activity;
    const threadId = this.encodeThreadId({
      conversationId: activity.conversation?.id || "",
      serviceUrl: activity.serviceUrl || "",
    });
    return this.parseTeamsMessage(activity, threadId);
  }

  private isMessageFromSelf(activity: Activity): boolean {
    const fromId = activity.from?.id;
    if (!(fromId && this.app.id)) {
      return false;
    }

    if (fromId === this.app.id) {
      return true;
    }

    if (fromId.endsWith(`:${this.app.id}`)) {
      return true;
    }

    return false;
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  private handleTeamsError(error: unknown, operation: string): never {
    if (error && typeof error === "object") {
      const err = error as Record<string, unknown>;

      // Check for TeamsSDK HttpError shape: innerHttpError.statusCode
      const innerError = err.innerHttpError as
        | Record<string, unknown>
        | undefined;
      const statusCode =
        (innerError?.statusCode as number) ||
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

export function createTeamsAdapter(config?: TeamsAdapterConfig): TeamsAdapter {
  return new TeamsAdapter(config ?? {});
}

// Re-export card converter for advanced use
export { cardToAdaptiveCard, cardToFallbackText } from "./cards";
export { TeamsFormatConverter } from "./markdown";
