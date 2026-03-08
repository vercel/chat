import {
  AdapterRateLimitError,
  AuthenticationError,
  ValidationError,
} from "@chat-adapter/shared";
import type { ChatInstance, Logger } from "chat";
import { NotImplementedError } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTelnyxAdapter, TelnyxAdapter } from "./index";
import type { TelnyxWebhookPayload } from "./types";

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

function createMockChat(options?: { userName?: string }): ChatInstance {
  return {
    getLogger: vi.fn().mockReturnValue(mockLogger),
    getState: vi.fn(),
    getUserName: vi.fn().mockReturnValue(options?.userName ?? "mybot"),
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
    processMemberJoinedChannel: vi.fn(),
  } as unknown as ChatInstance;
}

function sampleWebhookPayload(
  overrides?: Partial<TelnyxWebhookPayload["data"]["payload"]>
): TelnyxWebhookPayload {
  return {
    data: {
      event_type: "message.received",
      id: "evt-123",
      occurred_at: "2025-01-01T00:00:00Z",
      record_type: "event",
      payload: {
        direction: "inbound",
        from: { phone_number: "+15551234567" },
        to: [{ phone_number: "+15559876543" }],
        text: "Hello",
        type: "SMS",
        id: "msg-123",
        ...overrides,
      },
    },
    meta: {
      attempt: 1,
      delivered_to: "https://example.com/webhook",
    },
  };
}

describe("TelnyxAdapter", () => {
  describe("constructor", () => {
    it("creates adapter with config params", () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      expect(adapter.name).toBe("telnyx");
      expect(adapter.botUserId).toBe("+15559876543");
    });

    it("reads config from env vars", () => {
      process.env.TELNYX_API_KEY = "env-key";
      process.env.TELNYX_FROM_NUMBER = "+15550001111";
      try {
        const adapter = new TelnyxAdapter({ logger: mockLogger });
        expect(adapter.botUserId).toBe("+15550001111");
      } finally {
        Reflect.deleteProperty(process.env, "TELNYX_API_KEY");
        Reflect.deleteProperty(process.env, "TELNYX_FROM_NUMBER");
      }
    });

    it("throws if apiKey is missing", () => {
      expect(() => new TelnyxAdapter({ phoneNumber: "+15550001111" })).toThrow(
        ValidationError
      );
    });

    it("throws if phoneNumber is missing", () => {
      expect(() => new TelnyxAdapter({ apiKey: "test-key" })).toThrow(
        ValidationError
      );
    });
  });

  describe("createTelnyxAdapter", () => {
    it("creates an adapter instance", () => {
      const adapter = createTelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      expect(adapter).toBeInstanceOf(TelnyxAdapter);
    });
  });

  describe("handleWebhook", () => {
    it("processes message.received events", async () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      const chat = createMockChat();
      await adapter.initialize(chat);

      const payload = sampleWebhookPayload();
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "content-type": "application/json" },
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
      expect(chat.processMessage).toHaveBeenCalledOnce();
    });

    it("ignores non-message events", async () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      const chat = createMockChat();
      await adapter.initialize(chat);

      const payload = sampleWebhookPayload();
      payload.data.event_type = "message.sent";

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "content-type": "application/json" },
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
      expect(chat.processMessage).not.toHaveBeenCalled();
    });

    it("returns 401 for missing signature when publicKey configured", async () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        publicKey:
          "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        logger: mockLogger,
      });
      const chat = createMockChat();
      await adapter.initialize(chat);

      const payload = sampleWebhookPayload();
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "content-type": "application/json" },
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(401);
    });

    it("returns 401 for stale timestamp", async () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        publicKey:
          "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        logger: mockLogger,
      });
      const chat = createMockChat();
      await adapter.initialize(chat);

      const payload = sampleWebhookPayload();
      const staleTimestamp = String(Math.floor(Date.now() / 1000) - 600);
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: {
          "content-type": "application/json",
          "telnyx-signature-ed25519": "dGVzdA==",
          "telnyx-timestamp": staleTimestamp,
        },
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(401);
      expect(await response.text()).toBe("Stale timestamp");
    });

    it("returns 400 for invalid JSON", async () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      const chat = createMockChat();
      await adapter.initialize(chat);

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: "not json",
        headers: { "content-type": "application/json" },
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(400);
    });
  });

  describe("postMessage", () => {
    it("sends SMS via API", async () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      const chat = createMockChat();
      await adapter.initialize(chat);

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "msg-456",
              from: { phone_number: "+15559876543" },
              to: [{ phone_number: "+15551234567" }],
              text: "Hello back",
              type: "SMS",
              direction: "outbound",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

      const result = await adapter.postMessage(
        "telnyx:+15559876543:+15551234567",
        "Hello back"
      );

      expect(result.id).toBe("msg-456");
      expect(mockFetch).toHaveBeenCalledOnce();

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.telnyx.com/v2/messages");
      const body = JSON.parse(init?.body as string);
      expect(body.from).toBe("+15559876543");
      expect(body.to).toBe("+15551234567");
      expect(body.text).toBe("Hello back");
    });

    it("sends MMS with media_urls when attachments have URLs", async () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      const chat = createMockChat();
      await adapter.initialize(chat);

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "msg-mms",
              from: { phone_number: "+15559876543" },
              to: [{ phone_number: "+15551234567" }],
              text: "Check this out",
              type: "MMS",
              direction: "outbound",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

      await adapter.postMessage("telnyx:+15559876543:+15551234567", {
        raw: "Check this out",
        attachments: [
          {
            type: "image",
            mimeType: "image/jpeg",
            url: "https://example.com/photo.jpg",
          },
        ],
      });

      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse(init?.body as string);
      expect(body.media_urls).toEqual(["https://example.com/photo.jpg"]);
      expect(body.type).toBe("MMS");
    });

    it("throws AdapterRateLimitError on 429", async () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      const chat = createMockChat();
      await adapter.initialize(chat);

      mockFetch.mockResolvedValueOnce(
        new Response("Too Many Requests", { status: 429 })
      );

      await expect(
        adapter.postMessage("telnyx:+15559876543:+15551234567", "test")
      ).rejects.toThrow(AdapterRateLimitError);
    });

    it("extracts retry-after from 429 response", async () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      const chat = createMockChat();
      await adapter.initialize(chat);

      mockFetch.mockResolvedValueOnce(
        new Response("Too Many Requests", {
          status: 429,
          headers: { "retry-after": "30" },
        })
      );

      try {
        await adapter.postMessage("telnyx:+15559876543:+15551234567", "test");
      } catch (error) {
        expect(error).toBeInstanceOf(AdapterRateLimitError);
        expect((error as AdapterRateLimitError).retryAfter).toBe(30);
      }
    });

    it("parses structured Telnyx error responses", async () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      const chat = createMockChat();
      await adapter.initialize(chat);

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            errors: [
              {
                title: "Invalid destination",
                detail: "The destination number is not valid",
                code: "40300",
              },
            ],
          }),
          { status: 422 }
        )
      );

      await expect(
        adapter.postMessage("telnyx:+15559876543:+15551234567", "test")
      ).rejects.toThrow("Invalid destination");
    });

    it("falls back to raw text for non-JSON error responses", async () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      const chat = createMockChat();
      await adapter.initialize(chat);

      mockFetch.mockResolvedValueOnce(
        new Response("Internal Server Error", { status: 500 })
      );

      await expect(
        adapter.postMessage("telnyx:+15559876543:+15551234567", "test")
      ).rejects.toThrow("Internal Server Error");
    });

    it("throws AuthenticationError on 401", async () => {
      const adapter = new TelnyxAdapter({
        apiKey: "bad-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      const chat = createMockChat();
      await adapter.initialize(chat);

      mockFetch.mockResolvedValueOnce(
        new Response("Unauthorized", { status: 401 })
      );

      await expect(
        adapter.postMessage("telnyx:+15559876543:+15551234567", "test")
      ).rejects.toThrow(AuthenticationError);
    });
  });

  describe("editMessage / deleteMessage / addReaction / removeReaction", () => {
    it("editMessage throws NotImplementedError", async () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      await expect(
        adapter.editMessage("thread", "msg", "text")
      ).rejects.toThrow(NotImplementedError);
    });

    it("deleteMessage throws NotImplementedError", async () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      await expect(adapter.deleteMessage("thread", "msg")).rejects.toThrow(
        NotImplementedError
      );
    });

    it("addReaction throws NotImplementedError", async () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      await expect(
        adapter.addReaction("thread", "msg", "thumbsup")
      ).rejects.toThrow(NotImplementedError);
    });

    it("removeReaction throws NotImplementedError", async () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      await expect(
        adapter.removeReaction("thread", "msg", "thumbsup")
      ).rejects.toThrow(NotImplementedError);
    });
  });

  describe("startTyping", () => {
    it("resolves without error (no-op)", async () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      await expect(
        adapter.startTyping("telnyx:+15559876543:+15551234567")
      ).resolves.toBeUndefined();
    });
  });

  describe("encodeThreadId / decodeThreadId", () => {
    it("round-trips thread IDs", () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });

      const data = {
        telnyxNumber: "+15559876543",
        recipientNumber: "+15551234567",
      };
      const encoded = adapter.encodeThreadId(data);
      expect(encoded).toBe("telnyx:+15559876543:+15551234567");

      const decoded = adapter.decodeThreadId(encoded);
      expect(decoded).toEqual(data);
    });

    it("throws on invalid format", () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      expect(() => adapter.decodeThreadId("invalid")).toThrow(ValidationError);
    });

    it("throws on non-E.164 format", () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      expect(() => adapter.decodeThreadId("telnyx:123:456")).toThrow(
        ValidationError
      );
    });
  });

  describe("parseMessage", () => {
    it("extracts text and author", () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });

      const message = adapter.parseMessage({
        id: "msg-789",
        text: "Test message",
        from: { phone_number: "+15551234567" },
        to: [{ phone_number: "+15559876543" }],
        direction: "inbound",
        type: "SMS",
      });

      expect(message.text).toBe("Test message");
      expect(message.author.userId).toBe("+15551234567");
      expect(message.author.isMe).toBe(false);
    });

    it("detects bot messages", () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });

      const message = adapter.parseMessage({
        id: "msg-789",
        text: "Bot reply",
        from: { phone_number: "+15559876543" },
        to: [{ phone_number: "+15551234567" }],
        direction: "outbound",
        type: "SMS",
      });

      expect(message.author.isMe).toBe(true);
      expect(message.author.isBot).toBe(true);
    });

    it("sets isMention true for inbound messages", () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });

      const message = adapter.parseMessage({
        id: "msg-789",
        text: "Hello",
        from: { phone_number: "+15551234567" },
        to: [{ phone_number: "+15559876543" }],
        direction: "inbound",
        type: "SMS",
      });

      expect(message.isMention).toBe(true);
    });

    it("sets isMention false for bot's own messages", () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });

      const message = adapter.parseMessage({
        id: "msg-789",
        text: "Bot reply",
        from: { phone_number: "+15559876543" },
        to: [{ phone_number: "+15551234567" }],
        direction: "outbound",
        type: "SMS",
      });

      expect(message.isMention).toBe(false);
    });

    it("extracts media attachments", () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });

      const message = adapter.parseMessage({
        id: "msg-789",
        text: "Image",
        from: { phone_number: "+15551234567" },
        to: [{ phone_number: "+15559876543" }],
        direction: "inbound",
        type: "MMS",
        media: [
          {
            content_type: "image/jpeg",
            url: "https://example.com/image.jpg",
            size: 1024,
          },
        ],
      });

      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0].mimeType).toBe("image/jpeg");
      expect(message.attachments[0].url).toBe("https://example.com/image.jpg");
    });
  });

  describe("isDM", () => {
    it("always returns true", () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      expect(adapter.isDM()).toBe(true);
    });
  });

  describe("openDM", () => {
    it("returns encoded thread ID", async () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      const threadId = await adapter.openDM("+15551234567");
      expect(threadId).toBe("telnyx:+15559876543:+15551234567");
    });
  });

  describe("fetchThread", () => {
    it("returns thread info with isDM true", async () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      const info = await adapter.fetchThread(
        "telnyx:+15559876543:+15551234567"
      );
      expect(info.isDM).toBe(true);
      expect(info.metadata.recipientNumber).toBe("+15551234567");
    });
  });

  describe("fetchMessages", () => {
    it("returns empty results", async () => {
      const adapter = new TelnyxAdapter({
        apiKey: "test-key",
        phoneNumber: "+15559876543",
        logger: mockLogger,
      });
      const result = await adapter.fetchMessages(
        "telnyx:+15559876543:+15551234567"
      );
      expect(result.messages).toEqual([]);
    });
  });
});
