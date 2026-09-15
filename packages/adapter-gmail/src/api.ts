import { z } from "zod";
import { composeGmailMessage, type GmailOutgoing } from "./format";
import { readGmailJson } from "./http";
import {
  draft,
  type GmailDraft,
  type GmailHistory,
  type GmailHistoryType,
  type GmailLabels,
  type GmailListing,
  type GmailMessage,
  type GmailMetadata,
  type GmailPreparedMessage,
  type GmailProfile,
  type GmailReference,
  type GmailThread,
  type GmailWatch,
  history,
  historyId,
  historyType,
  identifier,
  labels,
  listing,
  mailbox,
  message,
  metadata,
  prepared,
  profile,
  reference,
  thread,
  watch,
} from "./schema";

const topic = /^projects\/[^/\s]+\/topics\/[^/\s]+$/;
const size = z.number().int().min(1).max(500).default(100);
const stopped = z
  .object({})
  .optional()
  .transform(() => undefined);
const credentials = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

export { GmailApiError, GmailContentError } from "./http";
export type {
  GmailContinuation,
  GmailDraft,
  GmailHistory,
  GmailHistoryType,
  GmailLabel,
  GmailLabels,
  GmailListing,
  GmailMessage,
  GmailMetadata,
  GmailPreparedMessage,
  GmailProfile,
  GmailReference,
  GmailThread,
  GmailWatch,
} from "./schema";

export type GmailToken = string | (() => string | Promise<string>);

export interface GmailApiOptions {
  fetch?: typeof globalThis.fetch;
  mailbox: string;
  signal?: AbortSignal;
  token: GmailToken;
}

async function request<T>(
  options: GmailApiOptions,
  path: string,
  result: z.ZodType<T>,
  body?: unknown,
  method: "GET" | "POST" = body === undefined ? "GET" : "POST"
): Promise<T> {
  options.signal?.throwIfAborted();
  const account = mailbox.parse(options.mailbox);
  const token =
    typeof options.token === "function" ? await options.token() : options.token;
  if (!token) {
    throw new Error("A Gmail access token is required");
  }
  options.signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(30_000);
  const signal = options.signal
    ? AbortSignal.any([timeout, options.signal])
    : timeout;
  const response = await (options.fetch ?? globalThis.fetch)(
    `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(account)}/${path}`,
    {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal,
    }
  );
  return result.parse(
    response.status === 204 ? undefined : await readGmailJson(response)
  );
}

export function getGmailProfile(
  options: GmailApiOptions
): Promise<GmailProfile> {
  return request(options, "profile", profile);
}

export function listGmailLabels(
  options: GmailApiOptions
): Promise<GmailLabels> {
  return request(options, "labels", labels);
}

export function stopGmailMailbox(options: GmailApiOptions): Promise<void> {
  return request(options, "stop", stopped, undefined, "POST");
}

export function getGmailMessage(
  id: string,
  options: GmailApiOptions
): Promise<GmailMessage> {
  return request(
    options,
    `messages/${identifier.parse(id)}?format=raw`,
    message
  );
}

export function getGmailThread(
  id: string,
  options: GmailApiOptions
): Promise<GmailThread> {
  return request(
    options,
    `threads/${identifier.parse(id)}?format=minimal&fields=id,messages(id,threadId)`,
    thread
  );
}

export function getGmailMessageMetadata(
  id: string,
  options: GmailApiOptions
): Promise<GmailMetadata> {
  return request(
    options,
    `messages/${identifier.parse(id)}?format=minimal`,
    metadata
  );
}

export function listGmailMessages(
  input: {
    includeSpamTrash?: boolean;
    labelId?: string;
    maxResults?: number;
    pageToken?: string;
    q?: string;
  },
  options: GmailApiOptions
): Promise<GmailListing> {
  const query = new URLSearchParams({
    maxResults: String(size.parse(input.maxResults)),
  });
  if (input.labelId !== undefined) {
    query.set("labelIds", identifier.parse(input.labelId));
  }
  if (input.q !== undefined) {
    query.set("q", input.q);
  }
  if (input.includeSpamTrash !== undefined) {
    query.set("includeSpamTrash", String(input.includeSpamTrash));
  }
  if (input.pageToken) {
    query.set("pageToken", input.pageToken);
  }
  return request(options, `messages?${query}`, listing);
}

export function listGmailHistory(
  input: {
    historyTypes?: GmailHistoryType[];
    labelId?: string;
    maxResults?: number;
    pageToken?: string;
    startHistoryId: string;
  },
  options: GmailApiOptions
): Promise<GmailHistory> {
  const query = new URLSearchParams({
    startHistoryId: historyId.parse(input.startHistoryId),
    maxResults: String(size.parse(input.maxResults)),
  });
  if (input.pageToken) {
    query.set("pageToken", input.pageToken);
  }
  if (input.labelId !== undefined) {
    query.set("labelId", identifier.parse(input.labelId));
  }
  for (const type of input.historyTypes ?? []) {
    query.append("historyTypes", historyType.parse(type));
  }
  return request(options, `history?${query}`, history);
}

export function watchGmailMailbox(
  input: { topicName: string; labelId?: string },
  options: GmailApiOptions
): Promise<GmailWatch> {
  const topicName = z.string().regex(topic).parse(input.topicName);
  return request(options, "watch", watch, {
    topicName,
    ...(input.labelId === undefined
      ? {}
      : {
          labelIds: [identifier.parse(input.labelId)],
          labelFilterBehavior: "include",
        }),
  });
}

function prepare(
  input: GmailOutgoing | GmailPreparedMessage,
  account: string
): GmailPreparedMessage {
  if ("raw" in input) {
    const result = prepared.parse(input);
    if (Buffer.from(result.raw, "base64url").byteLength > 25 * 1024 * 1024) {
      throw new Error("Gmail message exceeds the 25 MB sending limit");
    }
    return result;
  }
  if (
    input.continuation &&
    mailbox.parse(account) !== input.continuation.mailbox
  ) {
    throw new Error("Gmail continuation belongs to another mailbox");
  }
  return {
    raw: composeGmailMessage({ ...input, from: account }),
    ...(input.continuation ? { threadId: input.continuation.threadId } : {}),
  };
}

export function sendGmailMessage(
  input: GmailOutgoing | GmailPreparedMessage,
  options: GmailApiOptions
): Promise<GmailReference> {
  return request(
    options,
    "messages/send",
    reference,
    prepare(input, options.mailbox)
  );
}

export function createGmailDraft(
  input: GmailOutgoing | GmailPreparedMessage,
  options: GmailApiOptions
): Promise<GmailDraft> {
  return request(options, "drafts", draft, {
    message: prepare(input, options.mailbox),
  });
}

export interface GmailTokenOptions {
  clientId: string;
  clientSecret: string;
  fetch?: typeof globalThis.fetch;
  refreshToken: string;
}

export function createGmailTokenProvider(
  options: GmailTokenOptions
): () => Promise<string> {
  for (const credential of [
    options.clientId,
    options.clientSecret,
    options.refreshToken,
  ]) {
    if (!credential) {
      throw new Error(
        "Gmail OAuth client credentials and refresh token are required"
      );
    }
  }
  let cached: { value: string; expiration: number } | undefined;
  let pending: Promise<string> | undefined;
  const refresh = async () => {
    const response = await (options.fetch ?? globalThis.fetch)(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          refresh_token: options.refreshToken,
          grant_type: "refresh_token",
        }),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      }
    );
    const token = credentials.parse(await readGmailJson(response, 65_536));
    cached = {
      value: token.access_token,
      expiration: Date.now() + Math.max(0, token.expires_in - 60) * 1000,
    };
    return token.access_token;
  };
  return () => {
    if (cached && cached.expiration > Date.now()) {
      return Promise.resolve(cached.value);
    }
    pending ??= refresh().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
