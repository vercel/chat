export type TwilioCredential = string | (() => Promise<string> | string);
export type TwilioFetch = typeof fetch;

export interface TwilioCredentials {
  accountSid?: TwilioCredential;
  authToken?: TwilioCredential;
}

export type TwilioFormValue =
  | boolean
  | number
  | readonly string[]
  | string
  | null
  | undefined;

export type TwilioFormFields = Readonly<Record<string, TwilioFormValue>>;

export interface TwilioApiOptions {
  apiBaseUrl?: string;
  apiUrl?: string;
  credentials?: TwilioCredentials;
  fetch?: TwilioFetch;
}

export interface TwilioApiResponse {
  body: unknown;
  ok: boolean;
  status: number;
}

export interface TwilioMessageResource {
  account_sid?: string;
  body?: string | null;
  date_created?: string | null;
  date_sent?: string | null;
  date_updated?: string | null;
  direction?: string;
  error_code?: number | null;
  error_message?: string | null;
  from?: string | null;
  messaging_service_sid?: string | null;
  num_media?: string;
  sid: string;
  status?: string;
  to?: string | null;
  uri?: string;
}

export interface TwilioCallResource {
  account_sid?: string;
  answered_by?: string | null;
  caller_name?: string | null;
  date_created?: string | null;
  date_updated?: string | null;
  direction?: string;
  duration?: string | null;
  end_time?: string | null;
  from?: string | null;
  parent_call_sid?: string | null;
  sid: string;
  start_time?: string | null;
  status?: string;
  to?: string | null;
  uri?: string;
}

export interface SendTwilioMessageOptions extends TwilioApiOptions {
  body?: string;
  from?: string;
  mediaUrl?: readonly string[] | string;
  messagingServiceSid?: string;
  statusCallbackUrl?: string;
  to: string;
}

export interface FetchTwilioMessageOptions extends TwilioApiOptions {
  messageSid: string;
}

export interface DeleteTwilioMessageOptions extends TwilioApiOptions {
  messageSid: string;
}

export interface UpdateTwilioCallOptions extends TwilioApiOptions {
  callSid: string;
  method?: "GET" | "POST";
  status?: "canceled" | "completed";
  twiml?: string;
  url?: string;
}

export interface FetchTwilioMediaOptions extends TwilioApiOptions {
  url: string;
}

export interface ListTwilioMessagesOptions extends TwilioApiOptions {
  from?: string;
  limit?: number;
  pageSize?: number;
  to?: string;
}

export interface CallTwilioApiOptions extends TwilioApiOptions {
  body?: TwilioFormFields | URLSearchParams;
  method?: "DELETE" | "GET" | "POST";
  path: string;
  search?: TwilioFormFields | URLSearchParams;
}

export class TwilioApiError extends Error {
  body: unknown;
  status: number;

  constructor(message: string, options: { body: unknown; status: number }) {
    super(message);
    this.name = "TwilioApiError";
    this.body = options.body;
    this.status = options.status;
  }
}

const DEFAULT_API_URL = "https://api.twilio.com";

export async function resolveTwilioCredential(
  value: TwilioCredential | undefined,
  envName: string
): Promise<string> {
  const source = value ?? process.env[envName];
  if (!source) {
    throw new TwilioApiError(`${envName} is required`, {
      body: null,
      status: 0,
    });
  }
  return typeof source === "function" ? await source() : source;
}

export async function callTwilioApi(
  pathOrOptions: CallTwilioApiOptions | string,
  options: Omit<CallTwilioApiOptions, "path"> = {}
): Promise<TwilioApiResponse> {
  const requestOptions =
    typeof pathOrOptions === "string"
      ? { ...options, path: pathOrOptions }
      : pathOrOptions;
  const accountSid = await resolveTwilioCredential(
    requestOptions.credentials?.accountSid,
    "TWILIO_ACCOUNT_SID"
  );
  const authToken = await resolveTwilioCredential(
    requestOptions.credentials?.authToken,
    "TWILIO_AUTH_TOKEN"
  );
  const url = new URL(
    requestOptions.path,
    requestOptions.apiUrl ?? requestOptions.apiBaseUrl ?? DEFAULT_API_URL
  );
  for (const [key, value] of formParams(requestOptions.search) ?? []) {
    url.searchParams.append(key, value);
  }
  const body = formParams(requestOptions.body);
  const request = requestOptions.fetch ?? fetch;
  const response = await request(url, {
    body,
    headers: {
      authorization: twilioAuthorization(accountSid, authToken),
      ...(body
        ? { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" }
        : {}),
    },
    method: requestOptions.method ?? "POST",
  });
  const responseBody = await parseTwilioResponse(response);
  if (!response.ok) {
    throw new TwilioApiError(`Twilio API returned HTTP ${response.status}`, {
      body: responseBody,
      status: response.status,
    });
  }
  return {
    body: responseBody,
    ok: response.ok,
    status: response.status,
  };
}

export async function sendTwilioMessage(
  options: SendTwilioMessageOptions
): Promise<TwilioMessageResource> {
  const accountSid = await resolveTwilioCredential(
    options.credentials?.accountSid,
    "TWILIO_ACCOUNT_SID"
  );
  const mediaUrls = arrayValue(options.mediaUrl);
  if (!options.body && mediaUrls.length === 0) {
    throw new TypeError("body or mediaUrl is required");
  }
  if (!(options.from || options.messagingServiceSid)) {
    throw new TypeError("from or messagingServiceSid is required");
  }
  const body = encodeTwilioForm({
    Body: options.body,
    From: options.from,
    MediaUrl: mediaUrls,
    MessagingServiceSid: options.messagingServiceSid,
    StatusCallback: options.statusCallbackUrl,
    To: options.to,
  });
  const response = await callTwilioApi(
    `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    { ...options, body }
  );
  return response.body as TwilioMessageResource;
}

export async function fetchTwilioMessage(
  options: FetchTwilioMessageOptions
): Promise<TwilioMessageResource> {
  const accountSid = await resolveTwilioCredential(
    options.credentials?.accountSid,
    "TWILIO_ACCOUNT_SID"
  );
  const response = await callTwilioApi(
    `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages/${encodeURIComponent(
      options.messageSid
    )}.json`,
    { ...options, method: "GET" }
  );
  return response.body as TwilioMessageResource;
}

export async function deleteTwilioMessage(
  options: DeleteTwilioMessageOptions
): Promise<void> {
  const accountSid = await resolveTwilioCredential(
    options.credentials?.accountSid,
    "TWILIO_ACCOUNT_SID"
  );
  await callTwilioApi(
    `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages/${encodeURIComponent(
      options.messageSid
    )}.json`,
    { ...options, method: "DELETE" }
  );
}

export async function updateTwilioCall(
  options: UpdateTwilioCallOptions
): Promise<TwilioCallResource> {
  const accountSid = await resolveTwilioCredential(
    options.credentials?.accountSid,
    "TWILIO_ACCOUNT_SID"
  );
  if (!(options.twiml || options.url || options.status)) {
    throw new TypeError("twiml, url, or status is required");
  }
  if (options.twiml && options.url) {
    throw new TypeError("twiml and url are mutually exclusive");
  }
  const body = encodeTwilioForm({
    Method: options.method,
    Status: options.status,
    Twiml: options.twiml,
    Url: options.url,
  });
  const response = await callTwilioApi(
    `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls/${encodeURIComponent(
      options.callSid
    )}.json`,
    { ...options, body }
  );
  return response.body as TwilioCallResource;
}

export async function fetchTwilioMedia(
  options: FetchTwilioMediaOptions
): Promise<ArrayBuffer> {
  const accountSid = await resolveTwilioCredential(
    options.credentials?.accountSid,
    "TWILIO_ACCOUNT_SID"
  );
  const authToken = await resolveTwilioCredential(
    options.credentials?.authToken,
    "TWILIO_AUTH_TOKEN"
  );
  const request = options.fetch ?? fetch;
  const response = await request(options.url, {
    headers: { authorization: twilioAuthorization(accountSid, authToken) },
    method: "GET",
  });
  if (!response.ok) {
    throw new TwilioApiError(`Twilio API returned HTTP ${response.status}`, {
      body: await parseTwilioResponse(response),
      status: response.status,
    });
  }
  return response.arrayBuffer();
}

export async function listTwilioMessages(
  options: ListTwilioMessagesOptions = {}
): Promise<TwilioMessageResource[]> {
  const accountSid = await resolveTwilioCredential(
    options.credentials?.accountSid,
    "TWILIO_ACCOUNT_SID"
  );
  const search = encodeTwilioForm({
    From: options.from,
    PageSize: options.pageSize,
    To: options.to,
  });
  const response = await callTwilioApi(
    `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    { ...options, method: "GET", search }
  );
  const body = response.body as { messages?: TwilioMessageResource[] };
  return (body.messages ?? []).slice(0, options.limit);
}

export function encodeTwilioForm(fields: TwilioFormFields): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
      continue;
    }
    params.set(key, String(value));
  }
  return params;
}

function formParams(
  fields: TwilioFormFields | URLSearchParams | undefined
): URLSearchParams | undefined {
  if (fields === undefined) {
    return undefined;
  }
  return fields instanceof URLSearchParams ? fields : encodeTwilioForm(fields);
}

function twilioAuthorization(accountSid: string, authToken: string): string {
  return `Basic ${btoa(`${accountSid}:${authToken}`)}`;
}

function arrayValue(value: readonly string[] | string | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return typeof value === "string" ? [value] : [...value];
}

async function parseTwilioResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
