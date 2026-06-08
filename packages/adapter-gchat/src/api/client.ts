export class GoogleChatApiError extends Error {
  readonly response: unknown;
  readonly status: number;

  constructor(message: string, status: number, response: unknown) {
    super(message);
    this.name = "GoogleChatApiError";
    this.response = response;
    this.status = status;
  }
}

export interface GoogleChatApiOptions {
  accessToken?: string | (() => Promise<string> | string);
  apiUrl?: string;
  fetch?: typeof fetch;
}

export interface GoogleChatRequestOptions extends GoogleChatApiOptions {
  body?: unknown;
  method?: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  query?: Record<string, boolean | number | string | undefined>;
}

const DEFAULT_GOOGLE_CHAT_API_URL = "https://chat.googleapis.com/v1";
const LEADING_SLASH_PATTERN = /^\//;
const TRAILING_SLASH_PATTERN = /\/$/;

export async function resolveGoogleChatAccessToken(
  options: GoogleChatApiOptions
): Promise<string> {
  if (!options.accessToken) {
    throw new Error(
      "Google Chat API accessToken is required for primitive API calls"
    );
  }

  return typeof options.accessToken === "function"
    ? await options.accessToken()
    : options.accessToken;
}

export async function callGoogleChatApi<T>(
  path: string,
  options: GoogleChatRequestOptions
): Promise<T> {
  const fetchImpl = options.fetch ?? fetch;
  const accessToken = await resolveGoogleChatAccessToken(options);
  const url = new URL(
    `${(options.apiUrl ?? DEFAULT_GOOGLE_CHAT_API_URL).replace(TRAILING_SLASH_PATTERN, "")}/${path.replace(LEADING_SLASH_PATTERN, "")}`
  );

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetchImpl(url, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
  });

  if (!response.ok) {
    const errorBody = await readResponseBody(response);
    throw new GoogleChatApiError(
      `Google Chat API request failed: ${response.status} ${response.statusText}`,
      response.status,
      errorBody
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await readResponseBody(response)) as T;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
