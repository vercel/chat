import {
  bufferToDataUri,
  extractCard,
  extractFiles,
  NetworkError,
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
  IActivityContext,
  IHttpServerRequest,
} from "@microsoft/teams.apps";
import { App } from "@microsoft/teams.apps";
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
  WebhookOptions,
} from "chat";
import {
  ConsoleLogger,
  convertEmojiPlaceholders,
  defaultEmojiResolver,
  Message,
} from "chat";
import { BridgeHttpAdapter } from "./bridge-adapter";
import { cardToAdaptiveCard } from "./cards";
import { handleTeamsError } from "./errors";
import { TeamsGraphReader } from "./graph-api";
import { TeamsFormatConverter } from "./markdown";
import type {
  TeamsAdapterConfig,
  TeamsChannelContext,
  TeamsThreadId,
} from "./types";

const MESSAGEID_CAPTURE_PATTERN = /messageid=(\d+)/;
const MESSAGEID_STRIP_PATTERN = /;messageid=\d+/;

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
  private readonly graphReader: TeamsGraphReader;

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

    this.graphReader = new TeamsGraphReader({
      app: this.app,
      logger: this.logger,
      config: this.config,
      getChat: () => this.chat,
      formatConverter: this.formatConverter,
      encodeThreadId: (data) => this.encodeThreadId(data),
      decodeThreadId: (threadId) => this.decodeThreadId(threadId),
      isDM: (threadId) => this.isDM(threadId),
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
        handleTeamsError(error, "postMessage");
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
      handleTeamsError(error, "postMessage");
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
        handleTeamsError(error, "editMessage");
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
      handleTeamsError(error, "editMessage");
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
      handleTeamsError(error, "deleteMessage");
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
      handleTeamsError(error, "addReaction");
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
      handleTeamsError(error, "removeReaction");
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
      handleTeamsError(error, "startTyping");
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
      handleTeamsError(error, "openDM");
    }
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<unknown>> {
    return this.graphReader.fetchMessages(threadId, options);
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    return this.graphReader.fetchThread(threadId);
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
    return this.graphReader.fetchChannelMessages(channelId, options);
  }

  async listThreads(
    channelId: string,
    options: ListThreadsOptions = {}
  ): Promise<ListThreadsResult<unknown>> {
    return this.graphReader.listThreads(channelId, options);
  }

  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    return this.graphReader.fetchChannelInfo(channelId);
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
        handleTeamsError(error, "postChannelMessage");
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
      handleTeamsError(error, "postChannelMessage");
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
}

export function createTeamsAdapter(config?: TeamsAdapterConfig): TeamsAdapter {
  return new TeamsAdapter(config ?? {});
}

// Re-export card converter for advanced use
export { cardToAdaptiveCard, cardToFallbackText } from "./cards";
export { TeamsFormatConverter } from "./markdown";
export type { TeamsAdapterConfig, TeamsThreadId } from "./types";
