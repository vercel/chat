import type { Message } from "./message";
import type { Attachment } from "./types";

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

/** MIME types treated as text files that can be included as file parts */
const TEXT_MIME_PREFIXES = [
  "text/",
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
];

function isTextMimeType(mimeType: string): boolean {
  return TEXT_MIME_PREFIXES.some(
    (prefix) => mimeType === prefix || mimeType.startsWith(prefix)
  );
}

/**
 * Build an AI SDK content part from an attachment.
 * Uses fetchData to get base64 data when available.
 * Returns null for unsupported attachments or when fetchData is unavailable.
 */
async function attachmentToPart(
  att: Attachment
): Promise<AiMessagePart | null> {
  if (att.type === "image") {
    if (att.fetchData) {
      try {
        const buffer = await att.fetchData();
        const mimeType = att.mimeType ?? "image/png";
        return {
          type: "file",
          data: `data:${mimeType};base64,${buffer.toString("base64")}`,
          mediaType: mimeType,
          filename: att.name,
        };
      } catch (error) {
        console.error("toAiMessages: failed to fetch image data", error);
        return null;
      }
    }
    return null;
  }

  if (att.type === "file" && att.mimeType && isTextMimeType(att.mimeType)) {
    if (att.fetchData) {
      try {
        const buffer = await att.fetchData();
        return {
          type: "file",
          data: `data:${att.mimeType};base64,${buffer.toString("base64")}`,
          filename: att.name,
          mediaType: att.mimeType,
        };
      } catch (error) {
        console.error(
          "toAiMessages: failed to fetch file data",
          error
        );
        return null;
      }
    }
    return null;
  }

  // Unsupported type — caller handles warning
  return null;
}

/**
 * Convert chat SDK messages to AI SDK conversation format.
 *
 * - Filters out messages with empty/whitespace-only text
 * - Maps `author.isMe === true` to `"assistant"`, otherwise `"user"`
 * - Uses `message.text` for content
 * - Appends link metadata when available
 * - Includes image attachments and text files as `FilePart`
 * - Uses `fetchData()` when available to include attachment data inline (base64)
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
    ((att: Attachment) => {
      console.warn(
        `toAiMessages: unsupported attachment type "${att.type}"${att.name ? ` (${att.name})` : ""} — skipped`
      );
    });

  // Sort chronologically (oldest first) so AI sees conversation in order
  const sorted = [...messages].sort(
    (a, b) =>
      (a.metadata.dateSent?.getTime() ?? 0) -
      (b.metadata.dateSent?.getTime() ?? 0)
  );

  const filtered = sorted.filter((msg) => msg.text.trim());

  const results = await Promise.all(
    filtered.map(async (msg) => {
      const role: "user" | "assistant" = msg.author.isMe ? "assistant" : "user";
      let textContent =
        includeNames && role === "user"
          ? `[${msg.author.userName}]: ${msg.text}`
          : msg.text;

      // Append link metadata when available
      if (msg.links.length > 0) {
        const linkParts = msg.links
          .map((link) => {
            const parts = link.fetchMessage
              ? [`[Embedded message: ${link.url}]`]
              : [link.url];
            if (link.title) {
              parts.push(`Title: ${link.title}`);
            }
            if (link.description) {
              parts.push(`Description: ${link.description}`);
            }
            if (link.siteName) {
              parts.push(`Site: ${link.siteName}`);
            }
            return parts.join("\n");
          })
          .join("\n\n");
        textContent += `\n\nLinks:\n${linkParts}`;
      }

      // Build attachment parts for images and text files (only for user messages)
      let aiMessage: AiMessage;
      if (role === "user") {
        const attachmentParts: AiMessagePart[] = [];
        for (const att of msg.attachments) {
          const part = await attachmentToPart(att);
          if (part) {
            attachmentParts.push(part);
          } else if (att.type === "video" || att.type === "audio") {
            onUnsupported(att, msg);
          }
        }

        if (attachmentParts.length > 0) {
          aiMessage = {
            role,
            content: [
              { type: "text" as const, text: textContent },
              ...attachmentParts,
            ],
          } satisfies AiUserMessage;
        } else {
          aiMessage = { role, content: textContent } as AiMessage;
        }
      } else {
        aiMessage = { role, content: textContent } as AiMessage;
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
