/**
 * Attachment handling utilities for WhatsApp adapter.
 */

import type { Logger } from "chat";
import type WAWebJS from "whatsapp-web.js";

export interface WhatsAppAttachment {
  type: "image" | "video" | "audio" | "file";
  url: undefined;
  name: string | undefined;
  mimeType: string | undefined;
  size: number | undefined;
  fetchData: () => Promise<Buffer & { mimetype?: string; filename?: string }>;
}

/**
 * Infer attachment type and MIME type from WhatsApp message type.
 */
function inferAttachmentMetadata(messageType: string): {
  attachmentType: "image" | "video" | "audio" | "file";
  mimeType: string | undefined;
} {
  switch (messageType) {
    case "image":
      return { attachmentType: "image", mimeType: "image/jpeg" };
    case "sticker":
      return { attachmentType: "image", mimeType: "image/webp" };
    case "video":
      return { attachmentType: "video", mimeType: "video/mp4" };
    case "audio":
    case "ptt":
      return { attachmentType: "audio", mimeType: "audio/ogg" };
    case "document":
    default:
      return { attachmentType: "file", mimeType: undefined };
  }
}

/**
 * Create an attachment object from a WhatsApp message.
 * Media is downloaded lazily when fetchData() is called.
 */
export function createAttachmentFromMessage(
  message: WAWebJS.Message,
  logger: Logger
): WhatsAppAttachment {
  const messageType = message.type;
  const { attachmentType, mimeType } = inferAttachmentMetadata(messageType);

  const isDocument = messageType === "document";
  const filename = isDocument && message.body ? message.body : undefined;

  let cachedMedia: {
    data: Buffer;
    mimetype: string;
    filename?: string;
  } | null = null;

  return {
    type: attachmentType,
    url: undefined,
    name: filename,
    mimeType,
    size: undefined,

    fetchData: async () => {
      if (cachedMedia) {
        return Object.assign(cachedMedia.data, {
          mimetype: cachedMedia.mimetype,
          filename: cachedMedia.filename,
        });
      }

      const media = await message.downloadMedia();
      if (!media) {
        throw new Error("Media download failed - media may have been deleted");
      }

      const buffer = Buffer.from(media.data, "base64");
      cachedMedia = {
        data: buffer,
        mimetype: media.mimetype,
        filename: media.filename ?? undefined,
      };

      logger.debug("WhatsApp: media downloaded", {
        mimetype: media.mimetype,
        filename: media.filename,
        filesize: media.filesize,
        bufferSize: buffer.length,
      });

      return Object.assign(buffer, {
        mimetype: media.mimetype,
        filename: media.filename ?? undefined,
      });
    },
  };
}
