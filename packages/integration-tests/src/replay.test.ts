/**
 * Replay tests using recorded production webhooks.
 *
 * These tests replay actual webhook payloads recorded from production
 * to verify the Chat SDK handles real-world interactions correctly.
 *
 * Fixtures are loaded from JSON files in fixtures/replay/
 * See fixtures/replay/README.md for instructions on updating fixtures.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import gchatFixtures from "../fixtures/replay/gchat.json";
import slackFixtures from "../fixtures/replay/slack.json";
import teamsFixtures from "../fixtures/replay/teams.json";
import {
  createGchatTestContext,
  createSlackTestContext,
  createTeamsTestContext,
  expectSentMessage,
  expectUpdatedMessage,
  expectValidFollowUp,
  expectValidMention,
  type GchatTestContext,
  type SlackTestContext,
  type TeamsTestContext,
} from "./replay-test-utils";

describe("Replay Tests", () => {
  describe("Google Chat", () => {
    let ctx: GchatTestContext;

    beforeEach(() => {
      vi.clearAllMocks();

      ctx = createGchatTestContext(
        { botName: gchatFixtures.botName, botUserId: gchatFixtures.botUserId },
        {
          onMention: async (thread) => {
            await thread.subscribe();
            await thread.post("Thanks for mentioning me!");
          },
          onSubscribed: async (thread) => {
            const msg = await thread.post("Processing...");
            await msg.edit("Just a little bit...");
            await msg.edit("Thanks for your message");
          },
        }
      );
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should replay @mention with correct message properties", async () => {
      await ctx.sendWebhook(gchatFixtures.mention);

      expectValidMention(ctx.captured, {
        textContains: "hello",
        authorUserId: "users/100000000000000000001",
        adapterName: "gchat",
      });

      // Verify author details
      expect(ctx.captured.mentionMessage?.author).toMatchObject({
        userName: "Test User",
        fullName: "Test User",
        isBot: false,
        isMe: false,
      });

      expectSentMessage(ctx.mockChatApi, "Thanks for mentioning me!");
    });

    it("should replay follow-up with correct message properties", async () => {
      // First send mention to subscribe
      await ctx.sendWebhook(gchatFixtures.mention);
      ctx.mockChatApi.clearMocks();

      // Send follow-up via Pub/Sub
      await ctx.sendWebhook(gchatFixtures.followUp);

      expectValidFollowUp(ctx.captured, {
        text: "Hey",
        adapterName: "gchat",
      });

      expectSentMessage(ctx.mockChatApi, "Processing...");
      expectUpdatedMessage(ctx.mockChatApi, "Thanks for your message");
    });

    it("should correctly identify bot messages as isMe", async () => {
      // First subscribe via mention
      await ctx.sendWebhook(gchatFixtures.mention);

      // Track if handler was called
      let botMessageHandlerCalled = false;
      ctx.chat.onSubscribedMessage(() => {
        botMessageHandlerCalled = true;
      });

      // Create a Pub/Sub message from the bot itself
      const botFollowUp = {
        message: {
          attributes: { "ce-type": "google.workspace.chat.message.v1.created" },
          data: Buffer.from(
            JSON.stringify({
              message: {
                name: "spaces/AAQAJ9CXYcg/messages/bot-msg-001",
                sender: {
                  name: gchatFixtures.botUserId,
                  type: "BOT",
                },
                text: "Bot's own message",
                thread: { name: "spaces/AAQAJ9CXYcg/threads/kVOtO797ZPI" },
                space: { name: "spaces/AAQAJ9CXYcg" },
                threadReply: true,
              },
            })
          ).toString("base64"),
        },
        subscription:
          "projects/example-chat-project-123456/subscriptions/chat-messages-push",
      };

      // Send bot's own message - should be skipped
      await ctx.sendWebhook(botFollowUp);

      // Handler should NOT be called for bot's own messages
      expect(botMessageHandlerCalled).toBe(false);
    });
  });

  describe("Slack", () => {
    let ctx: SlackTestContext;

    beforeEach(() => {
      vi.clearAllMocks();

      ctx = createSlackTestContext(
        { botName: slackFixtures.botName, botUserId: slackFixtures.botUserId },
        {
          onMention: async (thread) => {
            await thread.subscribe();
            await thread.post("Thanks for mentioning me!");
          },
          onSubscribed: async (thread) => {
            const msg = await thread.post("Processing...");
            await msg.edit("Just a little bit...");
            await msg.edit("Thanks for your message");
          },
        }
      );
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should replay @mention with correct message properties", async () => {
      await ctx.sendWebhook(slackFixtures.mention);

      expectValidMention(ctx.captured, {
        textContains: "Hey",
        authorUserId: "U00FAKEUSER1",
        adapterName: "slack",
        threadIdContains: "C00FAKECHAN1",
      });

      expectSentMessage(ctx.mockClient, "Thanks for mentioning me!");
    });

    it("should replay follow-up with correct message properties", async () => {
      // First send mention to subscribe
      await ctx.sendWebhook(slackFixtures.mention);
      vi.clearAllMocks();

      // Send follow-up in thread
      await ctx.sendWebhook(slackFixtures.followUp);

      expectValidFollowUp(ctx.captured, {
        text: "Hi",
        adapterName: "slack",
      });

      // Verify thread ID matches (same thread as mention)
      expect(ctx.captured.followUpThread?.id).toContain("1767224888.280449");

      expectSentMessage(ctx.mockClient, "Processing...");
      expectUpdatedMessage(ctx.mockClient, "Thanks for your message");
    });

    it("should correctly identify bot messages as isMe", async () => {
      // Create a message from the bot itself
      const botMessage = {
        ...slackFixtures.followUp,
        event: {
          ...slackFixtures.followUp.event,
          user: slackFixtures.botUserId,
          text: "Bot's own message",
        },
      };

      // First subscribe via mention
      await ctx.sendWebhook(slackFixtures.mention);

      // Track if handler was called
      let botMessageHandlerCalled = false;
      ctx.chat.onSubscribedMessage(() => {
        botMessageHandlerCalled = true;
      });

      // Send bot's own message - should be skipped
      await ctx.sendWebhook(botMessage);

      // Handler should NOT be called for bot's own messages
      expect(botMessageHandlerCalled).toBe(false);
    });
  });

  describe("Teams", () => {
    let ctx: TeamsTestContext;

    beforeEach(() => {
      vi.clearAllMocks();

      ctx = createTeamsTestContext(
        { botName: teamsFixtures.botName, appId: teamsFixtures.appId },
        {
          onMention: async (thread) => {
            await thread.subscribe();
            await thread.post("Thanks for mentioning me!");
          },
          onSubscribed: async (thread) => {
            const msg = await thread.post("Processing...");
            await msg.edit("Just a little bit...");
            await msg.edit("Thanks for your message");
          },
        }
      );
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should replay @mention with correct message properties", async () => {
      await ctx.sendWebhook(teamsFixtures.mention);

      expectValidMention(ctx.captured, {
        textContains: "Hey",
        adapterName: "teams",
      });

      // Verify Teams-specific author format
      expect(ctx.captured.mentionMessage?.author.userId).toContain("29:");
      expect(ctx.captured.mentionMessage?.author).toMatchObject({
        userName: "Test User",
        fullName: "Test User",
        isMe: false,
      });

      expectSentMessage(ctx.mockBotAdapter, "Thanks for mentioning me!");
    });

    it("should replay follow-up with correct message properties", async () => {
      // First send mention to subscribe
      await ctx.sendWebhook(teamsFixtures.mention);
      ctx.mockBotAdapter.clearMocks();

      // Send follow-up
      await ctx.sendWebhook(teamsFixtures.followUp);

      expectValidFollowUp(ctx.captured, {
        text: "Hi",
        adapterName: "teams",
      });

      expect(ctx.captured.followUpMessage?.author).toMatchObject({
        userName: "Test User",
        isMe: false,
      });

      expectSentMessage(ctx.mockBotAdapter, "Processing...");
      expectUpdatedMessage(ctx.mockBotAdapter, "Thanks for your message");
    });

    it("should correctly identify bot messages as isMe", async () => {
      // Create a message from the bot itself
      const botMessage = {
        ...teamsFixtures.followUp,
        from: {
          id: `28:${teamsFixtures.appId}`,
          name: teamsFixtures.botName,
        },
        text: "Bot's own message",
      };

      // First subscribe via mention
      await ctx.sendWebhook(teamsFixtures.mention);

      // Track if handler was called
      let botMessageHandlerCalled = false;
      ctx.chat.onSubscribedMessage(() => {
        botMessageHandlerCalled = true;
      });

      // Send bot's own message - should be skipped
      await ctx.sendWebhook(botMessage);

      // Handler should NOT be called for bot's own messages
      expect(botMessageHandlerCalled).toBe(false);
    });
  });
});
