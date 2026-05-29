export type SlackBotToken = string | (() => Promise<string> | string);

export type SlackFetch = typeof fetch;

export interface SlackApiResponse {
  error?: string;
  needed?: string;
  ok: boolean;
  provided?: string;
  response_metadata?: {
    messages?: string[];
    next_cursor?: string;
    warnings?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface SlackApiOptions {
  apiUrl?: string;
  fetch?: SlackFetch;
  token: SlackBotToken;
}

export interface SlackApiCallOptions extends SlackApiOptions {
  contentType?: "form" | "json";
}

export interface SlackMessageOptions extends SlackApiOptions {
  blocks?: unknown[];
  channel: string;
  markdownText?: string;
  metadata?: unknown;
  replyBroadcast?: boolean;
  text?: string;
  threadTs?: string;
  unfurlLinks?: boolean;
  unfurlMedia?: boolean;
}

export interface SlackEphemeralOptions extends SlackMessageOptions {
  user: string;
}

export interface SlackUpdateOptions extends SlackMessageOptions {
  ts: string;
}

export interface SlackDeleteOptions extends SlackApiOptions {
  channel: string;
  ts: string;
}

export interface SlackPostedMessage {
  channel?: string;
  id: string;
  raw: SlackApiResponse;
}

export interface SlackResponseUrlPayload {
  blocks?: unknown[];
  deleteOriginal?: boolean;
  replaceOriginal?: boolean;
  responseType?: "ephemeral" | "in_channel";
  text?: string;
  threadTs?: string;
}

export interface SlackResponseUrlOptions {
  fetch?: SlackFetch;
}

export interface SlackFileUpload {
  altText?: string;
  data: ArrayBuffer | Blob | Uint8Array;
  filename: string;
  snippetType?: string;
  title?: string;
}

export interface SlackUploadOptions extends SlackApiOptions {
  channelId?: string;
  initialComment?: string;
  threadTs?: string;
}

export interface SlackUploadResult {
  fileIds: string[];
  raw: SlackApiResponse;
}

export interface SlackFileFetchOptions extends SlackApiOptions {
  url: string;
}

export class SlackApiError extends Error {
  method: string;
  response?: SlackApiResponse;
  status?: number;

  constructor(
    message: string,
    options: { method: string; response?: SlackApiResponse; status?: number }
  ) {
    super(message);
    this.name = "SlackApiError";
    this.method = options.method;
    this.response = options.response;
    this.status = options.status;
  }
}

const DEFAULT_API_URL = "https://slack.com/api/";

export async function resolveSlackBotToken(
  token: SlackBotToken
): Promise<string> {
  return typeof token === "function" ? await token() : token;
}

export async function callSlackApi<
  TResponse extends SlackApiResponse = SlackApiResponse,
>(
  method: string,
  body: Record<string, unknown>,
  options: SlackApiCallOptions
): Promise<TResponse> {
  const token = await resolveSlackBotToken(options.token);
  const encoded = encodeSlackApiBody(body, options.contentType ?? "form");
  const request = options.fetch ?? fetch;
  const response = await request(
    new URL(method, options.apiUrl ?? DEFAULT_API_URL),
    {
      body: encoded.body,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": encoded.contentType,
      },
      method: "POST",
    }
  );
  const payload = (await response.json()) as TResponse;
  if (!response.ok) {
    throw new SlackApiError(
      `Slack ${method} returned HTTP ${response.status}`,
      {
        method,
        response: payload,
        status: response.status,
      }
    );
  }
  return payload;
}

export async function postSlackMessage(
  options: SlackMessageOptions
): Promise<SlackPostedMessage> {
  const raw = await callSlackApi(
    "chat.postMessage",
    slackMessageBody(options),
    options
  );
  assertSlackOk("chat.postMessage", raw);
  return {
    channel: optionalString(raw.channel),
    id: stringValue(raw.ts),
    raw,
  };
}

export async function postSlackEphemeral(
  options: SlackEphemeralOptions
): Promise<SlackPostedMessage> {
  const raw = await callSlackApi(
    "chat.postEphemeral",
    {
      ...slackMessageBody(options),
      user: options.user,
    },
    options
  );
  assertSlackOk("chat.postEphemeral", raw);
  return {
    channel: optionalString(raw.channel),
    id: stringValue(raw.message_ts),
    raw,
  };
}

export async function updateSlackMessage(
  options: SlackUpdateOptions
): Promise<SlackPostedMessage> {
  const raw = await callSlackApi(
    "chat.update",
    {
      ...slackMessageBody(options),
      ts: options.ts,
    },
    options
  );
  assertSlackOk("chat.update", raw);
  return {
    channel: optionalString(raw.channel),
    id: stringValue(raw.ts),
    raw,
  };
}

export async function deleteSlackMessage(
  options: SlackDeleteOptions
): Promise<SlackApiResponse> {
  const raw = await callSlackApi(
    "chat.delete",
    {
      channel: options.channel,
      ts: options.ts,
    },
    options
  );
  assertSlackOk("chat.delete", raw);
  return raw;
}

export async function sendSlackResponseUrl(
  url: string,
  payload: SlackResponseUrlPayload,
  options: SlackResponseUrlOptions = {}
): Promise<void> {
  const request = options.fetch ?? fetch;
  const response = await request(url, {
    body: JSON.stringify(responseUrlBody(payload)),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new SlackApiError(
      `Slack response_url returned HTTP ${response.status}`,
      {
        method: "response_url",
        status: response.status,
      }
    );
  }
}

export async function uploadSlackFiles(
  files: readonly SlackFileUpload[],
  options: SlackUploadOptions
): Promise<SlackUploadResult> {
  if (files.length === 0) {
    return { fileIds: [], raw: { ok: true } };
  }
  const token = await resolveSlackBotToken(options.token);
  const request = options.fetch ?? fetch;
  const fileIds: string[] = [];
  for (const file of files) {
    const bytes = await readSlackFileBytes(file.data);
    const upload = await callSlackApi(
      "files.getUploadURLExternal",
      {
        alt_txt: file.altText,
        filename: file.filename,
        length: bytes.byteLength,
        snippet_type: file.snippetType,
      },
      options
    );
    assertSlackOk("files.getUploadURLExternal", upload);
    const uploadUrl = stringValue(upload.upload_url);
    const fileId = stringValue(upload.file_id);
    if (!(uploadUrl && fileId)) {
      throw new SlackApiError(
        "Slack files.getUploadURLExternal returned no upload URL",
        {
          method: "files.getUploadURLExternal",
          response: upload,
        }
      );
    }
    const response = await request(uploadUrl, {
      body: bytes,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
      },
      method: "POST",
    });
    if (!response.ok) {
      throw new SlackApiError(
        `Slack file upload returned HTTP ${response.status}`,
        {
          method: "files.upload",
          status: response.status,
        }
      );
    }
    fileIds.push(fileId);
  }
  const raw = await callSlackApi(
    "files.completeUploadExternal",
    {
      channel_id: options.channelId,
      files: files.map((file, index) => ({
        id: fileIds[index],
        title: file.title ?? file.filename,
      })),
      initial_comment: options.initialComment,
      thread_ts: options.threadTs,
    },
    options
  );
  assertSlackOk("files.completeUploadExternal", raw);
  return { fileIds, raw };
}

export async function fetchSlackFile(
  options: SlackFileFetchOptions
): Promise<Response> {
  const token = await resolveSlackBotToken(options.token);
  const request = options.fetch ?? fetch;
  const response = await request(options.url, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new SlackApiError(
      `Slack file fetch returned HTTP ${response.status}`,
      {
        method: "files.fetch",
        status: response.status,
      }
    );
  }
  return response;
}

export function encodeSlackApiBody(
  body: Record<string, unknown>,
  contentType: "form" | "json" = "form"
): { body: string; contentType: string } {
  if (contentType === "json") {
    return {
      body: JSON.stringify(removeUndefined(body)),
      contentType: "application/json",
    };
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) {
      continue;
    }
    params.set(key, encodeSlackApiValue(value));
  }
  return {
    body: params.toString(),
    contentType: "application/x-www-form-urlencoded",
  };
}

export function assertSlackOk(
  method: string,
  response: SlackApiResponse
): void {
  if (response.ok !== true) {
    throw new SlackApiError(
      `Slack ${method} failed: ${response.error ?? "unknown_error"}`,
      {
        method,
        response,
      }
    );
  }
}

function slackMessageBody(
  options: SlackMessageOptions
): Record<string, unknown> {
  assertSlackMessageContent(options);
  return {
    blocks: options.blocks,
    channel: options.channel,
    markdown_text: options.markdownText,
    metadata: options.metadata,
    reply_broadcast: options.replyBroadcast,
    text: options.text,
    thread_ts: options.threadTs,
    unfurl_links: options.unfurlLinks,
    unfurl_media: options.unfurlMedia,
  };
}

function responseUrlBody(
  payload: SlackResponseUrlPayload
): Record<string, unknown> {
  return {
    blocks: payload.blocks,
    delete_original: payload.deleteOriginal,
    replace_original: payload.replaceOriginal,
    response_type: payload.responseType,
    text: payload.text,
    thread_ts: payload.threadTs,
  };
}

function assertSlackMessageContent(options: SlackMessageOptions): void {
  if (
    options.markdownText !== undefined &&
    (options.text !== undefined || options.blocks !== undefined)
  ) {
    throw new TypeError("markdownText cannot be used with text or blocks");
  }
}

function encodeSlackApiValue(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

function removeUndefined(
  value: Record<string, unknown>
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      output[key] = item;
    }
  }
  return output;
}

async function readSlackFileBytes(
  data: ArrayBuffer | Blob | Uint8Array
): Promise<Uint8Array> {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(await data.arrayBuffer());
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
