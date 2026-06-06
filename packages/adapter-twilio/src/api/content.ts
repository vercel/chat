import { createHash } from "node:crypto";
import type { TwilioContentBody } from "../cards";
import type { TwilioApiOptions } from "./index";
import { encodeBase64Utf8, resolveTwilioCredential } from "./index";

const DEFAULT_CONTENT_API_URL = "https://content.twilio.com";
const CONTENT_LIST_PAGE_SIZE = 50;
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

export function twilioContentCacheKey(contentBody: TwilioContentBody): string {
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

export function twilioContentFriendlyName(
  contentBody: TwilioContentBody
): string {
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
  const cacheKey = twilioContentCacheKey(options.contentBody);
  const cachedSid = contentSidCache.get(cacheKey);
  if (cachedSid) {
    return {
      friendly_name: twilioContentFriendlyName(options.contentBody),
      sid: cachedSid,
    };
  }

  const friendlyName = twilioContentFriendlyName(options.contentBody);
  const contentBody: TwilioContentBody = {
    ...options.contentBody,
    friendly_name: friendlyName,
  };

  try {
    const created = await createTwilioContent({
      ...options,
      contentBody,
    });
    contentSidCache.set(cacheKey, created.sid);
    return created;
  } catch (error) {
    if (!isDuplicateFriendlyNameError(error)) {
      throw error;
    }

    const existing = await findTwilioContentByFriendlyName(
      options,
      friendlyName
    );
    if (!existing?.sid) {
      throw error;
    }

    contentSidCache.set(cacheKey, existing.sid);
    return existing;
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

  const baseUrl = options.contentApiUrl ?? DEFAULT_CONTENT_API_URL;
  const url = new URL("/v1/Content", baseUrl);

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

  const baseUrl = options.contentApiUrl ?? DEFAULT_CONTENT_API_URL;
  let nextUrl: URL | string | null = new URL("/v1/Content", baseUrl);
  nextUrl.searchParams.set("PageSize", String(CONTENT_LIST_PAGE_SIZE));

  const request = options.fetch ?? fetch;
  const authorization = `Basic ${encodeBase64Utf8(`${accountSid}:${authToken}`)}`;

  while (nextUrl) {
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
