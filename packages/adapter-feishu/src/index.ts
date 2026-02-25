/**
 * Feishu (Lark) adapter for chat-sdk.
 *
 * Uses Feishu Open Platform APIs for sending/receiving messages.
 * Webhook signature verification uses the encrypt key.
 *
 * @see https://open.feishu.cn/document/server-docs/getting-started/getting-started
 */

import crypto from "node:crypto";
import {
  extractCard,
  extractFiles,
  NetworkError,
  toBuffer,
  ValidationError,
} from "@chat-adapter/shared";
import { AppType, Client, Domain } from "@larksuiteoapi/node-sdk";
import type {
  Adapter,
  AdapterPostableMessage,
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
import { cardToFeishuPayload } from "./cards";
import { FeishuFormatConverter } from "./markdown";
import type {
  FeishuAdapterConfig,
  FeishuEventCallback,
  FeishuThreadId,
} from "./types";

const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";

export class FeishuAdapter implements Adapter<FeishuThreadId, unknown> {
  readonly name = "feishu";
  readonly userName: string;
  readonly botUserId?: string;

  private readonly appId: string;
  private readonly appSecret: string;
  private readonly encryptKey?: string;
  private readonly verificationToken?: string;
  private chat: ChatInstance | null = null;
  private readonly logger: Logger;
  private readonly formatConverter = new FeishuFormatConverter();
  private readonly client: Client;

  constructor(
    config: FeishuAdapterConfig & { logger: Logger; userName?: string }
  ) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.encryptKey = config.encryptKey;
    this.verificationToken = config.verificationToken;
    this.logger = config.logger;
    this.userName = config.userName ?? "bot";

    this.client = new Client({
      appId: this.appId,
      appSecret: this.appSecret,
      appType: AppType.SelfBuild,
      domain: Domain.Feishu,
    });
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    // Attempt to fetch bot info to get the bot's open_id
    try {
      const response = await this.feishuFetch("/bot/v3/info", "GET");
      const data = (await response.json()) as {
        bot?: { open_id?: string };
      };
      if (data.bot?.open_id) {
        (this as { botUserId?: string }).botUserId = data.bot.open_id;
      }
    } catch {
      this.logger.debug(
        "Could not fetch bot info (bot user ID will not be available)"
      );
    }

    this.logger.info("Feishu adapter initialized", {
      appId: this.appId,
    });
  }

  /**
   * Handle incoming Feishu webhook (event callback or URL verification challenge).
   */
  async handleWebhook(
    request: Request,
    _options?: WebhookOptions
  ): Promise<Response> {
    let body: string;
    try {
      body = await request.text();
    } catch {
      return new Response("Failed to read body", { status: 400 });
    }

    let payload: FeishuEventCallback;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Decrypt event payload if encrypted
    if (payload.encrypt) {
      if (!this.encryptKey) {
        this.logger.warn(
          "Received encrypted event but no encryptKey is configured"
        );
        return new Response("Encryption key not configured", { status: 400 });
      }
      try {
        const decryptedJson = this.decryptEvent(payload.encrypt);
        payload = JSON.parse(decryptedJson);
      } catch (error) {
        this.logger.error("Failed to decrypt Feishu event", {
          error: String(error),
        });
        return new Response("Decryption failed", { status: 400 });
      }
    }

    // Verify event signature if encryptKey is configured
    // Headers: X-Lark-Request-Timestamp, X-Lark-Request-Nonce, X-Lark-Signature
    if (this.encryptKey) {
      const timestamp = request.headers.get("x-lark-request-timestamp");
      const nonce = request.headers.get("x-lark-request-nonce");
      const signature = request.headers.get("x-lark-signature");

      // Only verify if signature headers are present (they may be absent for URL verification)
      if (timestamp && nonce && signature) {
        const isValid = this.verifySignature(timestamp, nonce, body, signature);
        if (!isValid) {
          this.logger.warn("Feishu event signature verification failed");
          return new Response("Invalid signature", { status: 401 });
        }
      }
    }

    // Handle URL verification challenge
    if (payload.challenge) {
      this.logger.info("Feishu URL verification challenge received");
      return Response.json({ challenge: payload.challenge });
    }

    // Verify token if configured (v1 and v2 events include a token)
    const eventToken = payload.header?.token ?? payload.token;
    if (this.verificationToken && eventToken !== this.verificationToken) {
      this.logger.warn("Feishu verification token mismatch");
      return new Response("Invalid token", { status: 401 });
    }

    // Handle v2 events (schema "2.0")
    const eventType = payload.header?.event_type ?? payload.type;
    this.logger.info("Feishu webhook received", {
      eventType,
      schema: payload.schema,
    });

    if (eventType === "im.message.receive_v1" && payload.event) {
      await this.handleMessageEvent(payload);
    }

    return Response.json({ ok: true });
  }

  /**
   * Handle an incoming message event.
   */
  private async handleMessageEvent(
    payload: FeishuEventCallback
  ): Promise<void> {
    if (!(this.chat && payload.event)) {
      return;
    }

    const event = payload.event;
    const msg = event.message;
    const sender = event.sender;

    // Skip messages from bots
    if (sender.sender_type === "app") {
      this.logger.debug("Ignoring message from app/bot", {
        senderId: sender.sender_id.open_id,
      });
      return;
    }

    const chatId = msg.chat_id;
    // Use root_id if available (threaded reply), otherwise message_id itself is the root
    const rootMessageId = msg.root_id ?? msg.message_id;

    const threadId = this.encodeThreadId({ chatId, messageId: rootMessageId });

    // Parse content
    let textContent = "";
    try {
      if (msg.message_type === "text") {
        const content = JSON.parse(msg.content) as { text?: string };
        textContent = content.text ?? "";
      }
    } catch {
      this.logger.debug("Failed to parse message content", {
        messageId: msg.message_id,
      });
    }

    // Check if bot is mentioned
    const isMentioned =
      msg.mentions?.some((m) => m.id.open_id === this.botUserId) ?? false;

    // Strip mention tags from text for clean display
    let cleanText = textContent;
    if (msg.mentions) {
      for (const mention of msg.mentions) {
        cleanText = cleanText.replace(mention.key, `@${mention.name}`);
      }
    }

    const chatMessage = new Message({
      id: msg.message_id,
      threadId,
      text: cleanText,
      formatted: this.formatConverter.toAst(cleanText),
      author: {
        userId: sender.sender_id.open_id,
        userName: sender.sender_id.open_id,
        fullName: sender.sender_id.open_id,
        isBot: false,
        isMe: sender.sender_id.open_id === this.botUserId,
      },
      metadata: {
        dateSent: new Date(Number(msg.create_time)),
        edited: false,
      },
      attachments: [],
      raw: payload,
      isMention: isMentioned,
    });

    try {
      await this.chat.handleIncomingMessage(this, threadId, chatMessage);
    } catch (error) {
      this.logger.error("Error handling Feishu message", {
        error: String(error),
        messageId: msg.message_id,
      });
    }
  }

  /**
   * Post a message to a Feishu chat or reply to a thread.
   */
  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<unknown>> {
    const { chatId, messageId: rootMessageId } = this.decodeThreadId(threadId);

    // Build message content
    const { content, msgType } = this.buildMessagePayload(message);

    // Handle file uploads
    const files = extractFiles(message);
    if (files.length > 0) {
      return this.postMessageWithFiles(threadId, chatId, rootMessageId, files);
    }

    this.logger.debug("Feishu API: POST message", {
      chatId,
      rootMessageId,
      msgType,
    });

    try {
      // Reply to the root message in the thread
      const response = await this.client.im.message.reply({
        path: { message_id: rootMessageId },
        data: {
          content,
          msg_type: msgType,
        },
      });

      const messageId =
        (response as { data?: { message_id?: string } }).data?.message_id ??
        "unknown";

      this.logger.debug("Feishu API: POST message response", {
        messageId,
      });

      return {
        id: messageId,
        threadId,
        raw: response,
      };
    } catch (error) {
      this.logger.error("Feishu API: POST message error", {
        error: String(error),
      });
      throw new NetworkError(
        "feishu",
        `Failed to post message: ${String(error)}`
      );
    }
  }

  /**
   * Build message payload from an AdapterPostableMessage.
   */
  private buildMessagePayload(message: AdapterPostableMessage): {
    content: string;
    msgType: string;
  } {
    // Check for card
    const card = extractCard(message);
    if (card) {
      const cardPayload = cardToFeishuPayload(card);
      return {
        content: JSON.stringify(cardPayload),
        msgType: "interactive",
      };
    }

    // Regular text message
    const text = convertEmojiPlaceholders(
      this.formatConverter.renderPostable(message),
      "gchat"
    );

    return {
      content: JSON.stringify({ text }),
      msgType: "text",
    };
  }

  /**
   * Post a message with file attachments.
   * Feishu requires uploading files first, then sending them as image/file messages.
   */
  private async postMessageWithFiles(
    threadId: string,
    _chatId: string,
    rootMessageId: string,
    files: Array<{
      filename: string;
      data: Buffer | Blob | ArrayBuffer;
      mimeType?: string;
    }>
  ): Promise<RawMessage<unknown>> {
    const file = files[0];
    if (!file) {
      throw new NetworkError("feishu", "No files to upload");
    }

    // Warn if multiple files were provided since Feishu only supports one attachment per message
    if (files.length > 1) {
      this.logger.warn(
        `Feishu only supports one attachment per message. Sending first file only, ${files.length - 1} file(s) dropped: ${files
          .slice(1)
          .map((f) => f.filename)
          .join(", ")}`
      );
    }

    const buffer = await toBuffer(file.data, {
      platform: "feishu" as "slack",
    });
    if (!buffer) {
      throw new NetworkError("feishu", "Failed to convert file to buffer");
    }

    const isImage = file.mimeType?.startsWith("image/") ?? false;

    try {
      // Upload the file/image first
      let imageKey: string | undefined;
      if (isImage) {
        const uploadResponse = await this.client.im.image.create({
          data: {
            image_type: "message",
            image: Buffer.from(buffer),
          },
        });
        imageKey = (uploadResponse as { data?: { image_key?: string } }).data
          ?.image_key;
      }

      // Send message with the uploaded content
      const content =
        isImage && imageKey
          ? JSON.stringify({ image_key: imageKey })
          : JSON.stringify({ text: `[File: ${file.filename}]` });

      const msgType = isImage && imageKey ? "image" : "text";

      const response = await this.client.im.message.reply({
        path: { message_id: rootMessageId },
        data: {
          content,
          msg_type: msgType,
        },
      });

      const messageId =
        (response as { data?: { message_id?: string } }).data?.message_id ??
        "unknown";

      return {
        id: messageId,
        threadId,
        raw: response,
      };
    } catch (error) {
      throw new NetworkError(
        "feishu",
        `Failed to upload file: ${String(error)}`
      );
    }
  }

  /**
   * Edit an existing Feishu message.
   */
  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<unknown>> {
    const { content, msgType } = this.buildMessagePayload(message);

    this.logger.debug("Feishu API: PATCH message", {
      messageId,
      msgType,
    });

    try {
      const response = await this.client.im.message.patch({
        path: { message_id: messageId },
        data: { content },
      });

      this.logger.debug("Feishu API: PATCH message response", {
        messageId,
      });

      return {
        id: messageId,
        threadId,
        raw: response,
      };
    } catch (error) {
      throw new NetworkError(
        "feishu",
        `Failed to edit message: ${String(error)}`
      );
    }
  }

  /**
   * Delete a Feishu message.
   */
  async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    this.logger.debug("Feishu API: DELETE message", { messageId });

    try {
      await this.client.im.message.delete({
        path: { message_id: messageId },
      });
      this.logger.debug("Feishu API: DELETE message response", { ok: true });
    } catch (error) {
      throw new NetworkError(
        "feishu",
        `Failed to delete message: ${String(error)}`
      );
    }
  }

  /**
   * Add a reaction to a Feishu message.
   */
  async addReaction(
    _threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const emojiType = this.resolveEmojiType(emoji);

    this.logger.debug("Feishu API: POST reaction", {
      messageId,
      emojiType,
    });

    try {
      await this.client.im.messageReaction.create({
        path: { message_id: messageId },
        data: {
          reaction_type: { emoji_type: emojiType },
        },
      });
      this.logger.debug("Feishu API: POST reaction response", { ok: true });
    } catch (error) {
      this.logger.error("Feishu API: POST reaction error", {
        error: String(error),
      });
      throw new NetworkError(
        "feishu",
        `Failed to add reaction: ${String(error)}`
      );
    }
  }

  /**
   * Remove a reaction from a Feishu message.
   */
  async removeReaction(
    _threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const emojiType = this.resolveEmojiType(emoji);

    this.logger.debug("Feishu API: DELETE reaction", {
      messageId,
      emojiType,
    });

    try {
      // List reactions on the message to find the correct reaction_id (UUID)
      // Feishu API requires a UUID reaction_id for deletion, not the emoji type string
      const listResponse = await this.client.im.messageReaction.list({
        path: { message_id: messageId },
        params: { reaction_type: emojiType },
      });

      const items =
        (
          listResponse as {
            data?: {
              items?: Array<{
                reaction_id?: string;
                reaction_type?: { emoji_type?: string };
              }>;
            };
          }
        ).data?.items ?? [];

      // Find a reaction matching the emoji type (prefer our bot's reaction)
      const match = items.find(
        (item) => item.reaction_type?.emoji_type === emojiType
      );

      if (!match?.reaction_id) {
        this.logger.warn("Feishu API: No matching reaction found to remove", {
          messageId,
          emojiType,
        });
        return;
      }

      await this.client.im.messageReaction.delete({
        path: {
          message_id: messageId,
          reaction_id: match.reaction_id,
        },
      });
      this.logger.debug("Feishu API: DELETE reaction response", { ok: true });
    } catch (error) {
      this.logger.error("Feishu API: DELETE reaction error", {
        error: String(error),
      });
      throw new NetworkError(
        "feishu",
        `Failed to remove reaction: ${String(error)}`
      );
    }
  }

  /**
   * Start typing indicator. Feishu does not have a typing API, so this is a no-op.
   */
  async startTyping(_threadId: string, _status?: string): Promise<void> {
    // No-op: Feishu does not support typing indicators
  }

  /**
   * Fetch messages from a Feishu thread.
   */
  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<unknown>> {
    const { messageId: rootMessageId } = this.decodeThreadId(threadId);
    const limit = options.limit ?? 50;

    this.logger.debug("Feishu API: GET messages", {
      rootMessageId,
      limit,
      cursor: options.cursor,
    });

    try {
      const response = await this.client.im.message.list({
        params: {
          container_id_type: "thread",
          container_id: rootMessageId,
          page_size: limit,
          page_token: options.cursor,
        },
      });

      const data = response as {
        data?: {
          items?: Array<{
            message_id: string;
            root_id?: string;
            parent_id?: string;
            create_time: string;
            update_time?: string;
            chat_id: string;
            msg_type: string;
            content: string;
            sender: { id: string; sender_type: string };
          }>;
          page_token?: string;
          has_more?: boolean;
        };
      };

      const items = data.data?.items ?? [];

      const messages = items.map((item) => {
        let text = "";
        try {
          if (item.msg_type === "text") {
            const content = JSON.parse(item.content) as { text?: string };
            text = content.text ?? "";
          }
        } catch {
          // Content parsing failure is non-fatal
        }

        return new Message({
          id: item.message_id,
          threadId,
          text,
          formatted: this.formatConverter.toAst(text),
          raw: item,
          author: {
            userId: item.sender.id,
            userName: item.sender.id,
            fullName: item.sender.id,
            isBot: item.sender.sender_type === "app",
            isMe: item.sender.id === this.botUserId,
          },
          metadata: {
            dateSent: new Date(Number(item.create_time)),
            edited: !!item.update_time,
            editedAt: item.update_time
              ? new Date(Number(item.update_time))
              : undefined,
          },
          attachments: [],
        });
      });

      return {
        messages,
        nextCursor: data.data?.has_more ? data.data.page_token : undefined,
      };
    } catch (error) {
      this.logger.error("Feishu API: GET messages error", {
        error: String(error),
      });
      throw new NetworkError(
        "feishu",
        `Failed to fetch messages: ${String(error)}`
      );
    }
  }

  /**
   * Fetch thread/chat information.
   */
  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { chatId } = this.decodeThreadId(threadId);

    this.logger.debug("Feishu API: GET chat info", { chatId });

    try {
      const response = await this.client.im.chat.get({
        path: { chat_id: chatId },
      });

      const data = response as {
        data?: {
          name?: string;
          chat_mode?: string;
        };
      };

      return {
        id: threadId,
        channelId: chatId,
        channelName: data.data?.name,
        isDM: data.data?.chat_mode === "p2p",
        metadata: {
          raw: response,
        },
      };
    } catch (error) {
      this.logger.error("Feishu API: GET chat info error", {
        error: String(error),
      });
      throw new NetworkError(
        "feishu",
        `Failed to fetch thread info: ${String(error)}`
      );
    }
  }

  /**
   * Open a DM with a user.
   */
  async openDM(userId: string): Promise<string> {
    this.logger.debug("Feishu API: POST create p2p chat", { userId });

    try {
      const response = await this.client.im.chat.create({
        params: { user_id_type: "open_id" },
        data: {
          chat_mode: "p2p",
          user_id_list: [userId],
        },
      });

      const chatId = (response as { data?: { chat_id?: string } }).data
        ?.chat_id;
      if (!chatId) {
        throw new NetworkError("feishu", "Failed to create DM: no chat_id");
      }

      this.logger.debug("Feishu API: POST create p2p chat response", {
        chatId,
      });

      // For DM, the thread ID uses the chat_id and a placeholder message_id
      return this.encodeThreadId({
        chatId,
        messageId: "dm",
      });
    } catch (error) {
      throw new NetworkError("feishu", `Failed to open DM: ${String(error)}`);
    }
  }

  /**
   * Check if a thread is a DM.
   */
  isDM(threadId: string): boolean {
    const { messageId } = this.decodeThreadId(threadId);
    return messageId === "dm";
  }

  /**
   * Encode platform data into a thread ID string.
   * Format: feishu:{chatId}:{messageId}
   */
  encodeThreadId(platformData: FeishuThreadId): string {
    return `feishu:${platformData.chatId}:${platformData.messageId}`;
  }

  /**
   * Decode thread ID string back to platform data.
   */
  decodeThreadId(threadId: string): FeishuThreadId {
    const parts = threadId.split(":");
    if (parts.length < 3 || parts[0] !== "feishu") {
      throw new ValidationError(
        "feishu",
        `Invalid Feishu thread ID: ${threadId}`
      );
    }

    return {
      chatId: parts[1] as string,
      messageId: parts[2] as string,
    };
  }

  /**
   * Derive channel ID from a Feishu thread ID.
   * feishu:{chatId}:{messageId} -> feishu:{chatId}
   */
  channelIdFromThreadId(threadId: string): string {
    const parts = threadId.split(":");
    return parts.slice(0, 2).join(":");
  }

  /**
   * Parse a Feishu message into normalized format.
   */
  parseMessage(raw: unknown): Message<unknown> {
    const msg = raw as {
      message_id: string;
      chat_id: string;
      root_id?: string;
      content: string;
      msg_type: string;
      create_time: string;
      update_time?: string;
      sender: { id: string; sender_type: string };
    };

    const chatId = msg.chat_id;
    const rootMessageId = msg.root_id ?? msg.message_id;
    const threadId = this.encodeThreadId({ chatId, messageId: rootMessageId });

    let text = "";
    try {
      if (msg.msg_type === "text") {
        const content = JSON.parse(msg.content) as { text?: string };
        text = content.text ?? "";
      }
    } catch {
      // Content parsing failure is non-fatal
    }

    return new Message({
      id: msg.message_id,
      threadId,
      text,
      formatted: this.formatConverter.toAst(text),
      raw,
      author: {
        userId: msg.sender.id,
        userName: msg.sender.id,
        fullName: msg.sender.id,
        isBot: msg.sender.sender_type === "app",
        isMe: msg.sender.id === this.botUserId,
      },
      metadata: {
        dateSent: new Date(Number(msg.create_time)),
        edited: !!msg.update_time,
        editedAt: msg.update_time
          ? new Date(Number(msg.update_time))
          : undefined,
      },
      attachments: [],
    });
  }

  /**
   * Render formatted content to Feishu markdown.
   */
  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  /**
   * Decrypt an encrypted event payload using AES-256-CBC.
   * Algorithm matches the official Feishu SDK:
   * 1. Key = SHA-256 hash of the encryptKey string
   * 2. Ciphertext = Base64-decoded encrypt string
   * 3. IV = first 16 bytes of ciphertext
   * 4. Decrypt remaining bytes with AES-256-CBC
   *
   * @see https://github.com/larksuite/node-sdk/blob/main/utils/aes-cipher.ts
   */
  private decryptEvent(encryptedString: string): string {
    if (!this.encryptKey) {
      throw new Error("encryptKey is required for decryption");
    }

    const hash = crypto.createHash("sha256");
    hash.update(this.encryptKey);
    const key = hash.digest();

    const encryptBuffer = Buffer.from(encryptedString, "base64");
    const iv = encryptBuffer.subarray(0, 16);
    const ciphertext = encryptBuffer.subarray(16);

    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(ciphertext.toString("hex"), "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  /**
   * Verify the event signature using SHA-256.
   * Formula: sha256(timestamp + nonce + encryptKey + body)
   *
   * @see https://github.com/larksuite/node-sdk/blob/main/dispatcher/request-handle.ts
   */
  private verifySignature(
    timestamp: string,
    nonce: string,
    body: string,
    expectedSignature: string
  ): boolean {
    if (!this.encryptKey) {
      return true;
    }

    const content = timestamp + nonce + this.encryptKey + body;
    const computedSignature = crypto
      .createHash("sha256")
      .update(content)
      .digest("hex");

    return computedSignature === expectedSignature;
  }
  /**
   * Resolve an emoji value to a Feishu emoji type string.
   */
  private resolveEmojiType(emoji: EmojiValue | string): string {
    // Convert to unicode emoji for Feishu (gchat resolver returns unicode)
    return defaultEmojiResolver.toGChat(emoji);
  }

  /**
   * Make authenticated requests to Feishu API.
   */
  private async feishuFetch(
    path: string,
    method: string,
    body?: unknown
  ): Promise<Response> {
    // Get tenant access token
    const tokenResponse = await fetch(
      `${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: this.appId,
          app_secret: this.appSecret,
        }),
      }
    );

    const tokenData = (await tokenResponse.json()) as {
      tenant_access_token?: string;
    };
    const token = tokenData.tenant_access_token;
    if (!token) {
      throw new NetworkError("feishu", "Failed to obtain tenant access token");
    }

    const url = `${FEISHU_API_BASE}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error("Feishu API error", {
        path,
        method,
        status: response.status,
        error: errorText,
      });
      throw new NetworkError(
        "feishu",
        `Feishu API error: ${response.status} ${errorText}`
      );
    }

    return response;
  }
}

/**
 * Create a Feishu adapter instance.
 */
export function createFeishuAdapter(
  config?: Partial<FeishuAdapterConfig & { logger: Logger; userName?: string }>
): FeishuAdapter {
  const appId = config?.appId ?? process.env.FEISHU_APP_ID;
  if (!appId) {
    throw new ValidationError(
      "feishu",
      "appId is required. Set FEISHU_APP_ID or provide it in config."
    );
  }
  const appSecret = config?.appSecret ?? process.env.FEISHU_APP_SECRET;
  if (!appSecret) {
    throw new ValidationError(
      "feishu",
      "appSecret is required. Set FEISHU_APP_SECRET or provide it in config."
    );
  }
  const encryptKey = config?.encryptKey ?? process.env.FEISHU_ENCRYPT_KEY;
  const verificationToken =
    config?.verificationToken ?? process.env.FEISHU_VERIFICATION_TOKEN;

  const resolved: FeishuAdapterConfig & {
    logger: Logger;
    userName?: string;
  } = {
    appId,
    appSecret,
    encryptKey,
    verificationToken,
    logger: config?.logger ?? new ConsoleLogger("info").child("feishu"),
    userName: config?.userName,
  };
  return new FeishuAdapter(resolved);
}

// Re-export card converter for advanced use
export { cardToFallbackText, cardToFeishuPayload } from "./cards";

// Re-export format converter for advanced use
export {
  FeishuFormatConverter,
  FeishuFormatConverter as FeishuMarkdownConverter,
} from "./markdown";

// Re-export types
export type { FeishuAdapterConfig, FeishuThreadId } from "./types";
