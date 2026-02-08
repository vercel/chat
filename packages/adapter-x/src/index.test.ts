/**
 * Tests for the X adapter: factory, thread IDs, webhook handling, and message operations.
 */

import { createHmac } from "node:crypto";
import { ValidationError } from "@chat-adapter/shared";
import type { Logger } from "chat";
import { describe, expect, it, vi } from "vitest";
import { createXAdapter, XAdapter } from "./index";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(() => mockLogger),
};

const defaultConfig = {
  apiKey: "test-api-key",
  apiSecret: "test-api-secret",
  accessToken: "test-access-token",
  accessTokenSecret: "test-access-token-secret",
  logger: mockLogger,
};

// ============================================================================
// Test Helpers
// ============================================================================

function makeWebhookSignature(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("base64")}`;
}

function createWebhookPostRequest(body: string, secret: string): Request {
  const signature = makeWebhookSignature(body, secret);
  return new Request("https://example.com/api/webhooks/x", {
    method: "POST",
    headers: {
      "x-twitter-webhooks-signature": signature,
      "content-type": "application/json",
    },
    body,
  });
}

function createCrcRequest(crcToken: string): Request {
  return new Request(
    `https://example.com/api/webhooks/x?crc_token=${encodeURIComponent(crcToken)}`,
    { method: "GET" },
  );
}

// ============================================================================
// Factory Function Tests
// ============================================================================

describe("createXAdapter", () => {
  it("creates an XAdapter instance", () => {
    const adapter = createXAdapter(defaultConfig);
    expect(adapter).toBeInstanceOf(XAdapter);
    expect(adapter.name).toBe("x");
  });

  it("sets default userName to 'bot'", () => {
    const adapter = createXAdapter(defaultConfig);
    expect(adapter.userName).toBe("bot");
  });

  it("uses provided userName", () => {
    const adapter = createXAdapter({
      ...defaultConfig,
      userName: "custombot",
    });
    expect(adapter.userName).toBe("custombot");
  });

  it("stores botUserId when provided", () => {
    const adapter = createXAdapter({
      ...defaultConfig,
      botUserId: "123456789",
    });
    expect(adapter.botUserId).toBe("123456789");
  });

  it("returns undefined for botUserId when not provided", () => {
    const adapter = createXAdapter(defaultConfig);
    expect(adapter.botUserId).toBeUndefined();
  });
});

// ============================================================================
// Thread ID Encoding/Decoding Tests
// ============================================================================

describe("encodeThreadId", () => {
  const adapter = createXAdapter(defaultConfig);

  it("encodes tweet thread correctly", () => {
    const threadId = adapter.encodeThreadId({
      conversationId: "123456789",
      type: "tweet",
    });
    expect(threadId).toBe("x:123456789");
  });

  it("encodes DM thread correctly", () => {
    const threadId = adapter.encodeThreadId({
      conversationId: "abc-def",
      type: "dm",
    });
    expect(threadId).toBe("x:dm:abc-def");
  });
});

describe("decodeThreadId", () => {
  const adapter = createXAdapter(defaultConfig);

  it("decodes tweet thread ID", () => {
    const result = adapter.decodeThreadId("x:123456789");
    expect(result).toEqual({
      conversationId: "123456789",
      type: "tweet",
    });
  });

  it("decodes DM thread ID", () => {
    const result = adapter.decodeThreadId("x:dm:abc-def");
    expect(result).toEqual({
      conversationId: "abc-def",
      type: "dm",
    });
  });

  it("handles DM conversation IDs with hyphens", () => {
    const result = adapter.decodeThreadId("x:dm:111-222");
    expect(result).toEqual({
      conversationId: "111-222",
      type: "dm",
    });
  });

  it("throws on invalid thread ID format", () => {
    expect(() => adapter.decodeThreadId("invalid")).toThrow(ValidationError);
    expect(() => adapter.decodeThreadId("slack:C12345")).toThrow(
      ValidationError,
    );
  });

  it("round-trips tweet thread IDs", () => {
    const original = { conversationId: "987654321", type: "tweet" as const };
    const encoded = adapter.encodeThreadId(original);
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(original);
  });

  it("round-trips DM thread IDs", () => {
    const original = {
      conversationId: "111-222",
      type: "dm" as const,
    };
    const encoded = adapter.encodeThreadId(original);
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(original);
  });
});

// ============================================================================
// isDM Tests
// ============================================================================

describe("isDM", () => {
  const adapter = createXAdapter(defaultConfig);

  it("returns true for DM thread IDs", () => {
    expect(adapter.isDM("x:dm:111-222")).toBe(true);
  });

  it("returns false for tweet thread IDs", () => {
    expect(adapter.isDM("x:123456789")).toBe(false);
  });
});

// ============================================================================
// Webhook: CRC Challenge Tests
// ============================================================================

describe("handleWebhook - CRC challenge", () => {
  const adapter = createXAdapter(defaultConfig);

  it("responds to CRC challenge with correct hash", async () => {
    const crcToken = "test-crc-token-123";
    const request = createCrcRequest(crcToken);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);

    const body = await response.json();
    const expectedHmac = createHmac("sha256", defaultConfig.apiSecret)
      .update(crcToken)
      .digest("base64");
    expect(body.response_token).toBe(`sha256=${expectedHmac}`);
  });

  it("returns 400 for GET without crc_token", async () => {
    const request = new Request("https://example.com/api/webhooks/x", {
      method: "GET",
    });
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });
});

// ============================================================================
// Webhook: Signature Verification Tests
// ============================================================================

describe("handleWebhook - signature verification", () => {
  const adapter = createXAdapter(defaultConfig);

  it("returns 401 for missing signature", async () => {
    const request = new Request("https://example.com/api/webhooks/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"for_user_id":"123"}',
    });
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("returns 401 for invalid signature", async () => {
    const body = '{"for_user_id":"123"}';
    const request = new Request("https://example.com/api/webhooks/x", {
      method: "POST",
      headers: {
        "x-twitter-webhooks-signature": "sha256=invalid",
        "content-type": "application/json",
      },
      body,
    });
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("returns 200 for valid signature", async () => {
    const body = JSON.stringify({ for_user_id: "123" });
    const request = createWebhookPostRequest(body, defaultConfig.apiSecret);
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("returns 400 for invalid JSON with valid signature", async () => {
    const body = "not json";
    const request = createWebhookPostRequest(body, defaultConfig.apiSecret);
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });
});

// ============================================================================
// Webhook: Event Processing Tests
// ============================================================================

describe("handleWebhook - event processing", () => {
  it("processes tweet_create_events (returns 200 immediately)", async () => {
    const adapter = createXAdapter({
      ...defaultConfig,
      botUserId: "999",
    });

    const payload = {
      for_user_id: "999",
      tweet_create_events: [
        {
          created_at: "Thu Jan 01 00:00:00 +0000 2026",
          id: 12345,
          id_str: "12345",
          text: "Hello @bot",
          truncated: false,
          user: {
            id: 111,
            id_str: "111",
            name: "Test User",
            screen_name: "testuser",
          },
          in_reply_to_status_id: null,
          in_reply_to_status_id_str: null,
          in_reply_to_user_id: null,
          in_reply_to_user_id_str: null,
          entities: {
            user_mentions: [
              {
                id: 999,
                id_str: "999",
                name: "Bot",
                screen_name: "bot",
                indices: [6, 10],
              },
            ],
          },
        },
      ],
    };

    const body = JSON.stringify(payload);
    const request = createWebhookPostRequest(body, defaultConfig.apiSecret);
    const response = await adapter.handleWebhook(request);

    // Should return 200 immediately (event is processed async)
    expect(response.status).toBe(200);
  });

  it("processes direct_message_events (returns 200 immediately)", async () => {
    const adapter = createXAdapter({
      ...defaultConfig,
      botUserId: "999",
    });

    const payload = {
      for_user_id: "999",
      direct_message_events: [
        {
          type: "message_create",
          id: "dm-1",
          created_timestamp: "1704067200000",
          message_create: {
            target: { recipient_id: "999" },
            sender_id: "111",
            message_data: {
              text: "Hello bot!",
            },
          },
        },
      ],
      users: {
        "111": {
          id: 111,
          id_str: "111",
          name: "Test User",
          screen_name: "testuser",
        },
      },
    };

    const body = JSON.stringify(payload);
    const request = createWebhookPostRequest(body, defaultConfig.apiSecret);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
  });

  it("processes favorite_events (returns 200 immediately)", async () => {
    const adapter = createXAdapter({
      ...defaultConfig,
      botUserId: "999",
    });

    const payload = {
      for_user_id: "999",
      favorite_events: [
        {
          id: "fav-1",
          created_at: "Thu Jan 01 00:00:00 +0000 2026",
          timestamp_ms: 1704067200000,
          favorited_status: {
            created_at: "Thu Jan 01 00:00:00 +0000 2026",
            id: 12345,
            id_str: "12345",
            text: "A tweet",
            user: {
              id: 999,
              id_str: "999",
              name: "Bot",
              screen_name: "bot",
            },
            entities: {},
          },
          user: {
            id: 111,
            id_str: "111",
            name: "Test User",
            screen_name: "testuser",
          },
        },
      ],
    };

    const body = JSON.stringify(payload);
    const request = createWebhookPostRequest(body, defaultConfig.apiSecret);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
  });
});

// ============================================================================
// parseMessage Tests
// ============================================================================

describe("parseMessage", () => {
  const adapter = createXAdapter({
    ...defaultConfig,
    botUserId: "999",
  });

  it("parses a basic tweet into a Message", () => {
    const tweet = {
      created_at: "Thu Jan 01 00:00:00 +0000 2026",
      id: 12345,
      id_str: "12345",
      text: "Hello world",
      user: {
        id: 111,
        id_str: "111",
        name: "Test User",
        screen_name: "testuser",
      },
      entities: {},
    };

    // biome-ignore lint/suspicious/noExplicitAny: test convenience
    const msg = adapter.parseMessage(tweet as any);
    expect(msg.id).toBe("12345");
    expect(msg.text).toContain("Hello world");
    expect(msg.author.userId).toBe("111");
    expect(msg.author.userName).toBe("testuser");
    expect(msg.author.fullName).toBe("Test User");
    expect(msg.author.isMe).toBe(false);
  });

  it("detects messages from self", () => {
    const tweet = {
      created_at: "Thu Jan 01 00:00:00 +0000 2026",
      id: 12345,
      id_str: "12345",
      text: "Bot reply",
      user: {
        id: 999,
        id_str: "999",
        name: "Bot",
        screen_name: "bot",
      },
      entities: {},
    };

    // biome-ignore lint/suspicious/noExplicitAny: test convenience
    const msg = adapter.parseMessage(tweet as any);
    expect(msg.author.isMe).toBe(true);
  });

  it("uses extended_tweet.full_text for longform tweets", () => {
    const tweet = {
      created_at: "Thu Jan 01 00:00:00 +0000 2026",
      id: 12345,
      id_str: "12345",
      text: "Truncated text...",
      truncated: true,
      user: {
        id: 111,
        id_str: "111",
        name: "Test User",
        screen_name: "testuser",
      },
      entities: {},
      extended_tweet: {
        full_text:
          "This is the full extended tweet text that is longer than 140 characters",
        display_text_range: [0, 70],
        entities: {},
      },
    };

    // biome-ignore lint/suspicious/noExplicitAny: test convenience
    const msg = adapter.parseMessage(tweet as any);
    expect(msg.text).toContain("full extended tweet text");
  });
});

// ============================================================================
// renderFormatted Tests
// ============================================================================

describe("renderFormatted", () => {
  const adapter = createXAdapter(defaultConfig);

  it("renders formatted content as plain text", async () => {
    const { parseMarkdown } = await import("chat");
    const ast = parseMarkdown("**Bold** and _italic_");
    const result = adapter.renderFormatted(ast);
    expect(result).toContain("Bold");
    expect(result).toContain("italic");
  });
});

// ============================================================================
// editMessage Tests
// ============================================================================

describe("editMessage", () => {
  const adapter = createXAdapter(defaultConfig);

  it("throws NotImplementedError", async () => {
    await expect(
      adapter.editMessage("x:123", "456", "new text"),
    ).rejects.toThrow("X API does not support editing tweets");
  });
});

// ============================================================================
// startTyping Tests
// ============================================================================

describe("startTyping", () => {
  const adapter = createXAdapter(defaultConfig);

  it("resolves without error (no-op)", async () => {
    await expect(adapter.startTyping("x:123")).resolves.toBeUndefined();
  });
});
