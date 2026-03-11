import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockTelegramApi,
  createTelegramWebhookRequest,
  type MockTelegramApi,
  setupTelegramFetchMock,
  TELEGRAM_BOT_TOKEN,
} from "./telegram-utils";

describe("TELEGRAM_BOT_TOKEN", () => {
  it("exports a non-empty string", () => {
    expect(TELEGRAM_BOT_TOKEN).toBe("test-telegram-bot-token");
  });
});

describe("createMockTelegramApi", () => {
  it("returns empty calls and sentMessages arrays", () => {
    const api = createMockTelegramApi();
    expect(api.calls).toEqual([]);
    expect(api.sentMessages).toEqual([]);
  });

  it("clearMocks resets calls and sentMessages", () => {
    const api = createMockTelegramApi();
    api.calls.push({
      method: "getMe",
      payload: {},
      url: "https://example.com",
    });
    api.sentMessages.push({ chatId: 1, messageId: 1, text: "hi" });

    api.clearMocks();

    expect(api.calls).toHaveLength(0);
    expect(api.sentMessages).toHaveLength(0);
  });

  it("clearMocks preserves array identity", () => {
    const api = createMockTelegramApi();
    const callsRef = api.calls;
    const sentRef = api.sentMessages;

    api.clearMocks();

    expect(api.calls).toBe(callsRef);
    expect(api.sentMessages).toBe(sentRef);
  });
});

describe("createTelegramWebhookRequest", () => {
  it("creates a POST request to the webhook URL", () => {
    const req = createTelegramWebhookRequest({ update_id: 1 });
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://example.com/webhook/telegram");
  });

  it("sets content-type to application/json", () => {
    const req = createTelegramWebhookRequest({});
    expect(req.headers.get("content-type")).toBe("application/json");
  });

  it("serializes the payload as JSON body", async () => {
    const payload = { update_id: 42, message: { text: "hello" } };
    const req = createTelegramWebhookRequest(payload);
    const body = await req.json();
    expect(body).toEqual(payload);
  });
});

describe("setupTelegramFetchMock", () => {
  let mockApi: MockTelegramApi;
  let cleanup: () => void;
  const botUserId = "12345";
  const userName = "testbot";

  beforeEach(() => {
    mockApi = createMockTelegramApi();
    cleanup = setupTelegramFetchMock(mockApi, { botUserId, userName });
  });

  afterEach(() => {
    cleanup();
  });

  it("intercepts getMe and returns bot info", async () => {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`
    );
    const data = await res.json();

    expect(data).toEqual({
      ok: true,
      result: {
        first_name: userName,
        id: 12345,
        is_bot: true,
        username: userName,
      },
    });
  });

  it("records getMe call in mockApi.calls", async () => {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`);

    expect(mockApi.calls).toHaveLength(1);
    expect(mockApi.calls[0].method).toBe("getMe");
  });

  it("intercepts sendMessage and returns message response", async () => {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        body: JSON.stringify({ chat_id: 999, text: "hello world" }),
      }
    );
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.result.text).toBe("hello world");
    expect(data.result.chat.id).toBe(999);
    expect(data.result.message_id).toBeGreaterThanOrEqual(10_000);
    expect(data.result.from.id).toBe(12345);
    expect(data.result.from.is_bot).toBe(true);
  });

  it("records sendMessage in sentMessages", async () => {
    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        body: JSON.stringify({ chat_id: 42, text: "test" }),
      }
    );

    expect(mockApi.sentMessages).toHaveLength(1);
    expect(mockApi.sentMessages[0]).toEqual({
      chatId: 42,
      messageId: expect.any(Number),
      text: "test",
    });
  });

  it("increments message IDs across multiple sendMessage calls", async () => {
    for (let i = 0; i < 3; i++) {
      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          body: JSON.stringify({ chat_id: 1, text: `msg-${i}` }),
        }
      );
    }

    const ids = mockApi.sentMessages.map((m) => m.messageId);
    expect(ids[1]).toBe(ids[0] + 1);
    expect(ids[2]).toBe(ids[1] + 1);
  });

  it("returns group chat type for negative chat IDs", async () => {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        body: JSON.stringify({ chat_id: -100, text: "group msg" }),
      }
    );
    const data = await res.json();

    expect(data.result.chat.type).toBe("group");
  });

  it("returns private chat type for positive chat IDs", async () => {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        body: JSON.stringify({ chat_id: 100, text: "dm" }),
      }
    );
    const data = await res.json();

    expect(data.result.chat.type).toBe("private");
  });

  it("handles sendMessage with missing text", async () => {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        body: JSON.stringify({ chat_id: 1 }),
      }
    );
    const data = await res.json();

    expect(data.result.text).toBe("");
    expect(mockApi.sentMessages[0].text).toBe("");
  });

  it("handles sendMessage with missing chat_id", async () => {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        body: JSON.stringify({ text: "orphan" }),
      }
    );
    const data = await res.json();

    expect(data.result.chat.id).toBe(0);
    expect(mockApi.sentMessages[0].chatId).toBe(0);
  });

  it("includes message_thread_id when provided", async () => {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        body: JSON.stringify({
          chat_id: 1,
          text: "threaded",
          message_thread_id: 42,
        }),
      }
    );
    const data = await res.json();

    expect(data.result.message_thread_id).toBe(42);
  });

  it("omits message_thread_id when not provided", async () => {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        body: JSON.stringify({ chat_id: 1, text: "no thread" }),
      }
    );
    const data = await res.json();

    expect(data.result.message_thread_id).toBeUndefined();
  });

  it("omits message_thread_id for empty string", async () => {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        body: JSON.stringify({
          chat_id: 1,
          text: "test",
          message_thread_id: "",
        }),
      }
    );
    const data = await res.json();

    expect(data.result.message_thread_id).toBeUndefined();
  });

  it("returns telegramOk(true) for unknown methods", async () => {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteMessage`,
      {
        method: "POST",
        body: JSON.stringify({ chat_id: 1, message_id: 5 }),
      }
    );
    const data = await res.json();

    expect(data).toEqual({ ok: true, result: true });
  });

  it("records unknown method calls", async () => {
    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`,
      {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com" }),
      }
    );

    expect(mockApi.calls).toHaveLength(1);
    expect(mockApi.calls[0].method).toBe("setWebhook");
    expect(mockApi.calls[0].payload).toEqual({ url: "https://example.com" });
  });

  it("passes non-Telegram URLs through to original fetch", async () => {
    const originalFetch = vi.fn().mockResolvedValue(new Response("ok"));
    const savedFetch = globalThis.fetch;
    cleanup();

    globalThis.fetch = originalFetch;
    const mockApi2 = createMockTelegramApi();
    const cleanup2 = setupTelegramFetchMock(mockApi2, { botUserId, userName });

    await fetch("https://example.com/api/data");

    expect(originalFetch).toHaveBeenCalledOnce();
    expect(mockApi2.calls).toHaveLength(0);

    cleanup2();
    globalThis.fetch = savedFetch;
  });

  it("restores original fetch on cleanup", () => {
    const originalFetch = globalThis.fetch;
    const mockApi2 = createMockTelegramApi();
    const cleanup2 = setupTelegramFetchMock(mockApi2, { botUserId, userName });

    expect(globalThis.fetch).not.toBe(originalFetch);

    cleanup2();

    // After cleanup, fetch should be the mock from beforeEach (not the inner one)
    expect(globalThis.fetch).not.toBe(cleanup2);
  });

  it("parses URL input as string", async () => {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`);
    expect(mockApi.calls[0].url).toContain("api.telegram.org");
  });

  it("parses URL input as URL object", async () => {
    await fetch(
      new URL(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`)
    );
    expect(mockApi.calls[0].method).toBe("getMe");
  });

  it("parses URL input as Request object", async () => {
    await fetch(
      new Request(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`)
    );
    expect(mockApi.calls[0].method).toBe("getMe");
  });

  it("handles request with no body", async () => {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`, {
      method: "GET",
    });

    expect(mockApi.calls[0].payload).toEqual({});
  });

  it("parses URLSearchParams body", async () => {
    const params = new URLSearchParams();
    params.set("chat_id", "123");
    params.set("text", "hello");

    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { method: "POST", body: params }
    );

    expect(mockApi.calls[0].payload).toEqual({
      chat_id: "123",
      text: "hello",
    });
    expect(mockApi.sentMessages[0].chatId).toBe(123);
  });

  it("parses FormData body", async () => {
    const form = new FormData();
    form.set("chat_id", "456");
    form.set("text", "from form");

    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { method: "POST", body: form }
    );

    expect(mockApi.calls[0].payload).toEqual({
      chat_id: "456",
      text: "from form",
    });
  });

  it("handles FormData with binary values", async () => {
    const form = new FormData();
    form.set("chat_id", "789");
    form.set("photo", new Blob(["fake-image"]), "photo.jpg");

    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      body: form,
    });

    expect(mockApi.calls[0].payload.photo).toBe("[binary]");
  });

  it("handles non-finite message_thread_id gracefully", async () => {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        body: JSON.stringify({
          chat_id: 1,
          text: "test",
          message_thread_id: "not-a-number",
        }),
      }
    );
    const data = await res.json();

    expect(data.result.message_thread_id).toBeUndefined();
  });

  it("handles null message_thread_id", async () => {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        body: JSON.stringify({
          chat_id: 1,
          text: "test",
          message_thread_id: null,
        }),
      }
    );
    const data = await res.json();

    expect(data.result.message_thread_id).toBeUndefined();
  });
});
