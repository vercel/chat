import { NetworkError } from "@chat-adapter/shared";
import type { Attachment } from "chat";

const FILE_DOWNLOAD_INFO_CONTENT_TYPE =
  "application/vnd.microsoft.teams.file.download.info";
const FILE_TYPE_PREFIX_PATTERN = /^\./;
const FILE_MIME_TYPES: Record<string, string> = {
  apng: "image/apng",
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
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
      mode: "rejected";
      url: string;
    };

export interface TeamsAttachmentFetchers {
  createAnonymousFetchData: (url: string) => () => Promise<Buffer>;
  fetchAuthenticated: (url: string) => Promise<Buffer>;
}

export interface TeamsActivityAttachment {
  content?: unknown;
  contentType?: string;
  contentUrl?: string;
  name?: string;
}

function inferFileMimeType(name?: string, fileType?: string): string {
  const extension = (fileType || name?.split(".").pop() || "")
    .toLowerCase()
    .replace(FILE_TYPE_PREFIX_PATTERN, "");
  return FILE_MIME_TYPES[extension] ?? "application/octet-stream";
}

function getHttpsOrigin(url?: string): string | undefined {
  if (!url) {
    return;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.origin : undefined;
  } catch {
    return;
  }
}

function isTrustedBotAttachmentUrl(
  url: string,
  connectorOrigin: string
): boolean {
  return getHttpsOrigin(url) === connectorOrigin;
}

function createFetchDataFn(
  retrieval: AttachmentRetrieval,
  fetchers: TeamsAttachmentFetchers
): () => Promise<Buffer> {
  if (retrieval.mode === "anonymous") {
    return fetchers.createAnonymousFetchData(retrieval.url);
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
    const response = await fetch(url);
    if (!response.ok) {
      throw new NetworkError(
        "teams",
        `Failed to fetch file: ${response.status} ${response.statusText}`
      );
    }
    return Buffer.from(await response.arrayBuffer());
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
  const connectorOrigin = getHttpsOrigin(serviceUrl);
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
  }

  return {
    ...attachment,
    fetchData: createFetchDataFn(retrieval, fetchers),
  };
}
