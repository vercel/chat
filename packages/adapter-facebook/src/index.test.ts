import { createHmac } from "node:crypto";
import { ValidationError } from "@chat-adapter/shared";
import type { ChatInstance, Logger } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFacebookAdapter,
  FacebookAdapter,
  type FacebookMessagingEvent,
} from "./index";

const APP_SECRET = "test-app-secret";
const TRAILING_ELLIPSIS_PATTERN = /\.\.\.$/;

function signPayload(body: string): string {
  const hash = createHmac("sha256", APP_SECRET)
    .update(body, "utf8")
    .digest("hex");
  return `sha256=${hash}`;
}

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

const mockFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function graphApiOk(result: unknown): Response {
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function createMockChat(): ChatInstance {
  return {
    getLogger: vi.fn().mockReturnValue(mockLogger),
    getState: vi.fn(),
    getUserName: vi.fn().mockReturnValue("TestBot"),
    handleIncomingMessage: vi.fn().mockResolvedValue(undefined),
    processMessage: vi.fn(),
    processReaction: vi.fn(),
    processAction: vi.fn(),
    processModalClose: vi.fn(),
    processModalSubmit: vi.fn().mockResolvedValue(undefined),
    processSlashCommand: vi.fn(),
    processAssistantThreadStarted: vi.fn(),
    processAssistantContextChanged: vi.fn(),
    processAppHomeOpened: vi.fn(),
  } as unknown as ChatInstance;
}

function sampleMessagingEvent(
  overrides?: Partial<FacebookMessagingEvent>
): FacebookMessagingEvent {
  return {
    sender: { id: "USER_123" },
    recipient: { id: "PAGE_456" },
    timestamp: 1735689600000,
    message: {
      mid: "mid.abc123",
      text: "hello",
    },
    ...overrides,
  };
}

function createWebhookPayload(events: FacebookMessagingEvent[]) {
  return {
    object: "page",
    entry: [
      {
        id: "PAGE_456",
        time: 1735689600000,
        messaging: events,
      },
    ],
  };
}

function createAdapter() {
  return new FacebookAdapter({
    appSecret: "test-app-secret",
    pageAccessToken: "test-page-token",
    verifyToken: "test-verify-token",
    logger: mockLogger,
  });
}

describe("createFacebookAdapter", () => {
  it("throws when app secret is missing", () => {
    process.env.FACEBOOK_APP_SECRET = "";
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "token";
    process.env.FACEBOOK_VERIFY_TOKEN = "verify";

    expect(() => createFacebookAdapter({ logger: mockLogger })).toThrow(
      ValidationError
    );
  });

  it("throws when page access token is missing", () => {
    process.env.FACEBOOK_APP_SECRET = "secret";
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "";
    process.env.FACEBOOK_VERIFY_TOKEN = "verify";

    expect(() => createFacebookAdapter({ logger: mockLogger })).toThrow(
      ValidationError
    );
  });

  it("throws when verify token is missing", () => {
    process.env.FACEBOOK_APP_SECRET = "secret";
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "token";
    process.env.FACEBOOK_VERIFY_TOKEN = "";

    expect(() => createFacebookAdapter({ logger: mockLogger })).toThrow(
      ValidationError
    );
  });

  it("uses env vars when config is omitted", () => {
    process.env.FACEBOOK_APP_SECRET = "secret";
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "token";
    process.env.FACEBOOK_VERIFY_TOKEN = "verify";

    const adapter = createFacebookAdapter({ logger: mockLogger });
    expect(adapter).toBeInstanceOf(FacebookAdapter);
    expect(adapter.name).toBe("facebook");
  });
});

describe("FacebookAdapter", () => {
  it("encodes and decodes thread IDs", () => {
    const adapter = createAdapter();

    expect(adapter.encodeThreadId({ recipientId: "USER_123" })).toBe(
      "facebook:USER_123"
    );

    expect(adapter.decodeThreadId("facebook:USER_123")).toEqual({
      recipientId: "USER_123",
    });
  });

  it("throws on invalid thread IDs", () => {
    const adapter = createAdapter();

    expect(() => adapter.decodeThreadId("invalid")).toThrow(ValidationError);
    expect(() => adapter.decodeThreadId("facebook:")).toThrow(ValidationError);
    expect(() => adapter.decodeThreadId("slack:C123:ts")).toThrow(
      ValidationError
    );
  });

  it("handles webhook verification (GET)", async () => {
    const adapter = createAdapter();

    const request = new Request(
      "https://example.com/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=CHALLENGE_VALUE",
      { method: "GET" }
    );

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("CHALLENGE_VALUE");
  });

  it("rejects invalid webhook verification token", async () => {
    const adapter = createAdapter();

    const request = new Request(
      "https://example.com/webhook?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=CHALLENGE",
      { method: "GET" }
    );

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(403);
  });

  it("handles incoming messages", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();

    mockFetch.mockResolvedValueOnce(
      graphApiOk({ id: "PAGE_456", name: "Test Page" })
    );
    await adapter.initialize(chat);

    const event = sampleMessagingEvent();
    const payload = createWebhookPayload([event]);
    const body = JSON.stringify(payload);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signPayload(body),
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("EVENT_RECEIVED");
  });

  it("ignores echo messages", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();

    mockFetch.mockResolvedValueOnce(
      graphApiOk({ id: "PAGE_456", name: "Test Page" })
    );
    await adapter.initialize(chat);

    const event = sampleMessagingEvent({
      message: { mid: "mid.echo", text: "echo", is_echo: true },
    });
    const payload = createWebhookPayload([event]);
    const body = JSON.stringify(payload);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signPayload(body),
      },
      body,
    });

    await adapter.handleWebhook(request);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("rejects non-page subscriptions", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();

    mockFetch.mockResolvedValueOnce(
      graphApiOk({ id: "PAGE_456", name: "Test Page" })
    );
    await adapter.initialize(chat);

    const nonPageBody = JSON.stringify({ object: "user", entry: [] });
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signPayload(nonPageBody),
      },
      body: nonPageBody,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(404);
  });

  it("posts a message", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();

    mockFetch.mockResolvedValueOnce(
      graphApiOk({ id: "PAGE_456", name: "Test Page" })
    );
    await adapter.initialize(chat);

    mockFetch.mockResolvedValueOnce(
      graphApiOk({ recipient_id: "USER_123", message_id: "mid.sent" })
    );

    const result = await adapter.postMessage("facebook:USER_123", "Hello!");
    expect(result.id).toBe("mid.sent");
    expect(result.threadId).toBe("facebook:USER_123");
  });

  it("rejects empty messages", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();

    mockFetch.mockResolvedValueOnce(
      graphApiOk({ id: "PAGE_456", name: "Test Page" })
    );
    await adapter.initialize(chat);

    await expect(
      adapter.postMessage("facebook:USER_123", "  ")
    ).rejects.toThrow(ValidationError);
  });

  it("starts typing indicator", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();

    mockFetch.mockResolvedValueOnce(
      graphApiOk({ id: "PAGE_456", name: "Test Page" })
    );
    await adapter.initialize(chat);

    mockFetch.mockResolvedValueOnce(graphApiOk({ recipient_id: "USER_123" }));

    await adapter.startTyping("facebook:USER_123");
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const [url, options] = mockFetch.mock.calls[1];
    expect(url.toString()).toContain("me/messages");
    const body = JSON.parse(options?.body as string);
    expect(body.sender_action).toBe("typing_on");
  });

  it("throws on editMessage (unsupported)", async () => {
    const adapter = createAdapter();
    await expect(
      adapter.editMessage("facebook:USER_123", "mid.1", "new text")
    ).rejects.toThrow(ValidationError);
  });

  it("throws on deleteMessage (unsupported)", async () => {
    const adapter = createAdapter();
    await expect(
      adapter.deleteMessage("facebook:USER_123", "mid.1")
    ).rejects.toThrow(ValidationError);
  });

  it("always reports isDM as true", () => {
    const adapter = createAdapter();
    expect(adapter.isDM("facebook:USER_123")).toBe(true);
  });

  it("parses raw messages", () => {
    const adapter = createAdapter();
    const event = sampleMessagingEvent();

    const parsed = adapter.parseMessage(event);
    expect(parsed.text).toBe("hello");
    expect(parsed.threadId).toBe("facebook:USER_123");
    expect(parsed.id).toBe("mid.abc123");
  });

  it("fetches thread info with user profile", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();

    mockFetch.mockResolvedValueOnce(
      graphApiOk({ id: "PAGE_456", name: "Test Page" })
    );
    await adapter.initialize(chat);

    mockFetch.mockResolvedValueOnce(
      graphApiOk({
        id: "USER_123",
        first_name: "John",
        last_name: "Doe",
      })
    );

    const threadInfo = await adapter.fetchThread("facebook:USER_123");
    expect(threadInfo.channelName).toBe("John Doe");
    expect(threadInfo.isDM).toBe(true);
  });

  it("handles postback events", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();

    mockFetch.mockResolvedValueOnce(
      graphApiOk({ id: "PAGE_456", name: "Test Page" })
    );
    await adapter.initialize(chat);

    const event = sampleMessagingEvent({
      message: undefined,
      postback: {
        title: "Get Started",
        payload: "GET_STARTED",
      },
    });
    const payload = createWebhookPayload([event]);
    const body = JSON.stringify(payload);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signPayload(body),
      },
      body,
    });

    await adapter.handleWebhook(request);
    expect(chat.processAction).toHaveBeenCalledTimes(1);
  });

  it("handles reaction events", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();

    mockFetch.mockResolvedValueOnce(
      graphApiOk({ id: "PAGE_456", name: "Test Page" })
    );
    await adapter.initialize(chat);

    const event = sampleMessagingEvent({
      message: undefined,
      reaction: {
        mid: "m_reacted_message",
        action: "react",
        emoji: "\u2764",
        reaction: "other",
      },
    });
    const payload = createWebhookPayload([event]);
    const body = JSON.stringify(payload);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signPayload(body),
      },
      body,
    });

    await adapter.handleWebhook(request);
    expect(chat.processReaction).toHaveBeenCalledTimes(1);

    const reactionArg = (chat.processReaction as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(reactionArg.messageId).toBe("m_reacted_message");
    expect(reactionArg.rawEmoji).toBe("\u2764");
    expect(reactionArg.added).toBe(true);
  });

  it("handles unreact events", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();

    mockFetch.mockResolvedValueOnce(
      graphApiOk({ id: "PAGE_456", name: "Test Page" })
    );
    await adapter.initialize(chat);

    const event = sampleMessagingEvent({
      message: undefined,
      reaction: {
        mid: "m_reacted_message",
        action: "unreact",
        emoji: "\u2764",
        reaction: "other",
      },
    });
    const payload = createWebhookPayload([event]);
    const body = JSON.stringify(payload);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signPayload(body),
      },
      body,
    });

    await adapter.handleWebhook(request);
    expect(chat.processReaction).toHaveBeenCalledTimes(1);

    const reactionArg = (chat.processReaction as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(reactionArg.added).toBe(false);
  });

  it("caches echo messages", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();

    mockFetch.mockResolvedValueOnce(
      graphApiOk({ id: "PAGE_456", name: "Test Page" })
    );
    await adapter.initialize(chat);

    const event = sampleMessagingEvent({
      sender: { id: "PAGE_456" },
      recipient: { id: "USER_123" },
      message: { mid: "mid.echo1", text: "bot reply", is_echo: true },
    });
    const payload = createWebhookPayload([event]);
    const body = JSON.stringify(payload);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signPayload(body),
      },
      body,
    });

    await adapter.handleWebhook(request);
    // Echo should not trigger processMessage
    expect(chat.processMessage).not.toHaveBeenCalled();
    // But should be cached and fetchable
    const cached = await adapter.fetchMessage("facebook:USER_123", "mid.echo1");
    expect(cached).not.toBeNull();
    expect(cached?.text).toBe("bot reply");
  });

  it("handles delivery confirmations without errors", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();

    mockFetch.mockResolvedValueOnce(
      graphApiOk({ id: "PAGE_456", name: "Test Page" })
    );
    await adapter.initialize(chat);

    const event = sampleMessagingEvent({
      message: undefined,
      delivery: { watermark: 1735689600000, mids: ["mid.abc"] },
    });
    const payload = createWebhookPayload([event]);
    const body = JSON.stringify(payload);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signPayload(body),
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("handles read confirmations without errors", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();

    mockFetch.mockResolvedValueOnce(
      graphApiOk({ id: "PAGE_456", name: "Test Page" })
    );
    await adapter.initialize(chat);

    const event = sampleMessagingEvent({
      message: undefined,
      read: { watermark: 1735689600000 },
    });
    const payload = createWebhookPayload([event]);
    const body = JSON.stringify(payload);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signPayload(body),
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("truncates long messages", async () => {
    const adapter = createAdapter();
    const chat = createMockChat();

    mockFetch.mockResolvedValueOnce(
      graphApiOk({ id: "PAGE_456", name: "Test Page" })
    );
    await adapter.initialize(chat);

    const longText = "a".repeat(3000);
    mockFetch.mockResolvedValueOnce(
      graphApiOk({ recipient_id: "USER_123", message_id: "mid.long" })
    );

    await adapter.postMessage("facebook:USER_123", longText);

    const [, options] = mockFetch.mock.calls[1];
    const body = JSON.parse(options?.body as string);
    expect(body.message.text.length).toBeLessThanOrEqual(2000);
    expect(body.message.text).toMatch(TRAILING_ELLIPSIS_PATTERN);
  });
});
