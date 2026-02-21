/**
 * Discord test utilities for creating mock API, interactions, and webhook requests.
 */

import { generateKeyPairSync, sign } from "node:crypto";
import { InteractionType } from "discord-api-types/v10";
import { vi } from "vitest";

// Generate an Ed25519 keypair for testing using Node.js crypto
const testKeyPair = generateKeyPairSync("ed25519");
const testPublicKeyDer = testKeyPair.publicKey.export({
  type: "spki",
  format: "der",
});
// Extract raw 32-byte public key from DER format (skip the 12-byte header)
export const DISCORD_PUBLIC_KEY = testPublicKeyDer.subarray(12).toString("hex");
export const DISCORD_BOT_TOKEN = "test-bot-token";
export const DISCORD_APPLICATION_ID = "APP123456";
const DISCORD_BOT_USER_ID = "BOT_USER_123";
export const DISCORD_BOT_USERNAME = "testbot";

/**
 * Create a valid Ed25519 signature for Discord webhook verification.
 */
function createDiscordSignature(body: string, timestamp: string): string {
  const message = timestamp + body;
  const signature = sign(null, Buffer.from(message), testKeyPair.privateKey);
  return signature.toString("hex");
}

/**
 * Options for creating a Discord interaction
 */
export interface DiscordInteractionOptions {
  channelId?: string;
  commandName?: string;
  customId?: string;
  globalName?: string;
  guildId?: string;
  id?: string;
  messageContent?: string;
  messageId?: string;
  token?: string;
  type: InteractionType;
  userId?: string;
  userName?: string;
}

/**
 * Create a Discord interaction payload
 */
export function createDiscordInteraction(options: DiscordInteractionOptions) {
  const {
    type,
    id = `interaction_${Date.now()}`,
    token = "interaction_token_123",
    guildId = "GUILD123",
    channelId = "CHANNEL456",
    userId = "USER789",
    userName = "testuser",
    globalName = "Test User",
    customId,
    messageId,
    messageContent,
    commandName,
  } = options;

  const interaction: Record<string, unknown> = {
    id,
    type,
    application_id: DISCORD_APPLICATION_ID,
    token,
    version: 1,
  };

  // Add guild and channel for non-DM interactions
  if (guildId !== "@me") {
    interaction.guild_id = guildId;
  }
  interaction.channel_id = channelId;

  // Add user info (member for guild, user for DM)
  if (guildId !== "@me") {
    interaction.member = {
      user: {
        id: userId,
        username: userName,
        discriminator: "0",
        global_name: globalName,
      },
      nick: null,
      roles: [],
      joined_at: new Date().toISOString(),
    };
  } else {
    interaction.user = {
      id: userId,
      username: userName,
      discriminator: "0",
      global_name: globalName,
    };
  }

  // Add data for MESSAGE_COMPONENT interactions
  if (type === InteractionType.MessageComponent && customId) {
    interaction.data = {
      custom_id: customId,
      component_type: 2, // Button
    };
    if (messageId) {
      interaction.message = {
        id: messageId,
        content: messageContent || "",
        channel_id: channelId,
        author: {
          id: DISCORD_BOT_USER_ID,
          username: DISCORD_BOT_USERNAME,
          discriminator: "0",
        },
        timestamp: new Date().toISOString(),
      };
    }
  }

  // Add data for APPLICATION_COMMAND interactions
  if (type === InteractionType.ApplicationCommand && commandName) {
    interaction.data = {
      name: commandName,
      type: 1, // Slash command
    };
  }

  return interaction;
}

/**
 * Create a Discord webhook request with valid Ed25519 signature
 */
export function createDiscordWebhookRequest(
  payload: Record<string, unknown>
): Request {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createDiscordSignature(body, timestamp);

  return new Request("https://example.com/webhook/discord", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature-ed25519": signature,
      "x-signature-timestamp": timestamp,
    },
    body,
  });
}

/**
 * Create a PING interaction request (for Discord URL verification)
 */
export function createDiscordPingRequest(): Request {
  const payload = {
    id: "ping_123",
    type: InteractionType.Ping,
    application_id: DISCORD_APPLICATION_ID,
    version: 1,
  };
  return createDiscordWebhookRequest(payload);
}

/**
 * Create a MESSAGE_COMPONENT (button click) interaction request
 */
export function createDiscordButtonRequest(options: {
  customId: string;
  userId?: string;
  userName?: string;
  guildId?: string;
  channelId?: string;
  messageId?: string;
}): Request {
  const payload = createDiscordInteraction({
    type: InteractionType.MessageComponent,
    customId: options.customId,
    userId: options.userId,
    userName: options.userName,
    guildId: options.guildId,
    channelId: options.channelId,
    messageId: options.messageId || "msg_123",
  });
  return createDiscordWebhookRequest(payload);
}

/**
 * Mock Discord API responses
 */
export interface MockDiscordApi {
  channels: {
    get: ReturnType<typeof vi.fn>;
    typing: ReturnType<typeof vi.fn>;
  };
  clearMocks: () => void;
  messages: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };
  reactions: {
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  users: {
    createDM: ReturnType<typeof vi.fn>;
  };
}

/**
 * Create mock Discord API
 */
export function createMockDiscordApi(): MockDiscordApi {
  const api: MockDiscordApi = {
    messages: {
      create: vi.fn().mockResolvedValue({
        id: `msg_${Date.now()}`,
        channel_id: "CHANNEL456",
        content: "test message",
        author: {
          id: DISCORD_BOT_USER_ID,
          username: DISCORD_BOT_USERNAME,
          discriminator: "0",
        },
        timestamp: new Date().toISOString(),
        edited_timestamp: null,
        attachments: [],
        embeds: [],
      }),
      update: vi.fn().mockResolvedValue({
        id: "msg_123",
        channel_id: "CHANNEL456",
        content: "updated message",
        author: {
          id: DISCORD_BOT_USER_ID,
          username: DISCORD_BOT_USERNAME,
          discriminator: "0",
        },
        timestamp: new Date().toISOString(),
        edited_timestamp: new Date().toISOString(),
        attachments: [],
        embeds: [],
      }),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
    },
    reactions: {
      add: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    channels: {
      get: vi.fn().mockResolvedValue({
        id: "CHANNEL456",
        type: 0, // GUILD_TEXT
        name: "general",
      }),
      typing: vi.fn().mockResolvedValue(undefined),
    },
    users: {
      createDM: vi.fn().mockResolvedValue({
        id: "DM_CHANNEL_123",
        type: 1, // DM
      }),
    },
    clearMocks: () => {
      api.messages.create.mockClear();
      api.messages.update.mockClear();
      api.messages.delete.mockClear();
      api.messages.list.mockClear();
      api.reactions.add.mockClear();
      api.reactions.remove.mockClear();
      api.channels.get.mockClear();
      api.channels.typing.mockClear();
      api.users.createDM.mockClear();
    },
  };
  return api;
}

// Regex patterns for Discord API route matching
const CHANNEL_MESSAGES_REGEX = /\/channels\/\w+\/messages$/;
const CHANNEL_MESSAGE_ID_REGEX = /\/channels\/\w+\/messages\/\w+$/;
const CHANNEL_MESSAGES_QUERY_REGEX = /\/channels\/\w+\/messages(\?|$)/;
const REACTIONS_ME_REGEX = /\/reactions\/[^/]+\/@me$/;
const CHANNEL_ID_REGEX = /\/channels\/\w+$/;
const CHANNEL_TYPING_REGEX = /\/channels\/\w+\/typing$/;

/**
 * Setup fetch mock for Discord API calls
 */
export function setupDiscordFetchMock(api: MockDiscordApi): void {
  const originalFetch = globalThis.fetch;

  // biome-ignore lint/suspicious/noExplicitAny: mocking fetch
  (globalThis as any).fetch = vi.fn(
    async (url: string, options?: RequestInit) => {
      const urlStr = String(url);

      // Only intercept Discord API calls
      if (!urlStr.startsWith("https://discord.com/api/")) {
        return originalFetch(url, options);
      }

      const method = options?.method || "GET";
      const body = options?.body
        ? JSON.parse(options.body as string)
        : undefined;

      // Route to appropriate mock
      // POST /channels/{id}/messages
      if (CHANNEL_MESSAGES_REGEX.test(urlStr) && method === "POST") {
        const result = await api.messages.create(body);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // PATCH /channels/{id}/messages/{id}
      if (CHANNEL_MESSAGE_ID_REGEX.test(urlStr) && method === "PATCH") {
        const result = await api.messages.update(body);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // DELETE /channels/{id}/messages/{id}
      if (CHANNEL_MESSAGE_ID_REGEX.test(urlStr) && method === "DELETE") {
        await api.messages.delete();
        return new Response(null, { status: 204 });
      }

      // GET /channels/{id}/messages
      if (CHANNEL_MESSAGES_QUERY_REGEX.test(urlStr) && method === "GET") {
        const result = await api.messages.list();
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // PUT /channels/{id}/messages/{id}/reactions/{emoji}/@me
      if (REACTIONS_ME_REGEX.test(urlStr) && method === "PUT") {
        await api.reactions.add();
        return new Response(null, { status: 204 });
      }

      // DELETE /channels/{id}/messages/{id}/reactions/{emoji}/@me
      if (REACTIONS_ME_REGEX.test(urlStr) && method === "DELETE") {
        await api.reactions.remove();
        return new Response(null, { status: 204 });
      }

      // GET /channels/{id}
      if (CHANNEL_ID_REGEX.test(urlStr) && method === "GET") {
        const result = await api.channels.get();
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // POST /channels/{id}/typing
      if (CHANNEL_TYPING_REGEX.test(urlStr) && method === "POST") {
        await api.channels.typing();
        return new Response(null, { status: 204 });
      }

      // POST /users/@me/channels
      if (urlStr.includes("/users/@me/channels") && method === "POST") {
        const result = await api.users.createDM(body);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Default: return 404 for unhandled routes
      return new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
  );
}

/**
 * Restore original fetch
 */
export function restoreDiscordFetchMock(): void {
  if (vi.isMockFunction(globalThis.fetch)) {
    vi.mocked(globalThis.fetch).mockRestore();
  }
}

/**
 * Get expected Discord thread ID format
 */
export function getDiscordThreadId(
  guildId: string,
  channelId: string,
  threadId?: string
): string {
  const threadPart = threadId ? `:${threadId}` : "";
  return `discord:${guildId}:${channelId}${threadPart}`;
}

/**
 * Create a Gateway forwarded event webhook request.
 * These use bot token authentication instead of Ed25519 signatures.
 */
export function createDiscordGatewayRequest(
  payload: Record<string, unknown>,
  botToken = DISCORD_BOT_TOKEN
): Request {
  return new Request("https://example.com/webhook/discord", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-discord-gateway-token": botToken,
    },
    body: JSON.stringify(payload),
  });
}

/**
 * Create a GATEWAY_MESSAGE_CREATE event payload
 */
export function createGatewayMessageEvent(options: {
  id?: string;
  channelId?: string;
  guildId?: string;
  content: string;
  authorId: string;
  authorUsername: string;
  authorGlobalName?: string;
  authorBot?: boolean;
  channelType?: number;
  mentions?: Array<{ id: string; username: string }>;
  mentionRoles?: string[];
}): Record<string, unknown> {
  return {
    type: "GATEWAY_MESSAGE_CREATE",
    timestamp: Date.now(),
    data: {
      id: options.id || `msg_${Date.now()}`,
      channel_id: options.channelId || "CHANNEL456",
      channel_type: options.channelType,
      guild_id: options.guildId ?? "GUILD123",
      content: options.content,
      author: {
        id: options.authorId,
        username: options.authorUsername,
        global_name: options.authorGlobalName || options.authorUsername,
        bot: options.authorBot ?? false,
      },
      timestamp: new Date().toISOString(),
      mentions: options.mentions || [],
      mention_roles: options.mentionRoles || [],
      attachments: [],
    },
  };
}

/**
 * Create a GATEWAY_REACTION_ADD or GATEWAY_REACTION_REMOVE event payload
 */
export function createGatewayReactionEvent(options: {
  added: boolean;
  emojiName: string;
  emojiId?: string;
  messageId?: string;
  channelId?: string;
  guildId?: string;
  userId: string;
  userUsername: string;
  userBot?: boolean;
}): Record<string, unknown> {
  return {
    type: options.added
      ? "GATEWAY_MESSAGE_REACTION_ADD"
      : "GATEWAY_MESSAGE_REACTION_REMOVE",
    timestamp: Date.now(),
    data: {
      emoji: {
        name: options.emojiName,
        id: options.emojiId || null,
      },
      message_id: options.messageId || "msg_123",
      channel_id: options.channelId || "CHANNEL456",
      guild_id: options.guildId ?? "GUILD123",
      user_id: options.userId,
      user: {
        id: options.userId,
        username: options.userUsername,
        bot: options.userBot ?? false,
      },
    },
  };
}
