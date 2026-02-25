/**
 * Feishu (Lark) adapter for the chat SDK.
 *
 * Implements the Adapter interface using Feishu Open API v1.
 * Uses direct fetch() calls (no external SDK).
 */

import {
  extractCard,
  extractFiles,
  ValidationError,
} from "@chat-adapter/shared";
import {
  type Adapter,
  type AdapterPostableMessage,
  type Attachment,
  type ChatInstance,
  ConsoleLogger,
  convertEmojiPlaceholders,
  type EmojiValue,
  type FetchOptions,
  type FetchResult,
  type FormattedContent,
  getEmoji,
  type Logger,
  Message,
  type RawMessage,
  type ThreadInfo,
  type WebhookOptions,
} from "chat";

import { FeishuApiClient } from "./api";
import { cardToFeishuCard } from "./cards";
import { decryptFeishuEvent, verifyFeishuToken } from "./crypto";
import { FeishuFormatConverter } from "./markdown";
import {
  decodeThreadId,
  encodeThreadId,
  type FeishuThreadId,
  isDMThread,
} from "./thread-utils";
import type {
  FeishuEncryptedEvent,
  FeishuEventEnvelope,
  FeishuEventMessage,
  FeishuEventSender,
  FeishuMessageReceiveEvent,
  FeishuMessageResponse,
  FeishuReactionCreatedEvent,
  FeishuReactionDeletedEvent,
  FeishuUrlVerification,
} from "./types";

// Re-export public API
export { FeishuApiClient } from "./api";
export { cardToFallbackText, cardToFeishuCard } from "./cards";
export { FeishuFormatConverter } from "./markdown";
export {
  decodeThreadId,
  encodeThreadId,
  type FeishuThreadId,
  isDMThread,
} from "./thread-utils";
export type {
  FeishuEventMessage,
  FeishuInteractiveCard,
  FeishuPostContent,
} from "./types";

// =============================================================================
// Emoji Mapping for Feishu Reactions
// =============================================================================

const FEISHU_REACTION_MAP: Record<string, string> = {
  // Verified correct (docs: open.feishu.cn/document/.../emojis-introduce)
  thumbs_up: "THUMBSUP",
  heart: "HEART",
  smile: "SMILE",
  angry: "ANGRY",
  clap: "CLAP",
  party: "PARTY",
  check: "OK",
  muscle: "MUSCLE",
  thinking: "THINKING",
  // Corrected casing
  thumbs_down: "ThumbsDown",
  fire: "Fire",
  coffee: "Coffee",
  "100": "Hundred",
  // Corrected names (old values don't exist in Feishu)
  laugh: "LAUGH",
  sad: "SOB",
  surprised: "SHOCKED",
  pray: "THANKS",
  eyes: "GLANCE",
  rocket: "GoGoGo",
  star: "Trophy",
  // Additional mappings
  cry: "CRY",
  wave: "WAVE",
  hug: "HUG",
  wink: "WINK",
  facepalm: "FACEPALM",
  sleeping: "SLEEP",
  sick: "PUKE",
  trophy: "Trophy",
  gift: "GIFT",
  hammer: "HAMMER",
  pin: "Pin",
};

const FEISHU_REACTION_REVERSE: Record<string, string> = {};
for (const [normalized, feishu] of Object.entries(FEISHU_REACTION_MAP)) {
  FEISHU_REACTION_REVERSE[feishu] = normalized;
}

function toFeishuReactionType(emoji: EmojiValue | string): string {
  const name = typeof emoji === "string" ? emoji : emoji.name;
  return FEISHU_REACTION_MAP[name] ?? name;
}

function fromFeishuReactionType(feishuType: string): string {
  return FEISHU_REACTION_REVERSE[feishuType] ?? feishuType.toLowerCase();
}

// =============================================================================
// Config
// =============================================================================

export interface FeishuAdapterConfig {
  /**
   * Feishu API base URL.
   * Default: "https://open.feishu.cn/open-apis"
   * Use "https://open.larksuite.com/open-apis" for Lark (international).
   */
  apiBaseUrl?: string;
  /** Feishu App ID (or env FEISHU_APP_ID) */
  appId: string;
  /** Feishu App Secret (or env FEISHU_APP_SECRET) */
  appSecret: string;
  /**
   * Encrypt Key for decrypting event payloads (optional).
   * Configure in Feishu developer console > Event & Callback > Encryption Strategy.
   */
  encryptKey?: string;
  /** Logger instance */
  logger: Logger;
  /** Override bot username */
  userName?: string;
  /**
   * Verification Token for validating events originate from Feishu (optional).
   * Configure in Feishu developer console > Event & Callback > Encryption Strategy.
   */
  verificationToken?: string;
}

// =============================================================================
// Adapter
// =============================================================================

export class FeishuAdapter
  implements Adapter<FeishuThreadId, FeishuEventMessage>
{
  readonly name = "feishu";
  readonly userName: string;

  private chat!: ChatInstance;
  private readonly api: FeishuApiClient;
  private readonly config: FeishuAdapterConfig;
  private readonly formatConverter = new FeishuFormatConverter();
  private readonly logger: Logger;
  private botOpenId = "";

  constructor(config: FeishuAdapterConfig) {
    this.config = config;
    this.userName = config.userName ?? "bot";
    this.logger = config.logger;

    this.api = new FeishuApiClient({
      appId: config.appId,
      appSecret: config.appSecret,
      apiBaseUrl: config.apiBaseUrl ?? "https://open.feishu.cn/open-apis",
      logger: config.logger,
    });
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    // Fetch bot's open_id for accurate isMe / isBotMentioned checks.
    // The app_id (cli_xxx) differs from open_id (ou_xxx) used in events.
    try {
      const botInfo = await this.api.getBotInfo();
      this.botOpenId = botInfo.open_id;
      this.logger.debug("Feishu bot info loaded", {
        openId: this.botOpenId,
        appName: botInfo.app_name,
      });
    } catch (error) {
      this.logger.warn(
        "Failed to fetch bot info; isMe detection will rely on sender_type",
        { error }
      );
    }
  }

  // ===========================================================================
  // Thread ID
  // ===========================================================================

  encodeThreadId(platformData: FeishuThreadId): string {
    return encodeThreadId(platformData);
  }

  decodeThreadId(threadId: string): FeishuThreadId {
    return decodeThreadId(threadId);
  }

  isDM(threadId: string): boolean {
    return isDMThread(threadId);
  }

  channelIdFromThreadId(threadId: string): string {
    const { chatId } = decodeThreadId(threadId);
    return `feishu:${chatId}`;
  }

  // ===========================================================================
  // Webhook Handling
  // ===========================================================================

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    const rawBody = await request.text();
    this.logger.debug("Feishu webhook raw body", {
      body: rawBody.slice(0, 500),
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Handle encrypted events
    const maybeEncrypted = parsed as FeishuEncryptedEvent;
    if (maybeEncrypted.encrypt && this.config.encryptKey) {
      const decrypted = decryptFeishuEvent(
        maybeEncrypted.encrypt,
        this.config.encryptKey
      );
      parsed = JSON.parse(decrypted);
    }

    // Handle URL verification challenge
    const maybeVerification = parsed as FeishuUrlVerification;
    if (maybeVerification.type === "url_verification") {
      if (
        this.config.verificationToken &&
        !verifyFeishuToken(
          maybeVerification.token,
          this.config.verificationToken
        )
      ) {
        return new Response("Invalid verification token", { status: 403 });
      }
      return Response.json({ challenge: maybeVerification.challenge });
    }

    // Parse as v2.0 event
    const event = parsed as FeishuEventEnvelope;
    if (event.schema !== "2.0" || !event.header) {
      this.logger.debug("Non-v2.0 event or unknown format, ignoring");
      return Response.json({});
    }

    // Verify token if configured
    if (
      this.config.verificationToken &&
      !verifyFeishuToken(event.header.token, this.config.verificationToken)
    ) {
      return new Response("Invalid event token", { status: 403 });
    }

    // Route by event type
    const eventType = event.header.event_type;
    this.logger.debug("Feishu event received", { eventType });

    switch (eventType) {
      case "im.message.receive_v1":
        this.handleMessageEvent(
          event.event as FeishuMessageReceiveEvent,
          options
        );
        break;

      case "im.message.reaction.created_v1":
        this.handleReactionCreated(
          event.event as FeishuReactionCreatedEvent,
          options
        );
        break;

      case "im.message.reaction.deleted_v1":
        this.handleReactionDeleted(
          event.event as FeishuReactionDeletedEvent,
          options
        );
        break;

      default:
        this.logger.debug("Unhandled Feishu event type", { eventType });
    }

    return Response.json({});
  }

  private handleMessageEvent(
    event: FeishuMessageReceiveEvent,
    options?: WebhookOptions
  ): void {
    const msg = event.message;
    const isDM = msg.chat_type === "p2p";

    const threadId = encodeThreadId({
      chatId: msg.chat_id,
      rootId: msg.root_id || undefined,
      isDM,
    });

    // Detect @mention: DM always counts as mention, or check mentions list
    const isMention = isDM || this.isBotMentioned(msg.mentions);

    const factory = async (): Promise<Message<FeishuEventMessage>> => {
      const message = this.parseFeishuMessage(event.sender, msg, threadId);
      message.isMention = isMention;
      return message;
    };

    this.chat.processMessage(this, threadId, factory, options);
  }

  private handleReactionCreated(
    event: FeishuReactionCreatedEvent,
    options?: WebhookOptions
  ): void {
    const rawEmoji = event.reaction_type.emoji_type;
    const emoji = getEmoji(fromFeishuReactionType(rawEmoji));
    const isMe = event.operator_type === "app";

    this.chat.processReaction(
      {
        adapter: this,
        added: true,
        emoji,
        rawEmoji,
        messageId: event.message_id,
        threadId: "", // Feishu reaction events don't include thread context
        user: {
          userId: event.user_id.open_id,
          userName: event.user_id.open_id,
          fullName: event.user_id.open_id,
          isBot: event.operator_type === "app",
          isMe,
        },
        raw: event,
      },
      options
    );
  }

  private handleReactionDeleted(
    event: FeishuReactionDeletedEvent,
    options?: WebhookOptions
  ): void {
    const rawEmoji = event.reaction_type.emoji_type;
    const emoji = getEmoji(fromFeishuReactionType(rawEmoji));
    const isMe = event.operator_type === "app";

    this.chat.processReaction(
      {
        adapter: this,
        added: false,
        emoji,
        rawEmoji,
        messageId: event.message_id,
        threadId: "", // Feishu reaction events don't include thread context
        user: {
          userId: event.user_id.open_id,
          userName: event.user_id.open_id,
          fullName: event.user_id.open_id,
          isBot: event.operator_type === "app",
          isMe,
        },
        raw: event,
      },
      options
    );
  }

  private isBotMentioned(mentions?: FeishuEventMessage["mentions"]): boolean {
    if (!mentions) {
      return false;
    }
    return mentions.some(
      (m) =>
        (this.botOpenId && m.id.open_id === this.botOpenId) ||
        m.name === this.userName
    );
  }

  // ===========================================================================
  // Message Parsing
  // ===========================================================================

  parseMessage(raw: FeishuEventMessage): Message<FeishuEventMessage> {
    return this.parseFeishuMessage(
      {
        sender_id: { open_id: "unknown" },
        sender_type: "user",
      },
      raw,
      encodeThreadId({
        chatId: raw.chat_id,
        rootId: raw.root_id || undefined,
        isDM: raw.chat_type === "p2p",
      })
    );
  }

  private parseFeishuMessage(
    sender: FeishuEventSender,
    msg: FeishuEventMessage,
    threadId: string
  ): Message<FeishuEventMessage> {
    const isBot = sender.sender_type === "app";
    const isMe =
      isBot &&
      (this.botOpenId ? sender.sender_id.open_id === this.botOpenId : true);

    // Parse content based on message type
    let textContent = "";
    try {
      const content = JSON.parse(msg.content);
      if (msg.message_type === "text") {
        textContent = content.text ?? "";
      } else if (msg.message_type === "post") {
        // Extract text from rich text structure
        textContent = this.extractPostText(content);
      } else {
        textContent = content.text ?? `[${msg.message_type}]`;
      }
    } catch {
      textContent = msg.content || "";
    }

    // Normalize @mention placeholders
    textContent = this.normalizeMentions(textContent, msg.mentions);

    const plainText = this.formatConverter.extractPlainText(textContent);
    const formatted = this.formatConverter.toAst(textContent);

    return new Message<FeishuEventMessage>({
      id: msg.message_id,
      threadId,
      text: plainText,
      formatted,
      raw: msg,
      author: {
        userId: sender.sender_id.open_id,
        userName: sender.sender_id.open_id,
        fullName: sender.sender_id.open_id,
        isBot,
        isMe,
      },
      metadata: {
        dateSent: new Date(Number.parseInt(msg.create_time, 10)),
        edited: !!msg.update_time && msg.update_time !== msg.create_time,
        editedAt: msg.update_time
          ? new Date(Number.parseInt(msg.update_time, 10))
          : undefined,
      },
      attachments: this.extractAttachments(msg),
    });
  }

  /**
   * Extract plain text from Feishu post (rich text) content.
   */
  private extractPostText(
    content: Record<string, { title?: string; content?: unknown[][] }>
  ): string {
    // Try zh_cn, en_us, or first available locale
    const locale = content.zh_cn || content.en_us || Object.values(content)[0];
    if (!locale?.content) {
      return locale?.title ?? "";
    }

    const parts: string[] = [];
    if (locale.title) {
      parts.push(locale.title);
    }
    for (const paragraph of locale.content) {
      const paragraphText = (paragraph as Array<{ tag: string; text?: string }>)
        .filter((el) => el.text)
        .map((el) => el.text)
        .join("");
      if (paragraphText) {
        parts.push(paragraphText);
      }
    }
    return parts.join("\n");
  }

  /**
   * Replace @_user_N placeholders with @Name.
   */
  private normalizeMentions(
    text: string,
    mentions?: FeishuEventMessage["mentions"]
  ): string {
    if (!mentions) {
      return text;
    }
    let result = text;
    for (const mention of mentions) {
      result = result.replace(mention.key, `@${mention.name}`);
    }
    return result;
  }

  private extractAttachments(msg: FeishuEventMessage): Attachment[] {
    const attachments: Attachment[] = [];
    try {
      const content = JSON.parse(msg.content);
      if (msg.message_type === "image" && content.image_key) {
        attachments.push({
          type: "image",
          name: content.image_key,
        });
      } else if (msg.message_type === "file" && content.file_key) {
        attachments.push({
          type: "file",
          name: content.file_name || content.file_key,
        });
      } else if (msg.message_type === "audio" && content.file_key) {
        attachments.push({
          type: "audio",
          name: content.file_key,
        });
      } else if (msg.message_type === "media" && content.file_key) {
        attachments.push({
          type: "video",
          name: content.file_name || content.file_key,
        });
      }
    } catch {
      // Ignore parse errors
    }
    return attachments;
  }

  // ===========================================================================
  // Format Rendering
  // ===========================================================================

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  // ===========================================================================
  // Message Operations
  // ===========================================================================

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<FeishuEventMessage>> {
    const { chatId, rootId } = decodeThreadId(threadId);

    // Handle card messages
    const card = extractCard(message);
    if (card) {
      const feishuCard = cardToFeishuCard(card);
      const content = JSON.stringify(feishuCard);
      const response = rootId
        ? await this.api.replyMessage(rootId, "interactive", content)
        : await this.api.sendMessage(chatId, "interactive", content);

      return this.toRawMessage(response, threadId);
    }

    const files = extractFiles(message);
    if (files.length > 0) {
      this.logger.warn("File uploads are not yet supported for Feishu");
    }

    // If message has AST directly, use rich post format for better fidelity
    if (typeof message === "object" && "ast" in message) {
      const postContent = this.formatConverter.toPostContent(message.ast);
      const content = JSON.stringify(postContent);
      const response = rootId
        ? await this.api.replyMessage(rootId, "post", content)
        : await this.api.sendMessage(chatId, "post", content);
      return this.toRawMessage(response, threadId);
    }

    // Default: render as text with emoji conversion
    const text = convertEmojiPlaceholders(
      this.formatConverter.renderPostable(message),
      "feishu"
    );
    const content = JSON.stringify({ text });

    const response = rootId
      ? await this.api.replyMessage(rootId, "text", content)
      : await this.api.sendMessage(chatId, "text", content);

    return this.toRawMessage(response, threadId);
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<FeishuEventMessage>> {
    const card = extractCard(message);
    if (card) {
      const content = JSON.stringify(cardToFeishuCard(card));
      const response = await this.api.patchMessageCard(messageId, content);
      return this.toRawMessage(response, threadId);
    }

    const text = convertEmojiPlaceholders(
      this.formatConverter.renderPostable(message),
      "feishu"
    );
    const content = JSON.stringify({ text });
    const response = await this.api.editMessage(messageId, "text", content);
    return this.toRawMessage(response, threadId);
  }

  async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    await this.api.deleteMessage(messageId);
  }

  // ===========================================================================
  // Message Fetching
  // ===========================================================================

  async fetchMessages(
    threadId: string,
    options?: FetchOptions
  ): Promise<FetchResult<FeishuEventMessage>> {
    const { chatId } = decodeThreadId(threadId);
    const limit = options?.limit ?? 50;

    const response = await this.api.listMessages(chatId, {
      pageSize: Math.min(limit, 50),
      pageToken: options?.cursor,
      sortType:
        options?.direction === "forward"
          ? "ByCreateTimeAsc"
          : "ByCreateTimeDesc",
    });

    const messages = response.items.map((item) =>
      this.parseApiMessageResponse(item, threadId)
    );

    return {
      messages,
      nextCursor: response.has_more ? response.page_token : undefined,
    };
  }

  async fetchMessage(
    threadId: string,
    messageId: string
  ): Promise<Message<FeishuEventMessage> | null> {
    try {
      const response = await this.api.getMessage(messageId);
      return this.parseApiMessageResponse(response, threadId);
    } catch {
      return null;
    }
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { chatId, isDM } = decodeThreadId(threadId);
    const chatInfo = await this.api.getChatInfo(chatId);

    return {
      id: threadId,
      channelId: `feishu:${chatId}`,
      channelName: chatInfo.name,
      isDM,
      metadata: {
        chatType: chatInfo.chat_type,
        description: chatInfo.description,
      },
    };
  }

  private parseApiMessageResponse(
    item: FeishuMessageResponse,
    threadId: string
  ): Message<FeishuEventMessage> {
    const msg: FeishuEventMessage = {
      message_id: item.message_id,
      root_id: item.root_id,
      parent_id: item.parent_id,
      create_time: item.create_time,
      update_time: item.update_time,
      chat_id: item.chat_id,
      chat_type: "group", // API doesn't return chat_type; default
      message_type: item.msg_type as FeishuEventMessage["message_type"],
      content: item.body.content,
      mentions: item.mentions,
    };

    return this.parseFeishuMessage(
      {
        sender_id: { open_id: item.sender.id },
        sender_type: item.sender.sender_type as "user" | "app",
      },
      msg,
      threadId
    );
  }

  // ===========================================================================
  // Reactions
  // ===========================================================================

  async addReaction(
    _threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const emojiType = toFeishuReactionType(emoji);
    await this.api.addReaction(messageId, emojiType);
  }

  async removeReaction(
    _threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const emojiType = toFeishuReactionType(emoji);

    // List reactions to find the one to remove (same pattern as gchat)
    const reactions = await this.api.listReactions(messageId, emojiType);
    const target = reactions.items.find(
      (r) => r.reaction_type.emoji_type === emojiType
    );

    if (target) {
      await this.api.removeReaction(messageId, target.reaction_id);
    }
  }

  // ===========================================================================
  // Typing Indicator (no-op)
  // ===========================================================================

  async startTyping(_threadId: string, _status?: string): Promise<void> {
    // Feishu does not have a typing indicator API for bots
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private toRawMessage(
    response: FeishuMessageResponse,
    threadId: string
  ): RawMessage<FeishuEventMessage> {
    return {
      id: response.message_id,
      threadId,
      raw: {
        message_id: response.message_id,
        root_id: response.root_id,
        parent_id: response.parent_id,
        create_time: response.create_time,
        update_time: response.update_time,
        chat_id: response.chat_id,
        chat_type: "group",
        message_type: response.msg_type as FeishuEventMessage["message_type"],
        content: response.body.content,
        mentions: response.mentions,
      },
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a Feishu adapter with optional config.
 *
 * Supports zero-config mode: reads credentials from environment variables
 * (`FEISHU_APP_ID`, `FEISHU_APP_SECRET`) when config is not provided.
 */
export function createFeishuAdapter(
  config?: Partial<FeishuAdapterConfig>
): FeishuAdapter {
  const logger = config?.logger ?? new ConsoleLogger("info").child("feishu");

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

  return new FeishuAdapter({
    appId,
    appSecret,
    apiBaseUrl: config?.apiBaseUrl,
    encryptKey: config?.encryptKey ?? process.env.FEISHU_ENCRYPT_KEY,
    verificationToken:
      config?.verificationToken ?? process.env.FEISHU_VERIFICATION_TOKEN,
    logger,
    userName: config?.userName,
  });
}
