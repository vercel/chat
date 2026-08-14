import {
  AdapterRateLimitError,
  AuthenticationError,
  PermissionError,
  ValidationError,
} from "@chat-adapter/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createXSetup, signOauth1, XSetup } from "./setup";

const mockFetch = vi.fn();
const SIGNATURE = /oauth_signature="([^"]+)"/;
const OAUTH_NAMES = /(oauth_[a-z_]+)="/g;
const OAUTH_PREFIX = /^OAuth oauth_consumer_key=/;
const OAUTH_PREFIX_KEY = /^OAuth oauth_consumer_key="key"/;

function apiOk(body: unknown, status = 200): Response {
  return {
    headers: new Headers(),
    json: () => Promise.resolve(body),
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function apiError(status: number, body: unknown = {}, headers = {}): Response {
  return {
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
    ok: false,
    status,
  } as unknown as Response;
}

function createSetup(): XSetup {
  return new XSetup({
    accessToken: "token",
    accessTokenSecret: "token-secret",
    bearerToken: "bearer",
    consumerKey: "key",
    consumerSecret: "consumer-secret",
  });
}

function lastCall(): [string, RequestInit] {
  return mockFetch.mock.calls.at(-1) as [string, RequestInit];
}

function header(init: RequestInit, name: string): string {
  return (init.headers as Record<string, string>)[name];
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("signOauth1", () => {
  it("reproduces the signature from X's published example", () => {
    const url =
      "https://api.x.com/1.1/statuses/update.json?include_entities=true";

    const authorization = signOauth1(
      {
        form: {
          status: "Hello Ladies + Gentlemen, a signed OAuth request!",
        },
        method: "POST",
        nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
        timestamp: 1_318_622_958,
        url,
      },
      {
        accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
        accessTokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
        consumerKey: "xvz1evFS4wEEPTGEFPHBog",
        consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
      }
    );

    expect(authorization).toContain(
      'oauth_signature="Ls93hJiZbQ3akF3HF3x1Bz8%2FzU4%3D"'
    );
  });

  it("emits every oauth parameter in sorted order", () => {
    const authorization = signOauth1(
      { method: "GET", nonce: "n", timestamp: 1, url: "https://api.x.com/2/x" },
      {
        accessToken: "token",
        accessTokenSecret: "token-secret",
        consumerKey: "key",
        consumerSecret: "consumer-secret",
      }
    );

    const names = [...authorization.matchAll(OAUTH_NAMES)].map(
      (match) => match[1]
    );
    expect(names).toEqual([
      "oauth_consumer_key",
      "oauth_nonce",
      "oauth_signature",
      "oauth_signature_method",
      "oauth_timestamp",
      "oauth_token",
      "oauth_version",
    ]);
    expect(authorization).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(authorization).toContain('oauth_version="1.0"');
  });

  it("escapes the characters encodeURIComponent exempts", () => {
    const authorization = signOauth1(
      {
        method: "GET",
        nonce: "a!b*c'd(e)f",
        timestamp: 1,
        url: "https://api.x.com/2/x",
      },
      {
        accessToken: "token",
        accessTokenSecret: "secret",
        consumerKey: "key",
        consumerSecret: "consumer-secret",
      }
    );

    expect(authorization).toContain('oauth_nonce="a%21b%2Ac%27d%28e%29f"');
  });

  it("signs a space as %20, never as a plus", () => {
    const authorization = signOauth1(
      {
        method: "GET",
        nonce: "two words",
        timestamp: 1,
        url: "https://api.x.com/2/x",
      },
      {
        accessToken: "token",
        accessTokenSecret: "secret",
        consumerKey: "key",
        consumerSecret: "consumer-secret",
      }
    );

    expect(authorization).toContain('oauth_nonce="two%20words"');
  });

  it("signs the query string, and is otherwise deterministic", () => {
    const credentials = {
      accessToken: "token",
      accessTokenSecret: "token-secret",
      consumerKey: "key",
      consumerSecret: "consumer-secret",
    };
    const pinned = { method: "GET", nonce: "n", timestamp: 1 };

    const plain = signOauth1(
      { ...pinned, url: "https://api.x.com/2/activity/subscriptions" },
      credentials
    );
    const queried = signOauth1(
      { ...pinned, url: "https://api.x.com/2/activity/subscriptions?tag=a" },
      credentials
    );
    const repeat = signOauth1(
      { ...pinned, url: "https://api.x.com/2/activity/subscriptions" },
      credentials
    );

    expect(plain.match(SIGNATURE)?.[1]).not.toBe(queried.match(SIGNATURE)?.[1]);
    expect(plain).toBe(repeat);
  });

  it("sorts encoded non-ASCII parameters by byte order", () => {
    const authorization = signOauth1(
      {
        method: "GET",
        nonce: "n",
        timestamp: 1,
        url: "https://api.x.com/2/activity/subscriptions?%C3%A9=one&-=two",
      },
      {
        accessToken: "token",
        accessTokenSecret: "token-secret",
        consumerKey: "key",
        consumerSecret: "consumer-secret",
      }
    );

    expect(authorization).toContain(
      'oauth_signature="0y5BsT04fI4rrD6YaL7xm5sb7Cg%3D"'
    );
  });

  it("generates a distinct nonce per call", () => {
    const credentials = {
      accessToken: "token",
      accessTokenSecret: "secret",
      consumerKey: "key",
      consumerSecret: "consumer-secret",
    };
    const request = { method: "GET", url: "https://api.x.com/2/x" };

    expect(signOauth1(request, credentials)).not.toBe(
      signOauth1(request, credentials)
    );
  });
});

describe("webhooks", () => {
  it("registers a webhook with the bearer token", async () => {
    mockFetch.mockResolvedValueOnce(
      apiOk({ data: { id: "17", url: "https://example.com/x", valid: true } })
    );

    const webhook = await createSetup().registerWebhook(
      "https://example.com/x"
    );

    const [url, init] = lastCall();
    expect(url).toBe("https://api.x.com/2/webhooks");
    expect(init.method).toBe("POST");
    expect(header(init, "Authorization")).toBe("Bearer bearer");
    expect(JSON.parse(init.body as string)).toEqual({
      url: "https://example.com/x",
    });
    expect(webhook.id).toBe("17");
  });

  it("rejects an empty webhook url before calling the API", async () => {
    await expect(createSetup().registerWebhook("  ")).rejects.toThrow(
      ValidationError
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("lists webhooks and defaults to an empty array", async () => {
    mockFetch.mockResolvedValueOnce(apiOk({}));
    expect(await createSetup().listWebhooks()).toEqual([]);
    expect(lastCall()[1].method).toBe("GET");
  });

  it("validates a webhook with PUT", async () => {
    mockFetch.mockResolvedValueOnce(apiOk({ data: { valid: true } }));
    await createSetup().validateWebhook("17");

    const [url, init] = lastCall();
    expect(url).toBe("https://api.x.com/2/webhooks/17");
    expect(init.method).toBe("PUT");
  });

  it("deletes a webhook", async () => {
    mockFetch.mockResolvedValueOnce(apiOk({ data: {} }));
    await createSetup().deleteWebhook("17");

    const [url, init] = lastCall();
    expect(url).toBe("https://api.x.com/2/webhooks/17");
    expect(init.method).toBe("DELETE");
  });

  it("tolerates an empty body on delete", async () => {
    mockFetch.mockResolvedValueOnce({
      headers: new Headers(),
      json: () => Promise.reject(new Error("Unexpected end of JSON input")),
      ok: true,
      status: 204,
    } as unknown as Response);

    await expect(createSetup().deleteWebhook("17")).resolves.toBeUndefined();
  });

  it("reports a missing payload where one is required", async () => {
    mockFetch.mockResolvedValueOnce({
      headers: new Headers(),
      json: () => Promise.reject(new Error("Unexpected end of JSON input")),
      ok: true,
      status: 200,
    } as unknown as Response);

    await expect(
      createSetup().registerWebhook("https://example.com/x")
    ).rejects.toThrow("no data for register webhook");
  });

  it("requires a bearer token", async () => {
    const setup = new XSetup({ consumerKey: "key" });
    await expect(setup.listWebhooks()).rejects.toThrow(ValidationError);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("subscriptions", () => {
  it("signs subscribe with OAuth 1.0a, not the bearer token", async () => {
    mockFetch.mockResolvedValueOnce(
      apiOk({
        data: { event_type: "post.mention.create", subscription_id: "9" },
      })
    );

    await createSetup().createSubscription({
      filter: { user_id: "111" },
      webhookId: "17",
    });

    const [url, init] = lastCall();
    expect(url).toBe("https://api.x.com/2/activity/subscriptions");
    expect(header(init, "Authorization")).toMatch(OAUTH_PREFIX);
    expect(header(init, "Authorization")).not.toContain("Bearer");
    expect(JSON.parse(init.body as string)).toEqual({
      event_type: "post.mention.create",
      filter: { user_id: "111" },
      webhook_id: "17",
    });
  });

  it("defaults the filter to the bot account from X_USER_ID", async () => {
    vi.stubEnv("X_USER_ID", "222");
    mockFetch.mockResolvedValueOnce(apiOk({ data: { subscription_id: "9" } }));

    await createSetup().createSubscription({ webhookId: "17" });

    expect(JSON.parse(lastCall()[1].body as string).filter).toEqual({
      user_id: "222",
    });
  });

  it("throws when no filter is available", async () => {
    vi.stubEnv("X_USER_ID", "");
    await expect(createSetup().createSubscription()).rejects.toThrow(
      ValidationError
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("falls back to the OAuth 2.0 user token without OAuth 1.0a", async () => {
    mockFetch.mockResolvedValueOnce(
      apiOk({ data: { subscription: { subscription_id: "9" } } })
    );
    const setup = new XSetup({
      bearerToken: "bearer",
      userAccessToken: "user-token",
    });

    await setup.createSubscription({ filter: { user_id: "111" } });

    expect(header(lastCall()[1], "Authorization")).toBe("Bearer user-token");
  });

  it("prefers OAuth 1.0a over the user token when both are set", async () => {
    mockFetch.mockResolvedValueOnce(
      apiOk({ data: { subscription: { subscription_id: "9" } } })
    );
    const setup = new XSetup({
      accessToken: "token",
      accessTokenSecret: "token-secret",
      consumerKey: "key",
      consumerSecret: "consumer-secret",
      userAccessToken: "user-token",
    });

    await setup.createSubscription({ filter: { user_id: "111" } });

    expect(header(lastCall()[1], "Authorization")).toMatch(OAUTH_PREFIX);
  });

  it("requires some form of user context", async () => {
    const setup = new XSetup({ bearerToken: "bearer", consumerKey: "key" });

    await expect(
      setup.createSubscription({ filter: { user_id: "111" } })
    ).rejects.toThrow(ValidationError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("unwraps the subscription nested under data.subscription", async () => {
    mockFetch.mockResolvedValueOnce(
      apiOk({
        data: {
          subscription: {
            event_type: "post.mention.create",
            subscription_id: "9",
          },
        },
      })
    );

    const subscription = await createSetup().createSubscription({
      filter: { user_id: "111" },
    });

    expect(subscription.subscription_id).toBe("9");
  });

  it("accepts a subscription returned flat under data", async () => {
    mockFetch.mockResolvedValueOnce(
      apiOk({
        data: { event_type: "post.mention.create", subscription_id: "9" },
      })
    );

    const subscription = await createSetup().createSubscription({
      filter: { user_id: "111" },
    });

    expect(subscription.subscription_id).toBe("9");
  });

  it("throws when neither shape carries a subscription id", async () => {
    mockFetch.mockResolvedValueOnce(apiOk({ data: { subscription: {} } }));

    await expect(
      createSetup().createSubscription({ filter: { user_id: "111" } })
    ).rejects.toThrow("no subscription for create subscription");
  });

  it("sends the JSON body unsigned, so subscribe still authenticates", async () => {
    mockFetch.mockResolvedValue(apiOk({ data: { subscription_id: "9" } }));
    const setup = createSetup();

    await setup.createSubscription({ filter: { user_id: "111" } });
    const first = header(lastCall()[1], "Authorization");
    await setup.createSubscription({ filter: { user_id: "999" } });
    const second = header(lastCall()[1], "Authorization");

    for (const value of [first, second]) {
      expect(value).toMatch(OAUTH_PREFIX_KEY);
      expect(value).toContain("oauth_signature=");
    }
  });

  it("lists subscriptions with the bearer token", async () => {
    mockFetch.mockResolvedValueOnce(
      apiOk({
        data: [{ event_type: "post.mention.create", subscription_id: "9" }],
      })
    );

    const subscriptions = await createSetup().listSubscriptions();

    expect(subscriptions).toHaveLength(1);
    expect(header(lastCall()[1], "Authorization")).toBe("Bearer bearer");
  });

  it("deletes a subscription", async () => {
    mockFetch.mockResolvedValueOnce(apiOk({ data: {} }));
    await createSetup().deleteSubscription("9");

    const [url, init] = lastCall();
    expect(url).toBe("https://api.x.com/2/activity/subscriptions/9");
    expect(init.method).toBe("DELETE");
  });
});

describe("error mapping", () => {
  it("maps 403 to PermissionError", async () => {
    mockFetch.mockResolvedValueOnce(apiError(403, { type: "about:blank" }));

    await expect(
      createSetup().createSubscription({ filter: { user_id: "111" } })
    ).rejects.toThrow(PermissionError);
  });

  it("maps 401 to AuthenticationError", async () => {
    mockFetch.mockResolvedValueOnce(apiError(401));
    await expect(createSetup().listWebhooks()).rejects.toThrow(
      AuthenticationError
    );
  });

  it("maps 429 and carries the X rate-limit reset", async () => {
    const reset = Math.floor(Date.now() / 1000) + 30;
    mockFetch.mockResolvedValueOnce(
      apiError(429, {}, { "x-rate-limit-reset": String(reset) })
    );

    const error = await createSetup()
      .listWebhooks()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AdapterRateLimitError);
    expect((error as AdapterRateLimitError).retryAfter).toBeGreaterThan(20);
    expect((error as AdapterRateLimitError).retryAfter).toBeLessThanOrEqual(30);
  });

  it("surfaces the API error detail", async () => {
    mockFetch.mockResolvedValueOnce(
      apiError(400, { errors: [{ detail: "webhook url is not reachable" }] })
    );

    await expect(
      createSetup().registerWebhook("https://example.com/x")
    ).rejects.toThrow("webhook url is not reachable");
  });

  it("wraps a network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(createSetup().listWebhooks()).rejects.toThrow(
      "Network error calling X API"
    );
  });

  it("throws when the response carries errors and no data", async () => {
    mockFetch.mockResolvedValueOnce(
      apiOk({ errors: [{ title: "Unsupported event type" }] })
    );

    await expect(
      createSetup().createSubscription({ filter: { user_id: "111" } })
    ).rejects.toThrow("Unsupported event type");
  });
});

describe("createXSetup", () => {
  it("resolves credentials from the environment", async () => {
    vi.stubEnv("X_CONSUMER_KEY", "env-key");
    vi.stubEnv("X_CONSUMER_SECRET", "env-consumer-secret");
    vi.stubEnv("X_OAUTH1_ACCESS_TOKEN", "env-token");
    vi.stubEnv("X_OAUTH1_ACCESS_TOKEN_SECRET", "env-token-secret");
    mockFetch.mockResolvedValueOnce(apiOk({ data: { subscription_id: "9" } }));

    await createXSetup().createSubscription({ filter: { user_id: "111" } });

    expect(header(lastCall()[1], "Authorization")).toContain(
      'oauth_consumer_key="env-key"'
    );
  });

  it("honours X_API_BASE_URL", async () => {
    vi.stubEnv("X_API_BASE_URL", "https://mock.local");
    vi.stubEnv("X_BEARER_TOKEN", "env-bearer");
    mockFetch.mockResolvedValueOnce(apiOk({ data: [] }));

    await createXSetup().listWebhooks();

    expect(lastCall()[0]).toBe("https://mock.local/2/webhooks");
  });

  it("prefers explicit config over the environment", async () => {
    vi.stubEnv("X_BEARER_TOKEN", "env-bearer");
    mockFetch.mockResolvedValueOnce(apiOk({ data: [] }));

    await createXSetup({ bearerToken: "explicit" }).listWebhooks();

    expect(header(lastCall()[1], "Authorization")).toBe("Bearer explicit");
  });
});
