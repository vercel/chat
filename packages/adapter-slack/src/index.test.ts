/**
 * Tests for the Slack adapter - webhook handling, message operations, and format conversion.
 */

import { createHmac, randomBytes } from "node:crypto";
import { ValidationError } from "@chat-adapter/shared";
import type { ChatInstance, Logger, StateAdapter } from "chat";
import { describe, expect, it, vi } from "vitest";
import type { SlackInstallation } from "./index";
import { createSlackAdapter, SlackAdapter } from "./index";

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

function createSlackSignature(
  body: string,
  secret: string,
  timestamp: number
): string {
  const sigBasestring = `v0:${timestamp}:${body}`;
  return `v0=${createHmac("sha256", secret).update(sigBasestring).digest("hex")}`;
}

function createWebhookRequest(
  body: string,
  secret: string,
  options?: { timestampOffset?: number; contentType?: string }
): Request {
  const timestamp =
    Math.floor(Date.now() / 1000) + (options?.timestampOffset ?? 0);
  const signature = createSlackSignature(body, secret, timestamp);

  return new Request("https://example.com/webhook", {
    method: "POST",
    headers: {
      "x-slack-request-timestamp": String(timestamp),
      "x-slack-signature": signature,
      "content-type": options?.contentType ?? "application/json",
    },
    body,
  });
}

// ============================================================================
// Factory Function Tests
// ============================================================================

describe("createSlackAdapter", () => {
  it("creates a SlackAdapter instance", () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: "test-secret",
      logger: mockLogger,
    });
    expect(adapter).toBeInstanceOf(SlackAdapter);
    expect(adapter.name).toBe("slack");
  });

  it("sets default userName to 'bot'", () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: "test-secret",
      logger: mockLogger,
    });
    expect(adapter.userName).toBe("bot");
  });

  it("uses provided userName", () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: "test-secret",
      logger: mockLogger,
      userName: "custombot",
    });
    expect(adapter.userName).toBe("custombot");
  });

  it("stores botUserId when provided", () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: "test-secret",
      logger: mockLogger,
      botUserId: "U12345",
    });
    expect(adapter.botUserId).toBe("U12345");
  });
});

// ============================================================================
// Thread ID Encoding/Decoding Tests
// ============================================================================

describe("encodeThreadId", () => {
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: "test-secret",
    logger: mockLogger,
  });

  it("encodes channel and threadTs correctly", () => {
    const threadId = adapter.encodeThreadId({
      channel: "C12345",
      threadTs: "1234567890.123456",
    });
    expect(threadId).toBe("slack:C12345:1234567890.123456");
  });

  it("handles empty threadTs", () => {
    const threadId = adapter.encodeThreadId({
      channel: "C12345",
      threadTs: "",
    });
    expect(threadId).toBe("slack:C12345:");
  });
});

describe("decodeThreadId", () => {
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: "test-secret",
    logger: mockLogger,
  });

  it("decodes valid thread ID", () => {
    const result = adapter.decodeThreadId("slack:C12345:1234567890.123456");
    expect(result).toEqual({
      channel: "C12345",
      threadTs: "1234567890.123456",
    });
  });

  it("decodes thread ID with empty threadTs", () => {
    const result = adapter.decodeThreadId("slack:C12345:");
    expect(result).toEqual({
      channel: "C12345",
      threadTs: "",
    });
  });

  it("decodes channel-only ID (no threadTs)", () => {
    const result = adapter.decodeThreadId("slack:C12345");
    expect(result).toEqual({
      channel: "C12345",
      threadTs: "",
    });
  });

  it("throws on invalid thread ID format", () => {
    expect(() => adapter.decodeThreadId("invalid")).toThrow(ValidationError);
    expect(() => adapter.decodeThreadId("slack")).toThrow(ValidationError);
    expect(() => adapter.decodeThreadId("teams:C12345:123")).toThrow(
      ValidationError
    );
    expect(() => adapter.decodeThreadId("slack:A:B:C:D")).toThrow(
      ValidationError
    );
  });
});

describe("isDM", () => {
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: "test-secret",
    logger: mockLogger,
  });

  it("returns true for DM channels (D prefix)", () => {
    expect(adapter.isDM("slack:D12345:1234567890.123456")).toBe(true);
  });

  it("returns false for public channels (C prefix)", () => {
    expect(adapter.isDM("slack:C12345:1234567890.123456")).toBe(false);
  });

  it("returns false for private channels (G prefix)", () => {
    expect(adapter.isDM("slack:G12345:1234567890.123456")).toBe(false);
  });
});

// ============================================================================
// Webhook Signature Verification Tests
// ============================================================================

describe("handleWebhook - signature verification", () => {
  const secret = "test-signing-secret";
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: secret,
    logger: mockLogger,
  });

  it("rejects requests without timestamp header", async () => {
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-slack-signature": "v0=invalid",
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "url_verification" }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("rejects requests without signature header", async () => {
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)),
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "url_verification" }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("rejects requests with invalid signature", async () => {
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-slack-signature": "v0=invalid",
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "url_verification" }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("rejects requests with old timestamp (>5 min)", async () => {
    const body = JSON.stringify({ type: "url_verification" });
    const request = createWebhookRequest(body, secret, {
      timestampOffset: -400, // 400 seconds old
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("accepts requests with valid signature", async () => {
    const body = JSON.stringify({
      type: "url_verification",
      challenge: "test-challenge",
    });
    const request = createWebhookRequest(body, secret);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });
});

// ============================================================================
// URL Verification Challenge Tests
// ============================================================================

describe("handleWebhook - URL verification", () => {
  const secret = "test-signing-secret";
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: secret,
    logger: mockLogger,
  });

  it("responds to url_verification challenge", async () => {
    const body = JSON.stringify({
      type: "url_verification",
      challenge: "test-challenge-123",
    });
    const request = createWebhookRequest(body, secret);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const responseBody = await response.json();
    expect(responseBody).toEqual({ challenge: "test-challenge-123" });
  });
});

// ============================================================================
// Event Callback Tests
// ============================================================================

describe("handleWebhook - event_callback", () => {
  const secret = "test-signing-secret";
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: secret,
    logger: mockLogger,
  });

  it("handles message events", async () => {
    const body = JSON.stringify({
      type: "event_callback",
      event: {
        type: "message",
        user: "U123",
        channel: "C456",
        text: "Hello world",
        ts: "1234567890.123456",
      },
    });
    const request = createWebhookRequest(body, secret);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("handles app_mention events", async () => {
    const body = JSON.stringify({
      type: "event_callback",
      event: {
        type: "app_mention",
        user: "U123",
        channel: "C456",
        text: "<@U_BOT> hello",
        ts: "1234567890.123456",
      },
    });
    const request = createWebhookRequest(body, secret);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("handles reaction_added events", async () => {
    const body = JSON.stringify({
      type: "event_callback",
      event: {
        type: "reaction_added",
        user: "U123",
        reaction: "thumbsup",
        item: {
          type: "message",
          channel: "C456",
          ts: "1234567890.123456",
        },
      },
    });
    const request = createWebhookRequest(body, secret);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("handles reaction_removed events", async () => {
    const body = JSON.stringify({
      type: "event_callback",
      event: {
        type: "reaction_removed",
        user: "U123",
        reaction: "thumbsup",
        item: {
          type: "message",
          channel: "C456",
          ts: "1234567890.123456",
        },
      },
    });
    const request = createWebhookRequest(body, secret);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });
});

// ============================================================================
// Interactive Payload Tests (Block Actions)
// ============================================================================

describe("handleWebhook - interactive payloads", () => {
  const secret = "test-signing-secret";
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: secret,
    logger: mockLogger,
  });

  it("handles block_actions payload", async () => {
    const payload = JSON.stringify({
      type: "block_actions",
      user: {
        id: "U123",
        username: "testuser",
        name: "Test User",
      },
      container: {
        type: "message",
        message_ts: "1234567890.123456",
        channel_id: "C456",
      },
      channel: {
        id: "C456",
        name: "general",
      },
      message: {
        ts: "1234567890.123456",
        thread_ts: "1234567890.000000",
      },
      actions: [
        {
          type: "button",
          action_id: "approve_btn",
          value: "approved",
        },
      ],
    });
    const body = `payload=${encodeURIComponent(payload)}`;
    const request = createWebhookRequest(body, secret, {
      contentType: "application/x-www-form-urlencoded",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("returns 400 for missing payload", async () => {
    const body = "foo=bar";
    const request = createWebhookRequest(body, secret, {
      contentType: "application/x-www-form-urlencoded",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });

  it("returns 400 for invalid payload JSON", async () => {
    const body = "payload=invalid-json";
    const request = createWebhookRequest(body, secret, {
      contentType: "application/x-www-form-urlencoded",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });

  it("handles view_submission payload", async () => {
    const payload = JSON.stringify({
      type: "view_submission",
      trigger_id: "trigger123",
      user: {
        id: "U123",
        username: "testuser",
        name: "Test User",
      },
      view: {
        id: "V123",
        callback_id: "feedback_form",
        private_metadata: "thread-context",
        state: {
          values: {
            message_block: {
              message_input: { value: "Great feedback!" },
            },
            category_block: {
              category_select: { selected_option: { value: "feature" } },
            },
          },
        },
      },
    });
    const body = `payload=${encodeURIComponent(payload)}`;
    const request = createWebhookRequest(body, secret, {
      contentType: "application/x-www-form-urlencoded",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("handles view_closed payload", async () => {
    const payload = JSON.stringify({
      type: "view_closed",
      user: {
        id: "U123",
        username: "testuser",
        name: "Test User",
      },
      view: {
        id: "V123",
        callback_id: "feedback_form",
        private_metadata: "thread-context",
      },
    });
    const body = `payload=${encodeURIComponent(payload)}`;
    const request = createWebhookRequest(body, secret, {
      contentType: "application/x-www-form-urlencoded",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("includes trigger_id in block_actions event", async () => {
    const payload = JSON.stringify({
      type: "block_actions",
      trigger_id: "trigger456",
      user: {
        id: "U123",
        username: "testuser",
        name: "Test User",
      },
      container: {
        type: "message",
        message_ts: "1234567890.123456",
        channel_id: "C456",
      },
      channel: {
        id: "C456",
        name: "general",
      },
      message: {
        ts: "1234567890.123456",
      },
      actions: [
        {
          type: "button",
          action_id: "open_modal",
          value: "modal-data",
        },
      ],
    });
    const body = `payload=${encodeURIComponent(payload)}`;
    const request = createWebhookRequest(body, secret, {
      contentType: "application/x-www-form-urlencoded",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });
});

// ============================================================================
// JSON Parsing Tests
// ============================================================================

describe("handleWebhook - JSON parsing", () => {
  const secret = "test-signing-secret";
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: secret,
    logger: mockLogger,
  });

  it("returns 400 for invalid JSON", async () => {
    const body = "not valid json";
    const request = createWebhookRequest(body, secret);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });
});

// ============================================================================
// parseMessage Tests
// ============================================================================

describe("parseMessage", () => {
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: "test-secret",
    logger: mockLogger,
    botUserId: "U_BOT",
  });

  it("parses a basic message event", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "Hello world",
      ts: "1234567890.123456",
    };

    const message = adapter.parseMessage(event);

    expect(message.id).toBe("1234567890.123456");
    expect(message.text).toBe("Hello world");
    expect(message.author.userId).toBe("U123");
    expect(message.author.isBot).toBe(false);
    expect(message.author.isMe).toBe(false);
  });

  it("parses a bot message", () => {
    const event = {
      type: "message",
      bot_id: "B123",
      channel: "C456",
      text: "Bot message",
      ts: "1234567890.123456",
      subtype: "bot_message",
    };

    const message = adapter.parseMessage(event);

    expect(message.author.userId).toBe("B123");
    expect(message.author.isBot).toBe(true);
  });

  it("detects messages from self", () => {
    const event = {
      type: "message",
      user: "U_BOT",
      channel: "C456",
      text: "Self message",
      ts: "1234567890.123456",
    };

    const message = adapter.parseMessage(event);
    expect(message.author.isMe).toBe(true);
  });

  it("parses message with thread_ts", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "Thread reply",
      ts: "1234567891.123456",
      thread_ts: "1234567890.123456",
    };

    const message = adapter.parseMessage(event);
    expect(message.threadId).toBe("slack:C456:1234567890.123456");
  });

  it("parses edited message", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "Edited message",
      ts: "1234567890.123456",
      edited: { ts: "1234567891.000000" },
    };

    const message = adapter.parseMessage(event);
    expect(message.metadata?.edited).toBe(true);
    expect(message.metadata?.editedAt).toBeDefined();
  });

  it("parses message with files", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "Message with file",
      ts: "1234567890.123456",
      files: [
        {
          id: "F123",
          mimetype: "image/png",
          url_private: "https://files.slack.com/file.png",
          name: "image.png",
          size: 12345,
          original_w: 800,
          original_h: 600,
        },
      ],
    };

    const message = adapter.parseMessage(event);
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments?.[0].type).toBe("image");
    expect(message.attachments?.[0].name).toBe("image.png");
    expect(message.attachments?.[0].mimeType).toBe("image/png");
    expect(message.attachments?.[0].width).toBe(800);
    expect(message.attachments?.[0].height).toBe(600);
  });

  it("handles different file types", () => {
    const createEvent = (mimetype: string) => ({
      type: "message",
      user: "U123",
      channel: "C456",
      text: "",
      ts: "1234567890.123456",
      files: [{ id: "F123", mimetype, url_private: "https://example.com" }],
    });

    const imageMsg = adapter.parseMessage(createEvent("image/jpeg"));
    expect(imageMsg.attachments?.[0].type).toBe("image");

    const videoMsg = adapter.parseMessage(createEvent("video/mp4"));
    expect(videoMsg.attachments?.[0].type).toBe("video");

    const audioMsg = adapter.parseMessage(createEvent("audio/mpeg"));
    expect(audioMsg.attachments?.[0].type).toBe("audio");

    const fileMsg = adapter.parseMessage(createEvent("application/pdf"));
    expect(fileMsg.attachments?.[0].type).toBe("file");
  });
});

// ============================================================================
// renderFormatted Tests
// ============================================================================

describe("renderFormatted", () => {
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: "test-secret",
    logger: mockLogger,
  });

  it("renders AST to Slack mrkdwn format", () => {
    const ast = {
      type: "root" as const,
      children: [
        {
          type: "paragraph" as const,
          children: [
            {
              type: "strong" as const,
              children: [{ type: "text" as const, value: "bold" }],
            },
          ],
        },
      ],
    };

    const result = adapter.renderFormatted(ast);
    expect(result).toBe("*bold*");
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("edge cases", () => {
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: "test-secret",
    logger: mockLogger,
  });

  it("handles missing text in event", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      ts: "1234567890.123456",
    };

    const message = adapter.parseMessage(event);
    expect(message.text).toBe("");
  });

  it("handles missing user in event", () => {
    const event = {
      type: "message",
      channel: "C456",
      text: "Anonymous message",
      ts: "1234567890.123456",
    };

    const message = adapter.parseMessage(event);
    expect(message.author.userId).toBe("unknown");
  });

  it("handles missing ts in event", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "No timestamp",
    };

    const message = adapter.parseMessage(event);
    expect(message.id).toBe("");
  });

  it("parses username from event when available", () => {
    const event = {
      type: "message",
      user: "U123",
      username: "testuser",
      channel: "C456",
      text: "Hello",
      ts: "1234567890.123456",
    };

    const message = adapter.parseMessage(event);
    expect(message.author.userName).toBe("testuser");
  });
});

// ============================================================================
// Date Parsing Tests
// ============================================================================

describe("date parsing", () => {
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: "test-secret",
    logger: mockLogger,
  });

  it("parses Slack timestamp to Date", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "Hello",
      ts: "1609459200.000000", // 2021-01-01 00:00:00 UTC
    };

    const message = adapter.parseMessage(event);
    expect(message.metadata?.dateSent).toEqual(new Date(1609459200000));
  });

  it("handles edited timestamp", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "Hello",
      ts: "1609459200.000000",
      edited: { ts: "1609459260.000000" }, // 1 minute later
    };

    const message = adapter.parseMessage(event);
    expect(message.metadata?.editedAt).toEqual(new Date(1609459260000));
  });
});

// ============================================================================
// Formatted Text Extraction Tests
// ============================================================================

describe("formatted text extraction", () => {
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: "test-secret",
    logger: mockLogger,
  });

  it("extracts plain text from mrkdwn", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "*bold* and _italic_",
      ts: "1234567890.123456",
    };

    const message = adapter.parseMessage(event);
    expect(message.text).toBe("bold and italic");
  });

  it("extracts text from links", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "Check <https://example.com|this link>",
      ts: "1234567890.123456",
    };

    const message = adapter.parseMessage(event);
    expect(message.text).toContain("this link");
  });

  it("extracts text from user mentions", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "Hey <@U456|john>!",
      ts: "1234567890.123456",
    };

    const message = adapter.parseMessage(event);
    expect(message.text).toContain("@john");
  });
});

// ============================================================================
// Multi-workspace Test Helpers
// ============================================================================

function createMockState(): StateAdapter & { cache: Map<string, unknown> } {
  const cache = new Map<string, unknown>();
  return {
    cache,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    isSubscribed: vi.fn().mockResolvedValue(false),
    acquireLock: vi.fn().mockResolvedValue(null),
    releaseLock: vi.fn().mockResolvedValue(undefined),
    extendLock: vi.fn().mockResolvedValue(true),
    get: vi.fn().mockImplementation((key: string) => {
      return Promise.resolve(cache.get(key) ?? null);
    }),
    set: vi.fn().mockImplementation((key: string, value: unknown) => {
      cache.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn().mockImplementation((key: string) => {
      cache.delete(key);
      return Promise.resolve();
    }),
  };
}

function createMockChatInstance(state: StateAdapter): ChatInstance {
  return {
    processMessage: vi.fn(),
    handleIncomingMessage: vi.fn().mockResolvedValue(undefined),
    processReaction: vi.fn(),
    processAction: vi.fn(),
    processModalSubmit: vi.fn().mockResolvedValue(undefined),
    processModalClose: vi.fn(),
    processSlashCommand: vi.fn(),
    getState: () => state,
    getUserName: () => "test-bot",
    getLogger: () => mockLogger,
  };
}

// ============================================================================
// Multi-workspace Mode Tests
// ============================================================================

describe("multi-workspace mode", () => {
  const secret = "test-signing-secret";

  it("creates adapter without botToken", () => {
    const adapter = createSlackAdapter({
      signingSecret: secret,
      logger: mockLogger,
    });
    expect(adapter).toBeInstanceOf(SlackAdapter);
    expect(adapter.name).toBe("slack");
  });

  it("setInstallation throws before initialize", async () => {
    const adapter = createSlackAdapter({
      signingSecret: secret,
      logger: mockLogger,
    });
    await expect(
      adapter.setInstallation("T123", { botToken: "xoxb-token" })
    ).rejects.toThrow("Adapter not initialized");
  });

  it("setInstallation / getInstallation round-trip", async () => {
    const state = createMockState();
    const adapter = createSlackAdapter({
      signingSecret: secret,
      logger: mockLogger,
    });
    await adapter.initialize(createMockChatInstance(state));

    const installation: SlackInstallation = {
      botToken: "xoxb-workspace-token",
      botUserId: "U_BOT_123",
      teamName: "Test Team",
    };

    await adapter.setInstallation("T_TEAM_1", installation);
    const retrieved = await adapter.getInstallation("T_TEAM_1");

    expect(retrieved).toEqual(installation);
  });

  it("getInstallation returns null for unknown team", async () => {
    const state = createMockState();
    const adapter = createSlackAdapter({
      signingSecret: secret,
      logger: mockLogger,
    });
    await adapter.initialize(createMockChatInstance(state));

    const result = await adapter.getInstallation("T_UNKNOWN");
    expect(result).toBeNull();
  });

  it("deleteInstallation removes data", async () => {
    const state = createMockState();
    const adapter = createSlackAdapter({
      signingSecret: secret,
      logger: mockLogger,
    });
    await adapter.initialize(createMockChatInstance(state));

    await adapter.setInstallation("T_TEAM_2", {
      botToken: "xoxb-token",
    });
    expect(await adapter.getInstallation("T_TEAM_2")).not.toBeNull();

    await adapter.deleteInstallation("T_TEAM_2");
    expect(await adapter.getInstallation("T_TEAM_2")).toBeNull();
  });

  it("handleWebhook resolves token from state for event_callback", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    const adapter = createSlackAdapter({
      signingSecret: secret,
      logger: mockLogger,
    });
    await adapter.initialize(chatInstance);

    await adapter.setInstallation("T_MULTI_1", {
      botToken: "xoxb-multi-token-1",
      botUserId: "U_BOT_M1",
    });

    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T_MULTI_1",
      event: {
        type: "message",
        user: "U123",
        channel: "C456",
        text: "Hello multi",
        ts: "1234567890.123456",
      },
    });
    const request = createWebhookRequest(body, secret);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    // processMessage should have been called (message was dispatched)
    expect(chatInstance.processMessage).toHaveBeenCalled();
  });

  it("handleWebhook resolves token for interactive payloads", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    const adapter = createSlackAdapter({
      signingSecret: secret,
      logger: mockLogger,
    });
    await adapter.initialize(chatInstance);

    await adapter.setInstallation("T_INTER_1", {
      botToken: "xoxb-inter-token",
    });

    const payload = JSON.stringify({
      type: "block_actions",
      team: { id: "T_INTER_1" },
      user: {
        id: "U123",
        username: "testuser",
        name: "Test User",
      },
      container: {
        type: "message",
        message_ts: "1234567890.123456",
        channel_id: "C456",
      },
      channel: { id: "C456", name: "general" },
      message: { ts: "1234567890.123456" },
      actions: [{ type: "button", action_id: "test_action", value: "v" }],
    });
    const body = `payload=${encodeURIComponent(payload)}`;
    const request = createWebhookRequest(body, secret, {
      contentType: "application/x-www-form-urlencoded",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("URL verification works without token", async () => {
    const adapter = createSlackAdapter({
      signingSecret: secret,
      logger: mockLogger,
    });

    const body = JSON.stringify({
      type: "url_verification",
      challenge: "challenge-multi-123",
    });
    const request = createWebhookRequest(body, secret);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(responseBody).toEqual({ challenge: "challenge-multi-123" });
  });
});

// ============================================================================
// Multi-workspace Mode with Encryption Tests
// ============================================================================

describe("multi-workspace mode with encryption", () => {
  const secret = "test-signing-secret";
  const encryptionKey = randomBytes(32).toString("base64");

  it("setInstallation encrypts token", async () => {
    const state = createMockState();
    const adapter = createSlackAdapter({
      signingSecret: secret,
      logger: mockLogger,
      encryptionKey,
    });
    await adapter.initialize(createMockChatInstance(state));

    await adapter.setInstallation("T_ENC_1", {
      botToken: "xoxb-secret-token",
      botUserId: "U_BOT_E1",
    });

    // Check raw state value is encrypted (has iv/data/tag, not plaintext)
    const rawValue = state.cache.get("slack:installation:T_ENC_1") as Record<
      string,
      unknown
    >;
    expect(rawValue).toBeDefined();
    const rawToken = rawValue.botToken as Record<string, unknown>;
    expect(rawToken).toHaveProperty("iv");
    expect(rawToken).toHaveProperty("data");
    expect(rawToken).toHaveProperty("tag");
    // Should NOT contain the plaintext token
    expect(rawToken).not.toBe("xoxb-secret-token");
  });

  it("getInstallation decrypts token", async () => {
    const state = createMockState();
    const adapter = createSlackAdapter({
      signingSecret: secret,
      logger: mockLogger,
      encryptionKey,
    });
    await adapter.initialize(createMockChatInstance(state));

    await adapter.setInstallation("T_ENC_2", {
      botToken: "xoxb-encrypted-token",
      teamName: "Encrypted Team",
    });

    const installation = await adapter.getInstallation("T_ENC_2");
    expect(installation).not.toBeNull();
    expect(installation?.botToken).toBe("xoxb-encrypted-token");
    expect(installation?.teamName).toBe("Encrypted Team");
  });

  it("invalid encryption key throws at construction", () => {
    const shortKey = randomBytes(16).toString("base64");
    expect(() =>
      createSlackAdapter({
        signingSecret: secret,
        logger: mockLogger,
        encryptionKey: shortKey,
      })
    ).toThrow("Encryption key must decode to exactly 32 bytes");
  });
});

// ============================================================================
// handleOAuthCallback Tests
// ============================================================================

describe("handleOAuthCallback", () => {
  const secret = "test-signing-secret";

  it("exchanges code for token and saves installation", async () => {
    const state = createMockState();
    const adapter = createSlackAdapter({
      signingSecret: secret,
      clientId: "client-id",
      clientSecret: "client-secret",
      logger: mockLogger,
    });

    // Mock the oauth.v2.access call on the internal client
    const mockClient = (adapter as unknown as { client: { oauth: unknown } })
      .client;
    (
      mockClient as unknown as {
        oauth: { v2: { access: ReturnType<typeof vi.fn> } };
      }
    ).oauth = {
      v2: {
        access: vi.fn().mockResolvedValue({
          ok: true,
          access_token: "xoxb-oauth-bot-token",
          bot_user_id: "U_BOT_OAUTH",
          team: { id: "T_OAUTH_1", name: "OAuth Team" },
        }),
      },
    };

    await adapter.initialize(createMockChatInstance(state));

    const request = new Request(
      "https://example.com/auth/callback/slack?code=oauth-code-123"
    );
    const result = await adapter.handleOAuthCallback(request);

    expect(result.teamId).toBe("T_OAUTH_1");
    expect(result.installation.botToken).toBe("xoxb-oauth-bot-token");
    expect(result.installation.botUserId).toBe("U_BOT_OAUTH");
    expect(result.installation.teamName).toBe("OAuth Team");

    // Verify it was persisted
    const stored = await adapter.getInstallation("T_OAUTH_1");
    expect(stored).not.toBeNull();
    expect(stored?.botToken).toBe("xoxb-oauth-bot-token");
  });

  it("throws without clientId and clientSecret", async () => {
    const state = createMockState();
    const adapter = createSlackAdapter({
      signingSecret: secret,
      logger: mockLogger,
    });
    await adapter.initialize(createMockChatInstance(state));

    const request = new Request(
      "https://example.com/auth/callback/slack?code=test"
    );
    await expect(adapter.handleOAuthCallback(request)).rejects.toThrow(
      "clientId and clientSecret are required"
    );
  });
});

// ============================================================================
// withBotToken Tests
// ============================================================================

describe("withBotToken", () => {
  const secret = "test-signing-secret";

  it("sets token for duration of callback", async () => {
    const state = createMockState();
    const adapter = createSlackAdapter({
      signingSecret: secret,
      logger: mockLogger,
    });
    await adapter.initialize(createMockChatInstance(state));

    let callbackRan = false;
    await adapter.withBotToken("xoxb-context-token", () => {
      callbackRan = true;
    });
    expect(callbackRan).toBe(true);
  });

  it("concurrent calls with different tokens are isolated", async () => {
    const state = createMockState();
    const adapter = createSlackAdapter({
      signingSecret: secret,
      logger: mockLogger,
    });
    await adapter.initialize(createMockChatInstance(state));

    const tokens: string[] = [];

    await Promise.all([
      adapter.withBotToken("xoxb-token-A", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        tokens.push("A");
      }),
      adapter.withBotToken("xoxb-token-B", () => {
        tokens.push("B");
      }),
    ]);

    expect(tokens).toContain("A");
    expect(tokens).toContain("B");
  });
});

// ============================================================================
// DM Message Handling Tests
// ============================================================================

describe("DM message handling", () => {
  const secret = "test-signing-secret";

  it("top-level DM messages use empty threadTs (matches openDM subscriptions)", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });
    await adapter.initialize(chatInstance);

    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event: {
        type: "message",
        user: "U_USER",
        channel: "D_DM_CHAN",
        channel_type: "im",
        text: "hello from DM",
        ts: "1234567890.111111",
      },
    });
    const request = createWebhookRequest(body, secret);
    await adapter.handleWebhook(request);

    expect(chatInstance.processMessage).toHaveBeenCalledWith(
      adapter,
      "slack:D_DM_CHAN:",
      expect.any(Function),
      undefined
    );
  });

  it("DM thread replies use parent thread_ts", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });
    await adapter.initialize(chatInstance);

    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event: {
        type: "message",
        user: "U_USER",
        channel: "D_DM_CHAN",
        channel_type: "im",
        text: "reply in DM thread",
        ts: "1234567890.222222",
        thread_ts: "1234567890.111111",
      },
    });
    const request = createWebhookRequest(body, secret);
    await adapter.handleWebhook(request);

    expect(chatInstance.processMessage).toHaveBeenCalledWith(
      adapter,
      "slack:D_DM_CHAN:1234567890.111111",
      expect.any(Function),
      undefined
    );
  });

  it("DM messages have isMention set to true", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    // Capture the factory function to invoke it
    chatInstance.processMessage = vi.fn();
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });
    await adapter.initialize(chatInstance);

    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event: {
        type: "message",
        user: "U_USER",
        channel: "D_DM_CHAN",
        channel_type: "im",
        text: "hello from DM",
        ts: "1234567890.333333",
      },
    });
    const request = createWebhookRequest(body, secret);
    await adapter.handleWebhook(request);

    // Get the factory function passed to processMessage
    const factory = (chatInstance.processMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0][2];
    const message = await factory();
    expect(message.isMention).toBe(true);
  });

  it("channel messages do NOT have isMention auto-set", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    chatInstance.processMessage = vi.fn();
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });
    await adapter.initialize(chatInstance);

    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event: {
        type: "message",
        user: "U_USER",
        channel: "C_CHANNEL",
        text: "hello from channel",
        ts: "1234567890.444444",
      },
    });
    const request = createWebhookRequest(body, secret);
    await adapter.handleWebhook(request);

    const factory = (chatInstance.processMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0][2];
    const message = await factory();
    expect(message.isMention).toBeUndefined();
  });
});

// ============================================================================
// Slash Command Tests
// ============================================================================

describe("handleWebhook - slash commands", () => {
  const secret = "test-signing-secret";
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: secret,
    logger: mockLogger,
  });

  it("detects slash command payload (form-urlencoded with command field)", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    await adapter.initialize(chatInstance);

    const body = new URLSearchParams({
      command: "/help",
      text: "topic search",
      user_id: "U123456",
      channel_id: "C789ABC",
      trigger_id: "trigger-123",
      team_id: "T_TEAM_1",
    }).toString();

    const request = createWebhookRequest(body, secret, {
      contentType: "application/x-www-form-urlencoded",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(chatInstance.processSlashCommand).toHaveBeenCalled();
  });

  it("passes command, text, user, and triggerId to processSlashCommand", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    await adapter.initialize(chatInstance);

    const body = new URLSearchParams({
      command: "/status",
      text: "verbose",
      user_id: "U_USER_1",
      channel_id: "C_CHANNEL_1",
      trigger_id: "trigger-456",
      team_id: "T_TEAM_1",
    }).toString();

    const request = createWebhookRequest(body, secret, {
      contentType: "application/x-www-form-urlencoded",
    });

    await adapter.handleWebhook(request);

    const call = (chatInstance.processSlashCommand as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    const event = call[0];

    expect(event.command).toBe("/status");
    expect(event.text).toBe("verbose");
    expect(event.user.userId).toBe("U_USER_1");
    expect(event.triggerId).toBe("trigger-456");
    expect(event.adapter).toBe(adapter);
    expect(event.channelId).toBe("slack:C_CHANNEL_1");
  });

  it("does not treat interactive payload as slash command", async () => {
    const payload = JSON.stringify({
      type: "block_actions",
      user: { id: "U123", username: "user" },
      actions: [{ action_id: "test" }],
      container: { message_ts: "123", channel_id: "C456" },
      channel: { id: "C456", name: "general" },
      message: { ts: "123" },
    });
    const body = `payload=${encodeURIComponent(payload)}`;

    const request = createWebhookRequest(body, secret, {
      contentType: "application/x-www-form-urlencoded",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("returns 200 immediately for slash commands", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    await adapter.initialize(chatInstance);

    const body = new URLSearchParams({
      command: "/feedback",
      text: "",
      user_id: "U123",
      channel_id: "C456",
      team_id: "T_TEAM_1",
    }).toString();

    const request = createWebhookRequest(body, secret, {
      contentType: "application/x-www-form-urlencoded",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("handles slash command in multi-workspace mode", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    const multiAdapter = createSlackAdapter({
      signingSecret: secret,
      logger: mockLogger,
    });
    await multiAdapter.initialize(chatInstance);

    await multiAdapter.setInstallation("T_SLASH_TEAM", {
      botToken: "xoxb-slash-token",
      botUserId: "U_SLASH_BOT",
    });

    const body = new URLSearchParams({
      command: "/help",
      text: "",
      user_id: "U123",
      channel_id: "C456",
      team_id: "T_SLASH_TEAM",
    }).toString();

    const request = createWebhookRequest(body, secret, {
      contentType: "application/x-www-form-urlencoded",
    });

    const response = await multiAdapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(chatInstance.processSlashCommand).toHaveBeenCalled();
  });

  it("includes raw payload in event", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    await adapter.initialize(chatInstance);

    const body = new URLSearchParams({
      command: "/deploy",
      text: "production",
      user_id: "U_DEPLOY",
      user_name: "deployer",
      channel_id: "C_DEPLOY",
      channel_name: "ops",
      team_id: "T_TEAM",
      response_url: "https://hooks.slack.com/commands/xxx",
    }).toString();

    const request = createWebhookRequest(body, secret, {
      contentType: "application/x-www-form-urlencoded",
    });

    await adapter.handleWebhook(request);

    const call = (chatInstance.processSlashCommand as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    const event = call[0];

    expect(event.raw.command).toBe("/deploy");
    expect(event.raw.text).toBe("production");
    expect(event.raw.channel_id).toBe("C_DEPLOY");
    expect(event.raw.response_url).toBe("https://hooks.slack.com/commands/xxx");
  });
});
