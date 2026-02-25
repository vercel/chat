/**
 * Tests for the Telegram adapter - webhook handling, message operations, and format conversion.
 */

import { ValidationError } from "@chat-adapter/shared";
import type { ChatInstance, Logger } from "chat";
import { describe, expect, it, vi } from "vitest";
import { createTelegramAdapter, TelegramAdapter } from "./index";
import type {
  TelegramCallbackQuery,
  TelegramRawMessage,
  TelegramUpdate,
} from "./types";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(() => mockLogger),
};

// ============================================================================
// Test Helpers
// ============================================================================

function createWebhookRequest(
  body: string,
  options?: { secretToken?: string }
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (options?.secretToken) {
    headers["x-telegram-bot-api-secret-token"] = options.secretToken;
  }
  return new Request("https://example.com/webhook", {
    method: "POST",
    headers,
    body,
  });
}

function createTelegramMessage(
  overrides: Partial<TelegramRawMessage> = {}
): TelegramRawMessage {
  return {
    message_id: 123,
    date: Math.floor(Date.now() / 1000),
    chat: {
      id: 456,
      type: "private",
      first_name: "Test",
      username: "testuser",
    },
    from: {
      id: 789,
      is_bot: false,
      first_name: "Test",
      last_name: "User",
      username: "testuser",
    },
    text: "Hello, bot!",
    ...overrides,
  };
}

function createAdapter(
  overrides?: Partial<{
    botToken: string;
    secretToken: string;
    userName: string;
  }>
): TelegramAdapter {
  return new TelegramAdapter({
    botToken: "test-bot-token",
    logger: mockLogger,
    ...overrides,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("TelegramAdapter", () => {
  describe("createTelegramAdapter factory", () => {
    it("should throw if bot token is missing", () => {
      const originalEnv = process.env.TELEGRAM_BOT_TOKEN;
      process.env.TELEGRAM_BOT_TOKEN = "";

      expect(() => createTelegramAdapter({})).toThrow(ValidationError);

      if (originalEnv) {
        process.env.TELEGRAM_BOT_TOKEN = originalEnv;
      }
    });

    it("should create adapter from config", () => {
      const adapter = createTelegramAdapter({
        botToken: "test-token",
        logger: mockLogger,
      });
      expect(adapter.name).toBe("telegram");
    });

    it("should use env var for bot token", () => {
      const originalEnv = process.env.TELEGRAM_BOT_TOKEN;
      process.env.TELEGRAM_BOT_TOKEN = "env-token";

      const adapter = createTelegramAdapter({ logger: mockLogger });
      expect(adapter.name).toBe("telegram");

      process.env.TELEGRAM_BOT_TOKEN = originalEnv;
    });
  });

  describe("thread ID encoding/decoding", () => {
    it("should encode thread ID", () => {
      const adapter = createAdapter();
      const threadId = adapter.encodeThreadId({
        chatId: 123456789,
        messageThreadId: 0,
      });
      expect(threadId).toBe("telegram:123456789:0");
    });

    it("should encode thread ID with forum topic", () => {
      const adapter = createAdapter();
      const threadId = adapter.encodeThreadId({
        chatId: -1001234567890,
        messageThreadId: 42,
      });
      expect(threadId).toBe("telegram:-1001234567890:42");
    });

    it("should decode thread ID", () => {
      const adapter = createAdapter();
      const result = adapter.decodeThreadId("telegram:123456789:0");
      expect(result).toEqual({ chatId: 123456789, messageThreadId: 0 });
    });

    it("should decode thread ID with forum topic", () => {
      const adapter = createAdapter();
      const result = adapter.decodeThreadId("telegram:-1001234567890:42");
      expect(result).toEqual({
        chatId: -1001234567890,
        messageThreadId: 42,
      });
    });

    it("should throw on invalid thread ID", () => {
      const adapter = createAdapter();
      expect(() => adapter.decodeThreadId("invalid")).toThrow(ValidationError);
    });

    it("should throw on wrong adapter prefix", () => {
      const adapter = createAdapter();
      expect(() => adapter.decodeThreadId("slack:C123:1234")).toThrow(
        ValidationError
      );
    });
  });

  describe("webhook handling", () => {
    it("should reject invalid secret token", async () => {
      const adapter = createAdapter({ secretToken: "my-secret" });
      const request = createWebhookRequest(JSON.stringify({ update_id: 1 }), {
        secretToken: "wrong-secret",
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(401);
    });

    it("should accept valid secret token", async () => {
      const adapter = createAdapter({ secretToken: "my-secret" });
      const request = createWebhookRequest(JSON.stringify({ update_id: 1 }), {
        secretToken: "my-secret",
      });

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
    });

    it("should accept request when no secret token configured", async () => {
      const adapter = createAdapter();
      const request = createWebhookRequest(JSON.stringify({ update_id: 1 }));

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
    });

    it("should reject invalid JSON", async () => {
      const adapter = createAdapter();
      const request = createWebhookRequest("not-json");

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(400);
    });

    it("should process message update", async () => {
      const adapter = createAdapter();
      const mockChat = {
        processMessage: vi.fn(),
      } as unknown as ChatInstance;
      // Set chat instance directly
      Object.assign(adapter, { chat: mockChat });

      const message = createTelegramMessage();
      const update: TelegramUpdate = {
        update_id: 1,
        message,
      };

      const request = createWebhookRequest(JSON.stringify(update));
      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
      expect(mockChat.processMessage).toHaveBeenCalledWith(
        adapter,
        "telegram:456:0",
        expect.any(Object),
        undefined
      );
    });

    it("should process callback query", async () => {
      const adapter = createAdapter();
      const mockChat = {
        processAction: vi.fn(),
      } as unknown as ChatInstance;
      Object.assign(adapter, { chat: mockChat });

      // Mock the API to avoid real calls
      Object.assign(adapter, {
        api: { answerCallbackQuery: vi.fn().mockResolvedValue(true) },
      });

      const callbackQuery: TelegramCallbackQuery = {
        id: "query-1",
        from: {
          id: 789,
          is_bot: false,
          first_name: "Test",
          username: "testuser",
        },
        chat_instance: "instance-1",
        data: "action-id:some-value",
        message: createTelegramMessage(),
      };

      const update: TelegramUpdate = {
        update_id: 2,
        callback_query: callbackQuery,
      };

      const request = createWebhookRequest(JSON.stringify(update));
      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
      expect(mockChat.processAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionId: "action-id",
          value: "some-value",
          threadId: "telegram:456:0",
        }),
        undefined
      );
    });

    it("should handle callback query without colon in data", async () => {
      const adapter = createAdapter();
      const mockChat = {
        processAction: vi.fn(),
      } as unknown as ChatInstance;
      Object.assign(adapter, { chat: mockChat });
      Object.assign(adapter, {
        api: { answerCallbackQuery: vi.fn().mockResolvedValue(true) },
      });

      const callbackQuery: TelegramCallbackQuery = {
        id: "query-2",
        from: { id: 789, is_bot: false, first_name: "Test" },
        chat_instance: "instance-1",
        data: "simple-action",
        message: createTelegramMessage(),
      };

      const update: TelegramUpdate = {
        update_id: 3,
        callback_query: callbackQuery,
      };

      const request = createWebhookRequest(JSON.stringify(update));
      await adapter.handleWebhook(request);

      expect(mockChat.processAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionId: "simple-action",
          value: undefined,
        }),
        undefined
      );
    });

    it("should skip message without text", async () => {
      const adapter = createAdapter();
      const mockChat = {
        processMessage: vi.fn(),
      } as unknown as ChatInstance;
      Object.assign(adapter, { chat: mockChat });

      const message = createTelegramMessage({ text: undefined });
      const update: TelegramUpdate = {
        update_id: 4,
        message,
      };

      const request = createWebhookRequest(JSON.stringify(update));
      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
      expect(mockChat.processMessage).not.toHaveBeenCalled();
    });
  });

  describe("message parsing", () => {
    it("should parse a basic text message", () => {
      const adapter = createAdapter();
      const raw = createTelegramMessage({ text: "Hello world" });

      const message = adapter.parseMessage(raw);
      expect(message.text).toBe("Hello world");
      expect(message.id).toBe("123");
      expect(message.threadId).toBe("telegram:456:0");
      expect(message.author.userName).toBe("testuser");
      expect(message.author.fullName).toBe("Test User");
      expect(message.author.isBot).toBe(false);
    });

    it("should detect mention via @username", () => {
      const adapter = createAdapter();
      // Simulate bot info being set
      Object.assign(adapter, { _botUsername: "mybot" });

      const raw = createTelegramMessage({
        text: "@mybot hello",
        entities: [{ type: "mention", offset: 0, length: 6 }],
      });

      const message = adapter.parseMessage(raw);
      expect(message.isMention).toBe(true);
    });

    it("should handle message with forum topic thread", () => {
      const adapter = createAdapter();
      const raw = createTelegramMessage({
        message_thread_id: 42,
        chat: {
          id: -1001234567890,
          type: "supergroup",
          title: "Test Group",
        },
      });

      const message = adapter.parseMessage(raw);
      expect(message.threadId).toBe("telegram:-1001234567890:42");
    });

    it("should extract photo attachments", () => {
      const adapter = createAdapter();
      const raw = createTelegramMessage({
        photo: [
          {
            file_id: "small",
            file_unique_id: "small-unique",
            width: 90,
            height: 90,
          },
          {
            file_id: "large",
            file_unique_id: "large-unique",
            width: 800,
            height: 600,
            file_size: 50000,
          },
        ],
      });

      const message = adapter.parseMessage(raw);
      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0]).toEqual(
        expect.objectContaining({
          type: "image",
          width: 800,
          height: 600,
        })
      );
    });
  });

  describe("isDM", () => {
    it("should return true for positive chat IDs (private chats)", () => {
      const adapter = createAdapter();
      expect(adapter.isDM("telegram:123456789:0")).toBe(true);
    });

    it("should return false for negative chat IDs (groups)", () => {
      const adapter = createAdapter();
      expect(adapter.isDM("telegram:-1001234567890:0")).toBe(false);
    });
  });

  describe("fetchMessages", () => {
    it("should return empty result (unsupported by Telegram Bot API)", async () => {
      const adapter = createAdapter();
      const result = await adapter.fetchMessages("telegram:123:0");
      expect(result.messages).toEqual([]);
    });
  });

  describe("renderFormatted", () => {
    it("should render formatted content using format converter", () => {
      const adapter = createAdapter();
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
      expect(result).toContain("Hello");
    });
  });
});
