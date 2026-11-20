import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { ValidationError } from "@chat-adapter/shared";
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
  StreamChunk,
  StreamOptions,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import { ConsoleLogger, Message, NotImplementedError } from "chat";
import { WebhookFormatConverter } from "./markdown";
import type {
  WebhookAdapterConfig,
  WebhookInboundMessage,
  WebhookSendResult,
  WebhookTarget,
  WebhookThreadId,
} from "./types";

const DEFAULT_NAME = "webhook";
const DEFAULT_SIGNATURE_HEADER = "x-webhook-signature";
const SIGNATURE_PREFIX_PATTERN = /^sha256=/i;

type ResolvedWebhookAdapterConfig = WebhookAdapterConfig & {
  logger: Logger;
  name: string;
};

/**
 * Generic adapter for any platform that delivers messages as HTTP webhooks
 * and accepts replies over HTTP. You describe the platform with a `parse`
 * callback for inbound requests and a `send` callback for outbound messages.
 */
export class WebhookAdapter implements Adapter<WebhookThreadId, unknown> {
  readonly name: string;
  /**
   * Most HTTP platforms have no history API, so Chat SDK keeps thread
   * history in the state adapter.
   */
  readonly persistThreadHistory = true;

  protected readonly config: ResolvedWebhookAdapterConfig;
  protected readonly logger: Logger;
  protected readonly formatConverter = new WebhookFormatConverter();
  protected readonly signatureHeader: string;
  protected chat: ChatInstance | null = null;
  protected _userName: string;
  protected readonly hasExplicitUserName: boolean;

  get userName(): string {
    return this._userName;
  }

  constructor(config: ResolvedWebhookAdapterConfig) {
    if (!config.name || config.name.includes(":")) {
      throw new ValidationError(
        DEFAULT_NAME,
        `Invalid adapter name "${config.name}". Use a non-empty name without ":".`
      );
    }
    this.config = config;
    this.name = config.name;
    this.logger = config.logger;
    this.signatureHeader = config.signatureHeader ?? DEFAULT_SIGNATURE_HEADER;
    this._userName = config.userName ?? "bot";
    this.hasExplicitUserName = Boolean(config.userName);
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    if (!this.hasExplicitUserName) {
      this._userName = chat.getUserName();
    }
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "POST" },
      });
    }

    const body = await request.text();

    if (!(await this.verifyRequest(request, body))) {
      this.logger.warn("Webhook request rejected due to failed verification");
      return new Response("Invalid signature", { status: 401 });
    }

    let payload: unknown;
    try {
      payload = this.parseBody(body, request);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Build every message before dispatching any, so an invalid item doesn't
    // leave earlier items processed when the platform retries the request.
    let messages: Message<unknown>[];
    try {
      const parsed = await this.config.parse(payload, { body, request });
      messages = this.toInboundList(parsed).map((item) =>
        this.parseMessage(item, payload)
      );
    } catch (error) {
      this.logger.error("Webhook parse callback failed", {
        error: String(error),
      });
      return new Response("Failed to parse webhook", { status: 500 });
    }

    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring webhook");
      return new Response("OK", { status: 200 });
    }

    for (const message of messages) {
      this.chat.processMessage(this, message.threadId, message, options);
    }

    return new Response("OK", { status: 200 });
  }

  protected toInboundList(
    parsed: Awaited<ReturnType<WebhookAdapterConfig["parse"]>>
  ): readonly WebhookInboundMessage[] {
    if (!parsed) {
      return [];
    }
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [parsed as WebhookInboundMessage];
  }

  /**
   * Decode the raw request body into the payload passed to `parse`.
   * Override to accept formats other than JSON.
   */
  protected parseBody(body: string, _request: Request): unknown {
    return JSON.parse(body);
  }

  /**
   * Verify the request with the `verify` callback, or with an HMAC-SHA256
   * signature of the raw body when only `secret` is set.
   */
  protected async verifyRequest(
    request: Request,
    body: string
  ): Promise<boolean> {
    if (this.config.verify) {
      try {
        return await this.config.verify(request, body);
      } catch (error) {
        this.logger.warn("Webhook verify callback threw", {
          error: String(error),
        });
        return false;
      }
    }
    return this.verifySignature(request, body);
  }

  protected verifySignature(request: Request, body: string): boolean {
    const secret = this.config.secret;
    if (!secret) {
      return false;
    }
    const header = request.headers.get(this.signatureHeader);
    if (!header) {
      return false;
    }
    const received = header.trim().replace(SIGNATURE_PREFIX_PATTERN, "");
    const expected = createHmac("sha256", secret)
      .update(body, "utf8")
      .digest("hex");
    const receivedBuffer = Buffer.from(received.toLowerCase(), "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");
    if (receivedBuffer.length !== expectedBuffer.length) {
      return false;
    }
    return timingSafeEqual(receivedBuffer, expectedBuffer);
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<unknown>> {
    const target = this.toTarget(threadId);
    const result = await this.config.send({
      ...target,
      message,
      text: this.formatConverter.renderPostable(message),
    });
    return this.toRawMessage(threadId, result);
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<unknown>> {
    if (!this.config.edit) {
      throw new NotImplementedError(
        `Adapter "${this.name}" has no edit callback`,
        "editMessage"
      );
    }
    const target = this.toTarget(threadId);
    const result = await this.config.edit({
      ...target,
      message,
      messageId,
      text: this.formatConverter.renderPostable(message),
    });
    return this.toRawMessage(threadId, result, messageId);
  }

  /**
   * Without an `edit` callback, buffer the stream and send it once complete.
   * With one, return `null` so Chat SDK posts and edits as chunks arrive.
   */
  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    _options?: StreamOptions
  ): Promise<RawMessage<unknown> | null> {
    if (this.config.edit) {
      return null;
    }
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

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    if (!this.config.delete) {
      throw new NotImplementedError(
        `Adapter "${this.name}" has no delete callback`,
        "deleteMessage"
      );
    }
    await this.config.delete({ ...this.toTarget(threadId), messageId });
  }

  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new NotImplementedError(
      `Adapter "${this.name}" does not support reactions`,
      "addReaction"
    );
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new NotImplementedError(
      `Adapter "${this.name}" does not support reactions`,
      "removeReaction"
    );
  }

  async startTyping(threadId: string): Promise<void> {
    await this.config.startTyping?.(this.toTarget(threadId));
  }

  /**
   * The platform has no history API, so this returns no messages. Chat SDK
   * serves thread history from the state adapter instead.
   */
  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions
  ): Promise<FetchResult<unknown>> {
    return { messages: [] };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const decoded = this.decodeThreadId(threadId);
    return {
      id: threadId,
      channelId: this.channelIdFromThreadId(threadId),
      metadata: { ...decoded },
    };
  }

  channelIdFromThreadId(threadId: string): string {
    const { channelId } = this.decodeThreadId(threadId);
    return this.encodeThreadId({ channelId });
  }

  encodeThreadId(platformData: WebhookThreadId): string {
    const channel = Buffer.from(platformData.channelId, "utf8").toString(
      "base64url"
    );
    if (platformData.threadId) {
      const thread = Buffer.from(platformData.threadId, "utf8").toString(
        "base64url"
      );
      return `${this.name}:${channel}:${thread}`;
    }
    return `${this.name}:${channel}`;
  }

  decodeThreadId(threadId: string): WebhookThreadId {
    const parts = threadId.split(":");
    const [prefix, channel, thread] = parts;
    if (prefix !== this.name || !channel || parts.length > 3) {
      throw new ValidationError(
        this.name,
        `Invalid ${this.name} thread ID: ${threadId}`
      );
    }
    const channelId = Buffer.from(channel, "base64url").toString("utf8");
    if (!thread) {
      return { channelId };
    }
    return {
      channelId,
      threadId: Buffer.from(thread, "base64url").toString("utf8"),
    };
  }

  /**
   * Build a Chat SDK message from a normalized inbound message. `payload`
   * becomes `message.raw` and defaults to the inbound message itself.
   */
  parseMessage(
    inbound: WebhookInboundMessage,
    payload: unknown = inbound
  ): Message<unknown> {
    if (typeof inbound?.channelId !== "string" || !inbound.channelId) {
      throw new ValidationError(this.name, "Inbound message needs a channelId");
    }
    if (typeof inbound.author?.userId !== "string" || !inbound.author.userId) {
      throw new ValidationError(
        this.name,
        "Inbound message needs an author.userId"
      );
    }

    const text = inbound.text ?? "";
    const userName = inbound.author.userName ?? inbound.author.userId;
    const isMe = inbound.author.isMe ?? false;
    const message = new Message<unknown>({
      id: inbound.id ?? randomUUID(),
      threadId: this.encodeThreadId({
        channelId: inbound.channelId,
        threadId: inbound.threadId,
      }),
      text,
      formatted: this.formatConverter.toAst(text),
      raw: payload,
      author: {
        userId: inbound.author.userId,
        userName,
        fullName: inbound.author.fullName ?? userName,
        isBot: inbound.author.isBot ?? isMe,
        isMe,
      },
      metadata: {
        dateSent: this.toDate(inbound.timestamp),
        edited: false,
      },
      attachments: inbound.attachments ?? [],
    });
    if (inbound.isMention !== undefined) {
      message.isMention = inbound.isMention;
    }
    return message;
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  protected toTarget(threadId: string): WebhookTarget {
    return { ...this.decodeThreadId(threadId), thread: threadId };
  }

  protected toRawMessage(
    threadId: string,
    // biome-ignore lint/suspicious/noConfusingVoidType: mirrors the send and edit callback return type
    result: WebhookSendResult | void,
    fallbackId?: string
  ): RawMessage<unknown> {
    return {
      id: result?.id ?? fallbackId ?? randomUUID(),
      threadId,
      raw: result?.raw ?? null,
    };
  }

  protected toDate(value: WebhookInboundMessage["timestamp"]): Date {
    if (value === undefined) {
      return new Date();
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }
}

/**
 * Create a generic webhook adapter.
 *
 * @example
 * ```typescript
 * const adapter = createWebhookAdapter({
 *   parse: (payload: MyPayload) => ({
 *     channelId: payload.chatId,
 *     text: payload.text,
 *     author: { userId: payload.senderId },
 *   }),
 *   send: async ({ channelId, text }) => {
 *     await fetch("https://api.example.com/messages", {
 *       method: "POST",
 *       body: JSON.stringify({ chatId: channelId, text }),
 *     });
 *   },
 * });
 * ```
 */
export function createWebhookAdapter(
  config: WebhookAdapterConfig
): WebhookAdapter {
  if (typeof config?.parse !== "function") {
    throw new ValidationError(DEFAULT_NAME, "parse is required.");
  }
  if (typeof config.send !== "function") {
    throw new ValidationError(DEFAULT_NAME, "send is required.");
  }

  const secret = config.secret ?? process.env.WEBHOOK_SECRET;
  if (!(config.verify || secret)) {
    throw new ValidationError(
      DEFAULT_NAME,
      "secret is required. Set WEBHOOK_SECRET, provide secret in config, or provide a verify function."
    );
  }

  const name = config.name ?? DEFAULT_NAME;
  return new WebhookAdapter({
    ...config,
    logger: config.logger ?? new ConsoleLogger("info").child(name),
    name,
    secret,
  });
}

export { WebhookFormatConverter } from "./markdown";
export type {
  WebhookAdapterConfig,
  WebhookAuthor,
  WebhookDeleteMessage,
  WebhookEditMessage,
  WebhookInboundMessage,
  WebhookOutboundMessage,
  WebhookParseContext,
  WebhookSendResult,
  WebhookTarget,
  WebhookThreadId,
} from "./types";
