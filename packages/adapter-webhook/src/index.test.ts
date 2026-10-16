import { createHmac } from "node:crypto";
import { ValidationError } from "@chat-adapter/shared";
import {
  createMockChatInstance,
  createMockState,
  mockLogger,
  threadIdContract,
} from "@chat-adapter/tests";
import { Chat, type Message, NotImplementedError, type Thread } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWebhookAdapter,
  type WebhookAdapter,
  type WebhookAdapterConfig,
  type WebhookThreadId,
} from "./index";

const SECRET = "test-secret";
const UUID_PATTERN = /^[0-9a-f-]{36}$/;

interface BridgePayload {
  chatId: string;
  from: { id: string; name?: string };
  id: string;
  text: string;
  ts?: number;
}

const parseBridge: WebhookAdapterConfig["parse"] = (
  payload: BridgePayload
) => ({
  id: payload.id,
  channelId: payload.chatId,
  text: payload.text,
  author: { userId: payload.from.id, fullName: payload.from.name },
  timestamp: payload.ts,
});

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function signedRequest(
  payload: unknown,
  headers: Record<string, string> = {}
): Request {
  const body = JSON.stringify(payload);
  return new Request("https://example.com/api/webhooks/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-signature": `sha256=${sign(body)}`,
      ...headers,
    },
    body,
  });
}

function makeAdapter(
  overrides: Partial<WebhookAdapterConfig> = {}
): WebhookAdapter {
  return createWebhookAdapter({
    secret: SECRET,
    logger: mockLogger,
    parse: parseBridge,
    send: vi.fn().mockResolvedValue({ id: "sent-1", raw: { ok: true } }),
    ...overrides,
  });
}

const samplePayload: BridgePayload = {
  id: "msg-1",
  chatId: "123@c.us",
  from: { id: "user-1", name: "Ada Lovelace" },
  text: "Hello **bot**",
  ts: 1_760_000_000_000,
};

describe("createWebhookAdapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires parse and send", () => {
    expect(() =>
      createWebhookAdapter({
        secret: SECRET,
        send: vi.fn(),
      } as unknown as WebhookAdapterConfig)
    ).toThrow("parse is required");
    expect(() =>
      createWebhookAdapter({
        secret: SECRET,
        parse: parseBridge,
      } as unknown as WebhookAdapterConfig)
    ).toThrow("send is required");
  });

  it("requires a secret or a verify function", () => {
    vi.stubEnv("WEBHOOK_SECRET", undefined);
    expect(() =>
      createWebhookAdapter({ parse: parseBridge, send: vi.fn() })
    ).toThrow(ValidationError);
    expect(() =>
      createWebhookAdapter({
        parse: parseBridge,
        send: vi.fn(),
        verify: () => true,
      })
    ).not.toThrow();
  });

  it("reads the secret from WEBHOOK_SECRET", async () => {
    vi.stubEnv("WEBHOOK_SECRET", SECRET);
    const adapter = createWebhookAdapter({
      logger: mockLogger,
      parse: parseBridge,
      send: vi.fn(),
    });
    await adapter.initialize(createMockChatInstance());
    const response = await adapter.handleWebhook(signedRequest(samplePayload));
    expect(response.status).toBe(200);
  });

  it("rejects names that contain a colon", () => {
    expect(() => makeAdapter({ name: "bad:name" })).toThrow(ValidationError);
  });

  it("defaults the name to webhook", () => {
    expect(makeAdapter().name).toBe("webhook");
    expect(makeAdapter({ name: "waha" }).name).toBe("waha");
  });
});

describe("handleWebhook", () => {
  let adapter: WebhookAdapter;
  let chat: ReturnType<typeof createMockChatInstance>;

  beforeEach(async () => {
    adapter = makeAdapter();
    chat = createMockChatInstance();
    await adapter.initialize(chat);
  });

  it("processes a signed message", async () => {
    const response = await adapter.handleWebhook(signedRequest(samplePayload));

    expect(response.status).toBe(200);
    expect(chat.processMessage).toHaveBeenCalledTimes(1);
    const [calledAdapter, threadId, message] = vi.mocked(chat.processMessage)
      .mock.calls[0] as [WebhookAdapter, string, Message];
    expect(calledAdapter).toBe(adapter);
    expect(threadId).toBe(adapter.encodeThreadId({ channelId: "123@c.us" }));
    expect(message.id).toBe("msg-1");
    expect(message.threadId).toBe(threadId);
    expect(message.text).toBe("Hello **bot**");
    expect(message.formatted.type).toBe("root");
    expect(message.raw).toEqual(samplePayload);
    expect(message.author).toEqual({
      userId: "user-1",
      userName: "user-1",
      fullName: "Ada Lovelace",
      isBot: false,
      isMe: false,
    });
    expect(message.metadata.dateSent.getTime()).toBe(1_760_000_000_000);
    expect(message.isMention).toBeUndefined();
  });

  it("accepts a signature without the sha256= prefix", async () => {
    const body = JSON.stringify(samplePayload);
    const response = await adapter.handleWebhook(
      new Request("https://example.com", {
        method: "POST",
        headers: { "x-webhook-signature": sign(body) },
        body,
      })
    );
    expect(response.status).toBe(200);
  });

  it("reads the signature from a custom header", async () => {
    adapter = makeAdapter({ signatureHeader: "x-hub-signature-256" });
    await adapter.initialize(chat);
    const body = JSON.stringify(samplePayload);
    const response = await adapter.handleWebhook(
      new Request("https://example.com", {
        method: "POST",
        headers: { "x-hub-signature-256": `sha256=${sign(body)}` },
        body,
      })
    );
    expect(response.status).toBe(200);
  });

  it("rejects a missing signature", async () => {
    const response = await adapter.handleWebhook(
      new Request("https://example.com", {
        method: "POST",
        body: JSON.stringify(samplePayload),
      })
    );
    expect(response.status).toBe(401);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("rejects a signature made with another secret", async () => {
    const body = JSON.stringify(samplePayload);
    const response = await adapter.handleWebhook(
      new Request("https://example.com", {
        method: "POST",
        headers: { "x-webhook-signature": sign(body, "other") },
        body,
      })
    );
    expect(response.status).toBe(401);
  });

  it("rejects a tampered body", async () => {
    const body = JSON.stringify(samplePayload);
    const response = await adapter.handleWebhook(
      new Request("https://example.com", {
        method: "POST",
        headers: { "x-webhook-signature": sign(body) },
        body: JSON.stringify({ ...samplePayload, text: "tampered" }),
      })
    );
    expect(response.status).toBe(401);
  });

  it("uses the verify callback instead of the secret", async () => {
    const verify = vi.fn(
      (request: Request) => request.headers.get("authorization") === "Bearer t"
    );
    adapter = makeAdapter({ verify });
    await adapter.initialize(chat);

    const body = JSON.stringify(samplePayload);
    const ok = await adapter.handleWebhook(
      new Request("https://example.com", {
        method: "POST",
        headers: { authorization: "Bearer t" },
        body,
      })
    );
    const rejected = await adapter.handleWebhook(signedRequest(samplePayload));

    expect(ok.status).toBe(200);
    expect(rejected.status).toBe(401);
    expect(verify).toHaveBeenCalledWith(expect.any(Request), body);
  });

  it("rejects the request when verify throws", async () => {
    adapter = makeAdapter({
      verify: () => {
        throw new Error("boom");
      },
    });
    await adapter.initialize(chat);
    const response = await adapter.handleWebhook(signedRequest(samplePayload));
    expect(response.status).toBe(401);
  });

  it("returns 405 for non-POST requests", async () => {
    const response = await adapter.handleWebhook(
      new Request("https://example.com", { method: "GET" })
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("returns 400 for invalid JSON", async () => {
    const body = "not json";
    const response = await adapter.handleWebhook(
      new Request("https://example.com", {
        method: "POST",
        headers: { "x-webhook-signature": sign(body) },
        body,
      })
    );
    expect(response.status).toBe(400);
  });

  it("acknowledges payloads that parse to nothing", async () => {
    adapter = makeAdapter({ parse: () => null });
    await adapter.initialize(chat);
    const response = await adapter.handleWebhook(signedRequest({}));
    expect(response.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("processes every message in an array", async () => {
    adapter = makeAdapter({
      parse: async (payload: { items: BridgePayload[] }) =>
        payload.items.map((item) => ({
          id: item.id,
          channelId: item.chatId,
          threadId: "topic-1",
          text: item.text,
          author: { userId: item.from.id },
          isMention: true,
        })),
    });
    await adapter.initialize(chat);

    const response = await adapter.handleWebhook(
      signedRequest({
        items: [samplePayload, { ...samplePayload, id: "msg-2" }],
      })
    );

    expect(response.status).toBe(200);
    expect(chat.processMessage).toHaveBeenCalledTimes(2);
    const messages = vi
      .mocked(chat.processMessage)
      .mock.calls.map((call) => call[2] as Message);
    expect(messages.map((m) => m.id)).toEqual(["msg-1", "msg-2"]);
    expect(messages[0]?.isMention).toBe(true);
    expect(adapter.decodeThreadId(messages[0]?.threadId ?? "")).toEqual({
      channelId: "123@c.us",
      threadId: "topic-1",
    });
  });

  it("passes the body and request to parse", async () => {
    const parse = vi.fn().mockReturnValue(null);
    adapter = makeAdapter({ parse });
    await adapter.initialize(chat);

    const request = signedRequest(samplePayload);
    await adapter.handleWebhook(request);

    expect(parse).toHaveBeenCalledWith(samplePayload, {
      body: JSON.stringify(samplePayload),
      request,
    });
  });

  it("returns 500 when parse throws", async () => {
    adapter = makeAdapter({
      parse: () => {
        throw new Error("bad payload");
      },
    });
    await adapter.initialize(chat);
    const response = await adapter.handleWebhook(signedRequest(samplePayload));
    expect(response.status).toBe(500);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("forwards webhook options to processMessage", async () => {
    const waitUntil = vi.fn();
    await adapter.handleWebhook(signedRequest(samplePayload), { waitUntil });
    expect(vi.mocked(chat.processMessage).mock.calls[0]?.[3]).toEqual({
      waitUntil,
    });
  });

  it("acknowledges without processing before initialize", async () => {
    const uninitialized = makeAdapter();
    const response = await uninitialized.handleWebhook(
      signedRequest(samplePayload)
    );
    expect(response.status).toBe(200);
  });
});

describe("parseMessage", () => {
  const adapter = makeAdapter();

  it("fills author defaults and marks echoes as from the bot", () => {
    const message = adapter.parseMessage({
      channelId: "c",
      text: "hi",
      author: { userId: "bot-1", isMe: true },
    });
    expect(message.author).toEqual({
      userId: "bot-1",
      userName: "bot-1",
      fullName: "bot-1",
      isBot: true,
      isMe: true,
    });
    expect(message.id).toMatch(UUID_PATTERN);
  });

  it("accepts ISO timestamps and falls back for invalid ones", () => {
    const iso = adapter.parseMessage({
      channelId: "c",
      text: "",
      author: { userId: "u" },
      timestamp: "2026-01-02T03:04:05.000Z",
    });
    expect(iso.metadata.dateSent.toISOString()).toBe(
      "2026-01-02T03:04:05.000Z"
    );

    const invalid = adapter.parseMessage({
      channelId: "c",
      text: "",
      author: { userId: "u" },
      timestamp: "not a date",
    });
    expect(Number.isNaN(invalid.metadata.dateSent.getTime())).toBe(false);
  });

  it("requires a channelId and an author.userId", () => {
    expect(() =>
      adapter.parseMessage({
        channelId: "",
        text: "hi",
        author: { userId: "u" },
      })
    ).toThrow(ValidationError);
    expect(() =>
      adapter.parseMessage({
        channelId: "c",
        text: "hi",
        author: { userId: "" },
      })
    ).toThrow(ValidationError);
  });
});

describe("outbound", () => {
  const threadData = { channelId: "123@c.us", threadId: "topic" };

  it("sends Markdown text with the decoded target", async () => {
    const send = vi.fn().mockResolvedValue({ id: "out-1", raw: { ok: 1 } });
    const adapter = makeAdapter({ send });
    const threadId = adapter.encodeThreadId(threadData);

    const result = await adapter.postMessage(threadId, {
      markdown: "**Hi** there",
    });

    expect(send).toHaveBeenCalledWith({
      channelId: "123@c.us",
      threadId: "topic",
      thread: threadId,
      text: "**Hi** there",
      message: { markdown: "**Hi** there" },
    });
    expect(result).toEqual({ id: "out-1", threadId, raw: { ok: 1 } });
  });

  it("generates an ID when send returns nothing", async () => {
    const adapter = makeAdapter({ send: async () => undefined });
    const threadId = adapter.encodeThreadId(threadData);
    const result = await adapter.postMessage(threadId, "plain");
    expect(result.id).toMatch(UUID_PATTERN);
    expect(result.raw).toBeNull();
  });

  it("renders cards as fallback text", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ send });
    await adapter.postMessage(adapter.encodeThreadId(threadData), {
      type: "card",
      title: "Order shipped",
      children: [],
    });
    expect(send.mock.calls[0]?.[0].text).toContain("Order shipped");
  });

  it("edits through the edit callback", async () => {
    const edit = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ edit });
    const threadId = adapter.encodeThreadId(threadData);

    const result = await adapter.editMessage(threadId, "out-1", "updated");

    expect(edit).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "out-1", text: "updated" })
    );
    expect(result.id).toBe("out-1");
  });

  it("throws NotImplementedError for edit and delete without callbacks", async () => {
    const adapter = makeAdapter();
    const threadId = adapter.encodeThreadId(threadData);
    await expect(adapter.editMessage(threadId, "m", "x")).rejects.toThrow(
      NotImplementedError
    );
    await expect(adapter.deleteMessage(threadId, "m")).rejects.toThrow(
      NotImplementedError
    );
    await expect(
      adapter.addReaction(threadId, "m", "thumbs_up")
    ).rejects.toThrow(NotImplementedError);
    await expect(
      adapter.removeReaction(threadId, "m", "thumbs_up")
    ).rejects.toThrow(NotImplementedError);
  });

  it("deletes through the delete callback", async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ delete: del });
    const threadId = adapter.encodeThreadId(threadData);
    await adapter.deleteMessage(threadId, "out-1");
    expect(del).toHaveBeenCalledWith({
      ...threadData,
      thread: threadId,
      messageId: "out-1",
    });
  });

  it("calls startTyping when configured and does nothing otherwise", async () => {
    const startTyping = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ startTyping });
    const threadId = adapter.encodeThreadId(threadData);
    await adapter.startTyping(threadId);
    expect(startTyping).toHaveBeenCalledWith({
      ...threadData,
      thread: threadId,
    });
    await expect(makeAdapter().startTyping(threadId)).resolves.toBeUndefined();
  });

  it("buffers streams into one message without an edit callback", async () => {
    const send = vi.fn().mockResolvedValue({ id: "s" });
    const adapter = makeAdapter({ send });
    async function* chunks() {
      yield "Hello ";
      yield { type: "markdown_text" as const, text: "world" };
      yield { type: "plan_update" as const, title: "ignored" };
    }
    const result = await adapter.stream(
      adapter.encodeThreadId(threadData),
      chunks()
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].text).toBe("Hello world");
    expect(result?.id).toBe("s");
  });

  it("defers streaming to Chat SDK when edit is configured", async () => {
    const adapter = makeAdapter({ edit: vi.fn() });
    async function* chunks() {
      yield "x";
    }
    expect(
      await adapter.stream(adapter.encodeThreadId(threadData), chunks())
    ).toBeNull();
  });
});

describe("threads", () => {
  const adapter = makeAdapter({ name: "waha" });

  it("derives the channel from a thread ID", () => {
    const threadId = adapter.encodeThreadId({
      channelId: "a:b",
      threadId: "t",
    });
    expect(adapter.channelIdFromThreadId(threadId)).toBe(
      adapter.encodeThreadId({ channelId: "a:b" })
    );
  });

  it("returns thread info", async () => {
    const threadId = adapter.encodeThreadId({ channelId: "c", threadId: "t" });
    expect(await adapter.fetchThread(threadId)).toEqual({
      id: threadId,
      channelId: adapter.encodeThreadId({ channelId: "c" }),
      metadata: { channelId: "c", threadId: "t" },
    });
  });

  it("returns no messages from fetchMessages", async () => {
    expect(await adapter.fetchMessages("waha:Yw")).toEqual({ messages: [] });
  });

  it("rejects thread IDs from other adapters", () => {
    expect(() => adapter.decodeThreadId("webhook:Yw")).toThrow(ValidationError);
    expect(() => adapter.decodeThreadId("waha")).toThrow(ValidationError);
    expect(() => adapter.decodeThreadId("waha:a:b:c")).toThrow(ValidationError);
  });
});

threadIdContract<WebhookThreadId>({
  name: "webhook",
  encode: (decoded) => makeAdapter().encodeThreadId(decoded),
  decode: (id) => makeAdapter().decodeThreadId(id),
  cases: [
    { decoded: { channelId: "chat-1" }, encoded: "webhook:Y2hhdC0x" },
    {
      decoded: { channelId: "!room:matrix.org", threadId: "$event:1" },
    },
    { decoded: { channelId: "123@c.us" } },
  ],
});

describe("with Chat", () => {
  it("routes a webhook to a handler and replies through send", async () => {
    const send = vi.fn().mockResolvedValue({ id: "reply-1" });
    const adapter = makeAdapter({
      parse: (payload: BridgePayload) => ({
        id: payload.id,
        channelId: payload.chatId,
        text: payload.text,
        author: { userId: payload.from.id },
        isMention: true,
      }),
      send,
    });
    const bot = new Chat({
      userName: "bot",
      adapters: { webhook: adapter },
      state: createMockState(),
      logger: mockLogger,
    });

    const handled = new Promise<{ thread: Thread; message: Message }>(
      (resolve) => {
        bot.onNewMention(async (thread, message) => {
          await thread.post(`echo: ${message.text}`);
          resolve({ thread, message });
        });
      }
    );

    const tasks: Promise<unknown>[] = [];
    const response = await bot.webhooks.webhook(signedRequest(samplePayload), {
      waitUntil: (task) => {
        tasks.push(task);
      },
    });
    expect(response.status).toBe(200);

    const { thread, message } = await handled;
    await Promise.all(tasks);

    expect(message.text).toBe("Hello **bot**");
    expect(thread.id).toBe(adapter.encodeThreadId({ channelId: "123@c.us" }));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "123@c.us",
        text: "echo: Hello **bot**",
      })
    );
  });
});
