import {
  extractCard,
  extractFiles,
  extractPostableAttachments,
  ValidationError,
} from "@chat-adapter/shared";
import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
  ChatInstance,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Logger,
  RawMessage,
  ThreadInfo,
  UserInfo,
  WebhookOptions,
} from "chat";
import { ConsoleLogger, Message, NotImplementedError } from "chat";
import {
  deleteTwilioMessage,
  fetchTwilioMedia,
  fetchTwilioMessage,
  listTwilioMessages,
  sendTwilioMessage,
  type TwilioApiOptions,
  type TwilioMessageResource,
} from "./api";
import { cardToTwilioText } from "./cards";
import {
  TWILIO_MESSAGE_LIMIT,
  truncateTwilioText,
  twilioTextOrPlaceholder,
} from "./format";
import { TwilioFormatConverter } from "./markdown";
import {
  decodeTwilioThreadId,
  encodeTwilioThreadId,
  twilioChannelId,
} from "./thread";
import type {
  TwilioAdapterConfig,
  TwilioRawMessage,
  TwilioThreadId,
} from "./types";
import { attachmentType, senderFields, twimlResponse } from "./utils";
import {
  readTwilioWebhook,
  type TwilioMediaPayload,
  TwilioWebhookParseError,
  type TwilioWebhookPayload,
  TwilioWebhookVerificationError,
} from "./webhook";

export class TwilioAdapter
  implements Adapter<TwilioThreadId, TwilioRawMessage>
{
  readonly name = "twilio";
  readonly lockScope = "channel" as const;
  readonly persistThreadHistory = true;
  readonly userName: string;

  protected chat: ChatInstance | null = null;
  protected readonly accountSid?: TwilioAdapterConfig["accountSid"];
  protected readonly apiUrl?: string;
  protected readonly authToken?: TwilioAdapterConfig["authToken"];
  protected readonly fetch?: TwilioAdapterConfig["fetch"];
  protected readonly formatConverter = new TwilioFormatConverter();
  protected readonly logger: Logger;
  protected readonly messagingServiceSid?: string;
  protected readonly phoneNumber?: string;
  protected readonly statusCallbackUrl?: string;
  protected readonly webhookUrl?: TwilioAdapterConfig["webhookUrl"];
  protected readonly webhookVerifier?: TwilioAdapterConfig["webhookVerifier"];

  constructor(config: TwilioAdapterConfig = {}) {
    this.accountSid = config.accountSid;
    this.apiUrl = config.apiUrl;
    this.authToken = config.authToken;
    this.fetch = config.fetch;
    this.logger = config.logger ?? new ConsoleLogger("info").child("twilio");
    this.messagingServiceSid =
      config.messagingServiceSid ?? process.env.TWILIO_MESSAGING_SERVICE_SID;
    this.phoneNumber = config.phoneNumber ?? process.env.TWILIO_PHONE_NUMBER;
    this.statusCallbackUrl = config.statusCallbackUrl;
    this.userName = config.userName ?? "bot";
    this.webhookUrl = config.webhookUrl;
    this.webhookVerifier = config.webhookVerifier;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger.info("Twilio adapter initialized", {
      messagingServiceSid: this.messagingServiceSid,
      phoneNumber: this.phoneNumber,
    });
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    let payload: TwilioWebhookPayload;
    try {
      payload = await readTwilioWebhook(request, {
        authToken: this.authToken,
        webhookUrl: this.webhookUrl,
        webhookVerifier: this.webhookVerifier,
      });
    } catch (error) {
      if (error instanceof TwilioWebhookVerificationError) {
        return new Response("Invalid signature", { status: 401 });
      }
      if (error instanceof TwilioWebhookParseError) {
        return new Response("Invalid webhook", { status: 400 });
      }
      throw error;
    }

    if (payload.kind !== "text" || !this.chat) {
      return twimlResponse();
    }

    const threadId = this.encodeThreadId({
      recipient: payload.from,
      sender: payload.to,
    });
    const message = this.parseTwilioTextPayload(payload, threadId);
    this.chat.processMessage(this, threadId, message, options);
    return twimlResponse();
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<TwilioRawMessage>> {
    const thread = this.decodeThreadId(threadId);
    const body = this.renderPostableText(message);
    const mediaUrl = this.mediaUrls(message);
    if (!body && mediaUrl.length === 0) {
      throw new ValidationError("twilio", "Message text cannot be empty");
    }

    const raw = await sendTwilioMessage({
      ...this.apiOptions(),
      body:
        body || mediaUrl.length === 0
          ? twilioTextOrPlaceholder(body)
          : undefined,
      mediaUrl,
      statusCallbackUrl: this.statusCallbackUrl,
      to: thread.recipient,
      ...senderFields(thread.sender),
    });

    return {
      id: raw.sid,
      raw,
      threadId: this.threadIdForResource(raw, thread),
    };
  }

  async editMessage(): Promise<RawMessage<TwilioRawMessage>> {
    throw new NotImplementedError(
      "Twilio does not support editing sent messages",
      "editMessage"
    );
  }

  async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    await deleteTwilioMessage({
      ...this.apiOptions(),
      messageSid: messageId,
    });
  }

  async addReaction(): Promise<void> {
    throw new NotImplementedError(
      "Twilio does not support message reactions",
      "addReaction"
    );
  }

  async removeReaction(): Promise<void> {
    throw new NotImplementedError(
      "Twilio does not support message reactions",
      "removeReaction"
    );
  }

  async startTyping(): Promise<void> {}

  parseMessage(raw: TwilioRawMessage): Message<TwilioRawMessage> {
    if (isTwilioWebhookPayload(raw)) {
      if (raw.kind !== "text") {
        throw new ValidationError("twilio", "Cannot parse unsupported webhook");
      }
      return this.parseTwilioTextPayload(
        raw,
        this.encodeThreadId({ recipient: raw.from, sender: raw.to })
      );
    }
    return this.parseTwilioResource(raw, undefined);
  }

  async fetchMessage(
    threadId: string,
    messageId: string
  ): Promise<Message<TwilioRawMessage> | null> {
    const thread = this.decodeThreadId(threadId);
    try {
      const raw = await fetchTwilioMessage({
        ...this.apiOptions(),
        messageSid: messageId,
      });
      return this.parseTwilioResource(raw, thread);
    } catch {
      return null;
    }
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<TwilioRawMessage>> {
    const thread = this.decodeThreadId(threadId);
    const limit = options.limit ?? 50;
    const [outbound, inbound] = await Promise.all([
      listTwilioMessages({
        ...this.apiOptions(),
        from: thread.sender,
        limit,
        to: thread.recipient,
      }),
      listTwilioMessages({
        ...this.apiOptions(),
        from: thread.recipient,
        limit,
        to: thread.sender,
      }),
    ]);
    const messages = [...outbound, ...inbound]
      .map((raw) => this.parseTwilioResource(raw, thread))
      .sort(
        (left, right) =>
          left.metadata.dateSent.getTime() - right.metadata.dateSent.getTime()
      )
      .slice(-limit);
    return { messages };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const thread = this.decodeThreadId(threadId);
    return {
      channelId: this.channelIdFromThreadId(threadId),
      channelName: thread.sender,
      id: threadId,
      isDM: true,
      metadata: { ...thread },
    };
  }

  async getUser(userId: string): Promise<UserInfo | null> {
    return {
      fullName: userId,
      isBot: false,
      userId,
      userName: userId,
    };
  }

  async openDM(userId: string): Promise<string> {
    return this.encodeThreadId({
      recipient: userId,
      sender: this.defaultSender(),
    });
  }

  isDM(threadId: string): boolean {
    return threadId.startsWith("twilio:");
  }

  channelIdFromThreadId(threadId: string): string {
    return twilioChannelId(threadId);
  }

  encodeThreadId(platformData: TwilioThreadId): string {
    return encodeTwilioThreadId(platformData);
  }

  decodeThreadId(threadId: string): TwilioThreadId {
    return decodeTwilioThreadId(threadId);
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  rehydrateAttachment(attachment: Attachment): Attachment {
    const url = attachment.fetchMetadata?.twilioMediaUrl ?? attachment.url;
    if (!url) {
      return attachment;
    }
    return this.twilioAttachment({
      contentType: attachment.mimeType,
      url,
    });
  }

  protected parseTwilioTextPayload(
    raw: TwilioWebhookPayload & { kind: "text" },
    threadId: string
  ): Message<TwilioRawMessage> {
    return new Message({
      attachments: raw.media.map((media) => this.twilioAttachment(media)),
      author: this.author(raw.from, false),
      formatted: this.formatConverter.toAst(raw.body),
      id: raw.messageSid ?? `twilio:${Date.now()}`,
      metadata: {
        dateSent: new Date(),
        edited: false,
      },
      raw,
      text: raw.body,
      threadId,
    });
  }

  protected parseTwilioResource(
    raw: TwilioMessageResource,
    fallbackThread: TwilioThreadId | undefined
  ): Message<TwilioRawMessage> {
    const isMe = raw.direction?.startsWith("outbound") ?? false;
    const from =
      raw.from ??
      raw.messaging_service_sid ??
      (isMe ? fallbackThread?.sender : fallbackThread?.recipient);
    const to =
      raw.to ?? (isMe ? fallbackThread?.recipient : fallbackThread?.sender);
    if (!(from && to)) {
      throw new ValidationError("twilio", "Twilio message is missing routing");
    }
    const text = raw.body ?? "";
    const thread = isMe
      ? {
          recipient: fallbackThread?.recipient ?? to,
          sender: fallbackThread?.sender ?? from,
        }
      : { recipient: from, sender: to };
    return new Message({
      attachments: [],
      author: this.author(isMe ? thread.sender : from, isMe),
      formatted: this.formatConverter.toAst(text),
      id: raw.sid,
      metadata: {
        dateSent: dateFromTwilio(raw.date_sent ?? raw.date_created),
        edited: false,
      },
      raw,
      text,
      threadId: this.encodeThreadId(thread),
    });
  }

  protected renderPostableText(message: AdapterPostableMessage): string {
    const card = extractCard(message);
    const text = card
      ? cardToTwilioText(card)
      : this.formatConverter.renderPostable(message);
    return truncateTwilioText(text, { limit: TWILIO_MESSAGE_LIMIT }).text;
  }

  protected mediaUrls(message: AdapterPostableMessage): string[] {
    const files = extractFiles(message);
    if (files.length > 0) {
      throw new ValidationError(
        "twilio",
        "Twilio adapter supports media attachments by public URL only"
      );
    }
    const attachments = extractPostableAttachments(message);
    const mediaUrl: string[] = [];
    for (const attachment of attachments) {
      if (typeof attachment.url !== "string" || attachment.url.length === 0) {
        throw new ValidationError(
          "twilio",
          "Twilio adapter supports media attachments by public URL only"
        );
      }
      mediaUrl.push(attachment.url);
    }
    return mediaUrl;
  }

  protected twilioAttachment(media: TwilioMediaPayload): Attachment {
    const attachment: Attachment = {
      fetchData: async () =>
        Buffer.from(
          await fetchTwilioMedia({
            ...this.apiOptions(),
            url: media.url,
          })
        ),
      fetchMetadata: { twilioMediaUrl: media.url },
      mimeType: media.contentType,
      type: attachmentType(media.contentType),
      url: media.url,
    };
    return attachment;
  }

  protected apiOptions(): TwilioApiOptions {
    return {
      apiUrl: this.apiUrl,
      credentials: {
        accountSid: this.accountSid,
        authToken: this.authToken,
      },
      fetch: this.fetch,
    };
  }

  protected defaultSender(): string {
    const sender = this.phoneNumber ?? this.messagingServiceSid;
    if (!sender) {
      throw new ValidationError(
        "twilio",
        "phoneNumber or messagingServiceSid is required"
      );
    }
    return sender;
  }

  protected author(userId: string, isMe: boolean): Message["author"] {
    return {
      fullName: userId,
      isBot: isMe,
      isMe,
      userId,
      userName: userId,
    };
  }

  protected threadIdForResource(
    raw: TwilioMessageResource,
    fallback: TwilioThreadId
  ): string {
    return this.parseTwilioResource(raw, fallback).threadId;
  }
}

export function createTwilioAdapter(
  config: TwilioAdapterConfig = {}
): TwilioAdapter {
  return new TwilioAdapter(config);
}

function isTwilioWebhookPayload(
  raw: TwilioRawMessage
): raw is TwilioWebhookPayload {
  return "kind" in raw;
}

function dateFromTwilio(value: string | null | undefined): Date {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export { cardToTwilioText } from "./cards";
export { TwilioFormatConverter } from "./markdown";
export type {
  TwilioAdapterConfig,
  TwilioRawMessage,
  TwilioThreadId,
} from "./types";
