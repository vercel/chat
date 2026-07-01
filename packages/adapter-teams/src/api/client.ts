export type TeamsCredential = string | (() => Promise<string> | string);
export type TeamsFetch = typeof fetch;

export interface TeamsCredentials {
  /**
   * A pre-acquired bearer token. It must already be scoped for the API it is
   * used against: `https://api.botframework.com/.default` for the Bot Connector
   * calls in this module, or `https://graph.microsoft.com/.default` for the
   * Graph subpath. Supply `appId`/`appPassword` instead to have each subpath
   * request the correct scope automatically.
   */
  accessToken?: TeamsCredential;
  appId?: TeamsCredential;
  appPassword?: TeamsCredential;
  tenantId?: TeamsCredential;
}

export interface TeamsApiOptions {
  credentials: TeamsCredentials;
  fetch?: TeamsFetch;
}

export interface TeamsTokenOptions extends TeamsApiOptions {
  scope?: string;
  tokenUrl?: string;
}

export interface TeamsConnectorOptions extends TeamsApiOptions {
  body?: unknown;
  method?: string;
  path: string;
  serviceUrl: string;
}

export interface TeamsApiResponse<T = unknown> {
  body: T;
  ok: boolean;
  status: number;
}

export class TeamsApiError extends Error {
  body?: unknown;
  status?: number;

  constructor(
    message: string,
    options: { body?: unknown; status?: number } = {}
  ) {
    super(message);
    this.name = "TeamsApiError";
    this.body = options.body;
    this.status = options.status;
  }
}

const DEFAULT_BOT_SCOPE = "https://api.botframework.com/.default";
const DEFAULT_TENANT_ID = "botframework.com";
const LEADING_SLASH_PATTERN = /^\/+/;

export async function resolveTeamsCredential(
  credential: TeamsCredential | undefined
): Promise<string | undefined> {
  return typeof credential === "function" ? await credential() : credential;
}

export async function resolveTeamsAccessToken(
  options: TeamsTokenOptions
): Promise<string> {
  const directToken = await resolveTeamsCredential(
    options.credentials.accessToken
  );
  if (directToken) {
    return directToken;
  }

  const appId = await resolveTeamsCredential(options.credentials.appId);
  const appPassword = await resolveTeamsCredential(
    options.credentials.appPassword
  );
  const tenantId =
    (await resolveTeamsCredential(options.credentials.tenantId)) ??
    DEFAULT_TENANT_ID;

  if (!(appId && appPassword)) {
    throw new TeamsApiError(
      "Teams credentials require either accessToken or appId and appPassword"
    );
  }

  const request = options.fetch ?? fetch;
  const tokenUrl =
    options.tokenUrl ??
    `https://login.microsoftonline.com/${encodeURIComponent(
      tenantId
    )}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: appId,
    client_secret: appPassword,
    grant_type: "client_credentials",
    scope: options.scope ?? DEFAULT_BOT_SCOPE,
  });

  const response = await request(tokenUrl, {
    body,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const payload = await readResponseBody(response);

  if (!response.ok) {
    throw new TeamsApiError("Teams token request failed", {
      body: payload,
      status: response.status,
    });
  }

  const accessToken =
    payload && typeof payload === "object" && "access_token" in payload
      ? (payload.access_token as unknown)
      : undefined;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new TeamsApiError(
      "Teams token response did not include access_token",
      {
        body: payload,
        status: response.status,
      }
    );
  }

  return accessToken;
}

export async function callTeamsConnectorApi<T = unknown>(
  options: TeamsConnectorOptions
): Promise<TeamsApiResponse<T>> {
  const request = options.fetch ?? fetch;
  const token = await resolveTeamsAccessToken(options);
  const url = new URL(
    options.path.replace(LEADING_SLASH_PATTERN, ""),
    ensureTrailingSlash(options.serviceUrl)
  );

  const response = await request(url, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    method: options.method ?? "GET",
  });
  const body = await readResponseBody(response);

  if (!response.ok) {
    throw new TeamsApiError("Teams Connector API request failed", {
      body,
      status: response.status,
    });
  }

  return { body: body as T, ok: response.ok, status: response.status };
}

export async function assertTeamsOk(response: Response): Promise<void> {
  if (!response.ok) {
    throw new TeamsApiError("Teams API request failed", {
      body: await readResponseBody(response),
      status: response.status,
    });
  }
}

export async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
