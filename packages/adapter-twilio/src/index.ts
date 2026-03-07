import {
  cardToFallbackText,
  extractCard,
  extractFiles,
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
import { ConsoleLogger, Message, NotImplementedError } from "chat";
import twilio from "twilio";
import { TwilioFormatConverter } from "./markdown";
import type {
  TwilioAdapterConfig,
  TwilioRawMessage,
  TwilioThreadId,
  TwilioWebhookPayload,
} from "./types";

const SMS_BODY_LIMIT = 1600;
const TWILIO_MESSAGE_ID_PREFIX = /^twilio:/;

export class TwilioAdapter
  implements Adapter<TwilioThreadId, TwilioRawMessage>
{
  readonly name = "twilio";

  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly phoneNumber: string;
  private readonly webhookUrl?: string;
  private readonly logger: Logger;
  private readonly formatConverter = new TwilioFormatConverter();
  private readonly client: twilio.Twilio;

  private chat: ChatInstance | null = null;
  private _userName: string;

  get userName(): string {
    return this._userName;
  }

  constructor(config: TwilioAdapterConfig = {}) {
    const accountSid = config.accountSid ?? process.env.TWILIO_ACCOUNT_SID;
    if (!accountSid) {
      throw new ValidationError(
        "twilio",
        "accountSid is required. Set TWILIO_ACCOUNT_SID or provide it in config."
      );
    }

    const authToken = config.authToken ?? process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) {
      throw new ValidationError(
        "twilio",
        "authToken is required. Set TWILIO_AUTH_TOKEN or provide it in config."
      );
    }

    const phoneNumber = config.phoneNumber ?? process.env.TWILIO_PHONE_NUMBER;
    if (!phoneNumber) {
      throw new ValidationError(
        "twilio",
        "phoneNumber is required. Set TWILIO_PHONE_NUMBER or provide it in config."
      );
    }

    this.accountSid = accountSid;
    this.authToken = authToken;
    this.phoneNumber = phoneNumber;
    this.webhookUrl = config.webhookUrl;
    this.logger = config.logger ?? new ConsoleLogger("info").child("twilio");
    this._userName = config.userName ?? "bot";
    this.client = twilio(accountSid, authToken);
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    const chatUserName = chat.getUserName?.();
    if (typeof chatUserName === "string" && chatUserName.trim()) {
      this._userName = chatUserName;
    }

    this.logger.info("Twilio adapter initialized", {
      phoneNumber: this.phoneNumber,
    });
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/x-www-form-urlencoded")) {
      return new Response("Invalid content type", { status: 400 });
    }

    const body = await request.text();
    const params = Object.fromEntries(new URLSearchParams(body).entries());

    const signature = request.headers.get("x-twilio-signature") ?? "";
    const url = this.webhookUrl ?? request.url;

    const isValid = twilio.validateRequest(
      this.authToken,
      signature,
      url,
      params
    );

    if (!isValid) {
      this.logger.warn("Twilio webhook rejected due to invalid signature");
      return new Response("Invalid signature", { status: 401 });
    }

    const payload = params as unknown as TwilioWebhookPayload;

    // Status callback webhooks (delivery receipts) include MessageStatus but
    // may lack Body. Acknowledge them without processing.
    if (payload.MessageStatus && !payload.Body && !payload.NumMedia) {
      return twimlResponse();
    }

    if (!(payload.MessageSid && payload.From && payload.To)) {
      return new Response("Invalid payload", { status: 400 });
    }

    if (!this.chat) {
      this.logger.warn(
        "Chat instance not initialized, ignoring Twilio webhook"
      );
      return twimlResponse();
    }

    const threadId = this.encodeThreadId({
      twilioNumber: payload.To,
      recipientNumber: payload.From,
    });

    const message = this.parseMessage(payload);

    try {
      this.chat.processMessage(this, threadId, message, options);
    } catch (error) {
      this.logger.warn("Failed to process Twilio webhook", {
        error: String(error),
        messageSid: payload.MessageSid,
      });
    }

    return twimlResponse();
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<TwilioRawMessage>> {
    const { twilioNumber, recipientNumber } = this.decodeThreadId(threadId);

    const card = extractCard(message);
    const fullText = card
      ? cardToFallbackText(card)
      : this.formatConverter.renderPostable(message);
    const text = fullText.slice(0, SMS_BODY_LIMIT);
    if (fullText.length > SMS_BODY_LIMIT) {
      this.logger.warn(
        `SMS body truncated from ${fullText.length} to ${SMS_BODY_LIMIT} characters`
      );
    }

    const files = extractFiles(message);
    if (files.length > 0) {
      this.logger.warn(
        "Twilio SMS does not support binary file uploads; files will be ignored"
      );
    }

    const mediaUrls = extractMediaUrls(message);

    const result = await this.client.messages.create({
      body: text || " ",
      from: twilioNumber,
      to: recipientNumber,
      ...(mediaUrls.length > 0 ? { mediaUrl: mediaUrls } : {}),
    });

    const raw: TwilioWebhookPayload = {
      MessageSid: result.sid,
      AccountSid: result.accountSid,
      From: result.from,
      To: result.to,
      Body: text,
      NumMedia: String(mediaUrls.length),
    };

    return {
      id: `twilio:${result.sid}`,
      threadId,
      raw,
    };
  }

  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage
  ): Promise<RawMessage<TwilioRawMessage>> {
    throw new NotImplementedError(
      "SMS does not support editing messages",
      "editMessage"
    );
  }

  async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    const sid = messageId.replace(TWILIO_MESSAGE_ID_PREFIX, "");
    await this.client.messages(sid).remove();
  }

  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new NotImplementedError(
      "SMS does not support reactions",
      "addReaction"
    );
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new NotImplementedError(
      "SMS does not support reactions",
      "removeReaction"
    );
  }

  async startTyping(_threadId: string): Promise<void> {
    // No-op: SMS has no typing indicators
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions
  ): Promise<FetchResult<TwilioRawMessage>> {
    const { twilioNumber, recipientNumber } = this.decodeThreadId(_threadId);
    const limit = _options?.limit ?? 20;

    // Fetch both directions: inbound (recipient→bot) and outbound (bot→recipient)
    const [inbound, outbound] = await Promise.all([
      this.client.messages.list({
        from: recipientNumber,
        to: twilioNumber,
        limit,
      }),
      this.client.messages.list({
        from: twilioNumber,
        to: recipientNumber,
        limit,
      }),
    ]);

    const allMessages = [...inbound, ...outbound]
      .sort(
        (a, b) =>
          (a.dateCreated?.getTime() ?? 0) - (b.dateCreated?.getTime() ?? 0)
      )
      .slice(0, limit);

    const parsed = allMessages.map((msg) => this.parseFetchedMessage(msg));

    return {
      messages: parsed,
    };
  }

  async fetchMessage(
    _threadId: string,
    messageId: string
  ): Promise<Message<TwilioRawMessage> | null> {
    const sid = messageId.replace(TWILIO_MESSAGE_ID_PREFIX, "");

    try {
      const msg = await this.client.messages(sid).fetch();
      return this.parseFetchedMessage(msg);
    } catch {
      return null;
    }
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { twilioNumber, recipientNumber } = this.decodeThreadId(threadId);
    return {
      id: threadId,
      channelId: `${twilioNumber}:${recipientNumber}`,
      channelName: `SMS ${twilioNumber} <> ${recipientNumber}`,
      isDM: true,
      metadata: { twilioNumber, recipientNumber },
    };
  }

  isDM(_threadId: string): boolean {
    return true;
  }

  async openDM(phoneNumber: string): Promise<string> {
    return this.encodeThreadId({
      twilioNumber: this.phoneNumber,
      recipientNumber: phoneNumber,
    });
  }

  encodeThreadId(platformData: TwilioThreadId): string {
    return `twilio:${platformData.twilioNumber}:${platformData.recipientNumber}`;
  }

  decodeThreadId(threadId: string): TwilioThreadId {
    const parts = threadId.split(":");
    if (parts[0] !== "twilio" || parts.length !== 3) {
      throw new ValidationError(
        "twilio",
        `Invalid Twilio thread ID: ${threadId}`
      );
    }

    const twilioNumber = parts[1];
    const recipientNumber = parts[2];

    if (!(twilioNumber && recipientNumber)) {
      throw new ValidationError(
        "twilio",
        `Invalid Twilio thread ID: ${threadId}`
      );
    }

    return { twilioNumber, recipientNumber };
  }

  parseMessage(raw: TwilioRawMessage): Message<TwilioRawMessage> {
    const text = raw.Body ?? "";
    const threadId = this.encodeThreadId({
      twilioNumber: raw.To,
      recipientNumber: raw.From,
    });

    const attachments: Attachment[] = [];
    const numMedia = Number.parseInt(raw.NumMedia ?? "0", 10);
    for (let i = 0; i < numMedia; i++) {
      const url = raw[`MediaUrl${i}`];
      const contentType = raw[`MediaContentType${i}`];
      if (url) {
        attachments.push({
          type: mediaTypeFromContentType(contentType),
          url,
          mimeType: contentType,
        });
      }
    }

    return new Message<TwilioRawMessage>({
      id: `twilio:${raw.MessageSid}`,
      threadId,
      text,
      formatted: this.formatConverter.toAst(text),
      author: {
        userId: raw.From,
        userName: raw.From,
        fullName: raw.From,
        isBot: false,
        isMe: raw.From === this.phoneNumber,
      },
      attachments,
      metadata: {
        dateSent: new Date(),
        edited: false,
      },
      raw,
    });
  }

  parseFetchedMessage(msg: {
    sid: string;
    accountSid: string;
    from: string;
    to: string;
    body: string | null;
    numMedia: string | null;
    dateSent: Date | null;
    dateCreated: Date | null;
  }): Message<TwilioRawMessage> {
    const raw: TwilioWebhookPayload = {
      MessageSid: msg.sid,
      AccountSid: msg.accountSid,
      From: msg.from,
      To: msg.to,
      Body: msg.body ?? "",
      NumMedia: String(msg.numMedia ?? "0"),
    };
    const message = this.parseMessage(raw);
    // Override the date with the real timestamp from the API
    message.metadata.dateSent = msg.dateSent ?? msg.dateCreated ?? new Date();
    return message;
  }

  channelIdFromThreadId(threadId: string): string {
    const { twilioNumber, recipientNumber } = this.decodeThreadId(threadId);
    return `${twilioNumber}:${recipientNumber}`;
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }
}

function twimlResponse(): Response {
  return new Response("<Response></Response>", {
    status: 200,
    headers: { "content-type": "text/xml" },
  });
}

function mediaTypeFromContentType(
  contentType?: string
): "image" | "video" | "audio" | "file" {
  if (!contentType) {
    return "file";
  }
  if (contentType.startsWith("image/")) {
    return "image";
  }
  if (contentType.startsWith("video/")) {
    return "video";
  }
  if (contentType.startsWith("audio/")) {
    return "audio";
  }
  return "file";
}

function extractMediaUrls(message: AdapterPostableMessage): string[] {
  if (typeof message === "string" || !("files" in message)) {
    return [];
  }
  const files = (message as { files?: Array<{ url?: string }> }).files;
  if (!Array.isArray(files)) {
    return [];
  }
  return files.filter((f) => f.url).map((f) => f.url as string);
}

export function createTwilioAdapter(
  config?: TwilioAdapterConfig
): TwilioAdapter {
  return new TwilioAdapter(config ?? {});
}

export { TwilioFormatConverter } from "./markdown";
export type {
  TwilioAdapterConfig,
  TwilioRawMessage,
  TwilioThreadId,
  TwilioWebhookPayload,
} from "./types";
