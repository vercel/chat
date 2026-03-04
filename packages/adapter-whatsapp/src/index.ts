import {
  AdapterRateLimitError,
  AuthenticationError,
  cardToFallbackText,
  extractCard,
  NetworkError,
  PermissionError,
  ValidationError,
} from "@chat-adapter/shared";
import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
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
  NotImplementedError,
} from "chat";
import { cardToWhatsAppInteractive, decodeWhatsAppCallbackData } from "./cards";
import { WhatsAppFormatConverter } from "./markdown";
import type {
  WhatsAppAdapterConfig,
  WhatsAppApiResponse,
  WhatsAppContact,
  WhatsAppIncomingMessage,
  WhatsAppInteractiveMessage,
  WhatsAppRawMessage,
  WhatsAppReactionMessage,
  WhatsAppTextMessage,
  WhatsAppThreadId,
  WhatsAppWebhookPayload,
} from "./types";

const WHATSAPP_API_BASE = "https://graph.facebook.com";
const WHATSAPP_API_VERSION = "v21.0";
const WHATSAPP_MESSAGE_LIMIT = 4096;
const TRAILING_SLASHES_REGEX = /\/+$/;
const MESSAGE_SEQUENCE_PATTERN = /:(\d+)$/;

interface WhatsAppMessageAuthor {
  fullName: string;
  isBot: boolean | "unknown";
  isMe: boolean;
  userId: string;
  userName: string;
}

export class WhatsAppAdapter
  implements Adapter<WhatsAppThreadId, WhatsAppRawMessage>
{
  readonly name = "whatsapp";

  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly verifyToken?: string;
  private readonly appSecret?: string;
  private readonly apiBaseUrl: string;
  private readonly apiVersion: string;
  private readonly logger: Logger;
  private readonly formatConverter = new WhatsAppFormatConverter();
  private readonly messageCache = new Map<
    string,
    Message<WhatsAppRawMessage>[]
  >();
  private readonly contactNames = new Map<string, string>();

  private chat: ChatInstance | null = null;
  private _botUserId?: string;

  get botUserId(): string | undefined {
    return this._botUserId;
  }

  get userName(): string {
    return this.phoneNumberId;
  }

  constructor(config: WhatsAppAdapterConfig & { logger: Logger }) {
    this.accessToken = config.accessToken;
    this.phoneNumberId = config.phoneNumberId;
    this.verifyToken = config.verifyToken;
    this.appSecret = config.appSecret;
    this.apiBaseUrl = (config.apiBaseUrl ?? WHATSAPP_API_BASE).replace(
      TRAILING_SLASHES_REGEX,
      ""
    );
    this.apiVersion = config.apiVersion ?? WHATSAPP_API_VERSION;
    this.logger = config.logger;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this._botUserId = this.phoneNumberId;

    this.logger.info("WhatsApp adapter initialized", {
      botUserId: this._botUserId,
      phoneNumberId: this.phoneNumberId,
    });
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    // GET requests are webhook verification handshakes
    if (request.method === "GET") {
      return this.handleVerification(request);
    }

    // Optionally verify X-Hub-Signature-256
    if (this.appSecret) {
      const signature = request.headers.get("x-hub-signature-256");
      if (!signature) {
        this.logger.warn(
          "WhatsApp webhook rejected: missing X-Hub-Signature-256"
        );
        return new Response("Missing signature", { status: 401 });
      }

      const body = await request.clone().text();
      const isValid = await this.verifySignature(body, signature);
      if (!isValid) {
        this.logger.warn(
          "WhatsApp webhook rejected: invalid X-Hub-Signature-256"
        );
        return new Response("Invalid signature", { status: 401 });
      }
    }

    let payload: WhatsAppWebhookPayload;
    try {
      payload = (await request.json()) as WhatsAppWebhookPayload;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!this.chat) {
      this.logger.warn(
        "Chat instance not initialized, ignoring WhatsApp webhook"
      );
      return new Response("OK", { status: 200 });
    }

    try {
      this.processPayload(payload, options);
    } catch (error) {
      this.logger.warn("Failed to process WhatsApp webhook payload", {
        error: String(error),
      });
    }

    return new Response("OK", { status: 200 });
  }

  encodeThreadId(platformData: WhatsAppThreadId): string {
    return `whatsapp:${platformData.phoneNumberId}:${platformData.userPhoneNumber}`;
  }

  decodeThreadId(threadId: string): WhatsAppThreadId {
    const parts = threadId.split(":");
    if (parts[0] !== "whatsapp" || parts.length !== 3) {
      throw new ValidationError(
        "whatsapp",
        `Invalid WhatsApp thread ID: ${threadId}`
      );
    }

    const phoneNumberId = parts[1];
    const userPhoneNumber = parts[2];

    if (!(phoneNumberId && userPhoneNumber)) {
      throw new ValidationError(
        "whatsapp",
        `Invalid WhatsApp thread ID: ${threadId}`
      );
    }

    return { phoneNumberId, userPhoneNumber };
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<WhatsAppRawMessage>> {
    const parsed = this.resolveThreadId(threadId);

    const card = extractCard(message);
    if (card) {
      const interactive = cardToWhatsAppInteractive(
        card,
        parsed.userPhoneNumber
      );
      if (interactive) {
        return this.sendInteractiveMessage(interactive, parsed, threadId);
      }
    }

    const text = this.truncateMessage(
      convertEmojiPlaceholders(
        card
          ? cardToFallbackText(card)
          : this.formatConverter.renderPostable(message),
        "gchat"
      )
    );

    if (!text.trim()) {
      throw new ValidationError("whatsapp", "Message text cannot be empty");
    }

    const payload: WhatsAppTextMessage = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: parsed.userPhoneNumber,
      type: "text",
      text: { body: text },
    };

    const response = await this.whatsappFetch<WhatsAppApiResponse>(
      `${this.phoneNumberId}/messages`,
      payload
    );

    const waMessageId = response.messages?.[0]?.id ?? `sent_${Date.now()}`;

    const rawMessage: WhatsAppRawMessage = {
      id: waMessageId,
      from: this.phoneNumberId,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: "text",
      text: { body: text },
    };

    const parsedMessage = this.parseWhatsAppMessage(
      rawMessage,
      threadId,
      parsed.userPhoneNumber
    );
    this.cacheMessage(parsedMessage);

    return {
      id: parsedMessage.id,
      threadId: parsedMessage.threadId,
      raw: rawMessage,
    };
  }

  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage
  ): Promise<RawMessage<WhatsAppRawMessage>> {
    throw new NotImplementedError(
      "WhatsApp Cloud API does not support editing messages",
      "editMessage"
    );
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    throw new NotImplementedError(
      "WhatsApp Cloud API does not support deleting messages",
      "deleteMessage"
    );
  }

  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const parsed = this.resolveThreadId(threadId);
    const resolvedEmoji = this.resolveEmoji(emoji);

    const payload: WhatsAppReactionMessage = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: parsed.userPhoneNumber,
      type: "reaction",
      reaction: {
        message_id: messageId,
        emoji: resolvedEmoji,
      },
    };

    await this.whatsappFetch<WhatsAppApiResponse>(
      `${this.phoneNumberId}/messages`,
      payload
    );
  }

  async removeReaction(
    threadId: string,
    messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    const parsed = this.resolveThreadId(threadId);

    // WhatsApp removes a reaction by sending an empty emoji
    const payload: WhatsAppReactionMessage = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: parsed.userPhoneNumber,
      type: "reaction",
      reaction: {
        message_id: messageId,
        emoji: "",
      },
    };

    await this.whatsappFetch<WhatsAppApiResponse>(
      `${this.phoneNumberId}/messages`,
      payload
    );
  }

  async startTyping(_threadId: string): Promise<void> {
    // WhatsApp Cloud API does not expose typing indicators.
    // No-op for compatibility.
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<WhatsAppRawMessage>> {
    const messages = [...(this.messageCache.get(threadId) ?? [])].sort((a, b) =>
      this.compareMessages(a, b)
    );

    return this.paginateMessages(messages, options);
  }

  async fetchMessage(
    _threadId: string,
    messageId: string
  ): Promise<Message<WhatsAppRawMessage> | null> {
    return this.findCachedMessage(messageId) ?? null;
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const parsed = this.resolveThreadId(threadId);

    return {
      id: this.encodeThreadId(parsed),
      channelId: parsed.phoneNumberId,
      channelName: parsed.userPhoneNumber,
      isDM: true,
      metadata: {
        phoneNumberId: parsed.phoneNumberId,
        userPhoneNumber: parsed.userPhoneNumber,
      },
    };
  }

  channelIdFromThreadId(threadId: string): string {
    return this.resolveThreadId(threadId).phoneNumberId;
  }

  async openDM(userId: string): Promise<string> {
    return this.encodeThreadId({
      phoneNumberId: this.phoneNumberId,
      userPhoneNumber: userId,
    });
  }

  isDM(_threadId: string): boolean {
    // WhatsApp conversations are inherently DMs.
    return true;
  }

  parseMessage(raw: WhatsAppRawMessage): Message<WhatsAppRawMessage> {
    const threadId = this.encodeThreadId({
      phoneNumberId: this.phoneNumberId,
      userPhoneNumber: raw.from ?? "unknown",
    });

    const message = this.parseWhatsAppMessage(raw, threadId, raw.from);
    this.cacheMessage(message);
    return message;
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private handleVerification(request: Request): Response {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === this.verifyToken) {
      this.logger.info("WhatsApp webhook verified");
      return new Response(challenge ?? "", { status: 200 });
    }

    this.logger.warn("WhatsApp webhook verification failed", {
      mode,
      tokenMatch: token === this.verifyToken,
    });
    return new Response("Forbidden", { status: 403 });
  }

  private async verifySignature(
    body: string,
    signature: string
  ): Promise<boolean> {
    if (!this.appSecret) {
      return false;
    }

    const expectedPrefix = "sha256=";
    if (!signature.startsWith(expectedPrefix)) {
      return false;
    }

    const signatureHex = signature.slice(expectedPrefix.length);
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(this.appSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(body)
    );
    const computedHex = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return computedHex === signatureHex;
  }

  private processPayload(
    payload: WhatsAppWebhookPayload,
    options?: WebhookOptions
  ): void {
    if (!payload.entry) {
      return;
    }

    for (const entry of payload.entry) {
      if (!entry.changes) {
        continue;
      }

      for (const change of entry.changes) {
        if (change.field !== "messages" || !change.value) {
          continue;
        }

        // Cache contact names
        if (change.value.contacts) {
          for (const contact of change.value.contacts) {
            if (contact.wa_id && contact.profile?.name) {
              this.contactNames.set(contact.wa_id, contact.profile.name);
            }
          }
        }

        if (change.value.messages) {
          for (const message of change.value.messages) {
            this.handleIncomingMessage(message, change.value.contacts, options);
          }
        }
      }
    }
  }

  private handleIncomingMessage(
    waMessage: WhatsAppIncomingMessage,
    contacts?: WhatsAppContact[],
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      return;
    }

    const from = waMessage.from ?? "unknown";

    // Handle reactions separately
    if (waMessage.type === "reaction" && waMessage.reaction) {
      this.handleReaction(waMessage, from, options);
      return;
    }

    // Handle interactive responses (button/list replies) as actions
    if (waMessage.type === "interactive" && waMessage.interactive) {
      this.handleInteractiveResponse(waMessage, from, contacts, options);
      return;
    }

    // Handle button responses as actions
    if (waMessage.type === "button" && waMessage.button) {
      this.handleButtonResponse(waMessage, from, contacts, options);
      return;
    }

    const threadId = this.encodeThreadId({
      phoneNumberId: this.phoneNumberId,
      userPhoneNumber: from,
    });

    const parsedMessage = this.parseWhatsAppMessage(waMessage, threadId, from);
    this.cacheMessage(parsedMessage);

    this.chat.processMessage(this, threadId, parsedMessage, options);
  }

  private handleReaction(
    waMessage: WhatsAppIncomingMessage,
    from: string,
    options?: WebhookOptions
  ): void {
    if (!(this.chat && waMessage.reaction)) {
      return;
    }

    const threadId = this.encodeThreadId({
      phoneNumberId: this.phoneNumberId,
      userPhoneNumber: from,
    });

    const emoji = waMessage.reaction.emoji ?? "";
    const messageId = waMessage.reaction.message_id ?? "";
    const added = emoji !== "";

    const contactName = this.contactNames.get(from);
    const author: WhatsAppMessageAuthor = {
      userId: from,
      userName: contactName ?? from,
      fullName: contactName ?? from,
      isBot: false,
      isMe: false,
    };

    const emojiValue = emoji
      ? defaultEmojiResolver.fromGChat(emoji)
      : defaultEmojiResolver.fromGChat("");

    this.chat.processReaction(
      {
        adapter: this,
        threadId,
        messageId,
        emoji: emojiValue,
        rawEmoji: emoji,
        added,
        user: author,
        raw: waMessage,
      },
      options
    );
  }

  private handleInteractiveResponse(
    waMessage: WhatsAppIncomingMessage,
    from: string,
    contacts?: WhatsAppContact[],
    options?: WebhookOptions
  ): void {
    if (!(this.chat && waMessage.interactive)) {
      return;
    }

    const threadId = this.encodeThreadId({
      phoneNumberId: this.phoneNumberId,
      userPhoneNumber: from,
    });

    const reply =
      waMessage.interactive.button_reply ?? waMessage.interactive.list_reply;
    if (!reply?.id) {
      return;
    }

    const { actionId, value } = decodeWhatsAppCallbackData(reply.id);
    const contactName = this.resolveContactName(from, contacts);

    this.chat.processAction(
      {
        adapter: this,
        actionId,
        value,
        messageId: waMessage.id ?? "",
        threadId,
        user: {
          userId: from,
          userName: contactName,
          fullName: contactName,
          isBot: false,
          isMe: false,
        },
        raw: waMessage,
      },
      options
    );
  }

  private handleButtonResponse(
    waMessage: WhatsAppIncomingMessage,
    from: string,
    contacts?: WhatsAppContact[],
    options?: WebhookOptions
  ): void {
    if (!(this.chat && waMessage.button)) {
      return;
    }

    const threadId = this.encodeThreadId({
      phoneNumberId: this.phoneNumberId,
      userPhoneNumber: from,
    });

    const payload = waMessage.button.payload ?? waMessage.button.text ?? "";
    const { actionId, value } = decodeWhatsAppCallbackData(payload);
    const contactName = this.resolveContactName(from, contacts);

    this.chat.processAction(
      {
        adapter: this,
        actionId,
        value,
        messageId: waMessage.id ?? "",
        threadId,
        user: {
          userId: from,
          userName: contactName,
          fullName: contactName,
          isBot: false,
          isMe: false,
        },
        raw: waMessage,
      },
      options
    );
  }

  private parseWhatsAppMessage(
    raw: WhatsAppIncomingMessage,
    threadId: string,
    from?: string
  ): Message<WhatsAppRawMessage> {
    const text = this.extractMessageText(raw);
    const contactName = from ? this.contactNames.get(from) : undefined;
    const displayName = contactName ?? from ?? "unknown";

    const author: WhatsAppMessageAuthor = {
      userId: from ?? "unknown",
      userName: displayName,
      fullName: displayName,
      isBot: false,
      isMe: from === this.phoneNumberId,
    };

    const timestamp = raw.timestamp
      ? new Date(Number.parseInt(raw.timestamp, 10) * 1000)
      : new Date();

    return new Message<WhatsAppRawMessage>({
      id: raw.id ?? `msg_${Date.now()}`,
      threadId,
      text,
      formatted: this.formatConverter.toAst(text),
      raw,
      author,
      metadata: {
        dateSent: timestamp,
        edited: false,
      },
      attachments: this.extractAttachments(raw),
      isMention: true, // WhatsApp messages to a business are always directed
    });
  }

  private extractMessageText(raw: WhatsAppIncomingMessage): string {
    if (raw.text?.body) {
      return raw.text.body;
    }
    if (raw.image?.caption) {
      return raw.image.caption;
    }
    if (raw.video?.caption) {
      return raw.video.caption;
    }
    if (raw.document?.caption) {
      return raw.document.caption;
    }
    if (raw.interactive?.button_reply?.title) {
      return raw.interactive.button_reply.title;
    }
    if (raw.interactive?.list_reply?.title) {
      return raw.interactive.list_reply.title;
    }
    if (raw.button?.text) {
      return raw.button.text;
    }
    return "";
  }

  private extractAttachments(raw: WhatsAppIncomingMessage): Attachment[] {
    const attachments: Attachment[] = [];

    if (raw.image?.id) {
      attachments.push(this.createMediaAttachment("image", raw.image));
    }
    if (raw.video?.id) {
      attachments.push(this.createMediaAttachment("video", raw.video));
    }
    if (raw.audio?.id) {
      attachments.push(this.createMediaAttachment("audio", raw.audio));
    }
    if (raw.voice?.id) {
      attachments.push(this.createMediaAttachment("audio", raw.voice));
    }
    if (raw.document?.id) {
      attachments.push(this.createMediaAttachment("file", raw.document));
    }
    if (raw.sticker?.id) {
      attachments.push(this.createMediaAttachment("image", raw.sticker));
    }

    return attachments;
  }

  private createMediaAttachment(
    type: Attachment["type"],
    media: { id?: string; mime_type?: string; filename?: string }
  ): Attachment {
    const mediaId = media.id ?? "";
    return {
      type,
      name: media.filename,
      mimeType: media.mime_type,
      fetchData: async () => this.downloadMedia(mediaId),
    };
  }

  private async downloadMedia(mediaId: string): Promise<Buffer> {
    // First get the media URL
    const mediaInfo = await this.whatsappFetch<{ url?: string }>(mediaId);
    if (!mediaInfo.url) {
      throw new NetworkError(
        "whatsapp",
        `Failed to get download URL for media ${mediaId}`
      );
    }

    // Then download the actual file
    let response: Response;
    try {
      response = await fetch(mediaInfo.url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
    } catch (error) {
      throw new NetworkError(
        "whatsapp",
        `Failed to download WhatsApp media ${mediaId}`,
        error instanceof Error ? error : undefined
      );
    }

    if (!response.ok) {
      throw new NetworkError(
        "whatsapp",
        `Failed to download WhatsApp media ${mediaId}: ${response.status}`
      );
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private async sendInteractiveMessage(
    interactive: WhatsAppInteractiveMessage,
    parsed: WhatsAppThreadId,
    threadId: string
  ): Promise<RawMessage<WhatsAppRawMessage>> {
    const response = await this.whatsappFetch<WhatsAppApiResponse>(
      `${this.phoneNumberId}/messages`,
      interactive
    );

    const waMessageId = response.messages?.[0]?.id ?? `sent_${Date.now()}`;

    const rawMessage: WhatsAppRawMessage = {
      id: waMessageId,
      from: this.phoneNumberId,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: "interactive",
    };

    const parsedMessage = this.parseWhatsAppMessage(
      rawMessage,
      threadId,
      parsed.userPhoneNumber
    );
    this.cacheMessage(parsedMessage);

    return {
      id: parsedMessage.id,
      threadId: parsedMessage.threadId,
      raw: rawMessage,
    };
  }

  private resolveEmoji(emoji: EmojiValue | string): string {
    if (typeof emoji !== "string") {
      return defaultEmojiResolver.toGChat(emoji.name);
    }
    return emoji;
  }

  private resolveContactName(
    from: string,
    contacts?: WhatsAppContact[]
  ): string {
    if (contacts) {
      const contact = contacts.find((c) => c.wa_id === from);
      if (contact?.profile?.name) {
        return contact.profile.name;
      }
    }
    return this.contactNames.get(from) ?? from;
  }

  private resolveThreadId(value: string): WhatsAppThreadId {
    if (value.startsWith("whatsapp:")) {
      return this.decodeThreadId(value);
    }

    return {
      phoneNumberId: this.phoneNumberId,
      userPhoneNumber: value,
    };
  }

  private truncateMessage(text: string): string {
    if (text.length <= WHATSAPP_MESSAGE_LIMIT) {
      return text;
    }
    return `${text.slice(0, WHATSAPP_MESSAGE_LIMIT - 3)}...`;
  }

  private paginateMessages(
    messages: Message<WhatsAppRawMessage>[],
    options: FetchOptions
  ): FetchResult<WhatsAppRawMessage> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    const direction = options.direction ?? "backward";

    if (messages.length === 0) {
      return { messages: [] };
    }

    const messageIndexById = new Map(
      messages.map((message, index) => [message.id, index])
    );

    if (direction === "backward") {
      const end =
        options.cursor && messageIndexById.has(options.cursor)
          ? (messageIndexById.get(options.cursor) ?? messages.length)
          : messages.length;
      const start = Math.max(0, end - limit);
      const page = messages.slice(start, end);

      return {
        messages: page,
        nextCursor: start > 0 ? page[0]?.id : undefined,
      };
    }

    const start =
      options.cursor && messageIndexById.has(options.cursor)
        ? (messageIndexById.get(options.cursor) ?? -1) + 1
        : 0;
    const end = Math.min(messages.length, start + limit);
    const page = messages.slice(start, end);

    return {
      messages: page,
      nextCursor: end < messages.length ? page.at(-1)?.id : undefined,
    };
  }

  private cacheMessage(message: Message<WhatsAppRawMessage>): void {
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

  private findCachedMessage(
    messageId: string
  ): Message<WhatsAppRawMessage> | undefined {
    for (const messages of this.messageCache.values()) {
      const found = messages.find((message) => message.id === messageId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  private compareMessages(
    a: Message<WhatsAppRawMessage>,
    b: Message<WhatsAppRawMessage>
  ): number {
    const timeDiff =
      a.metadata.dateSent.getTime() - b.metadata.dateSent.getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return this.messageSequence(a.id) - this.messageSequence(b.id);
  }

  private messageSequence(messageId: string): number {
    const match = messageId.match(MESSAGE_SEQUENCE_PATTERN);
    return match ? Number.parseInt(match[1], 10) : 0;
  }

  private async whatsappFetch<TResult>(
    endpoint: string,
    payload?: object
  ): Promise<TResult> {
    const url = `${this.apiBaseUrl}/${this.apiVersion}/${endpoint}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload ?? {}),
      });
    } catch (error) {
      throw new NetworkError(
        "whatsapp",
        `Network error calling WhatsApp API ${endpoint}`,
        error instanceof Error ? error : undefined
      );
    }

    let data: TResult & { error?: { code?: number; message?: string } };
    try {
      data = (await response.json()) as TResult & {
        error?: { code?: number; message?: string };
      };
    } catch {
      throw new NetworkError(
        "whatsapp",
        `Failed to parse WhatsApp API response for ${endpoint}`
      );
    }

    if (!response.ok || data.error) {
      this.throwWhatsAppApiError(endpoint, response.status, data.error);
    }

    return data;
  }

  private throwWhatsAppApiError(
    endpoint: string,
    status: number,
    error?: { code?: number; message?: string }
  ): never {
    const errorCode = error?.code ?? status;
    const description = error?.message ?? `WhatsApp API ${endpoint} failed`;

    if (status === 429 || errorCode === 80007) {
      throw new AdapterRateLimitError("whatsapp");
    }

    if (status === 401 || errorCode === 190) {
      throw new AuthenticationError("whatsapp", description);
    }

    if (status === 403 || errorCode === 10) {
      throw new PermissionError("whatsapp", endpoint);
    }

    if (errorCode >= 400 && errorCode < 500) {
      throw new ValidationError("whatsapp", description);
    }

    throw new NetworkError(
      "whatsapp",
      `${description} (status ${status}, error ${errorCode})`
    );
  }
}

export function createWhatsAppAdapter(
  config?: Partial<WhatsAppAdapterConfig & { logger: Logger }>
): WhatsAppAdapter {
  const accessToken = config?.accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) {
    throw new ValidationError(
      "whatsapp",
      "accessToken is required. Set WHATSAPP_ACCESS_TOKEN or provide it in config."
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
  const appSecret = config?.appSecret ?? process.env.WHATSAPP_APP_SECRET;
  const apiBaseUrl = config?.apiBaseUrl ?? WHATSAPP_API_BASE;
  const apiVersion = config?.apiVersion ?? WHATSAPP_API_VERSION;

  return new WhatsAppAdapter({
    accessToken,
    phoneNumberId,
    verifyToken,
    appSecret,
    apiBaseUrl,
    apiVersion,
    logger: config?.logger ?? new ConsoleLogger("info").child("whatsapp"),
  });
}

export {
  cardToWhatsAppInteractive,
  decodeWhatsAppCallbackData,
  encodeWhatsAppCallbackData,
} from "./cards";
export { WhatsAppFormatConverter } from "./markdown";
export type {
  WhatsAppAdapterConfig,
  WhatsAppIncomingMessage,
  WhatsAppInteractiveMessage,
  WhatsAppRawMessage,
  WhatsAppThreadId,
  WhatsAppWebhookPayload,
} from "./types";
