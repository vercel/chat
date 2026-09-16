import { AsyncLocalStorage } from "node:async_hooks";
import {
  AdapterRateLimitError,
  AuthenticationError,
  extractFiles,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
  ValidationError,
} from "@chat-adapter/shared";
import {
  type Adapter,
  type AdapterPostableMessage,
  type Attachment,
  type ChatInstance,
  ConsoleLogger,
  type EphemeralMessage,
  type FetchOptions,
  type FetchResult,
  type FormattedContent,
  Message,
  type PostEphemeralOptions,
  type RawMessage,
  type StreamChunk,
  type StreamOptions,
  type ThreadInfo,
} from "chat";
import { z } from "zod";
import {
  createGmailTokenProvider,
  GmailApiError,
  type GmailApiOptions,
  getGmailMessage,
  getGmailThread,
  sendGmailMessage,
} from "./api";
import {
  composeGmailMessage,
  extractGmailContinuation,
  type GmailContinuation,
  type GmailEmail,
  type GmailOutgoing,
  parseGmailMessage,
} from "./format";
import {
  decodeGmailMessage,
  decodeGmailThread,
  encodeGmailMessage,
  encodeGmailThread,
  gmailChannel,
} from "./ids";
import { GmailFormatConverter } from "./markdown";
import { address, identifier, mailbox } from "./schema";
import { GmailSynchronizer } from "./sync";
import type {
  GmailAdapterConfig,
  GmailRawMessage,
  GmailThreadId,
} from "./types";
import { createGmailWebhookVerifier, GmailWebhookError } from "./webhook";

export { GmailFormatConverter } from "./markdown";
export type {
  GmailAdapterConfig,
  GmailRawMessage,
  GmailThreadId,
} from "./types";

function attachmentType(mimeType: string): Attachment["type"] {
  for (const type of ["image", "audio", "video"] as const) {
    if (mimeType.startsWith(`${type}/`)) {
      return type;
    }
  }
  return "file";
}

export class GmailAdapter implements Adapter<GmailThreadId, GmailRawMessage> {
  readonly name = "gmail";
  readonly lockScope = "thread";
  readonly userName: string;
  readonly botUserId: string;
  private readonly api: GmailApiOptions;
  private readonly labelId: string;
  private readonly topicName?: string;
  private readonly replyAll: boolean;
  private readonly verifier: ReturnType<typeof createGmailWebhookVerifier>;
  private readonly logger;
  private readonly formatter = new GmailFormatConverter();
  private readonly context = new AsyncLocalStorage<GmailEmail>();
  private synchronizer?: GmailSynchronizer;

  constructor(config: GmailAdapterConfig = {}) {
    if ((config.mailbox ?? process.env.GMAIL_MAILBOX) === "me") {
      throw new ValidationError(
        "gmail",
        'Use the mailbox email address instead of "me" so notifications and state can be scoped to the account'
      );
    }
    this.replyAll = config.replyAll ?? process.env.GMAIL_REPLY_ALL === "true";
    try {
      this.userName = mailbox.parse(
        config.mailbox ?? process.env.GMAIL_MAILBOX
      );
      this.botUserId = this.userName;
      this.labelId = identifier.parse(
        config.labelId ?? process.env.GMAIL_LABEL_ID
      );
      this.topicName = config.topicName ?? process.env.GMAIL_TOPIC_NAME;
      const oauth =
        config.clientId !== undefined ||
        config.clientSecret !== undefined ||
        config.refreshToken !== undefined;
      const token =
        config.accessToken ??
        (oauth ? undefined : process.env.GMAIL_ACCESS_TOKEN) ??
        createGmailTokenProvider({
          clientId: config.clientId ?? process.env.GMAIL_CLIENT_ID ?? "",
          clientSecret:
            config.clientSecret ?? process.env.GMAIL_CLIENT_SECRET ?? "",
          refreshToken:
            config.refreshToken ?? process.env.GMAIL_REFRESH_TOKEN ?? "",
          fetch: config.fetch,
        });
      if (typeof token === "string") {
        z.string().min(1).parse(token);
      }
      this.api = { mailbox: this.userName, token, fetch: config.fetch };
      this.verifier = createGmailWebhookVerifier({
        audience:
          config.pubsubAudience ?? process.env.GMAIL_PUBSUB_AUDIENCE ?? "",
        serviceAccountEmail:
          config.pubsubServiceAccountEmail ??
          process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL ??
          "",
        subscription:
          config.subscription ?? process.env.GMAIL_SUBSCRIPTION ?? "",
        webhookVerifier: config.webhookVerifier,
      });
    } catch {
      throw new ValidationError(
        "gmail",
        "Gmail requires mailbox, labelId, OAuth credentials or accessToken, subscription, and either webhookVerifier or Pub/Sub audience and service account email"
      );
    }
    this.logger = config.logger ?? new ConsoleLogger("info").child("gmail");
  }

  initialize(chat: ChatInstance): Promise<void> {
    this.synchronizer = new GmailSynchronizer(
      this.api,
      this.labelId,
      chat.getState(),
      async (email) => {
        const message = this.parseMessage(email);
        message.isMention = true;
        await this.context.run(email, () =>
          chat.processMessage(this, message.threadId, message)
        );
      },
      (message, reason) => {
        this.logger.error("Gmail message failed; automatic replay disabled", {
          messageId: message.id,
          threadId: message.threadId,
          reason,
        });
      }
    );
    return Promise.resolve();
  }

  private get synchronization(): GmailSynchronizer {
    if (!this.synchronizer) {
      throw new ValidationError(
        "gmail",
        "Initialize Chat before using Gmail synchronization"
      );
    }
    return this.synchronizer;
  }

  watch(topicName = this.topicName) {
    if (!topicName) {
      throw new ValidationError(
        "gmail",
        "Provide topicName or GMAIL_TOPIC_NAME to register a mailbox watch"
      );
    }
    return this.call(() => this.synchronization.watch(topicName));
  }

  sync(): Promise<void> {
    return this.call(() => this.synchronization.sync());
  }

  async handleWebhook(request: Request): Promise<Response> {
    try {
      const notification = await this.verifier(request);
      if (notification.emailAddress !== this.userName) {
        return new Response("Unexpected Gmail mailbox", { status: 403 });
      }
      await this.sync();
      return new Response(null, { status: 204 });
    } catch (error) {
      if (error instanceof GmailWebhookError) {
        return new Response(error.message, { status: error.status });
      }
      this.logger.error("Gmail synchronization failed", {
        error: error instanceof Error ? error.name : "Unknown error",
      });
      return new Response("Gmail synchronization unavailable", { status: 503 });
    }
  }

  encodeThreadId(value: GmailThreadId): string {
    if (mailbox.parse(value.mailbox) !== this.userName) {
      throw new ValidationError(
        "gmail",
        "Thread belongs to another Gmail mailbox"
      );
    }
    return encodeGmailThread(value);
  }

  decodeThreadId(value: string): GmailThreadId {
    return decodeGmailThread(value, this.userName);
  }

  channelIdFromThreadId(value: string): string {
    this.decodeThreadId(value);
    return gmailChannel(this.userName);
  }

  getChannelVisibility() {
    return "unknown" as const;
  }

  isDM(threadId: string): boolean {
    return this.decodeThreadId(threadId).recipient !== undefined;
  }

  async openDM(userId: string): Promise<string> {
    const recipient = address.shape.address.safeParse(userId);
    if (!recipient.success) {
      throw new ValidationError(
        "gmail",
        "Provide a single recipient email address"
      );
    }
    return this.encodeThreadId({
      mailbox: this.userName,
      recipient: recipient.data,
    });
  }

  parseMessage(raw: GmailRawMessage): Message<GmailRawMessage> {
    const sender = raw.email.from;
    const address = sender?.address ?? "unknown";
    return new Message({
      id: encodeGmailMessage(raw.message.id, this.userName),
      threadId: this.encodeThreadId({
        mailbox: this.userName,
        threadId: raw.message.threadId,
      }),
      text: raw.text,
      formatted: this.formatter.toAst(raw.text),
      raw,
      author: {
        userId: address,
        userName: address,
        fullName: sender?.name || address,
        isBot: false,
        isMe: raw.message.labelIds.includes("SENT"),
      },
      metadata: {
        dateSent: new Date(Number(raw.message.internalDate)),
        edited: false,
      },
      attachments: raw.attachments.map((attachment, index) => ({
        type: attachmentType(attachment.mimeType),
        mimeType: attachment.mimeType,
        name: attachment.filename,
        size: attachment.data.byteLength,
        fetchMetadata: {
          mailbox: this.userName,
          messageId: raw.message.id,
          index: String(index),
        },
        fetchData: async () => Buffer.from(attachment.data),
      })),
    });
  }

  rehydrateAttachment(attachment: Attachment): Attachment {
    const metadata = attachment.fetchMetadata;
    if (!metadata) {
      return attachment;
    }
    return {
      ...attachment,
      fetchData: async () => {
        if (metadata.mailbox !== this.userName) {
          throw new ValidationError(
            "gmail",
            "Attachment belongs to another Gmail mailbox"
          );
        }
        const index = z.coerce
          .number()
          .int()
          .nonnegative()
          .parse(metadata.index);
        const email = await this.load(identifier.parse(metadata.messageId));
        const file = email.attachments[index];
        if (!file) {
          throw new ResourceNotFoundError("gmail", "attachment");
        }
        return Buffer.from(file.data);
      },
    };
  }

  async fetchMessage(
    threadId: string,
    messageId: string
  ): Promise<Message<GmailRawMessage>> {
    const thread = this.decodeThreadId(threadId);
    if (thread.recipient !== undefined) {
      throw new ValidationError(
        "gmail",
        "Read messages using their native Gmail thread, not a recipient route"
      );
    }
    const email = await this.load(decodeGmailMessage(messageId, this.userName));
    if (email.message.threadId !== thread.threadId) {
      throw new ValidationError(
        "gmail",
        "Message belongs to another Gmail thread"
      );
    }
    return this.parseMessage(email);
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<GmailRawMessage>> {
    const thread = this.decodeThreadId(threadId);
    if (thread.recipient !== undefined) {
      return { messages: [] };
    }
    const direction = options.direction ?? "backward";
    const limit = z
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(options.limit ?? 50);
    const cursor = options.cursor
      ? decodeGmailMessage(options.cursor, this.userName)
      : undefined;
    const result = await this.call(() =>
      getGmailThread(thread.threadId, this.api)
    );
    let position = direction === "forward" ? 0 : result.messages.length;
    if (cursor) {
      const index = result.messages.findIndex(
        (message) => message.id === cursor
      );
      if (index < 0) {
        throw new ValidationError(
          "gmail",
          "Gmail pagination cursor no longer exists; restart pagination"
        );
      }
      position = direction === "forward" ? index + 1 : index;
    }
    const start =
      direction === "forward" ? position : Math.max(0, position - limit);
    const end =
      direction === "forward"
        ? Math.min(result.messages.length, position + limit)
        : position;
    const messages: Message<GmailRawMessage>[] = [];
    for (const reference of result.messages.slice(start, end)) {
      messages.push(
        await this.fetchMessage(
          threadId,
          encodeGmailMessage(reference.id, this.userName)
        )
      );
    }
    const hasMore =
      direction === "forward" ? end < result.messages.length : start > 0;
    const anchor = direction === "forward" ? messages.at(-1) : messages[0];
    return { messages, nextCursor: hasMore ? anchor?.id : undefined };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const thread = this.decodeThreadId(threadId);
    if (thread.recipient !== undefined) {
      return {
        id: threadId,
        channelId: this.channelIdFromThreadId(threadId),
        channelVisibility: "unknown",
        isDM: true,
        metadata: { mailbox: this.userName, recipient: thread.recipient },
      };
    }
    const result = await this.call(() =>
      getGmailThread(thread.threadId, this.api)
    );
    return {
      id: threadId,
      channelId: this.channelIdFromThreadId(threadId),
      channelVisibility: "unknown",
      isDM: false,
      metadata: { mailbox: this.userName, threadId: result.id },
    };
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatter.fromAst(content);
  }

  async postEphemeral(
    threadId: string,
    userId: string,
    message: AdapterPostableMessage,
    options?: PostEphemeralOptions
  ): Promise<EphemeralMessage<GmailRawMessage> | null> {
    if (!options?.fallbackToDM) {
      return null;
    }
    const recipient = this.decodeThreadId(await this.openDM(userId));
    const thread =
      threadId === gmailChannel(this.userName)
        ? recipient
        : this.decodeThreadId(threadId);
    const continuation =
      thread.threadId === undefined
        ? undefined
        : await this.continuation(thread.threadId);
    const result = await this.send(
      {
        continuation,
        to: [{ address: userId }],
        cc: [],
        subject: "Private message",
        private: true,
      },
      message
    );
    return { ...result, usedFallback: true };
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
    options?: Pick<StreamOptions, "signal">
  ): Promise<RawMessage<GmailRawMessage>> {
    const signal = options?.signal;
    signal?.throwIfAborted();
    const thread = this.decodeThreadId(threadId);
    if (thread.recipient !== undefined) {
      return this.send(
        { to: [{ address: thread.recipient }], subject: "Private message" },
        message,
        signal
      );
    }
    return this.send(
      { continuation: await this.continuation(thread.threadId, signal) },
      message,
      signal
    );
  }

  private async continuation(
    threadId: string,
    signal?: AbortSignal
  ): Promise<GmailContinuation> {
    const current = this.context.getStore();
    if (current?.message.threadId === threadId) {
      return extractGmailContinuation(current, this.userName, {
        replyAll: this.replyAll,
      });
    }
    const result = await this.call(() =>
      getGmailThread(threadId, { ...this.api, signal })
    );
    for (const reference of result.messages.slice().reverse()) {
      const email = await this.load(reference.id, signal);
      if (
        !(
          email.message.labelIds.includes("SENT") ||
          email.message.labelIds.includes("DRAFT")
        )
      ) {
        return extractGmailContinuation(email, this.userName, {
          replyAll: this.replyAll,
        });
      }
    }
    throw new ValidationError(
      "gmail",
      "No incoming message is available to reply to"
    );
  }

  async reply(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<GmailRawMessage>> {
    const source = await this.fetchMessage(threadId, messageId);
    return this.send(
      {
        continuation: extractGmailContinuation(source.raw, this.userName, {
          replyAll: this.replyAll,
        }),
      },
      message
    );
  }

  async stream(
    threadId: string,
    chunks: AsyncIterable<string | StreamChunk>,
    options?: StreamOptions
  ): Promise<RawMessage<GmailRawMessage>> {
    let text = "";
    options?.signal?.throwIfAborted();
    for await (const chunk of chunks) {
      options?.signal?.throwIfAborted();
      if (typeof chunk === "string") {
        text += chunk;
      } else if (chunk.type === "markdown_text") {
        text += chunk.text;
      }
      if (Buffer.byteLength(text) > 1024 * 1024) {
        throw new ValidationError(
          "gmail",
          "Streamed email exceeds the 1 MB text limit"
        );
      }
    }
    options?.signal?.throwIfAborted();
    return this.postMessage(threadId, { raw: text }, options);
  }

  private async send(
    target: Pick<GmailOutgoing, "continuation" | "to" | "cc" | "subject"> & {
      private?: boolean;
    },
    message: AdapterPostableMessage,
    signal?: AbortSignal
  ): Promise<RawMessage<GmailRawMessage>> {
    if (
      typeof message !== "string" &&
      "attachments" in message &&
      message.attachments?.length
    ) {
      throw new ValidationError(
        "gmail",
        "Use files with binary data to send email attachments"
      );
    }
    const attachments: NonNullable<GmailOutgoing["attachments"]> = [];
    for (const file of extractFiles(message)) {
      const data =
        file.data instanceof Blob ? await file.data.arrayBuffer() : file.data;
      attachments.push({
        filename: file.filename,
        mimeType: file.mimeType ?? "application/octet-stream",
        data: Buffer.isBuffer(data) ? data : Buffer.from(data),
      });
    }
    signal?.throwIfAborted();
    const content = composeGmailMessage({
      from: this.userName,
      ...target,
      text: `${target.private ? "(private only)\n\n" : ""}${this.formatter.renderPostable(message)}`,
      attachments,
    });
    const raw = await parseGmailMessage({
      id: "pending",
      threadId: target.continuation?.threadId ?? "pending",
      internalDate: String(Date.now()),
      labelIds: ["SENT"],
      raw: content,
    });
    const result = await this.call(() =>
      sendGmailMessage(
        { raw: content, threadId: target.continuation?.threadId },
        { ...this.api, signal }
      )
    );
    raw.message = { ...raw.message, ...result };
    return {
      id: encodeGmailMessage(result.id, this.userName),
      threadId: this.encodeThreadId({
        mailbox: this.userName,
        threadId: result.threadId,
      }),
      raw,
    };
  }

  private load(id: string, signal?: AbortSignal): Promise<GmailEmail> {
    return this.call(async () =>
      parseGmailMessage(await getGmailMessage(id, { ...this.api, signal }))
    );
  }

  private async call<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof GmailApiError) {
        if (
          error.status === 429 ||
          (error.status === 403 &&
            [
              "rateLimitExceeded",
              "userRateLimitExceeded",
              "dailyLimitExceeded",
            ].includes(error.reason ?? ""))
        ) {
          throw new AdapterRateLimitError("gmail", error.retryAfter);
        }
        if (
          error.status === 401 ||
          (error.status === 400 &&
            ["invalid_grant", "invalid_client", "deleted_client"].includes(
              error.reason ?? ""
            ))
        ) {
          throw new AuthenticationError(
            "gmail",
            "Gmail OAuth credentials were rejected"
          );
        }
        if (error.status === 400) {
          throw new ValidationError(
            "gmail",
            "Gmail rejected the request parameters"
          );
        }
        if (error.status === 403) {
          throw new PermissionError("gmail", "Gmail permission denied");
        }
        if (error.status === 404) {
          throw new ResourceNotFoundError("gmail", "resource");
        }
        throw new NetworkError("gmail", error.message);
      }
      throw error;
    }
  }

  editMessage(): Promise<RawMessage<GmailRawMessage>> {
    return Promise.reject(
      new ValidationError(
        "gmail",
        "Sent email cannot be edited; create a draft using the Gmail API primitives"
      )
    );
  }

  deleteMessage(): Promise<void> {
    return Promise.reject(
      new ValidationError(
        "gmail",
        "Deleting a mailbox copy cannot retract a delivered email"
      )
    );
  }

  addReaction(): Promise<void> {
    return Promise.reject(
      new ValidationError("gmail", "Gmail reactions are not supported")
    );
  }

  removeReaction(): Promise<void> {
    return Promise.reject(
      new ValidationError("gmail", "Gmail reactions are not supported")
    );
  }

  startTyping(): Promise<void> {
    return Promise.resolve();
  }
}

export function createGmailAdapter(config?: GmailAdapterConfig): GmailAdapter {
  return new GmailAdapter(config);
}
