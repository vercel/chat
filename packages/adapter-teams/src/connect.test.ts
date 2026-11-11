import { ValidationError } from "@chat-adapter/shared";
import {
  connectWebhookContract,
  createMockChatInstance,
} from "@chat-adapter/tests";
import { App } from "@microsoft/teams.apps";
import { ConsoleLogger, type WebhookOptions } from "chat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamsAdapter, type TeamsAdapterConfig } from "./index";

const logger = new ConsoleLogger("silent");
const activity = {
  id: "connect-message",
  type: "message",
  channelId: "msteams",
  serviceUrl: "https://smba.trafficmanager.net/teams/",
  from: { id: "user-1", name: "User" },
  recipient: { id: "28:test-app", name: "Bot" },
  conversation: { id: "19:channel@thread.tacv2", conversationType: "channel" },
  text: "Hello",
};

function request(body = JSON.stringify(activity)): Request {
  return new Request("https://example.com/api/webhooks/teams", {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  });
}

class TestAdapter extends TeamsAdapter {
  get sdk(): App {
    return this.app;
  }

  registerCount = 0;

  protected registerEventHandlers(): void {
    this.registerCount++;
    super.registerEventHandlers();
  }
}

function createAdapter(config: TeamsAdapterConfig = {}): TestAdapter {
  const adapter = new TestAdapter({
    appId: "test-app",
    token: () => "unused-token",
    logger,
    ...config,
  });
  if (typeof config.appId !== "function") {
    vi.spyOn(adapter.sdk.api.users, "getToken").mockRejectedValue(
      new Error("No user token")
    );
  }
  return adapter;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

connectWebhookContract({
  name: "teams",
  createAdapter: ({ webhookVerifier }) => createAdapter({ webhookVerifier }),
  createAdapterWithSecretAndVerifier: ({ webhookVerifier }) =>
    createAdapter({ appPassword: "ignored", webhookVerifier }),
  makeWebhookRequest: () => request(),
});

describe("Connect webhook dispatch", () => {
  it("verifies the exact raw body before parsing or routing", async () => {
    const webhookVerifier = vi.fn(async () => false);
    const adapter = createAdapter({ webhookVerifier });
    const chat = createMockChatInstance();
    await adapter.initialize(chat);
    const incoming = request(" invalid json ");
    expect((await adapter.handleWebhook(incoming)).status).toBe(401);
    expect(webhookVerifier).toHaveBeenCalledWith(incoming, " invalid json ");
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("returns 400 for verified invalid JSON", async () => {
    const adapter = createAdapter({ webhookVerifier: () => true });
    await adapter.initialize(createMockChatInstance());
    expect((await adapter.handleWebhook(request("invalid json"))).status).toBe(
      400
    );
  });

  it("rejects asynchronously failed verification before activity processing", async () => {
    const adapter = createAdapter({
      webhookVerifier: async () => {
        throw new Error("invalid");
      },
    });
    const chat = createMockChatInstance();
    await adapter.initialize(chat);
    expect((await adapter.handleWebhook(request())).status).toBe(401);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("retains native authentication when no verifier is configured", async () => {
    const adapter = createAdapter();
    const chat = createMockChatInstance();
    await adapter.initialize(chat);
    expect((await adapter.handleWebhook(request())).status).toBe(401);
    const invalidToken = request();
    invalidToken.headers.set("authorization", "Bearer invalid");
    expect((await adapter.handleWebhook(invalidToken)).status).toBe(401);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("routes verified messages with their webhook options", async () => {
    const adapter = createAdapter({
      webhookVerifier: () => ({ verified: true }),
    });
    const chat = createMockChatInstance();
    await adapter.initialize(chat);
    const options = { waitUntil: vi.fn() };
    expect((await adapter.handleWebhook(request(), options)).status).toBe(200);
    expect(chat.processMessage).toHaveBeenCalledWith(
      adapter,
      expect.any(String),
      expect.objectContaining({ text: "Hello" }),
      options
    );
  });

  it("retains native DM streaming and waitUntil dispatch", async () => {
    const adapter = createAdapter({ webhookVerifier: () => true });
    const chat = createMockChatInstance();
    vi.mocked(chat.processMessage).mockImplementation(
      (_adapter, _thread, _message, options?: WebhookOptions) => {
        options?.waitUntil?.(Promise.resolve());
      }
    );
    await adapter.initialize(chat);
    const waitUntil = vi.fn();
    const response = await adapter.handleWebhook(
      request(
        JSON.stringify({
          ...activity,
          conversation: { id: "a:personal", conversationType: "personal" },
        })
      ),
      { waitUntil }
    );
    expect(response.status).toBe(200);
    expect(chat.processMessage).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledOnce();
  });

  it("preserves invoke responses from the SDK route", async () => {
    const adapter = createAdapter({ webhookVerifier: () => true });
    await adapter.initialize(createMockChatInstance());
    const response = await adapter.handleWebhook(
      request(
        JSON.stringify({
          ...activity,
          type: "invoke",
          name: "adaptiveCard/action",
          value: { action: { type: "Action.Execute", verb: "test", data: {} } },
        })
      )
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      statusCode: 200,
      type: "application/vnd.microsoft.activity.message",
      value: "OK",
    });
  });
});

describe("lazy Teams identity", () => {
  it("captures authentication config before lazy initialization", async () => {
    const config: TeamsAdapterConfig = {
      appId: async () => "lazy-app",
      token: () => "unused-token",
      logger,
    };
    const adapter = new TestAdapter(config);
    config.webhookVerifier = () => true;
    await adapter.initialize(createMockChatInstance());
    expect((await adapter.handleWebhook(request())).status).toBe(401);
  });

  it("resolves once across concurrent initialization and retains bot identity", async () => {
    const appId = vi.fn(async () => "lazy-app");
    const adapter = createAdapter({ appId });
    expect(appId).not.toHaveBeenCalled();
    expect(adapter.botUserId).toBeUndefined();
    expect(() => adapter.sdk).toThrow(ValidationError);
    expect(adapter.parseMessage(activity).author.isMe).toBe(false);
    const chat = createMockChatInstance();
    await Promise.all([adapter.initialize(chat), adapter.initialize(chat)]);
    await adapter.initialize(chat);
    expect(appId).toHaveBeenCalledOnce();
    expect(adapter.botUserId).toBe("28:lazy-app");
    expect(adapter.sdk.id).toBe("lazy-app");
    expect(adapter.registerCount).toBe(1);
    expect(
      adapter.parseMessage({ ...activity, from: { id: "28:LAZY-APP" } }).author
        .isMe
    ).toBe(true);
  });

  it("supports synchronous resolvers", async () => {
    const adapter = createAdapter({ appId: () => "sync-app" });
    await adapter.initialize(createMockChatInstance());
    expect(adapter.botUserId).toBe("28:sync-app");
  });

  it("retries a failed resolver through initialize", async () => {
    const appId = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("metadata unavailable"))
      .mockResolvedValue("retry-app");
    const adapter = createAdapter({ appId });
    const chat = createMockChatInstance();
    await expect(adapter.initialize(chat)).rejects.toThrow(
      "metadata unavailable"
    );
    await adapter.initialize(chat);
    expect(appId).toHaveBeenCalledTimes(2);
    expect(adapter.botUserId).toBe("28:retry-app");
  });

  it.each([
    "",
    "   ",
    undefined,
    123,
  ])("rejects invalid resolved identity %s", async (value) => {
    const adapter = createAdapter({ appId: () => value as string });
    await expect(adapter.initialize(createMockChatInstance())).rejects.toThrow(
      "appId resolver must return a nonempty string"
    );
  });

  it("retries SDK initialization without repeating metadata or handlers", async () => {
    const initialize = vi
      .spyOn(App.prototype, "initialize")
      .mockRejectedValueOnce(new Error("SDK unavailable"));
    const appId = vi.fn(async () => "retry-app");
    const adapter = createAdapter({ appId });
    const chat = createMockChatInstance();
    await expect(adapter.initialize(chat)).rejects.toThrow("SDK unavailable");
    await adapter.initialize(chat);
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(appId).toHaveBeenCalledOnce();
    expect(adapter.registerCount).toBe(1);
  });

  it("preserves immediate bot identity for string and environment configuration", () => {
    expect(createAdapter().botUserId).toBe("28:test-app");
    vi.stubEnv("TEAMS_APP_ID", "env-app");
    expect(createAdapter({ appId: undefined }).botUserId).toBe("28:env-app");
  });

  it("reports initialization required for lazy outbound operations", async () => {
    const adapter = createAdapter({ appId: async () => "lazy-app" });
    await expect(adapter.fetchThread("unused")).rejects.toThrow(
      "Ensure chat.initialize() has completed"
    );
  });
});

describe("custom token precedence", () => {
  it("uses custom Bot Framework and Graph tokens despite configured and environment secrets", async () => {
    vi.stubEnv("CLIENT_SECRET", "generic-secret");
    vi.stubEnv("TEAMS_APP_PASSWORD", "teams-secret");
    const jwt = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
    const token = vi.fn(() => jwt);
    const adapter = createAdapter({
      appPassword: "explicit-secret",
      federated: { clientId: "identity" },
      token,
    });
    expect(adapter.sdk.credentials).toMatchObject({
      clientId: "test-app",
      token,
    });
    const sdk = adapter.sdk as unknown as {
      getBotToken(): Promise<unknown>;
      getAppGraphToken(tenantId?: string): Promise<unknown>;
    };
    await sdk.getBotToken();
    await sdk.getAppGraphToken("graph-tenant");
    expect(token).toHaveBeenCalledWith(
      "https://api.botframework.com/.default",
      expect.any(String)
    );
    expect(token).toHaveBeenCalledWith(
      "https://graph.microsoft.com/.default",
      "graph-tenant"
    );
    expect(process.env.CLIENT_SECRET).toBe("generic-secret");
    expect(process.env.TEAMS_APP_PASSWORD).toBe("teams-secret");
  });
});
