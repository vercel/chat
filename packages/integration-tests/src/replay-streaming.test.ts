/**
 * Replay tests for streaming functionality using recorded production webhooks.
 *
 * These tests verify that streaming responses work correctly across platforms
 * by replaying real webhook payloads that triggered AI mode and streaming.
 *
 * Fixtures are loaded from JSON files in fixtures/replay/streaming/
 * See fixtures/replay/README.md for instructions on updating fixtures.
 */

import type { ActionEvent, StreamChunk } from "chat";
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

const AI_WORD_REGEX = /\bAI\b/i;

/**
 * Helper to create an async iterable text stream from chunks.
 * Simulates AI streaming response.
 */
async function* createTextStream(chunks: string[]): AsyncIterable<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

async function* createStructuredStream(): AsyncIterable<string | StreamChunk> {
  yield "Starting structured reply...";
  yield {
    id: "task-1",
    status: "pending",
    title: "Looking up selected option",
    type: "task_update",
  };
  yield "Done.";
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
            if (AI_WORD_REGEX.test(message.text)) {
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
        }
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

    it("should ignore a prompt message posted by the bot", async () => {
      await ctx.sendWebhook(slackFixtures.promptMessage);

      expect(ctx.captured.mentionMessage).toBeNull();
      expect(ctx.captured.followUpMessage).toBeNull();
      expect(ctx.mockClient.chat.postMessage).not.toHaveBeenCalled();
      expect(ctx.mockClient.chatStream).not.toHaveBeenCalled();
    });

    it("should stream structured chunks for a block_actions continuation", async () => {
      const actionHandler = vi.fn(async (event: ActionEvent) => {
        if (event.actionId !== "option-select:option-a") {
          return;
        }
        await event.thread?.post(createStructuredStream());
      });
      ctx.chat.onAction(actionHandler);

      await ctx.sendWebhook(slackFixtures.promptMessage);
      ctx.mockClient.clearMocks();

      await ctx.sendSlackAction(slackFixtures.buttonAction);

      const capturedAction = actionHandler.mock.calls[0]?.[0];
      expect(capturedAction).not.toBeNull();
      if (!capturedAction) {
        throw new Error("Expected block action to be captured");
      }
      expect(capturedAction.actionId).toBe("option-select:option-a");
      expect(capturedAction.user.userId).toBe("U08REALUSER1");
      expect(capturedAction.user.userName).toBe("testuser");
      expect(capturedAction.thread?.id).toBe(
        "slack:C08REALCHAN1:1775407823.782829"
      );
      expect(capturedAction.thread?.channelId).toBe("slack:C08REALCHAN1");

      expect(ctx.mockClient.chatStream).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C08REALCHAN1",
          recipient_team_id: "T08REALTEAM1",
          recipient_user_id: "U08REALUSER1",
          thread_ts: "1775407823.782829",
        })
      );

      const streamer = ctx.mockClient.chatStream.mock.results.at(-1)?.value as {
        append: ReturnType<typeof vi.fn>;
      };
      const hasStructuredAppend = streamer.append.mock.calls.some((call) => {
        const [payload] = call as [{ chunks?: Array<{ type?: string }> }];
        return (
          Array.isArray(payload.chunks) &&
          payload.chunks.some((chunk) => chunk.type === "task_update")
        );
      });

      expect(hasStructuredAppend).toBe(true);
    });

    it("should stream follow-up replies for a subscribed message payload", async () => {
      await ctx.state.connect();
      await ctx.state.subscribe("slack:C08REALCHAN1:1775407823.782829");

      ctx.chat.onSubscribedMessage(async (thread, message) => {
        if (message.text !== "ping?") {
          return;
        }

        await thread.post(createTextStream(["pong"]));
      });

      await ctx.sendWebhook(slackFixtures.threadFollowUp);

      expectValidFollowUp(ctx.captured, {
        text: "ping?",
        adapterName: "slack",
      });
      expect(ctx.captured.followUpMessage?.author.userId).toBe("U08REALUSER1");

      expect(ctx.mockClient.chatStream).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C08REALCHAN1",
          recipient_team_id: "T08REALTEAM1",
          recipient_user_id: "U08REALUSER1",
          thread_ts: "1775407823.782829",
        })
      );
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
            if (AI_WORD_REGEX.test(message.text)) {
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
        }
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
      expectSentMessage(ctx.mockTeamsApp, "AI Mode Enabled!");

      // Group chats accumulate and post as single message (no post+edit)
      expectSentMessage(ctx.mockTeamsApp, "Love is a complex emotion.");
    });

    it("should stream response to follow-up message in AI mode", async () => {
      // First enable AI mode
      await ctx.sendWebhook(teamsFixtures.aiMention);
      ctx.mockTeamsApp.clearMocks();

      // Send follow-up
      await ctx.sendWebhook(teamsFixtures.followUp);

      expectValidFollowUp(ctx.captured, {
        text: "Who are you?",
        adapterName: "teams",
      });

      // Group chats accumulate and post as single message (no post+edit)
      expectSentMessage(ctx.mockTeamsApp, "I am an AI assistant here to help.");
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
            if (AI_WORD_REGEX.test(message.text)) {
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
        }
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
        "I am an AI assistant here to help."
      );
    });
  });
});
