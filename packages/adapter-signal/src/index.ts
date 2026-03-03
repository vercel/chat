import {
  AdapterRateLimitError,
  AuthenticationError,
  cardToFallbackText,
  extractCard,
  extractFiles,
  NetworkError,
  PermissionError,
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
  FormattedContent,
  Logger,
  RawMessage,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import {
  ConsoleLogger,
  convertEmojiPlaceholders,
  defaultEmojiResolver,
  Message,
} from "chat";
import { SignalFormatConverter } from "./markdown";
import type {
  SignalAdapterConfig,
  SignalApiErrorResponse,
  SignalDataMessage,
  SignalEnvelope,
  SignalGroup,
  SignalJsonRpcReceivePayload,
  SignalOutgoingRawMessage,
  SignalRawMessage,
  SignalReaction,
  SignalReactionRequest,
  SignalRemoteDeleteRequest,
  SignalSendMessageRequest,
  SignalSendMessageResponse,
  SignalSyncSentMessage,
  SignalTextMode,
  SignalThreadId,
  SignalTypingIndicatorRequest,
  SignalUpdate,
} from "./types";

const SIGNAL_ADAPTER_NAME = "signal";
const DEFAULT_SIGNAL_API_BASE_URL = "http://localhost:8080";
const DEFAULT_SIGNAL_WEBHOOK_SECRET_HEADER = "x-signal-webhook-secret";
const SIGNAL_THREAD_PREFIX = "signal:";
const SIGNAL_GROUP_PREFIX = "group.";
const DEFAULT_POLLING_INTERVAL_MS = 1000;
const MIN_POLLING_INTERVAL_MS = 100;
const TRAILING_SLASHES_REGEX = /\/+$/;
const MESSAGE_ID_PATTERN = /^(.*)\|(\d+)$/;
const LEADING_AT_PATTERN = /^@+/;
const EMOJI_PLACEHOLDER_PATTERN = /^\{\{emoji:([a-z0-9_]+)\}\}$/i;
const EMOJI_NAME_PATTERN = /^[a-z0-9_+-]+$/i;
const SIGNAL_MESSAGE_LIMIT = 4096;
const SIGNAL_PHONE_NUMBER_PATTERN = /^\+[1-9]\d{6,14}$/;
const BASE64_OR_BASE64URL_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/;
const TRAILING_BASE64_PADDING_PATTERN = /=+$/;

interface SignalMessageAuthor {
  fullName: string;
  isBot: boolean | "unknown";
  isMe: boolean;
  userId: string;
  userName: string;
}

interface SignalParsedMessageOptions {
  edited?: boolean;
  editedAtTimestamp?: number;
  messageIdTimestamp?: number;
}

export interface SignalPollingOptions {
  intervalMs?: number;
  timeoutSeconds?: number;
  webhookOptions?: WebhookOptions;
}

export class SignalAdapter
  implements Adapter<SignalThreadId, SignalRawMessage>
{
  readonly name = SIGNAL_ADAPTER_NAME;

  private readonly botPhoneNumber: string;
  private readonly apiBaseUrl: string;
  private readonly webhookSecret?: string;
  private readonly webhookSecretHeader: string;
  private readonly configuredTextMode?: SignalTextMode;
  private readonly logger: Logger;
  private readonly formatConverter = new SignalFormatConverter();
  private readonly messageCache = new Map<
    string,
    Message<SignalRawMessage>[]
  >();
  private readonly identifierAliases = new Map<string, string>();

  private chat: ChatInstance | null = null;
  private pollingTask: Promise<void> | null = null;
  private pollingAbortController: AbortController | null = null;
  private _userName: string;
  private readonly hasExplicitUserName: boolean;

  get botUserId(): string {
    return this.botPhoneNumber;
  }

  get userName(): string {
    return this._userName;
  }

  constructor(
    config: SignalAdapterConfig & {
      logger: Logger;
      userName?: string;
    }
  ) {
    this.botPhoneNumber = this.normalizeSignalIdentifier(config.phoneNumber);
    this.apiBaseUrl = this.normalizeBaseUrl(
      config.baseUrl ?? DEFAULT_SIGNAL_API_BASE_URL
    );
    this.webhookSecret = config.webhookSecret;
    this.webhookSecretHeader =
      config.webhookSecretHeader?.toLowerCase() ??
      DEFAULT_SIGNAL_WEBHOOK_SECRET_HEADER;
    this.configuredTextMode = config.textMode;
    this.logger = config.logger;
    this._userName = this.normalizeUserName(config.userName ?? "bot");
    this.hasExplicitUserName = Boolean(config.userName);
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    if (!this.hasExplicitUserName) {
      this._userName = this.normalizeUserName(chat.getUserName());
    }

    await this.assertSignalServiceHealth();

    this.logger.info("Signal adapter initialized", {
      botPhoneNumber: this.botPhoneNumber,
      apiBaseUrl: this.apiBaseUrl,
      userName: this._userName,
    });
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    if (this.webhookSecret) {
      const headerValue = request.headers.get(this.webhookSecretHeader);
      if (headerValue !== this.webhookSecret) {
        this.logger.warn("Signal webhook rejected due to invalid secret token");
        return new Response("Invalid webhook secret", { status: 401 });
      }
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!this.chat) {
      this.logger.warn(
        "Chat instance not initialized, ignoring Signal webhook"
      );
      return new Response("OK", { status: 200 });
    }

    const updates = this.extractUpdatesFromPayload(payload);
    if (updates.length === 0) {
      this.logger.debug("Signal webhook payload contained no receive updates");
      return new Response("OK", { status: 200 });
    }

    for (const update of updates) {
      this.handleIncomingUpdate(update, options);
    }

    return new Response("OK", { status: 200 });
  }

  startPolling(options: SignalPollingOptions = {}): void {
    if (this.pollingTask) {
      this.logger.debug("Signal polling already running");
      return;
    }

    const intervalMs = this.normalizePositiveInteger(
      options.intervalMs,
      DEFAULT_POLLING_INTERVAL_MS,
      MIN_POLLING_INTERVAL_MS
    );

    const timeoutSeconds =
      typeof options.timeoutSeconds === "number"
        ? Math.max(0, Math.trunc(options.timeoutSeconds))
        : undefined;

    const abortController = new AbortController();
    this.pollingAbortController = abortController;

    this.pollingTask = this.runPollingLoop(
      {
        intervalMs,
        timeoutSeconds,
        webhookOptions: options.webhookOptions,
      },
      abortController.signal
    )
      .catch((error) => {
        if (!abortController.signal.aborted) {
          this.logger.error("Signal polling loop failed", {
            error: String(error),
          });
        }
      })
      .finally(() => {
        if (this.pollingAbortController === abortController) {
          this.pollingAbortController = null;
        }
        this.pollingTask = null;
      });
  }

  async stopPolling(): Promise<void> {
    this.pollingAbortController?.abort();
    await this.pollingTask;
  }

  async pollOnce(options: SignalPollingOptions = {}): Promise<number> {
    const timeoutQuery =
      typeof options.timeoutSeconds === "number"
        ? `?timeout=${Math.max(0, Math.trunc(options.timeoutSeconds))}`
        : "";

    const payload = await this.signalFetch<unknown>(
      `/v1/receive/${encodeURIComponent(this.botPhoneNumber)}${timeoutQuery}`,
      {
        method: "GET",
      },
      "receive"
    );

    const updates = this.extractUpdatesFromPayload(payload);
    if (updates.length === 0) {
      return 0;
    }

    for (const update of updates) {
      this.handleIncomingUpdate(update, options.webhookOptions);
    }

    return updates.length;
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<SignalRawMessage>> {
    const parsedThread = this.resolveThreadId(threadId);

    const card = extractCard(message);
    const renderedText = this.truncateMessage(
      this.renderOutgoingText(message, card)
    );
    const files = extractFiles(message);

    if (!(renderedText.trim() || files.length > 0)) {
      throw new ValidationError(
        SIGNAL_ADAPTER_NAME,
        "Signal message cannot be empty"
      );
    }

    const payload: SignalSendMessageRequest = {
      number: this.botPhoneNumber,
      recipients: [parsedThread.chatId],
      message: renderedText,
    };

    if (files.length > 0) {
      payload.base64_attachments = await this.toSignalAttachmentPayload(files);
    }

    const textMode = this.resolveOutgoingTextMode(message, card !== null);
    if (textMode) {
      payload.text_mode = textMode;
    }

    const response = await this.signalFetch<SignalSendMessageResponse>(
      "/v2/send",
      {
        method: "POST",
        body: payload,
      },
      "sendMessage"
    );

    const sentTimestamp = this.parseSignalTimestamp(response.timestamp, "send");
    const resultingThreadId = this.encodeThreadId(parsedThread);

    const outgoingMessage = this.createOutgoingMessage({
      chatId: parsedThread.chatId,
      edited: false,
      text: renderedText,
      threadId: resultingThreadId,
      timestamp: sentTimestamp,
    });

    this.cacheMessage(outgoingMessage);

    return {
      id: outgoingMessage.id,
      threadId: outgoingMessage.threadId,
      raw: outgoingMessage.raw,
    };
  }

  async postChannelMessage(
    channelId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<SignalRawMessage>> {
    const threadId = this.encodeThreadId({ chatId: channelId });
    return this.postMessage(threadId, message);
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<SignalRawMessage>> {
    const parsedThread = this.resolveThreadId(threadId);
    const resultingThreadId = this.encodeThreadId(parsedThread);
    const decodedMessageId = this.decodeMessageId(messageId);

    const card = extractCard(message);
    const renderedText = this.truncateMessage(
      this.renderOutgoingText(message, card)
    );
    const files = extractFiles(message);

    if (!(renderedText.trim() || files.length > 0)) {
      throw new ValidationError(
        SIGNAL_ADAPTER_NAME,
        "Signal message cannot be empty"
      );
    }

    const payload: SignalSendMessageRequest = {
      number: this.botPhoneNumber,
      recipients: [parsedThread.chatId],
      message: renderedText,
      edit_timestamp: decodedMessageId.timestamp,
    };

    if (files.length > 0) {
      payload.base64_attachments = await this.toSignalAttachmentPayload(files);
    }

    const textMode = this.resolveOutgoingTextMode(message, card !== null);
    if (textMode) {
      payload.text_mode = textMode;
    }

    const response = await this.signalFetch<SignalSendMessageResponse>(
      "/v2/send",
      {
        method: "POST",
        body: payload,
      },
      "editMessage"
    );

    const editedAtTimestamp = this.parseSignalTimestamp(
      response.timestamp,
      "edit"
    );

    const existing =
      (this.messageCache.get(resultingThreadId) ?? []).find(
        (cachedMessage) => cachedMessage.id === messageId
      ) ??
      this.findCachedMessageByTimestamp(
        resultingThreadId,
        decodedMessageId.timestamp
      );

    const updatedMessage = existing
      ? new Message<SignalRawMessage>({
          ...existing,
          text: renderedText,
          formatted: this.formatConverter.toAst(renderedText),
          metadata: {
            ...existing.metadata,
            edited: true,
            editedAt: this.signalTimestampToDate(editedAtTimestamp),
          },
        })
      : this.createOutgoingMessage({
          author: decodedMessageId.author,
          chatId: parsedThread.chatId,
          edited: true,
          editedAtTimestamp,
          text: renderedText,
          threadId: resultingThreadId,
          timestamp: decodedMessageId.timestamp,
        });

    this.cacheMessage(updatedMessage);

    return {
      id: updatedMessage.id,
      threadId: updatedMessage.threadId,
      raw: updatedMessage.raw,
    };
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const parsedThread = this.resolveThreadId(threadId);
    const decodedMessageId = this.decodeMessageId(messageId);

    const payload: SignalRemoteDeleteRequest = {
      recipient: parsedThread.chatId,
      timestamp: decodedMessageId.timestamp,
    };

    await this.signalFetch<unknown>(
      `/v1/remote-delete/${encodeURIComponent(this.botPhoneNumber)}`,
      {
        method: "DELETE",
        body: payload,
      },
      "deleteMessage"
    );

    this.deleteCachedMessage(messageId);
    this.deleteCachedMessagesByTimestamp(
      this.encodeThreadId(parsedThread),
      decodedMessageId.timestamp
    );
  }

  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const parsedThread = this.resolveThreadId(threadId);
    const decodedMessageId = this.decodeMessageIdForReaction(
      this.encodeThreadId(parsedThread),
      messageId
    );

    const payload: SignalReactionRequest = {
      recipient: parsedThread.chatId,
      reaction: this.toSignalReactionEmoji(emoji),
      target_author: decodedMessageId.author,
      timestamp: decodedMessageId.timestamp,
    };

    await this.signalFetch<unknown>(
      `/v1/reactions/${encodeURIComponent(this.botPhoneNumber)}`,
      {
        method: "POST",
        body: payload,
      },
      "addReaction"
    );
  }

  async removeReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const parsedThread = this.resolveThreadId(threadId);
    const decodedMessageId = this.decodeMessageIdForReaction(
      this.encodeThreadId(parsedThread),
      messageId
    );

    const payload: SignalReactionRequest = {
      recipient: parsedThread.chatId,
      reaction: this.toSignalReactionEmoji(emoji),
      target_author: decodedMessageId.author,
      timestamp: decodedMessageId.timestamp,
    };

    await this.signalFetch<unknown>(
      `/v1/reactions/${encodeURIComponent(this.botPhoneNumber)}`,
      {
        method: "DELETE",
        body: payload,
      },
      "removeReaction"
    );
  }

  async startTyping(threadId: string): Promise<void> {
    const parsedThread = this.resolveThreadId(threadId);

    const payload: SignalTypingIndicatorRequest = {
      recipient: parsedThread.chatId,
    };

    await this.signalFetch<unknown>(
      `/v1/typing-indicator/${encodeURIComponent(this.botPhoneNumber)}`,
      {
        method: "PUT",
        body: payload,
      },
      "startTyping"
    );
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<SignalRawMessage>> {
    const resolvedThreadId = this.encodeThreadId(
      this.resolveThreadId(threadId)
    );

    const messages = [...(this.messageCache.get(resolvedThreadId) ?? [])].sort(
      (a, b) => this.compareMessages(a, b)
    );

    return this.paginateMessages(messages, options);
  }

  async fetchChannelMessages(
    channelId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<SignalRawMessage>> {
    const threadId = this.encodeThreadId({ chatId: channelId });
    return this.fetchMessages(threadId, options);
  }

  async fetchMessage(
    threadId: string,
    messageId: string
  ): Promise<Message<SignalRawMessage> | null> {
    const normalizedThreadId = this.encodeThreadId(
      this.resolveThreadId(threadId)
    );

    const threadMessages = this.messageCache.get(normalizedThreadId) ?? [];
    const directMatch = threadMessages.find(
      (message) => message.id === messageId
    );

    return (
      directMatch ??
      this.findCachedMessageByTimestamp(
        normalizedThreadId,
        this.decodeMessageId(messageId).timestamp
      ) ??
      null
    );
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const parsedThread = this.resolveThreadId(threadId);
    const isGroup = this.isGroupChatId(parsedThread.chatId);

    let channelName: string | undefined;
    let metadata: Record<string, unknown> = {};

    if (isGroup) {
      const group = await this.fetchGroup(parsedThread.chatId).catch(
        () => null
      );
      if (group) {
        channelName = group.name;
        metadata = { group };
      }
    }

    return {
      id: this.encodeThreadId(parsedThread),
      channelId: parsedThread.chatId,
      channelName,
      isDM: !isGroup,
      metadata,
    };
  }

  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const isGroup = this.isGroupChatId(channelId);

    if (!isGroup) {
      return {
        id: channelId,
        isDM: true,
        name: channelId,
        metadata: {},
      };
    }

    const group = await this.fetchGroup(channelId);

    const memberCount = Array.isArray(group.members)
      ? group.members.length
      : undefined;

    return {
      id: channelId,
      isDM: false,
      name: group.name,
      memberCount,
      metadata: { group },
    };
  }

  channelIdFromThreadId(threadId: string): string {
    return this.resolveThreadId(threadId).chatId;
  }

  async openDM(userId: string): Promise<string> {
    const normalizedUserId = this.fromSignalUserId(userId);

    if (this.isGroupChatId(normalizedUserId)) {
      throw new ValidationError(
        SIGNAL_ADAPTER_NAME,
        "openDM expects a user identifier, not a group identifier"
      );
    }

    return this.encodeThreadId({ chatId: normalizedUserId });
  }

  isDM(threadId: string): boolean {
    return !this.isGroupChatId(this.resolveThreadId(threadId).chatId);
  }

  encodeThreadId(platformData: SignalThreadId): string {
    if (!platformData.chatId) {
      throw new ValidationError(
        SIGNAL_ADAPTER_NAME,
        "Signal thread chatId cannot be empty"
      );
    }

    const normalizedChatId = this.normalizeSignalIdentifier(
      platformData.chatId
    );
    const chatId = this.isGroupChatId(normalizedChatId)
      ? this.normalizeGroupId(normalizedChatId)
      : this.canonicalizeIdentifier(normalizedChatId);

    return `${SIGNAL_THREAD_PREFIX}${chatId}`;
  }

  decodeThreadId(threadId: string): SignalThreadId {
    if (!threadId.startsWith(SIGNAL_THREAD_PREFIX)) {
      throw new ValidationError(
        SIGNAL_ADAPTER_NAME,
        `Invalid Signal thread ID: ${threadId}`
      );
    }

    const chatId = threadId.slice(SIGNAL_THREAD_PREFIX.length);
    if (!chatId) {
      throw new ValidationError(
        SIGNAL_ADAPTER_NAME,
        `Invalid Signal thread ID: ${threadId}`
      );
    }

    const normalizedChatId = this.normalizeSignalIdentifier(chatId);

    return {
      chatId: this.isGroupChatId(normalizedChatId)
        ? this.normalizeGroupId(normalizedChatId)
        : this.canonicalizeIdentifier(normalizedChatId),
    };
  }

  parseMessage(raw: SignalRawMessage): Message<SignalRawMessage> {
    const message = this.messageFromRaw(raw);
    this.cacheMessage(message);
    return message;
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  private messageFromRaw(
    raw: SignalRawMessage,
    options: { skipSyncMessages?: boolean } = {}
  ): Message<SignalRawMessage> {
    if (this.isOutgoingRawMessage(raw)) {
      return this.createOutgoingMessage({
        author: raw.author,
        chatId: raw.recipient,
        edited: raw.edited ?? false,
        text: raw.text,
        threadId: this.encodeThreadId({ chatId: raw.recipient }),
        timestamp: raw.timestamp,
      });
    }

    const update = this.unwrapToSignalUpdate(raw);
    if (!update) {
      throw new ValidationError(
        SIGNAL_ADAPTER_NAME,
        "Cannot parse Signal raw message payload"
      );
    }

    const dataMessage = update.envelope.dataMessage;
    if (dataMessage && !dataMessage.reaction && !dataMessage.remoteDelete) {
      const threadId = this.threadIdFromEnvelope(update.envelope, dataMessage);
      return this.createMessageFromDataMessage(update, dataMessage, threadId, {
        edited: false,
      });
    }

    const editMessage = update.envelope.editMessage;
    if (editMessage?.dataMessage) {
      const threadId = this.threadIdFromEnvelope(
        update.envelope,
        editMessage.dataMessage
      );
      return this.createMessageFromDataMessage(
        update,
        editMessage.dataMessage,
        threadId,
        {
          edited: true,
          messageIdTimestamp: editMessage.targetSentTimestamp,
          editedAtTimestamp:
            editMessage.dataMessage.timestamp ?? update.envelope.timestamp,
        }
      );
    }

    const syncSentMessage = update.envelope.syncMessage?.sentMessage;
    if (syncSentMessage && !options.skipSyncMessages) {
      return this.createMessageFromSyncSentMessage(update, syncSentMessage);
    }

    throw new ValidationError(
      SIGNAL_ADAPTER_NAME,
      "Signal raw message does not contain a supported message payload"
    );
  }

  private handleIncomingUpdate(
    update: SignalUpdate,
    options?: WebhookOptions
  ): void {
    const dataMessage = update.envelope.dataMessage;
    if (dataMessage?.reaction) {
      this.handleIncomingReaction(
        update,
        dataMessage.reaction,
        dataMessage,
        options
      );
      return;
    }

    if (dataMessage?.remoteDelete) {
      this.handleIncomingRemoteDelete(update, dataMessage);
      return;
    }

    if (dataMessage && dataMessage.groupInfo?.type !== "UPDATE") {
      this.handleIncomingDataMessage(update, dataMessage, options);
    }

    const editMessage = update.envelope.editMessage;
    if (editMessage?.dataMessage) {
      this.handleIncomingEditMessage(update, editMessage, options);
    }

    const syncSentMessage = update.envelope.syncMessage?.sentMessage;
    if (syncSentMessage) {
      this.handleIncomingSyncSentMessage(update, syncSentMessage, options);
    }
  }

  private handleIncomingDataMessage(
    update: SignalUpdate,
    dataMessage: SignalDataMessage,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      return;
    }

    const threadId = this.threadIdFromEnvelope(update.envelope, dataMessage);
    const message = this.createMessageFromDataMessage(
      update,
      dataMessage,
      threadId,
      {
        edited: false,
      }
    );

    this.cacheMessage(message);
    this.chat.processMessage(this, threadId, message, options);
  }

  private handleIncomingEditMessage(
    update: SignalUpdate,
    editMessage: NonNullable<SignalEnvelope["editMessage"]>,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      return;
    }

    const threadId = this.threadIdFromEnvelope(
      update.envelope,
      editMessage.dataMessage
    );

    const message = this.createMessageFromDataMessage(
      update,
      editMessage.dataMessage,
      threadId,
      {
        edited: true,
        messageIdTimestamp: editMessage.targetSentTimestamp,
        editedAtTimestamp:
          editMessage.dataMessage.timestamp ?? update.envelope.timestamp,
      }
    );

    this.cacheMessage(message);
    this.chat.processMessage(this, threadId, message, options);
  }

  private handleIncomingRemoteDelete(
    update: SignalUpdate,
    dataMessage: SignalDataMessage
  ): void {
    const remoteDelete = dataMessage.remoteDelete;
    if (!remoteDelete) {
      return;
    }

    const threadId = this.threadIdFromEnvelope(update.envelope, dataMessage);
    this.deleteCachedMessagesByTimestamp(threadId, remoteDelete.timestamp);
  }

  private handleIncomingSyncSentMessage(
    update: SignalUpdate,
    sentMessage: SignalSyncSentMessage,
    options?: WebhookOptions
  ): void {
    const message = this.createMessageFromSyncSentMessage(update, sentMessage);
    this.cacheMessage(message);

    if (!this.chat) {
      return;
    }

    this.chat.processMessage(this, message.threadId, message, options);
  }

  private handleIncomingReaction(
    update: SignalUpdate,
    reaction: SignalReaction,
    dataMessage: SignalDataMessage,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      return;
    }

    const threadId = this.threadIdFromEnvelope(update.envelope, dataMessage);
    const targetAuthor = this.resolveReactionTargetAuthor(reaction);
    const cachedTargetMessage = this.findCachedMessageByTimestamp(
      threadId,
      reaction.targetSentTimestamp
    );

    const messageId =
      cachedTargetMessage?.id ??
      (targetAuthor
        ? this.encodeMessageId(targetAuthor, reaction.targetSentTimestamp)
        : undefined);

    if (!messageId) {
      this.logger.warn(
        "Skipping Signal reaction event with missing targetAuthor",
        {
          reaction,
        }
      );
      return;
    }

    this.chat.processReaction(
      {
        adapter: this,
        threadId,
        messageId,
        emoji: defaultEmojiResolver.fromGChat(reaction.emoji),
        rawEmoji: reaction.emoji,
        added: !reaction.isRemove,
        user: this.toAuthor(update.envelope),
        raw: update,
      },
      options
    );
  }

  private unwrapToSignalUpdate(payload: unknown): SignalUpdate | null {
    if (this.isSignalUpdate(payload)) {
      return payload;
    }

    if (this.isSignalJsonRpcReceivePayload(payload)) {
      return payload.params ?? null;
    }

    return null;
  }

  private extractUpdatesFromPayload(payload: unknown): SignalUpdate[] {
    if (Array.isArray(payload)) {
      return payload
        .map((entry) => this.unwrapToSignalUpdate(entry))
        .filter((entry): entry is SignalUpdate => entry !== null);
    }

    const single = this.unwrapToSignalUpdate(payload);
    return single ? [single] : [];
  }

  private isSignalUpdate(payload: unknown): payload is SignalUpdate {
    if (!(payload && typeof payload === "object")) {
      return false;
    }

    return "envelope" in payload;
  }

  private isSignalJsonRpcReceivePayload(
    payload: unknown
  ): payload is SignalJsonRpcReceivePayload {
    if (!(payload && typeof payload === "object")) {
      return false;
    }

    const record = payload as Record<string, unknown>;
    return (
      record.method === "receive" &&
      Boolean(record.params) &&
      typeof record.params === "object"
    );
  }

  private threadIdFromEnvelope(
    envelope: SignalEnvelope,
    dataMessage?: SignalDataMessage
  ): string {
    const chatId = this.chatIdFromEnvelope(envelope, dataMessage);
    return this.encodeThreadId({ chatId });
  }

  private chatIdFromEnvelope(
    envelope: SignalEnvelope,
    dataMessage?: SignalDataMessage
  ): string {
    const groupId = dataMessage?.groupInfo?.groupId;
    if (groupId) {
      return this.normalizeIncomingGroupId(groupId);
    }

    const sourceId = this.resolveEnvelopeSourceIdentifier(envelope);
    if (sourceId) {
      return sourceId;
    }

    throw new ValidationError(
      SIGNAL_ADAPTER_NAME,
      "Could not determine Signal chat ID from incoming update"
    );
  }

  private createMessageFromDataMessage(
    update: SignalUpdate,
    dataMessage: SignalDataMessage,
    threadId: string,
    options: SignalParsedMessageOptions
  ): Message<SignalRawMessage> {
    const authorIdentifier =
      this.resolveEnvelopeSourceIdentifier(update.envelope) ??
      this.botPhoneNumber;
    const messageIdTimestamp =
      options.messageIdTimestamp ??
      dataMessage.timestamp ??
      update.envelope.timestamp;

    if (!messageIdTimestamp) {
      throw new ValidationError(
        SIGNAL_ADAPTER_NAME,
        "Signal message did not include a timestamp"
      );
    }

    const existingMessage = options.edited
      ? (this.findCachedMessageByTimestamp(threadId, messageIdTimestamp) ??
        this.findCachedMessageByTimestampAcrossThreads(messageIdTimestamp))
      : undefined;

    const existingMessageAuthor = existingMessage
      ? this.decodeMessageIdRaw(existingMessage.id).author
      : undefined;

    const messageId = existingMessageAuthor
      ? this.encodeMessageIdRaw(existingMessageAuthor, messageIdTimestamp)
      : this.encodeMessageId(authorIdentifier, messageIdTimestamp);

    const text = dataMessage.message ?? "";

    const message = new Message<SignalRawMessage>({
      id: messageId,
      threadId,
      text,
      formatted: this.formatConverter.toAst(text),
      raw: {
        account: update.account,
        envelope: update.envelope,
      },
      author: this.toAuthor(update.envelope),
      metadata: {
        dateSent: this.signalTimestampToDate(
          dataMessage.timestamp ??
            update.envelope.timestamp ??
            messageIdTimestamp
        ),
        edited: Boolean(options.edited),
        editedAt: options.edited
          ? this.signalTimestampToDate(
              options.editedAtTimestamp ??
                dataMessage.timestamp ??
                update.envelope.timestamp ??
                messageIdTimestamp
            )
          : undefined,
      },
      attachments: this.extractIncomingAttachments(dataMessage),
      isMention: this.isBotMentioned(dataMessage, text),
    });

    return message;
  }

  private createMessageFromSyncSentMessage(
    update: SignalUpdate,
    sentMessage: SignalSyncSentMessage
  ): Message<SignalRawMessage> {
    const timestamp = sentMessage.timestamp ?? update.envelope.timestamp;
    if (!timestamp) {
      throw new ValidationError(
        SIGNAL_ADAPTER_NAME,
        "Signal sync message did not include a timestamp"
      );
    }

    const chatId = this.chatIdFromSyncSentMessage(update, sentMessage);
    const threadId = this.encodeThreadId({ chatId });
    const authorIdentifier =
      this.resolveEnvelopeSourceIdentifier(update.envelope) ??
      this.normalizeSignalIdentifier(this.botPhoneNumber);
    const isLinkedDeviceSync = this.isLinkedDeviceSyncMessage(update.envelope);
    const authorName = update.envelope.sourceName ?? this._userName;
    const text = sentMessage.message ?? "";

    return new Message<SignalRawMessage>({
      id: this.encodeMessageId(authorIdentifier, timestamp),
      threadId,
      text,
      formatted: this.formatConverter.toAst(text),
      raw: {
        account: update.account,
        envelope: update.envelope,
      },
      author: {
        userId: this.toSignalUserId(authorIdentifier),
        userName: authorName,
        fullName: authorName,
        isBot: isLinkedDeviceSync ? "unknown" : true,
        isMe: !isLinkedDeviceSync,
      },
      metadata: {
        dateSent: this.signalTimestampToDate(timestamp),
        edited: false,
      },
      attachments: this.extractIncomingAttachments({
        timestamp,
        message: sentMessage.message,
        attachments: sentMessage.attachments,
        mentions: sentMessage.mentions,
        groupInfo: sentMessage.groupInfo,
      }),
      isMention: false,
    });
  }

  private chatIdFromSyncSentMessage(
    update: SignalUpdate,
    sentMessage: SignalSyncSentMessage
  ): string {
    const groupId = sentMessage.groupInfo?.groupId;
    if (groupId) {
      return this.normalizeIncomingGroupId(groupId);
    }

    const destination = sentMessage.destination ?? sentMessage.destinationUuid;
    if (destination) {
      return this.normalizeSignalIdentifier(destination);
    }

    const envelopeSource = this.resolveEnvelopeSourceIdentifier(
      update.envelope
    );
    if (envelopeSource) {
      return envelopeSource;
    }

    return this.botPhoneNumber;
  }

  private createOutgoingMessage(params: {
    author?: string;
    chatId: string;
    edited: boolean;
    editedAtTimestamp?: number;
    text: string;
    threadId: string;
    timestamp: number;
  }): Message<SignalRawMessage> {
    const authorIdentifier = params.author ?? this.botPhoneNumber;
    const sdkUserId = this.toSignalUserId(authorIdentifier);
    const dateSent = this.signalTimestampToDate(params.timestamp);

    const raw: SignalOutgoingRawMessage = {
      kind: "outgoing",
      author: authorIdentifier,
      recipient: params.chatId,
      text: params.text,
      timestamp: params.timestamp,
      edited: params.edited,
    };

    return new Message<SignalRawMessage>({
      id: this.encodeMessageId(authorIdentifier, params.timestamp),
      threadId: params.threadId,
      text: params.text,
      formatted: this.formatConverter.toAst(params.text),
      raw,
      author: {
        userId: sdkUserId,
        userName: this._userName,
        fullName: this._userName,
        isBot: true,
        isMe: true,
      },
      metadata: {
        dateSent,
        edited: params.edited,
        editedAt:
          params.edited && params.editedAtTimestamp
            ? this.signalTimestampToDate(params.editedAtTimestamp)
            : undefined,
      },
      attachments: [],
      isMention: false,
    });
  }

  private extractIncomingAttachments(
    dataMessage: SignalDataMessage
  ): Attachment[] {
    if (!dataMessage.attachments?.length) {
      return [];
    }

    return dataMessage.attachments.map((attachment) => ({
      type: this.mapAttachmentType(attachment.contentType),
      size: attachment.size,
      width: attachment.width,
      height: attachment.height,
      name: attachment.filename ?? undefined,
      mimeType: attachment.contentType,
      fetchData: async () => this.downloadAttachment(attachment.id),
    }));
  }

  private mapAttachmentType(mimeType?: string): Attachment["type"] {
    const normalized = mimeType?.toLowerCase() ?? "";

    if (normalized.startsWith("image/")) {
      return "image";
    }
    if (normalized.startsWith("video/")) {
      return "video";
    }
    if (normalized.startsWith("audio/")) {
      return "audio";
    }

    return "file";
  }

  private async downloadAttachment(attachmentId: string): Promise<Buffer> {
    return this.signalFetchBinary(
      `/v1/attachments/${encodeURIComponent(attachmentId)}`,
      "downloadAttachment"
    );
  }

  private toAuthor(envelope: SignalEnvelope): SignalMessageAuthor {
    const sourceIdentifier =
      this.resolveEnvelopeSourceIdentifier(envelope) ?? "unknown";

    const userName =
      envelope.sourceName ??
      envelope.sourceNumber ??
      envelope.sourceUuid ??
      envelope.source ??
      sourceIdentifier;

    const isMe =
      this.normalizeSignalIdentifier(sourceIdentifier) ===
      this.normalizeSignalIdentifier(this.botPhoneNumber);

    return {
      userId: this.toSignalUserId(sourceIdentifier),
      userName,
      fullName: envelope.sourceName ?? userName,
      isBot: isMe ? true : "unknown",
      isMe,
    };
  }

  private isLinkedDeviceSyncMessage(envelope: SignalEnvelope): boolean {
    return (
      typeof envelope.sourceDevice === "number" && envelope.sourceDevice > 1
    );
  }

  private resolveEnvelopeSourceIdentifier(
    envelope: SignalEnvelope
  ): string | undefined {
    return this.registerIdentifierAliases(
      envelope.sourceNumber ?? undefined,
      envelope.sourceUuid,
      envelope.source
    );
  }

  private resolveReactionTargetAuthor(
    reaction: SignalReaction
  ): string | undefined {
    return this.registerIdentifierAliases(
      reaction.targetAuthorNumber ?? undefined,
      reaction.targetAuthorUuid,
      reaction.targetAuthor
    );
  }

  private isBotMentioned(
    dataMessage: SignalDataMessage,
    text: string
  ): boolean {
    if (!(text || dataMessage.mentions?.length)) {
      return false;
    }

    const mentionedBot = (dataMessage.mentions ?? []).some((mention) => {
      const mentionedAuthor = mention.author ?? mention.number ?? mention.uuid;
      if (!mentionedAuthor) {
        return false;
      }

      return (
        this.normalizeSignalIdentifier(mentionedAuthor) ===
        this.normalizeSignalIdentifier(this.botPhoneNumber)
      );
    });

    if (mentionedBot) {
      return true;
    }

    if (!text) {
      return false;
    }

    const mentionRegex = new RegExp(
      `@${this.escapeRegex(this._userName)}\\b`,
      "i"
    );
    return mentionRegex.test(text);
  }

  private async toSignalAttachmentPayload(
    files: ReturnType<typeof extractFiles>
  ): Promise<string[]> {
    const payload: string[] = [];

    for (const file of files) {
      const buffer = await this.toBuffer(file.data);
      payload.push(
        this.toDataUri(
          buffer,
          file.mimeType ?? "application/octet-stream",
          file.filename
        )
      );
    }

    return payload;
  }

  private async toBuffer(data: Buffer | Blob | ArrayBuffer): Promise<Buffer> {
    if (Buffer.isBuffer(data)) {
      return data;
    }

    if (data instanceof ArrayBuffer) {
      return Buffer.from(data);
    }

    if (data instanceof Blob) {
      return Buffer.from(await data.arrayBuffer());
    }

    throw new ValidationError(
      SIGNAL_ADAPTER_NAME,
      "Unsupported file data type"
    );
  }

  private toDataUri(
    buffer: Buffer,
    mimeType: string,
    filename?: string
  ): string {
    const encodedName = filename
      ? `;filename=${encodeURIComponent(filename)}`
      : "";
    return `data:${mimeType}${encodedName};base64,${buffer.toString("base64")}`;
  }

  private renderOutgoingText(
    message: AdapterPostableMessage,
    card: ReturnType<typeof extractCard>
  ): string {
    const rendered = card
      ? cardToFallbackText(card, { boldFormat: "**" })
      : this.formatConverter.renderPostable(message);

    return convertEmojiPlaceholders(rendered, "gchat");
  }

  private resolveOutgoingTextMode(
    message: AdapterPostableMessage,
    hasCard: boolean
  ): SignalTextMode | undefined {
    if (this.configuredTextMode) {
      return this.configuredTextMode;
    }

    if (hasCard) {
      return "styled";
    }

    if (typeof message === "string") {
      return undefined;
    }

    if ("raw" in message) {
      return undefined;
    }

    if ("markdown" in message || "ast" in message) {
      return "styled";
    }

    return undefined;
  }

  private decodeMessageIdForReaction(
    threadId: string,
    messageId: string
  ): { author: string; timestamp: number } {
    const decoded = this.decodeMessageId(messageId);

    const threadMessages = this.messageCache.get(threadId) ?? [];
    const fromCache = threadMessages.find(
      (message) => message.id === messageId
    );
    if (fromCache) {
      const cachedDecoded = this.decodeMessageIdRaw(fromCache.id);
      if (cachedDecoded.author) {
        return {
          author: cachedDecoded.author,
          timestamp: cachedDecoded.timestamp,
        };
      }
    }

    const fromTimestamp = this.findCachedMessageByTimestamp(
      threadId,
      decoded.timestamp
    );
    if (fromTimestamp) {
      const timestampDecoded = this.decodeMessageIdRaw(fromTimestamp.id);
      if (timestampDecoded.author) {
        return {
          author: timestampDecoded.author,
          timestamp: timestampDecoded.timestamp,
        };
      }
    }

    if (decoded.author) {
      return {
        author: decoded.author,
        timestamp: decoded.timestamp,
      };
    }

    throw new ValidationError(
      SIGNAL_ADAPTER_NAME,
      `Signal reaction requires a message ID in <author>|<timestamp> format, got: ${messageId}`
    );
  }

  private encodeMessageId(author: string, timestamp: number): string {
    return this.encodeMessageIdRaw(
      this.canonicalizeIdentifier(author),
      timestamp
    );
  }

  private encodeMessageIdRaw(author: string, timestamp: number): string {
    return `${this.normalizeSignalIdentifier(author)}|${timestamp}`;
  }

  private decodeMessageId(messageId: string): {
    author?: string;
    timestamp: number;
  } {
    const decoded = this.decodeMessageIdRaw(messageId);
    if (!decoded.author) {
      return decoded;
    }

    return {
      author: this.canonicalizeIdentifier(decoded.author),
      timestamp: decoded.timestamp,
    };
  }

  private decodeMessageIdRaw(messageId: string): {
    author?: string;
    timestamp: number;
  } {
    const matched = messageId.match(MESSAGE_ID_PATTERN);
    if (matched) {
      const [, author, rawTimestamp] = matched;
      const timestamp = Number.parseInt(rawTimestamp, 10);
      if (Number.isFinite(timestamp)) {
        return {
          author: this.normalizeSignalIdentifier(author),
          timestamp,
        };
      }
    }

    const fallbackTimestamp = Number.parseInt(messageId, 10);
    if (Number.isFinite(fallbackTimestamp)) {
      return {
        timestamp: fallbackTimestamp,
      };
    }

    throw new ValidationError(
      SIGNAL_ADAPTER_NAME,
      `Invalid Signal message ID: ${messageId}`
    );
  }

  private messageTimestamp(messageId: string): number {
    try {
      return this.decodeMessageIdRaw(messageId).timestamp;
    } catch {
      return 0;
    }
  }

  private signalTimestampToDate(timestamp: number): Date {
    if (timestamp < 1_000_000_000_000) {
      return new Date(timestamp * 1000);
    }

    return new Date(timestamp);
  }

  private parseSignalTimestamp(
    timestamp: number | string,
    context: string
  ): number {
    const parsed =
      typeof timestamp === "number"
        ? timestamp
        : Number.parseInt(timestamp, 10);

    if (!Number.isFinite(parsed)) {
      throw new NetworkError(
        SIGNAL_ADAPTER_NAME,
        `Signal ${context} response contained an invalid timestamp`
      );
    }

    return parsed;
  }

  private resolveThreadId(value: string): SignalThreadId {
    if (value.startsWith(SIGNAL_THREAD_PREFIX)) {
      return this.decodeThreadId(value);
    }

    const normalized = this.normalizeSignalIdentifier(value);

    return {
      chatId: this.isGroupChatId(normalized)
        ? this.normalizeGroupId(normalized)
        : this.canonicalizeIdentifier(normalized),
    };
  }

  private fromSignalUserId(userId: string): string {
    const normalized = userId.startsWith(`${SIGNAL_THREAD_PREFIX}`)
      ? this.normalizeSignalIdentifier(
          userId.slice(SIGNAL_THREAD_PREFIX.length)
        )
      : this.normalizeSignalIdentifier(userId);

    return this.canonicalizeIdentifier(normalized);
  }

  private toSignalUserId(userId: string): string {
    const normalized = this.canonicalizeIdentifier(userId);
    return `${SIGNAL_THREAD_PREFIX}${normalized}`;
  }

  private normalizeGroupId(groupId: string): string {
    const normalized = this.normalizeSignalIdentifier(groupId);
    const encodedGroupId = normalized.startsWith(SIGNAL_GROUP_PREFIX)
      ? normalized.slice(SIGNAL_GROUP_PREFIX.length)
      : normalized;

    if (!encodedGroupId) {
      throw new ValidationError(
        SIGNAL_ADAPTER_NAME,
        "Signal group ID is empty"
      );
    }

    return `${SIGNAL_GROUP_PREFIX}${this.normalizeEncodedGroupId(encodedGroupId)}`;
  }

  private normalizeIncomingGroupId(groupId: string): string {
    const normalized = this.normalizeSignalIdentifier(groupId);

    if (!normalized) {
      throw new ValidationError(
        SIGNAL_ADAPTER_NAME,
        "Signal group ID is empty"
      );
    }

    if (normalized.startsWith(SIGNAL_GROUP_PREFIX)) {
      return this.normalizeGroupId(normalized);
    }

    return `${SIGNAL_GROUP_PREFIX}${Buffer.from(normalized, "binary").toString("base64")}`;
  }

  private normalizeEncodedGroupId(encodedGroupId: string): string {
    if (!BASE64_OR_BASE64URL_PATTERN.test(encodedGroupId)) {
      throw new ValidationError(
        SIGNAL_ADAPTER_NAME,
        `Invalid Signal group ID: ${encodedGroupId}`
      );
    }

    const base64 = encodedGroupId.replace(/-/g, "+").replace(/_/g, "/");
    const paddingLength = (4 - (base64.length % 4)) % 4;
    const padded = `${base64}${"=".repeat(paddingLength)}`;

    if (!this.isCanonicalBase64(padded)) {
      throw new ValidationError(
        SIGNAL_ADAPTER_NAME,
        `Invalid Signal group ID: ${encodedGroupId}`
      );
    }

    return padded;
  }

  private isCanonicalBase64(value: string): boolean {
    try {
      const decoded = Buffer.from(value, "base64");
      if (decoded.length === 0) {
        return false;
      }

      const normalizedValue = value.replace(
        TRAILING_BASE64_PADDING_PATTERN,
        ""
      );
      const roundTrip = decoded
        .toString("base64")
        .replace(TRAILING_BASE64_PADDING_PATTERN, "");

      return normalizedValue === roundTrip;
    } catch {
      return false;
    }
  }

  private isGroupChatId(chatId: string): boolean {
    return chatId.startsWith(SIGNAL_GROUP_PREFIX);
  }

  private normalizeBaseUrl(baseUrl: string): string {
    const withScheme =
      baseUrl.startsWith("http://") || baseUrl.startsWith("https://")
        ? baseUrl
        : `http://${baseUrl}`;

    return withScheme.replace(TRAILING_SLASHES_REGEX, "");
  }

  private normalizeSignalIdentifier(value: string): string {
    return value.trim();
  }

  private canonicalizeIdentifier(value: string): string {
    const normalized = this.normalizeSignalIdentifier(value);
    if (!normalized) {
      return normalized;
    }

    const visited = new Set<string>();
    let current = normalized;

    while (!visited.has(current)) {
      visited.add(current);
      const aliased = this.identifierAliases.get(current);
      if (!aliased || aliased === current) {
        return current;
      }
      current = aliased;
    }

    return current;
  }

  private registerIdentifierAliases(
    ...identifiers: Array<string | null | undefined>
  ): string | undefined {
    const normalized = identifiers
      .map((identifier) =>
        identifier ? this.normalizeSignalIdentifier(identifier) : undefined
      )
      .filter((identifier): identifier is string => Boolean(identifier));

    if (normalized.length === 0) {
      return undefined;
    }

    const canonicalCandidate =
      normalized.find((identifier) => this.isPhoneNumber(identifier)) ??
      normalized[0];

    if (!canonicalCandidate) {
      return undefined;
    }

    const canonical = this.canonicalizeIdentifier(canonicalCandidate);

    for (const identifier of normalized) {
      this.identifierAliases.set(identifier, canonical);
    }

    return canonical;
  }

  private isPhoneNumber(value: string): boolean {
    return SIGNAL_PHONE_NUMBER_PATTERN.test(value);
  }

  private normalizeUserName(value: string): string {
    return value.replace(LEADING_AT_PATTERN, "").trim() || "bot";
  }

  private escapeRegex(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private truncateMessage(text: string): string {
    if (text.length <= SIGNAL_MESSAGE_LIMIT) {
      return text;
    }

    return `${text.slice(0, SIGNAL_MESSAGE_LIMIT - 3)}...`;
  }

  private compareMessages(
    a: Message<SignalRawMessage>,
    b: Message<SignalRawMessage>
  ): number {
    const timestampDifference =
      a.metadata.dateSent.getTime() - b.metadata.dateSent.getTime();
    if (timestampDifference !== 0) {
      return timestampDifference;
    }

    return this.messageTimestamp(a.id) - this.messageTimestamp(b.id);
  }

  private cacheMessage(message: Message<SignalRawMessage>): void {
    const existing = this.messageCache.get(message.threadId) ?? [];
    const index = existing.findIndex((item) => item.id === message.id);

    if (index >= 0) {
      existing[index] = message;
    } else {
      existing.push(message);
    }

    existing.sort((a, b) => this.compareMessages(a, b));
    this.messageCache.set(message.threadId, existing);
  }

  private findCachedMessageByTimestamp(
    threadId: string,
    timestamp: number
  ): Message<SignalRawMessage> | undefined {
    const messages = this.messageCache.get(threadId) ?? [];
    return messages.find(
      (message) => this.messageTimestamp(message.id) === timestamp
    );
  }

  private findCachedMessageByTimestampAcrossThreads(
    timestamp: number
  ): Message<SignalRawMessage> | undefined {
    for (const messages of this.messageCache.values()) {
      const matchedMessage = messages.find(
        (message) => this.messageTimestamp(message.id) === timestamp
      );
      if (matchedMessage) {
        return matchedMessage;
      }
    }

    return undefined;
  }

  private deleteCachedMessage(messageId: string): void {
    for (const [threadId, messages] of this.messageCache.entries()) {
      const filtered = messages.filter((message) => message.id !== messageId);
      if (filtered.length === 0) {
        this.messageCache.delete(threadId);
      } else if (filtered.length !== messages.length) {
        this.messageCache.set(threadId, filtered);
      }
    }
  }

  private deleteCachedMessagesByTimestamp(
    threadId: string,
    timestamp: number
  ): void {
    const messages = this.messageCache.get(threadId);
    if (!messages) {
      return;
    }

    const filtered = messages.filter(
      (message) => this.messageTimestamp(message.id) !== timestamp
    );

    if (filtered.length === 0) {
      this.messageCache.delete(threadId);
      return;
    }

    if (filtered.length !== messages.length) {
      this.messageCache.set(threadId, filtered);
    }
  }

  private paginateMessages(
    messages: Message<SignalRawMessage>[],
    options: FetchOptions
  ): FetchResult<SignalRawMessage> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    const direction = options.direction ?? "backward";

    if (messages.length === 0) {
      return { messages: [] };
    }

    const indexById = new Map(
      messages.map((message, index) => [message.id, index])
    );

    if (direction === "backward") {
      const end =
        options.cursor && indexById.has(options.cursor)
          ? (indexById.get(options.cursor) ?? messages.length)
          : messages.length;
      const start = Math.max(0, end - limit);
      const page = messages.slice(start, end);

      return {
        messages: page,
        nextCursor: start > 0 ? page[0]?.id : undefined,
      };
    }

    const start =
      options.cursor && indexById.has(options.cursor)
        ? (indexById.get(options.cursor) ?? -1) + 1
        : 0;

    const end = Math.min(messages.length, start + limit);
    const page = messages.slice(start, end);

    return {
      messages: page,
      nextCursor: end < messages.length ? page.at(-1)?.id : undefined,
    };
  }

  private toSignalReactionEmoji(emoji: EmojiValue | string): string {
    if (typeof emoji !== "string") {
      return defaultEmojiResolver.toGChat(emoji.name);
    }

    const placeholderMatch = emoji.match(EMOJI_PLACEHOLDER_PATTERN);
    if (placeholderMatch) {
      return defaultEmojiResolver.toGChat(placeholderMatch[1]);
    }

    if (EMOJI_NAME_PATTERN.test(emoji)) {
      return defaultEmojiResolver.toGChat(emoji.toLowerCase());
    }

    return emoji;
  }

  private async fetchGroup(chatId: string): Promise<SignalGroup> {
    return this.signalFetch<SignalGroup>(
      `/v1/groups/${encodeURIComponent(this.botPhoneNumber)}/${encodeURIComponent(chatId)}`,
      {
        method: "GET",
      },
      "fetchGroup"
    );
  }

  private isOutgoingRawMessage(
    raw: SignalRawMessage
  ): raw is SignalOutgoingRawMessage {
    return (
      raw && typeof raw === "object" && "kind" in raw && raw.kind === "outgoing"
    );
  }

  private normalizePositiveInteger(
    value: number | undefined,
    fallback: number,
    minimum = 1
  ): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fallback;
    }

    return Math.max(minimum, Math.trunc(value));
  }

  private async assertSignalServiceHealth(): Promise<void> {
    await this.signalFetch<unknown>(
      "/v1/health",
      {
        method: "GET",
      },
      "healthCheck"
    );

    const accountsPayload = await this.signalFetch<unknown>(
      "/v1/accounts",
      {
        method: "GET",
      },
      "listAccounts"
    );

    if (!Array.isArray(accountsPayload)) {
      this.logger.warn("Signal /v1/accounts response was not an array", {
        accountsPayloadType: typeof accountsPayload,
      });
      return;
    }

    const normalizedAccounts = accountsPayload
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => this.normalizeSignalIdentifier(entry));

    if (normalizedAccounts.includes(this.botPhoneNumber)) {
      return;
    }

    const knownAccounts =
      normalizedAccounts.length > 0 ? normalizedAccounts.join(", ") : "<none>";

    throw new ValidationError(
      SIGNAL_ADAPTER_NAME,
      `Configured phone number ${this.botPhoneNumber} is not registered in signal-cli-rest-api (known accounts: ${knownAccounts})`
    );
  }

  private async runPollingLoop(
    options: {
      intervalMs: number;
      timeoutSeconds?: number;
      webhookOptions?: WebhookOptions;
    },
    signal: AbortSignal
  ): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.pollOnce({
          timeoutSeconds: options.timeoutSeconds,
          webhookOptions: options.webhookOptions,
        });
      } catch (error) {
        if (signal.aborted) {
          break;
        }

        this.logger.warn("Signal polling request failed", {
          error: String(error),
        });
      }

      if (signal.aborted) {
        break;
      }

      await this.waitForPollingInterval(options.intervalMs, signal);
    }
  }

  private async waitForPollingInterval(
    intervalMs: number,
    signal: AbortSignal
  ): Promise<void> {
    if (intervalMs <= 0 || signal.aborted) {
      return;
    }

    await new Promise<void>((resolve) => {
      const cleanup = (): void => {
        signal.removeEventListener("abort", onAbort);
      };

      const finish = (): void => {
        cleanup();
        resolve();
      };

      const onAbort = (): void => {
        clearTimeout(timeout);
        finish();
      };

      const timeout = setTimeout(finish, intervalMs);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private async signalFetch<TResult>(
    path: string,
    init: {
      body?: unknown;
      method: "GET" | "POST" | "PUT" | "DELETE";
    },
    operation: string
  ): Promise<TResult> {
    const url = `${this.apiBaseUrl}${path}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method,
        headers:
          init.body === undefined
            ? undefined
            : {
                "Content-Type": "application/json",
              },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch (error) {
      throw new NetworkError(
        SIGNAL_ADAPTER_NAME,
        `Network error while calling Signal ${operation}`,
        error instanceof Error ? error : undefined
      );
    }

    const responseText = await response.text();
    const parsedBody = this.parseResponseBody(responseText);

    if (!response.ok) {
      this.throwSignalApiError(operation, response.status, parsedBody);
    }

    if (!responseText.trim()) {
      return undefined as TResult;
    }

    return parsedBody as TResult;
  }

  private async signalFetchBinary(
    path: string,
    operation: string
  ): Promise<Buffer> {
    const url = `${this.apiBaseUrl}${path}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
      });
    } catch (error) {
      throw new NetworkError(
        SIGNAL_ADAPTER_NAME,
        `Network error while calling Signal ${operation}`,
        error instanceof Error ? error : undefined
      );
    }

    if (!response.ok) {
      const text = await response.text();
      this.throwSignalApiError(
        operation,
        response.status,
        this.parseResponseBody(text)
      );
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private parseResponseBody(payload: string): unknown {
    if (!payload.trim()) {
      return undefined;
    }

    try {
      return JSON.parse(payload);
    } catch {
      return payload;
    }
  }

  private throwSignalApiError(
    operation: string,
    status: number,
    payload: unknown
  ): never {
    const message = this.extractErrorMessage(payload, operation);

    if (status === 429) {
      throw new AdapterRateLimitError(SIGNAL_ADAPTER_NAME);
    }

    if (status === 401) {
      throw new AuthenticationError(SIGNAL_ADAPTER_NAME, message);
    }

    if (status === 403) {
      throw new PermissionError(SIGNAL_ADAPTER_NAME, operation);
    }

    if (status === 404) {
      throw new ResourceNotFoundError(SIGNAL_ADAPTER_NAME, operation);
    }

    if (status >= 400 && status < 500) {
      throw new ValidationError(SIGNAL_ADAPTER_NAME, message);
    }

    throw new NetworkError(
      SIGNAL_ADAPTER_NAME,
      `${message} (status ${status})`
    );
  }

  private extractErrorMessage(payload: unknown, operation: string): string {
    if (typeof payload === "string" && payload.trim()) {
      return payload;
    }

    if (payload && typeof payload === "object") {
      const typed = payload as SignalApiErrorResponse;
      if (typed.error) {
        return typed.error;
      }
      if (typed.message) {
        return typed.message;
      }
    }

    return `Signal API ${operation} failed`;
  }
}

export function createSignalAdapter(
  config?: Partial<SignalAdapterConfig & { logger: Logger; userName?: string }>
): SignalAdapter {
  const phoneNumber = config?.phoneNumber ?? process.env.SIGNAL_PHONE_NUMBER;

  if (!phoneNumber) {
    throw new ValidationError(
      SIGNAL_ADAPTER_NAME,
      "phoneNumber is required. Set SIGNAL_PHONE_NUMBER or provide it in config."
    );
  }

  const textModeFromEnv = process.env.SIGNAL_TEXT_MODE;
  const textMode =
    config?.textMode ??
    (textModeFromEnv === "normal" || textModeFromEnv === "styled"
      ? textModeFromEnv
      : undefined);

  if (
    textModeFromEnv &&
    textModeFromEnv !== "normal" &&
    textModeFromEnv !== "styled"
  ) {
    throw new ValidationError(
      SIGNAL_ADAPTER_NAME,
      "SIGNAL_TEXT_MODE must be either 'normal' or 'styled'"
    );
  }

  return new SignalAdapter({
    phoneNumber,
    baseUrl:
      config?.baseUrl ??
      process.env.SIGNAL_SERVICE_URL ??
      process.env.SIGNAL_SERVICE ??
      DEFAULT_SIGNAL_API_BASE_URL,
    textMode,
    webhookSecret: config?.webhookSecret ?? process.env.SIGNAL_WEBHOOK_SECRET,
    webhookSecretHeader:
      config?.webhookSecretHeader ?? process.env.SIGNAL_WEBHOOK_SECRET_HEADER,
    logger: config?.logger ?? new ConsoleLogger("info").child("signal"),
    userName: config?.userName ?? process.env.SIGNAL_BOT_USERNAME,
  });
}

export { SignalFormatConverter } from "./markdown";
export type {
  SignalAdapterConfig,
  SignalDataMessage,
  SignalEnvelope,
  SignalGroup,
  SignalJsonRpcReceivePayload,
  SignalOutgoingRawMessage,
  SignalRawMessage,
  SignalReaction,
  SignalSyncMessage,
  SignalSyncSentMessage,
  SignalThreadId,
  SignalUpdate,
} from "./types";
