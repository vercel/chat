import type { Message } from "../message";
import type { Attachment } from "../types";
import {
  buildMessageText,
  defaultUnsupportedAttachmentWarning,
  fetchAttachmentContent,
  isUnsupportedAttachment,
  sortByDateSent,
} from "./message-content";

/**
 * Content part types structurally identical to AI SDK's TextPart, ImagePart,
 * FilePart so that AiMessage[] is directly assignable to ModelMessage[].
 * @see https://ai-sdk.dev/docs/reference/ai-sdk-core/model-message
 */

/** Matches AI SDK's DataContent */
type DataContent = string | Uint8Array | ArrayBuffer | Buffer;

export interface AiTextPart {
  text: string;
  type: "text";
}

export interface AiImagePart {
  image: DataContent | URL;
  mediaType?: string;
  type: "image";
}

export interface AiFilePart {
  data: DataContent | URL;
  filename?: string;
  mediaType: string;
  type: "file";
}

export type AiMessagePart = AiTextPart | AiImagePart | AiFilePart;

/**
 * A message formatted for AI SDK consumption.
 *
 * This is a discriminated union matching AI SDK's ModelMessage type:
 * - User messages can have text, image, and file parts
 * - Assistant messages have string content only
 */
export type AiMessage = AiUserMessage | AiAssistantMessage;

export interface AiUserMessage {
  content: string | AiMessagePart[];
  role: "user";
}

export interface AiAssistantMessage {
  content: string;
  role: "assistant";
}

/**
 * Options for converting messages to AI SDK format.
 */
export interface ToAiMessagesOptions {
  /** When true, prefixes user messages with "[username]: " for multi-user context */
  includeNames?: boolean;
  /**
   * Called when an attachment type is not supported (video, audio).
   * Defaults to `console.warn`.
   */
  onUnsupportedAttachment?: (attachment: Attachment, message: Message) => void;
  /**
   * Called for each message after default processing (text, links, attachments).
   * Return the message (modified or as-is) to include it, or `null` to skip it.
   *
   * @param aiMessage - The processed AI message
   * @param source - The original chat Message
   * @returns The message to include, or null to skip
   */
  transformMessage?: (
    aiMessage: AiMessage,
    source: Message
  ) => AiMessage | null | Promise<AiMessage | null>;
}

/**
 * Build an AI SDK content part from an attachment.
 * Uses fetchData to get attachment bytes when available.
 * Returns null for unsupported attachments or when fetchData is unavailable.
 */
async function attachmentToPart(
  att: Attachment
): Promise<AiMessagePart | null> {
  const fetched = await fetchAttachmentContent(att, "toAiMessages");
  if (!fetched) {
    return null;
  }
  const { data, mimeType } = fetched;
  return {
    type: "file",
    data:
      data instanceof ArrayBuffer
        ? data
        : `data:${mimeType};base64,${data.toString("base64")}`,
    mediaType: mimeType,
    filename: fetched.filename,
  };
}

/**
 * Convert chat SDK messages to AI SDK conversation format.
 *
 * - Keeps messages that have no text but carry content (images, files, links).
 *   Only messages with no usable content at all are skipped.
 * - Maps `author.isMe === true` to `"assistant"`, otherwise `"user"`
 * - Uses `message.text` for content
 * - Appends bounded link metadata inside an explicit untrusted-content fence
 * - Includes image attachments and text files as `FilePart`
 * - Uses `fetchData()` when available to include attachment data inline
 * - Warns on unsupported attachment types (video, audio)
 *
 * Works with `FetchResult.messages`, `thread.recentMessages`, or collected iterables.
 *
 * @example
 * ```typescript
 * const result = await thread.adapter.fetchMessages(thread.id, { limit: 20 });
 * const history = await toAiMessages(result.messages);
 * const response = await agent.stream({ prompt: history });
 * ```
 */
export async function toAiMessages(
  messages: Message[],
  options?: ToAiMessagesOptions
): Promise<AiMessage[]> {
  const includeNames = options?.includeNames ?? false;
  const transformMessage = options?.transformMessage;
  const onUnsupported =
    options?.onUnsupportedAttachment ??
    defaultUnsupportedAttachmentWarning("toAiMessages");

  const sorted = sortByDateSent(messages);

  const results = await Promise.all(
    sorted.map(async (msg) => {
      const role: "user" | "assistant" = msg.author.isMe ? "assistant" : "user";
      const textContent = buildMessageText(msg, { includeNames, role });

      // Build attachment parts for images and text files (only for user messages)
      let aiMessage: AiMessage;
      if (role === "user") {
        const attachmentParts: AiMessagePart[] = [];
        for (const att of msg.attachments ?? []) {
          const part = await attachmentToPart(att);
          if (part) {
            attachmentParts.push(part);
          } else if (isUnsupportedAttachment(att)) {
            onUnsupported(att, msg);
          }
        }

        if (attachmentParts.length > 0) {
          // Only prepend a text part when there is text — a message may have
          // images (or other attachments) with no accompanying text.
          const parts: AiMessagePart[] = textContent
            ? [{ type: "text" as const, text: textContent }, ...attachmentParts]
            : attachmentParts;
          aiMessage = { role, content: parts } satisfies AiUserMessage;
        } else {
          aiMessage = { role, content: textContent } as AiMessage;
        }
      } else {
        aiMessage = { role, content: textContent } as AiMessage;
      }

      // Skip messages that carry no usable content (no text, no attachments,
      // no links). Text-only or attachment-only messages are kept.
      const isEmpty =
        typeof aiMessage.content === "string"
          ? aiMessage.content.trim().length === 0
          : aiMessage.content.length === 0;
      if (isEmpty) {
        return { result: null, source: msg };
      }

      if (transformMessage) {
        return { result: await transformMessage(aiMessage, msg), source: msg };
      }
      return { result: aiMessage, source: msg };
    })
  );

  return results
    .filter(
      (r): r is { result: AiMessage; source: Message } => r.result != null
    )
    .map((r) => r.result);
}
