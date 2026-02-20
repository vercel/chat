/**
 * Replay tests for streaming functionality using recorded production webhooks.
 *
 * These tests verify that streaming responses work correctly across platforms
 * by replaying real webhook payloads that triggered AI mode and streaming.
 *
 * Fixtures are loaded from JSON files in fixtures/replay/streaming/
 * See fixtures/replay/README.md for instructions on updating fixtures.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import gchatFixtures from "../fixtures/replay/streaming/gchat.json";
import slackFixtures from "../fixtures/replay/streaming/slack.json";
import teamsFixtures from "../fixtures/replay/streaming/teams.json";
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

/**
 * Helper to create an async iterable text stream from chunks.
 * Simulates AI streaming response.
 */
async function* createTextStream(chunks: string[]): AsyncIterable<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe("Streaming Replay Tests", () => {
  describe("Slack", () => {
    let ctx: SlackTestContext;
    let aiModeEnabled = false;

    beforeEach(() => {
      vi.clearAllMocks();
      aiModeEnabled = false;

      ctx = createSlackTestContext(
        { botName: slackFixtures.botName, botUserId: slackFixtures.botUserId },
        {
          onMention: async (thread, message) => {
            await thread.subscribe();
            // Check if message contains "AI" to enable AI mode
            if (/\bAI\b/i.test(message.text)) {
              aiModeEnabled = true;
              await thread.post("AI Mode Enabled!");
              // Stream response for the initial AI question
              const stream = createTextStream([
                "Love ",
                "is ",
                "a ",
                "complex ",
                "emotion.",
              ]);
              await thread.post(stream);
            }
          },
          onSubscribed: async (thread) => {
            if (aiModeEnabled) {
              // Stream AI response
              const stream = createTextStream([
                "I am ",
                "an AI ",
                "assistant ",
                "here to help.",
              ]);
              await thread.post(stream);
            }
          },
        },
      );
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should handle AI mention with streaming response", async () => {
      await ctx.sendWebhook(slackFixtures.aiMention);

      expectValidMention(ctx.captured, {
        textContains: "AI",
        authorUserId: "U00FAKEUSER1",
        adapterName: "slack",
      });

      // Verify AI mode was enabled
      expect(aiModeEnabled).toBe(true);

      // Verify initial message was sent
      expectSentMessage(ctx.mockClient, "AI Mode Enabled!");

      // Verify native streaming was used (chatStream called for the AI response)
      expect(ctx.mockClient.chatStream).toHaveBeenCalled();
    });

    it("should stream response to follow-up message in AI mode", async () => {
      // First enable AI mode
      await ctx.sendWebhook(slackFixtures.aiMention);
      ctx.mockClient.clearMocks();

      // Send follow-up
      await ctx.sendWebhook(slackFixtures.followUp);

      expectValidFollowUp(ctx.captured, {
        text: "Who are you?",
        adapterName: "slack",
      });

      // Verify native streaming was used for the response
      expect(ctx.mockClient.chatStream).toHaveBeenCalled();
    });

    it("should handle AI mention with file attachment", async () => {
      await ctx.sendWebhook(slackFixtures.aiMentionWithFile);

      expectValidMention(ctx.captured, {
        textContains: "AI",
        authorUserId: "U00FAKEUSER2",
        adapterName: "slack",
      });

      expect(aiModeEnabled).toBe(true);
      expect(ctx.mockClient.chatStream).toHaveBeenCalled();
    });
  });

  describe("Teams", () => {
    let ctx: TeamsTestContext;
    let aiModeEnabled = false;

    beforeEach(() => {
      vi.clearAllMocks();
      aiModeEnabled = false;

      ctx = createTeamsTestContext(
        { botName: teamsFixtures.botName, appId: teamsFixtures.appId },
        {
          onMention: async (thread, message) => {
            await thread.subscribe();
            if (/\bAI\b/i.test(message.text)) {
              aiModeEnabled = true;
              await thread.post("AI Mode Enabled!");
              const stream = createTextStream([
                "Love ",
                "is ",
                "a ",
                "complex ",
                "emotion.",
              ]);
              await thread.post(stream);
            }
          },
          onSubscribed: async (thread) => {
            if (aiModeEnabled) {
              const stream = createTextStream([
                "I am ",
                "an AI ",
                "assistant ",
                "here to help.",
              ]);
              await thread.post(stream);
            }
          },
        },
      );
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should handle AI mention with streaming response", async () => {
      await ctx.sendWebhook(teamsFixtures.aiMention);

      expectValidMention(ctx.captured, {
        textContains: "AI",
        adapterName: "teams",
      });

      expect(aiModeEnabled).toBe(true);

      // Verify initial message was sent
      expectSentMessage(ctx.mockBotAdapter, "AI Mode Enabled!");

      // Verify streaming completed with final message
      expectUpdatedMessage(ctx.mockBotAdapter, "Love is a complex emotion.");
    });

    it("should stream response to follow-up message in AI mode", async () => {
      // First enable AI mode
      await ctx.sendWebhook(teamsFixtures.aiMention);
      ctx.mockBotAdapter.clearMocks();

      // Send follow-up
      await ctx.sendWebhook(teamsFixtures.followUp);

      expectValidFollowUp(ctx.captured, {
        text: "Who are you?",
        adapterName: "teams",
      });

      // Verify streaming response
      expectUpdatedMessage(
        ctx.mockBotAdapter,
        "I am an AI assistant here to help.",
      );
    });
  });

  describe("Google Chat", () => {
    let ctx: GchatTestContext;
    let aiModeEnabled = false;

    beforeEach(() => {
      vi.clearAllMocks();
      aiModeEnabled = false;

      ctx = createGchatTestContext(
        { botName: gchatFixtures.botName, botUserId: gchatFixtures.botUserId },
        {
          onMention: async (thread, message) => {
            await thread.subscribe();
            if (/\bAI\b/i.test(message.text)) {
              aiModeEnabled = true;
              await thread.post("AI Mode Enabled!");
              const stream = createTextStream([
                "Love ",
                "is ",
                "a ",
                "complex ",
                "emotion.",
              ]);
              await thread.post(stream);
            }
          },
          onSubscribed: async (thread) => {
            if (aiModeEnabled) {
              const stream = createTextStream([
                "I am ",
                "an AI ",
                "assistant ",
                "here to help.",
              ]);
              await thread.post(stream);
            }
          },
        },
      );
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should handle AI mention with streaming response", async () => {
      await ctx.sendWebhook(gchatFixtures.aiMention);

      expectValidMention(ctx.captured, {
        textContains: "AI",
        authorUserId: "users/100000000000000000001",
        adapterName: "gchat",
      });

      expect(aiModeEnabled).toBe(true);

      // Verify initial message was sent
      expectSentMessage(ctx.mockChatApi, "AI Mode Enabled!");

      // Verify streaming completed with final message
      expectUpdatedMessage(ctx.mockChatApi, "Love is a complex emotion.");
    });

    it("should stream response to follow-up message in AI mode", async () => {
      // First enable AI mode
      await ctx.sendWebhook(gchatFixtures.aiMention);
      ctx.mockChatApi.clearMocks();

      // Send follow-up via Pub/Sub
      await ctx.sendWebhook(gchatFixtures.followUp);

      expectValidFollowUp(ctx.captured, {
        text: "Who are you?",
        adapterName: "gchat",
      });

      // Verify streaming response
      expectUpdatedMessage(
        ctx.mockChatApi,
        "I am an AI assistant here to help.",
      );
    });
  });
});
