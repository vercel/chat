/**
 * Tests for the Discord adapter - webhook handling, message operations, and format conversion.
 */

import { generateKeyPairSync, sign } from "node:crypto";
import { ValidationError } from "@chat-adapter/shared";
import type { ChatInstance, Logger, StateAdapter } from "chat";
import { InteractionType } from "discord-api-types/v10";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDiscordAdapter, DiscordAdapter } from "./index";
import { DiscordFormatConverter } from "./markdown";

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

// Generate an Ed25519 keypair for testing using Node.js crypto
const testKeyPair = generateKeyPairSync("ed25519");
const testPublicKeyDer = testKeyPair.publicKey.export({
  type: "spki",
  format: "der",
});
// Extract raw 32-byte public key from DER format (skip the 12-byte header)
const testPublicKey = testPublicKeyDer.subarray(12).toString("hex");

function createDiscordSignature(
  body: string,
  _publicKey: string,
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  timestamp: string
): string {
  const message = timestamp + body;
  const signature = sign(null, Buffer.from(message), privateKey);
  return signature.toString("hex");
}

function createWebhookRequest(
  body: string,
  options?: { timestamp?: string; signature?: string }
): Request {
  const timestamp = options?.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature =
    options?.signature ??
    createDiscordSignature(
      body,
      testPublicKey,
      testKeyPair.privateKey,
      timestamp
    );

  return new Request("https://example.com/webhook", {
    method: "POST",
    headers: {
      "x-signature-ed25519": signature,
      "x-signature-timestamp": timestamp,
      "content-type": "application/json",
    },
    body,
  });
}

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
    get: vi
      .fn()
      .mockImplementation((key: string) =>
        Promise.resolve(cache.get(key) ?? null)
      ),
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
    processAppHomeOpened: vi.fn(),
    processAssistantContextChanged: vi.fn(),
    processAssistantThreadStarted: vi.fn(),
    processModalSubmit: vi.fn().mockResolvedValue(undefined),
    processModalClose: vi.fn(),
    processSlashCommand: vi.fn(),
    getState: () => state,
    getUserName: () => "test-bot",
    getLogger: () => mockLogger,
  };
}

// ============================================================================
// Factory Function Tests
// ============================================================================

describe("createDiscordAdapter", () => {
  it("creates a DiscordAdapter instance", () => {
    const adapter = createDiscordAdapter({
      botToken: "test-token",
      publicKey: testPublicKey,
      applicationId: "test-app-id",
      logger: mockLogger,
    });
    expect(adapter).toBeInstanceOf(DiscordAdapter);
    expect(adapter.name).toBe("discord");
  });

  it("sets default userName to 'bot'", () => {
    const adapter = createDiscordAdapter({
      botToken: "test-token",
      publicKey: testPublicKey,
      applicationId: "test-app-id",
      logger: mockLogger,
    });
    expect(adapter.userName).toBe("bot");
  });

  it("uses provided userName", () => {
    const adapter = createDiscordAdapter({
      botToken: "test-token",
      publicKey: testPublicKey,
      applicationId: "test-app-id",
      logger: mockLogger,
      userName: "custombot",
    });
    expect(adapter.userName).toBe("custombot");
  });
});

// ============================================================================
// Thread ID Encoding/Decoding Tests
// ============================================================================

describe("encodeThreadId", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("encodes guild and channel correctly", () => {
    const threadId = adapter.encodeThreadId({
      guildId: "guild123",
      channelId: "channel456",
    });
    expect(threadId).toBe("discord:guild123:channel456");
  });

  it("encodes with thread ID", () => {
    const threadId = adapter.encodeThreadId({
      guildId: "guild123",
      channelId: "channel456",
      threadId: "thread789",
    });
    expect(threadId).toBe("discord:guild123:channel456:thread789");
  });

  it("encodes DM channel", () => {
    const threadId = adapter.encodeThreadId({
      guildId: "@me",
      channelId: "dm123",
    });
    expect(threadId).toBe("discord:@me:dm123");
  });
});

describe("decodeThreadId", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("decodes valid thread ID", () => {
    const result = adapter.decodeThreadId("discord:guild123:channel456");
    expect(result).toEqual({
      guildId: "guild123",
      channelId: "channel456",
      threadId: undefined,
    });
  });

  it("decodes thread ID with thread", () => {
    const result = adapter.decodeThreadId(
      "discord:guild123:channel456:thread789"
    );
    expect(result).toEqual({
      guildId: "guild123",
      channelId: "channel456",
      threadId: "thread789",
    });
  });

  it("decodes DM thread ID", () => {
    const result = adapter.decodeThreadId("discord:@me:dm123");
    expect(result).toEqual({
      guildId: "@me",
      channelId: "dm123",
      threadId: undefined,
    });
  });

  it("throws on invalid thread ID format", () => {
    expect(() => adapter.decodeThreadId("invalid")).toThrow(ValidationError);
    expect(() => adapter.decodeThreadId("discord:channel")).toThrow(
      ValidationError
    );
    expect(() => adapter.decodeThreadId("slack:C12345:123")).toThrow(
      ValidationError
    );
  });
});

describe("isDM", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("returns true for DM channels (@me prefix)", () => {
    expect(adapter.isDM("discord:@me:dm123")).toBe(true);
  });

  it("returns false for guild channels", () => {
    expect(adapter.isDM("discord:guild123:channel456")).toBe(false);
  });

  it("returns false for threads in guilds", () => {
    expect(adapter.isDM("discord:guild123:channel456:thread789")).toBe(false);
  });
});

// ============================================================================
// Webhook Signature Verification Tests
// ============================================================================

describe("handleWebhook - signature verification", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("rejects requests without signature header", async () => {
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-signature-timestamp": String(Math.floor(Date.now() / 1000)),
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: InteractionType.Ping }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("rejects requests without timestamp header", async () => {
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-signature-ed25519": "invalid",
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: InteractionType.Ping }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("rejects requests with invalid signature", async () => {
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-signature-ed25519": "invalid",
        "x-signature-timestamp": String(Math.floor(Date.now() / 1000)),
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: InteractionType.Ping }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("accepts requests with valid signature", async () => {
    const body = JSON.stringify({ type: InteractionType.Ping });
    const request = createWebhookRequest(body);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });
});

// ============================================================================
// PING Interaction Tests
// ============================================================================

describe("handleWebhook - PING", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("responds to PING with PONG", async () => {
    const body = JSON.stringify({ type: InteractionType.Ping });
    const request = createWebhookRequest(body);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const responseBody = await response.json();
    expect(responseBody).toEqual({ type: 1 }); // Pong
  });
});

// ============================================================================
// MESSAGE_COMPONENT Interaction Tests
// ============================================================================

describe("handleWebhook - MESSAGE_COMPONENT", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("handles button click interaction", async () => {
    const body = JSON.stringify({
      type: InteractionType.MessageComponent,
      id: "interaction123",
      application_id: "test-app-id",
      token: "interaction-token",
      version: 1,
      guild_id: "guild123",
      channel_id: "channel456",
      member: {
        user: {
          id: "user789",
          username: "testuser",
          discriminator: "0001",
          global_name: "Test User",
        },
        nick: null,
        roles: [],
        joined_at: "2021-01-01T00:00:00.000Z",
      },
      message: {
        id: "message123",
        channel_id: "channel456",
        author: { id: "bot", username: "bot", discriminator: "0000" },
        content: "Test message",
        timestamp: "2021-01-01T00:00:00.000Z",
        tts: false,
        mention_everyone: false,
        mentions: [],
        mention_roles: [],
        attachments: [],
        embeds: [],
        pinned: false,
        type: 0,
      },
      data: {
        custom_id: "approve_btn",
        component_type: 2,
      },
    });
    const request = createWebhookRequest(body);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const responseBody = await response.json();
    expect(responseBody).toEqual({ type: 6 }); // DeferredUpdateMessage
  });
});

// ============================================================================
// APPLICATION_COMMAND Interaction Tests
// ============================================================================

describe("handleWebhook - APPLICATION_COMMAND", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  const mockState = createMockState();
  const mockChat = createMockChatInstance(mockState);

  adapter.initialize(mockChat);

  const slashCommandBody = JSON.stringify({
    type: InteractionType.ApplicationCommand,
    id: "interaction123",
    application_id: "test-app-id",
    token: "interaction-token",
    version: 1,
    guild_id: "guild123",
    channel_id: "channel456",
    member: {
      user: {
        id: "user789",
        username: "testuser",
        discriminator: "0001",
      },
      roles: [],
      joined_at: "2021-01-01T00:00:00.000Z",
    },
    data: {
      id: "cmd123",
      name: "test",
      type: 1,
    },
  });

  it("ACKs with DeferredChannelMessageWithSource", async () => {
    const request = createWebhookRequest(slashCommandBody);
    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(responseBody).toEqual({ type: 5 }); // DeferredChannelMessageWithSource
  });

  it("invokes processSlashCommand with correct event", async () => {
    const processSlashCommand = mockChat.processSlashCommand as ReturnType<
      typeof vi.fn
    >;
    processSlashCommand.mockClear();
    const request = createWebhookRequest(slashCommandBody);
    await adapter.handleWebhook(request);

    expect(processSlashCommand).toHaveBeenCalledOnce();
    const [event] = processSlashCommand.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(event.command).toBe("/test");
    expect(event.channelId).toBe("discord:guild123:channel456");
    expect(event.triggerId).toBe("interaction-token");
    expect((event.user as { userId: string }).userId).toBe("user789");
    expect(event.raw).toMatchObject({ id: "interaction123" });
  });
});

// ============================================================================
// postChannelMessage - Interaction Token Resolution Tests
// ============================================================================

describe("postChannelMessage - interaction token resolution", () => {
  const channelId = "discord:guild123:channel456";
  const stateKey = `discord:interaction-token:${channelId}`;
  const msgResponse = { id: "msg-1", channel_id: "channel456" };

  let adapter: InstanceType<typeof DiscordAdapter>;
  let mockState: ReturnType<typeof createMockState>;

  beforeEach(() => {
    adapter = createDiscordAdapter({
      botToken: "test-bot-token",
      publicKey: testPublicKey,
      applicationId: "test-app-id",
      logger: mockLogger,
    });
    mockState = createMockState();
    adapter.initialize(createMockChatInstance(mockState));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("PATCHes @original with JSON when token is in state", async () => {
    await mockState.set(stateKey, "my-token");
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(msgResponse), { status: 200 })
    );

    const result = await adapter.postChannelMessage(channelId, "Hello!");

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/webhooks/test-app-id/my-token/messages/@original");
    expect(init.method).toBe("PATCH");
    expect(init.body).not.toBeInstanceOf(FormData);
    expect(result.id).toBe("msg-1");
    expect(await mockState.get(stateKey)).toBeNull();
  });

  it("PATCHes @original with multipart when token is in state and files are present", async () => {
    await mockState.set(stateKey, "my-token");
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(msgResponse), { status: 200 })
    );

    await adapter.postChannelMessage(channelId, {
      raw: "Here is a file",
      files: [
        {
          filename: "test.txt",
          data: Buffer.from("hello"),
          mimeType: "text/plain",
        },
      ],
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/webhooks/test-app-id/my-token/messages/@original");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBeInstanceOf(FormData);
    expect(await mockState.get(stateKey)).toBeNull();
  });

  it("deletes token and falls back to channel POST when PATCH fails", async () => {
    await mockState.set(stateKey, "bad-token");
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(msgResponse), { status: 200 })
      );

    const result = await adapter.postChannelMessage(channelId, "Hello!");

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    const [secondUrl] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit];
    expect(secondUrl).toContain("/channels/channel456/messages");
    expect(result.id).toBe("msg-1");
    expect(await mockState.get(stateKey)).toBeNull();
  });
});

// ============================================================================
// JSON Parsing Tests
// ============================================================================

describe("handleWebhook - JSON parsing", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("returns 400 for invalid JSON", async () => {
    const body = "not valid json";
    const request = createWebhookRequest(body);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });

  it("returns 400 for unknown interaction type", async () => {
    const body = JSON.stringify({ type: 999 });
    const request = createWebhookRequest(body);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });
});

// ============================================================================
// parseMessage Tests
// ============================================================================

describe("parseMessage", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("parses a basic message", () => {
    const rawMessage = {
      id: "message123",
      channel_id: "channel456",
      guild_id: "guild789",
      author: {
        id: "user123",
        username: "testuser",
        discriminator: "0001",
        global_name: "Test User",
      },
      content: "Hello world",
      timestamp: "2021-01-01T00:00:00.000Z",
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: [],
      pinned: false,
      type: 0,
    };

    const message = adapter.parseMessage(rawMessage);

    expect(message.id).toBe("message123");
    expect(message.text).toBe("Hello world");
    expect(message.author.userId).toBe("user123");
    expect(message.author.userName).toBe("testuser");
    expect(message.author.fullName).toBe("Test User");
    expect(message.author.isBot).toBe(false);
    expect(message.threadId).toBe("discord:guild789:channel456");
  });

  it("parses a bot message", () => {
    const rawMessage = {
      id: "message123",
      channel_id: "channel456",
      author: {
        id: "bot123",
        username: "somebot",
        discriminator: "0000",
        bot: true,
      },
      content: "Bot message",
      timestamp: "2021-01-01T00:00:00.000Z",
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: [],
      pinned: false,
      type: 0,
    };

    const message = adapter.parseMessage(rawMessage);

    expect(message.author.userId).toBe("bot123");
    expect(message.author.isBot).toBe(true);
  });

  it("parses a DM message (no guild_id)", () => {
    const rawMessage = {
      id: "message123",
      channel_id: "dm456",
      author: {
        id: "user123",
        username: "testuser",
        discriminator: "0001",
      },
      content: "DM message",
      timestamp: "2021-01-01T00:00:00.000Z",
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: [],
      pinned: false,
      type: 0,
    };

    const message = adapter.parseMessage(rawMessage);

    expect(message.threadId).toBe("discord:@me:dm456");
  });

  it("parses edited message", () => {
    const rawMessage = {
      id: "message123",
      channel_id: "channel456",
      guild_id: "guild789",
      author: {
        id: "user123",
        username: "testuser",
        discriminator: "0001",
      },
      content: "Edited message",
      timestamp: "2021-01-01T00:00:00.000Z",
      edited_timestamp: "2021-01-01T00:01:00.000Z",
      tts: false,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: [],
      pinned: false,
      type: 0,
    };

    const message = adapter.parseMessage(rawMessage);

    expect(message.metadata?.edited).toBe(true);
    expect(message.metadata?.editedAt).toEqual(
      new Date("2021-01-01T00:01:00.000Z")
    );
  });

  it("parses message with attachments", () => {
    const rawMessage = {
      id: "message123",
      channel_id: "channel456",
      guild_id: "guild789",
      author: {
        id: "user123",
        username: "testuser",
        discriminator: "0001",
      },
      content: "Message with attachment",
      timestamp: "2021-01-01T00:00:00.000Z",
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [
        {
          id: "att123",
          filename: "image.png",
          size: 12345,
          url: "https://cdn.discord.com/image.png",
          proxy_url: "https://media.discord.com/image.png",
          content_type: "image/png",
          width: 800,
          height: 600,
        },
      ],
      embeds: [],
      pinned: false,
      type: 0,
    };

    const message = adapter.parseMessage(rawMessage);

    expect(message.attachments).toHaveLength(1);
    expect(message.attachments?.[0].type).toBe("image");
    expect(message.attachments?.[0].name).toBe("image.png");
    expect(message.attachments?.[0].mimeType).toBe("image/png");
    expect(message.attachments?.[0].width).toBe(800);
    expect(message.attachments?.[0].height).toBe(600);
  });

  it("handles different attachment types", () => {
    const createMessage = (contentType: string) => ({
      id: "message123",
      channel_id: "channel456",
      author: {
        id: "user123",
        username: "testuser",
        discriminator: "0001",
      },
      content: "",
      timestamp: "2021-01-01T00:00:00.000Z",
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [
        {
          id: "att123",
          filename: "file",
          size: 1000,
          url: "https://example.com",
          proxy_url: "https://example.com",
          content_type: contentType,
        },
      ],
      embeds: [],
      pinned: false,
      type: 0,
    });

    const imageMsg = adapter.parseMessage(createMessage("image/jpeg"));
    expect(imageMsg.attachments?.[0].type).toBe("image");

    const videoMsg = adapter.parseMessage(createMessage("video/mp4"));
    expect(videoMsg.attachments?.[0].type).toBe("video");

    const audioMsg = adapter.parseMessage(createMessage("audio/mpeg"));
    expect(audioMsg.attachments?.[0].type).toBe("audio");

    const fileMsg = adapter.parseMessage(createMessage("application/pdf"));
    expect(fileMsg.attachments?.[0].type).toBe("file");
  });

  it("uses username as fullName when global_name is missing", () => {
    const rawMessage = {
      id: "message123",
      channel_id: "channel456",
      author: {
        id: "user123",
        username: "testuser",
        discriminator: "0001",
      },
      content: "Hello",
      timestamp: "2021-01-01T00:00:00.000Z",
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: [],
      pinned: false,
      type: 0,
    };

    const message = adapter.parseMessage(rawMessage);
    expect(message.author.fullName).toBe("testuser");
  });
});

// ============================================================================
// renderFormatted Tests
// ============================================================================

describe("renderFormatted", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("renders AST to Discord markdown format", () => {
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
    expect(result).toBe("**bold**");
  });

  it("converts mentions in rendered output", () => {
    const ast = {
      type: "root" as const,
      children: [
        {
          type: "paragraph" as const,
          children: [{ type: "text" as const, value: "Hello @someone" }],
        },
      ],
    };

    const result = adapter.renderFormatted(ast);
    expect(result).toContain("<@someone>");
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("edge cases", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("handles empty content in message", () => {
    const rawMessage = {
      id: "message123",
      channel_id: "channel456",
      author: {
        id: "user123",
        username: "testuser",
        discriminator: "0001",
      },
      content: "",
      timestamp: "2021-01-01T00:00:00.000Z",
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: [],
      pinned: false,
      type: 0,
    };

    const message = adapter.parseMessage(rawMessage);
    expect(message.text).toBe("");
  });

  it("handles null width/height in attachments", () => {
    const rawMessage = {
      id: "message123",
      channel_id: "channel456",
      author: {
        id: "user123",
        username: "testuser",
        discriminator: "0001",
      },
      content: "",
      timestamp: "2021-01-01T00:00:00.000Z",
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [
        {
          id: "att123",
          filename: "doc.pdf",
          size: 1000,
          url: "https://example.com",
          proxy_url: "https://example.com",
          content_type: "application/pdf",
          width: null,
          height: null,
        },
      ],
      embeds: [],
      pinned: false,
      type: 0,
    };

    const message = adapter.parseMessage(rawMessage);
    expect(message.attachments?.[0].width).toBeUndefined();
    expect(message.attachments?.[0].height).toBeUndefined();
  });

  it("handles missing attachment content_type", () => {
    const rawMessage = {
      id: "message123",
      channel_id: "channel456",
      author: {
        id: "user123",
        username: "testuser",
        discriminator: "0001",
      },
      content: "",
      timestamp: "2021-01-01T00:00:00.000Z",
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [
        {
          id: "att123",
          filename: "unknown",
          size: 1000,
          url: "https://example.com",
          proxy_url: "https://example.com",
        },
      ],
      embeds: [],
      pinned: false,
      type: 0,
    };

    const message = adapter.parseMessage(rawMessage);
    expect(message.attachments?.[0].type).toBe("file");
  });
});

// ============================================================================
// Date Parsing Tests
// ============================================================================

describe("date parsing", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("parses ISO timestamp to Date", () => {
    const rawMessage = {
      id: "message123",
      channel_id: "channel456",
      author: {
        id: "user123",
        username: "testuser",
        discriminator: "0001",
      },
      content: "Hello",
      timestamp: "2021-01-01T12:30:00.000Z",
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: [],
      pinned: false,
      type: 0,
    };

    const message = adapter.parseMessage(rawMessage);
    expect(message.metadata?.dateSent).toEqual(
      new Date("2021-01-01T12:30:00.000Z")
    );
  });
});

// ============================================================================
// Formatted Text Extraction Tests
// ============================================================================

describe("formatted text extraction", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("extracts plain text from Discord markdown", () => {
    const rawMessage = {
      id: "message123",
      channel_id: "channel456",
      author: {
        id: "user123",
        username: "testuser",
        discriminator: "0001",
      },
      content: "**bold** and *italic*",
      timestamp: "2021-01-01T00:00:00.000Z",
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: [],
      pinned: false,
      type: 0,
    };

    const message = adapter.parseMessage(rawMessage);
    expect(message.text).toBe("bold and italic");
  });

  it("extracts text from user mentions", () => {
    const rawMessage = {
      id: "message123",
      channel_id: "channel456",
      author: {
        id: "user123",
        username: "testuser",
        discriminator: "0001",
      },
      content: "Hey <@456789>!",
      timestamp: "2021-01-01T00:00:00.000Z",
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: [],
      pinned: false,
      type: 0,
    };

    const message = adapter.parseMessage(rawMessage);
    expect(message.text).toContain("@456789");
  });

  it("extracts text from channel mentions", () => {
    const rawMessage = {
      id: "message123",
      channel_id: "channel456",
      author: {
        id: "user123",
        username: "testuser",
        discriminator: "0001",
      },
      content: "Check <#987654>",
      timestamp: "2021-01-01T00:00:00.000Z",
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: [],
      pinned: false,
      type: 0,
    };

    const message = adapter.parseMessage(rawMessage);
    expect(message.text).toContain("#987654");
  });
});

// ============================================================================
// DiscordFormatConverter Tests (additional)
// ============================================================================

describe("DiscordFormatConverter", () => {
  const converter = new DiscordFormatConverter();

  describe("toAst", () => {
    it("should convert user mentions to standard format", () => {
      const text = converter.extractPlainText("Hello <@123456789>");
      expect(text).toBe("Hello @123456789");
    });

    it("should convert channel mentions", () => {
      const text = converter.extractPlainText("Check <#987654321>");
      expect(text).toBe("Check #987654321");
    });

    it("should convert custom emoji", () => {
      const text = converter.extractPlainText("Nice <:thumbsup:123>");
      expect(text).toBe("Nice :thumbsup:");
    });

    it("should handle bold text", () => {
      const ast = converter.toAst("**bold text**");
      expect(ast).toBeDefined();
    });

    it("should handle italic text", () => {
      const ast = converter.toAst("*italic text*");
      expect(ast).toBeDefined();
    });
  });

  describe("fromAst", () => {
    it("should convert mentions to Discord format", () => {
      const ast = converter.toAst("Hello @someone");
      const result = converter.fromAst(ast);
      expect(result).toContain("<@someone>");
    });
  });

  describe("renderPostable", () => {
    it("should render a plain string", () => {
      const result = converter.renderPostable("Hello @user");
      expect(result).toBe("Hello <@user>");
    });

    it("should render a raw message", () => {
      const result = converter.renderPostable({ raw: "Hello @user" });
      expect(result).toBe("Hello <@user>");
    });
  });
});
