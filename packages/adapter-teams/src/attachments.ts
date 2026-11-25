import {
  bufferToDataUri,
  downloadAttachment,
  NetworkError,
  toBuffer,
} from "@chat-adapter/shared";
import type { Attachment } from "chat";

const FILE_DOWNLOAD_INFO_CONTENT_TYPE =
  "application/vnd.microsoft.teams.file.download.info";
const GRAPH_FILE_REFERENCE_CONTENT_TYPE = "reference";
const FILE_TYPE_PREFIX_PATTERN = /^\./;
const IMAGE_MIME_TYPE_PATTERN = /^image\//i;
// Teams documents 1 MB as the limit for an image sent inline, and an
// attachment it rejects can fail the whole message.
const MAX_INLINE_IMAGE_BYTES = 1024 * 1024;
const FALLBACK_IMAGE_MIME_TYPE = "image/png";
const IMAGE_SIGNATURES: [mimeType: string, signature: number[]][] = [
  ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  ["image/gif", [0x47, 0x49, 0x46, 0x38]],
];
const LOOPBACK_HOST_PATTERN = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;
const FILE_MIME_TYPES: Record<string, string> = {
  apng: "image/apng",
  avif: "image/avif",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  svg: "image/svg+xml",
  txt: "text/plain",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

type AttachmentRetrieval =
  | {
      mode: "anonymous";
      url: string;
    }
  | {
      connectorOrigin: string;
      mode: "bot";
      url: string;
    }
  | {
      mode: "graph";
      url: string;
    }
  | {
      mode: "rejected";
      url: string;
    };

export interface TeamsAttachmentFetchers {
  createAnonymousFetchData: (url: string) => () => Promise<Buffer>;
  fetchAuthenticated: (url: string) => Promise<Buffer>;
  /** Download a SharePoint or OneDrive file reference through Microsoft Graph. */
  fetchGraphFile: (url: string) => Promise<Buffer>;
}

export interface TeamsActivityAttachment {
  content?: unknown;
  contentType?: string;
  contentUrl?: string;
  name?: string;
}

/** Attachment shape returned on Microsoft Graph chatMessage resources. */
export interface TeamsGraphMessageAttachment {
  contentType?: string | null;
  contentUrl?: string | null;
  name?: string | null;
}

function inferFileMimeType(name?: string, fileType?: string): string {
  const extension = (fileType || name?.split(".").pop() || "")
    .toLowerCase()
    .replace(FILE_TYPE_PREFIX_PATTERN, "");
  return FILE_MIME_TYPES[extension] ?? "application/octet-stream";
}

function getConnectorOrigin(url?: string): string | undefined {
  if (!url) {
    return;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") {
      return parsed.origin;
    }
    // The Bot Framework Emulator serves the connector over plain HTTP on
    // loopback, so local development still gets the bot-auth path.
    if (
      parsed.protocol === "http:" &&
      LOOPBACK_HOST_PATTERN.test(parsed.hostname)
    ) {
      return parsed.origin;
    }
    return;
  } catch {
    return;
  }
}

function isTrustedBotAttachmentUrl(
  url: string,
  connectorOrigin: string
): boolean {
  return getConnectorOrigin(url) === connectorOrigin;
}

function createFetchDataFn(
  retrieval: AttachmentRetrieval,
  fetchers: TeamsAttachmentFetchers
): () => Promise<Buffer> {
  if (retrieval.mode === "anonymous") {
    return fetchers.createAnonymousFetchData(retrieval.url);
  }
  if (retrieval.mode === "graph") {
    return () => fetchers.fetchGraphFile(retrieval.url);
  }

  return async () => {
    if (
      retrieval.mode === "rejected" ||
      !isTrustedBotAttachmentUrl(retrieval.url, retrieval.connectorOrigin)
    ) {
      throw new NetworkError(
        "teams",
        "Refusing to send a bot token to an untrusted attachment URL"
      );
    }
    return fetchers.fetchAuthenticated(retrieval.url);
  };
}

export function createAnonymousAttachmentFetchData(
  url: string
): () => Promise<Buffer> {
  return async () => {
    try {
      return await downloadAttachment(url, { adapter: "teams" });
    } catch (error) {
      if (error instanceof NetworkError) {
        throw error;
      }
      throw new NetworkError(
        "teams",
        "Failed to fetch attachment",
        error instanceof Error ? error : undefined
      );
    }
  };
}

function classifyAttachmentType(
  mimeType: string | undefined
): Attachment["type"] {
  if (mimeType?.startsWith("image/")) {
    return "image";
  }
  if (mimeType?.startsWith("video/")) {
    return "video";
  }
  if (mimeType?.startsWith("audio/")) {
    return "audio";
  }
  return "file";
}

export function createTeamsAttachment(
  att: TeamsActivityAttachment,
  serviceUrl: string | undefined,
  fetchers: TeamsAttachmentFetchers
): Attachment {
  const isFileDownload = att.contentType === FILE_DOWNLOAD_INFO_CONTENT_TYPE;
  const fileContent =
    isFileDownload && typeof att.content === "object" && att.content !== null
      ? (att.content as {
          downloadUrl?: unknown;
          fileType?: unknown;
        })
      : undefined;
  const fileType =
    typeof fileContent?.fileType === "string"
      ? fileContent.fileType
      : undefined;
  let url = att.contentUrl;
  if (isFileDownload) {
    url =
      typeof fileContent?.downloadUrl === "string"
        ? fileContent.downloadUrl
        : undefined;
  }
  const mimeType = isFileDownload
    ? inferFileMimeType(att.name, fileType)
    : att.contentType;
  const connectorOrigin = getConnectorOrigin(serviceUrl);
  const useBotAuth =
    !isFileDownload &&
    url !== undefined &&
    connectorOrigin !== undefined &&
    isTrustedBotAttachmentUrl(url, connectorOrigin);

  let retrieval: AttachmentRetrieval | undefined;
  if (url) {
    retrieval = useBotAuth
      ? { mode: "bot", url, connectorOrigin }
      : { mode: "anonymous", url };
  }
  let fetchMetadata: Record<string, string> | undefined;
  if (retrieval) {
    fetchMetadata =
      retrieval.mode === "bot"
        ? {
            url: retrieval.url,
            auth: "bot",
            connectorOrigin: retrieval.connectorOrigin,
          }
        : { url: retrieval.url };
  }

  return {
    type: classifyAttachmentType(mimeType),
    url,
    name: att.name,
    mimeType,
    fetchMetadata,
    fetchData: retrieval ? createFetchDataFn(retrieval, fetchers) : undefined,
  };
}

/**
 * Map an attachment from a Microsoft Graph chatMessage. Files shared in group
 * chats and channels arrive as `reference` attachments that point at
 * SharePoint or OneDrive, so they are downloaded through Graph instead of
 * anonymously.
 */
export function createTeamsGraphAttachment(
  att: TeamsGraphMessageAttachment,
  fetchers: TeamsAttachmentFetchers
): Attachment {
  const name = att.name ?? undefined;
  const url = att.contentUrl ?? undefined;

  if (att.contentType !== GRAPH_FILE_REFERENCE_CONTENT_TYPE) {
    return {
      type: att.contentType?.includes("image") ? "image" : "file",
      name,
      url,
      mimeType: att.contentType ?? undefined,
    };
  }

  const mimeType = inferFileMimeType(name);
  const retrieval: AttachmentRetrieval | undefined = url
    ? { mode: "graph", url }
    : undefined;

  return {
    type: classifyAttachmentType(mimeType),
    name,
    url,
    mimeType,
    fetchMetadata: url ? { url, auth: "graph" } : undefined,
    fetchData: retrieval ? createFetchDataFn(retrieval, fetchers) : undefined,
  };
}

export function rehydrateTeamsAttachment(
  attachment: Attachment,
  fetchers: TeamsAttachmentFetchers
): Attachment {
  const url = attachment.fetchMetadata?.url ?? attachment.url;
  if (!url) {
    return attachment;
  }

  const connectorOrigin = attachment.fetchMetadata?.connectorOrigin;
  let retrieval: AttachmentRetrieval = { mode: "anonymous", url };
  if (attachment.fetchMetadata?.auth === "bot") {
    retrieval = connectorOrigin
      ? { mode: "bot", url, connectorOrigin }
      : { mode: "rejected", url };
  } else if (attachment.fetchMetadata?.auth === "graph") {
    retrieval = { mode: "graph", url };
  }

  return {
    ...attachment,
    fetchData: createFetchDataFn(retrieval, fetchers),
  };
}

type OutboundAttachmentSkipReason =
  | "edit-no-upload"
  | "fetch-failed"
  | "invalid-url"
  | "no-content"
  | "not-https"
  | "too-large"
  | "unsupported-type";

interface SkippedOutboundAttachment {
  /** Position in the postable's `attachments`. */
  index: number;
  name?: string;
  reason: OutboundAttachmentSkipReason;
}

interface TeamsOutboundAttachment {
  contentType: string;
  contentUrl: string;
  name?: string;
}

function isImageAttachment(attachment: Attachment): boolean {
  return attachment.mimeType
    ? IMAGE_MIME_TYPE_PATTERN.test(attachment.mimeType)
    : attachment.type === "image";
}

function sniffImageMimeType(bytes: Buffer): string | undefined {
  for (const [mimeType, signature] of IMAGE_SIGNATURES) {
    if (
      bytes.length >= signature.length &&
      signature.every((byte, offset) => bytes[offset] === byte)
    ) {
      return mimeType;
    }
  }
  return;
}

function urlPathname(url: string | undefined): string | undefined {
  if (!url) {
    return;
  }
  try {
    return new URL(url).pathname;
  } catch {
    return;
  }
}

function inferImageMimeType(attachment: Attachment, bytes?: Buffer): string {
  if (attachment.mimeType) {
    return attachment.mimeType;
  }
  const sniffed = bytes && sniffImageMimeType(bytes);
  if (sniffed) {
    return sniffed;
  }
  for (const candidate of [attachment.name, urlPathname(attachment.url)]) {
    const inferred = candidate ? inferFileMimeType(candidate) : undefined;
    if (inferred && IMAGE_MIME_TYPE_PATTERN.test(inferred)) {
      return inferred;
    }
  }
  return FALLBACK_IMAGE_MIME_TYPE;
}

async function resolveAttachmentBytes(
  attachment: Attachment
): Promise<Buffer | null> {
  try {
    const data =
      attachment.data ??
      (attachment.fetchData ? await attachment.fetchData() : undefined);
    return await toBuffer(data, {
      platform: "teams",
      throwOnUnsupported: false,
    });
  } catch {
    return null;
  }
}

function urlSkipReason(url: string): OutboundAttachmentSkipReason | undefined {
  try {
    return new URL(url).protocol === "https:" ? undefined : "not-https";
  } catch {
    return "invalid-url";
  }
}

async function toTeamsOutboundAttachment(
  attachment: Attachment,
  mode: "edit" | "send"
): Promise<TeamsOutboundAttachment | OutboundAttachmentSkipReason> {
  // Teams renders only images sent this way, and can reject the whole message
  // when it carries another type.
  if (!isImageAttachment(attachment)) {
    return "unsupported-type";
  }

  // Bytes win over `url`: an attachment that carries `data` or `fetchData`
  // usually has a `url` that needs credentials Teams doesn't have.
  if (attachment.data || attachment.fetchData) {
    if (mode === "edit") {
      return "edit-no-upload";
    }
    const bytes = await resolveAttachmentBytes(attachment);
    if (!bytes) {
      return "fetch-failed";
    }
    if (bytes.length === 0) {
      return "no-content";
    }
    if (bytes.length > MAX_INLINE_IMAGE_BYTES) {
      return "too-large";
    }
    const contentType = inferImageMimeType(attachment, bytes);
    return {
      contentType,
      contentUrl: bufferToDataUri(bytes, contentType),
      name: attachment.name,
    };
  }

  if (!attachment.url) {
    return "no-content";
  }
  const reason = urlSkipReason(attachment.url);
  if (reason) {
    return reason;
  }
  return {
    contentType: inferImageMimeType(attachment),
    contentUrl: attachment.url,
    name: attachment.name,
  };
}

/**
 * Map a postable's `attachments` to Teams activity attachments. An entry
 * Teams can't take is reported in `skipped` instead of thrown, so the rest of
 * the message still sends. `edit` mode keeps the entries sent by URL and never
 * resolves bytes.
 */
export async function toTeamsOutboundAttachments(
  attachments: Attachment[],
  mode: "edit" | "send"
): Promise<{
  attachments: TeamsOutboundAttachment[];
  skipped: SkippedOutboundAttachment[];
}> {
  const sent: TeamsOutboundAttachment[] = [];
  const skipped: SkippedOutboundAttachment[] = [];
  for (const [index, attachment] of attachments.entries()) {
    const result = await toTeamsOutboundAttachment(attachment, mode);
    if (typeof result === "string") {
      skipped.push({ index, name: attachment.name, reason: result });
    } else {
      sent.push(result);
    }
  }
  return { attachments: sent, skipped };
}
