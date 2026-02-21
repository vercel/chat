/**
 * Message class with serialization support for workflow engines.
 */

import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import type { Root } from "mdast";
import type {
  Attachment,
  Author,
  FormattedContent,
  MessageMetadata,
} from "./types";

/**
 * Input data for creating a Message instance.
 * Use this interface when constructing Message objects.
 */
export interface MessageData<TRawMessage = unknown> {
  /** Attachments */
  attachments: Attachment[];
  /** Message author */
  author: Author;
  /** Structured formatting as an AST (mdast Root) */
  formatted: FormattedContent;
  /** Unique message ID */
  id: string;
  /** Whether the bot is @-mentioned in this message */
  isMention?: boolean;
  /** Message metadata */
  metadata: MessageMetadata;
  /** Platform-specific raw payload (escape hatch) */
  raw: TRawMessage;
  /** Plain text content (all formatting stripped) */
  text: string;
  /** Thread this message belongs to */
  threadId: string;
}

/**
 * Serialized message data for passing to external systems (e.g., workflow engines).
 * Dates are converted to ISO strings, and non-serializable fields are omitted.
 */
export interface SerializedMessage {
  _type: "chat:Message";
  attachments: Array<{
    type: "image" | "file" | "video" | "audio";
    url?: string;
    name?: string;
    mimeType?: string;
    size?: number;
    width?: number;
    height?: number;
  }>;
  author: {
    userId: string;
    userName: string;
    fullName: string;
    isBot: boolean | "unknown";
    isMe: boolean;
  };
  formatted: Root;
  id: string;
  isMention?: boolean;
  metadata: {
    dateSent: string; // ISO string
    edited: boolean;
    editedAt?: string; // ISO string
  };
  raw: unknown;
  text: string;
  threadId: string;
}

/**
 * A chat message with serialization support for workflow engines.
 *
 * @example
 * ```typescript
 * // Create a message
 * const message = new Message({
 *   id: "msg-1",
 *   threadId: "slack:C123:1234.5678",
 *   text: "Hello world",
 *   formatted: parseMarkdown("Hello world"),
 *   raw: {},
 *   author: { userId: "U123", userName: "user", fullName: "User", isBot: false, isMe: false },
 *   metadata: { dateSent: new Date(), edited: false },
 *   attachments: [],
 * });
 *
 * // Serialize for workflow
 * const serialized = message.toJSON();
 * ```
 */
export class Message<TRawMessage = unknown> {
  /** Unique message ID */
  readonly id: string;
  /** Thread this message belongs to */
  readonly threadId: string;

  /** Plain text content (all formatting stripped) */
  text: string;
  /**
   * Structured formatting as an AST (mdast Root).
   * This is the canonical representation - use this for processing.
   * Use `stringifyMarkdown(message.formatted)` to get markdown string.
   */
  formatted: FormattedContent;
  /** Platform-specific raw payload (escape hatch) */
  raw: TRawMessage;

  /** Message author */
  author: Author;
  /** Message metadata */
  metadata: MessageMetadata;
  /** Attachments */
  attachments: Attachment[];

  /**
   * Whether the bot is @-mentioned in this message.
   *
   * This is set by the Chat SDK before passing the message to handlers.
   * It checks for `@username` in the message text using the adapter's
   * configured `userName` and optional `botUserId`.
   *
   * @example
   * ```typescript
   * chat.onSubscribedMessage(async (thread, message) => {
   *   if (message.isMention) {
   *     await thread.post("You mentioned me!");
   *   }
   * });
   * ```
   */
  isMention?: boolean;

  constructor(data: MessageData<TRawMessage>) {
    this.id = data.id;
    this.threadId = data.threadId;
    this.text = data.text;
    this.formatted = data.formatted;
    this.raw = data.raw;
    this.author = data.author;
    this.metadata = data.metadata;
    this.attachments = data.attachments;
    this.isMention = data.isMention;
  }

  /**
   * Serialize the message to a plain JSON object.
   * Use this to pass message data to external systems like workflow engines.
   *
   * Note: Attachment `data` (Buffer) and `fetchData` (function) are omitted
   * as they're not serializable.
   */
  toJSON(): SerializedMessage {
    return {
      _type: "chat:Message",
      id: this.id,
      threadId: this.threadId,
      text: this.text,
      formatted: this.formatted,
      raw: this.raw,
      author: {
        userId: this.author.userId,
        userName: this.author.userName,
        fullName: this.author.fullName,
        isBot: this.author.isBot,
        isMe: this.author.isMe,
      },
      metadata: {
        dateSent: this.metadata.dateSent.toISOString(),
        edited: this.metadata.edited,
        editedAt: this.metadata.editedAt?.toISOString(),
      },
      attachments: this.attachments.map((att) => ({
        type: att.type,
        url: att.url,
        name: att.name,
        mimeType: att.mimeType,
        size: att.size,
        width: att.width,
        height: att.height,
      })),
      isMention: this.isMention,
    };
  }

  /**
   * Reconstruct a Message from serialized JSON data.
   * Converts ISO date strings back to Date objects.
   */
  static fromJSON<TRawMessage = unknown>(
    json: SerializedMessage
  ): Message<TRawMessage> {
    return new Message<TRawMessage>({
      id: json.id,
      threadId: json.threadId,
      text: json.text,
      formatted: json.formatted,
      raw: json.raw as TRawMessage,
      author: json.author,
      metadata: {
        dateSent: new Date(json.metadata.dateSent),
        edited: json.metadata.edited,
        editedAt: json.metadata.editedAt
          ? new Date(json.metadata.editedAt)
          : undefined,
      },
      attachments: json.attachments,
      isMention: json.isMention,
    });
  }

  /**
   * Serialize a Message instance for @workflow/serde.
   * This static method is automatically called by workflow serialization.
   */
  static [WORKFLOW_SERIALIZE](instance: Message): SerializedMessage {
    return instance.toJSON();
  }

  /**
   * Deserialize a Message from @workflow/serde.
   * This static method is automatically called by workflow deserialization.
   */
  static [WORKFLOW_DESERIALIZE](data: SerializedMessage): Message {
    return Message.fromJSON(data);
  }
}
