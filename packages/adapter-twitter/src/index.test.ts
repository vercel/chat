import { describe, expect, it, vi, beforeEach } from "vitest";
import { TwitterAdapter, createTwitterAdapter } from "./index";
import type {
  TwitterAccountActivityPayload,
  TwitterDirectMessageEvent,
} from "./types";

// Mock environment variables for all tests
const mockConfig = {
  consumerKey: "test-consumer-key",
  consumerSecret: "test-consumer-secret",
  accessToken: "test-access-token",
  accessTokenSecret: "test-access-token-secret",
  bearerToken: "test-bearer-token",
  userName: "testbot",
  apiBaseUrl: "https://mock-twitter-api.test",
};

function createTestAdapter(
  overrides?: Partial<typeof mockConfig>
): TwitterAdapter {
  return new TwitterAdapter({ ...mockConfig, ...overrides });
}

function createTestDMEvent(
  overrides?: Partial<{
    id: string;
    senderId: string;
    recipientId: string;
    text: string;
    timestamp: string;
  }>
): TwitterDirectMessageEvent {
  return {
    type: "message_create",
    id: overrides?.id ?? "dm-event-123",
    created_timestamp: overrides?.timestamp ?? String(Date.now()),
    message_create: {
      target: {
        recipient_id: overrides?.recipientId ?? "bot-user-id",
      },
      sender_id: overrides?.senderId ?? "user-456",
      message_data: {
        text: overrides?.text ?? "Hello bot!",
      },
    },
  };
}

function createTestWebhookPayload(
  overrides?: Partial<{
    forUserId: string;
    events: TwitterDirectMessageEvent[];
    users: TwitterAccountActivityPayload["users"];
  }>
): TwitterAccountActivityPayload {
  return {
    for_user_id: overrides?.forUserId ?? "bot-user-id",
    direct_message_events: overrides?.events ?? [createTestDMEvent()],
    users: overrides?.users ?? {
      "user-456": {
        id: "user-456",
        created_timestamp: "1422556069340",
        name: "Test User",
        screen_name: "testuser",
        protected: false,
        verified: false,
        followers_count: 10,
        friends_count: 20,
        statuses_count: 100,
      },
      "bot-user-id": {
        id: "bot-user-id",
        created_timestamp: "1422556069340",
        name: "Test Bot",
        screen_name: "testbot",
        protected: false,
        verified: false,
        followers_count: 0,
        friends_count: 0,
        statuses_count: 0,
      },
    },
  };
}

describe("TwitterAdapter", () => {
  describe("constructor", () => {
    it("should create adapter with valid config", () => {
      const adapter = createTestAdapter();
      expect(adapter.name).toBe("twitter");
      expect(adapter.userName).toBe("testbot");
    });

    it("should throw if consumer key is missing", () => {
      expect(
        () =>
          new TwitterAdapter({
            ...mockConfig,
            consumerKey: undefined,
          })
      ).toThrow("Consumer key is required");
    });

    it("should throw if consumer secret is missing", () => {
      expect(
        () =>
          new TwitterAdapter({
            ...mockConfig,
            consumerSecret: undefined,
          })
      ).toThrow("Consumer secret is required");
    });

    it("should throw if access token is missing", () => {
      expect(
        () =>
          new TwitterAdapter({
            ...mockConfig,
            accessToken: undefined,
          })
      ).toThrow("Access token is required");
    });

    it("should throw if access token secret is missing", () => {
      expect(
        () =>
          new TwitterAdapter({
            ...mockConfig,
            accessTokenSecret: undefined,
          })
      ).toThrow("Access token secret is required");
    });

    it("should throw if bearer token is missing", () => {
      expect(
        () =>
          new TwitterAdapter({
            ...mockConfig,
            bearerToken: undefined,
          })
      ).toThrow("Bearer token is required");
    });
  });

  describe("thread ID encoding/decoding", () => {
    it("should encode thread ID", () => {
      const adapter = createTestAdapter();
      const threadId = adapter.encodeThreadId({
        conversationId: "123-456",
      });
      expect(threadId).toBe("twitter:123-456");
    });

    it("should decode thread ID", () => {
      const adapter = createTestAdapter();
      const decoded = adapter.decodeThreadId("twitter:123-456");
      expect(decoded.conversationId).toBe("123-456");
    });

    it("should throw on invalid thread ID format", () => {
      const adapter = createTestAdapter();
      expect(() => adapter.decodeThreadId("slack:123")).toThrow(
        "Invalid Twitter thread ID"
      );
    });

    it("should throw on thread ID with too many parts", () => {
      const adapter = createTestAdapter();
      expect(() => adapter.decodeThreadId("twitter:123:456")).toThrow(
        "Invalid Twitter thread ID"
      );
    });

    it("should roundtrip encode/decode", () => {
      const adapter = createTestAdapter();
      const original = { conversationId: "abc-def" };
      const encoded = adapter.encodeThreadId(original);
      const decoded = adapter.decodeThreadId(encoded);
      expect(decoded).toEqual(original);
    });
  });

  describe("channelIdFromThreadId", () => {
    it("should extract channel ID from thread ID", () => {
      const adapter = createTestAdapter();
      const channelId = adapter.channelIdFromThreadId("twitter:123-456");
      expect(channelId).toBe("twitter:123-456");
    });
  });

  describe("isDM", () => {
    it("should always return true for Twitter adapter", () => {
      const adapter = createTestAdapter();
      expect(adapter.isDM("twitter:123-456")).toBe(true);
    });
  });

  describe("handleWebhook - CRC Challenge", () => {
    it("should respond to CRC challenge with correct hash", async () => {
      const adapter = createTestAdapter();
      const crcToken = "test-crc-token";
      const request = new Request(
        `https://example.com/webhook?crc_token=${crcToken}`,
        { method: "GET" }
      );

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.response_token).toBeDefined();
      expect(body.response_token).toMatch(/^sha256=/);
    });

    it("should return 400 if crc_token is missing", async () => {
      const adapter = createTestAdapter();
      const request = new Request("https://example.com/webhook", {
        method: "GET",
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(400);
    });
  });

  describe("handleWebhook - POST events", () => {
    it("should return 200 for valid DM webhook", async () => {
      const adapter = createTestAdapter();

      // Initialize with a mock chat instance
      const mockChat = {
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          child: vi.fn().mockReturnThis(),
        }),
        getUserName: () => "testbot",
        processMessage: vi.fn(),
        getState: vi.fn(),
      };

      // Mock fetch for /2/users/me
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "bot-user-id",
              name: "Test Bot",
              username: "testbot",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      try {
        await adapter.initialize(mockChat as any);

        const payload = createTestWebhookPayload();
        const request = new Request("https://example.com/webhook", {
          method: "POST",
          body: JSON.stringify(payload),
          headers: { "Content-Type": "application/json" },
        });

        const response = await adapter.handleWebhook(request);
        expect(response.status).toBe(200);
        expect(mockChat.processMessage).toHaveBeenCalled();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should return 400 for invalid JSON", async () => {
      const adapter = createTestAdapter();
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: "not json",
        headers: { "Content-Type": "application/json" },
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(400);
    });

    it("should return 200 when chat is not initialized", async () => {
      const adapter = createTestAdapter();
      const payload = createTestWebhookPayload();
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
    });
  });

  describe("parseMessage", () => {
    it("should parse a raw DM event into a Message", () => {
      const adapter = createTestAdapter();
      const dmEvent = createTestDMEvent({
        text: "Hello from test",
        senderId: "user-123",
        recipientId: "user-456",
      });

      const message = adapter.parseMessage(dmEvent);
      expect(message.text).toBe("Hello from test");
      expect(message.author.userId).toBe("user-123");
      expect(message.id).toBe("dm-event-123");
    });

    it("should set isMention when bot username is in text", () => {
      const adapter = createTestAdapter();
      const dmEvent = createTestDMEvent({
        text: "Hey @testbot can you help?",
        senderId: "user-123",
        recipientId: "user-456",
      });

      const message = adapter.parseMessage(dmEvent);
      expect(message.isMention).toBe(true);
    });

    it("should not set isMention when bot is not mentioned", () => {
      const adapter = createTestAdapter();
      const dmEvent = createTestDMEvent({
        text: "Hello world",
        senderId: "user-123",
        recipientId: "user-456",
      });

      const message = adapter.parseMessage(dmEvent);
      expect(message.isMention).toBe(false);
    });
  });

  describe("fetchMessages", () => {
    it("should return empty array for unknown thread", async () => {
      const adapter = createTestAdapter();
      const result = await adapter.fetchMessages("twitter:unknown");
      expect(result.messages).toEqual([]);
      expect(result.nextCursor).toBeUndefined();
    });

    it("should return cached messages after parsing", async () => {
      const adapter = createTestAdapter();
      const dmEvent = createTestDMEvent({
        senderId: "user-123",
        recipientId: "user-456",
      });

      const message = adapter.parseMessage(dmEvent);
      const result = await adapter.fetchMessages(message.threadId);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].id).toBe("dm-event-123");
    });
  });

  describe("fetchThread", () => {
    it("should return thread info", async () => {
      const adapter = createTestAdapter();
      const info = await adapter.fetchThread("twitter:123-456");
      expect(info.id).toBe("twitter:123-456");
      expect(info.isDM).toBe(true);
      expect(info.channelId).toBe("123-456");
    });
  });

  describe("editMessage", () => {
    it("should throw NotImplementedError", async () => {
      const adapter = createTestAdapter();
      await expect(
        adapter.editMessage("twitter:123", "msg1", "new text")
      ).rejects.toThrow("Twitter DMs cannot be edited");
    });
  });

  describe("renderFormatted", () => {
    it("should render formatted content to string", () => {
      const adapter = createTestAdapter();
      const ast = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [{ type: "text" as const, value: "Hello" }],
          },
        ],
      };
      const result = adapter.renderFormatted(ast);
      expect(result).toBe("Hello");
    });
  });

  describe("createTwitterAdapter factory", () => {
    it("should create adapter with config", () => {
      const adapter = createTwitterAdapter(mockConfig);
      expect(adapter).toBeInstanceOf(TwitterAdapter);
      expect(adapter.name).toBe("twitter");
    });
  });

  describe("persistMessageHistory", () => {
    it("should be true", () => {
      const adapter = createTestAdapter();
      expect(adapter.persistMessageHistory).toBe(true);
    });
  });
});
