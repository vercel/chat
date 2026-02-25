import { createHmac, timingSafeEqual } from "node:crypto";
import { extractCard, ValidationError } from "@chat-adapter/shared";
import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
  Author,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Logger,
  RawMessage,
  ReactionEvent,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import { ConsoleLogger, getEmoji, Message } from "chat";
import { cardToWhatsApp } from "./cards";
import { WhatsAppFormatConverter } from "./markdown";
import type {
  WhatsAppAdapterConfig,
  WhatsAppContact,
  WhatsAppInboundMessage,
  WhatsAppMediaResponse,
  WhatsAppRawMessage,
  WhatsAppSendResponse,
  WhatsAppThreadId,
  WhatsAppWebhookPayload,
} from "./types";

/** Graph API base URL */
const GRAPH_API_URL = "https://graph.facebook.com/v21.0";

// Re-export types
export type {
  WhatsAppAdapterConfig,
  WhatsAppMediaResponse,
  WhatsAppRawMessage,
  WhatsAppThreadId,
} from "./types";

/**
 * WhatsApp adapter for chat SDK.
 *
 * Supports messaging via the WhatsApp Business Cloud API (Meta Graph API).
 * All conversations are 1:1 DMs between the business phone number and users.
 *
 * @example
 * ```typescript
 * import { Chat } from "chat";
 * import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";
 * import { MemoryState } from "@chat-adapter/state-memory";
 *
 * const chat = new Chat({
 *   userName: "my-bot",
 *   adapters: {
 *     whatsapp: createWhatsAppAdapter(),
 *   },
 *   state: new MemoryState(),
 * });
 * ```
 */
export class WhatsAppAdapter
  implements Adapter<WhatsAppThreadId, WhatsAppRawMessage>
{
  readonly name = "whatsapp";
  readonly userName: string;

  private readonly accessToken: string;
  private readonly appSecret: string;
  private readonly phoneNumberId: string;
  private readonly verifyToken: string;
  private chat: ChatInstance | null = null;
  private readonly logger: Logger;
  private _botUserId: string | null = null;
  private readonly formatConverter = new WhatsAppFormatConverter();

  /** Bot user ID used for self-message detection */
  get botUserId(): string | undefined {
    return this._botUserId ?? undefined;
  }

  constructor(config: WhatsAppAdapterConfig) {
    this.accessToken = config.accessToken;
    this.appSecret = config.appSecret;
    this.phoneNumberId = config.phoneNumberId;
    this.verifyToken = config.verifyToken;
    this.logger = config.logger;
    this.userName = config.userName;
  }

  /**
   * Initialize the adapter and fetch business profile info.
   */
  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    // The bot's "user ID" is the phone number ID
    this._botUserId = this.phoneNumberId;
    this.logger.info("WhatsApp adapter initialized", {
      phoneNumberId: this.phoneNumberId,
    });
  }

  /**
   * Handle incoming webhook from WhatsApp.
   *
   * Handles both the GET verification challenge and POST event notifications.
   *
   * @see https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks
   */
  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    // Handle webhook verification challenge (GET request)
    if (request.method === "GET") {
      return this.handleVerificationChallenge(request);
    }

    const body = await request.text();
    this.logger.debug("WhatsApp webhook raw body", {
      body: body.substring(0, 500),
    });

    // Verify request signature (X-Hub-Signature-256 header)
    const signature = request.headers.get("x-hub-signature-256");
    if (!this.verifySignature(body, signature)) {
      return new Response("Invalid signature", { status: 401 });
    }

    // Parse the JSON payload
    let payload: WhatsAppWebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      this.logger.error("WhatsApp webhook invalid JSON", {
        contentType: request.headers.get("content-type"),
        bodyPreview: body.substring(0, 200),
      });
      return new Response("Invalid JSON", { status: 400 });
    }

    // Process entries
    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        if (change.field !== "messages") {
          continue;
        }

        const { value } = change;

        // Process incoming messages
        if (value.messages) {
          for (const message of value.messages) {
            this.handleInboundMessage(
              message,
              value.contacts?.[0],
              value.metadata.phone_number_id,
              options
            );
          }
        }
      }
    }

    return new Response("ok", { status: 200 });
  }

  /**
   * Handle the webhook verification challenge from Meta.
   *
   * @see https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks
   */
  private handleVerificationChallenge(request: Request): Response {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === this.verifyToken) {
      this.logger.info("WhatsApp webhook verification succeeded");
      return new Response(challenge ?? "", { status: 200 });
    }

    this.logger.warn("WhatsApp webhook verification failed", {
      mode,
      tokenMatch: token === this.verifyToken,
    });
    return new Response("Forbidden", { status: 403 });
  }

  /**
   * Verify webhook signature using HMAC-SHA256 with the App Secret.
   *
   * @see https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
   */
  private verifySignature(body: string, signature: string | null): boolean {
    if (!signature) {
      return false;
    }

    const expectedSignature = `sha256=${createHmac("sha256", this.appSecret).update(body).digest("hex")}`;

    try {
      return timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch {
      return false;
    }
  }

  /**
   * Handle an inbound message from a user.
   */
  private handleInboundMessage(
    inbound: WhatsAppInboundMessage,
    contact: WhatsAppContact | undefined,
    phoneNumberId: string,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring message");
      return;
    }

    // Handle reactions separately
    if (inbound.type === "reaction" && inbound.reaction) {
      this.handleReaction(inbound, contact, phoneNumberId, options);
      return;
    }

    // Handle interactive message replies (button clicks)
    if (inbound.type === "interactive" && inbound.interactive) {
      this.handleInteractiveReply(inbound, contact, phoneNumberId, options);
      return;
    }

    // Extract text content based on message type
    const text = this.extractTextContent(inbound);
    if (text === null) {
      this.logger.debug("Unsupported message type, ignoring", {
        type: inbound.type,
        messageId: inbound.id,
      });
      return;
    }

    const threadId = this.encodeThreadId({
      phoneNumberId,
      userWaId: inbound.from,
    });

    const message = this.buildMessage(
      inbound,
      contact,
      threadId,
      text,
      phoneNumberId
    );
    this.chat.processMessage(this, threadId, message, options);
  }

  /**
   * Handle reaction events.
   */
  private handleReaction(
    inbound: WhatsAppInboundMessage,
    contact: WhatsAppContact | undefined,
    phoneNumberId: string,
    options?: WebhookOptions
  ): void {
    if (!(this.chat && inbound.reaction)) {
      return;
    }

    const threadId = this.encodeThreadId({
      phoneNumberId,
      userWaId: inbound.from,
    });

    const rawEmoji = inbound.reaction.emoji;
    // Empty emoji means reaction was removed
    const added = rawEmoji !== "";
    const emojiValue = added ? getEmoji(rawEmoji) : getEmoji("");

    const user: Author = {
      userId: inbound.from,
      userName: contact?.profile.name || inbound.from,
      fullName: contact?.profile.name || inbound.from,
      isBot: false,
      isMe: false,
    };

    const event: Omit<ReactionEvent, "adapter" | "thread"> = {
      emoji: emojiValue,
      rawEmoji,
      added,
      user,
      messageId: inbound.reaction.message_id,
      threadId,
      raw: inbound,
    };

    this.chat.processReaction({ ...event, adapter: this }, options);
  }

  /**
   * Handle interactive message replies (button/list selection).
   */
  private handleInteractiveReply(
    inbound: WhatsAppInboundMessage,
    contact: WhatsAppContact | undefined,
    phoneNumberId: string,
    options?: WebhookOptions
  ): void {
    if (!(this.chat && inbound.interactive)) {
      return;
    }

    const threadId = this.encodeThreadId({
      phoneNumberId,
      userWaId: inbound.from,
    });

    const { interactive } = inbound;
    let actionId: string;
    let actionValue: string;

    if (interactive.type === "button_reply" && interactive.button_reply) {
      actionId = interactive.button_reply.id;
      actionValue = interactive.button_reply.title;
    } else if (interactive.type === "list_reply" && interactive.list_reply) {
      actionId = interactive.list_reply.id;
      actionValue = interactive.list_reply.title;
    } else {
      return;
    }

    this.chat.processAction(
      {
        adapter: this,
        actionId,
        value: actionValue,
        user: {
          userId: inbound.from,
          userName: contact?.profile.name || inbound.from,
          fullName: contact?.profile.name || inbound.from,
          isBot: false,
          isMe: false,
        },
        messageId: inbound.id,
        threadId,
        raw: inbound,
      },
      options
    );
  }

  /**
   * Extract text content from an inbound message.
   * Returns null for unsupported message types.
   */
  private extractTextContent(message: WhatsAppInboundMessage): string | null {
    switch (message.type) {
      case "text":
        return message.text?.body ?? null;
      case "image":
        return message.image?.caption ?? "[Image]";
      case "document":
        return (
          message.document?.caption ??
          `[Document: ${message.document?.filename ?? "file"}]`
        );
      case "audio":
        return "[Audio message]";
      case "video":
        return "[Video]";
      case "sticker":
        return "[Sticker]";
      case "location": {
        const loc = message.location;
        if (loc) {
          const parts = [`[Location: ${loc.latitude}, ${loc.longitude}`];
          if (loc.name) {
            parts[0] = `[Location: ${loc.name}`;
          }
          if (loc.address) {
            parts.push(loc.address);
          }
          return `${parts.join(" - ")}]`;
        }
        return "[Location]";
      }
      default:
        return null;
    }
  }

  /**
   * Build a Message from a WhatsApp inbound message.
   */
  private buildMessage(
    inbound: WhatsAppInboundMessage,
    contact: WhatsAppContact | undefined,
    threadId: string,
    text: string,
    phoneNumberId?: string
  ): Message<WhatsAppRawMessage> {
    const author: Author = {
      userId: inbound.from,
      userName: contact?.profile.name || inbound.from,
      fullName: contact?.profile.name || inbound.from,
      isBot: false,
      isMe: false,
    };

    const formatted: FormattedContent = this.formatConverter.toAst(text);

    const raw: WhatsAppRawMessage = {
      message: inbound,
      contact,
      phoneNumberId: phoneNumberId || this.phoneNumberId,
    };

    const attachments = this.buildAttachments(inbound);

    return new Message<WhatsAppRawMessage>({
      id: inbound.id,
      threadId,
      text,
      formatted,
      raw,
      author,
      // All WhatsApp messages are DMs directly to the bot
      isMention: true,
      metadata: {
        dateSent: new Date(Number.parseInt(inbound.timestamp, 10) * 1000),
        edited: false,
      },
      attachments,
    });
  }

  /**
   * Build attachments from an inbound message.
   */
  private buildAttachments(inbound: WhatsAppInboundMessage): Attachment[] {
    const attachments: Attachment[] = [];

    if (inbound.image) {
      attachments.push(
        this.buildMediaAttachment(
          inbound.image.id,
          "image",
          inbound.image.mime_type
        )
      );
    }

    if (inbound.document) {
      attachments.push(
        this.buildMediaAttachment(
          inbound.document.id,
          "file",
          inbound.document.mime_type,
          inbound.document.filename
        )
      );
    }

    if (inbound.audio) {
      attachments.push(
        this.buildMediaAttachment(
          inbound.audio.id,
          "audio",
          inbound.audio.mime_type
        )
      );
    }

    if (inbound.video) {
      attachments.push(
        this.buildMediaAttachment(
          inbound.video.id,
          "video",
          inbound.video.mime_type
        )
      );
    }

    if (inbound.sticker) {
      attachments.push(
        this.buildMediaAttachment(
          inbound.sticker.id,
          "image",
          inbound.sticker.mime_type,
          "sticker"
        )
      );
    }

    if (inbound.location) {
      const loc = inbound.location;
      const mapUrl = `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`;
      attachments.push({
        type: "file",
        name: loc.name || "Location",
        url: mapUrl,
        mimeType: "application/geo+json",
      });
    }

    return attachments;
  }

  /**
   * Build a single media attachment with a lazy fetchData function.
   */
  private buildMediaAttachment(
    mediaId: string,
    type: Attachment["type"],
    mimeType: string,
    name?: string
  ): Attachment {
    return {
      type,
      mimeType,
      name,
      fetchData: () => this.downloadMedia(mediaId),
    };
  }

  /**
   * Download media from WhatsApp.
   *
   * WhatsApp media is fetched in two steps:
   * 1. GET the media metadata to obtain the download URL
   * 2. GET the actual binary data from the download URL
   *
   * @param mediaId - The media ID from the inbound message
   * @returns The media data as a Buffer
   *
   * @see https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media#download-media
   */
  async downloadMedia(mediaId: string): Promise<Buffer> {
    // Step 1: Get the media URL
    const metaResponse = await fetch(`${GRAPH_API_URL}/${mediaId}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!metaResponse.ok) {
      const errorBody = await metaResponse.text();
      this.logger.error("Failed to get media URL", {
        status: metaResponse.status,
        body: errorBody,
        mediaId,
      });
      throw new Error(
        `Failed to get media URL: ${metaResponse.status} ${errorBody}`
      );
    }

    const mediaInfo: WhatsAppMediaResponse =
      (await metaResponse.json()) as WhatsAppMediaResponse;

    // Step 2: Download the actual file
    const dataResponse = await fetch(mediaInfo.url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!dataResponse.ok) {
      this.logger.error("Failed to download media", {
        status: dataResponse.status,
        mediaId,
      });
      throw new Error(`Failed to download media: ${dataResponse.status}`);
    }

    const arrayBuffer = await dataResponse.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Send a message to a WhatsApp user.
   *
   * @see https://developers.facebook.com/docs/whatsapp/cloud-api/messages
   */
  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<WhatsAppRawMessage>> {
    const { userWaId } = this.decodeThreadId(threadId);

    // Check if this is a card with interactive buttons
    const card = extractCard(message);
    if (card) {
      const result = cardToWhatsApp(card);
      if (result.type === "interactive") {
        return this.sendInteractiveMessage(
          threadId,
          userWaId,
          result.interactive
        );
      }
      return this.sendTextMessage(threadId, userWaId, result.text);
    }

    // Regular text message
    const body = this.formatConverter.renderPostable(message);
    return this.sendTextMessage(threadId, userWaId, body);
  }

  /**
   * Send a text message via the Cloud API.
   */
  private async sendTextMessage(
    threadId: string,
    to: string,
    text: string
  ): Promise<RawMessage<WhatsAppRawMessage>> {
    const response = await this.graphApiRequest<WhatsAppSendResponse>(
      `/${this.phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: text },
      }
    );

    if (!(response.messages?.length && response.messages[0]?.id)) {
      throw new Error(
        "WhatsApp API did not return a message ID for text message"
      );
    }
    const messageId = response.messages[0].id;

    return {
      id: messageId,
      threadId,
      raw: {
        message: {
          id: messageId,
          from: this.phoneNumberId,
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "text",
          text: { body: text },
        },
        phoneNumberId: this.phoneNumberId,
      },
    };
  }

  /**
   * Send an interactive message (buttons or list) via the Cloud API.
   */
  private async sendInteractiveMessage(
    threadId: string,
    to: string,
    interactive: object
  ): Promise<RawMessage<WhatsAppRawMessage>> {
    const response = await this.graphApiRequest<WhatsAppSendResponse>(
      `/${this.phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "interactive",
        interactive,
      }
    );

    if (!(response.messages?.length && response.messages[0]?.id)) {
      throw new Error(
        "WhatsApp API did not return a message ID for interactive message"
      );
    }
    const messageId = response.messages[0].id;

    return {
      id: messageId,
      threadId,
      raw: {
        message: {
          id: messageId,
          from: this.phoneNumberId,
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "interactive",
        },
        phoneNumberId: this.phoneNumberId,
      },
    };
  }

  /**
   * Edit a message. Not supported by WhatsApp Cloud API.
   *
   * WhatsApp does not support editing sent messages. This method
   * sends a new message as a fallback.
   */
  async editMessage(
    threadId: string,
    _messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<WhatsAppRawMessage>> {
    this.logger.warn(
      "WhatsApp does not support editing messages. Sending a new message instead."
    );
    return this.postMessage(threadId, message);
  }

  /**
   * Delete a message. Not supported by WhatsApp Cloud API.
   */
  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    this.logger.warn("WhatsApp does not support deleting sent messages");
  }

  /**
   * Add a reaction to a message.
   *
   * @see https://developers.facebook.com/docs/whatsapp/cloud-api/messages/reaction-messages
   */
  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const { userWaId } = this.decodeThreadId(threadId);
    const emojiStr = this.resolveEmoji(emoji);

    await this.graphApiRequest(`/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: userWaId,
      type: "reaction",
      reaction: {
        message_id: messageId,
        emoji: emojiStr,
      },
    });
  }

  /**
   * Remove a reaction from a message.
   *
   * @see https://developers.facebook.com/docs/whatsapp/cloud-api/messages/reaction-messages
   */
  async removeReaction(
    threadId: string,
    messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    const { userWaId } = this.decodeThreadId(threadId);

    // WhatsApp removes reactions by sending an empty emoji
    await this.graphApiRequest(`/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: userWaId,
      type: "reaction",
      reaction: {
        message_id: messageId,
        emoji: "",
      },
    });
  }

  /**
   * Start typing indicator.
   *
   * WhatsApp supports typing indicators via the messages endpoint.
   * The indicator displays for up to 25 seconds or until the next message.
   *
   * @see https://developers.facebook.com/docs/whatsapp/cloud-api/messages/mark-messages-as-read
   */
  async startTyping(threadId: string, _status?: string): Promise<void> {
    const { userWaId } = this.decodeThreadId(threadId);

    try {
      await this.graphApiRequest(`/${this.phoneNumberId}/messages`, {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: userWaId,
        typing_indicator: { type: "text" },
      });
    } catch (error) {
      this.logger.debug("Failed to send typing indicator", { error });
    }
  }

  /**
   * Fetch messages. Not supported by WhatsApp Cloud API.
   *
   * WhatsApp does not provide an API to retrieve message history.
   */
  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions
  ): Promise<FetchResult<WhatsAppRawMessage>> {
    this.logger.debug(
      "fetchMessages not supported on WhatsApp - message history is not available via Cloud API"
    );
    return { messages: [] };
  }

  /**
   * Fetch thread info.
   */
  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { phoneNumberId, userWaId } = this.decodeThreadId(threadId);

    return {
      id: threadId,
      channelId: `whatsapp:${phoneNumberId}`,
      channelName: `WhatsApp: ${userWaId}`,
      isDM: true,
      metadata: { phoneNumberId, userWaId },
    };
  }

  /**
   * Encode a WhatsApp thread ID.
   *
   * Format: whatsapp:{phoneNumberId}:{userWaId}
   */
  encodeThreadId(platformData: WhatsAppThreadId): string {
    return `whatsapp:${platformData.phoneNumberId}:${platformData.userWaId}`;
  }

  /**
   * Decode a WhatsApp thread ID.
   *
   * Format: whatsapp:{phoneNumberId}:{userWaId}
   */
  decodeThreadId(threadId: string): WhatsAppThreadId {
    if (!threadId.startsWith("whatsapp:")) {
      throw new ValidationError(
        "whatsapp",
        `Invalid WhatsApp thread ID: ${threadId}`
      );
    }

    const withoutPrefix = threadId.slice(9);
    if (!withoutPrefix) {
      throw new ValidationError(
        "whatsapp",
        `Invalid WhatsApp thread ID format: ${threadId}`
      );
    }

    const parts = withoutPrefix.split(":");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new ValidationError(
        "whatsapp",
        `Invalid WhatsApp thread ID format: ${threadId}`
      );
    }

    return {
      phoneNumberId: parts[0],
      userWaId: parts[1],
    };
  }

  /**
   * Derive channel ID from a WhatsApp thread ID.
   * whatsapp:{phoneNumberId}:{userWaId} -> whatsapp:{phoneNumberId}
   */
  channelIdFromThreadId(threadId: string): string {
    const { phoneNumberId } = this.decodeThreadId(threadId);
    return `whatsapp:${phoneNumberId}`;
  }

  /**
   * All WhatsApp conversations are DMs.
   */
  isDM(_threadId: string): boolean {
    return true;
  }

  /**
   * Open a DM with a user. Returns the thread ID for the conversation.
   *
   * For WhatsApp, this simply constructs the thread ID since all
   * conversations are inherently DMs. Note: you can only message users
   * who have messaged you first (within the 24-hour window) or
   * via approved template messages.
   */
  async openDM(userId: string): Promise<string> {
    return this.encodeThreadId({
      phoneNumberId: this.phoneNumberId,
      userWaId: userId,
    });
  }

  /**
   * Parse platform message format to normalized format.
   */
  parseMessage(raw: WhatsAppRawMessage): Message<WhatsAppRawMessage> {
    const text = this.extractTextContent(raw.message) || "";
    const formatted: FormattedContent = this.formatConverter.toAst(text);
    const attachments = this.buildAttachments(raw.message);
    const threadId = this.encodeThreadId({
      phoneNumberId: raw.phoneNumberId,
      userWaId: raw.message.from,
    });

    return new Message<WhatsAppRawMessage>({
      id: raw.message.id,
      threadId,
      text,
      formatted,
      author: {
        userId: raw.message.from,
        userName: raw.contact?.profile.name || raw.message.from,
        fullName: raw.contact?.profile.name || raw.message.from,
        isBot: false,
        isMe: raw.message.from === this._botUserId,
      },
      isMention: true,
      metadata: {
        dateSent: new Date(Number.parseInt(raw.message.timestamp, 10) * 1000),
        edited: false,
      },
      attachments,
      raw,
    });
  }

  /**
   * Render formatted content to WhatsApp markdown.
   */
  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  /**
   * Mark an inbound message as read.
   *
   * @see https://developers.facebook.com/docs/whatsapp/cloud-api/messages/mark-messages-as-read
   */
  async markAsRead(messageId: string): Promise<void> {
    await this.graphApiRequest(`/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    });
  }

  // =============================================================================
  // Private helpers
  // =============================================================================

  /**
   * Make a request to the Meta Graph API.
   */
  private async graphApiRequest<T = unknown>(
    path: string,
    body: unknown
  ): Promise<T> {
    const response = await fetch(`${GRAPH_API_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error("WhatsApp API error", {
        status: response.status,
        body: errorBody,
        path,
      });
      throw new Error(`WhatsApp API error: ${response.status} ${errorBody}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Resolve an emoji value to a unicode string.
   */
  private resolveEmoji(emoji: EmojiValue | string): string {
    const emojiName = typeof emoji === "string" ? emoji : emoji.name;

    const mapping: Record<string, string> = {
      thumbs_up: "\u{1F44D}",
      thumbs_down: "\u{1F44E}",
      heart: "\u{2764}\u{FE0F}",
      fire: "\u{1F525}",
      rocket: "\u{1F680}",
      eyes: "\u{1F440}",
      check: "\u{2705}",
      warning: "\u{26A0}\u{FE0F}",
      sparkles: "\u{2728}",
      wave: "\u{1F44B}",
      raised_hands: "\u{1F64C}",
      laugh: "\u{1F604}",
      hooray: "\u{1F389}",
      confused: "\u{1F615}",
    };

    return mapping[emojiName] || emojiName;
  }
}

/**
 * Factory function to create a WhatsApp adapter.
 *
 * @example
 * ```typescript
 * const adapter = createWhatsAppAdapter({
 *   accessToken: process.env.WHATSAPP_ACCESS_TOKEN!,
 *   appSecret: process.env.WHATSAPP_APP_SECRET!,
 *   phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
 *   verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
 * });
 * ```
 */
export function createWhatsAppAdapter(config?: {
  accessToken?: string;
  appSecret?: string;
  logger?: Logger;
  phoneNumberId?: string;
  userName?: string;
  verifyToken?: string;
}): WhatsAppAdapter {
  const logger = config?.logger ?? new ConsoleLogger("info").child("whatsapp");

  const accessToken = config?.accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) {
    throw new ValidationError(
      "whatsapp",
      "accessToken is required. Set WHATSAPP_ACCESS_TOKEN or provide it in config."
    );
  }

  const appSecret = config?.appSecret ?? process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    throw new ValidationError(
      "whatsapp",
      "appSecret is required. Set WHATSAPP_APP_SECRET or provide it in config."
    );
  }

  const phoneNumberId =
    config?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneNumberId) {
    throw new ValidationError(
      "whatsapp",
      "phoneNumberId is required. Set WHATSAPP_PHONE_NUMBER_ID or provide it in config."
    );
  }

  const verifyToken = config?.verifyToken ?? process.env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    throw new ValidationError(
      "whatsapp",
      "verifyToken is required. Set WHATSAPP_VERIFY_TOKEN or provide it in config."
    );
  }

  const userName =
    config?.userName ?? process.env.WHATSAPP_BOT_USERNAME ?? "whatsapp-bot";

  return new WhatsAppAdapter({
    accessToken,
    appSecret,
    phoneNumberId,
    verifyToken,
    userName,
    logger,
  });
}
