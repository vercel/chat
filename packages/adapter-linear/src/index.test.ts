import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLinearAdapter, LinearAdapter } from "./index";

const WEBHOOK_SECRET = "test-webhook-secret";

/** Mock logger that captures calls */
function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

/**
 * Create a minimal LinearAdapter for testing thread ID methods.
 * We pass a dummy apiKey - it won't be used for encoding/decoding.
 */
function createTestAdapter(): LinearAdapter {
  return new LinearAdapter({
    apiKey: "test-api-key",
    webhookSecret: "test-secret",
    userName: "test-bot",
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  });
}

/**
 * Create an adapter with the known webhook secret and a mock logger.
 */
function createWebhookAdapter(logger = createMockLogger()): LinearAdapter {
  return new LinearAdapter({
    apiKey: "test-api-key",
    webhookSecret: WEBHOOK_SECRET,
    userName: "test-bot",
    logger,
  });
}

/**
 * Generate a valid HMAC-SHA256 signature for a body.
 */
function signPayload(body: string, secret = WEBHOOK_SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Build a mock Request for webhook testing.
 */
function buildWebhookRequest(body: string, signature?: string | null): Request {
  const headers = new Headers({
    "content-type": "application/json",
  });
  if (signature !== null && signature !== undefined) {
    headers.set("linear-signature", signature);
  }
  return new Request("https://example.com/webhook/linear", {
    method: "POST",
    headers,
    body,
  });
}

/**
 * Create a valid comment webhook payload.
 */
function createCommentPayload(overrides?: {
  action?: string;
  userId?: string;
  issueId?: string;
  commentId?: string;
  parentId?: string;
  body?: string;
  actorType?: "user" | "application" | "integration";
}) {
  return {
    type: "Comment",
    action: overrides?.action ?? "create",
    createdAt: "2025-06-01T12:00:00.000Z",
    organizationId: "org-123",
    url: "https://linear.app/test/issue/TEST-1#comment-abc",
    webhookId: "webhook-1",
    webhookTimestamp: Date.now(),
    data: {
      id: overrides?.commentId ?? "comment-abc",
      body: overrides?.body ?? "Hello from webhook",
      issueId: overrides?.issueId ?? "issue-123",
      userId: overrides?.userId ?? "user-456",
      createdAt: "2025-06-01T12:00:00.000Z",
      updatedAt: "2025-06-01T12:00:00.000Z",
      parentId: overrides?.parentId,
    },
    actor: {
      id: overrides?.userId ?? "user-456",
      name: "Test User",
      type: overrides?.actorType ?? "user",
    },
  };
}

/**
 * Create a valid reaction webhook payload.
 */
function createReactionPayload(overrides?: {
  action?: string;
  emoji?: string;
  commentId?: string;
}) {
  return {
    type: "Reaction",
    action: overrides?.action ?? "create",
    createdAt: "2025-06-01T12:00:00.000Z",
    organizationId: "org-123",
    url: "https://linear.app/test/issue/TEST-1",
    webhookId: "webhook-2",
    webhookTimestamp: Date.now(),
    data: {
      id: "reaction-1",
      emoji: overrides?.emoji ?? "\u{1F44D}",
      commentId: overrides?.commentId ?? "comment-abc",
      userId: "user-456",
    },
    actor: {
      id: "user-456",
      name: "Test User",
      type: "user" as const,
    },
  };
}

describe("encodeThreadId", () => {
  it("should encode an issue-level thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.encodeThreadId({
      issueId: "abc123-def456-789",
    });
    expect(result).toBe("linear:abc123-def456-789");
  });

  it("should encode a UUID issue-level thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.encodeThreadId({
      issueId: "2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9",
    });
    expect(result).toBe("linear:2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9");
  });

  it("should encode a comment-level thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.encodeThreadId({
      issueId: "issue-123",
      commentId: "comment-456",
    });
    expect(result).toBe("linear:issue-123:c:comment-456");
  });

  it("should encode a comment-level thread with UUIDs", () => {
    const adapter = createTestAdapter();
    const result = adapter.encodeThreadId({
      issueId: "2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9",
      commentId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
    expect(result).toBe(
      "linear:2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9:c:a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    );
  });
});

describe("decodeThreadId", () => {
  it("should decode an issue-level thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.decodeThreadId("linear:abc123-def456-789");
    expect(result).toEqual({ issueId: "abc123-def456-789" });
  });

  it("should decode a UUID issue-level thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.decodeThreadId(
      "linear:2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9"
    );
    expect(result).toEqual({
      issueId: "2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9",
    });
  });

  it("should decode a comment-level thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.decodeThreadId("linear:issue-123:c:comment-456");
    expect(result).toEqual({
      issueId: "issue-123",
      commentId: "comment-456",
    });
  });

  it("should decode a comment-level thread with UUIDs", () => {
    const adapter = createTestAdapter();
    const result = adapter.decodeThreadId(
      "linear:2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9:c:a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    );
    expect(result).toEqual({
      issueId: "2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9",
      commentId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
  });

  it("should throw on invalid prefix", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.decodeThreadId("slack:C123:ts123")).toThrow(
      "Invalid Linear thread ID"
    );
  });

  it("should throw on empty issue ID", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.decodeThreadId("linear:")).toThrow(
      "Invalid Linear thread ID format"
    );
  });

  it("should throw on completely wrong format", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.decodeThreadId("nonsense")).toThrow(
      "Invalid Linear thread ID"
    );
  });
});

describe("encodeThreadId / decodeThreadId roundtrip", () => {
  it("should round-trip issue-level thread ID", () => {
    const adapter = createTestAdapter();
    const original = { issueId: "2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9" };
    const encoded = adapter.encodeThreadId(original);
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(original);
  });

  it("should round-trip comment-level thread ID", () => {
    const adapter = createTestAdapter();
    const original = {
      issueId: "2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9",
      commentId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    };
    const encoded = adapter.encodeThreadId(original);
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(original);
  });
});

describe("renderFormatted", () => {
  it("should render markdown from AST", () => {
    const adapter = createTestAdapter();
    // Create a simple AST manually
    const ast = {
      type: "root" as const,
      children: [
        {
          type: "paragraph" as const,
          children: [{ type: "text" as const, value: "Hello world" }],
        },
      ],
    };
    const result = adapter.renderFormatted(ast);
    expect(result).toContain("Hello world");
  });
});

describe("parseMessage", () => {
  it("should parse a raw Linear message", () => {
    const adapter = createTestAdapter();
    const raw = {
      comment: {
        id: "comment-abc123",
        body: "Hello from Linear!",
        issueId: "issue-123",
        userId: "user-456",
        createdAt: "2025-01-29T12:00:00.000Z",
        updatedAt: "2025-01-29T12:00:00.000Z",
      },
    };
    const message = adapter.parseMessage(raw);
    expect(message.id).toBe("comment-abc123");
    expect(message.text).toBe("Hello from Linear!");
    expect(message.author.userId).toBe("user-456");
  });

  it("should detect edited messages", () => {
    const adapter = createTestAdapter();
    const raw = {
      comment: {
        id: "comment-abc123",
        body: "Edited message",
        issueId: "issue-123",
        userId: "user-456",
        createdAt: "2025-01-29T12:00:00.000Z",
        updatedAt: "2025-01-29T13:00:00.000Z",
      },
    };
    const message = adapter.parseMessage(raw);
    expect(message.metadata.edited).toBe(true);
  });

  it("should handle empty body", () => {
    const adapter = createTestAdapter();
    const raw = {
      comment: {
        id: "comment-empty",
        body: "",
        issueId: "issue-1",
        userId: "user-1",
        createdAt: "2025-01-29T12:00:00.000Z",
        updatedAt: "2025-01-29T12:00:00.000Z",
      },
    };
    const message = adapter.parseMessage(raw);
    expect(message.text).toBe("");
    expect(message.metadata.edited).toBe(false);
  });

  it("should set editedAt when message is edited", () => {
    const adapter = createTestAdapter();
    const raw = {
      comment: {
        id: "comment-edited",
        body: "Updated text",
        issueId: "issue-1",
        userId: "user-1",
        createdAt: "2025-01-29T12:00:00.000Z",
        updatedAt: "2025-01-29T14:30:00.000Z",
      },
    };
    const message = adapter.parseMessage(raw);
    expect(message.metadata.edited).toBe(true);
    expect(message.metadata.editedAt).toEqual(
      new Date("2025-01-29T14:30:00.000Z")
    );
  });

  it("should not set editedAt when message is not edited", () => {
    const adapter = createTestAdapter();
    const raw = {
      comment: {
        id: "comment-unedited",
        body: "Original text",
        issueId: "issue-1",
        userId: "user-1",
        createdAt: "2025-01-29T12:00:00.000Z",
        updatedAt: "2025-01-29T12:00:00.000Z",
      },
    };
    const message = adapter.parseMessage(raw);
    expect(message.metadata.editedAt).toBeUndefined();
  });

  it("should set isBot to false and isMe to false for regular users", () => {
    const adapter = createTestAdapter();
    const raw = {
      comment: {
        id: "comment-1",
        body: "test",
        issueId: "issue-1",
        userId: "user-1",
        createdAt: "2025-01-29T12:00:00.000Z",
        updatedAt: "2025-01-29T12:00:00.000Z",
      },
    };
    const message = adapter.parseMessage(raw);
    expect(message.author.isBot).toBe(false);
    expect(message.author.isMe).toBe(false);
  });
});

// =============================================================================
// Constructor / auth modes
// =============================================================================

describe("constructor", () => {
  it("should create adapter with apiKey auth", () => {
    const adapter = new LinearAdapter({
      apiKey: "lin_api_key_123",
      webhookSecret: "secret",
      userName: "my-bot",
      logger: createMockLogger(),
    });
    expect(adapter.name).toBe("linear");
    expect(adapter.userName).toBe("my-bot");
  });

  it("should create adapter with accessToken auth", () => {
    const adapter = new LinearAdapter({
      accessToken: "lin_oauth_token_123",
      webhookSecret: "secret",
      userName: "my-bot",
      logger: createMockLogger(),
    });
    expect(adapter.name).toBe("linear");
  });

  it("should create adapter with clientId/clientSecret auth", () => {
    const adapter = new LinearAdapter({
      clientId: "client-id",
      clientSecret: "client-secret",
      webhookSecret: "secret",
      userName: "my-bot",
      logger: createMockLogger(),
    });
    expect(adapter.name).toBe("linear");
  });

  it("should throw when no auth method provided", () => {
    expect(
      () =>
        new LinearAdapter({
          webhookSecret: "secret",
          userName: "my-bot",
          logger: createMockLogger(),
        } as never)
    ).toThrow("Authentication is required");
  });

  it("should have undefined botUserId before initialization", () => {
    const adapter = createTestAdapter();
    expect(adapter.botUserId).toBeUndefined();
  });
});

// =============================================================================
// channelIdFromThreadId
// =============================================================================

describe("channelIdFromThreadId", () => {
  it("should return issue-level channel for issue-level thread", () => {
    const adapter = createTestAdapter();
    const result = adapter.channelIdFromThreadId("linear:issue-123");
    expect(result).toBe("linear:issue-123");
  });

  it("should strip comment part for comment-level thread", () => {
    const adapter = createTestAdapter();
    const result = adapter.channelIdFromThreadId(
      "linear:issue-123:c:comment-456"
    );
    expect(result).toBe("linear:issue-123");
  });

  it("should throw for invalid thread ID", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.channelIdFromThreadId("slack:C123:ts")).toThrow(
      "Invalid Linear thread ID"
    );
  });
});

// =============================================================================
// Webhook signature verification
// =============================================================================

describe("handleWebhook - signature verification", () => {
  it("should reject requests without a signature", async () => {
    const adapter = createWebhookAdapter();
    const body = JSON.stringify(createCommentPayload());
    const request = buildWebhookRequest(body, null);
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Invalid signature");
  });

  it("should reject requests with an invalid signature", async () => {
    const adapter = createWebhookAdapter();
    const body = JSON.stringify(createCommentPayload());
    const request = buildWebhookRequest(body, "invalid-hex-signature");
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Invalid signature");
  });

  it("should reject requests with wrong signature (different secret)", async () => {
    const adapter = createWebhookAdapter();
    const body = JSON.stringify(createCommentPayload());
    const wrongSig = signPayload(body, "wrong-secret");
    const request = buildWebhookRequest(body, wrongSig);
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("should accept requests with a valid signature", async () => {
    const adapter = createWebhookAdapter();
    const body = JSON.stringify(createCommentPayload());
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });
});

// =============================================================================
// Webhook - timestamp validation
// =============================================================================

describe("handleWebhook - timestamp validation", () => {
  it("should reject webhooks with timestamps older than 5 minutes", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const payload = createCommentPayload();
    // Set timestamp to 10 minutes ago
    payload.webhookTimestamp = Date.now() - 10 * 60 * 1000;
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Webhook expired");
    expect(logger.warn).toHaveBeenCalledWith(
      "Linear webhook timestamp too old",
      expect.objectContaining({ webhookTimestamp: payload.webhookTimestamp })
    );
  });

  it("should accept webhooks within 5-minute window", async () => {
    const adapter = createWebhookAdapter();
    const payload = createCommentPayload();
    // Set timestamp to 2 minutes ago
    payload.webhookTimestamp = Date.now() - 2 * 60 * 1000;
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("should accept webhooks without a timestamp", async () => {
    const adapter = createWebhookAdapter();
    const payload = createCommentPayload();
    // Remove timestamp
    const { webhookTimestamp: _, ...payloadWithoutTimestamp } = payload;
    const body = JSON.stringify(payloadWithoutTimestamp);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });
});

// =============================================================================
// Webhook - invalid JSON
// =============================================================================

describe("handleWebhook - invalid JSON", () => {
  it("should return 400 for invalid JSON body", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const body = "not-valid-json{{{";
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid JSON");
    expect(logger.error).toHaveBeenCalledWith(
      "Linear webhook invalid JSON",
      expect.any(Object)
    );
  });
});

// =============================================================================
// Webhook - comment created handling
// =============================================================================

describe("handleWebhook - comment created", () => {
  it("should process comment create events via chat.processMessage", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = {
      getLogger: () => logger,
      getState: vi.fn(),
      getUserName: () => "test-bot",
      handleIncomingMessage: vi.fn(),
      processMessage: vi.fn(),
    };
    await (adapter as unknown as { chat: unknown }).constructor;
    // Set chat instance via initialize-like assignment
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;

    const payload = createCommentPayload();
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(mockChat.processMessage).toHaveBeenCalledWith(
      adapter,
      "linear:issue-123:c:comment-abc",
      expect.objectContaining({
        id: "comment-abc",
        text: "Hello from webhook",
      }),
      undefined
    );
  });

  it("should use parentId as root comment when present (threaded reply)", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = {
      getLogger: () => logger,
      getState: vi.fn(),
      getUserName: () => "test-bot",
      handleIncomingMessage: vi.fn(),
      processMessage: vi.fn(),
    };
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;

    const payload = createCommentPayload({
      commentId: "reply-1",
      parentId: "root-comment-id",
    });
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(mockChat.processMessage).toHaveBeenCalledWith(
      adapter,
      "linear:issue-123:c:root-comment-id",
      expect.objectContaining({ id: "reply-1" }),
      undefined
    );
  });

  it("should skip non-create comment actions", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = {
      getLogger: () => logger,
      getState: vi.fn(),
      getUserName: () => "test-bot",
      handleIncomingMessage: vi.fn(),
      processMessage: vi.fn(),
    };
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;

    const payload = createCommentPayload({ action: "update" });
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(mockChat.processMessage).not.toHaveBeenCalled();
  });

  it("should skip comments without issueId", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = {
      getLogger: () => logger,
      getState: vi.fn(),
      getUserName: () => "test-bot",
      handleIncomingMessage: vi.fn(),
      processMessage: vi.fn(),
    };
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;

    const payload = createCommentPayload();
    // Remove issueId to simulate project update comment
    (payload.data as Record<string, unknown>).issueId = undefined;
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(mockChat.processMessage).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      "Ignoring non-issue comment",
      expect.any(Object)
    );
  });

  it("should skip bot's own messages", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = {
      getLogger: () => logger,
      getState: vi.fn(),
      getUserName: () => "test-bot",
      handleIncomingMessage: vi.fn(),
      processMessage: vi.fn(),
    };
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;
    // Set bot user ID
    (adapter as unknown as { _botUserId: string })._botUserId = "bot-user-id";

    const payload = createCommentPayload({ userId: "bot-user-id" });
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(mockChat.processMessage).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      "Ignoring message from self",
      expect.any(Object)
    );
  });

  it("should ignore comments when chat is not initialized", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    // chat is null by default (not initialized)

    const payload = createCommentPayload();
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(logger.warn).toHaveBeenCalledWith(
      "Chat instance not initialized, ignoring comment"
    );
  });
});

// =============================================================================
// Webhook - reaction handling
// =============================================================================

describe("handleWebhook - reaction events", () => {
  it("should log reaction events", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = {
      getLogger: () => logger,
      getState: vi.fn(),
      getUserName: () => "test-bot",
      handleIncomingMessage: vi.fn(),
      processMessage: vi.fn(),
    };
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;

    const payload = createReactionPayload({ emoji: "\u{1F525}" });
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(logger.debug).toHaveBeenCalledWith(
      "Received reaction webhook",
      expect.objectContaining({
        emoji: "\u{1F525}",
        action: "create",
      })
    );
  });

  it("should silently return when chat is not initialized for reactions", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    // chat is null

    const payload = createReactionPayload();
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    // Should not log debug since chat is null
    expect(logger.debug).not.toHaveBeenCalledWith(
      "Received reaction webhook",
      expect.any(Object)
    );
  });
});

// =============================================================================
// Webhook - unknown event types
// =============================================================================

describe("handleWebhook - unknown event types", () => {
  it("should return 200 for unhandled event types", async () => {
    const adapter = createWebhookAdapter();
    const payload = {
      type: "Issue",
      action: "create",
      webhookTimestamp: Date.now(),
      data: { id: "issue-1" },
      actor: { id: "user-1", name: "Test", type: "user" },
    };
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });
});

// =============================================================================
// buildMessage (tested indirectly through webhook handling)
// =============================================================================

describe("buildMessage via webhook", () => {
  it("should set author fields from actor", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = {
      getLogger: () => logger,
      getState: vi.fn(),
      getUserName: () => "test-bot",
      handleIncomingMessage: vi.fn(),
      processMessage: vi.fn(),
    };
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;

    const payload = createCommentPayload({ actorType: "user" });
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    await adapter.handleWebhook(request);

    const message = mockChat.processMessage.mock.calls[0][2];
    expect(message.author.userName).toBe("Test User");
    expect(message.author.fullName).toBe("Test User");
    expect(message.author.isBot).toBe(false);
    expect(message.author.isMe).toBe(false);
  });

  it("should set isBot true for application actors", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = {
      getLogger: () => logger,
      getState: vi.fn(),
      getUserName: () => "test-bot",
      handleIncomingMessage: vi.fn(),
      processMessage: vi.fn(),
    };
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;

    const payload = createCommentPayload({ actorType: "application" });
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    await adapter.handleWebhook(request);

    const message = mockChat.processMessage.mock.calls[0][2];
    expect(message.author.isBot).toBe(true);
  });

  it("should set isBot true for integration actors", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = {
      getLogger: () => logger,
      getState: vi.fn(),
      getUserName: () => "test-bot",
      handleIncomingMessage: vi.fn(),
      processMessage: vi.fn(),
    };
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;

    const payload = createCommentPayload({ actorType: "integration" });
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    await adapter.handleWebhook(request);

    const message = mockChat.processMessage.mock.calls[0][2];
    expect(message.author.isBot).toBe(true);
  });

  it("should set dateSent from createdAt", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = {
      getLogger: () => logger,
      getState: vi.fn(),
      getUserName: () => "test-bot",
      handleIncomingMessage: vi.fn(),
      processMessage: vi.fn(),
    };
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;

    const payload = createCommentPayload();
    payload.data.createdAt = "2025-03-15T10:30:00.000Z";
    payload.data.updatedAt = "2025-03-15T10:30:00.000Z";
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    await adapter.handleWebhook(request);

    const message = mockChat.processMessage.mock.calls[0][2];
    expect(message.metadata.dateSent).toEqual(
      new Date("2025-03-15T10:30:00.000Z")
    );
    expect(message.metadata.edited).toBe(false);
  });

  it("should detect edited messages from differing createdAt/updatedAt", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = {
      getLogger: () => logger,
      getState: vi.fn(),
      getUserName: () => "test-bot",
      handleIncomingMessage: vi.fn(),
      processMessage: vi.fn(),
    };
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;

    const payload = createCommentPayload();
    payload.data.createdAt = "2025-03-15T10:30:00.000Z";
    payload.data.updatedAt = "2025-03-15T11:00:00.000Z";
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    await adapter.handleWebhook(request);

    const message = mockChat.processMessage.mock.calls[0][2];
    expect(message.metadata.edited).toBe(true);
    expect(message.metadata.editedAt).toEqual(
      new Date("2025-03-15T11:00:00.000Z")
    );
  });

  it("should include raw comment data in message", async () => {
    const logger = createMockLogger();
    const adapter = createWebhookAdapter(logger);
    const mockChat = {
      getLogger: () => logger,
      getState: vi.fn(),
      getUserName: () => "test-bot",
      handleIncomingMessage: vi.fn(),
      processMessage: vi.fn(),
    };
    (adapter as unknown as { chat: typeof mockChat }).chat = mockChat;

    const payload = createCommentPayload({ body: "Some text" });
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const request = buildWebhookRequest(body, sig);
    await adapter.handleWebhook(request);

    const message = mockChat.processMessage.mock.calls[0][2];
    expect(message.raw.comment.body).toBe("Some text");
    expect(message.raw.comment.issueId).toBe("issue-123");
  });
});

// =============================================================================
// postMessage
// =============================================================================

describe("postMessage", () => {
  it("should create comment via linearClient.createComment", async () => {
    const adapter = createWebhookAdapter();
    const mockComment = {
      id: "new-comment-1",
      body: "Bot reply",
      createdAt: new Date("2025-06-01T12:00:00.000Z"),
      updatedAt: new Date("2025-06-01T12:00:00.000Z"),
      url: "https://linear.app/test/comment/new-comment-1",
    };
    const mockCreateComment = vi.fn().mockResolvedValue({
      comment: Promise.resolve(mockComment),
    });
    (
      adapter as unknown as {
        linearClient: { createComment: typeof mockCreateComment };
      }
    ).linearClient = {
      createComment: mockCreateComment,
    } as never;

    const result = await adapter.postMessage(
      "linear:issue-123:c:parent-comment",
      "Hello from bot"
    );

    expect(mockCreateComment).toHaveBeenCalledWith({
      issueId: "issue-123",
      body: "Hello from bot",
      parentId: "parent-comment",
    });
    expect(result.id).toBe("new-comment-1");
    expect(result.threadId).toBe("linear:issue-123:c:parent-comment");
    expect(result.raw.comment.body).toBe("Bot reply");
  });

  it("should create top-level comment for issue-level threads", async () => {
    const adapter = createWebhookAdapter();
    const mockComment = {
      id: "top-comment-1",
      body: "Top-level comment",
      createdAt: new Date("2025-06-01T12:00:00.000Z"),
      updatedAt: new Date("2025-06-01T12:00:00.000Z"),
      url: "https://linear.app/test/comment/top-comment-1",
    };
    const mockCreateComment = vi.fn().mockResolvedValue({
      comment: Promise.resolve(mockComment),
    });
    (
      adapter as unknown as {
        linearClient: { createComment: typeof mockCreateComment };
      }
    ).linearClient = {
      createComment: mockCreateComment,
    } as never;

    await adapter.postMessage("linear:issue-123", "Hello");

    expect(mockCreateComment).toHaveBeenCalledWith({
      issueId: "issue-123",
      body: "Hello",
      parentId: undefined,
    });
  });

  it("should throw when comment creation returns null", async () => {
    const adapter = createWebhookAdapter();
    const mockCreateComment = vi.fn().mockResolvedValue({
      comment: Promise.resolve(null),
    });
    (
      adapter as unknown as {
        linearClient: { createComment: typeof mockCreateComment };
      }
    ).linearClient = {
      createComment: mockCreateComment,
    } as never;

    await expect(
      adapter.postMessage("linear:issue-123", "Hello")
    ).rejects.toThrow("Failed to create comment on Linear issue");
  });

  it("should handle AST message format", async () => {
    const adapter = createWebhookAdapter();
    const mockComment = {
      id: "ast-comment-1",
      body: "AST text",
      createdAt: new Date("2025-06-01T12:00:00.000Z"),
      updatedAt: new Date("2025-06-01T12:00:00.000Z"),
      url: "https://linear.app/test/comment/ast-comment-1",
    };
    const mockCreateComment = vi.fn().mockResolvedValue({
      comment: Promise.resolve(mockComment),
    });
    (
      adapter as unknown as {
        linearClient: { createComment: typeof mockCreateComment };
      }
    ).linearClient = {
      createComment: mockCreateComment,
    } as never;

    await adapter.postMessage("linear:issue-123", {
      markdown: "**bold text**",
    });

    expect(mockCreateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "issue-123",
      })
    );
    // The body should contain the markdown content
    const calledBody = mockCreateComment.mock.calls[0][0].body;
    expect(calledBody).toContain("bold text");
  });

  it("should call ensureValidToken before posting", async () => {
    const adapter = createWebhookAdapter();
    const mockComment = {
      id: "token-check-1",
      body: "test",
      createdAt: new Date(),
      updatedAt: new Date(),
      url: "https://linear.app/test",
    };
    const mockCreateComment = vi.fn().mockResolvedValue({
      comment: Promise.resolve(mockComment),
    });
    (
      adapter as unknown as {
        linearClient: { createComment: typeof mockCreateComment };
      }
    ).linearClient = {
      createComment: mockCreateComment,
    } as never;

    // Spy on ensureValidToken
    const ensureSpy = vi
      .spyOn(adapter as never, "ensureValidToken" as never)
      .mockResolvedValue(undefined as never);

    await adapter.postMessage("linear:issue-123", "test");
    expect(ensureSpy).toHaveBeenCalled();

    ensureSpy.mockRestore();
  });
});

// =============================================================================
// editMessage
// =============================================================================

describe("editMessage", () => {
  it("should update comment via linearClient.updateComment", async () => {
    const adapter = createWebhookAdapter();
    const mockComment = {
      id: "edited-comment-1",
      body: "Updated body",
      createdAt: new Date("2025-06-01T12:00:00.000Z"),
      updatedAt: new Date("2025-06-01T13:00:00.000Z"),
      url: "https://linear.app/test/comment/edited-comment-1",
    };
    const mockUpdateComment = vi.fn().mockResolvedValue({
      comment: Promise.resolve(mockComment),
    });
    (
      adapter as unknown as {
        linearClient: { updateComment: typeof mockUpdateComment };
      }
    ).linearClient = {
      updateComment: mockUpdateComment,
    } as never;

    const result = await adapter.editMessage(
      "linear:issue-123:c:parent-comment",
      "edited-comment-1",
      "Updated body"
    );

    expect(mockUpdateComment).toHaveBeenCalledWith("edited-comment-1", {
      body: "Updated body",
    });
    expect(result.id).toBe("edited-comment-1");
    expect(result.raw.comment.body).toBe("Updated body");
    expect(result.raw.comment.issueId).toBe("issue-123");
  });

  it("should throw when comment update returns null", async () => {
    const adapter = createWebhookAdapter();
    const mockUpdateComment = vi.fn().mockResolvedValue({
      comment: Promise.resolve(null),
    });
    (
      adapter as unknown as {
        linearClient: { updateComment: typeof mockUpdateComment };
      }
    ).linearClient = {
      updateComment: mockUpdateComment,
    } as never;

    await expect(
      adapter.editMessage("linear:issue-123", "comment-1", "Updated")
    ).rejects.toThrow("Failed to update comment on Linear");
  });
});

// =============================================================================
// deleteMessage
// =============================================================================

describe("deleteMessage", () => {
  it("should call linearClient.deleteComment with the message ID", async () => {
    const adapter = createWebhookAdapter();
    const mockDeleteComment = vi.fn().mockResolvedValue({});
    (
      adapter as unknown as {
        linearClient: { deleteComment: typeof mockDeleteComment };
      }
    ).linearClient = {
      deleteComment: mockDeleteComment,
    } as never;

    await adapter.deleteMessage("linear:issue-123", "comment-to-delete");

    expect(mockDeleteComment).toHaveBeenCalledWith("comment-to-delete");
  });
});

// =============================================================================
// addReaction
// =============================================================================

describe("addReaction", () => {
  it("should create reaction with emoji string", async () => {
    const adapter = createWebhookAdapter();
    const mockCreateReaction = vi.fn().mockResolvedValue({});
    (
      adapter as unknown as {
        linearClient: { createReaction: typeof mockCreateReaction };
      }
    ).linearClient = {
      createReaction: mockCreateReaction,
    } as never;

    await adapter.addReaction("linear:issue-123", "comment-1", "rocket");

    expect(mockCreateReaction).toHaveBeenCalledWith({
      commentId: "comment-1",
      emoji: "\u{1F680}",
    });
  });

  it("should create reaction with EmojiValue object", async () => {
    const adapter = createWebhookAdapter();
    const mockCreateReaction = vi.fn().mockResolvedValue({});
    (
      adapter as unknown as {
        linearClient: { createReaction: typeof mockCreateReaction };
      }
    ).linearClient = {
      createReaction: mockCreateReaction,
    } as never;

    await adapter.addReaction("linear:issue-123", "comment-1", {
      name: "heart",
    });

    expect(mockCreateReaction).toHaveBeenCalledWith({
      commentId: "comment-1",
      emoji: "\u{2764}\u{FE0F}",
    });
  });

  it("should pass through unknown emoji names", async () => {
    const adapter = createWebhookAdapter();
    const mockCreateReaction = vi.fn().mockResolvedValue({});
    (
      adapter as unknown as {
        linearClient: { createReaction: typeof mockCreateReaction };
      }
    ).linearClient = {
      createReaction: mockCreateReaction,
    } as never;

    await adapter.addReaction("linear:issue-123", "comment-1", "custom_emoji");

    expect(mockCreateReaction).toHaveBeenCalledWith({
      commentId: "comment-1",
      emoji: "custom_emoji",
    });
  });

  it("should resolve all known emoji mappings", async () => {
    const adapter = createWebhookAdapter();
    const mockCreateReaction = vi.fn().mockResolvedValue({});
    (
      adapter as unknown as {
        linearClient: { createReaction: typeof mockCreateReaction };
      }
    ).linearClient = {
      createReaction: mockCreateReaction,
    } as never;

    const knownEmoji: Record<string, string> = {
      thumbs_up: "\u{1F44D}",
      thumbs_down: "\u{1F44E}",
      heart: "\u{2764}\u{FE0F}",
      fire: "\u{1F525}",
      rocket: "\u{1F680}",
      eyes: "\u{1F440}",
      check: "\u{2705}",
      warning: "\u{26A0}\u{FE0F}",
      sparkles: "\u{2728}",
      wave: "\u{1F44B}",
      raised_hands: "\u{1F64C}",
      laugh: "\u{1F604}",
      hooray: "\u{1F389}",
      confused: "\u{1F615}",
    };

    for (const [name, unicode] of Object.entries(knownEmoji)) {
      mockCreateReaction.mockClear();
      await adapter.addReaction("linear:issue-123", "comment-1", name);
      expect(mockCreateReaction).toHaveBeenCalledWith({
        commentId: "comment-1",
        emoji: unicode,
      });
    }
  });
});

// =============================================================================
// removeReaction
// =============================================================================

describe("removeReaction", () => {
  it("should log a warning since it is not fully supported", async () => {
    const logger = createMockLogger();
    const adapter = new LinearAdapter({
      apiKey: "test-api-key",
      webhookSecret: WEBHOOK_SECRET,
      userName: "test-bot",
      logger,
    });

    await adapter.removeReaction("linear:issue-123", "comment-1", "heart");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("removeReaction is not fully supported")
    );
  });
});

// =============================================================================
// startTyping
// =============================================================================

describe("startTyping", () => {
  it("should be a no-op (Linear does not support typing indicators)", async () => {
    const adapter = createTestAdapter();
    // Should not throw
    await adapter.startTyping("linear:issue-123");
  });
});

// =============================================================================
// fetchMessages
// =============================================================================

describe("fetchMessages", () => {
  it("should fetch issue-level comments when no commentId in thread", async () => {
    const adapter = createWebhookAdapter();
    const mockUser = {
      id: "user-1",
      displayName: "Alice",
      name: "Alice Smith",
    };
    const mockComments = [
      {
        id: "comment-1",
        body: "First comment",
        createdAt: new Date("2025-06-01T10:00:00.000Z"),
        updatedAt: new Date("2025-06-01T10:00:00.000Z"),
        url: "https://linear.app/comment/1",
        user: Promise.resolve(mockUser),
      },
      {
        id: "comment-2",
        body: "Second comment",
        createdAt: new Date("2025-06-01T11:00:00.000Z"),
        updatedAt: new Date("2025-06-01T11:00:00.000Z"),
        url: "https://linear.app/comment/2",
        user: Promise.resolve(mockUser),
      },
    ];
    const mockIssue = {
      comments: vi.fn().mockResolvedValue({
        nodes: mockComments,
        pageInfo: { hasNextPage: false, endCursor: null },
      }),
    };
    const mockLinearClient = {
      issue: vi.fn().mockResolvedValue(mockIssue),
    };
    (
      adapter as unknown as { linearClient: typeof mockLinearClient }
    ).linearClient = mockLinearClient as never;

    const result = await adapter.fetchMessages("linear:issue-abc");

    expect(mockLinearClient.issue).toHaveBeenCalledWith("issue-abc");
    expect(mockIssue.comments).toHaveBeenCalledWith({ first: 50 });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].text).toBe("First comment");
    expect(result.messages[1].text).toBe("Second comment");
    expect(result.nextCursor).toBeUndefined();
  });

  it("should fetch comment thread (root + children) when commentId present", async () => {
    const adapter = createWebhookAdapter();
    const mockUser = {
      id: "user-1",
      displayName: "Bob",
      name: "Bob Jones",
    };
    const mockRootComment = {
      id: "root-comment",
      body: "Root comment",
      createdAt: new Date("2025-06-01T10:00:00.000Z"),
      updatedAt: new Date("2025-06-01T10:00:00.000Z"),
      url: "https://linear.app/comment/root",
      user: Promise.resolve(mockUser),
      children: vi.fn().mockResolvedValue({
        nodes: [
          {
            id: "child-1",
            body: "Reply",
            createdAt: new Date("2025-06-01T11:00:00.000Z"),
            updatedAt: new Date("2025-06-01T11:00:00.000Z"),
            url: "https://linear.app/comment/child-1",
            user: Promise.resolve(mockUser),
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      }),
    };
    const mockLinearClient = {
      comment: vi.fn().mockResolvedValue(mockRootComment),
    };
    (
      adapter as unknown as { linearClient: typeof mockLinearClient }
    ).linearClient = mockLinearClient as never;

    const result = await adapter.fetchMessages(
      "linear:issue-abc:c:root-comment"
    );

    expect(mockLinearClient.comment).toHaveBeenCalledWith({
      id: "root-comment",
    });
    // Root comment + 1 child
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].text).toBe("Root comment");
    expect(result.messages[1].text).toBe("Reply");
  });

  it("should return empty messages when root comment not found", async () => {
    const adapter = createWebhookAdapter();
    const mockLinearClient = {
      comment: vi.fn().mockResolvedValue(null),
    };
    (
      adapter as unknown as { linearClient: typeof mockLinearClient }
    ).linearClient = mockLinearClient as never;

    const result = await adapter.fetchMessages(
      "linear:issue-abc:c:nonexistent"
    );

    expect(result.messages).toHaveLength(0);
  });

  it("should pass limit option to API", async () => {
    const adapter = createWebhookAdapter();
    const mockIssue = {
      comments: vi.fn().mockResolvedValue({
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      }),
    };
    const mockLinearClient = {
      issue: vi.fn().mockResolvedValue(mockIssue),
    };
    (
      adapter as unknown as { linearClient: typeof mockLinearClient }
    ).linearClient = mockLinearClient as never;

    await adapter.fetchMessages("linear:issue-abc", { limit: 10 });

    expect(mockIssue.comments).toHaveBeenCalledWith({ first: 10 });
  });

  it("should return nextCursor when hasNextPage is true", async () => {
    const adapter = createWebhookAdapter();
    const mockIssue = {
      comments: vi.fn().mockResolvedValue({
        nodes: [],
        pageInfo: { hasNextPage: true, endCursor: "cursor-abc" },
      }),
    };
    const mockLinearClient = {
      issue: vi.fn().mockResolvedValue(mockIssue),
    };
    (
      adapter as unknown as { linearClient: typeof mockLinearClient }
    ).linearClient = mockLinearClient as never;

    const result = await adapter.fetchMessages("linear:issue-abc");

    expect(result.nextCursor).toBe("cursor-abc");
  });

  it("should detect edited messages in fetched comments", async () => {
    const adapter = createWebhookAdapter();
    const mockUser = {
      id: "user-1",
      displayName: "Alice",
      name: "Alice Smith",
    };
    const mockComments = [
      {
        id: "comment-edited",
        body: "Edited text",
        createdAt: new Date("2025-06-01T10:00:00.000Z"),
        updatedAt: new Date("2025-06-01T12:00:00.000Z"),
        url: "https://linear.app/comment/1",
        user: Promise.resolve(mockUser),
      },
    ];
    const mockIssue = {
      comments: vi.fn().mockResolvedValue({
        nodes: mockComments,
        pageInfo: { hasNextPage: false },
      }),
    };
    const mockLinearClient = {
      issue: vi.fn().mockResolvedValue(mockIssue),
    };
    (
      adapter as unknown as { linearClient: typeof mockLinearClient }
    ).linearClient = mockLinearClient as never;

    const result = await adapter.fetchMessages("linear:issue-abc");

    expect(result.messages[0].metadata.edited).toBe(true);
    expect(result.messages[0].metadata.editedAt).toEqual(
      new Date("2025-06-01T12:00:00.000Z")
    );
  });

  it("should set isMe true when user matches botUserId", async () => {
    const adapter = createWebhookAdapter();
    (adapter as unknown as { _botUserId: string })._botUserId = "bot-id";

    const mockUser = {
      id: "bot-id",
      displayName: "BotUser",
      name: "Bot",
    };
    const mockComments = [
      {
        id: "comment-bot",
        body: "Bot message",
        createdAt: new Date("2025-06-01T10:00:00.000Z"),
        updatedAt: new Date("2025-06-01T10:00:00.000Z"),
        url: "https://linear.app/comment/bot",
        user: Promise.resolve(mockUser),
      },
    ];
    const mockIssue = {
      comments: vi.fn().mockResolvedValue({
        nodes: mockComments,
        pageInfo: { hasNextPage: false },
      }),
    };
    const mockLinearClient = {
      issue: vi.fn().mockResolvedValue(mockIssue),
    };
    (
      adapter as unknown as { linearClient: typeof mockLinearClient }
    ).linearClient = mockLinearClient as never;

    const result = await adapter.fetchMessages("linear:issue-abc");

    expect(result.messages[0].author.isMe).toBe(true);
    expect(result.messages[0].author.userId).toBe("bot-id");
  });

  it("should handle comments with no user", async () => {
    const adapter = createWebhookAdapter();
    const mockComments = [
      {
        id: "comment-no-user",
        body: "Orphan comment",
        createdAt: new Date("2025-06-01T10:00:00.000Z"),
        updatedAt: new Date("2025-06-01T10:00:00.000Z"),
        url: "https://linear.app/comment/orphan",
        user: Promise.resolve(undefined),
      },
    ];
    const mockIssue = {
      comments: vi.fn().mockResolvedValue({
        nodes: mockComments,
        pageInfo: { hasNextPage: false },
      }),
    };
    const mockLinearClient = {
      issue: vi.fn().mockResolvedValue(mockIssue),
    };
    (
      adapter as unknown as { linearClient: typeof mockLinearClient }
    ).linearClient = mockLinearClient as never;

    const result = await adapter.fetchMessages("linear:issue-abc");

    expect(result.messages[0].author.userId).toBe("unknown");
    expect(result.messages[0].author.userName).toBe("unknown");
    expect(result.messages[0].author.fullName).toBe("unknown");
  });
});

// =============================================================================
// fetchThread
// =============================================================================

describe("fetchThread", () => {
  it("should return thread info for an issue", async () => {
    const adapter = createWebhookAdapter();
    const mockIssue = {
      identifier: "TEST-42",
      title: "Fix the thing",
      url: "https://linear.app/test/issue/TEST-42",
    };
    const mockLinearClient = {
      issue: vi.fn().mockResolvedValue(mockIssue),
    };
    (
      adapter as unknown as { linearClient: typeof mockLinearClient }
    ).linearClient = mockLinearClient as never;

    const result = await adapter.fetchThread("linear:issue-uuid-123");

    expect(result.id).toBe("linear:issue-uuid-123");
    expect(result.channelId).toBe("issue-uuid-123");
    expect(result.channelName).toBe("TEST-42: Fix the thing");
    expect(result.isDM).toBe(false);
    expect(result.metadata).toEqual({
      issueId: "issue-uuid-123",
      identifier: "TEST-42",
      title: "Fix the thing",
      url: "https://linear.app/test/issue/TEST-42",
    });
  });

  it("should extract issueId from comment-level thread", async () => {
    const adapter = createWebhookAdapter();
    const mockIssue = {
      identifier: "BUG-99",
      title: "Regression",
      url: "https://linear.app/test/issue/BUG-99",
    };
    const mockLinearClient = {
      issue: vi.fn().mockResolvedValue(mockIssue),
    };
    (
      adapter as unknown as { linearClient: typeof mockLinearClient }
    ).linearClient = mockLinearClient as never;

    await adapter.fetchThread("linear:issue-xyz:c:comment-abc");

    // Should call with the issueId only
    expect(mockLinearClient.issue).toHaveBeenCalledWith("issue-xyz");
  });
});

// =============================================================================
// initialize
// =============================================================================

describe("initialize", () => {
  it("should fetch bot user ID on initialize", async () => {
    const logger = createMockLogger();
    const adapter = new LinearAdapter({
      apiKey: "test-api-key",
      webhookSecret: "secret",
      userName: "my-bot",
      logger,
    });

    const mockViewer = {
      id: "viewer-id-123",
      displayName: "My Bot",
    };
    (
      adapter as unknown as {
        linearClient: { viewer: Promise<typeof mockViewer> };
      }
    ).linearClient = {
      viewer: Promise.resolve(mockViewer),
    } as never;

    const mockChat = {
      getLogger: () => logger,
      getState: vi.fn(),
      getUserName: () => "my-bot",
      handleIncomingMessage: vi.fn(),
      processMessage: vi.fn(),
    };

    await adapter.initialize(mockChat as never);

    expect(adapter.botUserId).toBe("viewer-id-123");
    expect(logger.info).toHaveBeenCalledWith(
      "Linear auth completed",
      expect.objectContaining({
        botUserId: "viewer-id-123",
        displayName: "My Bot",
      })
    );
  });

  it("should warn when viewer fetch fails", async () => {
    const logger = createMockLogger();
    const adapter = new LinearAdapter({
      apiKey: "test-api-key",
      webhookSecret: "secret",
      userName: "my-bot",
      logger,
    });

    // Make viewer reject
    Object.defineProperty(
      (adapter as unknown as { linearClient: Record<string, unknown> })
        .linearClient,
      "viewer",
      {
        get: () => Promise.reject(new Error("Auth failed")),
      }
    );

    const mockChat = {
      getLogger: () => logger,
      getState: vi.fn(),
      getUserName: () => "my-bot",
      handleIncomingMessage: vi.fn(),
      processMessage: vi.fn(),
    };

    await adapter.initialize(mockChat as never);

    expect(adapter.botUserId).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "Could not fetch Linear bot user ID",
      expect.any(Object)
    );
  });

  it("should refresh token for client credentials mode", async () => {
    const logger = createMockLogger();
    const adapter = new LinearAdapter({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      webhookSecret: "secret",
      userName: "my-bot",
      logger,
    });

    // Mock the fetch call for token refresh
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "new-token-123",
          expires_in: 2592000, // 30 days
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const mockChat = {
      getLogger: () => logger,
      getState: vi.fn(),
      getUserName: () => "my-bot",
      handleIncomingMessage: vi.fn(),
      processMessage: vi.fn(),
    };

    // We need to catch the viewer call that happens after token refresh
    // since a new LinearClient is created
    try {
      await adapter.initialize(mockChat as never);
    } catch {
      // Viewer fetch may fail with mocked client, that's ok
    }

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.linear.app/oauth/token",
      expect.objectContaining({
        method: "POST",
        body: expect.any(URLSearchParams),
      })
    );

    vi.unstubAllGlobals();
  });
});

// =============================================================================
// ensureValidToken
// =============================================================================

describe("ensureValidToken", () => {
  it("should not refresh when no client credentials", async () => {
    const adapter = createWebhookAdapter();
    const mockDeleteComment = vi.fn().mockResolvedValue({});
    (
      adapter as unknown as {
        linearClient: { deleteComment: typeof mockDeleteComment };
      }
    ).linearClient = {
      deleteComment: mockDeleteComment,
    } as never;

    // Should not throw - just calls through
    await adapter.deleteMessage("linear:issue-123", "comment-1");
    expect(mockDeleteComment).toHaveBeenCalled();
  });

  it("should refresh when token is expired", async () => {
    const logger = createMockLogger();
    const adapter = new LinearAdapter({
      clientId: "test-client",
      clientSecret: "test-secret",
      webhookSecret: "secret",
      userName: "bot",
      logger,
    });

    // Set expiry in the past
    (adapter as unknown as { accessTokenExpiry: number }).accessTokenExpiry =
      Date.now() - 1000;
    (
      adapter as unknown as {
        clientCredentials: { clientId: string; clientSecret: string };
      }
    ).clientCredentials = {
      clientId: "test-client",
      clientSecret: "test-secret",
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "refreshed-token",
          expires_in: 2592000,
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    // Now try to delete a message which calls ensureValidToken
    const mockDeleteComment = vi.fn().mockResolvedValue({});
    // After refresh, a new client is created, so we need to set it up right
    // The ensureValidToken call will create a new LinearClient
    // We'll spy on refreshClientCredentialsToken instead
    const refreshSpy = vi
      .spyOn(adapter as never, "refreshClientCredentialsToken" as never)
      .mockResolvedValue(undefined as never);

    (
      adapter as unknown as {
        linearClient: { deleteComment: typeof mockDeleteComment };
      }
    ).linearClient = {
      deleteComment: mockDeleteComment,
    } as never;

    await adapter.deleteMessage("linear:issue-123", "comment-1");

    expect(refreshSpy).toHaveBeenCalled();

    refreshSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("should not refresh when token is still valid", async () => {
    const logger = createMockLogger();
    const adapter = new LinearAdapter({
      clientId: "test-client",
      clientSecret: "test-secret",
      webhookSecret: "secret",
      userName: "bot",
      logger,
    });

    // Set expiry far in the future
    (adapter as unknown as { accessTokenExpiry: number }).accessTokenExpiry =
      Date.now() + 86400000;
    (
      adapter as unknown as {
        clientCredentials: { clientId: string; clientSecret: string };
      }
    ).clientCredentials = {
      clientId: "test-client",
      clientSecret: "test-secret",
    };

    const refreshSpy = vi
      .spyOn(adapter as never, "refreshClientCredentialsToken" as never)
      .mockResolvedValue(undefined as never);

    const mockDeleteComment = vi.fn().mockResolvedValue({});
    (
      adapter as unknown as {
        linearClient: { deleteComment: typeof mockDeleteComment };
      }
    ).linearClient = {
      deleteComment: mockDeleteComment,
    } as never;

    await adapter.deleteMessage("linear:issue-123", "comment-1");

    expect(refreshSpy).not.toHaveBeenCalled();

    refreshSpy.mockRestore();
  });
});

// =============================================================================
// refreshClientCredentialsToken
// =============================================================================

describe("refreshClientCredentialsToken", () => {
  it("should throw on failed token fetch", async () => {
    const logger = createMockLogger();
    const adapter = new LinearAdapter({
      clientId: "test-client",
      clientSecret: "test-secret",
      webhookSecret: "secret",
      userName: "bot",
      logger,
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      (
        adapter as unknown as {
          refreshClientCredentialsToken: () => Promise<void>;
        }
      ).refreshClientCredentialsToken()
    ).rejects.toThrow(
      "Failed to fetch Linear client credentials token: 401 Unauthorized"
    );

    vi.unstubAllGlobals();
  });

  it("should be a no-op when clientCredentials is null", async () => {
    const adapter = createWebhookAdapter(); // API key mode, no client credentials

    // Should not throw
    await (
      adapter as unknown as {
        refreshClientCredentialsToken: () => Promise<void>;
      }
    ).refreshClientCredentialsToken();
  });

  it("should set accessTokenExpiry with 1 hour buffer", async () => {
    const logger = createMockLogger();
    const adapter = new LinearAdapter({
      clientId: "test-client",
      clientSecret: "test-secret",
      webhookSecret: "secret",
      userName: "bot",
      logger,
    });

    const expiresIn = 2592000; // 30 days in seconds
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "token-123",
          expires_in: expiresIn,
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const before = Date.now();
    await (
      adapter as unknown as {
        refreshClientCredentialsToken: () => Promise<void>;
      }
    ).refreshClientCredentialsToken();
    const after = Date.now();

    const expiry = (adapter as unknown as { accessTokenExpiry: number })
      .accessTokenExpiry;
    // expiry should be approximately now + expiresIn*1000 - 3600000 (1 hour buffer)
    const expectedMin = before + expiresIn * 1000 - 3600000;
    const expectedMax = after + expiresIn * 1000 - 3600000;
    expect(expiry).toBeGreaterThanOrEqual(expectedMin);
    expect(expiry).toBeLessThanOrEqual(expectedMax);

    expect(logger.info).toHaveBeenCalledWith(
      "Linear client credentials token obtained",
      expect.objectContaining({ expiresIn: "30 days" })
    );

    vi.unstubAllGlobals();
  });
});

// =============================================================================
// createLinearAdapter factory
// =============================================================================

describe("createLinearAdapter", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    // Clean Linear env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("LINEAR_")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("should create adapter with apiKey config", () => {
    const adapter = createLinearAdapter({
      apiKey: "lin_api_123",
      webhookSecret: "secret",
    });
    expect(adapter).toBeInstanceOf(LinearAdapter);
    expect(adapter.name).toBe("linear");
  });

  it("should create adapter with accessToken config", () => {
    const adapter = createLinearAdapter({
      accessToken: "lin_oauth_123",
      webhookSecret: "secret",
    });
    expect(adapter).toBeInstanceOf(LinearAdapter);
  });

  it("should create adapter with clientId/clientSecret config", () => {
    const adapter = createLinearAdapter({
      clientId: "client-id",
      clientSecret: "client-secret",
      webhookSecret: "secret",
    });
    expect(adapter).toBeInstanceOf(LinearAdapter);
  });

  it("should throw when webhookSecret is not provided and not in env", () => {
    expect(() => createLinearAdapter({ apiKey: "key" })).toThrow(
      "webhookSecret is required"
    );
  });

  it("should use LINEAR_WEBHOOK_SECRET env var", () => {
    process.env.LINEAR_WEBHOOK_SECRET = "env-secret";
    const adapter = createLinearAdapter({ apiKey: "key" });
    expect(adapter).toBeInstanceOf(LinearAdapter);
  });

  it("should use LINEAR_API_KEY env var when no auth config provided", () => {
    process.env.LINEAR_WEBHOOK_SECRET = "env-secret";
    process.env.LINEAR_API_KEY = "env-api-key";
    const adapter = createLinearAdapter();
    expect(adapter).toBeInstanceOf(LinearAdapter);
  });

  it("should use LINEAR_ACCESS_TOKEN env var when no auth config and no api key", () => {
    process.env.LINEAR_WEBHOOK_SECRET = "env-secret";
    process.env.LINEAR_ACCESS_TOKEN = "env-access-token";
    const adapter = createLinearAdapter();
    expect(adapter).toBeInstanceOf(LinearAdapter);
  });

  it("should use LINEAR_CLIENT_ID/SECRET env vars when no other auth", () => {
    process.env.LINEAR_WEBHOOK_SECRET = "env-secret";
    process.env.LINEAR_CLIENT_ID = "env-client-id";
    process.env.LINEAR_CLIENT_SECRET = "env-client-secret";
    const adapter = createLinearAdapter();
    expect(adapter).toBeInstanceOf(LinearAdapter);
  });

  it("should throw when no auth is available", () => {
    process.env.LINEAR_WEBHOOK_SECRET = "env-secret";
    expect(() => createLinearAdapter()).toThrow("Authentication is required");
  });

  it("should use LINEAR_BOT_USERNAME env var for userName", () => {
    process.env.LINEAR_WEBHOOK_SECRET = "env-secret";
    process.env.LINEAR_BOT_USERNAME = "custom-bot-name";
    process.env.LINEAR_API_KEY = "key";
    const adapter = createLinearAdapter();
    expect(adapter.userName).toBe("custom-bot-name");
  });

  it("should default userName to linear-bot", () => {
    process.env.LINEAR_WEBHOOK_SECRET = "env-secret";
    process.env.LINEAR_API_KEY = "key";
    const adapter = createLinearAdapter();
    expect(adapter.userName).toBe("linear-bot");
  });

  it("should prefer config userName over env var", () => {
    process.env.LINEAR_WEBHOOK_SECRET = "env-secret";
    process.env.LINEAR_BOT_USERNAME = "env-name";
    const adapter = createLinearAdapter({
      apiKey: "key",
      userName: "config-name",
    });
    expect(adapter.userName).toBe("config-name");
  });

  it("should not mix auth modes - explicit apiKey ignores env accessToken", () => {
    process.env.LINEAR_WEBHOOK_SECRET = "env-secret";
    process.env.LINEAR_ACCESS_TOKEN = "env-token";
    // Providing apiKey means we have an auth config, so env vars are skipped
    const adapter = createLinearAdapter({ apiKey: "explicit-key" });
    expect(adapter).toBeInstanceOf(LinearAdapter);
  });

  it("should accept custom logger", () => {
    const customLogger = createMockLogger();
    const adapter = createLinearAdapter({
      apiKey: "key",
      webhookSecret: "secret",
      logger: customLogger,
    });
    expect(adapter).toBeInstanceOf(LinearAdapter);
  });
});
