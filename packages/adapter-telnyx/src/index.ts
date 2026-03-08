import {
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
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
  WebhookOptions,
} from "chat";
import { ConsoleLogger, Message, NotImplementedError } from "chat";
import { TelnyxFormatConverter } from "./markdown";
import type {
  TelnyxAdapterConfig,
  TelnyxMedia,
  TelnyxMessagePayload,
  TelnyxRawMessage,
  TelnyxThreadId,
  TelnyxWebhookPayload,
} from "./types";

const TELNYX_API_BASE = "https://api.telnyx.com/v2";
const SMS_MAX_LENGTH = 1600;
const THREAD_ID_PATTERN = /^telnyx:(\+\d+):(\+\d+)$/;
const TIMESTAMP_MAX_AGE_SECONDS = 300;

export class TelnyxAdapter
  implements Adapter<TelnyxThreadId, TelnyxRawMessage>
{
  readonly name = "telnyx";

  private readonly apiKey: string;
  private readonly publicKey?: string;
  private readonly phoneNumber: string;
  private readonly messagingProfileId?: string;
  private readonly logger: Logger;
  private readonly formatConverter = new TelnyxFormatConverter();

  private chat: ChatInstance | null = null;
  private readonly _userName: string;

  get botUserId(): string {
    return this.phoneNumber;
  }

  get userName(): string {
    return this._userName;
  }

  constructor(config: TelnyxAdapterConfig = {}) {
    const apiKey = config.apiKey ?? process.env.TELNYX_API_KEY;
    if (!apiKey) {
      throw new ValidationError(
        "telnyx",
        "apiKey is required. Set TELNYX_API_KEY or provide it in config."
      );
    }

    const phoneNumber = config.phoneNumber ?? process.env.TELNYX_FROM_NUMBER;
    if (!phoneNumber) {
      throw new ValidationError(
        "telnyx",
        "phoneNumber is required. Set TELNYX_FROM_NUMBER or provide it in config."
      );
    }

    this.apiKey = apiKey;
    this.publicKey = config.publicKey ?? process.env.TELNYX_PUBLIC_KEY;
    this.phoneNumber = phoneNumber;
    this.messagingProfileId = config.messagingProfileId;
    this.logger = config.logger ?? new ConsoleLogger("info").child("telnyx");
    this._userName = config.userName ?? process.env.BOT_USERNAME ?? "bot";
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger.info("Telnyx SMS adapter initialized", {
      phoneNumber: this.phoneNumber,
    });
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    let body: TelnyxWebhookPayload;
    try {
      body = (await request.json()) as TelnyxWebhookPayload;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Verify webhook signature if public key is configured
    if (this.publicKey) {
      const signature = request.headers.get("telnyx-signature-ed25519");
      const timestamp = request.headers.get("telnyx-timestamp");

      if (!(signature && timestamp)) {
        return new Response("Missing signature headers", { status: 401 });
      }

      // Replay attack prevention: reject stale timestamps
      const now = Math.floor(Date.now() / 1000);
      if (
        Math.abs(now - Number.parseInt(timestamp, 10)) >
        TIMESTAMP_MAX_AGE_SECONDS
      ) {
        return new Response("Stale timestamp", { status: 401 });
      }

      const isValid = await this.verifySignature(
        JSON.stringify(body),
        signature,
        timestamp
      );

      if (!isValid) {
        return new Response("Invalid signature", { status: 401 });
      }
    }

    const eventType = body.data?.event_type;

    // Only process inbound messages
    if (eventType !== "message.received") {
      this.logger.debug("Ignoring non-message event", { eventType });
      return new Response("OK", { status: 200 });
    }

    const payload = body.data.payload;

    if (!payload || payload.direction !== "inbound") {
      return new Response("OK", { status: 200 });
    }

    if (!this.chat) {
      this.logger.error("Chat instance not initialized");
      return new Response("Not initialized", { status: 500 });
    }

    const threadId = this.encodeThreadId({
      telnyxNumber: payload.to[0]?.phone_number ?? this.phoneNumber,
      recipientNumber: payload.from.phone_number,
    });

    const message = this.parseMessage(payload);

    this.chat.processMessage(this, threadId, message, options);

    return new Response("OK", { status: 200 });
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<TelnyxRawMessage>> {
    const { recipientNumber } = this.decodeThreadId(threadId);
    const text = this.formatConverter.renderPostable(message);

    const requestBody: Record<string, unknown> = {
      from: this.phoneNumber,
      to: recipientNumber,
      text: text.slice(0, SMS_MAX_LENGTH),
    };

    if (this.messagingProfileId) {
      requestBody.messaging_profile_id = this.messagingProfileId;
    }

    // Extract media URLs for MMS support
    const mediaUrls: string[] = [];

    // Collect URLs from attachments on the message
    if (
      typeof message === "object" &&
      message !== null &&
      "attachments" in message
    ) {
      const attachments = (message as { attachments?: Attachment[] })
        .attachments;
      if (attachments) {
        for (const att of attachments) {
          if (att.url) {
            mediaUrls.push(att.url);
          }
        }
      }
    }

    if (mediaUrls.length > 0) {
      requestBody.media_urls = mediaUrls;
      requestBody.type = "MMS";
    }

    const response = await fetch(`${TELNYX_API_BASE}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorBody = await response.text();

      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        throw new AdapterRateLimitError(
          "telnyx",
          retryAfter ? Number.parseInt(retryAfter, 10) : undefined
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new AuthenticationError("telnyx", `Auth failed: ${errorBody}`);
      }

      // Try to parse structured Telnyx error response
      let errorMessage = `Failed to send message: ${response.status} ${errorBody}`;
      try {
        const errorJson = JSON.parse(errorBody) as {
          errors?: { title?: string; detail?: string; code?: string }[];
        };
        const firstError = errorJson.errors?.[0];
        if (firstError) {
          const parts = [
            firstError.title,
            firstError.detail,
            firstError.code,
          ].filter(Boolean);
          if (parts.length > 0) {
            errorMessage = `Failed to send message: ${parts.join(" — ")}`;
          }
        }
      } catch {
        // Fall back to raw text
      }

      throw new NetworkError("telnyx", errorMessage);
    }

    const result = (await response.json()) as { data: TelnyxMessagePayload };

    return {
      id: result.data.id,
      threadId,
      raw: result.data,
    };
  }

  async editMessage(): Promise<RawMessage<TelnyxRawMessage>> {
    throw new NotImplementedError("telnyx", "editMessage");
  }

  async deleteMessage(): Promise<void> {
    throw new NotImplementedError("telnyx", "deleteMessage");
  }

  parseMessage(raw: TelnyxRawMessage): Message<TelnyxRawMessage> {
    const text = raw.text ?? "";
    const attachments: Attachment[] = (raw.media ?? []).map(
      (media: TelnyxMedia) => ({
        type: inferAttachmentType(media.content_type),
        mimeType: media.content_type,
        url: media.url,
        size: media.size,
      })
    );

    const fromNumber = raw.from.phone_number;
    const isMe = fromNumber === this.phoneNumber;

    let dateSent = new Date();
    if (raw.received_at) {
      dateSent = new Date(raw.received_at);
    } else if (raw.sent_at) {
      dateSent = new Date(raw.sent_at);
    }

    const threadId = this.encodeThreadId({
      telnyxNumber: raw.to[0]?.phone_number ?? this.phoneNumber,
      recipientNumber: isMe
        ? (raw.to[0]?.phone_number ?? this.phoneNumber)
        : fromNumber,
    });

    return new Message<TelnyxRawMessage>({
      id: raw.id,
      threadId,
      text,
      formatted: this.formatConverter.toAst(text),
      raw,
      isMention: !isMe,
      author: {
        fullName: fromNumber,
        userId: fromNumber,
        isBot: isMe,
        isMe,
        userName: fromNumber,
      },
      metadata: {
        dateSent,
        edited: false,
      },
      attachments,
    });
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions
  ): Promise<FetchResult<TelnyxRawMessage>> {
    // Telnyx doesn't provide a thread-based message history API
    return { messages: [] };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { recipientNumber } = this.decodeThreadId(threadId);
    return {
      id: threadId,
      channelId: `telnyx:${this.phoneNumber}`,
      isDM: true,
      metadata: {
        recipientNumber,
        telnyxNumber: this.phoneNumber,
      },
    };
  }

  encodeThreadId(data: TelnyxThreadId): string {
    return `telnyx:${data.telnyxNumber}:${data.recipientNumber}`;
  }

  decodeThreadId(threadId: string): TelnyxThreadId {
    const match = THREAD_ID_PATTERN.exec(threadId);
    if (!match) {
      throw new ValidationError(
        "telnyx",
        `Invalid thread ID format: ${threadId}. Expected telnyx:+<number>:+<number>`
      );
    }
    return {
      telnyxNumber: match[1],
      recipientNumber: match[2],
    };
  }

  async startTyping(): Promise<void> {
    // SMS does not support typing indicators — no-op
  }

  async addReaction(): Promise<void> {
    throw new NotImplementedError("telnyx", "addReaction");
  }

  async removeReaction(): Promise<void> {
    throw new NotImplementedError("telnyx", "removeReaction");
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  isDM(): boolean {
    return true;
  }

  async openDM(phoneNumber: string): Promise<string> {
    return this.encodeThreadId({
      telnyxNumber: this.phoneNumber,
      recipientNumber: phoneNumber,
    });
  }

  private async verifySignature(
    payload: string,
    signature: string,
    timestamp: string
  ): Promise<boolean> {
    try {
      const publicKeyBytes = hexToUint8Array(this.publicKey as string);
      const signatureBytes = base64ToUint8Array(signature);
      const messageBytes = new TextEncoder().encode(timestamp + payload);

      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        publicKeyBytes,
        { name: "Ed25519", namedCurve: "Ed25519" },
        false,
        ["verify"]
      );

      return await crypto.subtle.verify(
        "Ed25519",
        cryptoKey,
        signatureBytes,
        messageBytes
      );
    } catch (error) {
      this.logger.error("Signature verification failed", { error });
      return false;
    }
  }
}

function hexToUint8Array(hex: string): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function base64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function inferAttachmentType(mimeType: string): Attachment["type"] {
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.startsWith("video/")) {
    return "video";
  }
  if (mimeType.startsWith("audio/")) {
    return "audio";
  }
  return "file";
}

export function createTelnyxAdapter(
  config?: TelnyxAdapterConfig
): TelnyxAdapter {
  return new TelnyxAdapter(config);
}

export { TelnyxFormatConverter } from "./markdown";
export type {
  TelnyxAdapterConfig,
  TelnyxRawMessage,
  TelnyxThreadId,
} from "./types";
