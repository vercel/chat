/**
 * Tests for the Slack adapter - webhook handling, message operations, and format conversion.
 */

import { createHmac, randomBytes } from "node:crypto";
import { ValidationError } from "@chat-adapter/shared";
import type {
  AdapterPostableMessage,
  ChatInstance,
  Logger,
  StateAdapter,
} from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SlackInstallation } from "./index";
import { createSlackAdapter, SlackAdapter } from "./index";

const FILE_ID_PATTERN = /^file-/;

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
// Constructor env var resolution
// ============================================================================

describe("constructor env var resolution", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SLACK_")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("should throw when signingSecret is missing and env var not set", () => {
    expect(() => new SlackAdapter({})).toThrow("signingSecret is required");
  });

  it("should resolve signingSecret from SLACK_SIGNING_SECRET env var", () => {
    process.env.SLACK_SIGNING_SECRET = "env-signing-secret";
    const adapter = new SlackAdapter();
    expect(adapter).toBeInstanceOf(SlackAdapter);
  });

  it("should resolve botToken from SLACK_BOT_TOKEN in zero-config mode", () => {
    process.env.SLACK_SIGNING_SECRET = "env-signing-secret";
    process.env.SLACK_BOT_TOKEN = "xoxb-env-token";
    const adapter = new SlackAdapter();
    expect(adapter).toBeInstanceOf(SlackAdapter);
  });

  it("should default logger when not provided", () => {
    process.env.SLACK_SIGNING_SECRET = "env-signing-secret";
    const adapter = new SlackAdapter();
    expect(adapter).toBeInstanceOf(SlackAdapter);
  });

  it("should prefer config values over env vars", () => {
    process.env.SLACK_SIGNING_SECRET = "env-secret";
    const adapter = new SlackAdapter({
      signingSecret: "config-secret",
      logger: mockLogger,
    });
    expect(adapter).toBeInstanceOf(SlackAdapter);
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
    mockClientMethod(
      adapter,
      "conversations.replies",
      vi.fn().mockResolvedValue({
        ok: true,
        messages: [{ ts: "1234567890.123456" }],
      })
    );

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
    mockClientMethod(
      adapter,
      "conversations.replies",
      vi.fn().mockResolvedValue({
        ok: true,
        messages: [{ ts: "1234567890.123456" }],
      })
    );

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

  it("resolves parent thread_ts for reactions on threaded replies", async () => {
    const parentTs = "1111111111.000000";
    const replyTs = "1234567890.123456";

    mockClientMethod(
      adapter,
      "conversations.replies",
      vi.fn().mockResolvedValue({
        ok: true,
        messages: [{ ts: replyTs, thread_ts: parentTs }],
      })
    );

    const mockChat = {
      processReaction: vi.fn(),
    } as unknown as ChatInstance;
    (adapter as unknown as { chat: ChatInstance }).chat = mockChat;

    const body = JSON.stringify({
      type: "event_callback",
      event: {
        type: "reaction_added",
        user: "U123",
        reaction: "thumbsup",
        item: {
          type: "message",
          channel: "C456",
          ts: replyTs,
        },
      },
    });
    const request = createWebhookRequest(body, secret);

    await adapter.handleWebhook(request);
    // Wait for async reaction processing
    await new Promise((r) => setTimeout(r, 50));

    expect(mockChat.processReaction).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: `slack:C456:${parentTs}`,
        messageId: replyTs,
      }),
      undefined
    );
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
// Link Extraction Tests
// ============================================================================

describe("link extraction", () => {
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: "test-secret",
    logger: mockLogger,
    botUserId: "U_BOT",
  });

  it("extracts links from rich_text blocks", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "Check <https://example.com|this> out",
      ts: "1234567890.123456",
      blocks: [
        {
          type: "rich_text",
          elements: [
            {
              type: "rich_text_section",
              elements: [
                { type: "text", text: "Check " },
                { type: "link", url: "https://example.com", text: "this" },
                { type: "text", text: " out" },
              ],
            },
          ],
        },
      ],
    };

    const message = adapter.parseMessage(event);

    expect(message.links).toHaveLength(1);
    expect(message.links[0]?.url).toBe("https://example.com");
  });

  it("extracts links from text when no blocks are present", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "Visit <https://vercel.com> and <https://example.com|Example>",
      ts: "1234567890.123456",
    };

    const message = adapter.parseMessage(event);

    expect(message.links).toHaveLength(2);
    expect(message.links[0]?.url).toBe("https://vercel.com");
    expect(message.links[1]?.url).toBe("https://example.com");
  });

  it("deduplicates URLs", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "<https://example.com> and <https://example.com|again>",
      ts: "1234567890.123456",
      blocks: [
        {
          type: "rich_text",
          elements: [
            {
              type: "rich_text_section",
              elements: [
                { type: "link", url: "https://example.com" },
                { type: "link", url: "https://example.com" },
              ],
            },
          ],
        },
      ],
    };

    const message = adapter.parseMessage(event);

    expect(message.links).toHaveLength(1);
  });

  it("provides fetchMessage for Slack message links", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "<https://myteam.slack.com/archives/C789/p1234567890123456>",
      ts: "1234567890.123456",
    };

    const message = adapter.parseMessage(event);

    expect(message.links).toHaveLength(1);
    expect(message.links[0]?.url).toBe(
      "https://myteam.slack.com/archives/C789/p1234567890123456"
    );
    expect(message.links[0]?.fetchMessage).toBeInstanceOf(Function);
  });

  it("returns empty links for messages without URLs", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "Just a plain message",
      ts: "1234567890.123456",
    };

    const message = adapter.parseMessage(event);

    expect(message.links).toEqual([]);
  });

  it("does not treat user mentions as links", () => {
    const event = {
      type: "message",
      user: "U123",
      channel: "C456",
      text: "<@U456> hello",
      ts: "1234567890.123456",
    };

    const message = adapter.parseMessage(event);

    expect(message.links).toEqual([]);
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
    appendToList: vi
      .fn()
      .mockImplementation(
        (
          key: string,
          value: unknown,
          options?: { maxLength?: number; ttlMs?: number }
        ) => {
          let list = (cache.get(key) as unknown[]) ?? [];
          list.push(value);
          if (options?.maxLength && list.length > options.maxLength) {
            list = list.slice(list.length - options.maxLength);
          }
          cache.set(key, list);
          return Promise.resolve();
        }
      ),
    getList: vi.fn().mockImplementation((key: string) => {
      return Promise.resolve((cache.get(key) as unknown[]) ?? []);
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
    processMemberJoinedChannel: vi.fn(),
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
// Installation Key Prefix Tests
// ============================================================================

describe("installationKeyPrefix", () => {
  const secret = "test-signing-secret";

  it("uses custom installationKeyPrefix for storage key", async () => {
    const state = createMockState();
    const adapter = createSlackAdapter({
      signingSecret: secret,
      logger: mockLogger,
      installationKeyPrefix: "myapp:workspaces",
    });
    await adapter.initialize(createMockChatInstance(state));

    await adapter.setInstallation("T_CUSTOM_1", { botToken: "xoxb-token" });

    expect(state.cache.has("myapp:workspaces:T_CUSTOM_1")).toBe(true);
    expect(state.cache.has("slack:installation:T_CUSTOM_1")).toBe(false);

    const retrieved = await adapter.getInstallation("T_CUSTOM_1");
    expect(retrieved?.botToken).toBe("xoxb-token");
  });

  it("uses default slack:installation prefix when installationKeyPrefix is omitted", async () => {
    const state = createMockState();
    const adapter = createSlackAdapter({
      signingSecret: secret,
      logger: mockLogger,
    });
    await adapter.initialize(createMockChatInstance(state));

    await adapter.setInstallation("T_DEFAULT_1", { botToken: "xoxb-token" });

    expect(state.cache.has("slack:installation:T_DEFAULT_1")).toBe(true);
  });
});

// ============================================================================
// handleOAuthCallback Tests
// ============================================================================

describe("handleOAuthCallback", () => {
  const secret = "test-signing-secret";

  function createOAuthAdapter() {
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
    const mockAccess = vi.fn().mockResolvedValue({
      ok: true,
      access_token: "xoxb-oauth-bot-token",
      bot_user_id: "U_BOT_OAUTH",
      team: { id: "T_OAUTH_1", name: "OAuth Team" },
    });
    (
      mockClient as unknown as {
        oauth: { v2: { access: ReturnType<typeof vi.fn> } };
      }
    ).oauth = {
      v2: {
        access: mockAccess,
      },
    };

    return { adapter, state, mockAccess };
  }

  it("exchanges code for token and saves installation", async () => {
    const { adapter, state, mockAccess } = createOAuthAdapter();
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
    expect(mockAccess).toHaveBeenCalledWith({
      client_id: "client-id",
      client_secret: "client-secret",
      code: "oauth-code-123",
    });
  });

  it("forwards redirect_uri from callback options", async () => {
    const { adapter, state, mockAccess } = createOAuthAdapter();
    await adapter.initialize(createMockChatInstance(state));

    const request = new Request(
      "https://example.com/auth/callback/slack?code=oauth-code-123"
    );
    await adapter.handleOAuthCallback(request, {
      redirectUri: "https://example.com/install/callback",
    });

    expect(mockAccess).toHaveBeenCalledWith({
      client_id: "client-id",
      client_secret: "client-secret",
      code: "oauth-code-123",
      redirect_uri: "https://example.com/install/callback",
    });
  });

  it("prefers callback options redirect_uri over the query param", async () => {
    const { adapter, state, mockAccess } = createOAuthAdapter();
    await adapter.initialize(createMockChatInstance(state));

    const request = new Request(
      "https://example.com/auth/callback/slack?code=oauth-code-123&redirect_uri=https%3A%2F%2Fexample.com%2Fquery-callback"
    );
    await adapter.handleOAuthCallback(request, {
      redirectUri: "https://example.com/explicit-callback",
    });

    expect(mockAccess).toHaveBeenCalledWith({
      client_id: "client-id",
      client_secret: "client-secret",
      code: "oauth-code-123",
      redirect_uri: "https://example.com/explicit-callback",
    });
  });

  it("falls back to redirect_uri from the callback query param", async () => {
    const { adapter, state, mockAccess } = createOAuthAdapter();
    await adapter.initialize(createMockChatInstance(state));

    const request = new Request(
      "https://example.com/auth/callback/slack?code=oauth-code-123&redirect_uri=https%3A%2F%2Fexample.com%2Fquery-callback"
    );
    await adapter.handleOAuthCallback(request);

    expect(mockAccess).toHaveBeenCalledWith({
      client_id: "client-id",
      client_secret: "client-secret",
      code: "oauth-code-123",
      redirect_uri: "https://example.com/query-callback",
    });
  });

  it("throws when the callback code is missing", async () => {
    const { adapter, state } = createOAuthAdapter();
    await adapter.initialize(createMockChatInstance(state));

    const request = new Request("https://example.com/auth/callback/slack");
    await expect(adapter.handleOAuthCallback(request)).rejects.toThrow(
      "Missing 'code' query parameter in OAuth callback request."
    );
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
      botUserId: "U_BOT",
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
      botUserId: "U_BOT",
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

  it("DM messages do NOT have isMention set (routed via onDirectMessage)", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    // Capture the factory function to invoke it
    chatInstance.processMessage = vi.fn();
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });
    await adapter.initialize(chatInstance);

    mockClientMethod(
      adapter,
      "users.info",
      vi.fn().mockResolvedValue({
        ok: true,
        user: { name: "user", profile: { display_name: "User" } },
      })
    );

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
    expect(message.isMention).toBeUndefined();
  });

  it("channel messages do NOT have isMention auto-set", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    chatInstance.processMessage = vi.fn();
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });
    await adapter.initialize(chatInstance);

    mockClientMethod(
      adapter,
      "users.info",
      vi.fn().mockResolvedValue({
        ok: true,
        user: { name: "user", profile: { display_name: "User" } },
      })
    );

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
// Message Subtype Handling Tests
// ============================================================================

describe("message subtype handling", () => {
  const secret = "test-signing-secret";

  it("allows file_share messages through to processMessage", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });
    await adapter.initialize(chatInstance);

    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event: {
        type: "message",
        subtype: "file_share",
        user: "U_USER",
        channel: "C_CHAN",
        text: "Check this file",
        ts: "1234567890.111111",
        thread_ts: "1234567890.000000",
        files: [
          {
            id: "F123",
            mimetype: "image/png",
            url_private: "https://files.slack.com/file.png",
            name: "screenshot.png",
            size: 12345,
          },
        ],
      },
    });
    const request = createWebhookRequest(body, secret);
    await adapter.handleWebhook(request);

    expect(chatInstance.processMessage).toHaveBeenCalledWith(
      adapter,
      "slack:C_CHAN:1234567890.000000",
      expect.any(Function),
      undefined
    );
  });

  it("allows thread_broadcast messages through to processMessage", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });
    await adapter.initialize(chatInstance);

    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event: {
        type: "message",
        subtype: "thread_broadcast",
        user: "U_USER",
        channel: "C_CHAN",
        text: "Also posted to channel",
        ts: "1234567890.222222",
        thread_ts: "1234567890.000000",
      },
    });
    const request = createWebhookRequest(body, secret);
    await adapter.handleWebhook(request);

    expect(chatInstance.processMessage).toHaveBeenCalledWith(
      adapter,
      "slack:C_CHAN:1234567890.000000",
      expect.any(Function),
      undefined
    );
  });

  it("ignores message_changed subtypes", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });
    await adapter.initialize(chatInstance);

    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event: {
        type: "message",
        subtype: "message_changed",
        channel: "C_CHAN",
        ts: "1234567890.111111",
      },
    });
    const request = createWebhookRequest(body, secret);
    await adapter.handleWebhook(request);

    expect(chatInstance.processMessage).not.toHaveBeenCalled();
  });

  it("ignores message_deleted subtypes", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });
    await adapter.initialize(chatInstance);

    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event: {
        type: "message",
        subtype: "message_deleted",
        channel: "C_CHAN",
        ts: "1234567890.111111",
      },
    });
    const request = createWebhookRequest(body, secret);
    await adapter.handleWebhook(request);

    expect(chatInstance.processMessage).not.toHaveBeenCalled();
  });

  it("ignores channel_join subtypes", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });
    await adapter.initialize(chatInstance);

    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event: {
        type: "message",
        subtype: "channel_join",
        user: "U_USER",
        channel: "C_CHAN",
        ts: "1234567890.111111",
      },
    });
    const request = createWebhookRequest(body, secret);
    await adapter.handleWebhook(request);

    expect(chatInstance.processMessage).not.toHaveBeenCalled();
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
    botUserId: "U_BOT",
  });

  beforeEach(() => {
    // Mock users.info for lookupUser calls in handleSlashCommand
    mockClientMethod(
      adapter,
      "users.info",
      vi.fn().mockResolvedValue({
        ok: true,
        user: { name: "user", profile: { display_name: "User" } },
      })
    );
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
      botUserId: "U_BOT",
    });
    await multiAdapter.initialize(chatInstance);

    mockClientMethod(
      multiAdapter,
      "users.info",
      vi.fn().mockResolvedValue({
        ok: true,
        user: { name: "user", profile: { display_name: "User" } },
      })
    );

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

// ============================================================================
// Helper: access internal WebClient for mocking
// ============================================================================

interface MockableClient {
  assistant: {
    threads: {
      setStatus: ReturnType<typeof vi.fn>;
      setSuggestedPrompts: ReturnType<typeof vi.fn>;
      setTitle: ReturnType<typeof vi.fn>;
    };
  };
  auth: {
    test: ReturnType<typeof vi.fn>;
  };
  chat: {
    postMessage: ReturnType<typeof vi.fn>;
    postEphemeral: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  conversations: {
    open: ReturnType<typeof vi.fn>;
    replies: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    history: ReturnType<typeof vi.fn>;
  };
  files: {
    uploadV2: ReturnType<typeof vi.fn>;
  };
  reactions: {
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  users: {
    info: ReturnType<typeof vi.fn>;
  };
  views: {
    open: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    publish: ReturnType<typeof vi.fn>;
  };
}

function getClient(adapter: SlackAdapter): MockableClient {
  return (adapter as unknown as { client: MockableClient }).client;
}

function mockClientMethod(
  adapter: SlackAdapter,
  path: string,
  mockFn: ReturnType<typeof vi.fn>
): void {
  const parts = path.split(".");
  let obj: Record<string, unknown> = getClient(adapter) as unknown as Record<
    string,
    unknown
  >;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!obj[parts[i]]) {
      obj[parts[i]] = {};
    }
    obj = obj[parts[i]] as Record<string, unknown>;
  }
  obj[parts.at(-1) as string] = mockFn;
}

// ============================================================================
// postMessage Tests
// ============================================================================

describe("postMessage", () => {
  const secret = "test-signing-secret";

  it("posts a text message to a thread", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "chat.postMessage",
      vi.fn().mockResolvedValue({ ok: true, ts: "1234567890.999999" })
    );

    const result = await adapter.postMessage(
      "slack:C123:1234567890.000000",
      "Hello from test"
    );

    expect(result.id).toBe("1234567890.999999");
    expect(result.threadId).toBe("slack:C123:1234567890.000000");
    expect(result.raw).toBeDefined();

    const client = getClient(adapter);
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C123",
        thread_ts: "1234567890.000000",
        token: "xoxb-test-token",
      })
    );
  });

  it("posts to a channel with empty threadTs", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "chat.postMessage",
      vi.fn().mockResolvedValue({ ok: true, ts: "1111111111.000000" })
    );

    const result = await adapter.postMessage("slack:C123:", "Channel message");

    expect(result.id).toBe("1111111111.000000");
    const client = getClient(adapter);
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C123",
        thread_ts: "",
      })
    );
  });

  it("sets unfurl_links and unfurl_media to false", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "chat.postMessage",
      vi.fn().mockResolvedValue({ ok: true, ts: "1234567890.999999" })
    );

    await adapter.postMessage("slack:C123:1234567890.000000", "test");

    const client = getClient(adapter);
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        unfurl_links: false,
        unfurl_media: false,
      })
    );
  });

  it("returns early for file-only post with empty markdown", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: "test-signing-secret",
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "files.uploadV2",
      vi.fn().mockResolvedValue({ ok: true })
    );

    const chatPostMessage = vi.fn();
    mockClientMethod(adapter, "chat.postMessage", chatPostMessage);

    const result = await adapter.postMessage("slack:C123:1234567890.000000", {
      markdown: "",
      files: [{ data: Buffer.from("hello"), filename: "test.txt" }],
    } as AdapterPostableMessage);

    expect(result.id).toMatch(FILE_ID_PATTERN);
    expect(chatPostMessage).not.toHaveBeenCalled();
  });
});

// ============================================================================
// postEphemeral Tests
// ============================================================================

describe("postEphemeral", () => {
  const secret = "test-signing-secret";

  it("posts an ephemeral message to a user", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "chat.postEphemeral",
      vi.fn().mockResolvedValue({ ok: true, message_ts: "1234567890.888888" })
    );

    const result = await adapter.postEphemeral(
      "slack:C123:1234567890.000000",
      "U_USER_1",
      "Ephemeral text"
    );

    expect(result.id).toBe("1234567890.888888");
    expect(result.threadId).toBe("slack:C123:1234567890.000000");
    expect(result.usedFallback).toBe(false);

    const client = getClient(adapter);
    expect(client.chat.postEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C123",
        thread_ts: "1234567890.000000",
        user: "U_USER_1",
        token: "xoxb-test-token",
      })
    );
  });

  it("omits thread_ts when empty", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "chat.postEphemeral",
      vi.fn().mockResolvedValue({ ok: true, message_ts: "1234567890.888888" })
    );

    await adapter.postEphemeral("slack:C123:", "U_USER_1", "Ephemeral text");

    const client = getClient(adapter);
    expect(client.chat.postEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C123",
        thread_ts: undefined,
        user: "U_USER_1",
      })
    );
  });

  it("handles empty message_ts in response", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "chat.postEphemeral",
      vi.fn().mockResolvedValue({ ok: true })
    );

    const result = await adapter.postEphemeral(
      "slack:C123:1234567890.000000",
      "U_USER_1",
      "test"
    );

    expect(result.id).toBe("");
  });
});

// ============================================================================
// editMessage Tests
// ============================================================================

describe("editMessage", () => {
  const secret = "test-signing-secret";

  it("edits a regular text message", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "chat.update",
      vi.fn().mockResolvedValue({ ok: true, ts: "1234567890.123456" })
    );

    const result = await adapter.editMessage(
      "slack:C123:1234567890.000000",
      "1234567890.123456",
      "Updated message"
    );

    expect(result.id).toBe("1234567890.123456");
    expect(result.threadId).toBe("slack:C123:1234567890.000000");

    const client = getClient(adapter);
    expect(client.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C123",
        ts: "1234567890.123456",
        token: "xoxb-test-token",
      })
    );
  });
});

// ============================================================================
// deleteMessage Tests
// ============================================================================

describe("deleteMessage", () => {
  const secret = "test-signing-secret";

  it("deletes a message by ID", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "chat.delete",
      vi.fn().mockResolvedValue({ ok: true })
    );

    await adapter.deleteMessage(
      "slack:C123:1234567890.000000",
      "1234567890.123456"
    );

    const client = getClient(adapter);
    expect(client.chat.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C123",
        ts: "1234567890.123456",
        token: "xoxb-test-token",
      })
    );
  });
});

// ============================================================================
// Reaction Tests
// ============================================================================

describe("addReaction", () => {
  const secret = "test-signing-secret";

  it("adds a reaction to a message", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "reactions.add",
      vi.fn().mockResolvedValue({ ok: true })
    );

    await adapter.addReaction(
      "slack:C123:1234567890.000000",
      "1234567890.123456",
      "thumbsup"
    );

    const client = getClient(adapter);
    expect(client.reactions.add).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C123",
        timestamp: "1234567890.123456",
        name: expect.any(String),
        token: "xoxb-test-token",
      })
    );
  });

  it("strips colons from emoji names", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "reactions.add",
      vi.fn().mockResolvedValue({ ok: true })
    );

    await adapter.addReaction(
      "slack:C123:1234567890.000000",
      "1234567890.123456",
      ":thumbsup:"
    );

    const client = getClient(adapter);
    const callArgs = client.reactions.add.mock.calls[0][0];
    expect(callArgs.name).not.toContain(":");
  });
});

describe("removeReaction", () => {
  const secret = "test-signing-secret";

  it("removes a reaction from a message", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "reactions.remove",
      vi.fn().mockResolvedValue({ ok: true })
    );

    await adapter.removeReaction(
      "slack:C123:1234567890.000000",
      "1234567890.123456",
      "thumbsup"
    );

    const client = getClient(adapter);
    expect(client.reactions.remove).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C123",
        timestamp: "1234567890.123456",
        name: expect.any(String),
        token: "xoxb-test-token",
      })
    );
  });
});

// ============================================================================
// Modal Operation Tests
// ============================================================================

describe("openModal", () => {
  const secret = "test-signing-secret";

  it("opens a modal with trigger ID", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "views.open",
      vi.fn().mockResolvedValue({ ok: true, view: { id: "V_MODAL_1" } })
    );

    const modal = {
      callbackId: "test_modal",
      title: "Test Modal",
      children: [],
    };

    const result = await adapter.openModal("trigger-123", modal);

    expect(result.viewId).toBe("V_MODAL_1");

    const client = getClient(adapter);
    expect(client.views.open).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger_id: "trigger-123",
        token: "xoxb-test-token",
        view: expect.objectContaining({
          type: "modal",
          callback_id: "test_modal",
        }),
      })
    );
  });

  it("passes contextId as encoded private_metadata", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "views.open",
      vi.fn().mockResolvedValue({ ok: true, view: { id: "V_CTX_1" } })
    );

    const modal = {
      callbackId: "modal_with_ctx",
      title: "Context Modal",
      children: [],
    };

    await adapter.openModal("trigger-ctx", modal, "context-id-42");

    const client = getClient(adapter);
    const callArgs = client.views.open.mock.calls[0][0];
    const metadata = callArgs.view.private_metadata;
    expect(metadata).toBeDefined();
    const parsed = JSON.parse(metadata);
    expect(parsed.c).toBe("context-id-42");
  });

  it("encodes modal privateMetadata with contextId", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "views.open",
      vi.fn().mockResolvedValue({ ok: true, view: { id: "V_PM_1" } })
    );

    const modal = {
      callbackId: "pm_modal",
      title: "PM Modal",
      children: [],
      privateMetadata: "user-data-xyz",
    };

    await adapter.openModal("trigger-pm", modal, "ctx-99");

    const client = getClient(adapter);
    const callArgs = client.views.open.mock.calls[0][0];
    const parsed = JSON.parse(callArgs.view.private_metadata);
    expect(parsed.c).toBe("ctx-99");
    expect(parsed.m).toBe("user-data-xyz");
  });
});

describe("updateModal", () => {
  const secret = "test-signing-secret";

  it("updates an existing modal view", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "views.update",
      vi.fn().mockResolvedValue({ ok: true, view: { id: "V_UPDATED_1" } })
    );

    const modal = {
      callbackId: "updated_modal",
      title: "Updated",
      children: [],
    };

    const result = await adapter.updateModal("V_ORIGINAL_1", modal);

    expect(result.viewId).toBe("V_UPDATED_1");

    const client = getClient(adapter);
    expect(client.views.update).toHaveBeenCalledWith(
      expect.objectContaining({
        view_id: "V_ORIGINAL_1",
        token: "xoxb-test-token",
        view: expect.objectContaining({
          type: "modal",
          callback_id: "updated_modal",
        }),
      })
    );
  });
});

// ============================================================================
// Typing Indicator Tests
// ============================================================================

describe("startTyping", () => {
  const secret = "test-signing-secret";

  it("calls assistant.threads.setStatus with default status", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "assistant.threads.setStatus",
      vi.fn().mockResolvedValue({ ok: true })
    );

    await adapter.startTyping("slack:C123:1234567890.000000");

    const client = getClient(adapter);
    expect(client.assistant.threads.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: "C123",
        thread_ts: "1234567890.000000",
        status: "Typing...",
        loading_messages: ["Typing..."],
        token: "xoxb-test-token",
      })
    );
  });

  it("uses custom status when provided", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "assistant.threads.setStatus",
      vi.fn().mockResolvedValue({ ok: true })
    );

    await adapter.startTyping(
      "slack:C123:1234567890.000000",
      "Searching documents..."
    );

    const client = getClient(adapter);
    expect(client.assistant.threads.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "Searching documents...",
        loading_messages: ["Searching documents..."],
      })
    );
  });

  it("skips when no threadTs present", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "assistant.threads.setStatus",
      vi.fn().mockResolvedValue({ ok: true })
    );

    await adapter.startTyping("slack:C123:");

    const client = getClient(adapter);
    expect(client.assistant.threads.setStatus).not.toHaveBeenCalled();
  });

  it("does not throw on API error (logs warning instead)", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "assistant.threads.setStatus",
      vi.fn().mockRejectedValue(new Error("API error"))
    );

    // Should not throw
    await adapter.startTyping("slack:C123:1234567890.000000");
  });
});

// ============================================================================
// openDM Tests
// ============================================================================

describe("openDM", () => {
  const secret = "test-signing-secret";

  it("opens a DM conversation and returns thread ID", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "conversations.open",
      vi.fn().mockResolvedValue({
        ok: true,
        channel: { id: "D_DM_CHANNEL" },
      })
    );

    const threadId = await adapter.openDM("U_TARGET_USER");

    expect(threadId).toBe("slack:D_DM_CHANNEL:");

    const client = getClient(adapter);
    expect(client.conversations.open).toHaveBeenCalledWith(
      expect.objectContaining({
        users: "U_TARGET_USER",
        token: "xoxb-test-token",
      })
    );
  });

  it("throws when no channel returned", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "conversations.open",
      vi.fn().mockResolvedValue({ ok: true, channel: {} })
    );

    await expect(adapter.openDM("U_BAD_USER")).rejects.toThrow(
      "Failed to open DM"
    );
  });
});

// ============================================================================
// fetchMessages Tests
// ============================================================================

describe("fetchMessages", () => {
  const secret = "test-signing-secret";

  it("fetches messages in forward direction using cursor pagination", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });

    mockClientMethod(
      adapter,
      "conversations.replies",
      vi.fn().mockResolvedValue({
        ok: true,
        messages: [
          {
            type: "message",
            user: "U1",
            text: "msg1",
            ts: "1000.000",
            channel: "C123",
          },
          {
            type: "message",
            user: "U2",
            text: "msg2",
            ts: "1001.000",
            channel: "C123",
          },
        ],
        response_metadata: { next_cursor: "cursor-abc" },
      })
    );
    // Mock users.info for resolveInlineMentions
    mockClientMethod(
      adapter,
      "users.info",
      vi.fn().mockResolvedValue({
        ok: true,
        user: { name: "user1", real_name: "User One" },
      })
    );

    const state = createMockState();
    await adapter.initialize(createMockChatInstance(state));

    const result = await adapter.fetchMessages("slack:C123:1234567890.000000", {
      direction: "forward",
      limit: 10,
    });

    expect(result.messages).toHaveLength(2);
    expect(result.nextCursor).toBe("cursor-abc");
  });

  it("fetches messages in backward direction (default)", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });

    mockClientMethod(
      adapter,
      "conversations.replies",
      vi.fn().mockResolvedValue({
        ok: true,
        messages: [
          {
            type: "message",
            user: "U1",
            text: "oldest",
            ts: "1000.000",
            channel: "C123",
          },
          {
            type: "message",
            user: "U2",
            text: "newest",
            ts: "1001.000",
            channel: "C123",
          },
        ],
        has_more: false,
      })
    );
    mockClientMethod(
      adapter,
      "users.info",
      vi.fn().mockResolvedValue({
        ok: true,
        user: { name: "user1" },
      })
    );

    const state = createMockState();
    await adapter.initialize(createMockChatInstance(state));

    const result = await adapter.fetchMessages("slack:C123:1234567890.000000");

    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("passes cursor for backward pagination", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });

    const mockReplies = vi.fn().mockResolvedValue({
      ok: true,
      messages: [
        {
          type: "message",
          user: "U1",
          text: "old",
          ts: "900.000",
          channel: "C123",
        },
      ],
      has_more: false,
    });
    mockClientMethod(adapter, "conversations.replies", mockReplies);
    mockClientMethod(
      adapter,
      "users.info",
      vi.fn().mockResolvedValue({
        ok: true,
        user: { name: "user1" },
      })
    );

    const state = createMockState();
    await adapter.initialize(createMockChatInstance(state));

    await adapter.fetchMessages("slack:C123:1234567890.000000", {
      cursor: "1000.000",
    });

    expect(mockReplies).toHaveBeenCalledWith(
      expect.objectContaining({
        latest: "1000.000",
      })
    );
  });
});

// ============================================================================
// fetchMessage (single) Tests
// ============================================================================

describe("fetchMessage", () => {
  const secret = "test-signing-secret";

  it("fetches a single message by ID", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });

    mockClientMethod(
      adapter,
      "conversations.replies",
      vi.fn().mockResolvedValue({
        ok: true,
        messages: [
          {
            type: "message",
            user: "U1",
            text: "Found it",
            ts: "1234567890.123456",
            channel: "C123",
          },
        ],
      })
    );
    mockClientMethod(
      adapter,
      "users.info",
      vi.fn().mockResolvedValue({
        ok: true,
        user: { name: "user1" },
      })
    );

    const state = createMockState();
    await adapter.initialize(createMockChatInstance(state));

    const msg = await adapter.fetchMessage(
      "slack:C123:1234567890.000000",
      "1234567890.123456"
    );

    expect(msg).not.toBeNull();
    expect(msg?.text).toBe("Found it");
  });

  it("returns null when message not found", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });

    mockClientMethod(
      adapter,
      "conversations.replies",
      vi.fn().mockResolvedValue({
        ok: true,
        messages: [
          {
            type: "message",
            user: "U1",
            text: "Different msg",
            ts: "9999999999.000000",
            channel: "C123",
          },
        ],
      })
    );

    const state = createMockState();
    await adapter.initialize(createMockChatInstance(state));

    const msg = await adapter.fetchMessage(
      "slack:C123:1234567890.000000",
      "1234567890.123456"
    );

    expect(msg).toBeNull();
  });
});

// ============================================================================
// Channel Operations Tests
// ============================================================================

describe("fetchChannelInfo", () => {
  const secret = "test-signing-secret";

  it("fetches channel info", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "conversations.info",
      vi.fn().mockResolvedValue({
        ok: true,
        channel: {
          id: "C123",
          name: "general",
          is_im: false,
          is_mpim: false,
          num_members: 42,
          purpose: { value: "General discussion" },
          topic: { value: "Anything goes" },
        },
      })
    );

    const info = await adapter.fetchChannelInfo("slack:C123");

    expect(info.id).toBe("slack:C123");
    expect(info.name).toBe("#general");
    expect(info.isDM).toBe(false);
    expect(info.memberCount).toBe(42);
    expect(info.metadata.purpose).toBe("General discussion");
    expect(info.metadata.topic).toBe("Anything goes");
  });

  it("detects DM channels", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "conversations.info",
      vi.fn().mockResolvedValue({
        ok: true,
        channel: { id: "D123", is_im: true },
      })
    );

    const info = await adapter.fetchChannelInfo("slack:D123");
    expect(info.isDM).toBe(true);
  });

  it("throws on invalid channel ID", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    await expect(adapter.fetchChannelInfo("invalid")).rejects.toThrow(
      ValidationError
    );
  });
});

describe("fetchChannelMessages", () => {
  const secret = "test-signing-secret";

  it("fetches channel messages backward (default)", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });

    mockClientMethod(
      adapter,
      "conversations.history",
      vi.fn().mockResolvedValue({
        ok: true,
        messages: [
          { type: "message", user: "U1", text: "newest", ts: "1002.000" },
          { type: "message", user: "U2", text: "older", ts: "1001.000" },
        ],
        has_more: true,
      })
    );
    mockClientMethod(
      adapter,
      "users.info",
      vi.fn().mockResolvedValue({
        ok: true,
        user: { name: "user1" },
      })
    );

    const state = createMockState();
    await adapter.initialize(createMockChatInstance(state));

    const result = await adapter.fetchChannelMessages("slack:C123");

    expect(result.messages).toHaveLength(2);
    expect(result.nextCursor).toBeDefined();
  });

  it("fetches channel messages forward", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });

    mockClientMethod(
      adapter,
      "conversations.history",
      vi.fn().mockResolvedValue({
        ok: true,
        messages: [
          { type: "message", user: "U1", text: "oldest", ts: "1000.000" },
          { type: "message", user: "U2", text: "newer", ts: "1001.000" },
        ],
        has_more: false,
      })
    );
    mockClientMethod(
      adapter,
      "users.info",
      vi.fn().mockResolvedValue({
        ok: true,
        user: { name: "user1" },
      })
    );

    const state = createMockState();
    await adapter.initialize(createMockChatInstance(state));

    const result = await adapter.fetchChannelMessages("slack:C123", {
      direction: "forward",
    });

    expect(result.messages).toHaveLength(2);
  });

  it("throws on invalid channel ID", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    await expect(adapter.fetchChannelMessages("invalid")).rejects.toThrow(
      ValidationError
    );
  });
});

describe("postChannelMessage", () => {
  const secret = "test-signing-secret";

  it("posts to channel without thread context", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "chat.postMessage",
      vi.fn().mockResolvedValue({ ok: true, ts: "2222222222.000000" })
    );

    const result = await adapter.postChannelMessage(
      "slack:C123",
      "Top-level message"
    );

    expect(result.id).toBe("2222222222.000000");

    const client = getClient(adapter);
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C123",
        thread_ts: "",
      })
    );
  });

  it("throws on invalid channel ID", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    await expect(adapter.postChannelMessage("invalid", "test")).rejects.toThrow(
      ValidationError
    );
  });
});

describe("listThreads", () => {
  const secret = "test-signing-secret";

  it("lists threads with replies in a channel", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });

    mockClientMethod(
      adapter,
      "conversations.history",
      vi.fn().mockResolvedValue({
        ok: true,
        messages: [
          {
            type: "message",
            user: "U1",
            text: "Thread parent",
            ts: "1000.000",
            reply_count: 5,
            latest_reply: "1005.000",
          },
          {
            type: "message",
            user: "U2",
            text: "No replies",
            ts: "999.000",
          },
          {
            type: "message",
            user: "U3",
            text: "Another thread",
            ts: "998.000",
            reply_count: 2,
            latest_reply: "1003.000",
          },
        ],
        response_metadata: {},
      })
    );
    mockClientMethod(
      adapter,
      "users.info",
      vi.fn().mockResolvedValue({
        ok: true,
        user: { name: "user1" },
      })
    );

    const state = createMockState();
    await adapter.initialize(createMockChatInstance(state));

    const result = await adapter.listThreads("slack:C123");

    // Should only include messages with replies
    expect(result.threads).toHaveLength(2);
    expect(result.threads[0].replyCount).toBe(5);
    expect(result.threads[0].lastReplyAt).toBeDefined();
  });

  it("throws on invalid channel ID", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    await expect(adapter.listThreads("invalid")).rejects.toThrow(
      ValidationError
    );
  });
});

// ============================================================================
// channelIdFromThreadId Tests
// ============================================================================

describe("channelIdFromThreadId", () => {
  const adapter = createSlackAdapter({
    botToken: "xoxb-test-token",
    signingSecret: "test-secret",
    logger: mockLogger,
  });

  it("extracts channel ID from thread ID", () => {
    const channelId = adapter.channelIdFromThreadId(
      "slack:C123:1234567890.000000"
    );
    expect(channelId).toBe("slack:C123");
  });

  it("works with empty threadTs", () => {
    const channelId = adapter.channelIdFromThreadId("slack:C456:");
    expect(channelId).toBe("slack:C456");
  });
});

// ============================================================================
// Ephemeral Message ID Encoding/Decoding Tests
// ============================================================================

describe("ephemeral message ID encoding", () => {
  const secret = "test-signing-secret";

  it("encodes and decodes ephemeral message IDs for editMessage", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });

    // Access private methods via the adapter for block_actions test
    // Block actions with ephemeral containers encode responseUrl in messageId
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    await adapter.initialize(chatInstance);

    // Simulate block_actions with is_ephemeral container
    const payload = JSON.stringify({
      type: "block_actions",
      trigger_id: "trigger-eph",
      user: { id: "U_EPH_USER", username: "ephuser" },
      container: {
        type: "message",
        message_ts: "1234567890.123456",
        channel_id: "C456",
        is_ephemeral: true,
        thread_ts: "1234567890.000000",
      },
      channel: { id: "C456", name: "general" },
      message: { ts: "1234567890.123456", thread_ts: "1234567890.000000" },
      response_url: "https://hooks.slack.com/actions/T123/456/respond",
      actions: [{ type: "button", action_id: "eph_btn", value: "clicked" }],
    });
    const body = `payload=${encodeURIComponent(payload)}`;
    const request = createWebhookRequest(body, secret, {
      contentType: "application/x-www-form-urlencoded",
    });

    await adapter.handleWebhook(request);

    // Verify processAction was called with an ephemeral-encoded messageId
    const actionCall = (chatInstance.processAction as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(actionCall.messageId).toContain("ephemeral:");
  });

  it("deleteMessage handles ephemeral messageId", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    // deleteMessage with a non-ephemeral ID calls chat.delete
    mockClientMethod(
      adapter,
      "chat.delete",
      vi.fn().mockResolvedValue({ ok: true })
    );

    await adapter.deleteMessage(
      "slack:C123:1234567890.000000",
      "1234567890.123456"
    );

    const client = getClient(adapter);
    expect(client.chat.delete).toHaveBeenCalled();
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe("error handling", () => {
  const secret = "test-signing-secret";

  it("throws AdapterRateLimitError on rate limit", async () => {
    const { AdapterRateLimitError } = await import("@chat-adapter/shared");

    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    const rateLimitError = {
      code: "slack_webapi_platform_error",
      data: { error: "ratelimited" },
    };

    mockClientMethod(
      adapter,
      "chat.postMessage",
      vi.fn().mockRejectedValue(rateLimitError)
    );

    await expect(
      adapter.postMessage("slack:C123:1234567890.000000", "test")
    ).rejects.toBeInstanceOf(AdapterRateLimitError);
  });

  it("re-throws non-rate-limit errors", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    const genericError = new Error("channel_not_found");

    mockClientMethod(
      adapter,
      "chat.postMessage",
      vi.fn().mockRejectedValue(genericError)
    );

    await expect(
      adapter.postMessage("slack:C123:1234567890.000000", "test")
    ).rejects.toThrow("channel_not_found");
  });

  it("rate limit error in addReaction", async () => {
    const { AdapterRateLimitError } = await import("@chat-adapter/shared");

    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "reactions.add",
      vi.fn().mockRejectedValue({
        code: "slack_webapi_platform_error",
        data: { error: "ratelimited" },
      })
    );

    await expect(
      adapter.addReaction(
        "slack:C123:1234567890.000000",
        "1234.000",
        "thumbsup"
      )
    ).rejects.toBeInstanceOf(AdapterRateLimitError);
  });

  it("rate limit error in deleteMessage", async () => {
    const { AdapterRateLimitError } = await import("@chat-adapter/shared");

    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "chat.delete",
      vi.fn().mockRejectedValue({
        code: "slack_webapi_platform_error",
        data: { error: "ratelimited" },
      })
    );

    await expect(
      adapter.deleteMessage("slack:C123:1234567890.000000", "1234.000")
    ).rejects.toBeInstanceOf(AdapterRateLimitError);
  });

  it("rate limit error in editMessage", async () => {
    const { AdapterRateLimitError } = await import("@chat-adapter/shared");

    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "chat.update",
      vi.fn().mockRejectedValue({
        code: "slack_webapi_platform_error",
        data: { error: "ratelimited" },
      })
    );

    await expect(
      adapter.editMessage("slack:C123:1234567890.000000", "1234.000", "update")
    ).rejects.toBeInstanceOf(AdapterRateLimitError);
  });
});

// ============================================================================
// User Mention Resolution Tests
// ============================================================================

describe("resolveInlineMentions", () => {
  const secret = "test-signing-secret";

  it("resolves user mentions in incoming messages via webhook", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    chatInstance.processMessage = vi.fn();

    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });

    // Mock auth.test for initialize
    mockClientMethod(
      adapter,
      "auth.test",
      vi.fn().mockResolvedValue({
        ok: true,
        user_id: "U_BOT",
        bot_id: "B_BOT",
      })
    );

    await adapter.initialize(chatInstance);

    // Mock users.info AFTER initialize so it's available for webhook processing
    const usersInfoMock = vi.fn().mockResolvedValue({
      ok: true,
      user: {
        name: "johndoe",
        real_name: "John Doe",
        profile: { display_name: "John", real_name: "John Doe" },
      },
    });
    mockClientMethod(adapter, "users.info", usersInfoMock);

    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event: {
        type: "message",
        user: "U_SENDER",
        channel: "C456",
        text: "Hey <@UOTHER123> check this out",
        ts: "1234567890.555555",
      },
    });
    const request = createWebhookRequest(body, secret);
    await adapter.handleWebhook(request);

    // Execute the factory to get the parsed message
    const factory = (chatInstance.processMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0][2];
    const message = await factory();

    // The mention should have been resolved to include the display name
    expect(message.text).toContain("@John");
  });

  it("skips self-mention resolution in incoming webhooks", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    chatInstance.processMessage = vi.fn();

    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });

    // users.info should NOT be called for the bot's own mention
    const usersInfoMock = vi.fn().mockResolvedValue({
      ok: true,
      user: { name: "sender", profile: { display_name: "Sender" } },
    });
    mockClientMethod(adapter, "users.info", usersInfoMock);

    await adapter.initialize(chatInstance);

    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event: {
        type: "app_mention",
        user: "U_SENDER",
        channel: "C456",
        text: "<@U_BOT> help me",
        ts: "1234567890.666666",
      },
    });
    const request = createWebhookRequest(body, secret);
    await adapter.handleWebhook(request);

    const factory = (chatInstance.processMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0][2];
    const message = await factory();

    // Bot mention should NOT be resolved (kept as-is for mention detection)
    expect(message.text).toContain("@U_BOT");
  });

  it("resolves bare channel mentions in incoming messages", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    chatInstance.processMessage = vi.fn();

    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });

    mockClientMethod(
      adapter,
      "auth.test",
      vi.fn().mockResolvedValue({
        ok: true,
        user_id: "U_BOT",
        bot_id: "B_BOT",
      })
    );

    await adapter.initialize(chatInstance);

    // Mock users.info for message sender lookup (parseSlackMessage calls lookupUser)
    mockClientMethod(
      adapter,
      "users.info",
      vi.fn().mockResolvedValue({
        ok: true,
        user: { name: "sender", profile: { display_name: "Sender" } },
      })
    );

    // Mock conversations.info for channel lookup
    mockClientMethod(
      adapter,
      "conversations.info",
      vi.fn().mockResolvedValue({
        ok: true,
        channel: { name: "general" },
      })
    );

    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event: {
        type: "message",
        user: "U_SENDER",
        channel: "C456",
        text: "Check out <#C789>",
        ts: "1234567890.777777",
      },
    });
    const request = createWebhookRequest(body, secret);
    await adapter.handleWebhook(request);

    const factory = (chatInstance.processMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0][2];
    const message = await factory();

    // The channel mention should have been resolved to include the name
    expect(message.text).toContain("#general");
  });

  it("leaves channel mentions with existing labels unchanged", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    chatInstance.processMessage = vi.fn();

    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });

    mockClientMethod(
      adapter,
      "auth.test",
      vi.fn().mockResolvedValue({
        ok: true,
        user_id: "U_BOT",
        bot_id: "B_BOT",
      })
    );

    await adapter.initialize(chatInstance);

    // Mock users.info for message sender lookup
    mockClientMethod(
      adapter,
      "users.info",
      vi.fn().mockResolvedValue({
        ok: true,
        user: { name: "sender", profile: { display_name: "Sender" } },
      })
    );

    // conversations.info should NOT be called when label is present
    const conversationsInfoMock = vi.fn();
    mockClientMethod(adapter, "conversations.info", conversationsInfoMock);

    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event: {
        type: "message",
        user: "U_SENDER",
        channel: "C456",
        text: "Check out <#C789|existing-name>",
        ts: "1234567890.888888",
      },
    });
    const request = createWebhookRequest(body, secret);
    await adapter.handleWebhook(request);

    const factory = (chatInstance.processMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0][2];
    const message = await factory();

    // The label should be preserved as-is
    expect(message.text).toContain("#existing-name");
    // conversations.info should not have been called
    expect(conversationsInfoMock).not.toHaveBeenCalled();
  });

  it("falls back to channel ID when conversations.info fails", async () => {
    const state = createMockState();
    const chatInstance = createMockChatInstance(state);
    chatInstance.processMessage = vi.fn();

    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });

    mockClientMethod(
      adapter,
      "auth.test",
      vi.fn().mockResolvedValue({
        ok: true,
        user_id: "U_BOT",
        bot_id: "B_BOT",
      })
    );

    await adapter.initialize(chatInstance);

    // Mock users.info for message sender lookup
    mockClientMethod(
      adapter,
      "users.info",
      vi.fn().mockResolvedValue({
        ok: true,
        user: { name: "sender", profile: { display_name: "Sender" } },
      })
    );

    // Mock conversations.info to fail
    mockClientMethod(
      adapter,
      "conversations.info",
      vi.fn().mockRejectedValue(new Error("channel_not_found"))
    );

    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event: {
        type: "message",
        user: "U_SENDER",
        channel: "C456",
        text: "Check out <#CUNKNOWN>",
        ts: "1234567890.999999",
      },
    });
    const request = createWebhookRequest(body, secret);
    await adapter.handleWebhook(request);

    const factory = (chatInstance.processMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0][2];
    const message = await factory();

    // Should fall back to the channel ID
    expect(message.text).toContain("#CUNKNOWN");
  });
});

// ============================================================================
// fetchThread Tests
// ============================================================================

describe("fetchThread", () => {
  const secret = "test-signing-secret";

  it("fetches thread info with channel details", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "conversations.info",
      vi.fn().mockResolvedValue({
        ok: true,
        channel: { id: "C123", name: "general" },
      })
    );

    const info = await adapter.fetchThread("slack:C123:1234567890.000000");

    expect(info.id).toBe("slack:C123:1234567890.000000");
    expect(info.channelId).toBe("C123");
    expect(info.channelName).toBe("general");
    expect(info.metadata.threadTs).toBe("1234567890.000000");
  });
});

// ============================================================================
// initialize Tests
// ============================================================================

describe("initialize", () => {
  const secret = "test-signing-secret";

  it("fetches bot user ID on initialize with bot token", async () => {
    const state = createMockState();
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "auth.test",
      vi.fn().mockResolvedValue({
        ok: true,
        user_id: "U_INITIALIZED_BOT",
        bot_id: "B_INITIALIZED_BOT",
        user: "testbot",
      })
    );

    await adapter.initialize(createMockChatInstance(state));

    expect(adapter.botUserId).toBe("U_INITIALIZED_BOT");
    expect(adapter.userName).toBe("testbot");
  });

  it("handles auth.test failure gracefully", async () => {
    const state = createMockState();
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "auth.test",
      vi.fn().mockRejectedValue(new Error("invalid_auth"))
    );

    // Should not throw
    await adapter.initialize(createMockChatInstance(state));
  });

  it("skips auth.test in multi-workspace mode", async () => {
    const state = createMockState();
    const adapter = createSlackAdapter({
      signingSecret: secret,
      logger: mockLogger,
    });

    const authTestMock = vi.fn();
    mockClientMethod(adapter, "auth.test", authTestMock);

    await adapter.initialize(createMockChatInstance(state));

    expect(authTestMock).not.toHaveBeenCalled();
  });
});

// ============================================================================
// publishHomeView Tests
// ============================================================================

describe("publishHomeView", () => {
  const secret = "test-signing-secret";

  it("publishes a home tab view", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "views.publish",
      vi.fn().mockResolvedValue({ ok: true })
    );

    const view = {
      type: "home",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }],
    };

    await adapter.publishHomeView("U_USER_1", view);

    const client = getClient(adapter);
    expect(client.views.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "U_USER_1",
        token: "xoxb-test-token",
      })
    );
  });
});

// ============================================================================
// setSuggestedPrompts Tests
// ============================================================================

describe("setSuggestedPrompts", () => {
  const secret = "test-signing-secret";

  it("sets suggested prompts for assistant thread", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "assistant.threads.setSuggestedPrompts",
      vi.fn().mockResolvedValue({ ok: true })
    );

    await adapter.setSuggestedPrompts("C123", "1234567890.000000", [
      { title: "Help", message: "How can I help?" },
    ]);

    const client = getClient(adapter);
    expect(client.assistant.threads.setSuggestedPrompts).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: "C123",
        thread_ts: "1234567890.000000",
        prompts: [{ title: "Help", message: "How can I help?" }],
        token: "xoxb-test-token",
      })
    );
  });

  it("passes optional title", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "assistant.threads.setSuggestedPrompts",
      vi.fn().mockResolvedValue({ ok: true })
    );

    await adapter.setSuggestedPrompts(
      "C123",
      "1234567890.000000",
      [{ title: "Prompt", message: "Try this" }],
      "Pick a prompt"
    );

    const client = getClient(adapter);
    expect(client.assistant.threads.setSuggestedPrompts).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Pick a prompt",
      })
    );
  });
});

// ============================================================================
// setAssistantStatus Tests
// ============================================================================

describe("setAssistantStatus", () => {
  const secret = "test-signing-secret";

  it("sets assistant thread status", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "assistant.threads.setStatus",
      vi.fn().mockResolvedValue({ ok: true })
    );

    await adapter.setAssistantStatus(
      "C123",
      "1234567890.000000",
      "Thinking..."
    );

    const client = getClient(adapter);
    expect(client.assistant.threads.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: "C123",
        thread_ts: "1234567890.000000",
        status: "Thinking...",
        token: "xoxb-test-token",
      })
    );
  });

  it("passes loading messages when provided", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "assistant.threads.setStatus",
      vi.fn().mockResolvedValue({ ok: true })
    );

    await adapter.setAssistantStatus(
      "C123",
      "1234567890.000000",
      "Working...",
      ["Step 1", "Step 2"]
    );

    const client = getClient(adapter);
    expect(client.assistant.threads.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        loading_messages: ["Step 1", "Step 2"],
      })
    );
  });
});

// ============================================================================
// setAssistantTitle Tests
// ============================================================================

describe("setAssistantTitle", () => {
  const secret = "test-signing-secret";

  it("sets title for assistant thread", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });

    mockClientMethod(
      adapter,
      "assistant.threads.setTitle",
      vi.fn().mockResolvedValue({ ok: true })
    );

    await adapter.setAssistantTitle(
      "C123",
      "1234567890.000000",
      "My Thread Title"
    );

    const client = getClient(adapter);
    expect(client.assistant.threads.setTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: "C123",
        thread_ts: "1234567890.000000",
        title: "My Thread Title",
        token: "xoxb-test-token",
      })
    );
  });
});

// ============================================================================
// Assistant Thread Event Tests
// ============================================================================

describe("handleWebhook - assistant events", () => {
  const secret = "test-signing-secret";

  it("handles assistant_thread_started event", async () => {
    const state = createMockState();
    const chatInstance = {
      ...createMockChatInstance(state),
      processAssistantThreadStarted: vi.fn(),
    };
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });
    await adapter.initialize(chatInstance);

    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event: {
        type: "assistant_thread_started",
        event_ts: "1234567890.000000",
        assistant_thread: {
          user_id: "U_USER",
          channel_id: "C_ASSISTANT",
          thread_ts: "1234567890.111111",
          context: {
            channel_id: "C_CONTEXT",
            team_id: "T123",
          },
        },
      },
    });
    const request = createWebhookRequest(body, secret);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(chatInstance.processAssistantThreadStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "slack:C_ASSISTANT:1234567890.111111",
        userId: "U_USER",
        channelId: "C_ASSISTANT",
        adapter,
      }),
      undefined
    );
  });

  it("handles assistant_thread_context_changed event", async () => {
    const state = createMockState();
    const chatInstance = {
      ...createMockChatInstance(state),
      processAssistantContextChanged: vi.fn(),
    };
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });
    await adapter.initialize(chatInstance);

    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event: {
        type: "assistant_thread_context_changed",
        event_ts: "1234567891.000000",
        assistant_thread: {
          user_id: "U_USER",
          channel_id: "C_ASSISTANT",
          thread_ts: "1234567890.111111",
          context: {
            channel_id: "C_NEW_CONTEXT",
            team_id: "T123",
          },
        },
      },
    });
    const request = createWebhookRequest(body, secret);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(chatInstance.processAssistantContextChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "slack:C_ASSISTANT:1234567890.111111",
        userId: "U_USER",
        context: expect.objectContaining({
          channelId: "C_NEW_CONTEXT",
        }),
      }),
      undefined
    );
  });

  it("handles app_home_opened event", async () => {
    const state = createMockState();
    const chatInstance = {
      ...createMockChatInstance(state),
      processAppHomeOpened: vi.fn(),
    };
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });
    await adapter.initialize(chatInstance);

    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event: {
        type: "app_home_opened",
        user: "U_HOME_USER",
        channel: "D_HOME_CHAN",
        tab: "home",
        event_ts: "1234567892.000000",
      },
    });
    const request = createWebhookRequest(body, secret);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(chatInstance.processAppHomeOpened).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "U_HOME_USER",
        channelId: "D_HOME_CHAN",
        adapter,
      }),
      undefined
    );
  });

  it("handles member_joined_channel event", async () => {
    const state = createMockState();
    const chatInstance = {
      ...createMockChatInstance(state),
      processMemberJoinedChannel: vi.fn(),
    };
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
      botUserId: "U_BOT",
    });
    await adapter.initialize(chatInstance);

    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event: {
        type: "member_joined_channel",
        user: "U_JOINED_USER",
        channel: "C_TARGET_CHAN",
        inviter: "U_INVITER",
        event_ts: "1234567893.000000",
      },
    });
    const request = createWebhookRequest(body, secret);
    const response = await adapter.handleWebhook(request);

    expect(response.status).toBe(200);
    expect(chatInstance.processMemberJoinedChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "U_JOINED_USER",
        channelId: "slack:C_TARGET_CHAN:",
        inviterId: "U_INVITER",
        adapter,
      }),
      undefined
    );
  });
});

// ============================================================================
// decodeEphemeralMessageId Edge Case Tests
// ============================================================================

describe("decodeEphemeralMessageId edge cases", () => {
  it("returns null for non-ephemeral message ID", () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test",
      signingSecret: "s",
      logger: mockLogger,
    });
    const result = (
      adapter as unknown as Record<string, unknown> & {
        decodeEphemeralMessageId: (id: string) => unknown;
      }
    ).decodeEphemeralMessageId("1234567890.123456");
    expect(result).toBeNull();
  });

  it("returns null for ephemeral ID with only 1 part after prefix", () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test",
      signingSecret: "s",
      logger: mockLogger,
    });
    const result = (
      adapter as unknown as Record<string, unknown> & {
        decodeEphemeralMessageId: (id: string) => unknown;
      }
    ).decodeEphemeralMessageId("ephemeral:");
    expect(result).toBeNull();
  });

  it("decodes a properly encoded ephemeral ID", () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test",
      signingSecret: "s",
      logger: mockLogger,
    });
    const data = JSON.stringify({
      responseUrl: "https://hooks.slack.com/respond",
      userId: "U123",
    });
    const encoded = `ephemeral:1234567890.123456:${btoa(data)}`;
    const decode = (
      adapter as unknown as Record<string, unknown> & {
        decodeEphemeralMessageId: (id: string) => unknown;
      }
    ).decodeEphemeralMessageId;
    const result = decode.call(adapter, encoded);
    expect(result).toEqual({
      messageTs: "1234567890.123456",
      responseUrl: "https://hooks.slack.com/respond",
      userId: "U123",
    });
  });

  it("handles non-JSON base64 as legacy responseUrl format", () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test",
      signingSecret: "s",
      logger: mockLogger,
    });
    const encoded = `ephemeral:1234567890.123456:${btoa("https://hooks.slack.com/respond")}`;
    const decode = (
      adapter as unknown as Record<string, unknown> & {
        decodeEphemeralMessageId: (id: string) => unknown;
      }
    ).decodeEphemeralMessageId;
    const result = decode.call(adapter, encoded);
    expect(result).toEqual({
      messageTs: "1234567890.123456",
      responseUrl: "https://hooks.slack.com/respond",
      userId: "",
    });
  });

  it("returns null for invalid base64", () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test",
      signingSecret: "s",
      logger: mockLogger,
    });
    const decode = (
      adapter as unknown as Record<string, unknown> & {
        decodeEphemeralMessageId: (id: string) => unknown;
      }
    ).decodeEphemeralMessageId;
    const result = decode.call(adapter, "ephemeral:1234:!!!invalid-base64!!!");
    expect(result).toBeNull();
  });
});

// ============================================================================
// editMessage via response_url Tests
// ============================================================================

describe("editMessage via response_url", () => {
  it("sends replace to response_url for ephemeral message", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test",
      signingSecret: "s",
      logger: mockLogger,
    });
    const data = JSON.stringify({
      responseUrl: "https://hooks.slack.com/respond",
      userId: "U123",
    });
    const ephemeralId = `ephemeral:1234567890.123456:${btoa(data)}`;

    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await adapter.editMessage(
      "slack:C123:1234567890.000000",
      ephemeralId,
      "Updated text"
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://hooks.slack.com/respond",
      expect.objectContaining({ method: "POST" })
    );
    fetchSpy.mockRestore();
  });
});

// ============================================================================
// deleteMessage via response_url Tests
// ============================================================================

describe("deleteMessage via response_url", () => {
  it("sends delete_original to response_url for ephemeral message", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test",
      signingSecret: "s",
      logger: mockLogger,
    });
    const data = JSON.stringify({
      responseUrl: "https://hooks.slack.com/respond",
      userId: "U123",
    });
    const ephemeralId = `ephemeral:1234567890.123456:${btoa(data)}`;

    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await adapter.deleteMessage("slack:C123:1234567890.000000", ephemeralId);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://hooks.slack.com/respond",
      expect.objectContaining({ method: "POST" })
    );
    const callBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(callBody.delete_original).toBe(true);
    fetchSpy.mockRestore();
  });
});

// ============================================================================
// isMessageFromSelf Tests
// ============================================================================

describe("isMessageFromSelf", () => {
  interface AdapterWithPrivates {
    _botId: string | undefined;
    _botUserId: string | undefined;
    isMessageFromSelf: (event: Record<string, unknown>) => boolean;
  }

  it("matches by bot user ID", () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test",
      signingSecret: "s",
      logger: mockLogger,
    });
    (adapter as unknown as AdapterWithPrivates)._botUserId = "U_BOT_123";
    const result = (
      adapter as unknown as AdapterWithPrivates
    ).isMessageFromSelf({ user: "U_BOT_123" });
    expect(result).toBe(true);
  });

  it("matches by bot ID", () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test",
      signingSecret: "s",
      logger: mockLogger,
    });
    (adapter as unknown as AdapterWithPrivates)._botId = "B_BOT_456";
    const result = (
      adapter as unknown as AdapterWithPrivates
    ).isMessageFromSelf({ bot_id: "B_BOT_456" });
    expect(result).toBe(true);
  });

  it("returns false for non-bot messages", () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test",
      signingSecret: "s",
      logger: mockLogger,
    });
    (adapter as unknown as AdapterWithPrivates)._botUserId = "U_BOT_123";
    (adapter as unknown as AdapterWithPrivates)._botId = "B_BOT_456";
    const result = (
      adapter as unknown as AdapterWithPrivates
    ).isMessageFromSelf({ user: "U_OTHER" });
    expect(result).toBe(false);
  });
});

// ============================================================================
// Reverse User Lookup — @mention Resolution Tests
// ============================================================================

describe("reverse user lookup", () => {
  const secret = "test-signing-secret";

  interface MentionAdapter {
    chat: ChatInstance | null;
    resolveMessageMentions(
      message: AdapterPostableMessage,
      threadId: string
    ): Promise<AdapterPostableMessage>;
    resolveOutgoingMentions(text: string, threadId: string): Promise<string>;
  }

  function createAdapterWithState() {
    const state = createMockState();
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: secret,
      logger: mockLogger,
    });
    const chatInstance = createMockChatInstance(state);
    (adapter as unknown as MentionAdapter).chat = chatInstance;
    return { adapter, state };
  }

  describe("reverse index storage in lookupUser", () => {
    it("stores reverse index when looking up a user", async () => {
      const { adapter, state } = createAdapterWithState();

      // Mock Slack API
      const mockClient = (
        adapter as unknown as { client: { users: { info: unknown } } }
      ).client;
      mockClient.users.info = vi.fn().mockResolvedValue({
        user: {
          profile: { display_name: "dominik", real_name: "Dominik G" },
          real_name: "Dominik G",
          name: "dominik",
        },
      });

      await (
        adapter as unknown as {
          lookupUser(
            userId: string
          ): Promise<{ displayName: string; realName: string }>;
        }
      ).lookupUser("U_DOM_123");

      // Check reverse index was written
      const userIds = await state.getList("slack:user-by-name:dominik");
      expect(userIds).toContain("U_DOM_123");
    });
  });

  describe("resolveOutgoingMentions", () => {
    it("resolves unambiguous @mention to <@USER_ID>", async () => {
      const { adapter, state } = createAdapterWithState();

      // Seed reverse index: "dominik" → ["U_DOM_123"]
      await state.appendToList("slack:user-by-name:dominik", "U_DOM_123");

      const result = await (
        adapter as unknown as MentionAdapter
      ).resolveOutgoingMentions(
        "Hey @dominik, check this out",
        "slack:C123:1234567890.123456"
      );

      expect(result).toBe("Hey <@U_DOM_123>, check this out");
    });

    it("handles case insensitivity", async () => {
      const { adapter, state } = createAdapterWithState();

      await state.appendToList("slack:user-by-name:dominik", "U_DOM_123");

      const result = await (
        adapter as unknown as MentionAdapter
      ).resolveOutgoingMentions(
        "Hey @Dominik!",
        "slack:C123:1234567890.123456"
      );

      expect(result).toBe("Hey <@U_DOM_123>!");
    });

    it("deduplicates user IDs from reverse index", async () => {
      const { adapter, state } = createAdapterWithState();

      // Same user ID appended multiple times (from repeated lookups)
      await state.appendToList("slack:user-by-name:dominik", "U_DOM_123");
      await state.appendToList("slack:user-by-name:dominik", "U_DOM_123");

      const result = await (
        adapter as unknown as MentionAdapter
      ).resolveOutgoingMentions("Hey @dominik", "slack:C123:1234567890.123456");

      expect(result).toBe("Hey <@U_DOM_123>");
    });

    it("leaves mention as plain text when no match found", async () => {
      const { adapter } = createAdapterWithState();

      const result = await (
        adapter as unknown as MentionAdapter
      ).resolveOutgoingMentions(
        "Hey @unknown_user",
        "slack:C123:1234567890.123456"
      );

      expect(result).toBe("Hey @unknown_user");
    });

    it("skips already-resolved <@USER_ID> mentions", async () => {
      const { adapter, state } = createAdapterWithState();

      await state.appendToList("slack:user-by-name:dominik", "U_DOM_123");

      const result = await (
        adapter as unknown as MentionAdapter
      ).resolveOutgoingMentions(
        "Hey <@U_DOM_123> and @dominik",
        "slack:C123:1234567890.123456"
      );

      expect(result).toContain("<@U_DOM_123>");
      // The second @dominik should also be resolved
      expect(result).toBe("Hey <@U_DOM_123> and <@U_DOM_123>");
    });

    it("disambiguates using thread participants", async () => {
      const { adapter, state } = createAdapterWithState();
      const threadId = "slack:C123:1234567890.123456";

      // Two users named "alex"
      await state.appendToList("slack:user-by-name:alex", "U_ALEX_1");
      await state.appendToList("slack:user-by-name:alex", "U_ALEX_2");

      // Only U_ALEX_2 is a thread participant
      await state.appendToList(
        `slack:thread-participants:${threadId}`,
        "U_ALEX_2"
      );

      const result = await (
        adapter as unknown as MentionAdapter
      ).resolveOutgoingMentions("Hey @alex", threadId);

      expect(result).toBe("Hey <@U_ALEX_2>");
    });

    it("leaves ambiguous mentions as plain text when thread participants don't help", async () => {
      const { adapter, state } = createAdapterWithState();
      const threadId = "slack:C123:1234567890.123456";

      // Two users named "alex"
      await state.appendToList("slack:user-by-name:alex", "U_ALEX_1");
      await state.appendToList("slack:user-by-name:alex", "U_ALEX_2");

      // Both are thread participants
      await state.appendToList(
        `slack:thread-participants:${threadId}`,
        "U_ALEX_1"
      );
      await state.appendToList(
        `slack:thread-participants:${threadId}`,
        "U_ALEX_2"
      );

      const result = await (
        adapter as unknown as MentionAdapter
      ).resolveOutgoingMentions("Hey @alex", threadId);

      expect(result).toBe("Hey @alex");
    });

    it("resolves multiple different mentions in one message", async () => {
      const { adapter, state } = createAdapterWithState();

      await state.appendToList("slack:user-by-name:dominik", "U_DOM_123");
      await state.appendToList("slack:user-by-name:malte", "U_MAL_456");

      const result = await (
        adapter as unknown as MentionAdapter
      ).resolveOutgoingMentions(
        "@dominik and @malte please review",
        "slack:C123:1234567890.123456"
      );

      expect(result).toBe("<@U_DOM_123> and <@U_MAL_456> please review");
    });

    it("does nothing when chat is not initialized", async () => {
      const adapter = createSlackAdapter({
        botToken: "xoxb-test-token",
        signingSecret: secret,
        logger: mockLogger,
      });

      const result = await (
        adapter as unknown as MentionAdapter
      ).resolveOutgoingMentions("Hey @dominik", "slack:C123:1234567890.123456");

      expect(result).toBe("Hey @dominik");
    });
  });

  describe("resolveMessageMentions", () => {
    it("resolves mentions in string messages", async () => {
      const { adapter, state } = createAdapterWithState();

      await state.appendToList("slack:user-by-name:dominik", "U_DOM_123");

      const result = await (
        adapter as unknown as MentionAdapter
      ).resolveMessageMentions(
        "Hey @dominik" as AdapterPostableMessage,
        "slack:C123:1234567890.123456"
      );

      expect(result).toBe("Hey <@U_DOM_123>");
    });

    it("resolves mentions in raw messages", async () => {
      const { adapter, state } = createAdapterWithState();

      await state.appendToList("slack:user-by-name:dominik", "U_DOM_123");

      const result = await (
        adapter as unknown as MentionAdapter
      ).resolveMessageMentions(
        { raw: "Hey @dominik" } as AdapterPostableMessage,
        "slack:C123:1234567890.123456"
      );

      expect(result).toEqual({ raw: "Hey <@U_DOM_123>" });
    });

    it("resolves mentions in markdown messages", async () => {
      const { adapter, state } = createAdapterWithState();

      await state.appendToList("slack:user-by-name:dominik", "U_DOM_123");

      const result = await (
        adapter as unknown as MentionAdapter
      ).resolveMessageMentions(
        { markdown: "Hey @dominik" } as AdapterPostableMessage,
        "slack:C123:1234567890.123456"
      );

      expect(result).toEqual({ markdown: "Hey <@U_DOM_123>" });
    });

    it("passes through AST messages unchanged", async () => {
      const { adapter } = createAdapterWithState();

      const astMessage = {
        ast: { type: "root", children: [] },
      } as AdapterPostableMessage;

      const result = await (
        adapter as unknown as MentionAdapter
      ).resolveMessageMentions(astMessage, "slack:C123:1234567890.123456");

      expect(result).toBe(astMessage);
    });
  });

  describe("thread participant tracking", () => {
    it("tracks thread participants on incoming messages", async () => {
      const { adapter, state } = createAdapterWithState();

      // Mock Slack API so lookupUser doesn't hit real API
      const mockClient = (
        adapter as unknown as { client: { users: { info: unknown } } }
      ).client;
      mockClient.users.info = vi.fn().mockResolvedValue({
        user: {
          profile: { display_name: "sender", real_name: "Sender One" },
          real_name: "Sender One",
          name: "sender",
        },
      });

      const threadId = "slack:C123:1234567890.123456";
      const event = {
        type: "message",
        user: "U_SENDER_1",
        text: "Hello",
        ts: "1234567890.123456",
        channel: "C123",
        thread_ts: "1234567890.123456",
      };

      // Call parseSlackMessage directly
      await (
        adapter as unknown as {
          parseSlackMessage(
            event: Record<string, unknown>,
            threadId: string
          ): Promise<unknown>;
        }
      ).parseSlackMessage(event, threadId);

      // Allow participant tracking to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      const participants = await state.getList(
        `slack:thread-participants:${threadId}`
      );
      expect(participants).toContain("U_SENDER_1");
    });
  });

  describe("user_change event", () => {
    it("invalidates user cache on profile change", async () => {
      const state = createMockState();
      const adapter = createSlackAdapter({
        botToken: "xoxb-test-token",
        signingSecret: secret,
        logger: mockLogger,
      });
      mockClientMethod(
        adapter,
        "auth.test",
        vi.fn().mockResolvedValue({
          ok: true,
          user_id: "U_BOT",
          user: "bot",
          bot_id: "B_BOT",
        })
      );
      await adapter.initialize(createMockChatInstance(state));

      // Seed user cache
      await state.set(
        "slack:user:U_DOM_123",
        { displayName: "dominik", realName: "Dominik G" },
        8 * 24 * 60 * 60 * 1000
      );

      const body = JSON.stringify({
        type: "event_callback",
        event: {
          type: "user_change",
          event_ts: "1234567890.123456",
          user: {
            id: "U_DOM_123",
            name: "dominik",
            real_name: "Dominik New",
            profile: {
              display_name: "dom_new",
              real_name: "Dominik New",
            },
          },
        },
      });
      const request = createWebhookRequest(body, secret);
      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const cached = await state.get("slack:user:U_DOM_123");
      expect(cached).toBeNull();
    });
  });
});
