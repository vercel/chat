import { createHmac, randomBytes } from "node:crypto";
import {
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
  ValidationError,
} from "@chat-adapter/shared";

const DEFAULT_API_BASE_URL = "https://api.x.com";
const DEFAULT_EVENT_TYPE = "post.mention.create";
const NONCE_BYTES = 16;
const OAUTH_RESERVED = /[!'()*]/g;

export interface XOauth1Credentials {
  accessToken: string;
  accessTokenSecret: string;
  consumerKey: string;
  consumerSecret: string;
}

export interface XOauth1Request {
  form?: Record<string, string>;
  method: string;
  nonce?: string;
  timestamp?: number;
  url: string;
}

export interface XSetupConfig {
  accessToken?: string;
  accessTokenSecret?: string;
  apiBaseUrl?: string;
  bearerToken?: string;
  consumerKey?: string;
  consumerSecret?: string;
  userAccessToken?: string;
}

export interface XWebhook {
  created_at?: string;
  id: string;
  url: string;
  valid?: boolean;
}

export interface XSubscriptionFilter {
  direction?: "inbound" | "outbound";
  keyword?: string;
  user_id?: string;
}

export interface XSubscription {
  created_at?: string;
  event_type: string;
  filter?: XSubscriptionFilter;
  subscription_id: string;
  tag?: string;
  updated_at?: string;
  webhook_id?: string;
}

export interface XSubscriptionInput {
  eventType?: string;
  filter?: XSubscriptionFilter;
  tag?: string;
  webhookId?: string;
}

interface XSetupResponse<TData> {
  data?: TData;
  errors?: { detail?: string; message?: string; title?: string }[];
}

interface XCreateSubscriptionData extends Partial<XSubscription> {
  subscription?: XSubscription;
}

function percent(value: string): string {
  return encodeURIComponent(value).replace(
    OAUTH_RESERVED,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function compare(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

export function signOauth1(
  request: XOauth1Request,
  credentials: XOauth1Credentials
): string {
  const url = new URL(request.url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_nonce: request.nonce ?? randomBytes(NONCE_BYTES).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(request.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: credentials.accessToken,
    oauth_version: "1.0",
  };

  const encoded = [
    ...Object.entries(oauth),
    ...url.searchParams,
    ...Object.entries(request.form ?? {}),
  ].map(([key, value]) => [percent(key), percent(value)] as const);
  encoded.sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1]));

  const base = [
    request.method.toUpperCase(),
    percent(`${url.origin}${url.pathname}`),
    percent(encoded.map(([key, value]) => `${key}=${value}`).join("&")),
  ].join("&");

  const key = `${percent(credentials.consumerSecret)}&${percent(credentials.accessTokenSecret)}`;
  const signed: Record<string, string> = {
    ...oauth,
    oauth_signature: createHmac("sha1", key).update(base).digest("base64"),
  };

  const header = Object.keys(signed)
    .sort(compare)
    .map((name) => `${percent(name)}="${percent(signed[name])}"`)
    .join(", ");
  return `OAuth ${header}`;
}

export class XSetup {
  private readonly apiBaseUrl: string;
  private readonly bearerToken?: string;
  private readonly credentials: Partial<XOauth1Credentials>;
  private readonly userAccessToken?: string;

  constructor(config: XSetupConfig = {}) {
    this.apiBaseUrl = config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
    this.bearerToken = config.bearerToken;
    this.userAccessToken = config.userAccessToken;
    this.credentials = {
      accessToken: config.accessToken,
      accessTokenSecret: config.accessTokenSecret,
      consumerKey: config.consumerKey,
      consumerSecret: config.consumerSecret,
    };
  }

  async registerWebhook(url: string): Promise<XWebhook> {
    if (!url.trim()) {
      throw new ValidationError("x", "Webhook url is required");
    }
    const result = await this.request<XWebhook>("POST", "/2/webhooks", {
      body: { url },
    });
    return requireData(result, "register webhook");
  }

  async listWebhooks(): Promise<XWebhook[]> {
    const result = await this.request<XWebhook[]>("GET", "/2/webhooks");
    return result.data ?? [];
  }

  async validateWebhook(webhookId: string): Promise<void> {
    await this.request("PUT", `/2/webhooks/${encodeURIComponent(webhookId)}`);
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    await this.request(
      "DELETE",
      `/2/webhooks/${encodeURIComponent(webhookId)}`
    );
  }

  async createSubscription(
    input: XSubscriptionInput = {}
  ): Promise<XSubscription> {
    const filter = input.filter ?? defaultFilter();
    if (!filter) {
      throw new ValidationError(
        "x",
        "filter is required. Pass filter.user_id or set X_USER_ID."
      );
    }

    const result = await this.request<XCreateSubscriptionData>(
      "POST",
      "/2/activity/subscriptions",
      {
        body: {
          event_type: input.eventType ?? DEFAULT_EVENT_TYPE,
          filter,
          ...(input.tag ? { tag: input.tag } : {}),
          ...(input.webhookId ? { webhook_id: input.webhookId } : {}),
        },
        userContext: true,
      }
    );
    const data = requireData(result, "create subscription");
    const subscription = data.subscription ?? (data as XSubscription);
    if (!subscription.subscription_id) {
      throw new ValidationError(
        "x",
        "X API returned no subscription for create subscription"
      );
    }
    return subscription;
  }

  async listSubscriptions(): Promise<XSubscription[]> {
    const result = await this.request<XSubscription[]>(
      "GET",
      "/2/activity/subscriptions"
    );
    return result.data ?? [];
  }

  async deleteSubscription(subscriptionId: string): Promise<void> {
    await this.request(
      "DELETE",
      `/2/activity/subscriptions/${encodeURIComponent(subscriptionId)}`
    );
  }

  private authorization(
    method: string,
    url: string,
    userContext: boolean | undefined
  ): string {
    if (userContext) {
      const oauth1 = this.oauth1();
      if (oauth1) {
        return signOauth1({ method, url }, oauth1);
      }
      if (this.userAccessToken) {
        return `Bearer ${this.userAccessToken}`;
      }
      throw new ValidationError(
        "x",
        "Subscribing needs user context. Set X_CONSUMER_KEY, X_CONSUMER_SECRET, X_OAUTH1_ACCESS_TOKEN, and X_OAUTH1_ACCESS_TOKEN_SECRET for OAuth 1.0a, or X_USER_ACCESS_TOKEN for OAuth 2.0."
      );
    }
    if (!this.bearerToken) {
      throw new ValidationError(
        "x",
        "bearerToken is required. Set X_BEARER_TOKEN or pass bearerToken."
      );
    }
    return `Bearer ${this.bearerToken}`;
  }

  private oauth1(): XOauth1Credentials | undefined {
    const { accessToken, accessTokenSecret, consumerKey, consumerSecret } =
      this.credentials;
    if (accessToken && accessTokenSecret && consumerKey && consumerSecret) {
      return { accessToken, accessTokenSecret, consumerKey, consumerSecret };
    }
    return;
  }

  private async request<TData>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    options: { body?: Record<string, unknown>; userContext?: boolean } = {}
  ): Promise<XSetupResponse<TData>> {
    const url = `${this.apiBaseUrl}${path}`;
    const init: RequestInit = {
      headers: {
        Authorization: this.authorization(method, url, options.userContext),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      method,
    };
    if (options.body) {
      init.body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      throw new NetworkError(
        "x",
        `Network error calling X API ${path}`,
        error instanceof Error ? error : undefined
      );
    }

    let data: XSetupResponse<TData> | undefined;
    try {
      data = (await response.json()) as XSetupResponse<TData>;
    } catch {
      data = undefined;
    }

    if (!response.ok) {
      throwApiError(path, response, data);
    }
    if (!data) {
      return {};
    }
    if (data.errors?.length && !data.data) {
      throw new ValidationError(
        "x",
        errorMessage(data.errors) ?? `X API ${path} failed`
      );
    }
    return data;
  }
}

export function createXSetup(config: XSetupConfig = {}): XSetup {
  return new XSetup({
    accessToken: config.accessToken ?? process.env.X_OAUTH1_ACCESS_TOKEN,
    accessTokenSecret:
      config.accessTokenSecret ?? process.env.X_OAUTH1_ACCESS_TOKEN_SECRET,
    apiBaseUrl: config.apiBaseUrl ?? process.env.X_API_BASE_URL,
    bearerToken: config.bearerToken ?? process.env.X_BEARER_TOKEN,
    consumerKey: config.consumerKey ?? process.env.X_CONSUMER_KEY,
    consumerSecret: config.consumerSecret ?? process.env.X_CONSUMER_SECRET,
    userAccessToken: config.userAccessToken ?? process.env.X_USER_ACCESS_TOKEN,
  });
}

function defaultFilter(): XSubscriptionFilter | undefined {
  const userId = process.env.X_USER_ID;
  return userId ? { user_id: userId } : undefined;
}

function requireData<TData>(
  result: XSetupResponse<TData>,
  action: string
): TData {
  if (!result.data) {
    throw new ValidationError(
      "x",
      errorMessage(result.errors) ?? `X API returned no data for ${action}`
    );
  }
  return result.data;
}

function errorMessage(
  errors: XSetupResponse<unknown>["errors"]
): string | undefined {
  if (!errors?.length) {
    return;
  }
  const parts = errors
    .map((error) => error.detail ?? error.message ?? error.title)
    .filter(Boolean);
  return parts.length > 0 ? parts.join("; ") : undefined;
}

function throwApiError(
  path: string,
  response: Response,
  data: XSetupResponse<unknown> | undefined
): never {
  const message =
    errorMessage(data?.errors) ??
    `X API ${path} failed with status ${response.status}`;

  if (response.status === 429) {
    const reset = response.headers.get("x-rate-limit-reset");
    const header = response.headers.get("retry-after");
    let retryAfter = Number.NaN;
    if (reset) {
      retryAfter = Number.parseInt(reset, 10) - Math.floor(Date.now() / 1000);
    } else if (header) {
      retryAfter = Number.parseInt(header, 10);
    }
    throw new AdapterRateLimitError(
      "x",
      Number.isNaN(retryAfter) ? undefined : Math.max(0, retryAfter)
    );
  }
  if (response.status === 401) {
    throw new AuthenticationError("x", message);
  }
  if (response.status === 403) {
    throw new PermissionError("x", `call ${path}: ${message}`);
  }
  if (response.status === 404) {
    throw new ResourceNotFoundError("x", "resource", path);
  }
  if (response.status >= 400 && response.status < 500) {
    throw new ValidationError("x", message);
  }
  throw new NetworkError("x", `${message} (status ${response.status})`);
}
