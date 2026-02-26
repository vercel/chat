/**
 * Chatwork adapter for chat-sdk.
 *
 * Uses the Chatwork REST API v2 for message operations
 * and webhook events for incoming messages.
 */

import { createHmac } from "node:crypto";
import {
  NetworkError,
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
  Message,
} from "chat";
import { ChatworkFormatConverter } from "./markdown";
import type {
  ChatworkAdapterConfig,
  ChatworkApiMessage,
  ChatworkApiRoom,
  ChatworkSendMessageResponse,
  ChatworkThreadId,
  ChatworkWebhookPayload,
} from "./types";

export type { ChatworkAdapterConfig, ChatworkThreadId } from "./types";
export { ChatworkFormatConverter } from "./markdown";

const CHATWORK_API_BASE = "https://api.chatwork.com/v2";

/**
 * Chatwork adapter implementation.
 */
export class ChatworkAdapter
  implements Adapter<ChatworkThreadId, ChatworkApiMessage>
{
  readonly name = "chatwork";
  readonly userName: string;
  readonly botUserId?: string;

  private readonly apiToken: string;
  private readonly webhookToken?: string;
  private chat: ChatInstance | null = null;
  private logger: Logger;
  private readonly formatConverter = new ChatworkFormatConverter();

  constructor(
    config: ChatworkAdapterConfig & { logger?: Logger }
  ) {
    this.apiToken = config.apiToken;
    this.webhookToken = config.webhookToken;
    this.botUserId = config.botAccountId;
    this.userName = config.userName ?? "bot";
    this.logger = config.logger ?? new ConsoleLogger("info");
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger("chatwork");
    this.logger.info("Chatwork adapter initialized");

    // Fetch bot account ID if not provided
    if (!this.botUserId) {
      try {
        const response = await this.chatworkFetch("/me", "GET");
        const me = (await response.json()) as { account_id: number };
        (this as { botUserId?: string }).botUserId = String(me.account_id);
        this.logger.info("Fetched bot account ID", {
          accountId: me.account_id,
        });
      } catch (error) {
        this.logger.warn("Failed to fetch bot account ID", {
          error: String(error),
        });
      }
    }
  }

  /**
   * Handle incoming Chatwork webhook request.
   */
  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    const body = await request.text();

    // Verify webhook signature if token is configured
    if (this.webhookToken) {
      const signature = request.headers.get("x-chatworkwebhooksignature");
      if (!this.verifySignature(body, signature)) {
        this.logger.warn("Chatwork webhook signature verification failed");
        return new Response("Invalid signature", { status: 401 });
      }
    }

    let payload: ChatworkWebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    this.logger.info("Chatwork webhook received", {
      eventType: payload.webhook_event_type,
      roomId: payload.webhook_event.room_id,
      messageId: payload.webhook_event.message_id,
    });

    if (
      payload.webhook_event_type === "message_created" ||
      payload.webhook_event_type === "mention_to_me"
    ) {
      this.handleMessageEvent(payload, options);
    }

    return new Response("OK", { status: 200 });
  }

  /**
   * Verify Chatwork webhook signature.
   * Chatwork uses Base64-encoded HMAC-SHA256 with the webhook token as the key.
   */
  private verifySignature(
    body: string,
    signature: string | null
  ): boolean {
    if (!signature || !this.webhookToken) {
      return false;
    }

    const expected = createHmac("sha256", Buffer.from(this.webhookToken, "base64"))
      .update(body)
      .digest("base64");

    return signature === expected;
  }

  /**
   * Handle a message_created or mention_to_me event.
   */
  private handleMessageEvent(
    payload: ChatworkWebhookPayload,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized");
      return;
    }

    const event = payload.webhook_event;
    const threadId = this.encodeThreadId({
      roomId: String(event.room_id),
    });

    const isMention = payload.webhook_event_type === "mention_to_me";

    // Strip Chatwork tags to get plain text
    const plainText = this.stripChatworkTags(event.body);

    const message = new Message<ChatworkApiMessage>({
      id: event.message_id,
      threadId,
      text: plainText,
      formatted: this.formatConverter.toAst(event.body),
      raw: {
        message_id: event.message_id,
        account: {
          account_id: event.account_id,
          name: String(event.account_id),
          avatar_image_url: "",
        },
        body: event.body,
        send_time: event.send_time,
        update_time: event.update_time,
      },
      author: {
        userId: String(event.account_id),
        userName: String(event.account_id),
        fullName: String(event.account_id),
        isBot: String(event.account_id) === this.botUserId,
        isMe: String(event.account_id) === this.botUserId,
      },
      metadata: {
        dateSent: new Date(event.send_time * 1000),
        edited: event.update_time > 0 && event.update_time !== event.send_time,
        editedAt:
          event.update_time > 0 && event.update_time !== event.send_time
            ? new Date(event.update_time * 1000)
            : undefined,
      },
      attachments: [],
      isMention,
    });

    this.chat.processMessage(this, threadId, message, options);
  }

  /**
   * Strip Chatwork-specific tags from text to get plain text.
   */
  private stripChatworkTags(text: string): string {
    let result = text;
    // Remove [To:xxx] and keep name
    result = result.replace(/\[To:\d+\]\s*/g, "");
    // Remove [rp aid=xxx to=xxx]
    result = result.replace(/\[rp aid=\d+ to=[\w-]+\]\s*/g, "");
    // Remove [piconname:xxx] and the rest of line
    result = result.replace(/\[piconname:\d+\][^\n]*/g, "");
    // Strip info/title tags, keep content
    result = result.replace(/\[info\]/g, "");
    result = result.replace(/\[\/info\]/g, "");
    result = result.replace(/\[title\]/g, "");
    result = result.replace(/\[\/title\]/g, "");
    // Strip code tags, keep content
    result = result.replace(/\[code\]/g, "");
    result = result.replace(/\[\/code\]/g, "");
    // Strip qt tags
    result = result.replace(/\[qt\]/g, "");
    result = result.replace(/\[\/qt\]/g, "");
    result = result.replace(/\[qtmeta[^\]]*\]/g, "");
    // Strip hr
    result = result.replace(/\[hr\]/g, "");
    return result.trim();
  }

  /**
   * Post a message to a Chatwork room.
   */
  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<ChatworkApiMessage>> {
    const { roomId } = this.decodeThreadId(threadId);
    const body = this.formatConverter.renderPostable(message);

    const response = await this.chatworkFetch(
      `/rooms/${roomId}/messages`,
      "POST",
      { body, self_unread: 0 }
    );

    const result = (await response.json()) as ChatworkSendMessageResponse;

    this.logger.debug("Chatwork message posted", {
      roomId,
      messageId: result.message_id,
    });

    return {
      id: result.message_id,
      threadId,
      raw: {
        message_id: result.message_id,
        account: {
          account_id: Number(this.botUserId) || 0,
          name: this.userName,
          avatar_image_url: "",
        },
        body,
        send_time: Math.floor(Date.now() / 1000),
        update_time: Math.floor(Date.now() / 1000),
      },
    };
  }

  /**
   * Edit an existing message in a Chatwork room.
   */
  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<ChatworkApiMessage>> {
    const { roomId } = this.decodeThreadId(threadId);
    const body = this.formatConverter.renderPostable(message);

    await this.chatworkFetch(
      `/rooms/${roomId}/messages/${messageId}`,
      "PUT",
      { body }
    );

    this.logger.debug("Chatwork message edited", { roomId, messageId });

    return {
      id: messageId,
      threadId,
      raw: {
        message_id: messageId,
        account: {
          account_id: Number(this.botUserId) || 0,
          name: this.userName,
          avatar_image_url: "",
        },
        body,
        send_time: Math.floor(Date.now() / 1000),
        update_time: Math.floor(Date.now() / 1000),
      },
    };
  }

  /**
   * Delete a message in a Chatwork room.
   */
  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const { roomId } = this.decodeThreadId(threadId);

    await this.chatworkFetch(
      `/rooms/${roomId}/messages/${messageId}`,
      "DELETE"
    );

    this.logger.debug("Chatwork message deleted", { roomId, messageId });
  }

  /**
   * Fetch messages from a Chatwork room.
   */
  async fetchMessages(
    threadId: string,
    _options?: FetchOptions
  ): Promise<FetchResult<ChatworkApiMessage>> {
    const { roomId } = this.decodeThreadId(threadId);

    const response = await this.chatworkFetch(
      `/rooms/${roomId}/messages?force=1`,
      "GET"
    );

    const rawMessages = (await response.json()) as ChatworkApiMessage[];

    const messages = rawMessages.map((raw) => this.parseMessage(raw, threadId));

    return {
      messages,
      nextCursor: undefined,
    };
  }

  /**
   * Fetch thread (room) metadata.
   */
  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { roomId } = this.decodeThreadId(threadId);

    const response = await this.chatworkFetch(`/rooms/${roomId}`, "GET");
    const room = (await response.json()) as ChatworkApiRoom;

    return {
      id: threadId,
      channelId: `chatwork:${roomId}`,
      channelName: room.name,
      isDM: room.type === "direct",
      metadata: { room },
    };
  }

  /**
   * Fetch channel (room) info.
   */
  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const roomId = channelId.replace("chatwork:", "");

    const response = await this.chatworkFetch(`/rooms/${roomId}`, "GET");
    const room = (await response.json()) as ChatworkApiRoom;

    return {
      id: channelId,
      name: room.name,
      isDM: room.type === "direct",
      metadata: { room },
    };
  }

  /**
   * Parse a Chatwork API message into a normalized Message.
   */
  parseMessage(
    raw: ChatworkApiMessage,
    threadId?: string
  ): Message<ChatworkApiMessage> {
    const resolvedThreadId = threadId ?? "chatwork:unknown";
    const plainText = this.stripChatworkTags(raw.body);

    return new Message<ChatworkApiMessage>({
      id: raw.message_id,
      threadId: resolvedThreadId,
      text: plainText,
      formatted: this.formatConverter.toAst(raw.body),
      raw,
      author: {
        userId: String(raw.account.account_id),
        userName: raw.account.name,
        fullName: raw.account.name,
        isBot: String(raw.account.account_id) === this.botUserId,
        isMe: String(raw.account.account_id) === this.botUserId,
      },
      metadata: {
        dateSent: new Date(raw.send_time * 1000),
        edited: raw.update_time > 0 && raw.update_time !== raw.send_time,
        editedAt:
          raw.update_time > 0 && raw.update_time !== raw.send_time
            ? new Date(raw.update_time * 1000)
            : undefined,
      },
      attachments: [],
    });
  }

  /**
   * Add a reaction to a message.
   * Chatwork does not support reactions via API, so this is a no-op.
   */
  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    this.logger.debug("Chatwork does not support reactions via API");
  }

  /**
   * Remove a reaction from a message.
   * Chatwork does not support reactions via API, so this is a no-op.
   */
  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    this.logger.debug("Chatwork does not support reactions via API");
  }

  /**
   * Show typing indicator.
   * Chatwork does not support typing indicators, so this is a no-op.
   */
  async startTyping(_threadId: string, _status?: string): Promise<void> {
    // Chatwork has no typing indicator API
  }

  /**
   * Render formatted content to Chatwork format.
   */
  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  /**
   * Encode platform-specific thread ID data to string.
   * Format: chatwork:{roomId}
   */
  encodeThreadId(data: ChatworkThreadId): string {
    return `chatwork:${data.roomId}`;
  }

  /**
   * Decode thread ID string to platform-specific data.
   */
  decodeThreadId(threadId: string): ChatworkThreadId {
    const parts = threadId.split(":");
    if (parts.length < 2 || parts[0] !== "chatwork") {
      throw new ValidationError(
        "chatwork",
        `Invalid thread ID format: ${threadId}`
      );
    }
    return { roomId: parts[1] };
  }

  /**
   * Check if a thread is a DM.
   */
  isDM(_threadId: string): boolean {
    // We can't determine this from the thread ID alone;
    // would need to fetch room info
    return false;
  }

  /**
   * Make an API request to Chatwork.
   */
  private async chatworkFetch(
    path: string,
    method: string,
    body?: Record<string, unknown>
  ): Promise<Response> {
    const url = `${CHATWORK_API_BASE}${path}`;

    const headers: Record<string, string> = {
      "X-ChatWorkToken": this.apiToken,
    };

    let requestBody: string | undefined;
    if (body) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      requestBody = new URLSearchParams(
        Object.entries(body).map(([k, v]) => [k, String(v)])
      ).toString();
    }

    const response = await fetch(url, {
      method,
      headers,
      body: requestBody,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      this.logger.error("Chatwork API error", {
        status: response.status,
        path,
        body: text,
      });
      throw new NetworkError(
        "chatwork",
        `Chatwork API error: ${response.status} ${text}`
      );
    }

    return response;
  }
}

/**
 * Factory function to create a Chatwork adapter.
 * Supports zero-config via environment variables.
 */
export function createChatworkAdapter(
  config?: Partial<ChatworkAdapterConfig> & { logger?: Logger }
): ChatworkAdapter {
  const apiToken = config?.apiToken ?? process.env.CHATWORK_API_TOKEN;

  if (!apiToken) {
    throw new ValidationError(
      "chatwork",
      "apiToken is required. Set CHATWORK_API_TOKEN environment variable or pass apiToken in config."
    );
  }

  const resolvedConfig: ChatworkAdapterConfig & { logger?: Logger } = {
    apiToken,
    webhookToken:
      config?.webhookToken ?? process.env.CHATWORK_WEBHOOK_TOKEN,
    botAccountId:
      config?.botAccountId ?? process.env.CHATWORK_BOT_ACCOUNT_ID,
    userName: config?.userName,
    logger: config?.logger,
  };

  return new ChatworkAdapter(resolvedConfig);
}
