/**
 * Replay tests for member_joined_channel event.
 *
 * Tests that the SDK correctly routes member_joined_channel events
 * to the registered handler, using recorded webhook payloads.
 *
 * Fixtures are loaded from fixtures/replay/member-joined-channel/
 */

import type { MemberJoinedChannelEvent } from "chat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import slackFixtures from "../fixtures/replay/member-joined-channel/slack.json";
import {
  createSlackTestContext,
  type SlackTestContext,
} from "./replay-test-utils";

describe("Replay Tests - Member Joined Channel", () => {
  describe("Slack", () => {
    let ctx: SlackTestContext;
    let capturedEvent: MemberJoinedChannelEvent | null = null;

    beforeEach(() => {
      capturedEvent = null;

      ctx = createSlackTestContext(
        {
          botName: slackFixtures.botName,
          botUserId: slackFixtures.botUserId,
        },
        {
          onMention: async (thread) => {
            await thread.subscribe();
            await thread.post("Welcome!");
          },
        }
      );

      // Register member_joined_channel handler directly on the chat instance
      ctx.chat.onMemberJoinedChannel((event) => {
        capturedEvent = event;
      });
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("routes member_joined_channel event to handler", async () => {
      await ctx.sendWebhook(slackFixtures.memberJoinedChannel);

      expect(capturedEvent).not.toBeNull();
      expect(capturedEvent?.userId).toBe(slackFixtures.botUserId);
      expect(capturedEvent?.channelId).toContain("C00FAKECHAN1");
      expect(capturedEvent?.inviterId).toBe("U00FAKEUSER1");
      expect(capturedEvent?.adapter.name).toBe("slack");
    });

    it("provides encoded thread ID as channelId", async () => {
      await ctx.sendWebhook(slackFixtures.memberJoinedChannel);

      expect(capturedEvent).not.toBeNull();
      // channelId should be encoded in slack:CHANNEL: format
      expect(capturedEvent?.channelId).toBe("slack:C00FAKECHAN1:");
    });

    it("can post a welcome message to the channel", async () => {
      ctx.chat.onMemberJoinedChannel(async (event) => {
        if (event.userId === slackFixtures.botUserId) {
          await event.adapter.postMessage(
            event.channelId,
            "Bot is available in this channel."
          );
        }
      });

      await ctx.sendWebhook(slackFixtures.memberJoinedChannel);

      expect(ctx.mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C00FAKECHAN1",
          text: "Bot is available in this channel.",
        })
      );
    });

    it("handles both member_joined_channel and mention in same session", async () => {
      // Bot joins channel
      await ctx.sendWebhook(slackFixtures.memberJoinedChannel);
      expect(capturedEvent).not.toBeNull();

      // User mentions bot in same channel
      await ctx.sendWebhook(slackFixtures.mention);
      expect(ctx.captured.mentionMessage).not.toBeNull();
      expect(ctx.captured.mentionMessage?.text).toContain("test");
    });

    it("ignores member_joined_channel when no handler registered", async () => {
      // Create a context without onMemberJoinedChannel handler
      const ctx2 = createSlackTestContext(
        {
          botName: slackFixtures.botName,
          botUserId: slackFixtures.botUserId,
        },
        {}
      );

      // Should not throw
      await ctx2.sendWebhook(slackFixtures.memberJoinedChannel);
      await ctx2.chat.shutdown();
    });
  });
});
