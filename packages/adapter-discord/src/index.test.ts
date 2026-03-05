/**
 * Tests for the Discord adapter - webhook handling, message operations, and format conversion.
 */

import { generateKeyPairSync, sign } from "node:crypto";
import { ValidationError } from "@chat-adapter/shared";
import type { ChatInstance, Logger } from "chat";
import { InteractionType } from "discord-api-types/v10";
import { describe, expect, it, vi } from "vitest";
import { createDiscordAdapter, DiscordAdapter } from "./index";
import { DiscordFormatConverter } from "./markdown";

const AT_ME_REGEX = /\/@me$/;

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

  it("handles slash command interaction", async () => {
    const body = JSON.stringify({
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
    const request = createWebhookRequest(body);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const responseBody = await response.json();
    expect(responseBody).toEqual({ type: 5 }); // DeferredChannelMessageWithSource
  });

  it("dispatches slash command to chat core", async () => {
    const processSlashCommand = vi.fn();
    await adapter.initialize({
      processSlashCommand,
    } as unknown as ChatInstance);

    const body = JSON.stringify({
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
          global_name: "Test User",
        },
        roles: [],
        joined_at: "2021-01-01T00:00:00.000Z",
      },
      data: {
        name: "test",
        type: 1,
        options: [
          {
            name: "topic",
            type: 3,
            value: "status",
          },
          {
            name: "verbose",
            type: 5,
            value: true,
          },
        ],
      },
    });
    const request = createWebhookRequest(body);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    expect(processSlashCommand).toHaveBeenCalledTimes(1);
    expect(processSlashCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "/test",
        text: "status true",
        channelId: "discord:guild123:channel456",
        user: {
          userId: "user789",
          userName: "testuser",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
      }),
      undefined
    );
  });

  it("expands subcommand path into event.command", async () => {
    const processSlashCommand = vi.fn();
    await adapter.initialize({
      processSlashCommand,
    } as unknown as ChatInstance);

    const body = JSON.stringify({
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
          global_name: "Test User",
        },
        roles: [],
        joined_at: "2021-01-01T00:00:00.000Z",
      },
      data: {
        name: "project",
        type: 1,
        options: [
          {
            name: "issue",
            type: 2, // SUB_COMMAND_GROUP
            options: [
              {
                name: "create",
                type: 1, // SUB_COMMAND
                options: [
                  { name: "title", type: 3, value: "Login fails" },
                  { name: "priority", type: 3, value: "high" },
                ],
              },
            ],
          },
        ],
      },
    });
    const request = createWebhookRequest(body);

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    expect(processSlashCommand).toHaveBeenCalledTimes(1);
    expect(processSlashCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "/project issue create",
        text: "Login fails high",
      }),
      undefined
    );
  });

  it("resolves deferred slash responses via interaction webhook", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg123",
          channel_id: "channel456",
          content: "Pong!",
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
          author: {
            id: "test-app-id",
            username: "bot",
            discriminator: "0000",
            bot: true,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    try {
      let replyTask: Promise<unknown> | undefined;

      await adapter.initialize({
        processSlashCommand: (event: { channelId: string }) => {
          replyTask = adapter.postChannelMessage(event.channelId, "Pong!");
        },
      } as unknown as ChatInstance);

      const body = JSON.stringify({
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
      const request = createWebhookRequest(body);

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);

      await replyTask;

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://discord.com/api/v10/webhooks/test-app-id/interaction-token/messages/@original",
        expect.objectContaining({
          method: "PATCH",
        })
      );
    } finally {
      fetchSpy.mockRestore();
    }
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

  it("uses referenced_message content for thread starter messages", () => {
    const rawMessage = {
      id: "starter123",
      channel_id: "thread456",
      guild_id: "guild789",
      author: {
        id: "system",
        username: "system",
        discriminator: "0000",
        bot: true,
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
      type: 21,
      message_reference: {
        message_id: "parent123",
        channel_id: "channel456",
        guild_id: "guild789",
      },
      referenced_message: {
        id: "parent123",
        channel_id: "channel456",
        guild_id: "guild789",
        author: {
          id: "user123",
          username: "parent-author",
          discriminator: "0001",
          global_name: "Parent Author",
        },
        content: "Parent message content",
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
      },
    };

    const message = adapter.parseMessage(rawMessage);

    expect(message.id).toBe("parent123");
    expect(message.text).toBe("Parent message content");
    expect(message.author.userId).toBe("user123");
    expect(message.threadId).toBe("discord:guild789:thread456");
  });

  it("falls back gracefully when thread starter has no referenced_message", () => {
    const rawMessage = {
      id: "starter123",
      channel_id: "thread456",
      guild_id: "guild789",
      author: {
        id: "system",
        username: "system",
        discriminator: "0000",
        bot: true,
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
      type: 21,
      message_reference: {
        message_id: "parent123",
        channel_id: "channel456",
        guild_id: "guild789",
      },
      referenced_message: null,
    };

    const message = adapter.parseMessage(rawMessage);

    expect(message.id).toBe("starter123");
    expect(message.text).toBe("");
    expect(message.author.userId).toBe("system");
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

// ============================================================================
// postMessage Tests
// ============================================================================

describe("postMessage", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("posts a plain text message", async () => {
    const mockResponse = new Response(
      JSON.stringify({
        id: "msg001",
        channel_id: "channel456",
        content: "Hello world",
        timestamp: "2021-01-01T00:00:00.000Z",
        author: { id: "test-app-id", username: "bot" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    const result = await adapter.postMessage(
      "discord:guild1:channel456",
      "Hello world"
    );

    expect(result.id).toBe("msg001");
    expect(result.threadId).toBe("discord:guild1:channel456");
    expect(spy).toHaveBeenCalledWith(
      "/channels/channel456/messages",
      "POST",
      expect.objectContaining({ content: expect.any(String) })
    );

    spy.mockRestore();
  });

  it("posts to thread channel when threadId is present", async () => {
    const mockResponse = new Response(
      JSON.stringify({
        id: "msg002",
        channel_id: "thread789",
        content: "Thread reply",
        timestamp: "2021-01-01T00:00:00.000Z",
        author: { id: "test-app-id", username: "bot" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    const result = await adapter.postMessage(
      "discord:guild1:channel456:thread789",
      "Thread reply"
    );

    expect(result.id).toBe("msg002");
    expect(result.threadId).toBe("discord:guild1:channel456:thread789");
    // Should post to thread channel, not parent
    expect(spy).toHaveBeenCalledWith(
      "/channels/thread789/messages",
      "POST",
      expect.objectContaining({ content: expect.any(String) })
    );

    spy.mockRestore();
  });

  it("truncates content exceeding 2000 characters", async () => {
    const longMessage = "a".repeat(2500);
    const mockResponse = new Response(
      JSON.stringify({
        id: "msg003",
        channel_id: "channel456",
        content: "truncated",
        timestamp: "2021-01-01T00:00:00.000Z",
        author: { id: "test-app-id", username: "bot" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    await adapter.postMessage("discord:guild1:channel456", longMessage);

    const calledPayload = spy.mock.calls[0]?.[2] as { content?: string };
    expect(calledPayload.content).toBeDefined();
    expect(calledPayload.content?.length).toBeLessThanOrEqual(2000);
    expect(calledPayload.content?.endsWith("...")).toBe(true);

    spy.mockRestore();
  });

  it("does not truncate content within 2000 characters", async () => {
    const shortMessage = "short";
    const mockResponse = new Response(
      JSON.stringify({
        id: "msg004",
        channel_id: "channel456",
        content: shortMessage,
        timestamp: "2021-01-01T00:00:00.000Z",
        author: { id: "test-app-id", username: "bot" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    await adapter.postMessage("discord:guild1:channel456", shortMessage);

    const calledPayload = spy.mock.calls[0]?.[2] as { content?: string };
    expect(calledPayload.content).toBe(shortMessage);

    spy.mockRestore();
  });
});

// ============================================================================
// editMessage Tests
// ============================================================================

describe("editMessage", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("edits a message with PATCH", async () => {
    const mockResponse = new Response(
      JSON.stringify({
        id: "msg001",
        channel_id: "channel456",
        content: "Updated content",
        timestamp: "2021-01-01T00:00:00.000Z",
        author: { id: "test-app-id", username: "bot" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    const result = await adapter.editMessage(
      "discord:guild1:channel456",
      "msg001",
      "Updated content"
    );

    expect(result.id).toBe("msg001");
    expect(result.threadId).toBe("discord:guild1:channel456");
    expect(spy).toHaveBeenCalledWith(
      "/channels/channel456/messages/msg001",
      "PATCH",
      expect.objectContaining({ content: expect.any(String) })
    );

    spy.mockRestore();
  });

  it("edits a message in a thread channel", async () => {
    const mockResponse = new Response(
      JSON.stringify({
        id: "msg002",
        channel_id: "thread789",
        content: "Edited thread reply",
        timestamp: "2021-01-01T00:00:00.000Z",
        author: { id: "test-app-id", username: "bot" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    const result = await adapter.editMessage(
      "discord:guild1:channel456:thread789",
      "msg002",
      "Edited thread reply"
    );

    expect(result.id).toBe("msg002");
    // Should use thread channel ID, not parent
    expect(spy).toHaveBeenCalledWith(
      "/channels/thread789/messages/msg002",
      "PATCH",
      expect.objectContaining({ content: expect.any(String) })
    );

    spy.mockRestore();
  });

  it("truncates content exceeding 2000 characters on edit", async () => {
    const longMessage = "b".repeat(2500);
    const mockResponse = new Response(
      JSON.stringify({
        id: "msg003",
        channel_id: "channel456",
        content: "truncated",
        timestamp: "2021-01-01T00:00:00.000Z",
        author: { id: "test-app-id", username: "bot" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    await adapter.editMessage(
      "discord:guild1:channel456",
      "msg003",
      longMessage
    );

    const calledPayload = spy.mock.calls[0]?.[2] as { content?: string };
    expect(calledPayload.content?.length).toBeLessThanOrEqual(2000);
    expect(calledPayload.content?.endsWith("...")).toBe(true);

    spy.mockRestore();
  });
});

// ============================================================================
// deleteMessage Tests
// ============================================================================

describe("deleteMessage", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("deletes a message", async () => {
    const mockResponse = new Response(null, { status: 204 });
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    await adapter.deleteMessage("discord:guild1:channel456", "msg001");

    expect(spy).toHaveBeenCalledWith(
      "/channels/channel456/messages/msg001",
      "DELETE"
    );

    spy.mockRestore();
  });

  it("deletes a message in a thread", async () => {
    const mockResponse = new Response(null, { status: 204 });
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    await adapter.deleteMessage(
      "discord:guild1:channel456:thread789",
      "msg002"
    );

    expect(spy).toHaveBeenCalledWith(
      "/channels/thread789/messages/msg002",
      "DELETE"
    );

    spy.mockRestore();
  });
});

// ============================================================================
// Reaction Tests
// ============================================================================

describe("addReaction", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("adds a reaction to a message", async () => {
    const mockResponse = new Response(null, { status: 204 });
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    await adapter.addReaction(
      "discord:guild1:channel456",
      "msg001",
      "thumbs_up"
    );

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining(
        "/channels/channel456/messages/msg001/reactions/"
      ),
      "PUT"
    );
    // Should end with /@me
    expect(spy.mock.calls[0]?.[0]).toMatch(AT_ME_REGEX);

    spy.mockRestore();
  });

  it("adds a reaction in a thread", async () => {
    const mockResponse = new Response(null, { status: 204 });
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    await adapter.addReaction(
      "discord:guild1:channel456:thread789",
      "msg001",
      "heart"
    );

    // Should use thread channel, not parent
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("/channels/thread789/messages/msg001/reactions/"),
      "PUT"
    );

    spy.mockRestore();
  });
});

describe("removeReaction", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("removes a reaction from a message", async () => {
    const mockResponse = new Response(null, { status: 204 });
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    await adapter.removeReaction(
      "discord:guild1:channel456",
      "msg001",
      "thumbs_up"
    );

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining(
        "/channels/channel456/messages/msg001/reactions/"
      ),
      "DELETE"
    );
    expect(spy.mock.calls[0]?.[0]).toMatch(AT_ME_REGEX);

    spy.mockRestore();
  });

  it("removes a reaction in a thread", async () => {
    const mockResponse = new Response(null, { status: 204 });
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    await adapter.removeReaction(
      "discord:guild1:channel456:thread789",
      "msg001",
      "fire"
    );

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("/channels/thread789/messages/msg001/reactions/"),
      "DELETE"
    );

    spy.mockRestore();
  });
});

// ============================================================================
// normalizeDiscordEmoji Tests
// ============================================================================

describe("normalizeDiscordEmoji", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("normalizes unicode thumbs up emoji", () => {
    const result = (adapter as any).normalizeDiscordEmoji("\u{1F44D}");
    expect(result).toBeDefined();
  });

  it("normalizes unicode heart emoji", () => {
    const result = (adapter as any).normalizeDiscordEmoji("\u2764\uFE0F");
    expect(result).toBeDefined();
  });

  it("normalizes heart without variation selector", () => {
    const result = (adapter as any).normalizeDiscordEmoji("\u2764");
    expect(result).toBeDefined();
  });

  it("normalizes unicode fire emoji", () => {
    const result = (adapter as any).normalizeDiscordEmoji("\u{1F525}");
    expect(result).toBeDefined();
  });

  it("passes through unknown emoji names", () => {
    const result = (adapter as any).normalizeDiscordEmoji("custom_emoji");
    expect(result).toBeDefined();
  });

  it("normalizes unicode rocket emoji", () => {
    const result = (adapter as any).normalizeDiscordEmoji("\u{1F680}");
    expect(result).toBeDefined();
  });

  it("normalizes eyes emoji", () => {
    const result = (adapter as any).normalizeDiscordEmoji("\u{1F440}");
    expect(result).toBeDefined();
  });
});

// ============================================================================
// encodeEmoji Tests
// ============================================================================

describe("encodeEmoji", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("URL-encodes emoji for API paths", () => {
    const result = (adapter as any).encodeEmoji("thumbs_up");
    // Should be URL-encoded
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("handles string emoji input", () => {
    const result = (adapter as any).encodeEmoji("fire");
    expect(typeof result).toBe("string");
  });
});

// ============================================================================
// truncateContent Tests
// ============================================================================

describe("truncateContent", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("returns content unchanged when within limit", () => {
    const result = (adapter as any).truncateContent("Hello world");
    expect(result).toBe("Hello world");
  });

  it("returns content unchanged at exactly 2000 chars", () => {
    const content = "x".repeat(2000);
    const result = (adapter as any).truncateContent(content);
    expect(result).toBe(content);
    expect(result.length).toBe(2000);
  });

  it("truncates content exceeding 2000 chars with ellipsis", () => {
    const content = "y".repeat(2500);
    const result = (adapter as any).truncateContent(content);
    expect(result.length).toBe(2000);
    expect(result.endsWith("...")).toBe(true);
    // First 1997 chars should be 'y'
    expect(result.slice(0, 1997)).toBe("y".repeat(1997));
  });

  it("truncates at exactly 2001 chars", () => {
    const content = "z".repeat(2001);
    const result = (adapter as any).truncateContent(content);
    expect(result.length).toBe(2000);
    expect(result.endsWith("...")).toBe(true);
  });

  it("handles empty string", () => {
    const result = (adapter as any).truncateContent("");
    expect(result).toBe("");
  });
});

// ============================================================================
// channelIdFromThreadId Tests
// ============================================================================

describe("channelIdFromThreadId", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("returns channel-level ID from thread ID", () => {
    const result = adapter.channelIdFromThreadId(
      "discord:guild1:channel456:thread789"
    );
    expect(result).toBe("discord:guild1:channel456");
  });

  it("returns as-is when already a channel ID (3 parts)", () => {
    const result = adapter.channelIdFromThreadId("discord:guild1:channel456");
    expect(result).toBe("discord:guild1:channel456");
  });

  it("handles DM channel IDs", () => {
    const result = adapter.channelIdFromThreadId("discord:@me:dm123");
    expect(result).toBe("discord:@me:dm123");
  });
});

// ============================================================================
// startTyping Tests
// ============================================================================

describe("startTyping", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("sends typing indicator to channel", async () => {
    const mockResponse = new Response(null, { status: 204 });
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    await adapter.startTyping("discord:guild1:channel456");

    expect(spy).toHaveBeenCalledWith("/channels/channel456/typing", "POST");

    spy.mockRestore();
  });

  it("sends typing indicator to thread channel", async () => {
    const mockResponse = new Response(null, { status: 204 });
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    await adapter.startTyping("discord:guild1:channel456:thread789");

    expect(spy).toHaveBeenCalledWith("/channels/thread789/typing", "POST");

    spy.mockRestore();
  });
});

// ============================================================================
// openDM Tests
// ============================================================================

describe("openDM", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("creates a DM channel and returns encoded thread ID", async () => {
    const mockResponse = new Response(
      JSON.stringify({
        id: "dm-channel-123",
        type: 1,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    const result = await adapter.openDM("user123");

    expect(result).toBe("discord:@me:dm-channel-123");
    expect(spy).toHaveBeenCalledWith("/users/@me/channels", "POST", {
      recipient_id: "user123",
    });

    spy.mockRestore();
  });
});

// ============================================================================
// fetchMessages Tests
// ============================================================================

describe("fetchMessages", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("fetches messages from a channel", async () => {
    const mockMessages = [
      {
        id: "msg3",
        channel_id: "channel456",
        content: "Third",
        timestamp: "2021-01-01T00:03:00.000Z",
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [],
        mention_roles: [],
        attachments: [],
        embeds: [],
        pinned: false,
        type: 0,
        author: {
          id: "user1",
          username: "testuser",
          discriminator: "0001",
        },
      },
      {
        id: "msg2",
        channel_id: "channel456",
        content: "Second",
        timestamp: "2021-01-01T00:02:00.000Z",
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [],
        mention_roles: [],
        attachments: [],
        embeds: [],
        pinned: false,
        type: 0,
        author: {
          id: "user1",
          username: "testuser",
          discriminator: "0001",
        },
      },
    ];
    const mockResponse = new Response(JSON.stringify(mockMessages), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    const result = await adapter.fetchMessages("discord:guild1:channel456", {
      limit: 2,
    });

    // Messages should be reversed to chronological order
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].id).toBe("msg2"); // Oldest first
    expect(result.messages[1].id).toBe("msg3"); // Newest second
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("/channels/channel456/messages?"),
      "GET"
    );

    spy.mockRestore();
  });

  it("fetches messages from a thread channel", async () => {
    const mockMessages = [
      {
        id: "msg1",
        channel_id: "thread789",
        content: "Thread msg",
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
        author: {
          id: "user1",
          username: "testuser",
          discriminator: "0001",
        },
      },
    ];
    const mockResponse = new Response(JSON.stringify(mockMessages), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    const result = await adapter.fetchMessages(
      "discord:guild1:channel456:thread789"
    );

    expect(result.messages).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("/channels/thread789/messages?"),
      "GET"
    );

    spy.mockRestore();
  });

  it("uses cursor for backward pagination", async () => {
    const mockResponse = new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    await adapter.fetchMessages("discord:guild1:channel456", {
      cursor: "msg100",
      direction: "backward",
    });

    const calledUrl = spy.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("before=msg100");

    spy.mockRestore();
  });

  it("uses cursor for forward pagination", async () => {
    const mockResponse = new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    await adapter.fetchMessages("discord:guild1:channel456", {
      cursor: "msg100",
      direction: "forward",
    });

    const calledUrl = spy.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("after=msg100");

    spy.mockRestore();
  });

  it("returns nextCursor when results match limit", async () => {
    const mockMessages = Array.from({ length: 10 }, (_, i) => ({
      id: `msg${i}`,
      channel_id: "channel456",
      content: `Message ${i}`,
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
      author: {
        id: "user1",
        username: "testuser",
        discriminator: "0001",
      },
    }));
    const mockResponse = new Response(JSON.stringify(mockMessages), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    const result = await adapter.fetchMessages("discord:guild1:channel456", {
      limit: 10,
    });

    // Should have a nextCursor since results === limit
    expect(result.nextCursor).toBeDefined();

    spy.mockRestore();
  });

  it("returns no nextCursor when results are fewer than limit", async () => {
    const mockMessages = [
      {
        id: "msg1",
        channel_id: "channel456",
        content: "Only one",
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
        author: {
          id: "user1",
          username: "testuser",
          discriminator: "0001",
        },
      },
    ];
    const mockResponse = new Response(JSON.stringify(mockMessages), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    const result = await adapter.fetchMessages("discord:guild1:channel456", {
      limit: 50,
    });

    expect(result.nextCursor).toBeUndefined();

    spy.mockRestore();
  });
});

// ============================================================================
// fetchChannelMessages Tests
// ============================================================================

describe("fetchChannelMessages", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("fetches channel-level messages", async () => {
    const mockMessages = [
      {
        id: "msg1",
        channel_id: "channel456",
        content: "Channel msg",
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
        author: {
          id: "user1",
          username: "testuser",
          discriminator: "0001",
        },
      },
    ];
    const mockResponse = new Response(JSON.stringify(mockMessages), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    const result = await adapter.fetchChannelMessages(
      "discord:guild1:channel456"
    );

    expect(result.messages).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("/channels/channel456/messages?"),
      "GET"
    );

    spy.mockRestore();
  });

  it("throws on invalid channel ID format", async () => {
    await expect(adapter.fetchChannelMessages("invalid")).rejects.toThrow(
      ValidationError
    );
  });

  it("uses cursor for backward pagination", async () => {
    const mockResponse = new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    await adapter.fetchChannelMessages("discord:guild1:channel456", {
      cursor: "msg50",
      direction: "backward",
    });

    const calledUrl = spy.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("before=msg50");

    spy.mockRestore();
  });

  it("uses cursor for forward pagination", async () => {
    const mockResponse = new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    await adapter.fetchChannelMessages("discord:guild1:channel456", {
      cursor: "msg50",
      direction: "forward",
    });

    const calledUrl = spy.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("after=msg50");

    spy.mockRestore();
  });
});

// ============================================================================
// fetchChannelInfo Tests
// ============================================================================

describe("fetchChannelInfo", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("fetches channel info for a guild text channel", async () => {
    const mockResponse = new Response(
      JSON.stringify({
        id: "channel456",
        name: "general",
        type: 0, // GuildText
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    const result = await adapter.fetchChannelInfo("discord:guild1:channel456");

    expect(result.id).toBe("discord:guild1:channel456");
    expect(result.name).toBe("general");
    expect(result.isDM).toBe(false);
    expect(spy).toHaveBeenCalledWith("/channels/channel456", "GET");

    spy.mockRestore();
  });

  it("fetches channel info for a DM", async () => {
    const mockResponse = new Response(
      JSON.stringify({
        id: "dm123",
        type: 1, // DM
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    const result = await adapter.fetchChannelInfo("discord:@me:dm123");

    expect(result.isDM).toBe(true);

    spy.mockRestore();
  });

  it("throws on invalid channel ID", async () => {
    await expect(adapter.fetchChannelInfo("invalid")).rejects.toThrow(
      ValidationError
    );
  });

  it("includes member count when available", async () => {
    const mockResponse = new Response(
      JSON.stringify({
        id: "channel456",
        name: "general",
        type: 0,
        member_count: 42,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    const result = await adapter.fetchChannelInfo("discord:guild1:channel456");

    expect(result.memberCount).toBe(42);

    spy.mockRestore();
  });
});

// ============================================================================
// postChannelMessage Tests
// ============================================================================

describe("postChannelMessage", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("posts a message to a channel", async () => {
    const mockResponse = new Response(
      JSON.stringify({
        id: "msg001",
        channel_id: "channel456",
        content: "Channel message",
        timestamp: "2021-01-01T00:00:00.000Z",
        author: { id: "test-app-id", username: "bot" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    const result = await adapter.postChannelMessage(
      "discord:guild1:channel456",
      "Channel message"
    );

    expect(result.id).toBe("msg001");
    expect(result.threadId).toBe("discord:guild1:channel456");
    expect(spy).toHaveBeenCalledWith(
      "/channels/channel456/messages",
      "POST",
      expect.objectContaining({ content: expect.any(String) })
    );

    spy.mockRestore();
  });

  it("throws on invalid channel ID", async () => {
    await expect(
      adapter.postChannelMessage("invalid", "Hello")
    ).rejects.toThrow(ValidationError);
  });

  it("truncates long content", async () => {
    const longMessage = "c".repeat(2500);
    const mockResponse = new Response(
      JSON.stringify({
        id: "msg002",
        channel_id: "channel456",
        content: "truncated",
        timestamp: "2021-01-01T00:00:00.000Z",
        author: { id: "test-app-id", username: "bot" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    await adapter.postChannelMessage("discord:guild1:channel456", longMessage);

    const calledPayload = spy.mock.calls[0]?.[2] as { content?: string };
    expect(calledPayload.content?.length).toBeLessThanOrEqual(2000);

    spy.mockRestore();
  });
});

// ============================================================================
// listThreads Tests
// ============================================================================

describe("listThreads", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("lists active and archived threads", async () => {
    const activeThreadsResponse = new Response(
      JSON.stringify({
        threads: [
          {
            id: "thread1",
            name: "Thread 1",
            parent_id: "channel456",
            message_count: 5,
            total_message_sent: 5,
          },
          {
            id: "thread2",
            name: "Thread 2",
            parent_id: "channel456",
            total_message_sent: 3,
          },
          {
            id: "thread_other",
            name: "Other Channel Thread",
            parent_id: "other_channel",
            total_message_sent: 1,
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

    const archivedThreadsResponse = new Response(
      JSON.stringify({
        threads: [
          {
            id: "thread3",
            name: "Archived Thread",
            parent_id: "channel456",
            total_message_sent: 10,
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

    const threadMsgResponse = new Response(
      JSON.stringify([
        {
          id: "root-msg",
          channel_id: "thread1",
          content: "Root message",
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
          author: {
            id: "user1",
            username: "testuser",
            discriminator: "0001",
          },
        },
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

    const spy = vi.spyOn(adapter as any, "discordFetch");
    spy.mockImplementation((path: string) => {
      if (path.includes("/guilds/")) {
        return Promise.resolve(activeThreadsResponse.clone());
      }
      if (path.includes("/threads/archived/")) {
        return Promise.resolve(archivedThreadsResponse.clone());
      }
      // Individual thread message fetches
      return Promise.resolve(threadMsgResponse.clone());
    });

    const result = await adapter.listThreads("discord:guild1:channel456");

    // Should include 2 active threads + 1 archived = 3 (filtered by parent_id)
    expect(result.threads).toHaveLength(3);

    spy.mockRestore();
  });

  it("deduplicates threads that appear in both active and archived", async () => {
    const activeThreadsResponse = new Response(
      JSON.stringify({
        threads: [
          {
            id: "thread1",
            name: "Thread 1",
            parent_id: "channel456",
            total_message_sent: 5,
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

    // Same thread appears in archived
    const archivedThreadsResponse = new Response(
      JSON.stringify({
        threads: [
          {
            id: "thread1",
            name: "Thread 1",
            parent_id: "channel456",
            total_message_sent: 5,
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

    const threadMsgResponse = new Response(
      JSON.stringify([
        {
          id: "root-msg",
          channel_id: "thread1",
          content: "Root message",
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
          author: {
            id: "user1",
            username: "testuser",
            discriminator: "0001",
          },
        },
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

    const spy = vi.spyOn(adapter as any, "discordFetch");
    spy.mockImplementation((path: string) => {
      if (path.includes("/guilds/")) {
        return Promise.resolve(activeThreadsResponse.clone());
      }
      if (path.includes("/threads/archived/")) {
        return Promise.resolve(archivedThreadsResponse.clone());
      }
      return Promise.resolve(threadMsgResponse.clone());
    });

    const result = await adapter.listThreads("discord:guild1:channel456");

    // Should only have 1 thread (deduplicated)
    expect(result.threads).toHaveLength(1);

    spy.mockRestore();
  });

  it("uses referenced_message when thread root is a THREAD_STARTER_MESSAGE", async () => {
    const activeThreadsResponse = new Response(
      JSON.stringify({
        threads: [
          {
            id: "thread1",
            name: "Thread 1",
            parent_id: "channel456",
            total_message_sent: 5,
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

    const archivedThreadsResponse = new Response(
      JSON.stringify({ threads: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

    const threadMsgResponse = new Response(
      JSON.stringify([
        {
          id: "starter-msg",
          channel_id: "thread1",
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
          type: 21,
          author: {
            id: "system",
            username: "system",
            discriminator: "0000",
            bot: true,
          },
          message_reference: {
            message_id: "parent-msg",
            channel_id: "channel456",
            guild_id: "guild1",
          },
          referenced_message: {
            id: "parent-msg",
            channel_id: "channel456",
            guild_id: "guild1",
            content: "Parent root content",
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
            author: {
              id: "user1",
              username: "testuser",
              discriminator: "0001",
            },
          },
        },
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

    const spy = vi.spyOn(adapter as any, "discordFetch");
    spy.mockImplementation((path: string) => {
      if (path.includes("/guilds/")) {
        return Promise.resolve(activeThreadsResponse.clone());
      }
      if (path.includes("/threads/archived/")) {
        return Promise.resolve(archivedThreadsResponse.clone());
      }
      return Promise.resolve(threadMsgResponse.clone());
    });

    const result = await adapter.listThreads("discord:guild1:channel456");

    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].rootMessage.id).toBe("parent-msg");
    expect(result.threads[0].rootMessage.text).toBe("Parent root content");

    spy.mockRestore();
  });

  it("throws on invalid channel ID", async () => {
    await expect(adapter.listThreads("invalid")).rejects.toThrow(
      ValidationError
    );
  });

  it("applies limit to thread results", async () => {
    const threads = Array.from({ length: 5 }, (_, i) => ({
      id: `thread${i}`,
      name: `Thread ${i}`,
      parent_id: "channel456",
      total_message_sent: i,
    }));

    const activeThreadsResponse = new Response(JSON.stringify({ threads }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    const archivedThreadsResponse = new Response(
      JSON.stringify({ threads: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

    const threadMsgResponse = new Response(
      JSON.stringify([
        {
          id: "root-msg",
          channel_id: "thread0",
          content: "Root",
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
          author: {
            id: "user1",
            username: "testuser",
            discriminator: "0001",
          },
        },
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

    const spy = vi.spyOn(adapter as any, "discordFetch");
    spy.mockImplementation((path: string) => {
      if (path.includes("/guilds/")) {
        return Promise.resolve(activeThreadsResponse.clone());
      }
      if (path.includes("/threads/archived/")) {
        return Promise.resolve(archivedThreadsResponse.clone());
      }
      return Promise.resolve(threadMsgResponse.clone());
    });

    const result = await adapter.listThreads("discord:guild1:channel456", {
      limit: 2,
    });

    expect(result.threads).toHaveLength(2);
    expect(result.nextCursor).toBeDefined();

    spy.mockRestore();
  });

  it("creates placeholder when root message fetch fails", async () => {
    const activeThreadsResponse = new Response(
      JSON.stringify({
        threads: [
          {
            id: "thread1",
            name: "Thread 1",
            parent_id: "channel456",
            total_message_sent: 5,
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

    const archivedThreadsResponse = new Response(
      JSON.stringify({ threads: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

    const spy = vi.spyOn(adapter as any, "discordFetch");
    spy.mockImplementation((path: string) => {
      if (path.includes("/guilds/")) {
        return Promise.resolve(activeThreadsResponse.clone());
      }
      if (path.includes("/threads/archived/")) {
        return Promise.resolve(archivedThreadsResponse.clone());
      }
      // Fail when fetching thread messages
      return Promise.reject(new Error("Failed to fetch"));
    });

    const result = await adapter.listThreads("discord:guild1:channel456");

    expect(result.threads).toHaveLength(1);
    // Placeholder should use thread name as text
    expect(result.threads[0].rootMessage.text).toBe("Thread 1");
    expect(result.threads[0].replyCount).toBe(5);

    spy.mockRestore();
  });
});

// ============================================================================
// fetchThread Tests
// ============================================================================

describe("fetchThread", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("fetches thread info for a guild channel", async () => {
    const mockResponse = new Response(
      JSON.stringify({
        id: "channel456",
        name: "general",
        type: 0, // GuildText
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    const result = await adapter.fetchThread("discord:guild1:channel456");

    expect(result.id).toBe("discord:guild1:channel456");
    expect(result.channelId).toBe("channel456");
    expect(result.channelName).toBe("general");
    expect(result.isDM).toBe(false);
    expect(result.metadata?.guildId).toBe("guild1");

    spy.mockRestore();
  });

  it("fetches thread info for a DM channel", async () => {
    const mockResponse = new Response(
      JSON.stringify({
        id: "dm123",
        type: 1, // DM
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    const result = await adapter.fetchThread("discord:@me:dm123");

    expect(result.isDM).toBe(true);

    spy.mockRestore();
  });

  it("fetches thread info for a GroupDM", async () => {
    const mockResponse = new Response(
      JSON.stringify({
        id: "gdm123",
        name: "Group Chat",
        type: 3, // GroupDM
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const spy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(mockResponse);

    const result = await adapter.fetchThread("discord:@me:gdm123");

    expect(result.isDM).toBe(true);
    expect(result.channelName).toBe("Group Chat");

    spy.mockRestore();
  });
});

// ============================================================================
// Forwarded Gateway Event Tests
// ============================================================================

describe("handleWebhook - forwarded gateway events", () => {
  const adapter = createDiscordAdapter({
    botToken: "test-token",
    publicKey: testPublicKey,
    applicationId: "test-app-id",
    logger: mockLogger,
  });

  it("rejects forwarded events with invalid gateway token", async () => {
    const body = JSON.stringify({
      type: "GATEWAY_MESSAGE_CREATE",
      timestamp: Date.now(),
      data: {},
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-discord-gateway-token": "wrong-token",
        "content-type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("accepts forwarded events with valid gateway token", async () => {
    const body = JSON.stringify({
      type: "GATEWAY_UNKNOWN_EVENT",
      timestamp: Date.now(),
      data: {},
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-discord-gateway-token": "test-token",
        "content-type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("returns 400 for invalid JSON in forwarded events", async () => {
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-discord-gateway-token": "test-token",
        "content-type": "application/json",
      },
      body: "not-json",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });

  it("handles GATEWAY_MESSAGE_CREATE event", async () => {
    const processMessage = vi.fn();
    await adapter.initialize({
      handleIncomingMessage: processMessage,
      processSlashCommand: vi.fn(),
      processAction: vi.fn(),
      processReaction: vi.fn(),
    } as unknown as ChatInstance);

    const body = JSON.stringify({
      type: "GATEWAY_MESSAGE_CREATE",
      timestamp: Date.now(),
      data: {
        id: "msg123",
        channel_id: "channel456",
        guild_id: "guild1",
        content: "Hello from gateway",
        timestamp: "2021-01-01T00:00:00.000Z",
        author: {
          id: "user789",
          username: "testuser",
          bot: false,
        },
        mentions: [],
        attachments: [],
      },
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-discord-gateway-token": "test-token",
        "content-type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(processMessage).toHaveBeenCalled();
  });

  it("handles GATEWAY_MESSAGE_REACTION_ADD event", async () => {
    const processReaction = vi.fn();
    await adapter.initialize({
      handleIncomingMessage: vi.fn(),
      processSlashCommand: vi.fn(),
      processAction: vi.fn(),
      processReaction,
    } as unknown as ChatInstance);

    const body = JSON.stringify({
      type: "GATEWAY_MESSAGE_REACTION_ADD",
      timestamp: Date.now(),
      data: {
        user_id: "user789",
        channel_id: "channel456",
        message_id: "msg123",
        guild_id: "guild1",
        emoji: { name: "\u{1F44D}", id: null },
        member: {
          user: {
            id: "user789",
            username: "testuser",
          },
        },
      },
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-discord-gateway-token": "test-token",
        "content-type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(processReaction).toHaveBeenCalledWith(
      expect.objectContaining({
        added: true,
        messageId: "msg123",
      })
    );
  });

  it("handles GATEWAY_MESSAGE_REACTION_REMOVE event", async () => {
    const processReaction = vi.fn();
    await adapter.initialize({
      handleIncomingMessage: vi.fn(),
      processSlashCommand: vi.fn(),
      processAction: vi.fn(),
      processReaction,
    } as unknown as ChatInstance);

    const body = JSON.stringify({
      type: "GATEWAY_MESSAGE_REACTION_REMOVE",
      timestamp: Date.now(),
      data: {
        user_id: "user789",
        channel_id: "channel456",
        message_id: "msg123",
        guild_id: "guild1",
        emoji: { name: "\u2764\uFE0F", id: null },
        member: {
          user: {
            id: "user789",
            username: "testuser",
          },
        },
      },
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-discord-gateway-token": "test-token",
        "content-type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(processReaction).toHaveBeenCalledWith(
      expect.objectContaining({
        added: false,
        messageId: "msg123",
      })
    );
  });
});

// ============================================================================
// handleForwardedMessage - thread detection Tests
// ============================================================================

describe("handleForwardedMessage - thread handling", () => {
  it("uses thread info when provided in data", async () => {
    const adapter = createDiscordAdapter({
      botToken: "test-token",
      publicKey: testPublicKey,
      applicationId: "test-app-id",
      logger: mockLogger,
    });

    const handleIncomingMessage = vi.fn();
    await adapter.initialize({
      handleIncomingMessage,
      processSlashCommand: vi.fn(),
      processAction: vi.fn(),
      processReaction: vi.fn(),
    } as unknown as ChatInstance);

    const body = JSON.stringify({
      type: "GATEWAY_MESSAGE_CREATE",
      timestamp: Date.now(),
      data: {
        id: "msg123",
        channel_id: "thread789",
        guild_id: "guild1",
        content: "Thread message",
        timestamp: "2021-01-01T00:00:00.000Z",
        author: {
          id: "user789",
          username: "testuser",
          bot: false,
        },
        mentions: [],
        attachments: [],
        thread: {
          id: "thread789",
          parent_id: "channel456",
        },
      },
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-discord-gateway-token": "test-token",
        "content-type": "application/json",
      },
      body,
    });

    await adapter.handleWebhook(request);

    expect(handleIncomingMessage).toHaveBeenCalledWith(
      adapter,
      "discord:guild1:channel456:thread789",
      expect.anything()
    );
  });

  it("detects thread by channel_type and fetches parent", async () => {
    const adapter = createDiscordAdapter({
      botToken: "test-token",
      publicKey: testPublicKey,
      applicationId: "test-app-id",
      logger: mockLogger,
    });

    const handleIncomingMessage = vi.fn();
    await adapter.initialize({
      handleIncomingMessage,
      processSlashCommand: vi.fn(),
      processAction: vi.fn(),
      processReaction: vi.fn(),
    } as unknown as ChatInstance);

    // Mock discordFetch to return parent channel info
    const fetchSpy = vi.spyOn(adapter as any, "discordFetch").mockResolvedValue(
      new Response(JSON.stringify({ parent_id: "channel456" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const body = JSON.stringify({
      type: "GATEWAY_MESSAGE_CREATE",
      timestamp: Date.now(),
      data: {
        id: "msg123",
        channel_id: "thread789",
        guild_id: "guild1",
        channel_type: 11, // Public thread
        content: "Thread message via channel_type",
        timestamp: "2021-01-01T00:00:00.000Z",
        author: {
          id: "user789",
          username: "testuser",
          bot: false,
        },
        mentions: [],
        attachments: [],
      },
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-discord-gateway-token": "test-token",
        "content-type": "application/json",
      },
      body,
    });

    await adapter.handleWebhook(request);

    expect(fetchSpy).toHaveBeenCalledWith("/channels/thread789", "GET");
    expect(handleIncomingMessage).toHaveBeenCalledWith(
      adapter,
      "discord:guild1:channel456:thread789",
      expect.anything()
    );

    fetchSpy.mockRestore();
  });

  it("creates thread when mentioned and not in a thread", async () => {
    const adapter = createDiscordAdapter({
      botToken: "test-token",
      publicKey: testPublicKey,
      applicationId: "test-app-id",
      logger: mockLogger,
    });

    const handleIncomingMessage = vi.fn();
    await adapter.initialize({
      handleIncomingMessage,
      processSlashCommand: vi.fn(),
      processAction: vi.fn(),
      processReaction: vi.fn(),
    } as unknown as ChatInstance);

    const fetchSpy = vi
      .spyOn(adapter as any, "discordFetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ id: "new-thread-id", name: "New Thread" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const body = JSON.stringify({
      type: "GATEWAY_MESSAGE_CREATE",
      timestamp: Date.now(),
      data: {
        id: "msg123",
        channel_id: "channel456",
        guild_id: "guild1",
        content: "Hey bot",
        timestamp: "2021-01-01T00:00:00.000Z",
        author: {
          id: "user789",
          username: "testuser",
          bot: false,
        },
        is_mention: true,
        mentions: [{ id: "test-app-id", username: "bot" }],
        attachments: [],
      },
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-discord-gateway-token": "test-token",
        "content-type": "application/json",
      },
      body,
    });

    await adapter.handleWebhook(request);

    // Should have created a thread
    expect(fetchSpy).toHaveBeenCalledWith(
      "/channels/channel456/messages/msg123/threads",
      "POST",
      expect.objectContaining({ auto_archive_duration: 1440 })
    );

    fetchSpy.mockRestore();
  });
});

// ============================================================================
// handleForwardedReaction - thread parent cache Tests
// ============================================================================

describe("handleForwardedReaction - thread parent caching", () => {
  it("fetches and caches thread parent for thread reactions", async () => {
    const adapter = createDiscordAdapter({
      botToken: "test-token",
      publicKey: testPublicKey,
      applicationId: "test-app-id",
      logger: mockLogger,
    });

    const processReaction = vi.fn();
    await adapter.initialize({
      handleIncomingMessage: vi.fn(),
      processSlashCommand: vi.fn(),
      processAction: vi.fn(),
      processReaction,
    } as unknown as ChatInstance);

    const fetchSpy = vi.spyOn(adapter as any, "discordFetch").mockResolvedValue(
      new Response(JSON.stringify({ parent_id: "channel456" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    // First reaction in a thread - should fetch parent
    const body1 = JSON.stringify({
      type: "GATEWAY_MESSAGE_REACTION_ADD",
      timestamp: Date.now(),
      data: {
        user_id: "user789",
        channel_id: "thread789",
        message_id: "msg123",
        guild_id: "guild1",
        channel_type: 11, // Public thread
        emoji: { name: "\u{1F44D}", id: null },
        member: {
          user: { id: "user789", username: "testuser" },
        },
      },
    });

    const request1 = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-discord-gateway-token": "test-token",
        "content-type": "application/json",
      },
      body: body1,
    });

    await adapter.handleWebhook(request1);

    // Should have fetched parent channel
    expect(fetchSpy).toHaveBeenCalledWith("/channels/thread789", "GET");
    expect(processReaction).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "discord:guild1:channel456:thread789",
      })
    );

    fetchSpy.mockClear();
    processReaction.mockClear();

    // Second reaction on same thread - should use cache
    const body2 = JSON.stringify({
      type: "GATEWAY_MESSAGE_REACTION_ADD",
      timestamp: Date.now(),
      data: {
        user_id: "user789",
        channel_id: "thread789",
        message_id: "msg456",
        guild_id: "guild1",
        channel_type: 11,
        emoji: { name: "\u{1F525}", id: null },
        member: {
          user: { id: "user789", username: "testuser" },
        },
      },
    });

    const request2 = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-discord-gateway-token": "test-token",
        "content-type": "application/json",
      },
      body: body2,
    });

    await adapter.handleWebhook(request2);

    // Should NOT have fetched again (used cache)
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(processReaction).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "discord:guild1:channel456:thread789",
      })
    );

    fetchSpy.mockRestore();
  });

  it("handles missing user info in reaction event gracefully", async () => {
    const adapter = createDiscordAdapter({
      botToken: "test-token",
      publicKey: testPublicKey,
      applicationId: "test-app-id",
      logger: mockLogger,
    });

    const processReaction = vi.fn();
    await adapter.initialize({
      handleIncomingMessage: vi.fn(),
      processSlashCommand: vi.fn(),
      processAction: vi.fn(),
      processReaction,
    } as unknown as ChatInstance);

    const body = JSON.stringify({
      type: "GATEWAY_MESSAGE_REACTION_ADD",
      timestamp: Date.now(),
      data: {
        user_id: "user789",
        channel_id: "channel456",
        message_id: "msg123",
        guild_id: "guild1",
        emoji: { name: "\u{1F44D}", id: null },
        // No member or user field
      },
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-discord-gateway-token": "test-token",
        "content-type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    // Should not call processReaction since there's no user info
    expect(processReaction).not.toHaveBeenCalled();
  });

  it("handles custom emoji with ID in reaction", async () => {
    const adapter = createDiscordAdapter({
      botToken: "test-token",
      publicKey: testPublicKey,
      applicationId: "test-app-id",
      logger: mockLogger,
    });

    const processReaction = vi.fn();
    await adapter.initialize({
      handleIncomingMessage: vi.fn(),
      processSlashCommand: vi.fn(),
      processAction: vi.fn(),
      processReaction,
    } as unknown as ChatInstance);

    const body = JSON.stringify({
      type: "GATEWAY_MESSAGE_REACTION_ADD",
      timestamp: Date.now(),
      data: {
        user_id: "user789",
        channel_id: "channel456",
        message_id: "msg123",
        guild_id: "guild1",
        emoji: { name: "custom_emoji", id: "emoji123" },
        member: {
          user: { id: "user789", username: "testuser" },
        },
      },
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-discord-gateway-token": "test-token",
        "content-type": "application/json",
      },
      body,
    });

    await adapter.handleWebhook(request);

    expect(processReaction).toHaveBeenCalledWith(
      expect.objectContaining({
        rawEmoji: "<:custom_emoji:emoji123>",
      })
    );
  });
});

// ============================================================================
// initialize Tests
// ============================================================================

describe("initialize", () => {
  it("stores chat instance reference", async () => {
    const adapter = createDiscordAdapter({
      botToken: "test-token",
      publicKey: testPublicKey,
      applicationId: "test-app-id",
      logger: mockLogger,
    });

    const mockChat = {
      handleIncomingMessage: vi.fn(),
      processSlashCommand: vi.fn(),
      processAction: vi.fn(),
      processReaction: vi.fn(),
    } as unknown as ChatInstance;

    await adapter.initialize(mockChat);

    // Verify it can handle webhooks after initialization
    const body = JSON.stringify({
      type: "GATEWAY_MESSAGE_CREATE",
      timestamp: Date.now(),
      data: {
        id: "msg1",
        channel_id: "ch1",
        guild_id: "g1",
        content: "test",
        timestamp: "2021-01-01T00:00:00.000Z",
        author: { id: "u1", username: "user", bot: false },
        mentions: [],
        attachments: [],
      },
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-discord-gateway-token": "test-token",
        "content-type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(mockChat.handleIncomingMessage).toHaveBeenCalled();
  });
});

// ============================================================================
// Component Interaction Edge Cases
// ============================================================================

describe("handleWebhook - component interaction edge cases", () => {
  it("handles thread context in button interaction", async () => {
    const adapter = createDiscordAdapter({
      botToken: "test-token",
      publicKey: testPublicKey,
      applicationId: "test-app-id",
      logger: mockLogger,
    });

    const processAction = vi.fn();
    await adapter.initialize({
      handleIncomingMessage: vi.fn(),
      processSlashCommand: vi.fn(),
      processAction,
      processReaction: vi.fn(),
    } as unknown as ChatInstance);

    const body = JSON.stringify({
      type: InteractionType.MessageComponent,
      id: "interaction123",
      application_id: "test-app-id",
      token: "interaction-token",
      version: 1,
      guild_id: "guild123",
      channel_id: "thread456",
      channel: {
        id: "thread456",
        type: 11, // Public thread
        parent_id: "channel789",
      },
      member: {
        user: {
          id: "user789",
          username: "testuser",
          discriminator: "0001",
          global_name: "Test User",
        },
        roles: [],
        joined_at: "2021-01-01T00:00:00.000Z",
      },
      message: {
        id: "message123",
        channel_id: "thread456",
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

    await adapter.handleWebhook(request);

    expect(processAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: "approve_btn",
        threadId: "discord:guild123:channel789:thread456",
      }),
      undefined
    );
  });

  it("handles slash command in a thread", async () => {
    const adapter = createDiscordAdapter({
      botToken: "test-token",
      publicKey: testPublicKey,
      applicationId: "test-app-id",
      logger: mockLogger,
    });

    const processSlashCommand = vi.fn();
    await adapter.initialize({
      handleIncomingMessage: vi.fn(),
      processSlashCommand,
      processAction: vi.fn(),
      processReaction: vi.fn(),
    } as unknown as ChatInstance);

    const body = JSON.stringify({
      type: InteractionType.ApplicationCommand,
      id: "interaction123",
      application_id: "test-app-id",
      token: "interaction-token",
      version: 1,
      guild_id: "guild123",
      channel_id: "thread456",
      channel: {
        id: "thread456",
        type: 11,
        parent_id: "channel789",
      },
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
        name: "status",
        type: 1,
      },
    });
    const request = createWebhookRequest(body);

    await adapter.handleWebhook(request);

    expect(processSlashCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "/status",
        channelId: "discord:guild123:channel789:thread456",
      }),
      undefined
    );
  });
});

// ============================================================================
// DM forwarded message Tests
// ============================================================================

describe("handleForwardedMessage - DM messages", () => {
  it("handles DM messages (no guild_id)", async () => {
    const adapter = createDiscordAdapter({
      botToken: "test-token",
      publicKey: testPublicKey,
      applicationId: "test-app-id",
      logger: mockLogger,
    });

    const handleIncomingMessage = vi.fn();
    await adapter.initialize({
      handleIncomingMessage,
      processSlashCommand: vi.fn(),
      processAction: vi.fn(),
      processReaction: vi.fn(),
    } as unknown as ChatInstance);

    const body = JSON.stringify({
      type: "GATEWAY_MESSAGE_CREATE",
      timestamp: Date.now(),
      data: {
        id: "msg123",
        channel_id: "dm456",
        guild_id: null,
        content: "DM message",
        timestamp: "2021-01-01T00:00:00.000Z",
        author: {
          id: "user789",
          username: "testuser",
          bot: false,
        },
        mentions: [],
        attachments: [],
      },
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-discord-gateway-token": "test-token",
        "content-type": "application/json",
      },
      body,
    });

    await adapter.handleWebhook(request);

    expect(handleIncomingMessage).toHaveBeenCalledWith(
      adapter,
      "discord:@me:dm456",
      expect.anything()
    );
  });
});

// ============================================================================
// mentionRoleIds Tests
// ============================================================================

describe("mentionRoleIds handling", () => {
  it("detects mention via role ID", async () => {
    const adapter = createDiscordAdapter({
      botToken: "test-token",
      publicKey: testPublicKey,
      applicationId: "test-app-id",
      logger: mockLogger,
      mentionRoleIds: ["role123"],
    });

    const handleIncomingMessage = vi.fn();
    const fetchSpy = vi.spyOn(adapter as any, "discordFetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "new-thread", name: "Thread" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await adapter.initialize({
      handleIncomingMessage,
      processSlashCommand: vi.fn(),
      processAction: vi.fn(),
      processReaction: vi.fn(),
    } as unknown as ChatInstance);

    const body = JSON.stringify({
      type: "GATEWAY_MESSAGE_CREATE",
      timestamp: Date.now(),
      data: {
        id: "msg123",
        channel_id: "channel456",
        guild_id: "guild1",
        content: "Hey team",
        timestamp: "2021-01-01T00:00:00.000Z",
        author: {
          id: "user789",
          username: "testuser",
          bot: false,
        },
        mentions: [],
        mention_roles: ["role123"],
        attachments: [],
      },
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-discord-gateway-token": "test-token",
        "content-type": "application/json",
      },
      body,
    });

    await adapter.handleWebhook(request);

    // Should create a thread because of role mention
    expect(fetchSpy).toHaveBeenCalledWith(
      "/channels/channel456/messages/msg123/threads",
      "POST",
      expect.anything()
    );

    fetchSpy.mockRestore();
  });
});
