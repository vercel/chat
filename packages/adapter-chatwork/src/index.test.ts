/**
 * Tests for the Chatwork adapter - webhook handling, message operations, and format conversion.
 */

import { createHmac } from "node:crypto";
import { ValidationError } from "@chat-adapter/shared";
import type { Logger } from "chat";
import { describe, expect, it, vi } from "vitest";
import { ChatworkAdapter, createChatworkAdapter } from "./index";
import type {
  ChatworkApiMessage,
  ChatworkWebhookPayload,
} from "./types";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

// ============================================================================
// Test Helpers
// ============================================================================

const TEST_API_TOKEN = "test-api-token";
const TEST_WEBHOOK_TOKEN = "dGVzdC13ZWJob29rLXNlY3JldA=="; // base64("test-webhook-secret")
const TEST_BOT_ACCOUNT_ID = "99999";

function createAdapter(): ChatworkAdapter {
  return new ChatworkAdapter({
    apiToken: TEST_API_TOKEN,
    webhookToken: TEST_WEBHOOK_TOKEN,
    botAccountId: TEST_BOT_ACCOUNT_ID,
    logger: mockLogger,
  });
}

function createWebhookSignature(body: string, token: string): string {
  return createHmac("sha256", Buffer.from(token, "base64"))
    .update(body)
    .digest("base64");
}

function createWebhookRequest(
  payload: ChatworkWebhookPayload,
  options?: { signature?: string; skipSignature?: boolean }
): Request {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (!options?.skipSignature) {
    headers["x-chatworkwebhooksignature"] =
      options?.signature ?? createWebhookSignature(body, TEST_WEBHOOK_TOKEN);
  }

  return new Request("https://example.com/webhook", {
    method: "POST",
    headers,
    body,
  });
}

function createTestWebhookPayload(
  overrides?: Partial<ChatworkWebhookPayload>
): ChatworkWebhookPayload {
  return {
    webhook_setting_id: "12345",
    webhook_event_type: "message_created",
    webhook_event: {
      message_id: "msg-001",
      room_id: 123456,
      account_id: 111222,
      body: "Hello from Chatwork!",
      send_time: 1700000000,
      update_time: 0,
    },
    ...overrides,
  };
}

// ============================================================================
// Factory Function Tests
// ============================================================================

describe("createChatworkAdapter", () => {
  it("creates a ChatworkAdapter instance with config", () => {
    const adapter = createChatworkAdapter({
      apiToken: TEST_API_TOKEN,
      logger: mockLogger,
    });
    expect(adapter).toBeInstanceOf(ChatworkAdapter);
    expect(adapter.name).toBe("chatwork");
  });

  it("sets default userName to 'bot'", () => {
    const adapter = createChatworkAdapter({
      apiToken: TEST_API_TOKEN,
      logger: mockLogger,
    });
    expect(adapter.userName).toBe("bot");
  });

  it("uses provided userName", () => {
    const adapter = createChatworkAdapter({
      apiToken: TEST_API_TOKEN,
      userName: "chatwork-bot",
      logger: mockLogger,
    });
    expect(adapter.userName).toBe("chatwork-bot");
  });

  it("throws if apiToken is missing", () => {
    const originalEnv = process.env.CHATWORK_API_TOKEN;
    delete process.env.CHATWORK_API_TOKEN;

    expect(() => createChatworkAdapter({ logger: mockLogger })).toThrow(
      ValidationError
    );

    process.env.CHATWORK_API_TOKEN = originalEnv;
  });

  it("reads apiToken from environment variable", () => {
    const originalEnv = process.env.CHATWORK_API_TOKEN;
    process.env.CHATWORK_API_TOKEN = "env-token";

    const adapter = createChatworkAdapter({ logger: mockLogger });
    expect(adapter).toBeInstanceOf(ChatworkAdapter);

    process.env.CHATWORK_API_TOKEN = originalEnv;
  });
});

// ============================================================================
// Thread ID Encoding/Decoding Tests
// ============================================================================

describe("encodeThreadId", () => {
  const adapter = createAdapter();

  it("encodes room ID correctly", () => {
    const threadId = adapter.encodeThreadId({ roomId: "123456" });
    expect(threadId).toBe("chatwork:123456");
  });
});

describe("decodeThreadId", () => {
  const adapter = createAdapter();

  it("decodes valid thread ID", () => {
    const result = adapter.decodeThreadId("chatwork:123456");
    expect(result).toEqual({ roomId: "123456" });
  });

  it("throws on invalid thread ID format", () => {
    expect(() => adapter.decodeThreadId("invalid")).toThrow(ValidationError);
    expect(() => adapter.decodeThreadId("slack:C12345:123")).toThrow(
      ValidationError
    );
  });
});

// ============================================================================
// Webhook Handling Tests
// ============================================================================

describe("handleWebhook", () => {
  it("returns 200 for valid message_created webhook", async () => {
    const adapter = createAdapter();
    const mockChat = {
      getLogger: vi.fn().mockReturnValue(mockLogger),
      getState: vi.fn(),
      getUserName: vi.fn().mockReturnValue("bot"),
      handleIncomingMessage: vi.fn(),
      processMessage: vi.fn(),
      processAction: vi.fn(),
      processReaction: vi.fn(),
      processSlashCommand: vi.fn(),
      processModalSubmit: vi.fn(),
      processModalClose: vi.fn(),
      processAppHomeOpened: vi.fn(),
      processAssistantContextChanged: vi.fn(),
      processAssistantThreadStarted: vi.fn(),
    };
    await adapter.initialize(mockChat);

    const payload = createTestWebhookPayload();
    const request = createWebhookRequest(payload);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
  });

  it("returns 200 for mention_to_me webhook", async () => {
    const adapter = createAdapter();
    const mockChat = {
      getLogger: vi.fn().mockReturnValue(mockLogger),
      getState: vi.fn(),
      getUserName: vi.fn().mockReturnValue("bot"),
      handleIncomingMessage: vi.fn(),
      processMessage: vi.fn(),
      processAction: vi.fn(),
      processReaction: vi.fn(),
      processSlashCommand: vi.fn(),
      processModalSubmit: vi.fn(),
      processModalClose: vi.fn(),
      processAppHomeOpened: vi.fn(),
      processAssistantContextChanged: vi.fn(),
      processAssistantThreadStarted: vi.fn(),
    };
    await adapter.initialize(mockChat);

    const payload = createTestWebhookPayload({
      webhook_event_type: "mention_to_me",
      webhook_event: {
        message_id: "msg-002",
        room_id: 123456,
        account_id: 111222,
        body: "[To:99999] Hello bot!",
        send_time: 1700000000,
        update_time: 0,
      },
    });
    const request = createWebhookRequest(payload);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(mockChat.processMessage).toHaveBeenCalled();
  });

  it("returns 401 for invalid signature", async () => {
    const adapter = createAdapter();

    const payload = createTestWebhookPayload();
    const request = createWebhookRequest(payload, {
      signature: "invalid-signature",
    });
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(401);
  });

  it("returns 400 for invalid JSON", async () => {
    const adapter = createAdapter();
    const body = "not valid json";
    const signature = createWebhookSignature(body, TEST_WEBHOOK_TOKEN);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-chatworkwebhooksignature": signature,
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });

  it("accepts webhook without signature when webhookToken is not configured", async () => {
    const adapter = new ChatworkAdapter({
      apiToken: TEST_API_TOKEN,
      logger: mockLogger,
    });
    const mockChat = {
      getLogger: vi.fn().mockReturnValue(mockLogger),
      getState: vi.fn(),
      getUserName: vi.fn().mockReturnValue("bot"),
      handleIncomingMessage: vi.fn(),
      processMessage: vi.fn(),
      processAction: vi.fn(),
      processReaction: vi.fn(),
      processSlashCommand: vi.fn(),
      processModalSubmit: vi.fn(),
      processModalClose: vi.fn(),
      processAppHomeOpened: vi.fn(),
      processAssistantContextChanged: vi.fn(),
      processAssistantThreadStarted: vi.fn(),
    };
    await adapter.initialize(mockChat);

    const payload = createTestWebhookPayload();
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
  });
});

// ============================================================================
// parseMessage Tests
// ============================================================================

describe("parseMessage", () => {
  const adapter = createAdapter();

  it("parses a basic message", () => {
    const raw: ChatworkApiMessage = {
      message_id: "msg-001",
      account: {
        account_id: 111222,
        name: "Test User",
        avatar_image_url: "https://example.com/avatar.png",
      },
      body: "Hello world!",
      send_time: 1700000000,
      update_time: 0,
    };

    const message = adapter.parseMessage(raw, "chatwork:123456");

    expect(message.id).toBe("msg-001");
    expect(message.text).toBe("Hello world!");
    expect(message.author.userId).toBe("111222");
    expect(message.author.userName).toBe("Test User");
    expect(message.author.fullName).toBe("Test User");
    expect(message.author.isMe).toBe(false);
    expect(message.metadata.edited).toBe(false);
  });

  it("detects edited messages", () => {
    const raw: ChatworkApiMessage = {
      message_id: "msg-002",
      account: {
        account_id: 111222,
        name: "Test User",
        avatar_image_url: "",
      },
      body: "Edited message",
      send_time: 1700000000,
      update_time: 1700000100,
    };

    const message = adapter.parseMessage(raw, "chatwork:123456");

    expect(message.metadata.edited).toBe(true);
    expect(message.metadata.editedAt).toBeDefined();
  });

  it("detects own messages", () => {
    const raw: ChatworkApiMessage = {
      message_id: "msg-003",
      account: {
        account_id: 99999,
        name: "Bot",
        avatar_image_url: "",
      },
      body: "Bot message",
      send_time: 1700000000,
      update_time: 0,
    };

    const message = adapter.parseMessage(raw, "chatwork:123456");

    expect(message.author.isMe).toBe(true);
    expect(message.author.isBot).toBe(true);
  });

  it("strips Chatwork tags from text", () => {
    const raw: ChatworkApiMessage = {
      message_id: "msg-004",
      account: {
        account_id: 111222,
        name: "Test User",
        avatar_image_url: "",
      },
      body: "[To:99999] Hello bot!\n[info]Some info[/info]",
      send_time: 1700000000,
      update_time: 0,
    };

    const message = adapter.parseMessage(raw, "chatwork:123456");

    expect(message.text).not.toContain("[To:");
    expect(message.text).not.toContain("[info]");
    expect(message.text).not.toContain("[/info]");
    expect(message.text).toContain("Hello bot!");
    expect(message.text).toContain("Some info");
  });

  it("uses default threadId when not provided", () => {
    const raw: ChatworkApiMessage = {
      message_id: "msg-005",
      account: {
        account_id: 111222,
        name: "Test User",
        avatar_image_url: "",
      },
      body: "Test",
      send_time: 1700000000,
      update_time: 0,
    };

    const message = adapter.parseMessage(raw);

    expect(message.threadId).toBe("chatwork:unknown");
  });
});

// ============================================================================
// renderFormatted Tests
// ============================================================================

describe("renderFormatted", () => {
  const adapter = createAdapter();

  it("renders plain text", async () => {
    const { parseMarkdown } = await import("chat");
    const formatted = parseMarkdown("Hello world");
    const result = adapter.renderFormatted(formatted);
    expect(result).toContain("Hello world");
  });
});

// ============================================================================
// Reaction/Typing No-op Tests
// ============================================================================

describe("addReaction", () => {
  const adapter = createAdapter();

  it("should not throw", async () => {
    await expect(
      adapter.addReaction("chatwork:123", "msg-1", "thumbsup")
    ).resolves.toBeUndefined();
  });
});

describe("removeReaction", () => {
  const adapter = createAdapter();

  it("should not throw", async () => {
    await expect(
      adapter.removeReaction("chatwork:123", "msg-1", "thumbsup")
    ).resolves.toBeUndefined();
  });
});

describe("startTyping", () => {
  const adapter = createAdapter();

  it("should not throw", async () => {
    await expect(
      adapter.startTyping("chatwork:123")
    ).resolves.toBeUndefined();
  });
});

// ============================================================================
// isDM Tests
// ============================================================================

describe("isDM", () => {
  const adapter = createAdapter();

  it("returns false by default", () => {
    expect(adapter.isDM("chatwork:123456")).toBe(false);
  });
});
