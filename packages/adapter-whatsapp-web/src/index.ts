/**
 * WhatsApp Web adapter for chat-sdk.
 *
 * Uses whatsapp-web.js library which manages WhatsApp Web through Puppeteer.
 * This adapter requires a persistent session to maintain the WhatsApp connection.
 *
 * Important: WhatsApp doesn't have a traditional webhook model. Instead, the client
 * connects via WebSocket and receives events in real-time. The handleWebhook method
 * is provided for consistency but the primary message flow is through event listeners.
 */

import {
  cardToFallbackText,
  extractCard,
  extractFiles,
  NetworkError,
  toBuffer,
  ValidationError,
} from "@chat-adapter/shared";
import type {
  Adapter,
  AdapterPostableMessage,
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
import type WAWebJS from "whatsapp-web.js";
import { getMessageMediaClass, initializeClient } from "./client";
import { handleIncomingMessage, handleReaction } from "./events";
import { WhatsAppFormatConverter } from "./markdown";
import type { WhatsAppAdapterConfig, WhatsAppThreadId } from "./types";

export class WhatsAppAdapter implements Adapter<WhatsAppThreadId, unknown> {
  readonly name = "whatsapp";
  readonly userName: string;
  readonly botUserId?: string;

  private client: WAWebJS.Client | null = null;
  private chat: ChatInstance | null = null;
  private readonly logger: Logger;
  private readonly formatConverter = new WhatsAppFormatConverter();
  private readonly sessionPath: string;
  private readonly puppeteerOptions: Record<string, unknown>;
  private readonly allowedNumbers: Set<string>;
  private readonly blockedNumbers: Set<string>;
  private readonly allowedGroups: Set<string>;
  private readonly requireMentionInGroups: boolean;
  private isReady = false;
  private qrCode: string | null = null;

  constructor(config: WhatsAppAdapterConfig) {
    this.logger = config.logger;
    this.userName = config.userName ?? "bot";
    this.sessionPath = config.sessionPath ?? ".wwebjs_auth";
    this.puppeteerOptions = config.puppeteerOptions ?? {};
    this.allowedNumbers = new Set(
      (config.allowedNumbers ?? []).map((n) =>
        n.includes("@") ? n : `${n.replace(/\D/g, "")}@c.us`
      )
    );
    this.blockedNumbers = new Set(
      (config.blockedNumbers ?? []).map((n) =>
        n.includes("@") ? n : `${n.replace(/\D/g, "")}@c.us`
      )
    );
    this.allowedGroups = new Set(
      (config.allowedGroups ?? []).map((g) =>
        g.includes("@") ? g : `${g}@g.us`
      )
    );
    this.requireMentionInGroups = config.requireMentionInGroups ?? false;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.client = await initializeClient(
      {
        sessionPath: this.sessionPath,
        puppeteerOptions: this.puppeteerOptions,
      },
      this.logger
    );
    this.setupEventListeners();
    this.logger.info("WhatsApp adapter initializing...");
  }

  private setupEventListeners(): void {
    if (!this.client) return;

    this.client.on("qr", (qr: string) => {
      this.qrCode = qr;
      this.logger.info(
        "WhatsApp QR code received. Scan with your phone to authenticate."
      );
    });

    this.client.on("authenticated", () => {
      this.logger.info("WhatsApp authenticated successfully");
    });

    this.client.on("auth_failure", (msg: string) => {
      this.logger.error("WhatsApp authentication failed", { error: msg });
    });

    this.client.on("ready", () => {
      this.isReady = true;
      const info = this.client?.info;
      if (info) {
        (this as { botUserId: string }).botUserId = info.wid._serialized;
      }
      this.logger.info("WhatsApp client ready", { botUserId: this.botUserId });
    });

    this.client.on("disconnected", (reason: string) => {
      this.isReady = false;
      this.logger.warn("WhatsApp disconnected", { reason });
    });

    this.client.on("message_create", async (message: WAWebJS.Message) => {
      if (message.fromMe) return;
      await handleIncomingMessage(message, this.getEventContext());
    });

    this.client.on("message_reaction", async (reaction: WAWebJS.Reaction) => {
      await handleReaction(reaction, this.getEventContext());
    });
  }

  private getEventContext() {
    return {
      chat: this.chat,
      logger: this.logger,
      formatConverter: this.formatConverter,
      botUserId: this.botUserId,
      allowedNumbers: this.allowedNumbers,
      blockedNumbers: this.blockedNumbers,
      allowedGroups: this.allowedGroups,
      requireMentionInGroups: this.requireMentionInGroups,
      encodeThreadId: this.encodeThreadId.bind(this),
      adapter: this as Adapter,
    };
  }

  async start(): Promise<void> {
    if (!this.client) {
      throw new Error(
        "WhatsApp client not initialized. Call initialize() first."
      );
    }
    await this.client.initialize();
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
      this.isReady = false;
    }
  }

  getQRCode(): string | null {
    return this.qrCode;
  }

  isConnected(): boolean {
    return this.isReady;
  }

  async handleWebhook(
    _request: Request,
    _options?: WebhookOptions
  ): Promise<Response> {
    return new Response(
      JSON.stringify({
        message:
          "WhatsApp uses real-time WebSocket connection, not webhooks. Use start() to connect.",
        isConnected: this.isReady,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<unknown>> {
    if (!this.client || !this.isReady) {
      throw new NetworkError("whatsapp", "WhatsApp client not connected");
    }

    const { chatId } = this.decodeThreadId(threadId);

    const card = extractCard(message);
    let content: string;

    if (card) {
      content = cardToFallbackText(card, {
        boldFormat: "*",
        lineBreak: "\n",
        platform: "whatsapp",
      });
    } else {
      content = convertEmojiPlaceholders(
        this.formatConverter.renderPostable(message),
        "whatsapp" //need to add platform 
      );
    }

    const files = extractFiles(message);

    this.logger.debug("WhatsApp: sending message", {
      chatId,
      contentLength: content.length,
      fileCount: files.length,
    });

    let result: WAWebJS.Message;

    if (files.length > 0) {
      const MessageMedia = await getMessageMediaClass();
      let lastSent: WAWebJS.Message | undefined;
      for (const file of files) {
        const buffer = await toBuffer(file.data, { platform: "whatsapp" });
        if (!buffer) continue;
        const media = new MessageMedia(
          file.mimeType || "application/octet-stream",
          buffer.toString("base64"),
          file.filename
        );
        lastSent = await this.client.sendMessage(chatId, media, {
          caption: content,
        });
      }
      result = lastSent ?? (await this.client.sendMessage(chatId, content));
    } else {
      result = await this.client.sendMessage(chatId, content);
    }

    this.logger.debug("WhatsApp: message sent", {
      messageId: result.id._serialized,
    });

    return {
      id: result.id._serialized,
      threadId,
      raw: result,
    };
  }

  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage
  ): Promise<RawMessage<unknown>> {
    throw new NetworkError(
      "whatsapp",
      "WhatsApp does not support editing messages via the Web API"
    );
  }

  /**
   * Reply directly to a specific message (quotes the original).
   * This uses WhatsApp's native reply feature.
   */
  async replyToMessage(
    threadId: string,
    messageId: string,
    content: string | AdapterPostableMessage
  ): Promise<RawMessage<unknown>> {
    if (!this.client || !this.isReady) {
      throw new NetworkError("whatsapp", "WhatsApp client not connected");
    }

    const { chatId } = this.decodeThreadId(threadId);
    const chat = await this.client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 50 });
    const targetMessage = messages.find((m) => m.id._serialized === messageId);

    if (!targetMessage) {
      throw new ValidationError("whatsapp", `Message not found: ${messageId}`);
    }

    const text =
      typeof content === "string"
        ? content
        : this.formatConverter.renderPostable(content);

    const result = await targetMessage.reply(text);

    this.logger.debug("WhatsApp: replied to message", {
      messageId,
      replyId: result.id._serialized,
    });

    return {
      id: result.id._serialized,
      threadId,
      raw: result,
    };
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    if (!this.client || !this.isReady) {
      throw new NetworkError("whatsapp", "WhatsApp client not connected");
    }

    const { chatId } = this.decodeThreadId(threadId);
    const chat = await this.client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 50 });
    const targetMessage = messages.find((m) => m.id._serialized === messageId);

    if (targetMessage && targetMessage.fromMe) {
      await targetMessage.delete(true);
      this.logger.debug("WhatsApp: message deleted", { messageId });
    } else {
      this.logger.warn(
        "WhatsApp: cannot delete message (not found or not ours)",
        { messageId }
      );
    }
  }

  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    if (!this.client || !this.isReady) {
      throw new NetworkError("whatsapp", "WhatsApp client not connected");
    }

    const { chatId } = this.decodeThreadId(threadId);
    const chat = await this.client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 50 });
    const targetMessage = messages.find((m) => m.id._serialized === messageId);

    if (targetMessage) {
      const emojiStr =
        typeof emoji === "string" ? emoji : defaultEmojiResolver.toGChat(emoji);
      await targetMessage.react(emojiStr);
      this.logger.debug("WhatsApp: reaction added", {
        messageId,
        emoji: emojiStr,
      });
    }
  }

  async removeReaction(
    threadId: string,
    messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    if (!this.client || !this.isReady) {
      throw new NetworkError("whatsapp", "WhatsApp client not connected");
    }

    const { chatId } = this.decodeThreadId(threadId);
    const chat = await this.client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 50 });
    const targetMessage = messages.find((m) => m.id._serialized === messageId);

    if (targetMessage) {
      await targetMessage.react("");
      this.logger.debug("WhatsApp: reaction removed", { messageId });
    }
  }

  async startTyping(threadId: string, _status?: string): Promise<void> {
    if (!this.client || !this.isReady) return;

    const { chatId } = this.decodeThreadId(threadId);
    const chat = await this.client.getChatById(chatId);
    await chat.sendStateTyping();
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<unknown>> {
    if (!this.client || !this.isReady) {
      throw new NetworkError("whatsapp", "WhatsApp client not connected");
    }

    const { chatId } = this.decodeThreadId(threadId);
    const chat = await this.client.getChatById(chatId);
    const limit = options.limit || 50;

    const rawMessages = await chat.fetchMessages({ limit });

    const messages = await Promise.all(
      rawMessages.map(async (msg) => {
        const contact = await msg.getContact();
        return new Message({
          id: msg.id._serialized,
          threadId,
          text: this.formatConverter.extractPlainText(msg.body),
          formatted: this.formatConverter.toAst(msg.body),
          raw: msg,
          author: {
            userId: contact.id._serialized,
            userName:
              contact.pushname || contact.name || contact.id.user || "unknown",
            fullName:
              contact.name || contact.pushname || contact.id.user || "unknown",
            isBot: false,
            isMe: msg.fromMe,
          },
          metadata: {
            dateSent: new Date(msg.timestamp * 1000),
            edited: false,
          },
          attachments: [],
        });
      })
    );

    return { messages, nextCursor: undefined };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    if (!this.client || !this.isReady) {
      throw new NetworkError("whatsapp", "WhatsApp client not connected");
    }

    const { chatId } = this.decodeThreadId(threadId);
    const chat = await this.client.getChatById(chatId);
    const isGroup = chat.isGroup;

    return {
      id: threadId,
      channelId: chatId,
      channelName: chat.name,
      isDM: !isGroup,
      metadata: { isGroup, raw: chat },
    };
  }

  async openDM(userId: string): Promise<string> {
    const chatId = userId.includes("@c.us") ? userId : `${userId}@c.us`;
    return this.encodeThreadId({ chatId });
  }

  isDM(threadId: string): boolean {
    const { chatId } = this.decodeThreadId(threadId);
    return chatId.includes("@c.us");
  }

  encodeThreadId(platformData: WhatsAppThreadId): string {
    return `whatsapp:${platformData.chatId}`;
  }

  decodeThreadId(threadId: string): WhatsAppThreadId {
    const parts = threadId.split(":");
    if (parts.length < 2 || parts[0] !== "whatsapp") {
      throw new ValidationError(
        "whatsapp",
        `Invalid WhatsApp thread ID: ${threadId}`
      );
    }
    return { chatId: parts.slice(1).join(":") };
  }

  parseMessage(raw: unknown): Message<unknown> {
    const msg = raw as WAWebJS.Message;
    const threadId = this.encodeThreadId({ chatId: msg.from });

    return new Message({
      id: msg.id._serialized,
      threadId,
      text: this.formatConverter.extractPlainText(msg.body),
      formatted: this.formatConverter.toAst(msg.body),
      raw: msg,
      author: {
        userId: msg.author || msg.from,
        userName: msg.author || msg.from,
        fullName: msg.author || msg.from,
        isBot: false,
        isMe: msg.fromMe,
      },
      metadata: {
        dateSent: new Date(msg.timestamp * 1000),
        edited: false,
      },
      attachments: [],
    });
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  channelIdFromThreadId(threadId: string): string {
    return threadId;
  }

  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const threadInfo = await this.fetchThread(channelId);
    return {
      id: channelId,
      name: threadInfo.channelName,
      isDM: threadInfo.isDM,
      metadata: threadInfo.metadata,
    };
  }
}

export function createWhatsAppAdapter(
  config?: Partial<WhatsAppAdapterConfig>
): WhatsAppAdapter {
  const resolved: WhatsAppAdapterConfig = {
    logger: config?.logger ?? new ConsoleLogger("info").child("whatsapp"),
    userName: config?.userName,
    sessionPath: config?.sessionPath ?? process.env.WHATSAPP_SESSION_PATH,
    puppeteerOptions: config?.puppeteerOptions,
    allowedNumbers: config?.allowedNumbers,
    blockedNumbers: config?.blockedNumbers,
    allowedGroups: config?.allowedGroups,
    requireMentionInGroups: config?.requireMentionInGroups,
  };
  return new WhatsAppAdapter(resolved);
}

export {
  WhatsAppFormatConverter,
  WhatsAppFormatConverter as WhatsAppMarkdownConverter,
} from "./markdown";
export type { WhatsAppAdapterConfig, WhatsAppThreadId } from "./types";
