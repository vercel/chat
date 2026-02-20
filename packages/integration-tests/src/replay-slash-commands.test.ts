/**
 * Replay tests for slash command interactions.
 *
 * Tests the full flow: slash command -> optional modal -> response to channel
 */

import type { ModalSubmitEvent, SlashCommandEvent } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import slackFixtures from "../fixtures/replay/slash-commands/slack.json";
import {
  createSlackTestContext,
  expectValidSlashCommand,
  type SlackTestContext,
} from "./replay-test-utils";

async function storeSlashCommandModalContext(
  ctx: SlackTestContext,
): Promise<void> {
  await ctx.state.connect();
  const { contextId, channel } = slackFixtures.slashCommandModalContext;
  const key = `modal-context:slack:${contextId}`;
  await ctx.state.set(key, { channel }, 3600000);
}

describe("Replay Tests - Slash Commands", () => {
  describe("Slack", () => {
    let ctx: SlackTestContext;
    let capturedSlashCommand: SlashCommandEvent | null = null;
    let capturedModalSubmit: ModalSubmitEvent | null = null;

    beforeEach(() => {
      vi.clearAllMocks();
      capturedSlashCommand = null;
      capturedModalSubmit = null;

      ctx = createSlackTestContext(
        { botName: slackFixtures.botName, botUserId: slackFixtures.botUserId },
        {
          onSlashCommand: async (event) => {
            capturedSlashCommand = event;
          },
          onModalSubmit: async (event) => {
            capturedModalSubmit = event;
          },
        },
      );
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should handle slash command with correct properties", async () => {
      await ctx.sendSlackSlashCommand(slackFixtures.slashCommand);

      expectValidSlashCommand(capturedSlashCommand, {
        command: "/test-feedback",
        text: "",
        userId: "U00FAKEUSER2",
        userName: "Test User",
        adapterName: "slack",
        channelId: "C00FAKECHAN3",
      });
    });

    it("should handle slash command with arguments", async () => {
      await ctx.sendSlackSlashCommand(slackFixtures.slashCommandWithArgs);

      expectValidSlashCommand(capturedSlashCommand, {
        command: "/test-feedback",
        text: "some arguments here",
        userId: "U00FAKEUSER2",
        userName: "Test User",
        adapterName: "slack",
      });
    });

    it("should provide triggerId for opening modals", async () => {
      await ctx.sendSlackSlashCommand(slackFixtures.slashCommand);

      expect(capturedSlashCommand?.triggerId).toBe(
        "10520020890661.10229338706656.2e2188a074adf3bf9f8456b30180f405",
      );
    });

    it("should provide channel object in slash command event", async () => {
      await ctx.sendSlackSlashCommand(slackFixtures.slashCommand);

      expect(capturedSlashCommand?.channel).toBeDefined();
      expect(capturedSlashCommand?.channel.id).toBe("slack:C00FAKECHAN3");
    });

    it("should allow posting to channel from slash command handler", async () => {
      ctx = createSlackTestContext(
        { botName: slackFixtures.botName, botUserId: slackFixtures.botUserId },
        {
          onSlashCommand: async (event) => {
            capturedSlashCommand = event;
            await event.channel.post("Hello from slash command!");
          },
        },
      );

      await ctx.sendSlackSlashCommand(slackFixtures.slashCommand);

      expect(ctx.mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C00FAKECHAN3",
          text: expect.stringContaining("Hello from slash command!"),
        }),
      );
    });

    it("should allow posting ephemeral to channel from slash command handler", async () => {
      ctx = createSlackTestContext(
        { botName: slackFixtures.botName, botUserId: slackFixtures.botUserId },
        {
          onSlashCommand: async (event) => {
            capturedSlashCommand = event;
            await event.channel.postEphemeral(
              event.user,
              "This is just for you!",
              { fallbackToDM: false },
            );
          },
        },
      );

      await ctx.sendSlackSlashCommand(slackFixtures.slashCommand);

      expect(ctx.mockClient.chat.postEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C00FAKECHAN3",
          user: "U00FAKEUSER2",
          text: expect.stringContaining("This is just for you!"),
        }),
      );
    });

    it("should handle modal submission (view_submission)", async () => {
      const response = await ctx.sendSlackViewSubmission(
        slackFixtures.viewSubmission,
      );

      expect(response.status).toBe(200);

      expect(capturedModalSubmit).not.toBeNull();
      expect(capturedModalSubmit?.callbackId).toBe("feedback_form");
      expect(capturedModalSubmit?.viewId).toBe("V0AF71PAUQK");

      expect(capturedModalSubmit?.values).toEqual({
        message: "Hello!",
        category: "feature",
        email: "user@example.com",
      });

      expect(capturedModalSubmit?.user.userId).toBe("U00FAKEUSER2");
      expect(capturedModalSubmit?.user.userName).toBe("testuser");
    });

    it("should populate relatedChannel in modal submit event from slash command context", async () => {
      await storeSlashCommandModalContext(ctx);
      await ctx.sendSlackViewSubmission(slackFixtures.viewSubmission);

      expect(capturedModalSubmit?.relatedChannel).toBeDefined();
      expect(capturedModalSubmit?.relatedChannel?.id).toBe(
        "slack:C00FAKECHAN3",
      );
    });

    it("should allow posting to relatedChannel from modal submit handler", async () => {
      ctx = createSlackTestContext(
        { botName: slackFixtures.botName, botUserId: slackFixtures.botUserId },
        {
          onModalSubmit: async (event) => {
            capturedModalSubmit = event;
            if (event.relatedChannel) {
              await event.relatedChannel.post(
                `Feedback received from ${event.user.userName}!`,
              );
            }
          },
        },
      );

      await storeSlashCommandModalContext(ctx);
      vi.clearAllMocks();
      await ctx.sendSlackViewSubmission(slackFixtures.viewSubmission);

      expect(ctx.mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C00FAKECHAN3",
          text: expect.stringContaining("Feedback received from testuser"),
        }),
      );
    });

    it("should not have relatedThread when modal opened from slash command", async () => {
      await storeSlashCommandModalContext(ctx);
      await ctx.sendSlackViewSubmission(slackFixtures.viewSubmission);

      expect(capturedModalSubmit?.relatedThread).toBeUndefined();
      expect(capturedModalSubmit?.relatedMessage).toBeUndefined();
      expect(capturedModalSubmit?.relatedChannel).toBeDefined();
    });

    it("should return 200 response for slash command webhook", async () => {
      const response = await ctx.sendSlackSlashCommand(
        slackFixtures.slashCommand,
      );
      expect(response.status).toBe(200);
    });
  });
});
