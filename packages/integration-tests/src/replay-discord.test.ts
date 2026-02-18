/**
 * Discord replay tests using recorded production fixtures.
 *
 * These tests replay real Discord interactions captured from production
 * to verify the adapter handles actual Discord payloads correctly.
 *
 * Based on recordings from SHA 893def7 which captured:
 * - Gateway forwarded events (MESSAGE_CREATE, REACTION_ADD, etc.)
 * - Button clicks (hello, messages)
 * - Thread-based conversations
 * - AI mode interactions
 * - DM requests
 */

import type { ActionEvent, Message, ReactionEvent, Thread } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import discordFixtures from "../fixtures/replay/discord.json";
import {
  createGatewayMessageEvent,
  createGatewayReactionEvent,
  DISCORD_APPLICATION_ID,
} from "./discord-utils";
import {
  createDiscordTestContext,
  type DiscordTestContext,
  expectValidAction,
} from "./replay-test-utils";

// Runtime check that throws if null and returns the value
// Requires explicit type parameter: defined<Message>(capturedMessage)
function defined<T>(value: unknown): T {
  if (value === null || value === undefined) {
    throw new Error("Expected value to be defined");
  }
  return value as T;
}

const REAL_BOT_ID = discordFixtures.metadata.botId;
const REAL_GUILD_ID = discordFixtures.metadata.guildId;
const REAL_THREAD_ID = discordFixtures.metadata.threadId;
const REAL_USER_ID = discordFixtures.metadata.userId;
const REAL_USER_NAME = discordFixtures.metadata.userName;
const REAL_ROLE_ID = discordFixtures.metadata.roleId;

describe("Discord Replay Tests", () => {
  let ctx: DiscordTestContext;
  let capturedAction: ActionEvent | null = null;

  afterEach(async () => {
    capturedAction = null;
    if (ctx) {
      await ctx.chat.shutdown();
      ctx.cleanup();
    }
    vi.clearAllMocks();
  });

  describe("Production Button Actions (from SHA 893def7)", () => {
    it("should handle 'hello' button click from production recording", async () => {
      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            capturedAction = event;
            await event.thread.post(`Hello, ${event.user.fullName}!`);
          },
        },
      );

      const response = await ctx.sendWebhook(discordFixtures.buttonClickHello);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.type).toBe(6); // DEFERRED_UPDATE_MESSAGE

      expectValidAction(capturedAction, {
        actionId: "hello",
        userId: REAL_USER_ID,
        userName: REAL_USER_NAME,
        adapterName: "discord",
        isDM: false,
      });

      expect(ctx.mockApi.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Hello, Malte"),
        }),
      );
    });

    it("should handle 'messages' button click that triggers fetch operation", async () => {
      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            capturedAction = event;
            // Simulate the fetchMessages action from bot.tsx
            const result = await event.thread.adapter.fetchMessages(
              event.thread.id,
              { limit: 5, direction: "backward" },
            );
            await event.thread.post(
              `Fetched ${result.messages.length} messages`,
            );
          },
        },
      );

      const response = await ctx.sendWebhook(
        discordFixtures.buttonClickMessages,
      );

      expect(response.status).toBe(200);

      expectValidAction(capturedAction, {
        actionId: "messages",
        userId: REAL_USER_ID,
        userName: REAL_USER_NAME,
        adapterName: "discord",
        isDM: false,
      });

      expect(ctx.mockApi.messages.list).toHaveBeenCalled();
      expect(ctx.mockApi.messages.create).toHaveBeenCalled();
    });

    it("should handle 'info' button click showing bot information", async () => {
      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            capturedAction = event;
            await event.thread.post(
              `User: ${event.user.fullName}, Platform: ${event.adapter.name}`,
            );
          },
        },
      );

      const response = await ctx.sendWebhook(discordFixtures.buttonClickInfo);

      expect(response.status).toBe(200);

      expectValidAction(capturedAction, {
        actionId: "info",
        userId: REAL_USER_ID,
        userName: REAL_USER_NAME,
        adapterName: "discord",
        isDM: false,
      });

      expect(ctx.mockApi.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Malte"),
        }),
      );
    });

    it("should handle 'goodbye' button click (danger style)", async () => {
      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            capturedAction = event;
            await event.thread.post(
              `Goodbye, ${event.user.fullName}! See you later.`,
            );
          },
        },
      );

      const response = await ctx.sendWebhook(
        discordFixtures.buttonClickGoodbye,
      );

      expect(response.status).toBe(200);

      expectValidAction(capturedAction, {
        actionId: "goodbye",
        userId: REAL_USER_ID,
        userName: REAL_USER_NAME,
        adapterName: "discord",
        isDM: false,
      });

      expect(ctx.mockApi.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Goodbye"),
        }),
      );
    });
  });

  describe("DM Interactions", () => {
    it("should handle button click in DM channel", async () => {
      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            capturedAction = event;
            await event.thread.post("DM received!");
          },
        },
      );

      const response = await ctx.sendWebhook(discordFixtures.dmButtonClick);

      expect(response.status).toBe(200);

      expectValidAction(capturedAction, {
        actionId: "dm-action",
        userId: REAL_USER_ID,
        userName: REAL_USER_NAME,
        adapterName: "discord",
        isDM: true,
      });

      // DM thread ID format: discord:@me:{dmChannelId}
      expect(capturedAction?.thread.id).toBe("discord:@me:DM_CHANNEL_123");
    });

    it("should extract user info from DM interaction (user field, not member.user)", async () => {
      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            capturedAction = event;
          },
        },
      );

      await ctx.sendWebhook(discordFixtures.dmButtonClick);

      // DM uses `user` field directly instead of `member.user`
      expect(capturedAction?.user.userId).toBe(REAL_USER_ID);
      expect(capturedAction?.user.userName).toBe(REAL_USER_NAME);
      expect(capturedAction?.user.fullName).toBe("Malte");
    });
  });

  describe("Multi-User Scenarios", () => {
    it("should handle same action from different users", async () => {
      const actionLog: Array<{ userId: string; actionId: string }> = [];

      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            actionLog.push({
              userId: event.user.userId,
              actionId: event.actionId,
            });
            await event.thread.post(`Hello, ${event.user.fullName}!`);
          },
        },
      );

      // First user clicks hello
      await ctx.sendWebhook(discordFixtures.buttonClickHello);
      expect(actionLog).toHaveLength(1);
      expect(actionLog[0].userId).toBe(REAL_USER_ID);

      ctx.mockApi.clearMocks();

      // Different user clicks hello
      await ctx.sendWebhook(discordFixtures.differentUser);
      expect(actionLog).toHaveLength(2);
      expect(actionLog[1].userId).toBe("9876543210987654321");
      expect(actionLog[1].actionId).toBe("hello");
    });

    it("should correctly populate different user properties", async () => {
      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            capturedAction = event;
          },
        },
      );

      await ctx.sendWebhook(discordFixtures.differentUser);

      expect(capturedAction?.user.userId).toBe("9876543210987654321");
      expect(capturedAction?.user.userName).toBe("alice123");
      expect(capturedAction?.user.fullName).toBe("Alice");
    });
  });

  describe("Thread ID Verification", () => {
    it("should create correct thread ID for guild thread interactions", async () => {
      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            capturedAction = event;
          },
        },
      );

      await ctx.sendWebhook(discordFixtures.buttonClickHello);

      // Thread ID format: discord:{guildId}:{parentChannelId}:{threadId}
      // When the interaction happens in a thread, the parent channel is included
      const REAL_CHANNEL_ID = discordFixtures.metadata.channelId;
      expect(capturedAction?.thread.id).toBe(
        `discord:${REAL_GUILD_ID}:${REAL_CHANNEL_ID}:${REAL_THREAD_ID}`,
      );
      expect(capturedAction?.threadId).toBe(capturedAction?.thread.id);
    });

    it("should maintain consistent thread ID across multiple actions", async () => {
      const threadIds: string[] = [];

      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            threadIds.push(event.thread.id);
          },
        },
      );

      await ctx.sendWebhook(discordFixtures.buttonClickHello);
      await ctx.sendWebhook(discordFixtures.buttonClickMessages);
      await ctx.sendWebhook(discordFixtures.buttonClickInfo);

      // All actions should have same thread ID
      expect(threadIds).toHaveLength(3);
      expect(new Set(threadIds).size).toBe(1);
    });
  });

  describe("Message Operations", () => {
    it("should post, then edit message", async () => {
      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            const msg = await event.thread.post("Processing...");
            await msg.edit("Done!");
          },
        },
      );

      await ctx.sendWebhook(discordFixtures.buttonClickHello);

      expect(ctx.mockApi.messages.create).toHaveBeenCalled();
      expect(ctx.mockApi.messages.update).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Done!",
        }),
      );
    });

    it("should support typing indicator before posting", async () => {
      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            await event.thread.startTyping();
            await event.thread.post("Done typing!");
          },
        },
      );

      await ctx.sendWebhook(discordFixtures.buttonClickHello);

      expect(ctx.mockApi.channels.typing).toHaveBeenCalled();
      expect(ctx.mockApi.messages.create).toHaveBeenCalled();
    });

    it("should add reactions to posted messages", async () => {
      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            const msg = await event.thread.post("React to this!");
            await msg.addReaction("thumbsup");
          },
        },
      );

      await ctx.sendWebhook(discordFixtures.buttonClickHello);

      expect(ctx.mockApi.messages.create).toHaveBeenCalled();
      expect(ctx.mockApi.reactions.add).toHaveBeenCalled();
    });

    it("should delete posted messages", async () => {
      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            const msg = await event.thread.post("Temporary message");
            await msg.delete();
          },
        },
      );

      await ctx.sendWebhook(discordFixtures.buttonClickHello);

      expect(ctx.mockApi.messages.create).toHaveBeenCalled();
      expect(ctx.mockApi.messages.delete).toHaveBeenCalled();
    });
  });

  describe("Action ID Filtering", () => {
    it("should route actions to specific handlers", async () => {
      const helloHandler = vi.fn();
      const infoHandler = vi.fn();
      const messagesHandler = vi.fn();
      const goodbyeHandler = vi.fn();

      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {},
      );

      ctx.chat.onAction("hello", helloHandler);
      ctx.chat.onAction("info", infoHandler);
      ctx.chat.onAction("messages", messagesHandler);
      ctx.chat.onAction("goodbye", goodbyeHandler);

      await ctx.sendWebhook(discordFixtures.buttonClickHello);
      expect(helloHandler).toHaveBeenCalled();
      expect(infoHandler).not.toHaveBeenCalled();

      helloHandler.mockClear();

      await ctx.sendWebhook(discordFixtures.buttonClickInfo);
      expect(infoHandler).toHaveBeenCalled();
      expect(helloHandler).not.toHaveBeenCalled();
    });

    it("should support catch-all handler for any action", async () => {
      const catchAllHandler = vi.fn();

      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {},
      );

      ctx.chat.onAction(catchAllHandler);

      await ctx.sendWebhook(discordFixtures.buttonClickHello);
      expect(catchAllHandler).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: "hello" }),
      );

      catchAllHandler.mockClear();

      await ctx.sendWebhook(discordFixtures.buttonClickGoodbye);
      expect(catchAllHandler).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: "goodbye" }),
      );
    });

    it("should support array of action IDs in handler", async () => {
      const multiHandler = vi.fn();

      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {},
      );

      ctx.chat.onAction(["hello", "goodbye"], multiHandler);

      await ctx.sendWebhook(discordFixtures.buttonClickHello);
      expect(multiHandler).toHaveBeenCalled();

      multiHandler.mockClear();

      await ctx.sendWebhook(discordFixtures.buttonClickGoodbye);
      expect(multiHandler).toHaveBeenCalled();

      multiHandler.mockClear();

      // info should not trigger the handler
      await ctx.sendWebhook(discordFixtures.buttonClickInfo);
      expect(multiHandler).not.toHaveBeenCalled();
    });
  });

  describe("Response Types", () => {
    it("should return DEFERRED_UPDATE_MESSAGE (type 6) for button interactions", async () => {
      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async () => {},
        },
      );

      const response = await ctx.sendWebhook(discordFixtures.buttonClickHello);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.type).toBe(6); // DEFERRED_UPDATE_MESSAGE
    });
  });

  describe("Complete Conversation Flow", () => {
    it("should handle full conversation: hello → info → messages → goodbye", async () => {
      const actionLog: string[] = [];

      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            actionLog.push(event.actionId);
            if (event.actionId === "hello") {
              await event.thread.post(`Hello, ${event.user.fullName}!`);
            } else if (event.actionId === "info") {
              await event.thread.post(
                `Platform: ${event.adapter.name}, Thread: ${event.thread.id}`,
              );
            } else if (event.actionId === "messages") {
              await event.thread.adapter.fetchMessages(event.thread.id, {
                limit: 5,
              });
              await event.thread.post("Fetched messages");
            } else if (event.actionId === "goodbye") {
              await event.thread.post("Goodbye!");
            }
          },
        },
      );

      // Step 1: Say Hello
      await ctx.sendWebhook(discordFixtures.buttonClickHello);
      expect(actionLog).toEqual(["hello"]);

      ctx.mockApi.clearMocks();

      // Step 2: Show Info
      await ctx.sendWebhook(discordFixtures.buttonClickInfo);
      expect(actionLog).toEqual(["hello", "info"]);

      ctx.mockApi.clearMocks();

      // Step 3: Fetch Messages
      await ctx.sendWebhook(discordFixtures.buttonClickMessages);
      expect(actionLog).toEqual(["hello", "info", "messages"]);
      expect(ctx.mockApi.messages.list).toHaveBeenCalled();

      ctx.mockApi.clearMocks();

      // Step 4: Goodbye
      await ctx.sendWebhook(discordFixtures.buttonClickGoodbye);
      expect(actionLog).toEqual(["hello", "info", "messages", "goodbye"]);

      // Total: 4 message posts (one per action)
      expect(ctx.mockApi.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Goodbye"),
        }),
      );
    });
  });

  describe("Edit Message Pattern (Streaming Fallback)", () => {
    it("should handle post then edit pattern", async () => {
      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            // Post initial message
            const msg = await event.thread.post("Thinking...");
            // Then edit with final content (simulates streaming completion)
            await msg.edit("Done thinking!");
          },
        },
      );

      await ctx.sendWebhook(discordFixtures.buttonClickInfo);

      // Should post initial message
      expect(ctx.mockApi.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Thinking...",
        }),
      );

      // Should update with final content
      expect(ctx.mockApi.messages.update).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Done thinking!",
        }),
      );
    });

    it("should handle multiple post-edit cycles", async () => {
      const editCount = { value: 0 };

      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            const msg = await event.thread.post("Processing...");
            editCount.value++;
            await msg.edit(`Completed step ${editCount.value}`);
          },
        },
      );

      // First button click
      await ctx.sendWebhook(discordFixtures.buttonClickHello);
      expect(editCount.value).toBe(1);
      expect(ctx.mockApi.messages.update).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Completed step 1",
        }),
      );

      ctx.mockApi.clearMocks();

      // Second button click
      await ctx.sendWebhook(discordFixtures.buttonClickInfo);
      expect(editCount.value).toBe(2);
      expect(ctx.mockApi.messages.update).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Completed step 2",
        }),
      );
    });

    it("should support progressive edits to same message", async () => {
      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            const msg = await event.thread.post("Step 1...");
            await msg.edit("Step 1... Step 2...");
            await msg.edit("Step 1... Step 2... Done!");
          },
        },
      );

      await ctx.sendWebhook(discordFixtures.buttonClickHello);

      // Should create once
      expect(ctx.mockApi.messages.create).toHaveBeenCalledTimes(1);

      // Should update twice (once for each edit)
      expect(ctx.mockApi.messages.update).toHaveBeenCalledTimes(2);

      // Final edit should have complete content
      const updateCalls = ctx.mockApi.messages.update.mock.calls;
      expect(updateCalls[1][0].content).toBe("Step 1... Step 2... Done!");
    });
  });
});

describe("Discord Gateway Forwarded Events", () => {
  let ctx: DiscordTestContext;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (ctx) {
      await ctx.chat.shutdown();
      ctx.cleanup();
    }
  });

  describe("isMe Detection for Forwarded Messages", () => {
    it("should set isMe=true when message author is the bot", async () => {
      let capturedMessage: Message | null = null;

      ctx = await createDiscordTestContext(
        { botName: "TestBot", applicationId: DISCORD_APPLICATION_ID },
        {
          onMention: async (_thread, message) => {
            capturedMessage = message;
          },
        },
      );

      // Send a message FROM the bot (author.id === applicationId)
      const gatewayEvent = createGatewayMessageEvent({
        content: "Hello from the bot",
        authorId: DISCORD_APPLICATION_ID,
        authorUsername: "TestBot",
        authorBot: true,
        mentions: [{ id: DISCORD_APPLICATION_ID, username: "TestBot" }],
      });

      await ctx.sendGatewayEvent(gatewayEvent);

      // Bot messages should NOT trigger handlers (isMe=true causes skip)
      expect(capturedMessage).toBeNull();
    });

    it("should set isMe=false when message author is a regular user", async () => {
      let capturedMessage: Message | null = null;

      ctx = await createDiscordTestContext(
        { botName: "TestBot", applicationId: DISCORD_APPLICATION_ID },
        {
          onMention: async (_thread, message) => {
            capturedMessage = message;
          },
        },
      );

      // Send a message FROM a regular user that mentions the bot
      const gatewayEvent = createGatewayMessageEvent({
        content: `<@${DISCORD_APPLICATION_ID}> Hello`,
        authorId: "USER123",
        authorUsername: "regularuser",
        authorBot: false,
        mentions: [{ id: DISCORD_APPLICATION_ID, username: "TestBot" }],
      });

      await ctx.sendGatewayEvent(gatewayEvent);

      // User messages should trigger handlers
      const msg = defined<Message>(capturedMessage);
      expect(msg.author.isMe).toBe(false);
      expect(msg.author.isBot).toBe(false);
      expect(msg.author.userId).toBe("USER123");
    });

    it("should skip bot's own messages in subscribed threads", async () => {
      let subscribedMessageCount = 0;

      ctx = await createDiscordTestContext(
        { botName: "TestBot", applicationId: DISCORD_APPLICATION_ID },
        {
          onMention: async (thread) => {
            // Subscribe to the thread when mentioned
            await thread.subscribe();
          },
          onSubscribed: async () => {
            subscribedMessageCount++;
          },
        },
      );

      // First, trigger a mention to subscribe
      const mentionEvent = createGatewayMessageEvent({
        content: `<@${DISCORD_APPLICATION_ID}> subscribe me`,
        authorId: "USER123",
        authorUsername: "regularuser",
        mentions: [{ id: DISCORD_APPLICATION_ID, username: "TestBot" }],
      });
      await ctx.sendGatewayEvent(mentionEvent);

      // Send a message from the bot itself
      const botMessage = createGatewayMessageEvent({
        content: "Bot response",
        authorId: DISCORD_APPLICATION_ID,
        authorUsername: "TestBot",
        authorBot: true,
      });

      await ctx.sendGatewayEvent(botMessage);

      // Bot's own message should NOT trigger subscribed handler
      expect(subscribedMessageCount).toBe(0);

      // Send a message from a regular user
      const userMessage = createGatewayMessageEvent({
        content: "User message",
        authorId: "USER123",
        authorUsername: "regularuser",
        authorBot: false,
      });

      await ctx.sendGatewayEvent(userMessage);

      // User message SHOULD trigger subscribed handler
      expect(subscribedMessageCount).toBe(1);
    });

    it("should not enable AI mode from bot's own welcome message", async () => {
      let aiModeEnabled = false;

      ctx = await createDiscordTestContext(
        { botName: "TestBot", applicationId: DISCORD_APPLICATION_ID },
        {
          onMention: async (thread) => {
            await thread.subscribe();
          },
          onSubscribed: async (_thread, message) => {
            // This simulates the regex check in bot.tsx
            if (/enable\s*AI/i.test(message.text)) {
              aiModeEnabled = true;
            }
          },
        },
      );

      // First, trigger a mention to subscribe
      const mentionEvent = createGatewayMessageEvent({
        content: `<@${DISCORD_APPLICATION_ID}> hello`,
        authorId: "USER123",
        authorUsername: "regularuser",
        mentions: [{ id: DISCORD_APPLICATION_ID, username: "TestBot" }],
      });
      await ctx.sendGatewayEvent(mentionEvent);

      // Simulate bot posting its own welcome message that contains "enable AI"
      const botWelcomeMessage = createGatewayMessageEvent({
        content: 'Mention me with "AI" to enable AI assistant mode',
        authorId: DISCORD_APPLICATION_ID,
        authorUsername: "TestBot",
        authorBot: true,
      });

      await ctx.sendGatewayEvent(botWelcomeMessage);

      // AI mode should NOT be enabled from bot's own message
      expect(aiModeEnabled).toBe(false);
    });
  });

  describe("isMe Detection for Forwarded Reactions", () => {
    it("should set isMe=true when reaction is from the bot", async () => {
      let capturedReaction: ReactionEvent | null = null;

      ctx = await createDiscordTestContext(
        { botName: "TestBot", applicationId: DISCORD_APPLICATION_ID },
        {
          onReaction: async (event) => {
            capturedReaction = event;
          },
        },
      );

      // Send a reaction FROM the bot
      const gatewayEvent = createGatewayReactionEvent({
        added: true,
        emojiName: "👍",
        userId: DISCORD_APPLICATION_ID,
        userUsername: "TestBot",
        userBot: true,
      });

      await ctx.sendGatewayEvent(gatewayEvent);

      // Bot reactions should NOT trigger handlers (isMe=true causes skip)
      expect(capturedReaction).toBeNull();
    });

    it("should set isMe=false when reaction is from a regular user", async () => {
      let capturedReaction: ReactionEvent | null = null;

      ctx = await createDiscordTestContext(
        { botName: "TestBot", applicationId: DISCORD_APPLICATION_ID },
        {
          onReaction: async (event) => {
            capturedReaction = event;
          },
        },
      );

      // Send a reaction FROM a regular user
      const gatewayEvent = createGatewayReactionEvent({
        added: true,
        emojiName: "👍",
        userId: "USER123",
        userUsername: "regularuser",
        userBot: false,
      });

      await ctx.sendGatewayEvent(gatewayEvent);

      // User reactions should trigger handlers
      const reaction = defined<ReactionEvent>(capturedReaction);
      expect(reaction.user.isMe).toBe(false);
      expect(reaction.user.isBot).toBe(false);
      expect(reaction.user.userId).toBe("USER123");
    });
  });

  describe("Gateway Message Processing", () => {
    it("should correctly identify mentioned messages", async () => {
      let capturedMessage: Message | null = null;
      let capturedThread: Thread | null = null;

      ctx = await createDiscordTestContext(
        { botName: "TestBot", applicationId: DISCORD_APPLICATION_ID },
        {
          onMention: async (thread, message) => {
            capturedMessage = message;
            capturedThread = thread;
          },
        },
      );

      const gatewayEvent = createGatewayMessageEvent({
        content: `<@${DISCORD_APPLICATION_ID}> Help me`,
        authorId: "USER123",
        authorUsername: "testuser",
        authorGlobalName: "Test User",
        mentions: [{ id: DISCORD_APPLICATION_ID, username: "TestBot" }],
      });

      await ctx.sendGatewayEvent(gatewayEvent);

      const msg = defined<Message>(capturedMessage);
      const thread = defined<Thread>(capturedThread);
      expect(msg.isMention).toBe(true);
      expect(msg.text).toContain("Help me");
      expect(thread.adapter.name).toBe("discord");
    });

    it("should process messages from subscribed threads", async () => {
      const capturedMessages: Message[] = [];

      ctx = await createDiscordTestContext(
        { botName: "TestBot", applicationId: DISCORD_APPLICATION_ID },
        {
          onMention: async (thread) => {
            await thread.subscribe();
          },
          onSubscribed: async (_thread, message) => {
            capturedMessages.push(message);
          },
        },
      );

      // First, trigger a mention to subscribe
      const mentionEvent = createGatewayMessageEvent({
        content: `<@${DISCORD_APPLICATION_ID}> subscribe me`,
        authorId: "USER123",
        authorUsername: "testuser",
        mentions: [{ id: DISCORD_APPLICATION_ID, username: "TestBot" }],
      });
      await ctx.sendGatewayEvent(mentionEvent);

      // Send multiple user messages
      for (let i = 1; i <= 3; i++) {
        const event = createGatewayMessageEvent({
          id: `msg_${i}`,
          content: `Message ${i}`,
          authorId: "USER123",
          authorUsername: "testuser",
        });
        await ctx.sendGatewayEvent(event);
      }

      expect(capturedMessages).toHaveLength(3);
      expect(capturedMessages.map((m) => m.text)).toEqual([
        "Message 1",
        "Message 2",
        "Message 3",
      ]);
    });
  });

  describe("Real Gateway Fixtures (from SHA 893def7)", () => {
    it("should handle real gatewayMention fixture", async () => {
      let capturedMessage: Message | null = null;
      let capturedThread: Thread | null = null;

      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onMention: async (thread, message) => {
            capturedMessage = message;
            capturedThread = thread;
          },
        },
      );

      await ctx.sendGatewayEvent(discordFixtures.gatewayMention);

      const msg = defined<Message>(capturedMessage);
      const thread = defined<Thread>(capturedThread);
      expect(msg.isMention).toBe(true);
      expect(msg.text).toBe("<@1457469483726668048> Hey");
      expect(msg.author.userId).toBe(REAL_USER_ID);
      expect(msg.author.userName).toBe(REAL_USER_NAME);
      expect(msg.author.isMe).toBe(false);
      expect(msg.author.isBot).toBe(false);
      expect(thread.adapter.name).toBe("discord");
    });

    it("should handle real gatewayAIMention fixture with AI keyword", async () => {
      let capturedMessage: Message | null = null;

      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onMention: async (_thread, message) => {
            capturedMessage = message;
          },
        },
      );

      await ctx.sendGatewayEvent(discordFixtures.gatewayAIMention);

      const msg = defined<Message>(capturedMessage);
      expect(msg.text).toBe("<@1457469483726668048> AI What is love");
      expect(msg.isMention).toBe(true);
      // Verify the message contains "AI" for AI mode trigger
      expect(msg.text).toMatch(/\bAI\b/i);
    });

    it("should skip real gatewayBotWelcome fixture (bot's own message)", async () => {
      let capturedMessage: Message | null = null;

      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onMention: async (_thread, message) => {
            capturedMessage = message;
          },
        },
      );

      // The bot's welcome message should be skipped because isMe=true
      await ctx.sendGatewayEvent(discordFixtures.gatewayBotWelcome);

      // Bot's own message should NOT trigger any handlers
      expect(capturedMessage).toBeNull();
    });

    it("should skip real gatewayThreadWelcome fixture (bot's own thread message)", async () => {
      let subscribedCount = 0;
      let mentionCount = 0;

      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onMention: async () => {
            mentionCount++;
          },
          onSubscribed: async () => {
            subscribedCount++;
          },
        },
      );

      // Bot's welcome message in thread should be skipped due to isMe=true
      await ctx.sendGatewayEvent(discordFixtures.gatewayThreadWelcome);

      expect(mentionCount).toBe(0);
      expect(subscribedCount).toBe(0);
    });

    it("should handle real gatewayReactionAdd fixture", async () => {
      let capturedReaction: ReactionEvent | null = null;

      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onReaction: async (event) => {
            capturedReaction = event;
          },
        },
      );

      await ctx.sendGatewayEvent(discordFixtures.gatewayReactionAdd);

      const reaction = defined<ReactionEvent>(capturedReaction);
      expect(reaction.added).toBe(true);
      expect(reaction.user.userId).toBe(REAL_USER_ID);
      expect(reaction.user.isMe).toBe(false);
      expect(reaction.rawEmoji).toBe("👍");
    });

    it("should handle real thread messages when subscribed via thread ID", async () => {
      const capturedMessages: Message[] = [];

      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onSubscribed: async (_thread, message) => {
            capturedMessages.push(message);
          },
        },
      );

      // Mock the channels.get API to return parent_id for the thread
      ctx.mockApi.channels.get.mockResolvedValue({
        id: "1457536551830421524",
        type: 11,
        parent_id: "1457510428359004343",
      });

      // Manually subscribe to the thread (simulating bot subscribing after creating thread)
      const threadId = `discord:${REAL_GUILD_ID}:1457510428359004343:1457536551830421524`;
      await ctx.state.subscribe(threadId);

      // Now send real thread messages
      await ctx.sendGatewayEvent(discordFixtures.gatewayThreadUserHey);
      await ctx.sendGatewayEvent(discordFixtures.gatewayThreadNice);
      await ctx.sendGatewayEvent(discordFixtures.gatewayThreadNum1);

      expect(capturedMessages).toHaveLength(3);
      expect(capturedMessages[0].text).toBe("Hey");
      expect(capturedMessages[0].author.isMe).toBe(false);
      expect(capturedMessages[1].text).toBe("Nice");
      expect(capturedMessages[2].text).toBe("1");
    });

    it("should handle real DM request in subscribed thread", async () => {
      let dmMessage: Message | null = null;

      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onSubscribed: async (_thread, message) => {
            dmMessage = message;
          },
        },
      );

      // Mock the channels.get API to return parent_id for the thread
      ctx.mockApi.channels.get.mockResolvedValue({
        id: "1457536551830421524",
        type: 11,
        parent_id: "1457510428359004343",
      });

      // Subscribe to the thread
      const threadId = `discord:${REAL_GUILD_ID}:1457510428359004343:1457536551830421524`;
      await ctx.state.subscribe(threadId);

      // Send the DM request message
      await ctx.sendGatewayEvent(discordFixtures.gatewayThreadDMRequest);

      const dm = defined<Message>(dmMessage);
      expect(dm.text).toBe("DM me");
      expect(dm.author.userId).toBe(REAL_USER_ID);
      expect(dm.author.isMe).toBe(false);
    });

    it("should verify isMe fix prevents bot's own messages from triggering handlers", async () => {
      let handlerCallCount = 0;

      ctx = await createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onMention: async () => {
            handlerCallCount++;
          },
          onSubscribed: async () => {
            handlerCallCount++;
          },
        },
      );

      // Mock the channels.get API
      ctx.mockApi.channels.get.mockResolvedValue({
        id: "1457536551830421524",
        type: 11,
        parent_id: "1457510428359004343",
      });

      // Subscribe to thread
      const threadId = `discord:${REAL_GUILD_ID}:1457510428359004343:1457536551830421524`;
      await ctx.state.subscribe(threadId);

      // Send bot's own messages - these should all be skipped
      await ctx.sendGatewayEvent(discordFixtures.gatewayBotWelcome);
      await ctx.sendGatewayEvent(discordFixtures.gatewayThreadWelcome);

      // None of the bot's messages should trigger handlers
      expect(handlerCallCount).toBe(0);

      // Now send a real user message - this SHOULD trigger the handler
      await ctx.sendGatewayEvent(discordFixtures.gatewayThreadUserHey);
      expect(handlerCallCount).toBe(1);
    });
  });

  describe("Role Mention Support", () => {
    it("should trigger onNewMention when a configured role is mentioned", async () => {
      let capturedMessage: Message | null = null;
      let capturedThread: Thread | null = null;

      ctx = await createDiscordTestContext(
        {
          botName: "Chat SDK Demo",
          applicationId: REAL_BOT_ID,
          mentionRoleIds: [REAL_ROLE_ID],
        },
        {
          onMention: async (thread, message) => {
            capturedMessage = message;
            capturedThread = thread;
          },
        },
      );

      // Send the role mention fixture
      await ctx.sendGatewayEvent(discordFixtures.gatewayRoleMention);

      const msg = defined<Message>(capturedMessage);
      const thread = defined<Thread>(capturedThread);

      expect(msg.isMention).toBe(true);
      expect(msg.text).toBe("<@&1457473602180878604> AI Still there?");
      expect(msg.author.userId).toBe(REAL_USER_ID);
      expect(msg.author.userName).toBe(REAL_USER_NAME);
      expect(msg.author.isMe).toBe(false);
      expect(msg.author.isBot).toBe(false);
      expect(thread.adapter.name).toBe("discord");
    });

    it("should NOT trigger onNewMention when role is not in configured list", async () => {
      let capturedMessage: Message | null = null;

      ctx = await createDiscordTestContext(
        {
          botName: "Chat SDK Demo",
          applicationId: REAL_BOT_ID,
          mentionRoleIds: ["DIFFERENT_ROLE_ID"],
        },
        {
          onMention: async (_thread, message) => {
            capturedMessage = message;
          },
        },
      );

      // Send the role mention fixture - should NOT trigger because role ID doesn't match
      await ctx.sendGatewayEvent(discordFixtures.gatewayRoleMention);

      // Should NOT have triggered the mention handler
      expect(capturedMessage).toBeNull();
    });

    it("should NOT trigger onNewMention for role mentions when no role IDs configured", async () => {
      let capturedMessage: Message | null = null;

      ctx = await createDiscordTestContext(
        {
          botName: "Chat SDK Demo",
          applicationId: REAL_BOT_ID,
          // No mentionRoleIds configured
        },
        {
          onMention: async (_thread, message) => {
            capturedMessage = message;
          },
        },
      );

      // Send the role mention fixture - should NOT trigger because no roles configured
      await ctx.sendGatewayEvent(discordFixtures.gatewayRoleMention);

      // Should NOT have triggered the mention handler
      expect(capturedMessage).toBeNull();
    });

    it("should trigger on role mention even without direct user mention", async () => {
      let capturedMessage: Message | null = null;

      ctx = await createDiscordTestContext(
        {
          botName: "Chat SDK Demo",
          applicationId: REAL_BOT_ID,
          mentionRoleIds: [REAL_ROLE_ID],
        },
        {
          onMention: async (_thread, message) => {
            capturedMessage = message;
          },
        },
      );

      // The gatewayRoleMention has mention_roles but NO mentions (no direct @user)
      // It should still trigger because the role is mentioned
      await ctx.sendGatewayEvent(discordFixtures.gatewayRoleMention);

      const msg = defined<Message>(capturedMessage);
      expect(msg.isMention).toBe(true);
      // Verify there's no direct user mention in the mentions array
      expect((msg.raw as Record<string, unknown>).mentions).toEqual([]);
    });

    it("should support multiple role IDs in configuration", async () => {
      let capturedMessage: Message | null = null;

      ctx = await createDiscordTestContext(
        {
          botName: "Chat SDK Demo",
          applicationId: REAL_BOT_ID,
          mentionRoleIds: ["OTHER_ROLE_1", REAL_ROLE_ID, "OTHER_ROLE_2"],
        },
        {
          onMention: async (_thread, message) => {
            capturedMessage = message;
          },
        },
      );

      await ctx.sendGatewayEvent(discordFixtures.gatewayRoleMention);

      const msg = defined<Message>(capturedMessage);
      expect(msg.isMention).toBe(true);
    });

    it("should work with synthetic role mention events", async () => {
      let capturedMessage: Message | null = null;

      ctx = await createDiscordTestContext(
        {
          botName: "TestBot",
          applicationId: DISCORD_APPLICATION_ID,
          mentionRoleIds: ["ROLE_123"],
        },
        {
          onMention: async (_thread, message) => {
            capturedMessage = message;
          },
        },
      );

      // Create a synthetic Gateway event with role mention
      const gatewayEvent = createGatewayMessageEvent({
        content: "<@&ROLE_123> Hello team!",
        authorId: "USER123",
        authorUsername: "testuser",
        mentionRoles: ["ROLE_123"],
      });

      await ctx.sendGatewayEvent(gatewayEvent);

      const msg = defined<Message>(capturedMessage);
      expect(msg.isMention).toBe(true);
      expect(msg.text).toBe("<@&ROLE_123> Hello team!");
    });
  });
});
