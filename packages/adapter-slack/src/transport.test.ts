import type { IncomingMessage } from "node:http";
import { Agent } from "node:https";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import type { AttachmentTransport } from "@chat-adapter/shared";
import { createMockChatInstance, mockLogger } from "@chat-adapter/tests";
import { SocketModeClient } from "@slack/socket-mode";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSlackAdapter,
  SlackAdapter,
  type SlackAdapterConfig,
} from "./index";

vi.mock("@slack/socket-mode", () => ({
  SocketModeClient: vi.fn(
    class {
      start = vi.fn(async () => ({}));
      disconnect = vi.fn(async () => undefined);
      on = vi.fn();
    }
  ),
}));

class InspectableSlackAdapter extends SlackAdapter {
  get defaultClient() {
    return this._client;
  }
  async forward() {
    await this.forwardSocketEvent("https://app.example/webhook", {
      type: "socket_event",
      eventType: "events_api",
      body: { event: { type: "message" } },
      timestamp: 123,
    });
  }
}

function response(
  body = Buffer.from("file"),
  headers = {},
  statusCode = 200
): IncomingMessage {
  return Object.assign(Readable.from([body]), {
    headers,
    statusCode,
    statusMessage: "fixture",
  }) as IncomingMessage;
}
const auth = {
  botToken: "xoxb-test",
  signingSecret: "secret",
  logger: mockLogger,
};
const fileEvent = {
  type: "message",
  user: "U123",
  channel: "C123",
  text: "file",
  ts: "1.1",
  files: [
    {
      id: "F123",
      name: "file.pdf",
      mimetype: "application/pdf",
      url_private: "https://files.slack.com/file.pdf",
    },
  ],
};
function ephemeralId(url = "https://hooks.slack.com/respond") {
  return `ephemeral:1.1:${btoa(JSON.stringify({ responseUrl: url, userId: "U123" }))}`;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("outbound transports", () => {
  it("keeps the agent on default, rotated, and scoped WebClients without mutating headers", async () => {
    const agent = new Agent();
    const headers = Object.freeze({ "X-Test": "value" });
    let token = "xoxb-first";
    const adapter = new InspectableSlackAdapter({
      ...auth,
      botToken: () => token,
      webClientOptions: { agent, headers },
    });
    const clients = [adapter.defaultClient, adapter.webClient];
    token = "xoxb-second";
    clients.push(adapter.webClient);
    await adapter.withBotToken("xoxb-scoped", () => {
      clients.push(adapter.webClient);
    });
    for (const client of clients) {
      const defaults = (
        client as unknown as {
          axios: { defaults: { httpAgent: unknown; httpsAgent: unknown } };
        }
      ).axios.defaults;
      expect(defaults.httpAgent).toBe(agent);
      expect(defaults.httpsAgent).toBe(agent);
    }
    expect(new Set(clients).size).toBe(4);
    expect(headers).toEqual({ "X-Test": "value" });
    agent.destroy();
  });

  it("passes only a fresh agent option to persistent and transient Socket Mode clients", async () => {
    const agent = new Agent();
    const webClientOptions = Object.freeze({
      agent,
      headers: { Authorization: "do-not-forward" },
      timeout: 42,
    });
    const adapter = createSlackAdapter({
      ...auth,
      appToken: "xapp-test",
      mode: "socket",
      webClientOptions,
    });
    vi.spyOn(
      (
        adapter as unknown as {
          _client: InspectableSlackAdapter["defaultClient"];
        }
      )._client.auth,
      "test"
    ).mockResolvedValue({ ok: true, user_id: "U_BOT" });
    await adapter.initialize(createMockChatInstance());
    let pending: Promise<unknown> | undefined;
    await adapter.startSocketModeListener(
      {
        waitUntil: (promise) => {
          pending = promise;
        },
      },
      1
    );
    await pending;
    const calls = vi.mocked(SocketModeClient).mock.calls.slice(-2);
    for (const [options] of calls) {
      expect(options).toEqual({
        appToken: "xapp-test",
        clientOptions: { agent },
      });
      expect(options?.clientOptions).not.toBe(webClientOptions);
    }
    expect(calls[0][0]?.clientOptions).not.toBe(calls[1][0]?.clientOptions);
    expect(webClientOptions).not.toHaveProperty("retryConfig");
    await adapter.disconnect();
    agent.destroy();
  });

  it.each([
    createSlackAdapter,
    (config: SlackAdapterConfig) => new SlackAdapter(config),
  ])("uses configured fetch for response replacements and deletions", async (create) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => new Response("ok"));
    const globalFetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected global fetch"));
    const adapter = create({ ...auth, fetch });
    await adapter.editMessage("slack:C123:1.1", ephemeralId(), "updated");
    await adapter.deleteMessage("slack:C123:1.1", ephemeralId());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject({
      replace_original: true,
      text: "updated",
    });
    expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toMatchObject({
      delete_original: true,
    });
    expect(fetch.mock.calls[0][1]?.method).toBe("POST");
    await expect(
      adapter.deleteMessage(
        "slack:C123:1.1",
        ephemeralId("https://evil.example")
      )
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("forwards socket events with the configured fetch and forwarding credential", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response("ok"));
    const globalFetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected global fetch"));
    const adapter = new InspectableSlackAdapter({
      ...auth,
      appToken: "xapp-test",
      socketForwardingSecret: "forward-secret",
      fetch,
    });
    await adapter.forward();
    expect(fetch).toHaveBeenCalledWith("https://app.example/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-slack-socket-token": "forward-secret",
      },
      body: JSON.stringify({
        type: "socket_event",
        eventType: "events_api",
        body: { event: { type: "message" } },
        timestamp: 123,
      }),
    });
    expect(globalFetch).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce(new Response("proxy failure", { status: 502 }));
    await adapter.forward();
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to forward socket event",
      expect.objectContaining({ status: 502 })
    );
  });

  it("preserves env authentication with transport-only config and resolves global fetch at request time", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-env");
    vi.stubEnv("SLACK_SIGNING_SECRET", "env-secret");
    const fileTransport = vi
      .fn<AttachmentTransport>()
      .mockImplementation(async () => response());
    const adapter = createSlackAdapter({ fileTransport, logger: mockLogger });
    await adapter.parseMessage(fileEvent).attachments?.[0].fetchData?.();
    expect(fileTransport.mock.calls[0][2]).toMatchObject({
      authorization: "Bearer xoxb-env",
    });
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));
    await adapter.deleteMessage("slack:C123:1.1", ephemeralId());
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    createSlackAdapter,
    (config: SlackAdapterConfig) => new SlackAdapter(config),
  ])("uses the configured guarded transport for lazy and rehydrated files", async (create) => {
    const fileTransport = vi
      .fn<AttachmentTransport>()
      .mockImplementation(async () => response());
    const adapter = create({ ...auth, fileTransport });
    const attachment = adapter.parseMessage(fileEvent).attachments?.[0];
    expect(attachment).toBeDefined();
    expect(fileTransport).not.toHaveBeenCalled();
    expect(await attachment?.fetchData?.()).toEqual(Buffer.from("file"));
    expect(
      await adapter
        .rehydrateAttachment({
          type: "file",
          url: "https://files.slack.com/file.pdf",
        })
        .fetchData?.()
    ).toEqual(Buffer.from("file"));
    expect(fileTransport).toHaveBeenCalledTimes(2);
    expect(fileTransport).toHaveBeenCalledWith(
      new URL("https://files.slack.com/file.pdf"),
      expect.any(AbortSignal),
      expect.objectContaining({ authorization: "Bearer xoxb-test" })
    );
  });

  it("preserves subclass overrides over the configured transport", async () => {
    const fileTransport = vi.fn<AttachmentTransport>();
    const subclassTransport = vi
      .fn<AttachmentTransport>()
      .mockImplementation(async () => response());
    class CustomAdapter extends SlackAdapter {
      protected override createFileTransport() {
        return subclassTransport;
      }
    }
    const adapter = new CustomAdapter({ ...auth, fileTransport });
    await adapter.parseMessage(fileEvent).attachments?.[0].fetchData?.();
    expect(subclassTransport).toHaveBeenCalledOnce();
    expect(fileTransport).not.toHaveBeenCalled();
  });

  it("strips Slack credentials on redirects and rejects internal redirect URLs", async () => {
    const fileTransport = vi
      .fn<AttachmentTransport>()
      .mockResolvedValueOnce(
        response(Buffer.alloc(0), { location: "https://cdn.example/file" }, 302)
      )
      .mockResolvedValueOnce(response());
    const adapter = createSlackAdapter({ ...auth, fileTransport });
    await adapter.parseMessage(fileEvent).attachments?.[0].fetchData?.();
    expect(fileTransport.mock.calls[0][2]).toHaveProperty(
      "authorization",
      "Bearer xoxb-test"
    );
    expect(fileTransport.mock.calls[1][2]).not.toHaveProperty("authorization");
    fileTransport
      .mockReset()
      .mockResolvedValueOnce(
        response(Buffer.alloc(0), { location: "https://127.0.0.1/file" }, 302)
      );
    await expect(
      adapter.parseMessage(fileEvent).attachments?.[0].fetchData?.()
    ).rejects.toThrow();
    expect(fileTransport).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "HTML login",
      () => response(Buffer.from("login"), { "content-type": "text/html" }),
    ],
    ["non-success", () => response(Buffer.from("denied"), {}, 403)],
    [
      "decoded size",
      () =>
        response(gzipSync(Buffer.alloc(26 * 1024 * 1024)), {
          "content-encoding": "gzip",
        }),
    ],
  ] as const)("keeps %s rejection with a configured transport", async (_name, result) => {
    const adapter = createSlackAdapter({
      ...auth,
      fileTransport: async () => result(),
    });
    await expect(
      adapter.parseMessage(fileEvent).attachments?.[0].fetchData?.()
    ).rejects.toThrow();
  });

  it("aborts the configured transport at the overall download deadline", async () => {
    const timeout = AbortSignal.timeout;
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => timeout(20));
    let signal: AbortSignal | undefined;
    const fileTransport: AttachmentTransport = (_url, abortSignal) => {
      signal = abortSignal;
      return new Promise((_resolve, reject) => {
        abortSignal.addEventListener(
          "abort",
          () => reject(abortSignal.reason),
          { once: true }
        );
      });
    };
    const adapter = createSlackAdapter({ ...auth, fileTransport });
    const pending = expect(
      adapter.parseMessage(fileEvent).attachments?.[0].fetchData?.()
    ).rejects.toThrow();
    await pending;
    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
    expect(signal?.aborted).toBe(true);
  });
});
