import type { Message } from "../../message";
import type { Attachment } from "../../types";
import {
  buildMessageText,
  defaultUnsupportedAttachmentWarning,
  fetchAttachmentContent,
  isUnsupportedAttachment,
  sortByDateSent,
} from "../message-content";

/**
 * Content part types structurally compatible with TanStack AI's TextPart and
 * ImagePart so that TanStackMessage[] is directly assignable to ModelMessage[].
 * Declared locally so this module has no runtime dependency on @tanstack/ai.
 * @see https://github.com/TanStack/ai/blob/main/packages/ai/src/types.ts
 */

export interface TanStackTextPart {
  content: string;
  type: "text";
}

export interface TanStackImagePart {
  source: {
    mimeType: string;
    type: "data";
    /** Base64-encoded bytes with no `data:` URL prefix */
    value: string;
  };
  type: "image";
}

export type TanStackContentPart = TanStackTextPart | TanStackImagePart;

/**
 * A message formatted for TanStack AI consumption.
 *
 * This is a discriminated union matching TanStack AI's ModelMessage type:
 * - User messages can have text and image parts
 * - Assistant messages have string content only
 */
export type TanStackMessage = TanStackUserMessage | TanStackAssistantMessage;

export interface TanStackUserMessage {
  content: string | TanStackContentPart[];
  role: "user";
}

export interface TanStackAssistantMessage {
  content: string;
  role: "assistant";
}

/**
 * Options for converting messages to TanStack AI format.
 */
export interface ToTanStackMessagesOptions {
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
   * @param tanStackMessage - The processed TanStack AI message
   * @param source - The original chat Message
   * @returns The message to include, or null to skip
   */
  transformMessage?: (
    tanStackMessage: TanStackMessage,
    source: Message
  ) => TanStackMessage | null | Promise<TanStackMessage | null>;
}

function toBase64(data: Buffer | ArrayBuffer): string {
  return data instanceof ArrayBuffer
    ? Buffer.from(data).toString("base64")
    : data.toString("base64");
}

function toUtf8(data: Buffer | ArrayBuffer): string {
  return data instanceof ArrayBuffer
    ? Buffer.from(data).toString("utf8")
    : data.toString("utf8");
}

interface UserAttachmentContent {
  /** Text-file contents rendered as prompt text, in attachment order */
  fileBlocks: string[];
  imageParts: TanStackImagePart[];
}

/**
 * Resolve a user message's attachments into image parts and inline text
 * blocks. TanStack AI has no text-file content part, so text files are
 * rendered into the message text instead.
 */
async function collectUserAttachments(
  msg: Message,
  onUnsupported: (attachment: Attachment, message: Message) => void
): Promise<UserAttachmentContent> {
  const imageParts: TanStackImagePart[] = [];
  const fileBlocks: string[] = [];
  for (const att of msg.attachments ?? []) {
    const fetched = await fetchAttachmentContent(att, "toTanStackMessages");
    if (fetched?.kind === "image") {
      imageParts.push({
        type: "image",
        source: {
          type: "data",
          value: toBase64(fetched.data),
          mimeType: fetched.mimeType,
        },
      });
    } else if (fetched?.kind === "text-file") {
      const name = fetched.filename ?? "attachment";
      fileBlocks.push(
        `[File: ${name} (${fetched.mimeType})]\n${toUtf8(fetched.data)}`
      );
    } else if (isUnsupportedAttachment(att)) {
      onUnsupported(att, msg);
    }
  }
  return { imageParts, fileBlocks };
}

/**
 * Convert chat SDK messages to TanStack AI conversation format.
 *
 * - Keeps messages that have no text but carry content (images, files, links).
 *   Only messages with no usable content at all are skipped.
 * - Maps `author.isMe === true` to `"assistant"`, otherwise `"user"`
 * - Uses `message.text` for content
 * - Appends bounded link metadata inside an explicit untrusted-content fence
 * - Includes image attachments as base64 `ImagePart`s
 * - Inlines text file attachments into the message text as
 *   `[File: name (mime)]` blocks, since TanStack AI has no file content part
 * - Uses `fetchData()` when available to include attachment data inline
 * - Warns on unsupported attachment types (video, audio)
 *
 * TanStack AI has no system role on `ModelMessage`; pass system prompts via
 * `chat({ systemPrompts })` instead.
 *
 * Works with `FetchResult.messages`, `thread.recentMessages`, or collected iterables.
 *
 * @example
 * ```typescript
 * import { chat } from "@tanstack/ai";
 *
 * const result = await thread.adapter.fetchMessages(thread.id, { limit: 20 });
 * const stream = chat({
 *   adapter,
 *   systemPrompts: ["You are a helpful assistant."],
 *   messages: await toTanStackMessages(result.messages),
 * });
 * ```
 */
export async function toTanStackMessages(
  messages: Message[],
  options?: ToTanStackMessagesOptions
): Promise<TanStackMessage[]> {
  const includeNames = options?.includeNames ?? false;
  const transformMessage = options?.transformMessage;
  const onUnsupported =
    options?.onUnsupportedAttachment ??
    defaultUnsupportedAttachmentWarning("toTanStackMessages");

  const sorted = sortByDateSent(messages);

  const results = await Promise.all(
    sorted.map(async (msg) => {
      const role: "user" | "assistant" = msg.author.isMe ? "assistant" : "user";
      let textContent = buildMessageText(msg, { includeNames, role });

      let tanStackMessage: TanStackMessage;
      if (role === "user") {
        const { imageParts, fileBlocks } = await collectUserAttachments(
          msg,
          onUnsupported
        );

        if (fileBlocks.length > 0) {
          const files = fileBlocks.join("\n\n");
          textContent = textContent ? `${textContent}\n\n${files}` : files;
        }

        if (imageParts.length > 0) {
          // Only prepend a text part when there is text; a message may carry
          // images with no accompanying text.
          const parts: TanStackContentPart[] = textContent
            ? [{ type: "text", content: textContent }, ...imageParts]
            : imageParts;
          tanStackMessage = { role, content: parts };
        } else {
          tanStackMessage = { role, content: textContent };
        }
      } else {
        tanStackMessage = { role, content: textContent };
      }

      // Skip messages that carry no usable content (no text, no attachments,
      // no links). Text-only or attachment-only messages are kept.
      const isEmpty =
        typeof tanStackMessage.content === "string"
          ? tanStackMessage.content.trim().length === 0
          : tanStackMessage.content.length === 0;
      if (isEmpty) {
        return null;
      }

      if (transformMessage) {
        return await transformMessage(tanStackMessage, msg);
      }
      return tanStackMessage;
    })
  );

  return results.filter((r): r is TanStackMessage => r != null);
}
