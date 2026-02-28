import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractFiles, ValidationError } from "@chat-adapter/shared";
import type { MessageResponse } from "@photon-ai/advanced-imessage-kit";
import { AdvancedIMessageKit } from "@photon-ai/advanced-imessage-kit";
import type { Message as IMessageLocalMessage } from "@photon-ai/imessage-kit";
import { IMessageSDK } from "@photon-ai/imessage-kit";
import type {
  Adapter,
  AdapterPostableMessage,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FileUpload,
  FormattedContent,
  Logger,
  RawMessage,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import {
  ConsoleLogger,
  Message,
  NotImplementedError,
  parseMarkdown,
} from "chat";
import { iMessageFormatConverter } from "./markdown";
import type { iMessageGatewayMessageData, iMessageThreadId } from "./types";

export { iMessageFormatConverter } from "./markdown";
export type {
  iMessageGatewayMessageData,
  iMessageThreadId,
  NativeWebhookPayload,
} from "./types";

export interface iMessageAdapterLocalConfig {
  apiKey?: string;
  local: true;
  logger: Logger;
  serverUrl?: string;
}

export interface iMessageAdapterRemoteConfig {
  apiKey: string;
  local: false;
  logger: Logger;
  serverUrl: string;
}

export type iMessageAdapterConfig =
  | iMessageAdapterLocalConfig
  | iMessageAdapterRemoteConfig;

export class iMessageAdapter implements Adapter {
  readonly name = "imessage";
  readonly userName: string = "";
  readonly local: boolean;
  readonly serverUrl?: string;
  readonly apiKey?: string;
  readonly sdk: IMessageSDK | AdvancedIMessageKit;

  private chat: ChatInstance | null = null;
  private readonly logger: Logger;
  private readonly formatConverter = new iMessageFormatConverter();

  constructor(config: iMessageAdapterConfig) {
    if (config.local && process.platform !== "darwin") {
      throw new ValidationError(
        "imessage",
        "iMessage adapter local mode requires macOS. Current platform: " +
          process.platform
      );
    }

    this.local = config.local;
    this.serverUrl = config.serverUrl;
    this.apiKey = config.apiKey;
    this.logger = config.logger;

    if (config.local) {
      this.sdk = new IMessageSDK();
    } else {
      this.sdk = AdvancedIMessageKit.getInstance({
        serverUrl: config.serverUrl,
        apiKey: config.apiKey,
      });
    }
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger.info("iMessage adapter initialized", {
      local: this.local,
      serverUrl: this.serverUrl ? "configured" : "not configured",
    });

    if (!this.local) {
      const sdk = this.sdk as AdvancedIMessageKit;
      await sdk.connect();
      await new Promise<void>((resolve) => sdk.once("ready", resolve));
    }
  }

  async handleWebhook(
    _request: Request,
    _options?: WebhookOptions
  ): Promise<Response> {
    return new Response(
      "Webhook not supported — use startGatewayListener()",
      { status: 501 }
    );
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage> {
    const { chatGuid } = this.decodeThreadId(threadId);
    const text = this.formatConverter.renderPostable(message);
    const files = extractFiles(message);
    const tempFiles =
      files.length > 0 ? await this.writeTempFiles(files) : null;

    try {
      if (this.local) {
        const sdk = this.sdk as IMessageSDK;
        // sdk.send() expects the core identifier (phone/email/chatId), not the full GUID.
        // chatGuid format: "iMessage;-;+1234567890" or "iMessage;+;chat123..."
        // Extract last part after final semicolon.
        const recipient = chatGuid.split(";").pop() ?? chatGuid;
        const content = tempFiles?.paths.length
          ? { text: text || undefined, files: tempFiles.paths }
          : text;
        const result = await sdk.send(recipient, content);
        return {
          id: result.message?.guid ?? `local-${Date.now()}`,
          threadId,
          raw: result,
        };
      }

      // Remote: sdk.messages.sendMessage() takes the full chatGuid directly
      const sdk = this.sdk as AdvancedIMessageKit;
      let result: MessageResponse | undefined;

      if (text || !tempFiles) {
        result = await sdk.messages.sendMessage({
          chatGuid,
          message: text,
        });
      }

      if (tempFiles) {
        for (const filePath of tempFiles.paths) {
          const attachmentResult = await sdk.attachments.sendAttachment({
            chatGuid,
            filePath,
          });
          result ??= attachmentResult;
        }
      }

      return {
        id: result?.guid ?? `msg-${Date.now()}`,
        threadId,
        raw: result,
      };
    } finally {
      if (tempFiles) {
        await rm(tempFiles.dir, { recursive: true }).catch(() => {});
      }
    }
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage> {
    if (this.local) {
      throw new NotImplementedError(
        "editMessage is not supported in local mode",
        "editMessage"
      );
    }

    const text = this.formatConverter.renderPostable(message);
    const sdk = this.sdk as AdvancedIMessageKit;
    const result = await sdk.messages.editMessage({
      messageGuid: messageId,
      editedMessage: text,
      backwardsCompatibilityMessage: text,
    });
    return {
      id: result.guid,
      threadId,
      raw: result,
    };
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    throw new NotImplementedError(
      "deleteMessage is not implemented",
      "deleteMessage"
    );
  }

  parseMessage(raw: unknown): Message {
    const data = this.local
      ? this.normalizeLocalMessage(raw as IMessageLocalMessage)
      : this.normalizeRemoteMessage(raw as MessageResponse);
    return this.buildMessage(data);
  }

  async fetchMessages(
    threadId: string,
    options?: FetchOptions
  ): Promise<FetchResult> {
    const { chatGuid } = this.decodeThreadId(threadId);
    const direction = options?.direction ?? "backward";
    const limit = options?.limit ?? 50;
    const cursor = options?.cursor;

    if (this.local) {
      return this.fetchMessagesLocal(chatGuid, direction, limit, cursor);
    }

    return this.fetchMessagesRemote(chatGuid, direction, limit, cursor);
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    if (this.local) {
      throw new NotImplementedError(
        "fetchThread is not supported in local mode",
        "fetchThread"
      );
    }

    const { chatGuid } = this.decodeThreadId(threadId);
    const sdk = this.sdk as AdvancedIMessageKit;
    const chat = await sdk.chats.getChat(chatGuid);
    const isGroupChat = chat.style > 43;

    return {
      id: threadId,
      channelId: chatGuid,
      channelName: chat.displayName || undefined,
      isDM: !isGroupChat,
      metadata: {
        chatIdentifier: chat.chatIdentifier,
        style: chat.style,
        participants: chat.participants,
        isArchived: chat.isArchived,
        raw: chat,
      },
    };
  }

  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    if (this.local) {
      throw new NotImplementedError(
        "addReaction is not supported in local mode",
        "addReaction"
      );
    }

    const tapback = this.emojiToTapback(emoji);
    const { chatGuid } = this.decodeThreadId(threadId);
    const sdk = this.sdk as AdvancedIMessageKit;
    await sdk.messages.sendReaction({
      chatGuid,
      messageGuid: messageId,
      reaction: tapback,
    });
  }

  async removeReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    if (this.local) {
      throw new NotImplementedError(
        "removeReaction is not supported in local mode",
        "removeReaction"
      );
    }

    const tapback = this.emojiToTapback(emoji);
    const { chatGuid } = this.decodeThreadId(threadId);
    const sdk = this.sdk as AdvancedIMessageKit;
    await sdk.messages.sendReaction({
      chatGuid,
      messageGuid: messageId,
      reaction: `-${tapback}`,
    });
  }

  async startTyping(threadId: string, _status?: string): Promise<void> {
    if (this.local) {
      throw new NotImplementedError(
        "startTyping is not supported in local mode",
        "startTyping"
      );
    }

    const { chatGuid } = this.decodeThreadId(threadId);
    const sdk = this.sdk as AdvancedIMessageKit;
    await sdk.chats.startTyping(chatGuid);
    setTimeout(() => sdk.chats.stopTyping(chatGuid), 3000);
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  encodeThreadId(platformData: iMessageThreadId): string {
    return `imessage:${platformData.chatGuid}`;
  }

  decodeThreadId(threadId: string): iMessageThreadId {
    if (!threadId.startsWith("imessage:")) {
      throw new ValidationError(
        "imessage",
        `Invalid iMessage thread ID: ${threadId}`
      );
    }
    return { chatGuid: threadId.slice("imessage:".length) };
  }

  /**
   * Check if a thread is a direct message (one-on-one) conversation.
   * DM chatGuids use ";-;" (e.g., "iMessage;-;+1234567890")
   * Group chatGuids use ";+;" (e.g., "iMessage;+;chat123456")
   */
  isDM(threadId: string): boolean {
    const { chatGuid } = this.decodeThreadId(threadId);
    return chatGuid.includes(";-;");
  }

  /**
   * Start listening for incoming iMessage messages via the Gateway pattern.
   *
   * In local mode, uses IMessageSDK.startWatching() to poll for new messages.
   * In remote mode, creates a dedicated AdvancedIMessageKit socket.io connection.
   *
   * Messages are processed directly via the Chat instance. For webhook-based
   * message ingestion (e.g. imessage-kit running on a separate Mac), use
   * handleWebhook() instead.
   */
  async startGatewayListener(
    options: WebhookOptions,
    durationMs = 180000,
    abortSignal?: AbortSignal
  ): Promise<Response> {
    if (!this.chat) {
      return new Response("Chat instance not initialized", { status: 500 });
    }

    if (!options.waitUntil) {
      return new Response("waitUntil not provided", { status: 500 });
    }

    this.logger.info("Starting iMessage Gateway listener", {
      durationMs,
      mode: this.local ? "local" : "remote",
    });

    const listenerPromise = this.runGatewayListener(durationMs, abortSignal);

    options.waitUntil(listenerPromise);

    return new Response(
      JSON.stringify({
        status: "listening",
        durationMs,
        mode: this.local ? "local" : "remote",
        message: `Gateway listener started, will run for ${durationMs / 1000} seconds`,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  private async runGatewayListener(
    durationMs: number,
    abortSignal?: AbortSignal
  ): Promise<void> {
    let isShuttingDown = false;

    // Create a dedicated instance for remote mode so closing it doesn't
    // affect the shared this.sdk singleton used by other methods.
    let remoteGatewaySdk: AdvancedIMessageKit | null = null;

    try {
      if (this.local) {
        const sdk = this.sdk as IMessageSDK;

        await sdk.startWatching({
          onMessage: async (message: IMessageLocalMessage) => {
            if (isShuttingDown) {
              return;
            }
            if (message.isFromMe) {
              return;
            }

            const data = this.normalizeLocalMessage(message);
            this.handleGatewayMessage(data);
          },
          onError: (error: Error) => {
            this.logger.error("iMessage local watcher error", {
              error: String(error),
            });
          },
        });
      } else {
        remoteGatewaySdk = new AdvancedIMessageKit({
          serverUrl: this.serverUrl,
          apiKey: this.apiKey,
        });
        await remoteGatewaySdk.connect();

        remoteGatewaySdk.on(
          "new-message",
          async (messageResponse: MessageResponse) => {
            if (isShuttingDown) {
              return;
            }
            if (messageResponse.isFromMe) {
              return;
            }

            const data = this.normalizeRemoteMessage(messageResponse);
            this.handleGatewayMessage(data);
          }
        );
      }

      // Wait for duration or abort signal
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, durationMs);

        if (abortSignal) {
          if (abortSignal.aborted) {
            clearTimeout(timeout);
            resolve();
            return;
          }
          abortSignal.addEventListener(
            "abort",
            () => {
              this.logger.info(
                "iMessage Gateway listener received abort signal"
              );
              clearTimeout(timeout);
              resolve();
            },
            { once: true }
          );
        }
      });

      this.logger.info(
        "iMessage Gateway listener duration elapsed, disconnecting"
      );
    } catch (error) {
      this.logger.error("iMessage Gateway listener error", {
        error: String(error),
      });
    } finally {
      isShuttingDown = true;

      if (this.local) {
        (this.sdk as IMessageSDK).stopWatching();
      } else if (remoteGatewaySdk) {
        await remoteGatewaySdk.close();
      }

      this.logger.info("iMessage Gateway listener stopped");
    }
  }

  private async writeTempFiles(
    files: FileUpload[]
  ): Promise<{ dir: string; paths: string[] }> {
    const dir = await mkdtemp(join(tmpdir(), "imessage-"));
    const paths: string[] = [];
    for (const file of files) {
      let buffer: Buffer;
      if (Buffer.isBuffer(file.data)) {
        buffer = file.data;
      } else if (file.data instanceof Blob) {
        buffer = Buffer.from(await file.data.arrayBuffer());
      } else {
        buffer = Buffer.from(file.data as ArrayBuffer);
      }
      const filePath = join(dir, file.filename);
      await writeFile(filePath, buffer);
      paths.push(filePath);
    }
    return { dir, paths };
  }

  private async fetchMessagesLocal(
    chatGuid: string,
    direction: "forward" | "backward",
    limit: number,
    cursor?: string
  ): Promise<FetchResult> {
    const sdk = this.sdk as IMessageSDK;
    const since =
      direction === "forward" && cursor ? new Date(cursor) : undefined;
    const result = await sdk.getMessages({
      chatId: chatGuid,
      limit: 1000,
      since,
    });

    let messages = [...result.messages].sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    );

    if (direction === "backward" && cursor) {
      const cursorTime = new Date(cursor).getTime();
      messages = messages.filter((m) => m.date.getTime() < cursorTime);
    }

    const isBackward = direction === "backward";
    const start = isBackward ? Math.max(0, messages.length - limit) : 0;
    const selected = messages.slice(start, start + limit);
    const hasMore = isBackward ? start > 0 : messages.length > limit;

    const normalized = selected.map((m) =>
      this.buildMessage(this.normalizeLocalMessage(m))
    );

    let nextCursor: string | undefined;
    if (hasMore && selected.length > 0) {
      nextCursor = isBackward
        ? selected[0].date.toISOString()
        : selected.at(-1)?.date.toISOString();
    }

    return { messages: normalized, nextCursor };
  }

  private async fetchMessagesRemote(
    chatGuid: string,
    direction: "forward" | "backward",
    limit: number,
    cursor?: string
  ): Promise<FetchResult> {
    const sdk = this.sdk as AdvancedIMessageKit;
    const isBackward = direction === "backward";

    const queryOptions: {
      chatGuid: string;
      limit: number;
      sort: "ASC" | "DESC";
      before?: number;
      after?: number;
      with?: string[];
    } = {
      chatGuid,
      limit: limit + 1,
      sort: isBackward ? "DESC" : "ASC",
      with: ["chat", "handle", "attachment"],
    };

    if (cursor) {
      const timestamp = Number(cursor);
      if (isBackward) {
        queryOptions.before = timestamp;
      } else {
        queryOptions.after = timestamp;
      }
    }

    const results = await sdk.messages.getMessages(queryOptions);
    const hasMore = results.length > limit;
    const sliced = hasMore ? results.slice(0, limit) : results;

    if (isBackward) {
      sliced.reverse();
    }

    const normalized = sliced.map((m) =>
      this.buildMessage(this.normalizeRemoteMessage(m))
    );

    let nextCursor: string | undefined;
    if (hasMore && sliced.length > 0) {
      nextCursor = isBackward
        ? String(sliced[0].dateCreated)
        : String(sliced.at(-1)?.dateCreated);
    }

    return { messages: normalized, nextCursor };
  }

  private normalizeLocalMessage(
    message: IMessageLocalMessage
  ): iMessageGatewayMessageData {
    return {
      guid: message.guid,
      text: message.text,
      sender: message.sender,
      senderName: message.senderName,
      chatId: message.chatId,
      isGroupChat: message.isGroupChat,
      isFromMe: message.isFromMe,
      date: message.date.toISOString(),
      attachments: message.attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
      })),
      source: "local",
      raw: message,
    };
  }

  private normalizeRemoteMessage(
    messageResponse: MessageResponse
  ): iMessageGatewayMessageData {
    const chatGuid = messageResponse.chats?.[0]?.guid ?? "";
    const chatStyle = messageResponse.chats?.[0]?.style ?? 0;
    // style 43 = DM (one-on-one), style 45+ = group chat
    const isGroupChat = chatStyle > 43;

    return {
      guid: messageResponse.guid,
      text: messageResponse.text,
      sender: messageResponse.handle?.address ?? "",
      senderName: null,
      chatId: chatGuid,
      isGroupChat,
      isFromMe: messageResponse.isFromMe,
      date: new Date(messageResponse.dateCreated).toISOString(),
      attachments: (messageResponse.attachments ?? []).map((a) => ({
        id: a.guid,
        filename: a.transferName,
        mimeType: a.mimeType ?? "application/octet-stream",
        size: a.totalBytes,
      })),
      source: "remote",
      raw: messageResponse,
    };
  }

  private buildMessage(data: iMessageGatewayMessageData): Message {
    const threadId = this.encodeThreadId({ chatGuid: data.chatId });
    return new Message({
      id: data.guid,
      threadId,
      text: data.text ?? "",
      formatted: parseMarkdown(data.text ?? ""),
      author: {
        userId: data.sender,
        userName: data.senderName ?? data.sender,
        fullName: data.senderName ?? data.sender,
        isBot: false,
        isMe: data.isFromMe,
      },
      metadata: {
        dateSent: new Date(data.date),
        edited: false,
      },
      attachments: data.attachments.map((a) => ({
        type: this.getAttachmentType(a.mimeType),
        name: a.filename,
        mimeType: a.mimeType,
        size: a.size,
      })),
      raw: data.raw ?? data,
      isMention: !data.isGroupChat,
    });
  }

  private handleGatewayMessage(
    data: iMessageGatewayMessageData,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      return;
    }

    const chatMessage = this.buildMessage(data);
    this.chat.processMessage(this, chatMessage.threadId, chatMessage, options);
  }

  private emojiToTapback(emoji: EmojiValue | string): string {
    const name = typeof emoji === "string" ? emoji : emoji.name;
    const tapbackMap: Record<string, string> = {
      heart: "love",
      love: "love",
      thumbs_up: "like",
      like: "like",
      thumbs_down: "dislike",
      dislike: "dislike",
      laugh: "laugh",
      emphasize: "emphasize",
      exclamation: "emphasize",
      question: "question",
    };
    const tapback = tapbackMap[name];
    if (!tapback) {
      throw new ValidationError(
        "imessage",
        `Unsupported iMessage tapback: "${name}". Supported: heart, thumbs_up, thumbs_down, laugh, emphasize, question`
      );
    }
    return tapback;
  }

  private getAttachmentType(
    mimeType?: string
  ): "image" | "video" | "audio" | "file" {
    if (!mimeType) {
      return "file";
    }
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
}

export function createiMessageAdapter(
  config?: Partial<iMessageAdapterConfig>
): iMessageAdapter {
  const local = config?.local ?? process.env.IMESSAGE_LOCAL !== "false";
  const logger = config?.logger ?? new ConsoleLogger("info").child("imessage");

  if (local) {
    return new iMessageAdapter({
      local: true,
      logger,
      serverUrl: config?.serverUrl ?? process.env.IMESSAGE_SERVER_URL,
      apiKey: config?.apiKey ?? process.env.IMESSAGE_API_KEY,
    });
  }

  const serverUrl = config?.serverUrl ?? process.env.IMESSAGE_SERVER_URL;
  if (!serverUrl) {
    throw new ValidationError(
      "imessage",
      "serverUrl is required when local is false. Set IMESSAGE_SERVER_URL or provide it in config."
    );
  }

  const apiKey = config?.apiKey ?? process.env.IMESSAGE_API_KEY;
  if (!apiKey) {
    throw new ValidationError(
      "imessage",
      "apiKey is required when local is false. Set IMESSAGE_API_KEY or provide it in config."
    );
  }

  return new iMessageAdapter({
    local: false,
    logger,
    serverUrl,
    apiKey,
  });
}
