import type { TwilioContentBody } from "../cards";
import type { TwilioApiOptions } from "./index";
import { resolveTwilioCredential } from "./index";

const DEFAULT_CONTENT_API_URL = "https://content.twilio.com";

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
      authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
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
    throw new Error(
      `Content API returned HTTP ${response.status}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`
    );
  }

  return parsed as TwilioContentResource;
}
