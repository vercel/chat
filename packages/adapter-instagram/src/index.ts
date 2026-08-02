import { createHmac, timingSafeEqual } from "node:crypto";
import {
  AdapterRateLimitError,
  AuthenticationError,
  extractCard,
  extractFiles,
  extractPostableAttachments,
  NetworkError,
  ResourceNotFoundError,
  ValidationError,
} from "@chat-adapter/shared";
import type {
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
  Logger,
  RawMessage,
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
import { cardToInstagram, decodeInstagramCallbackData } from "./cards";
import { InstagramFormatConverter } from "./markdown";
import type {
  InstagramAdapterConfig,
  InstagramAttachment,
  InstagramMessagingEvent,
  InstagramPostOptions,
  InstagramQuickReply,
  InstagramRawMessage,
  InstagramSendApiResponse,
  InstagramTemplatePayload,
  InstagramThreadId,
  InstagramUserProfile,
  InstagramWebhookPayload,
} from "./types";

const GRAPH_API_BASE = "https://graph.instagram.com";
const DEFAULT_API_VERSION = "v26.0";
const INSTAGRAM_MESSAGE_BYTE_LIMIT = 1000;
const MESSAGE_SEQUENCE_PATTERN = /:(\d+)$/;
const WINDOW_ERROR_CODES = new Set([1_545_041]);
const WINDOW_ERROR_SUBCODES = new Set([2_018_278, 2_534_022]);
const IMAGE_SIZE_LIMIT = 8 * 1024 * 1024;
const OTHER_MEDIA_SIZE_LIMIT = 25 * 1024 * 1024;

type InstagramMediaType = "audio" | "file" | "image" | "video";

interface ResolvedInstagramMedia {
  attachmentId?: string;
  type: InstagramMediaType;
  url?: string;
}

interface InstagramGraphError {
  code?: number;
  error_subcode?: number;
  message?: string;
  type?: string;
}

export class InstagramAdapter
  implements Adapter<InstagramThreadId, InstagramRawMessage>
{
  readonly name = "instagram";

  protected readonly accessToken: string;
  protected readonly accountId: string;
  protected readonly appSecret: string;
  protected readonly apiVersion: string;
  protected readonly logger: Logger;
  protected readonly verifyToken: string;
  protected readonly formatConverter = new InstagramFormatConverter();
  protected chat: ChatInstance | null = null;
  protected _botUserId: string;
  protected _userName: string;
  protected readonly hasExplicitUserName: boolean;

  private readonly messageCache = new Map<
    string,
    Message<InstagramRawMessage>[]
  >();
  private readonly userProfileCache = new Map<string, InstagramUserProfile>();

  constructor(
    config: InstagramAdapterConfig & {
      accessToken: string;
      accountId: string;
      appSecret: string;
      logger: Logger;
      verifyToken: string;
    }
  ) {
    this.accessToken = config.accessToken;
    this.accountId = config.accountId;
    this.appSecret = config.appSecret;
    this.apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
    this.logger = config.logger;
    this.verifyToken = config.verifyToken;
    this._botUserId = config.accountId;
    this._userName = config.userName ?? "bot";
    this.hasExplicitUserName = Boolean(config.userName);
  }

  get botUserId(): string {
    return this._botUserId;
  }

  get userName(): string {
    return this._userName;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    if (!this.hasExplicitUserName) {
      this._userName = chat.getUserName();
    }

    try {
      const profile = await this.graphApiFetch<InstagramUserProfile>(
        this.accountId,
        "GET",
        undefined,
        { fields: "id,name,username,profile_picture_url" }
      );
      this._botUserId = profile.id;
      if (!this.hasExplicitUserName) {
        this._userName = profile.username ?? profile.name ?? this._userName;
      }
      this.logger.info("Instagram adapter initialized", {
        accountId: this.accountId,
        userName: this._userName,
      });
    } catch (error) {
      this.logger.warn("Failed to fetch Instagram account identity", {
        error: String(error),
      });
    }
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    if (request.method === "GET") {
      return this.handleVerification(request);
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const body = await request.text();
    if (!this.verifySignature(request, body)) {
      this.logger.warn("Instagram webhook rejected due to invalid signature");
      return new Response("Invalid signature", { status: 403 });
    }

    let payload: InstagramWebhookPayload;
    try {
      payload = JSON.parse(body) as InstagramWebhookPayload;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (payload.object !== "instagram") {
      return new Response("Not an Instagram subscription", { status: 404 });
    }
    if (!this.chat) {
      this.logger.warn(
        "Chat instance not initialized, ignoring Instagram webhook"
      );
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    for (const entry of payload.entry) {
      for (const event of entry.messaging) {
        if (event.message?.is_echo) {
          this.handleEcho(event, entry.id);
        } else if (event.message?.quick_reply) {
          this.handleQuickReply(event, entry.id, options);
        } else if (event.message) {
          this.handleIncomingMessage(event, entry.id, options);
        }

        if (event.postback) {
          this.handlePostback(event, entry.id, options);
        }
        if (event.reaction) {
          this.handleReaction(event, entry.id, options);
        }
        if (event.delivery) {
          this.logger.debug("Instagram message delivery confirmation", {
            mids: event.delivery.mids,
            watermark: event.delivery.watermark,
          });
        }
        if (event.read) {
          this.logger.debug("Instagram message read confirmation", {
            watermark: event.read.watermark,
          });
        }
      }
    }

    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  protected handleVerification(request: Request): Response {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === this.verifyToken) {
      this.logger.info("Instagram webhook verified");
      return new Response(challenge ?? "", { status: 200 });
    }
    this.logger.warn("Instagram webhook verification failed");
    return new Response("Forbidden", { status: 403 });
  }

  protected verifySignature(request: Request, body: string): boolean {
    const signature = request.headers.get("x-hub-signature-256");
    if (!signature) {
      return false;
    }
    const [algorithm, hash] = signature.split("=");
    if (algorithm !== "sha256" || !hash) {
      return false;
    }
    try {
      const computed = createHmac("sha256", this.appSecret)
        .update(body, "utf8")
        .digest("hex");
      return timingSafeEqual(
        Buffer.from(hash, "hex"),
        Buffer.from(computed, "hex")
      );
    } catch {
      this.logger.warn("Failed to verify Instagram webhook signature");
      return false;
    }
  }

  protected handleIncomingMessage(
    event: InstagramMessagingEvent,
    accountId: string,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      return;
    }
    const threadId = this.encodeThreadId({
      accountId,
      recipientId: event.sender.id,
    });
    const parsed = this.parseInstagramMessage(event, threadId);
    this.cacheMessage(parsed);
    this.chat.processMessage(this, threadId, parsed, options);
  }

  protected handleEcho(
    event: InstagramMessagingEvent,
    accountId: string
  ): void {
    const threadId = this.encodeThreadId({
      accountId,
      recipientId: event.recipient.id,
    });
    const parsed = this.parseInstagramMessage(event, threadId);
    this.cacheMessage(parsed);
  }

  protected handleQuickReply(
    event: InstagramMessagingEvent,
    accountId: string,
    options?: WebhookOptions
  ): void {
    const payload = event.message?.quick_reply?.payload;
    if (!(this.chat && payload)) {
      return;
    }
    this.processAction(event, accountId, payload, event.message?.mid, options);
  }

  protected handlePostback(
    event: InstagramMessagingEvent,
    accountId: string,
    options?: WebhookOptions
  ): void {
    if (!(this.chat && event.postback)) {
      return;
    }
    this.processAction(
      event,
      accountId,
      event.postback.payload,
      event.postback.mid,
      options
    );
  }

  protected processAction(
    event: InstagramMessagingEvent,
    accountId: string,
    payload: string,
    messageId: string | undefined,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      return;
    }
    const threadId = this.encodeThreadId({
      accountId,
      recipientId: event.sender.id,
    });
    const { actionId, value } = decodeInstagramCallbackData(payload);
    this.chat.processAction(
      {
        adapter: this,
        actionId,
        value,
        messageId: messageId ?? `action:${event.timestamp}`,
        threadId,
        user: {
          userId: event.sender.id,
          userName: event.sender.id,
          fullName: event.sender.id,
          isBot: false,
          isMe: false,
        },
        raw: event,
      },
      options
    );
  }

  protected handleReaction(
    event: InstagramMessagingEvent,
    accountId: string,
    options?: WebhookOptions
  ): void {
    if (!(this.chat && event.reaction)) {
      return;
    }
    const threadId = this.encodeThreadId({
      accountId,
      recipientId: event.sender.id,
    });
    const rawEmoji = event.reaction.emoji ?? event.reaction.reaction ?? "";
    this.chat.processReaction(
      {
        adapter: this,
        threadId,
        messageId: event.reaction.mid,
        emoji: defaultEmojiResolver.fromGChat(rawEmoji),
        rawEmoji,
        added: event.reaction.action === "react",
        user: {
          userId: event.sender.id,
          userName: event.sender.id,
          fullName: event.sender.id,
          isBot: false,
          isMe: false,
        },
        raw: event,
      },
      options
    );
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
    options: InstagramPostOptions = {}
  ): Promise<RawMessage<InstagramRawMessage>> {
    const mediaItems: Array<FileUpload | Attachment> = [
      ...extractFiles(message),
      ...extractPostableAttachments(message),
    ];
    let lastResult: RawMessage<InstagramRawMessage> | undefined;

    for (const item of mediaItems) {
      const media = await this.resolveMedia(item);
      lastResult = await this.sendMediaMessage(threadId, media, options);
    }

    const card = extractCard(message);
    if (card) {
      const result = cardToInstagram(card);
      if (result.type === "template") {
        return this.sendTemplateMessage(threadId, result.payload, options);
      }
      if (result.type === "quick_replies") {
        return this.sendQuickReplies(
          threadId,
          result.text,
          result.quickReplies,
          options
        );
      }
      if (result.text.trim()) {
        return this.sendTextMessage(threadId, result.text, options);
      }
      if (lastResult) {
        return lastResult;
      }
    }

    const text = this.renderPostableText(message);
    if (text.trim()) {
      return this.sendTextMessage(threadId, text, options);
    }
    if (lastResult) {
      return lastResult;
    }
    throw new ValidationError(
      "instagram",
      "Message must include text, a card, or an attachment"
    );
  }

  async sendHumanAgentMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<InstagramRawMessage>> {
    return this.postMessage(threadId, message, { messageTag: "HUMAN_AGENT" });
  }

  protected async sendTextMessage(
    threadId: string,
    text: string,
    options: InstagramPostOptions
  ): Promise<RawMessage<InstagramRawMessage>> {
    const converted = convertEmojiPlaceholders(text, "messenger");
    const truncated = truncateUtf8(converted, INSTAGRAM_MESSAGE_BYTE_LIMIT);
    if (!truncated.trim()) {
      throw new ValidationError("instagram", "Message text cannot be empty");
    }
    const result = await this.sendApiRequest(threadId, {
      message: { text: truncated },
      ...this.deliveryFields(options),
    });
    return this.buildSentMessage(threadId, result, { text: truncated });
  }

  protected async sendQuickReplies(
    threadId: string,
    text: string,
    quickReplies: InstagramQuickReply[],
    options: InstagramPostOptions
  ): Promise<RawMessage<InstagramRawMessage>> {
    const converted = convertEmojiPlaceholders(text, "messenger");
    const truncated = truncateUtf8(converted, INSTAGRAM_MESSAGE_BYTE_LIMIT);
    const result = await this.sendApiRequest(threadId, {
      message: { text: truncated, quick_replies: quickReplies },
      ...this.deliveryFields(options),
    });
    return this.buildSentMessage(threadId, result, { text: truncated });
  }

  protected async sendTemplateMessage(
    threadId: string,
    payload: InstagramTemplatePayload,
    options: InstagramPostOptions
  ): Promise<RawMessage<InstagramRawMessage>> {
    const converted = JSON.parse(
      convertEmojiPlaceholders(JSON.stringify(payload), "messenger")
    ) as InstagramTemplatePayload;
    const result = await this.sendApiRequest(threadId, {
      message: {
        attachment: { type: "template", payload: converted },
      },
      ...this.deliveryFields(options),
    });
    return this.buildSentMessage(threadId, result);
  }

  protected async sendMediaMessage(
    threadId: string,
    media: ResolvedInstagramMedia,
    options: InstagramPostOptions
  ): Promise<RawMessage<InstagramRawMessage>> {
    const payload = media.attachmentId
      ? { attachment_id: media.attachmentId }
      : { url: media.url };
    const result = await this.sendApiRequest(threadId, {
      message: { attachment: { type: media.type, payload } },
      ...this.deliveryFields(options),
    });
    return this.buildSentMessage(threadId, result, {
      attachments: [{ type: media.type, payload }],
    });
  }

  protected async sendApiRequest(
    threadId: string,
    body: Record<string, unknown>
  ): Promise<InstagramSendApiResponse> {
    const { accountId, recipientId } = this.decodeThreadId(threadId);
    return this.graphApiFetch<InstagramSendApiResponse>(
      `${accountId}/messages`,
      "POST",
      { recipient: { id: recipientId }, ...body }
    );
  }

  protected deliveryFields(
    options: InstagramPostOptions
  ): Record<string, string> {
    if (options.messageTag === "HUMAN_AGENT") {
      return { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" };
    }
    return { messaging_type: "RESPONSE" };
  }

  protected buildSentMessage(
    threadId: string,
    result: InstagramSendApiResponse,
    message: Partial<NonNullable<InstagramMessagingEvent["message"]>> = {}
  ): RawMessage<InstagramRawMessage> {
    const { recipientId } = this.decodeThreadId(threadId);
    const raw: InstagramMessagingEvent = {
      sender: { id: this._botUserId },
      recipient: { id: recipientId },
      timestamp: Date.now(),
      message: { mid: result.message_id, is_echo: true, ...message },
    };
    this.cacheMessage(this.parseInstagramMessage(raw, threadId));
    return { id: result.message_id, threadId, raw };
  }

  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage
  ): Promise<RawMessage<InstagramRawMessage>> {
    throw new ValidationError(
      "instagram",
      "Instagram does not support editing messages"
    );
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    throw new ValidationError(
      "instagram",
      "Instagram does not support deleting messages"
    );
  }

  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new ValidationError(
      "instagram",
      "Instagram outbound reactions are not supported by this adapter"
    );
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new ValidationError(
      "instagram",
      "Instagram outbound reactions are not supported by this adapter"
    );
  }

  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    _options?: StreamOptions
  ): Promise<RawMessage<InstagramRawMessage>> {
    let accumulated = "";
    for await (const chunk of textStream) {
      if (typeof chunk === "string") {
        accumulated += chunk;
      } else if (chunk.type === "markdown_text") {
        accumulated += chunk.text;
      }
    }
    return this.postMessage(threadId, { markdown: accumulated });
  }

  async startTyping(threadId: string): Promise<void> {
    await this.sendApiRequest(threadId, { sender_action: "typing_on" });
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<InstagramRawMessage>> {
    const messages = [...(this.messageCache.get(threadId) ?? [])].sort((a, b) =>
      this.compareMessages(a, b)
    );
    return this.paginateMessages(messages, options);
  }

  async fetchMessage(
    _threadId: string,
    messageId: string
  ): Promise<Message<InstagramRawMessage> | null> {
    for (const messages of this.messageCache.values()) {
      const found = messages.find((message) => message.id === messageId);
      if (found) {
        return found;
      }
    }
    return null;
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { recipientId } = this.decodeThreadId(threadId);
    const profile = await this.fetchUserProfile(recipientId);
    const name = profile.username ?? profile.name ?? profile.id;
    return {
      id: threadId,
      channelId: threadId,
      channelName: name,
      isDM: true,
      metadata: { profile },
    };
  }

  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const { recipientId } = this.decodeThreadId(channelId);
    const profile = await this.fetchUserProfile(recipientId);
    return {
      id: channelId,
      name: profile.username ?? profile.name ?? profile.id,
      isDM: true,
      metadata: { profile },
    };
  }

  channelIdFromThreadId(threadId: string): string {
    return threadId;
  }

  async openDM(userId: string): Promise<string> {
    return this.encodeThreadId({
      accountId: this.accountId,
      recipientId: userId,
    });
  }

  isDM(_threadId: string): boolean {
    return true;
  }

  encodeThreadId(platformData: InstagramThreadId): string {
    if (!(platformData.accountId && platformData.recipientId)) {
      throw new ValidationError(
        "instagram",
        "Instagram account ID and recipient ID are required"
      );
    }
    return `instagram:${platformData.accountId}:${platformData.recipientId}`;
  }

  decodeThreadId(threadId: string): InstagramThreadId {
    const parts = threadId.split(":");
    if (
      parts.length !== 3 ||
      parts[0] !== "instagram" ||
      !parts[1] ||
      !parts[2]
    ) {
      throw new ValidationError(
        "instagram",
        `Invalid Instagram thread ID: ${threadId}`
      );
    }
    return { accountId: parts[1], recipientId: parts[2] };
  }

  parseMessage(raw: InstagramRawMessage): Message<InstagramRawMessage> {
    const isEcho = raw.message?.is_echo ?? false;
    const accountId = isEcho ? raw.sender.id : raw.recipient.id;
    const recipientId = isEcho ? raw.recipient.id : raw.sender.id;
    const threadId = this.encodeThreadId({ accountId, recipientId });
    const parsed = this.parseInstagramMessage(raw, threadId);
    this.cacheMessage(parsed);
    return parsed;
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  rehydrateAttachment(attachment: Attachment): Attachment {
    if (!attachment.url) {
      return attachment;
    }
    return {
      ...attachment,
      fetchData: async () => this.downloadAttachment(attachment.url ?? ""),
    };
  }

  protected parseInstagramMessage(
    event: InstagramMessagingEvent,
    threadId: string
  ): Message<InstagramRawMessage> {
    const text = event.message?.text ?? event.postback?.title ?? "";
    const isEcho = event.message?.is_echo ?? false;
    const isMe = isEcho || event.sender.id === this._botUserId;
    return new Message<InstagramRawMessage>({
      id:
        event.message?.mid ?? event.postback?.mid ?? `event:${event.timestamp}`,
      threadId,
      text,
      formatted: this.formatConverter.toAst(text),
      raw: event,
      author: {
        userId: event.sender.id,
        userName: event.sender.id,
        fullName: event.sender.id,
        isBot: isMe,
        isMe,
      },
      metadata: {
        dateSent: new Date(event.timestamp),
        edited: false,
      },
      attachments: this.extractAttachments(event),
      isMention: true,
    });
  }

  protected extractAttachments(event: InstagramMessagingEvent): Attachment[] {
    const rawAttachments = [...(event.message?.attachments ?? [])];
    const story = event.message?.reply_to?.story;
    if (story?.url) {
      rawAttachments.push({
        type: "story_mention",
        payload: { id: story.id, url: story.url },
      });
    }
    return rawAttachments
      .filter((attachment) => Boolean(attachment.payload?.url))
      .map((attachment) => {
        const url = attachment.payload?.url;
        return {
          type: this.mapAttachmentType(attachment.type),
          url,
          fetchMetadata: {
            instagramType: attachment.type,
            ...(attachment.payload?.id
              ? { instagramMediaId: attachment.payload.id }
              : {}),
          },
          fetchData: url ? async () => this.downloadAttachment(url) : undefined,
        };
      });
  }

  protected mapAttachmentType(
    type: InstagramAttachment["type"]
  ): Attachment["type"] {
    if (type === "image" || type === "story_mention") {
      return "image";
    }
    if (type === "video" || type === "ig_reel" || type === "reel") {
      return "video";
    }
    if (type === "audio") {
      return "audio";
    }
    return "file";
  }

  protected renderPostableText(message: AdapterPostableMessage): string {
    if (typeof message === "string") {
      return message;
    }
    if (
      typeof message === "object" &&
      message !== null &&
      ("markdown" in message || "raw" in message || "ast" in message)
    ) {
      return this.formatConverter.renderPostable(message);
    }
    return "";
  }

  protected async resolveMedia(
    item: FileUpload | Attachment
  ): Promise<ResolvedInstagramMedia> {
    if ("filename" in item) {
      const mimeType = item.mimeType ?? inferMimeType(item.filename);
      const type = mediaTypeFromMime(mimeType);
      const buffer = await toInstagramBuffer(item.data);
      validateMediaSize(type, buffer.length);
      return {
        type,
        attachmentId: await this.uploadMedia(
          type,
          buffer,
          item.filename,
          mimeType
        ),
      };
    }

    const type = item.type;
    const data =
      item.data ?? (item.fetchData ? await item.fetchData() : undefined);
    if (data) {
      const buffer = await toInstagramBuffer(data);
      validateMediaSize(type, buffer.length);
      const filename = item.name ?? `attachment.${extensionForType(type)}`;
      const mimeType = item.mimeType ?? inferMimeType(filename);
      return {
        type,
        attachmentId: await this.uploadMedia(type, buffer, filename, mimeType),
      };
    }

    if (!item.url?.startsWith("https://")) {
      throw new ValidationError(
        "instagram",
        "Attachment requires binary data or a public HTTPS URL"
      );
    }
    if (typeof item.size === "number") {
      validateMediaSize(type, item.size);
    }
    return { type, url: item.url };
  }

  protected async uploadMedia(
    type: InstagramMediaType,
    data: Buffer,
    filename: string,
    mimeType: string
  ): Promise<string> {
    const formData = new FormData();
    formData.append(
      "message",
      JSON.stringify({
        attachment: { type, payload: { is_reusable: true } },
      })
    );
    formData.append(
      "filedata",
      new Blob([new Uint8Array(data)], { type: mimeType }),
      filename
    );
    const response = await this.graphApiUpload<{ attachment_id?: string }>(
      `${this.accountId}/message_attachments`,
      formData
    );
    if (!response.attachment_id) {
      throw new NetworkError(
        "instagram",
        "Instagram Attachment Upload API did not return an attachment ID"
      );
    }
    return response.attachment_id;
  }

  protected async downloadAttachment(url: string): Promise<Buffer> {
    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw new NetworkError(
        "instagram",
        "Failed to download Instagram attachment",
        error instanceof Error ? error : undefined
      );
    }
    if (!response.ok) {
      throw new NetworkError(
        "instagram",
        `Failed to download Instagram attachment: ${response.status}`
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  protected async fetchUserProfile(
    userId: string
  ): Promise<InstagramUserProfile> {
    const cached = this.userProfileCache.get(userId);
    if (cached) {
      return cached;
    }
    try {
      const profile = await this.graphApiFetch<InstagramUserProfile>(
        userId,
        "GET",
        undefined,
        { fields: "id,name,username,profile_picture_url" }
      );
      this.userProfileCache.set(userId, profile);
      return profile;
    } catch {
      return { id: userId };
    }
  }

  protected async graphApiFetch<TResult>(
    endpoint: string,
    method: "GET" | "POST",
    body?: Record<string, unknown>,
    queryParams?: Record<string, string>
  ): Promise<TResult> {
    const url = new URL(`${GRAPH_API_BASE}/${this.apiVersion}/${endpoint}`);
    for (const [key, value] of Object.entries(queryParams ?? {})) {
      url.searchParams.set(key, value);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new NetworkError(
        "instagram",
        `Network error calling Instagram Graph API ${endpoint}`,
        error instanceof Error ? error : undefined
      );
    }
    return this.parseGraphResponse<TResult>(endpoint, response);
  }

  protected async graphApiUpload<TResult>(
    endpoint: string,
    formData: FormData
  ): Promise<TResult> {
    let response: Response;
    try {
      response = await fetch(
        `${GRAPH_API_BASE}/${this.apiVersion}/${endpoint}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${this.accessToken}` },
          body: formData,
        }
      );
    } catch (error) {
      throw new NetworkError(
        "instagram",
        `Network error uploading Instagram media to ${endpoint}`,
        error instanceof Error ? error : undefined
      );
    }
    return this.parseGraphResponse<TResult>(endpoint, response);
  }

  protected async parseGraphResponse<TResult>(
    endpoint: string,
    response: Response
  ): Promise<TResult> {
    let data: Record<string, unknown>;
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new NetworkError(
        "instagram",
        `Failed to parse Instagram API response for ${endpoint}`
      );
    }
    if (!response.ok) {
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      this.throwGraphApiError(endpoint, response.status, data, retryAfter);
    }
    return data as TResult;
  }

  protected throwGraphApiError(
    endpoint: string,
    status: number,
    data: Record<string, unknown>,
    retryAfter?: number
  ): never {
    const error = data.error as InstagramGraphError | undefined;
    const message = error?.message ?? `Instagram API ${endpoint} failed`;
    const code = error?.code ?? status;
    const subcode = error?.error_subcode;

    if (
      WINDOW_ERROR_CODES.has(code) ||
      (subcode !== undefined && WINDOW_ERROR_SUBCODES.has(subcode)) ||
      message.toLowerCase().includes("outside the allowed window")
    ) {
      throw new ValidationError(
        "instagram",
        "Instagram's 24-hour messaging window has expired. A human agent may use sendHumanAgentMessage() within 7 days when the app has the required permission."
      );
    }
    if (status === 429 || code === 4 || code === 32 || code === 613) {
      throw new AdapterRateLimitError("instagram", retryAfter);
    }
    if (status === 401 || code === 190) {
      throw new AuthenticationError("instagram", message);
    }
    if (status === 403 || code === 10 || code === 200) {
      throw new ValidationError("instagram", message);
    }
    if (status === 404) {
      throw new ResourceNotFoundError("instagram", endpoint);
    }
    throw new NetworkError(
      "instagram",
      `${message} (status ${status}, code ${code})`
    );
  }

  protected cacheMessage(message: Message<InstagramRawMessage>): void {
    const messages = this.messageCache.get(message.threadId) ?? [];
    const index = messages.findIndex((item) => item.id === message.id);
    if (index >= 0) {
      messages[index] = message;
    } else {
      messages.push(message);
    }
    messages.sort((a, b) => this.compareMessages(a, b));
    this.messageCache.set(message.threadId, messages);
  }

  protected compareMessages(
    a: Message<InstagramRawMessage>,
    b: Message<InstagramRawMessage>
  ): number {
    const timeDifference =
      a.metadata.dateSent.getTime() - b.metadata.dateSent.getTime();
    if (timeDifference !== 0) {
      return timeDifference;
    }
    return this.messageSequence(a.id) - this.messageSequence(b.id);
  }

  protected messageSequence(messageId: string): number {
    const match = messageId.match(MESSAGE_SEQUENCE_PATTERN);
    return match ? Number.parseInt(match[1], 10) : 0;
  }

  protected paginateMessages(
    messages: Message<InstagramRawMessage>[],
    options: FetchOptions
  ): FetchResult<InstagramRawMessage> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    const direction = options.direction ?? "backward";
    if (messages.length === 0) {
      return { messages: [] };
    }
    const indexes = new Map(
      messages.map((message, index) => [message.id, index])
    );
    if (direction === "backward") {
      const end =
        options.cursor && indexes.has(options.cursor)
          ? (indexes.get(options.cursor) ?? messages.length)
          : messages.length;
      const start = Math.max(0, end - limit);
      const page = messages.slice(start, end);
      return {
        messages: page,
        nextCursor: start > 0 ? page[0]?.id : undefined,
      };
    }
    const start =
      options.cursor && indexes.has(options.cursor)
        ? (indexes.get(options.cursor) ?? -1) + 1
        : 0;
    const end = Math.min(messages.length, start + limit);
    const page = messages.slice(start, end);
    return {
      messages: page,
      nextCursor: end < messages.length ? page.at(-1)?.id : undefined,
    };
  }
}

export function createInstagramAdapter(
  config?: InstagramAdapterConfig
): InstagramAdapter {
  const accessToken = config?.accessToken ?? process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!accessToken) {
    throw new ValidationError(
      "instagram",
      "accessToken is required. Set INSTAGRAM_ACCESS_TOKEN or provide it in config."
    );
  }
  const accountId = config?.accountId ?? process.env.INSTAGRAM_ACCOUNT_ID;
  if (!accountId) {
    throw new ValidationError(
      "instagram",
      "accountId is required. Set INSTAGRAM_ACCOUNT_ID or provide it in config."
    );
  }
  const appSecret = config?.appSecret ?? process.env.INSTAGRAM_APP_SECRET;
  if (!appSecret) {
    throw new ValidationError(
      "instagram",
      "appSecret is required. Set INSTAGRAM_APP_SECRET or provide it in config."
    );
  }
  const verifyToken = config?.verifyToken ?? process.env.INSTAGRAM_VERIFY_TOKEN;
  if (!verifyToken) {
    throw new ValidationError(
      "instagram",
      "verifyToken is required. Set INSTAGRAM_VERIFY_TOKEN or provide it in config."
    );
  }
  return new InstagramAdapter({
    accessToken,
    accountId,
    appSecret,
    verifyToken,
    apiVersion: config?.apiVersion ?? process.env.INSTAGRAM_API_VERSION,
    logger: config?.logger ?? new ConsoleLogger("info").child("instagram"),
    userName: config?.userName,
  });
}

function truncateUtf8(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).byteLength <= maxBytes) {
    return text;
  }
  const suffix = "...";
  const available = maxBytes - encoder.encode(suffix).byteLength;
  let result = "";
  for (const character of text) {
    if (encoder.encode(result + character).byteLength > available) {
      break;
    }
    result += character;
  }
  return result + suffix;
}

async function toInstagramBuffer(
  data: Buffer | Blob | ArrayBuffer
): Promise<Buffer> {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (data instanceof Blob) {
    return Buffer.from(await data.arrayBuffer());
  }
  throw new ValidationError("instagram", "Unsupported file data type");
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number.parseInt(value, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function inferMimeType(filename: string): string {
  const extension = filename.toLowerCase().split(".").pop();
  const types: Record<string, string> = {
    aac: "audio/aac",
    avi: "video/x-msvideo",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    m4a: "audio/mp4",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    ogg: "audio/ogg",
    pdf: "application/pdf",
    png: "image/png",
    wav: "audio/wav",
    webm: "video/webm",
  };
  return types[extension ?? ""] ?? "application/octet-stream";
}

function mediaTypeFromMime(mimeType: string): InstagramMediaType {
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.startsWith("video/")) {
    return "video";
  }
  if (mimeType.startsWith("audio/")) {
    return "audio";
  }
  return "file";
}

function validateMediaSize(type: InstagramMediaType, size: number): void {
  const limit = type === "image" ? IMAGE_SIZE_LIMIT : OTHER_MEDIA_SIZE_LIMIT;
  if (size > limit) {
    throw new ValidationError(
      "instagram",
      `${type} attachment exceeds Instagram's ${limit / 1024 / 1024} MB limit`
    );
  }
}

function extensionForType(type: InstagramMediaType): string {
  if (type === "image") {
    return "jpg";
  }
  if (type === "video") {
    return "mp4";
  }
  if (type === "audio") {
    return "m4a";
  }
  return "pdf";
}

export type { InstagramCardResult } from "./cards";
export {
  cardToInstagram,
  cardToInstagramText,
  decodeInstagramCallbackData,
  encodeInstagramCallbackData,
} from "./cards";
export { InstagramFormatConverter } from "./markdown";
export type {
  InstagramAdapterConfig,
  InstagramAttachment,
  InstagramButton,
  InstagramMessagePayload,
  InstagramMessagingEvent,
  InstagramPostOptions,
  InstagramQuickReply,
  InstagramRawMessage,
  InstagramReaction,
  InstagramSendApiResponse,
  InstagramTemplatePayload,
  InstagramThreadId,
  InstagramUserProfile,
  InstagramWebhookPayload,
} from "./types";
