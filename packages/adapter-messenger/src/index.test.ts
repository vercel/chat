import { createHmac } from "node:crypto";
import {
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  ResourceNotFoundError,
  ValidationError as SharedValidationError,
  ValidationError,
} from "@chat-adapter/shared";
import {
  createMockChatInstance,
  createMockLogger,
  selfMessageContract,
  threadIdContract,
} from "@chat-adapter/tests";
import type { ChatInstance } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMessengerAdapter,
  MessengerAdapter,
  type MessengerMessagingEvent,
  type MessengerThreadId,
} from "./index";

const APP_SECRET = "test-app-secret";
const TRAILING_ELLIPSIS_PATTERN = /\.\.\.$/;
const MESSENGER_API_PATTERN = /Messenger API/;

function signPayload(body: string): string {
  const hash = createHmac("sha256", APP_SECRET)
    .update(body, "utf8")
    .digest("hex");
  return `sha256=${hash}`;
}

const mockLogger = createMockLogger();

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
  return createMockChatInstance({ logger: mockLogger, userName: "TestBot" });
}

function sampleMessagingEvent(
  overrides?: Partial<MessengerMessagingEvent>
): MessengerMessagingEvent {
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

function createWebhookPayload(events: MessengerMessagingEvent[]) {
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
  return new MessengerAdapter({
    appSecret: "test-app-secret",
    pageAccessToken: "test-page-token",
    verifyToken: "test-verify-token",
    logger: mockLogger,
  });
}

describe("MessengerAdapter", () => {
  describe("factory function", () => {
    it("throws when app secret is missing", () => {
      process.env.FACEBOOK_APP_SECRET = "";
      process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "token";
      process.env.FACEBOOK_VERIFY_TOKEN = "verify";

      expect(() => createMessengerAdapter({ logger: mockLogger })).toThrow(
        ValidationError
      );
    });

    it("throws when page access token is missing", () => {
      process.env.FACEBOOK_APP_SECRET = "secret";
      process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "";
      process.env.FACEBOOK_VERIFY_TOKEN = "verify";

      expect(() => createMessengerAdapter({ logger: mockLogger })).toThrow(
        ValidationError
      );
    });

    it("throws when verify token is missing", () => {
      process.env.FACEBOOK_APP_SECRET = "secret";
      process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "token";
      process.env.FACEBOOK_VERIFY_TOKEN = "";

      expect(() => createMessengerAdapter({ logger: mockLogger })).toThrow(
        ValidationError
      );
    });

    it("uses env vars when config is omitted", () => {
      process.env.FACEBOOK_APP_SECRET = "secret";
      process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "token";
      process.env.FACEBOOK_VERIFY_TOKEN = "verify";

      const adapter = createMessengerAdapter({ logger: mockLogger });
      expect(adapter).toBeInstanceOf(MessengerAdapter);
      expect(adapter.name).toBe("messenger");
    });
  });

  describe("thread ID encoding", () => {
    // encode/decode round-trip + pinned-string coverage lives in the shared
    // `threadIdContract` at the bottom of this file; only the malformed-id and
    // raw-resolution edge cases the contract does not cover are kept here.
    it("throws on invalid thread IDs", () => {
      const adapter = createAdapter();

      expect(() => adapter.decodeThreadId("invalid")).toThrow(ValidationError);
      expect(() => adapter.decodeThreadId("messenger:")).toThrow(
        ValidationError
      );
      expect(() => adapter.decodeThreadId("slack:C123:ts")).toThrow(
        ValidationError
      );
    });

    it("rejects thread ID with extra colons", () => {
      const adapter = createAdapter();
      expect(() => adapter.decodeThreadId("messenger:foo:bar")).toThrow(
        ValidationError
      );
    });

    it("rejects empty thread ID", () => {
      const adapter = createAdapter();
      expect(() => adapter.decodeThreadId("")).toThrow(ValidationError);
    });

    it("resolves raw thread ID without messenger: prefix", async () => {
      const adapter = createAdapter();
      const chat = createMockChat();
      mockFetch.mockResolvedValueOnce(
        graphApiOk({ id: "PAGE_456", name: "Test Page" })
      );
      await adapter.initialize(chat);

      mockFetch.mockResolvedValueOnce(
        graphApiOk({ recipient_id: "USER_123", message_id: "mid.raw" })
      );

      const result = await adapter.postMessage("USER_123", "hi");
      expect(result.id).toBe("mid.raw");
    });
  });

  describe("initialization", () => {
    it("continues when /me API call fails", async () => {
      const adapter = createAdapter();
      const chat = createMockChat();

      mockFetch.mockRejectedValueOnce(new Error("API down"));
      await adapter.initialize(chat);

      expect(adapter.botUserId).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Failed to fetch Messenger page identity",
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it("uses chat.getUserName when no explicit userName", async () => {
      const adapter = createAdapter();
      const chat = createMockChat();

      mockFetch.mockRejectedValueOnce(new Error("API down"));
      await adapter.initialize(chat);

      expect(adapter.userName).toBe("TestBot");
    });

    it("uses page name from /me when no explicit userName", async () => {
      const adapter = createAdapter();
      const chat = createMockChat();

      mockFetch.mockResolvedValueOnce(
        graphApiOk({ id: "PAGE_456", name: "My Cool Page" })
      );
      await adapter.initialize(chat);

      expect(adapter.userName).toBe("My Cool Page");
      expect(adapter.botUserId).toBe("PAGE_456");
    });

    it("keeps explicit userName even when /me returns a name", async () => {
      const adapter = new MessengerAdapter({
        appSecret: "test-app-secret",
        pageAccessToken: "test-page-token",
        verifyToken: "test-verify-token",
        logger: mockLogger,
        userName: "CustomBot",
      });
      const chat = createMockChat();

      mockFetch.mockResolvedValueOnce(
        graphApiOk({ id: "PAGE_456", name: "Page Name" })
      );
      await adapter.initialize(chat);

      expect(adapter.userName).toBe("CustomBot");
    });
  });

  describe("webhook handling", () => {
    describe("verification (GET)", () => {
      it("handles valid verification request", async () => {
        const adapter = createAdapter();

        const request = new Request(
          "https://example.com/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=CHALLENGE_VALUE",
          { method: "GET" }
        );

        const response = await adapter.handleWebhook(request);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("CHALLENGE_VALUE");
      });

      it("rejects invalid verification token", async () => {
        const adapter = createAdapter();

        const request = new Request(
          "https://example.com/webhook?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=CHALLENGE",
          { method: "GET" }
        );

        const response = await adapter.handleWebhook(request);
        expect(response.status).toBe(403);
      });

      it("returns challenge as empty string when hub.challenge is missing", async () => {
        const adapter = createAdapter();
        const request = new Request(
          "https://example.com/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token",
          { method: "GET" }
        );

        const response = await adapter.handleWebhook(request);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("");
      });

      it("rejects when hub.mode is not subscribe", async () => {
        const adapter = createAdapter();
        const request = new Request(
          "https://example.com/webhook?hub.mode=unsubscribe&hub.verify_token=test-verify-token&hub.challenge=CHALLENGE",
          { method: "GET" }
        );

        const response = await adapter.handleWebhook(request);
        expect(response.status).toBe(403);
      });
    });

    describe("signature verification", () => {
      it("rejects when signature header is missing", async () => {
        const adapter = createAdapter();
        const chat = createMockChat();
        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        const body = JSON.stringify(
          createWebhookPayload([sampleMessagingEvent()])
        );
        const request = new Request("https://example.com/webhook", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });

        const response = await adapter.handleWebhook(request);
        expect(response.status).toBe(403);
      });

      it("rejects when signature algo is not sha256", async () => {
        const adapter = createAdapter();
        const chat = createMockChat();
        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        const body = JSON.stringify(
          createWebhookPayload([sampleMessagingEvent()])
        );
        const request = new Request("https://example.com/webhook", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": "sha1=abc123",
          },
          body,
        });

        const response = await adapter.handleWebhook(request);
        expect(response.status).toBe(403);
      });

      it("rejects when signature hash is missing after algo", async () => {
        const adapter = createAdapter();
        const chat = createMockChat();
        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        const body = JSON.stringify(
          createWebhookPayload([sampleMessagingEvent()])
        );
        const request = new Request("https://example.com/webhook", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": "sha256=",
          },
          body,
        });

        const response = await adapter.handleWebhook(request);
        expect(response.status).toBe(403);
      });

      it("rejects when signature hash is invalid hex", async () => {
        const adapter = createAdapter();
        const chat = createMockChat();
        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        const body = JSON.stringify(
          createWebhookPayload([sampleMessagingEvent()])
        );
        const request = new Request("https://example.com/webhook", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": "sha256=not-valid-hex",
          },
          body,
        });

        const response = await adapter.handleWebhook(request);
        expect(response.status).toBe(403);
      });
    });

    describe("payload validation", () => {
      it("returns 400 for invalid JSON body", async () => {
        const adapter = createAdapter();
        const chat = createMockChat();
        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        const body = "not valid json{{{";
        const request = new Request("https://example.com/webhook", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": signPayload(body),
          },
          body,
        });

        const response = await adapter.handleWebhook(request);
        expect(response.status).toBe(400);
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

      it("returns 200 when chat is not initialized", async () => {
        const adapter = createAdapter();

        const payload = createWebhookPayload([sampleMessagingEvent()]);
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
        expect(mockLogger.warn).toHaveBeenCalledWith(
          "Chat instance not initialized, ignoring Messenger webhook"
        );
      });
    });

    describe("message processing", () => {
      // The happy-path dispatch of another user's message and the ignore of the
      // bot's own echo are covered by the shared `selfMessageContract` at the
      // bottom of this file. Echo caching (below) is Messenger-specific and kept.
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
        expect(chat).not.toHaveDispatched("processMessage");
        const cached = await adapter.fetchMessage(
          "messenger:USER_123",
          "mid.echo1"
        );
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

      it("processes multiple messaging events in a single entry", async () => {
        const adapter = createAdapter();
        const chat = createMockChat();
        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        const payload = createWebhookPayload([
          sampleMessagingEvent({ message: { mid: "mid.1", text: "first" } }),
          sampleMessagingEvent({ message: { mid: "mid.2", text: "second" } }),
          sampleMessagingEvent({ message: { mid: "mid.3", text: "third" } }),
        ]);
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
        expect(chat.processMessage).toHaveBeenCalledTimes(3);
      });

      it("processes multiple entries in a single webhook payload", async () => {
        const adapter = createAdapter();
        const chat = createMockChat();
        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        const payload = {
          object: "page",
          entry: [
            {
              id: "PAGE_456",
              time: 1735689600000,
              messaging: [
                sampleMessagingEvent({
                  message: { mid: "mid.a", text: "from entry 1" },
                }),
              ],
            },
            {
              id: "PAGE_456",
              time: 1735689601000,
              messaging: [
                sampleMessagingEvent({
                  message: { mid: "mid.b", text: "from entry 2" },
                }),
              ],
            },
          ],
        };
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
        expect(chat.processMessage).toHaveBeenCalledTimes(2);
      });

      it("handles mixed event types in a single webhook", async () => {
        const adapter = createAdapter();
        const chat = createMockChat();
        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        const payload = createWebhookPayload([
          sampleMessagingEvent({ message: { mid: "mid.msg", text: "hello" } }),
          sampleMessagingEvent({
            message: undefined,
            reaction: {
              mid: "mid.msg",
              action: "react",
              emoji: "👍",
              reaction: "like",
            },
          }),
          sampleMessagingEvent({
            message: undefined,
            delivery: { watermark: 1735689600000, mids: ["mid.msg"] },
          }),
          sampleMessagingEvent({
            message: undefined,
            read: { watermark: 1735689600000 },
          }),
        ]);
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
        expect(chat.processMessage).toHaveBeenCalledTimes(1);
        expect(chat.processReaction).toHaveBeenCalledTimes(1);
      });
    });

    describe("postback handling", () => {
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

      it("uses postback.mid as messageId when present", async () => {
        const adapter = createAdapter();
        const chat = createMockChat();
        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        const event = sampleMessagingEvent({
          message: undefined,
          postback: {
            title: "Menu Item",
            payload: "MENU_1",
            mid: "mid.postback1",
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
        const actionArg = (chat.processAction as ReturnType<typeof vi.fn>).mock
          .calls[0][0];
        expect(actionArg.messageId).toBe("mid.postback1");
        expect(actionArg.actionId).toBe("MENU_1");
        expect(actionArg.value).toBe("MENU_1");
      });

      it("falls back to postback:{timestamp} when mid is absent", async () => {
        const adapter = createAdapter();
        const chat = createMockChat();
        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        const event = sampleMessagingEvent({
          timestamp: 1735689999000,
          message: undefined,
          postback: { title: "Get Started", payload: "GET_STARTED" },
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
        const actionArg = (chat.processAction as ReturnType<typeof vi.fn>).mock
          .calls[0][0];
        expect(actionArg.messageId).toBe("postback:1735689999000");
      });
    });

    describe("reaction handling", () => {
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

        const reactionArg = (chat.processReaction as ReturnType<typeof vi.fn>)
          .mock.calls[0][0];
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

        const reactionArg = (chat.processReaction as ReturnType<typeof vi.fn>)
          .mock.calls[0][0];
        expect(reactionArg.added).toBe(false);
      });
    });
  });

  describe("messaging", () => {
    describe("posting messages", () => {
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

        const result = await adapter.postMessage(
          "messenger:USER_123",
          "Hello!"
        );
        expect(result.id).toBe("mid.sent");
        expect(result.threadId).toBe("messenger:USER_123");
      });

      it("rejects empty messages", async () => {
        const adapter = createAdapter();
        const chat = createMockChat();

        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        await expect(
          adapter.postMessage("messenger:USER_123", "  ")
        ).rejects.toThrow(ValidationError);
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

        await adapter.postMessage("messenger:USER_123", longText);

        const [, options] = mockFetch.mock.calls[1];
        const body = JSON.parse(options?.body as string);
        expect(body.message.text.length).toBeLessThanOrEqual(2000);
        expect(body.message.text).toMatch(TRAILING_ELLIPSIS_PATTERN);
      });

      it("caches sent message so it is fetchable", async () => {
        const adapter = createAdapter();
        const chat = createMockChat();
        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        mockFetch.mockResolvedValueOnce(
          graphApiOk({ recipient_id: "USER_123", message_id: "mid.cached" })
        );

        await adapter.postMessage("messenger:USER_123", "cached msg");

        const fetched = await adapter.fetchMessage(
          "messenger:USER_123",
          "mid.cached"
        );
        expect(fetched).not.toBeNull();
        expect(fetched?.text).toContain("cached msg");
        expect(fetched?.author.isMe).toBe(true);
      });

      it("posts message with markdown content", async () => {
        const adapter = createAdapter();
        const chat = createMockChat();
        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        mockFetch.mockResolvedValueOnce(
          graphApiOk({ recipient_id: "USER_123", message_id: "mid.md" })
        );

        await adapter.postMessage("messenger:USER_123", {
          markdown: "**bold** and *italic*",
        });

        const [, options] = mockFetch.mock.calls[1];
        const body = JSON.parse(options?.body as string);
        expect(body.message.text).toContain("bold");
        expect(body.message.text).toContain("italic");
      });

      it("posts message with AST content", async () => {
        const adapter = createAdapter();
        const chat = createMockChat();
        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        mockFetch.mockResolvedValueOnce(
          graphApiOk({ recipient_id: "USER_123", message_id: "mid.ast" })
        );

        await adapter.postMessage("messenger:USER_123", {
          ast: {
            type: "root",
            children: [
              {
                type: "paragraph",
                children: [{ type: "text", value: "ast content" }],
              },
            ],
          },
        });

        const [, options] = mockFetch.mock.calls[1];
        const body = JSON.parse(options?.body as string);
        expect(body.message.text).toContain("ast content");
      });

      it("handles exactly 2000 characters without truncation", async () => {
        const adapter = createAdapter();
        const chat = createMockChat();
        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        mockFetch.mockResolvedValueOnce(
          graphApiOk({ recipient_id: "USER_123", message_id: "mid.trunc" })
        );

        const exactText = "x".repeat(2000);
        await adapter.postMessage("messenger:USER_123", exactText);

        const [, options] = mockFetch.mock.calls[1];
        const body = JSON.parse(options?.body as string);
        expect(body.message.text).toBe(exactText);
        expect(body.message.text.length).toBe(2000);
      });

      it("truncates at 2001 characters to 2000 with trailing ellipsis", async () => {
        const adapter = createAdapter();
        const chat = createMockChat();
        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        mockFetch.mockResolvedValueOnce(
          graphApiOk({ recipient_id: "USER_123", message_id: "mid.trunc2" })
        );

        const overText = "y".repeat(2001);
        await adapter.postMessage("messenger:USER_123", overText);

        const [, options] = mockFetch.mock.calls[1];
        const body = JSON.parse(options?.body as string);
        expect(body.message.text.length).toBe(2000);
        expect(body.message.text).toMatch(TRAILING_ELLIPSIS_PATTERN);
      });
    });

    describe("card templates", () => {
      it("sends a Generic Template for cards with title and buttons", async () => {
        const adapter = createAdapter();
        const chat = createMockChat();
        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        mockFetch.mockResolvedValueOnce(
          graphApiOk({ recipient_id: "USER_123", message_id: "mid.template" })
        );

        await adapter.postMessage("messenger:USER_123", {
          type: "card",
          title: "Welcome",
          children: [
            { type: "text", content: "Hello!" },
            {
              type: "actions",
              children: [
                { type: "button", id: "start", label: "Start" },
                { type: "button", id: "help", label: "Help" },
              ],
            },
          ],
        });

        const [, options] = mockFetch.mock.calls[1];
        const body = JSON.parse(options?.body as string);
        expect(body.message.attachment).toBeDefined();
        expect(body.message.attachment.type).toBe("template");
        expect(body.message.attachment.payload.template_type).toBe("generic");
        expect(body.message.attachment.payload.elements).toHaveLength(1);
        expect(body.message.attachment.payload.elements[0].title).toBe(
          "Welcome"
        );
        expect(
          body.message.attachment.payload.elements[0].buttons
        ).toHaveLength(2);
      });

      it("sends a Button Template for cards without title but with text and buttons", async () => {
        const adapter = createAdapter();
        const chat = createMockChat();
        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        mockFetch.mockResolvedValueOnce(
          graphApiOk({
            recipient_id: "USER_123",
            message_id: "mid.btntemplate",
          })
        );

        await adapter.postMessage("messenger:USER_123", {
          type: "card",
          children: [
            { type: "text", content: "Please choose:" },
            {
              type: "actions",
              children: [{ type: "button", id: "opt1", label: "Option 1" }],
            },
          ],
        });

        const [, options] = mockFetch.mock.calls[1];
        const body = JSON.parse(options?.body as string);
        expect(body.message.attachment.payload.template_type).toBe("button");
        expect(body.message.attachment.payload.text).toBe("Please choose:");
      });

      it("falls back to text for cards with unsupported elements", async () => {
        const adapter = createAdapter();
        const chat = createMockChat();
        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        mockFetch.mockResolvedValueOnce(
          graphApiOk({
            recipient_id: "USER_123",
            message_id: "mid.textfallback",
          })
        );

        await adapter.postMessage("messenger:USER_123", {
          type: "card",
          title: "With Table",
          children: [
            {
              type: "table",
              headers: ["A", "B"],
              rows: [["1", "2"]],
            },
          ],
        });

        const [, options] = mockFetch.mock.calls[1];
        const body = JSON.parse(options?.body as string);
        expect(body.message.text).toBeDefined();
        expect(body.message.attachment).toBeUndefined();
        expect(body.message.text).toContain("With Table");
      });
    });

    describe("streaming", () => {
      it("buffers stream chunks and sends as a single message", async () => {
        const adapter = createAdapter();
        const chat = createMockChat();

        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        mockFetch.mockResolvedValueOnce(
          graphApiOk({ recipient_id: "USER_123", message_id: "mid.streamed" })
        );

        async function* chunks() {
          yield "Hello";
          yield " ";
          yield "world";
        }

        const result = await adapter.stream("messenger:USER_123", chunks());

        expect(mockFetch).toHaveBeenCalledTimes(2);
        const [, options] = mockFetch.mock.calls[1];
        const body = JSON.parse(options?.body as string);
        expect(body.message.text).toBe("Hello world");
        expect(result.id).toBe("mid.streamed");
      });

      it("handles StreamChunk objects in stream", async () => {
        const adapter = createAdapter();
        const chat = createMockChat();

        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        mockFetch.mockResolvedValueOnce(
          graphApiOk({ recipient_id: "USER_123", message_id: "mid.streamed" })
        );

        async function* chunks() {
          yield { type: "markdown_text" as const, text: "Structured " };
          yield "plain ";
          yield { type: "markdown_text" as const, text: "content" };
        }

        const result = await adapter.stream("messenger:USER_123", chunks());

        const [, options] = mockFetch.mock.calls[1];
        const body = JSON.parse(options?.body as string);
        expect(body.message.text).toBe("Structured plain content");
        expect(result.id).toBe("mid.streamed");
      });
    });

    describe("typing indicator", () => {
      it("starts typing indicator", async () => {
        const adapter = createAdapter();
        const chat = createMockChat();

        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        mockFetch.mockResolvedValueOnce(
          graphApiOk({ recipient_id: "USER_123" })
        );

        await adapter.startTyping("messenger:USER_123");
        expect(mockFetch).toHaveBeenCalledTimes(2);

        const [url, options] = mockFetch.mock.calls[1];
        expect(url.toString()).toContain("me/messages");
        const body = JSON.parse(options?.body as string);
        expect(body.sender_action).toBe("typing_on");
      });
    });

    describe("unsupported operations", () => {
      it("throws on editMessage", async () => {
        const adapter = createAdapter();
        await expect(
          adapter.editMessage("messenger:USER_123", "mid.1", "new text")
        ).rejects.toThrow(ValidationError);
      });

      it("throws on deleteMessage", async () => {
        const adapter = createAdapter();
        await expect(
          adapter.deleteMessage("messenger:USER_123", "mid.1")
        ).rejects.toThrow(ValidationError);
      });

      it("throws on addReaction", async () => {
        const adapter = createAdapter();
        await expect(
          adapter.addReaction("messenger:USER_123", "mid.1", "thumbsup")
        ).rejects.toThrow(ValidationError);
      });

      it("throws on removeReaction", async () => {
        const adapter = createAdapter();
        await expect(
          adapter.removeReaction("messenger:USER_123", "mid.1", "thumbsup")
        ).rejects.toThrow(ValidationError);
      });
    });
  });

  describe("message parsing", () => {
    it("parses raw messages", () => {
      const adapter = createAdapter();
      const event = sampleMessagingEvent();

      const parsed = adapter.parseMessage(event);
      expect(parsed.text).toBe("hello");
      expect(parsed.threadId).toBe("messenger:USER_123");
      expect(parsed.id).toBe("mid.abc123");
    });

    it("sets isMention to true for all inbound messages", () => {
      const adapter = createAdapter();
      const parsed = adapter.parseMessage(sampleMessagingEvent());
      expect(parsed.isMention).toBe(true);
    });

    it("marks echo messages as isMe and isBot", () => {
      const adapter = createAdapter();
      const chat = createMockChat();
      mockFetch.mockResolvedValueOnce(
        graphApiOk({ id: "PAGE_456", name: "Test Page" })
      );
      return adapter.initialize(chat).then(() => {
        const event = sampleMessagingEvent({
          sender: { id: "PAGE_456" },
          message: { mid: "mid.echo", text: "bot says", is_echo: true },
        });
        const parsed = adapter.parseMessage(event);
        expect(parsed.author.isMe).toBe(true);
        expect(parsed.author.isBot).toBe(true);
      });
    });

    it("parses message with empty text as empty string", () => {
      const adapter = createAdapter();
      const event = sampleMessagingEvent({
        message: { mid: "mid.empty", text: undefined } as never,
      });
      const parsed = adapter.parseMessage(event);
      expect(parsed.text).toBe("");
    });

    it("parses message with quick_reply payload", () => {
      const adapter = createAdapter();
      const event = sampleMessagingEvent({
        message: {
          mid: "mid.qr",
          text: "Yes",
          quick_reply: { payload: "QR_YES" },
        },
      });
      const parsed = adapter.parseMessage(event);
      expect(parsed.text).toBe("Yes");
      expect(parsed.id).toBe("mid.qr");
    });

    it("handles message with no text and no postback title", () => {
      const adapter = createAdapter();
      const event: MessengerMessagingEvent = {
        sender: { id: "USER_123" },
        recipient: { id: "PAGE_456" },
        timestamp: 1735689600000,
        message: {
          mid: "mid.attach-only",
          attachments: [
            { type: "image", payload: { url: "https://example.com/img.jpg" } },
          ],
        },
      };
      const parsed = adapter.parseMessage(event);
      expect(parsed.text).toBe("");
      expect(parsed.attachments).toHaveLength(1);
    });

    it("uses event timestamp for ID when no mid", () => {
      const adapter = createAdapter();
      const event: MessengerMessagingEvent = {
        sender: { id: "USER_123" },
        recipient: { id: "PAGE_456" },
        timestamp: 1735689600000,
        postback: { title: "Get Started", payload: "START" },
      };

      const parsed = adapter.parseMessage(event);
      expect(parsed.id).toBe("event:1735689600000");
      expect(parsed.text).toBe("Get Started");
    });

    it("updates cached message when same ID is parsed again", () => {
      const adapter = createAdapter();
      const event1 = sampleMessagingEvent({
        message: { mid: "mid.dup", text: "first" },
      });
      const event2 = sampleMessagingEvent({
        message: { mid: "mid.dup", text: "updated" },
      });

      adapter.parseMessage(event1);
      const updated = adapter.parseMessage(event2);
      expect(updated.text).toBe("updated");
    });

    it("sorts messages by timestamp then by sequence number", () => {
      const adapter = createAdapter();

      adapter.parseMessage({
        sender: { id: "USER_123" },
        recipient: { id: "PAGE_456" },
        timestamp: 1735689600000,
        message: { mid: "mid.abc:2", text: "second" },
      });
      adapter.parseMessage({
        sender: { id: "USER_123" },
        recipient: { id: "PAGE_456" },
        timestamp: 1735689600000,
        message: { mid: "mid.abc:1", text: "first" },
      });

      return adapter.fetchMessages("messenger:USER_123").then((result) => {
        expect(result.messages[0].text).toBe("first");
        expect(result.messages[1].text).toBe("second");
      });
    });
  });

  describe("attachments", () => {
    it("extracts attachments from messages", async () => {
      const adapter = createAdapter();
      const event = sampleMessagingEvent({
        message: {
          mid: "mid.attach",
          text: "check this",
          attachments: [
            { type: "image", payload: { url: "https://example.com/img.jpg" } },
            { type: "video", payload: { url: "https://example.com/vid.mp4" } },
            { type: "audio", payload: { url: "https://example.com/aud.mp3" } },
            { type: "file", payload: { url: "https://example.com/doc.pdf" } },
            {
              type: "fallback",
              payload: { url: "https://example.com/fallback" },
            },
          ],
        },
      });

      const parsed = adapter.parseMessage(event);
      expect(parsed.attachments).toHaveLength(5);
      expect(parsed.attachments[0].type).toBe("image");
      expect(parsed.attachments[1].type).toBe("video");
      expect(parsed.attachments[2].type).toBe("audio");
      expect(parsed.attachments[3].type).toBe("file");
      expect(parsed.attachments[4].type).toBe("file");
    });

    it("skips attachments without URL", () => {
      const adapter = createAdapter();
      const event = sampleMessagingEvent({
        message: {
          mid: "mid.nourl",
          text: "sticker",
          attachments: [
            { type: "image", payload: { sticker_id: 123 } },
            { type: "image" },
          ],
        },
      });

      const parsed = adapter.parseMessage(event);
      expect(parsed.attachments).toHaveLength(0);
    });

    it("downloads attachment successfully", async () => {
      const adapter = createAdapter();
      const event = sampleMessagingEvent({
        message: {
          mid: "mid.dl",
          text: "photo",
          attachments: [
            { type: "image", payload: { url: "https://example.com/img.jpg" } },
          ],
        },
      });

      const parsed = adapter.parseMessage(event);
      const attachment = parsed.attachments[0];

      const imageData = Buffer.from("fake-image-data");
      mockFetch.mockResolvedValueOnce(new Response(imageData, { status: 200 }));

      const result = await attachment.fetchData?.();
      expect(result).toBeInstanceOf(Buffer);
    });

    it("throws NetworkError when attachment download fails", async () => {
      const adapter = createAdapter();
      const event = sampleMessagingEvent({
        message: {
          mid: "mid.dlerr",
          text: "photo",
          attachments: [
            { type: "image", payload: { url: "https://example.com/img.jpg" } },
          ],
        },
      });

      const parsed = adapter.parseMessage(event);
      const attachment = parsed.attachments[0];

      mockFetch.mockRejectedValueOnce(new Error("Network failure"));

      await expect(attachment.fetchData?.()).rejects.toThrow(NetworkError);
    });

    it("throws NetworkError when attachment download returns non-ok", async () => {
      const adapter = createAdapter();
      const event = sampleMessagingEvent({
        message: {
          mid: "mid.dl404",
          text: "photo",
          attachments: [
            { type: "image", payload: { url: "https://example.com/img.jpg" } },
          ],
        },
      });

      const parsed = adapter.parseMessage(event);
      const attachment = parsed.attachments[0];

      mockFetch.mockResolvedValueOnce(
        new Response("Not Found", { status: 404 })
      );

      await expect(attachment.fetchData?.()).rejects.toThrow(NetworkError);
    });

    it("maps location attachment type to file", () => {
      const adapter = createAdapter();
      const event = sampleMessagingEvent({
        message: {
          mid: "mid.loc",
          text: "location",
          attachments: [
            {
              type: "location",
              payload: { url: "https://maps.example.com/loc" },
            },
          ],
        },
      });
      const parsed = adapter.parseMessage(event);
      expect(parsed.attachments).toHaveLength(1);
      expect(parsed.attachments[0].type).toBe("file");
    });

    it("handles mix of attachments with and without URLs", () => {
      const adapter = createAdapter();
      const event = sampleMessagingEvent({
        message: {
          mid: "mid.mixed",
          text: "mixed",
          attachments: [
            { type: "image", payload: { url: "https://example.com/img.jpg" } },
            { type: "image", payload: { sticker_id: 369239263222822 } },
            { type: "video", payload: { url: "https://example.com/vid.mp4" } },
            { type: "fallback" },
          ],
        },
      });
      const parsed = adapter.parseMessage(event);
      expect(parsed.attachments).toHaveLength(2);
      expect(parsed.attachments[0].type).toBe("image");
      expect(parsed.attachments[1].type).toBe("video");
    });

    it("returns empty attachments when message has no attachments field", () => {
      const adapter = createAdapter();
      const event = sampleMessagingEvent({
        message: { mid: "mid.noatt", text: "plain text" },
      });
      const parsed = adapter.parseMessage(event);
      expect(parsed.attachments).toEqual([]);
    });
  });

  describe("message fetching", () => {
    async function initAdapterWithMessages() {
      const adapter = createAdapter();
      const chat = createMockChat();
      mockFetch.mockResolvedValueOnce(
        graphApiOk({ id: "PAGE_456", name: "Test Page" })
      );
      await adapter.initialize(chat);

      for (let i = 1; i <= 5; i++) {
        adapter.parseMessage({
          sender: { id: "USER_123" },
          recipient: { id: "PAGE_456" },
          timestamp: 1735689600000 + i * 1000,
          message: { mid: `mid.${i}`, text: `message ${i}` },
        });
      }

      return adapter;
    }

    it("returns empty result for unknown thread", async () => {
      const adapter = createAdapter();
      const result = await adapter.fetchMessages("messenger:UNKNOWN");
      expect(result.messages).toEqual([]);
    });

    it("fetches messages backward (default)", async () => {
      const adapter = await initAdapterWithMessages();
      const result = await adapter.fetchMessages("messenger:USER_123", {
        limit: 3,
      });
      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].id).toBe("mid.3");
      expect(result.messages[2].id).toBe("mid.5");
      expect(result.nextCursor).toBe("mid.3");
    });

    it("fetches messages backward with cursor", async () => {
      const adapter = await initAdapterWithMessages();
      const result = await adapter.fetchMessages("messenger:USER_123", {
        limit: 2,
        cursor: "mid.3",
        direction: "backward",
      });
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].id).toBe("mid.1");
      expect(result.messages[1].id).toBe("mid.2");
    });

    it("fetches messages forward", async () => {
      const adapter = await initAdapterWithMessages();
      const result = await adapter.fetchMessages("messenger:USER_123", {
        limit: 2,
        direction: "forward",
      });
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].id).toBe("mid.1");
      expect(result.messages[1].id).toBe("mid.2");
      expect(result.nextCursor).toBe("mid.2");
    });

    it("fetches messages forward with cursor", async () => {
      const adapter = await initAdapterWithMessages();
      const result = await adapter.fetchMessages("messenger:USER_123", {
        limit: 2,
        cursor: "mid.2",
        direction: "forward",
      });
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].id).toBe("mid.3");
      expect(result.messages[1].id).toBe("mid.4");
      expect(result.nextCursor).toBe("mid.4");
    });

    it("returns no nextCursor when all messages are returned", async () => {
      const adapter = await initAdapterWithMessages();
      const result = await adapter.fetchMessages("messenger:USER_123", {
        limit: 100,
      });
      expect(result.messages).toHaveLength(5);
      expect(result.nextCursor).toBeUndefined();
    });

    it("returns null for non-existent message", async () => {
      const adapter = createAdapter();
      const result = await adapter.fetchMessage(
        "messenger:USER_123",
        "mid.nonexistent"
      );
      expect(result).toBeNull();
    });

    describe("pagination edge cases", () => {
      async function initAdapterWithNumberedMessages(count: number) {
        const adapter = createAdapter();
        const chat = createMockChat();
        mockFetch.mockResolvedValueOnce(
          graphApiOk({ id: "PAGE_456", name: "Test Page" })
        );
        await adapter.initialize(chat);

        for (let i = 1; i <= count; i++) {
          adapter.parseMessage({
            sender: { id: "USER_123" },
            recipient: { id: "PAGE_456" },
            timestamp: 1735689600000 + i * 1000,
            message: { mid: `mid.${i}`, text: `message ${i}` },
          });
        }

        return adapter;
      }

      it("clamps negative limit to 1", async () => {
        const adapter = await initAdapterWithNumberedMessages(5);
        const result = await adapter.fetchMessages("messenger:USER_123", {
          limit: -10,
        });
        expect(result.messages).toHaveLength(1);
      });

      it("clamps limit above 100 to 100", async () => {
        const adapter = await initAdapterWithNumberedMessages(5);
        const result = await adapter.fetchMessages("messenger:USER_123", {
          limit: 500,
        });
        expect(result.messages).toHaveLength(5);
      });

      it("returns no nextCursor for forward from last message", async () => {
        const adapter = await initAdapterWithNumberedMessages(3);
        const result = await adapter.fetchMessages("messenger:USER_123", {
          cursor: "mid.3",
          direction: "forward",
          limit: 10,
        });
        expect(result.messages).toHaveLength(0);
        expect(result.nextCursor).toBeUndefined();
      });

      it("returns no nextCursor for backward from first message", async () => {
        const adapter = await initAdapterWithNumberedMessages(3);
        const result = await adapter.fetchMessages("messenger:USER_123", {
          cursor: "mid.1",
          direction: "backward",
          limit: 10,
        });
        expect(result.messages).toHaveLength(0);
        expect(result.nextCursor).toBeUndefined();
      });

      it("ignores unknown cursor for backward and returns from end", async () => {
        const adapter = await initAdapterWithNumberedMessages(3);
        const result = await adapter.fetchMessages("messenger:USER_123", {
          cursor: "mid.nonexistent",
          direction: "backward",
          limit: 2,
        });
        expect(result.messages).toHaveLength(2);
        expect(result.messages[1].id).toBe("mid.3");
      });

      it("ignores unknown cursor for forward and returns from start", async () => {
        const adapter = await initAdapterWithNumberedMessages(3);
        const result = await adapter.fetchMessages("messenger:USER_123", {
          cursor: "mid.nonexistent",
          direction: "forward",
          limit: 2,
        });
        expect(result.messages).toHaveLength(2);
        expect(result.messages[0].id).toBe("mid.1");
      });

      it("uses default limit of 50 when not specified", async () => {
        const adapter = await initAdapterWithNumberedMessages(3);
        const result = await adapter.fetchMessages("messenger:USER_123");
        expect(result.messages).toHaveLength(3);
      });
    });
  });

  describe("thread and channel info", () => {
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

      const threadInfo = await adapter.fetchThread("messenger:USER_123");
      expect(threadInfo.channelName).toBe("John Doe");
      expect(threadInfo.isDM).toBe(true);
    });

    it("fetches channel info with user profile", async () => {
      const adapter = createAdapter();
      const chat = createMockChat();
      mockFetch.mockResolvedValueOnce(
        graphApiOk({ id: "PAGE_456", name: "Test Page" })
      );
      await adapter.initialize(chat);

      mockFetch.mockResolvedValueOnce(
        graphApiOk({
          id: "USER_123",
          first_name: "Jane",
          last_name: "Smith",
        })
      );

      const info = await adapter.fetchChannelInfo("USER_123");
      expect(info.name).toBe("Jane Smith");
      expect(info.isDM).toBe(true);
    });

    it("falls back to user ID when profile fetch fails", async () => {
      const adapter = createAdapter();
      const chat = createMockChat();
      mockFetch.mockResolvedValueOnce(
        graphApiOk({ id: "PAGE_456", name: "Test Page" })
      );
      await adapter.initialize(chat);

      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const info = await adapter.fetchChannelInfo("USER_123");
      expect(info.name).toBe("USER_123");
    });

    it("falls back to user ID when profile has no name", async () => {
      const adapter = createAdapter();
      const chat = createMockChat();
      mockFetch.mockResolvedValueOnce(
        graphApiOk({ id: "PAGE_456", name: "Test Page" })
      );
      await adapter.initialize(chat);

      mockFetch.mockResolvedValueOnce(graphApiOk({ id: "USER_123" }));

      const threadInfo = await adapter.fetchThread("messenger:USER_123");
      expect(threadInfo.channelName).toBe("USER_123");
    });

    it("caches user profiles on second call", async () => {
      const adapter = createAdapter();
      const chat = createMockChat();
      mockFetch.mockResolvedValueOnce(
        graphApiOk({ id: "PAGE_456", name: "Test Page" })
      );
      await adapter.initialize(chat);

      mockFetch.mockResolvedValueOnce(
        graphApiOk({ id: "USER_123", first_name: "John" })
      );

      await adapter.fetchThread("messenger:USER_123");
      await adapter.fetchThread("messenger:USER_123");

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("uses only first name when last name is missing", async () => {
      const adapter = createAdapter();
      const chat = createMockChat();
      mockFetch.mockResolvedValueOnce(
        graphApiOk({ id: "PAGE_456", name: "Test Page" })
      );
      await adapter.initialize(chat);

      mockFetch.mockResolvedValueOnce(
        graphApiOk({ id: "USER_123", first_name: "Alice" })
      );

      const info = await adapter.fetchThread("messenger:USER_123");
      expect(info.channelName).toBe("Alice");
    });

    it("uses only last name when first name is missing", async () => {
      const adapter = createAdapter();
      const chat = createMockChat();
      mockFetch.mockResolvedValueOnce(
        graphApiOk({ id: "PAGE_456", name: "Test Page" })
      );
      await adapter.initialize(chat);

      mockFetch.mockResolvedValueOnce(
        graphApiOk({ id: "USER_123", last_name: "Smith" })
      );

      const info = await adapter.fetchThread("messenger:USER_123");
      expect(info.channelName).toBe("Smith");
    });
  });

  describe("DM operations", () => {
    it("always reports isDM as true", () => {
      const adapter = createAdapter();
      expect(adapter.isDM("messenger:USER_123")).toBe(true);
    });

    it("channelIdFromThreadId returns the thread ID", () => {
      const adapter = createAdapter();
      expect(adapter.channelIdFromThreadId("messenger:USER_123")).toBe(
        "messenger:USER_123"
      );
    });

    it("openDM returns encoded thread ID", async () => {
      const adapter = createAdapter();
      const threadId = await adapter.openDM("USER_123");
      expect(threadId).toBe("messenger:USER_123");
    });
  });

  describe("format conversion", () => {
    it("renderFormatted converts AST to string", () => {
      const adapter = createAdapter();
      const result = adapter.renderFormatted({
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "hello world" }],
          },
        ],
      });
      expect(result).toContain("hello world");
    });
  });

  describe("Graph API error handling", () => {
    async function initAndMockError(responseBody: unknown, status: number) {
      const adapter = createAdapter();
      const chat = createMockChat();
      mockFetch.mockResolvedValueOnce(
        graphApiOk({ id: "PAGE_456", name: "Test Page" })
      );
      await adapter.initialize(chat);

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(responseBody), { status })
      );

      return adapter;
    }

    it("throws AdapterRateLimitError on 429", async () => {
      const adapter = await initAndMockError(
        { error: { message: "Rate limited" } },
        429
      );
      await expect(adapter.startTyping("messenger:USER_123")).rejects.toThrow(
        AdapterRateLimitError
      );
    });

    it("throws AdapterRateLimitError on error code 4", async () => {
      const adapter = await initAndMockError(
        { error: { message: "Too many calls", code: 4 } },
        400
      );
      await expect(adapter.startTyping("messenger:USER_123")).rejects.toThrow(
        AdapterRateLimitError
      );
    });

    it("throws AdapterRateLimitError on error code 32", async () => {
      const adapter = await initAndMockError(
        { error: { message: "Page rate limit", code: 32 } },
        400
      );
      await expect(adapter.startTyping("messenger:USER_123")).rejects.toThrow(
        AdapterRateLimitError
      );
    });

    it("throws AdapterRateLimitError on error code 613", async () => {
      const adapter = await initAndMockError(
        { error: { message: "Custom rate limit", code: 613 } },
        400
      );
      await expect(adapter.startTyping("messenger:USER_123")).rejects.toThrow(
        AdapterRateLimitError
      );
    });

    it("throws AuthenticationError on 401", async () => {
      const adapter = await initAndMockError(
        { error: { message: "Invalid token", code: 190 } },
        401
      );
      await expect(adapter.startTyping("messenger:USER_123")).rejects.toThrow(
        AuthenticationError
      );
    });

    it("throws AuthenticationError on error code 190 regardless of status", async () => {
      const adapter = await initAndMockError(
        { error: { message: "Token expired", code: 190 } },
        400
      );
      await expect(adapter.startTyping("messenger:USER_123")).rejects.toThrow(
        AuthenticationError
      );
    });

    it("throws ValidationError on 403 (permission error)", async () => {
      const adapter = await initAndMockError(
        { error: { message: "Permission denied", code: 10 } },
        403
      );
      await expect(adapter.startTyping("messenger:USER_123")).rejects.toThrow(
        SharedValidationError
      );
    });

    it("throws ValidationError on error code 200 (permission)", async () => {
      const adapter = await initAndMockError(
        { error: { message: "Requires permission", code: 200 } },
        400
      );
      await expect(adapter.startTyping("messenger:USER_123")).rejects.toThrow(
        SharedValidationError
      );
    });

    it("throws ResourceNotFoundError on 404", async () => {
      const adapter = await initAndMockError(
        { error: { message: "Not found" } },
        404
      );
      await expect(adapter.startTyping("messenger:USER_123")).rejects.toThrow(
        ResourceNotFoundError
      );
    });

    it("throws NetworkError on generic API error", async () => {
      const adapter = await initAndMockError(
        { error: { message: "Internal error", code: 2 } },
        500
      );
      await expect(adapter.startTyping("messenger:USER_123")).rejects.toThrow(
        NetworkError
      );
    });

    it("throws NetworkError when fetch throws", async () => {
      const adapter = createAdapter();
      const chat = createMockChat();
      mockFetch.mockResolvedValueOnce(
        graphApiOk({ id: "PAGE_456", name: "Test Page" })
      );
      await adapter.initialize(chat);

      mockFetch.mockRejectedValueOnce(new Error("DNS failure"));

      await expect(adapter.startTyping("messenger:USER_123")).rejects.toThrow(
        NetworkError
      );
    });

    it("throws NetworkError when response is not valid JSON", async () => {
      const adapter = createAdapter();
      const chat = createMockChat();
      mockFetch.mockResolvedValueOnce(
        graphApiOk({ id: "PAGE_456", name: "Test Page" })
      );
      await adapter.initialize(chat);

      mockFetch.mockResolvedValueOnce(
        new Response("not json", {
          status: 200,
          headers: { "content-type": "text/plain" },
        })
      );

      await expect(adapter.startTyping("messenger:USER_123")).rejects.toThrow(
        NetworkError
      );
    });

    it("uses fallback message when error object has no message", async () => {
      const adapter = await initAndMockError({ error: { code: 999 } }, 500);
      await expect(adapter.startTyping("messenger:USER_123")).rejects.toThrow(
        MESSENGER_API_PATTERN
      );
    });

    it("uses status as code when error object has no code", async () => {
      const adapter = await initAndMockError(
        { error: { message: "Something failed" } },
        500
      );
      await expect(adapter.startTyping("messenger:USER_123")).rejects.toThrow(
        NetworkError
      );
    });

    it("handles response with no error object at all", async () => {
      const adapter = await initAndMockError({}, 500);
      await expect(adapter.startTyping("messenger:USER_123")).rejects.toThrow(
        NetworkError
      );
    });
  });
});

describe("subclass extensibility", () => {
  it("exposes protected members and methods to subclasses", () => {
    class TestSubclass extends MessengerAdapter {
      checkAccess() {
        // Compile-time check: if any of these revert to `private`, this fails to type-check.
        return [
          this.logger,
          this.formatConverter,
          this.verifySignature,
        ] as const;
      }
    }
    expect(TestSubclass.prototype.checkAccess).toBeInstanceOf(Function);
  });
});

// `encodeThreadId`/`decodeThreadId` are pure, so a single adapter instance (no
// init, no network) is enough to exercise the shared thread-id codec contract.
const threadIdAdapter = createAdapter();

threadIdContract<MessengerThreadId>({
  name: "messenger",
  encode: (decoded) => threadIdAdapter.encodeThreadId(decoded),
  decode: (id) => threadIdAdapter.decodeThreadId(id),
  cases: [
    { decoded: { recipientId: "USER_123" }, encoded: "messenger:USER_123" },
    { decoded: { recipientId: "1234567890" }, encoded: "messenger:1234567890" },
  ],
  // `isDM` is intentionally omitted: every Messenger thread is a 1:1 DM, so
  // there is no non-DM thread id to distinguish. The always-true behaviour is
  // asserted locally in the "DM operations" suite instead.
});

selfMessageContract({
  name: "messenger",
  dispatchHandler: "processMessage",
  setup: async () => {
    const chat = createMockChat();
    // The mocked /me lookup seeds a known page identity with no real network,
    // exactly like the other webhook tests.
    mockFetch.mockResolvedValueOnce(
      graphApiOk({ id: "PAGE_456", name: "Test Page" })
    );
    const adapter = createAdapter();
    await adapter.initialize(chat);
    return { adapter, chat };
  },
  makeOtherMessageRequest: () => {
    const body = JSON.stringify(createWebhookPayload([sampleMessagingEvent()]));
    return new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signPayload(body),
      },
      body,
    });
  },
  makeSelfMessageRequest: () => {
    const body = JSON.stringify(
      createWebhookPayload([
        sampleMessagingEvent({
          sender: { id: "PAGE_456" },
          recipient: { id: "USER_123" },
          message: { mid: "mid.echo", text: "bot reply", is_echo: true },
        }),
      ])
    );
    return new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signPayload(body),
      },
      body,
    });
  },
});
