import { createHash } from "node:crypto";
import type { TwilioContentBody } from "../cards";
import type { TwilioApiOptions } from "./index";
import { encodeBase64Utf8, resolveTwilioCredential } from "./index";

const DEFAULT_CONTENT_API_URL = "https://content.twilio.com";
const CONTENT_LIST_PAGE_SIZE = 50;
const CONTENT_LOOKUP_MAX_PAGES = 20;
const CONTENT_SID_CACHE_LIMIT = 200;
const TWILIO_CONTENT_TYPE_PREFIX = /^twilio\//;

export interface TwilioContentResource {
  account_sid?: string;
  date_created?: string;
  date_updated?: string;
  friendly_name?: string;
  language?: string;
  sid: string;
  types?: Record<string, unknown>;
  url?: string;
  variables?: Record<string, string>;
}

export interface CreateTwilioContentOptions extends TwilioApiOptions {
  contentApiUrl?: string;
  contentBody: TwilioContentBody;
}

interface TwilioContentListResponse {
  contents?: TwilioContentResource[];
  meta?: {
    next_page_url?: string | null;
  };
}

const contentSidCache = new Map<string, string>();

export function resetTwilioContentCacheForTests(): void {
  contentSidCache.clear();
}

// ContentSids are account resources, so the cache key includes the account
// and API base URL — a process hosting adapters for several Twilio accounts
// must never reuse one tenant's ContentSid for another.
function scopedContentCacheKey(
  accountSid: string,
  baseUrl: string,
  contentBody: TwilioContentBody
): string {
  return `${accountSid}:${baseUrl}:${twilioContentCacheKey(contentBody)}`;
}

function cacheContentSid(key: string, sid: string): void {
  contentSidCache.delete(key);
  contentSidCache.set(key, sid);
  if (contentSidCache.size > CONTENT_SID_CACHE_LIMIT) {
    const oldest = contentSidCache.keys().next().value;
    if (oldest !== undefined) {
      contentSidCache.delete(oldest);
    }
  }
}

function contentBaseUrl(options: CreateTwilioContentOptions): string {
  return (
    options.contentApiUrl ??
    options.apiUrl ??
    options.apiBaseUrl ??
    DEFAULT_CONTENT_API_URL
  );
}

function twilioContentCacheKey(contentBody: TwilioContentBody): string {
  const { language, types, variables } = contentBody;
  return createHash("sha256")
    .update(
      JSON.stringify({
        language,
        types,
        variables: variables ?? null,
      })
    )
    .digest("hex");
}

function twilioContentFriendlyName(contentBody: TwilioContentBody): string {
  const primaryType =
    Object.keys(contentBody.types)
      .find((key) => key.startsWith("twilio/"))
      ?.replace(TWILIO_CONTENT_TYPE_PREFIX, "") ?? "text";
  const hash = twilioContentCacheKey(contentBody).slice(0, 16);
  return `chat_sdk_${primaryType}_${hash}`;
}

export async function getOrCreateTwilioContent(
  options: CreateTwilioContentOptions
): Promise<TwilioContentResource> {
  const accountSid = await resolveTwilioCredential(
    options.credentials?.accountSid,
    "TWILIO_ACCOUNT_SID"
  );
  const cacheKey = scopedContentCacheKey(
    accountSid,
    contentBaseUrl(options),
    options.contentBody
  );
  const cachedSid = contentSidCache.get(cacheKey);
  if (cachedSid) {
    return {
      friendly_name: twilioContentFriendlyName(options.contentBody),
      sid: cachedSid,
    };
  }

  const friendlyName = twilioContentFriendlyName(options.contentBody);

  // The in-memory cache is empty on every cold start and the Content API
  // does not deduplicate creates, so look for a template minted by an
  // earlier process before creating another immortal chat_sdk_* copy.
  const existing = await findTwilioContentByFriendlyName(options, friendlyName);
  if (existing?.sid) {
    cacheContentSid(cacheKey, existing.sid);
    return existing;
  }

  const contentBody: TwilioContentBody = {
    ...options.contentBody,
    friendly_name: friendlyName,
  };

  try {
    const created = await createTwilioContent({
      ...options,
      contentBody,
    });
    cacheContentSid(cacheKey, created.sid);
    return created;
  } catch (error) {
    if (!isDuplicateFriendlyNameError(error)) {
      throw error;
    }

    const recovered = await findTwilioContentByFriendlyName(
      options,
      friendlyName
    );
    if (!recovered?.sid) {
      throw error;
    }

    cacheContentSid(cacheKey, recovered.sid);
    return recovered;
  }
}

export async function createTwilioContent(
  options: CreateTwilioContentOptions
): Promise<TwilioContentResource> {
  const accountSid = await resolveTwilioCredential(
    options.credentials?.accountSid,
    "TWILIO_ACCOUNT_SID"
  );
  const authToken = await resolveTwilioCredential(
    options.credentials?.authToken,
    "TWILIO_AUTH_TOKEN"
  );

  const url = new URL("/v1/Content", contentBaseUrl(options));

  const request = options.fetch ?? fetch;
  const response = await request(url, {
    body: JSON.stringify(options.contentBody),
    headers: {
      authorization: `Basic ${encodeBase64Utf8(`${accountSid}:${authToken}`)}`,
      "content-type": "application/json",
    },
    method: "POST",
  });

  const body = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = body;
  }

  if (!response.ok) {
    throw new TwilioContentApiError(
      `Content API returned HTTP ${response.status}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`,
      response.status,
      parsed
    );
  }

  return parsed as TwilioContentResource;
}

class TwilioContentApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "TwilioContentApiError";
    this.status = status;
    this.body = body;
  }
}

function isDuplicateFriendlyNameError(error: unknown): boolean {
  if (!(error instanceof TwilioContentApiError)) {
    return false;
  }
  if (error.status === 409) {
    return true;
  }
  const message =
    typeof error.body === "object" &&
    error.body !== null &&
    "message" in error.body &&
    typeof error.body.message === "string"
      ? error.body.message.toLowerCase()
      : error.message.toLowerCase();
  return message.includes("friendly") && message.includes("exist");
}

async function findTwilioContentByFriendlyName(
  options: CreateTwilioContentOptions,
  friendlyName: string
): Promise<TwilioContentResource | null> {
  const accountSid = await resolveTwilioCredential(
    options.credentials?.accountSid,
    "TWILIO_ACCOUNT_SID"
  );
  const authToken = await resolveTwilioCredential(
    options.credentials?.authToken,
    "TWILIO_AUTH_TOKEN"
  );

  let nextUrl: URL | string | null = new URL(
    "/v1/Content",
    contentBaseUrl(options)
  );
  nextUrl.searchParams.set("PageSize", String(CONTENT_LIST_PAGE_SIZE));

  const request = options.fetch ?? fetch;
  const authorization = `Basic ${encodeBase64Utf8(`${accountSid}:${authToken}`)}`;

  // The Content API cannot filter by FriendlyName, so cap how much of the
  // library one send is allowed to page through.
  let pages = 0;
  while (nextUrl && pages < CONTENT_LOOKUP_MAX_PAGES) {
    pages += 1;
    const response = await request(nextUrl, {
      headers: { authorization },
      method: "GET",
    });

    const body = await response.text();
    let parsed: TwilioContentListResponse;
    try {
      parsed = JSON.parse(body) as TwilioContentListResponse;
    } catch {
      return null;
    }

    if (!response.ok) {
      return null;
    }

    const match = parsed.contents?.find(
      (content) => content.friendly_name === friendlyName
    );
    if (match) {
      return match;
    }

    nextUrl = parsed.meta?.next_page_url ?? null;
  }

  return null;
}
