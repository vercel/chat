import type { AdapterPostableMessage, Attachment, Logger } from "chat";

/**
 * Decoded thread ID for the webhook adapter.
 *
 * Thread IDs have the form `{name}:{channel}` or `{name}:{channel}:{thread}`,
 * with `channel` and `thread` base64url-encoded so platform IDs can contain
 * any character.
 */
export interface WebhookThreadId {
  /** Conversation identifier on the platform, such as a chat or room ID. */
  channelId: string;
  /** Optional sub-thread inside the conversation. */
  threadId?: string;
}

/** Author of an inbound message. */
export interface WebhookAuthor {
  /** Display name. Defaults to `userName`. */
  fullName?: string;
  /** Whether the author is a bot. Defaults to `false`. */
  isBot?: boolean;
  /**
   * Whether the message was sent by this bot, for example an echo of an
   * outbound message. Chat SDK skips handlers for these messages. Defaults to
   * `false`.
   */
  isMe?: boolean;
  /** Stable user identifier on the platform. */
  userId: string;
  /** Username. Defaults to `userId`. */
  userName?: string;
}

/**
 * A platform message normalized by your `parse` function.
 */
export interface WebhookInboundMessage extends WebhookThreadId {
  /** Attachments to expose on `message.attachments`. */
  attachments?: Attachment[];
  author: WebhookAuthor;
  /** Platform message ID. A random UUID is used when omitted. */
  id?: string;
  /**
   * Whether the bot was mentioned. Leave unset to let Chat SDK detect
   * `@userName` in the text.
   */
  isMention?: boolean;
  /** Message text. Parsed as Markdown into `message.formatted`. */
  text: string;
  /** When the message was sent. Defaults to the time the webhook arrived. */
  timestamp?: Date | number | string;
}

/** Context passed to `parse` alongside the decoded payload. */
export interface WebhookParseContext {
  /** Raw request body. */
  body: string;
  /** Incoming request. Its body has already been read. */
  request: Request;
}

/** Where an outbound operation is addressed. */
export interface WebhookTarget extends WebhookThreadId {
  /** Full Chat SDK thread ID, for example `webhook:Y2hhdC0x`. */
  thread: string;
}

/** An outbound message passed to `send` and `edit`. */
export interface WebhookOutboundMessage extends WebhookTarget {
  /** The message as passed to `thread.post()`, for cards, files, and other rich content. */
  message: AdapterPostableMessage;
  /** Message rendered as Markdown. Cards are rendered as fallback text. */
  text: string;
}

/** An outbound edit passed to `edit`. */
export interface WebhookEditMessage extends WebhookOutboundMessage {
  /** ID of the message to edit. */
  messageId: string;
}

/** A message deletion passed to `delete`. */
export interface WebhookDeleteMessage extends WebhookTarget {
  /** ID of the message to delete. */
  messageId: string;
}

/** What `send` and `edit` can return about the delivered message. */
export interface WebhookSendResult {
  /** Platform message ID. A random UUID is used when omitted. */
  id?: string;
  /** Platform response, exposed as `raw` on the sent message. */
  raw?: unknown;
}

/**
 * Configuration for the webhook adapter.
 *
 * Callbacks use method syntax so you can annotate `payload` with your
 * platform's payload type.
 */
export interface WebhookAdapterConfig {
  /** Delete a sent message. Without it, `deleteMessage` throws `NotImplementedError`. */
  delete?(message: WebhookDeleteMessage): Promise<void>;
  /**
   * Edit a sent message. Without it, `editMessage` throws
   * `NotImplementedError` and streamed responses are sent once complete.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: lets callbacks that return nothing type-check
  edit?(message: WebhookEditMessage): Promise<WebhookSendResult | void>;
  /** Logger instance. Defaults to a console logger. */
  logger?: Logger;
  /**
   * Adapter name. Must match the key you register the adapter under in
   * `adapters`, because Chat SDK routes thread IDs by their prefix.
   * @default "webhook"
   */
  name?: string;
  /**
   * Map a verified request to zero or more inbound messages. `payload` is the
   * JSON-decoded request body. Return `null`, `undefined`, or an empty array
   * to acknowledge the request without processing a message.
   */
  parse(
    payload: unknown,
    context: WebhookParseContext
  ):
    | WebhookInboundMessage
    | readonly WebhookInboundMessage[]
    | null
    | undefined
    | Promise<
        | WebhookInboundMessage
        | readonly WebhookInboundMessage[]
        | null
        | undefined
      >;
  /**
   * Shared secret for HMAC-SHA256 request signatures. The adapter compares
   * the hex digest of the raw body with `signatureHeader`, with or without a
   * `sha256=` prefix. Defaults to `WEBHOOK_SECRET`. Ignored when `verify` is
   * set.
   */
  secret?: string;
  /** Deliver an outbound message to the platform. */
  // biome-ignore lint/suspicious/noConfusingVoidType: lets callbacks that return nothing type-check
  send(message: WebhookOutboundMessage): Promise<WebhookSendResult | void>;
  /**
   * Header that carries the HMAC signature.
   * @default "x-webhook-signature"
   */
  signatureHeader?: string;
  /** Show a typing indicator. Without it, `startTyping` does nothing. */
  startTyping?(target: WebhookTarget): Promise<void>;
  /** Bot username. Defaults to the `userName` passed to `Chat`. */
  userName?: string;
  /**
   * Custom request verification, for platforms that sign requests
   * differently. Return `false` to reject the request with 401. Replaces
   * `secret` verification.
   */
  verify?(request: Request, body: string): boolean | Promise<boolean>;
}
