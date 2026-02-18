/**
 * Replay tests for actions (button clicks) and reactions.
 *
 * These tests replay actual webhook payloads recorded from production
 * to verify the Chat SDK handles button clicks and emoji reactions correctly.
 *
 * Fixtures are loaded from JSON files in fixtures/replay/actions-reactions/
 */

import type { ActionEvent, ReactionEvent } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import gchatFixtures from "../fixtures/replay/actions-reactions/gchat.json";
import slackFixtures from "../fixtures/replay/actions-reactions/slack.json";
import teamsFixtures from "../fixtures/replay/actions-reactions/teams.json";
import {
  createGchatTestContext,
  createSlackTestContext,
  createTeamsTestContext,
  expectSentMessage,
  expectValidAction,
  expectValidReaction,
  type GchatTestContext,
  type SlackTestContext,
  type TeamsTestContext,
} from "./replay-test-utils";

describe("Replay Tests - Actions & Reactions", () => {
  describe("Slack", () => {
    let ctx: SlackTestContext;
    let capturedAction: ActionEvent | null = null;
    let capturedReaction: ReactionEvent | null = null;

    beforeEach(() => {
      vi.clearAllMocks();
      capturedAction = null;
      capturedReaction = null;

      ctx = createSlackTestContext(
        { botName: slackFixtures.botName, botUserId: slackFixtures.botUserId },
        {
          onMention: async (thread) => {
            await thread.subscribe();
          },
          onAction: async (event) => {
            capturedAction = event;
            await event.thread.post(`Action received: ${event.actionId}`);
          },
          onReaction: async (event) => {
            capturedReaction = event;
            await event.thread.post(`Thanks for the ${event.emoji}!`);
          },
        },
      );
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should handle block_actions button click", async () => {
      // First subscribe via mention
      await ctx.sendWebhook(slackFixtures.mention);
      vi.clearAllMocks();

      // Send block_actions payload
      await ctx.sendSlackAction(slackFixtures.action);

      expectValidAction(capturedAction, {
        actionId: "info",
        userId: "U03STHCA1JM",
        userName: "malte",
        adapterName: "slack",
        channelId: "C0A511MBCUW",
        isDM: false,
      });

      expectSentMessage(ctx.mockClient, "Action received: info");
    });

    it("should handle reaction_added event", async () => {
      // First subscribe via mention
      await ctx.sendWebhook(slackFixtures.mention);
      vi.clearAllMocks();

      // Send reaction event
      await ctx.sendWebhook(slackFixtures.reaction);

      expectValidReaction(capturedReaction, {
        emojiName: "thumbs_up",
        rawEmoji: "+1",
        added: true,
        userId: "U03STHCA1JM",
        adapterName: "slack",
        channelId: "C0A511MBCUW",
        messageId: "1767326126.896109",
        isDM: false,
      });

      expectSentMessage(ctx.mockClient, "Thanks for the");
    });

    it("should handle static_select action and extract value from selected_option", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      vi.clearAllMocks();

      await ctx.sendSlackAction(slackFixtures.staticSelectAction);

      expectValidAction(capturedAction, {
        actionId: "quick_action",
        userId: "U03STHCA1JM",
        userName: "malte",
        adapterName: "slack",
        channelId: "C0A511MBCUW",
        isDM: false,
      });

      expect(capturedAction?.value).toBe("greet");
      expectSentMessage(ctx.mockClient, "Action received: quick_action");
    });

    it("should handle radio_buttons action and extract value from selected_option", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      vi.clearAllMocks();

      await ctx.sendSlackAction(slackFixtures.radioButtonsAction);

      expectValidAction(capturedAction, {
        actionId: "plan_selected",
        userId: "U03STHCA1JM",
        userName: "malte",
        adapterName: "slack",
        channelId: "C0A511MBCUW",
        isDM: false,
      });

      expect(capturedAction?.value).toBe("all_text");
      expectSentMessage(ctx.mockClient, "Action received: plan_selected");
    });
  });

  describe("Teams", () => {
    let ctx: TeamsTestContext;
    let capturedAction: ActionEvent | null = null;
    let capturedReaction: ReactionEvent | null = null;

    beforeEach(() => {
      vi.clearAllMocks();
      capturedAction = null;
      capturedReaction = null;

      ctx = createTeamsTestContext(
        { botName: teamsFixtures.botName, appId: teamsFixtures.appId },
        {
          onMention: async (thread) => {
            await thread.subscribe();
          },
          onAction: async (event) => {
            capturedAction = event;
            await event.thread.post(`Action received: ${event.actionId}`);
          },
          onReaction: async (event) => {
            capturedReaction = event;
            await event.thread.post(`Thanks for the ${event.emoji}!`);
          },
        },
      );
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should handle adaptive card action submit", async () => {
      // First subscribe via mention
      await ctx.sendWebhook(teamsFixtures.mention);
      ctx.mockBotAdapter.clearMocks();

      // Send action payload
      await ctx.sendWebhook(teamsFixtures.action);

      expectValidAction(capturedAction, {
        actionId: "info",
        userName: "Malte Ubl",
        adapterName: "teams",
        isDM: false,
      });

      // Teams user ID format
      expect(capturedAction?.user.userId).toContain("29:");

      expectSentMessage(ctx.mockBotAdapter, "Action received: info");
    });

    it("should handle messageReaction event", async () => {
      // First subscribe via mention
      await ctx.sendWebhook(teamsFixtures.mention);
      ctx.mockBotAdapter.clearMocks();

      // Send reaction event
      await ctx.sendWebhook(teamsFixtures.reaction);

      expectValidReaction(capturedReaction, {
        emojiName: "thumbs_up",
        rawEmoji: "like",
        added: true,
        adapterName: "teams",
        isDM: false,
      });

      // Teams user ID format
      expect(capturedReaction?.user.userId).toContain("29:");

      expectSentMessage(ctx.mockBotAdapter, "Thanks for the");
    });
  });

  describe("Google Chat", () => {
    let ctx: GchatTestContext;
    let capturedAction: ActionEvent | null = null;
    let capturedReaction: ReactionEvent | null = null;

    beforeEach(() => {
      vi.clearAllMocks();
      capturedAction = null;
      capturedReaction = null;

      ctx = createGchatTestContext(
        { botName: gchatFixtures.botName, botUserId: gchatFixtures.botUserId },
        {
          onMention: async (thread) => {
            await thread.subscribe();
          },
          onAction: async (event) => {
            capturedAction = event;
            await event.thread.post(`Action received: ${event.actionId}`);
          },
          onReaction: async (event) => {
            capturedReaction = event;
            await event.thread.post(`Thanks for the ${event.emoji}!`);
          },
        },
      );
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should handle card button click", async () => {
      // First subscribe via mention
      await ctx.sendWebhook(gchatFixtures.mention);
      ctx.mockChatApi.clearMocks();

      // Send button click payload
      await ctx.sendWebhook(gchatFixtures.action);

      expectValidAction(capturedAction, {
        actionId: "hello",
        userId: "users/117994873354375860089",
        userName: "Malte Ubl",
        adapterName: "gchat",
        isDM: false,
      });

      // Verify threadId format
      expect(capturedAction?.threadId).toContain("gchat:spaces/");

      expectSentMessage(ctx.mockChatApi, "Action received: hello");
    });

    it("should handle reaction via Pub/Sub", async () => {
      // First subscribe via mention
      await ctx.sendWebhook(gchatFixtures.mention);
      ctx.mockChatApi.clearMocks();

      // Send reaction via Pub/Sub
      await ctx.sendWebhook(gchatFixtures.reaction);

      expectValidReaction(capturedReaction, {
        emojiName: "thumbs_up",
        rawEmoji: "👍",
        added: true,
        userId: "users/117994873354375860089",
        adapterName: "gchat",
      });

      // Verify messageId format
      expect(capturedReaction?.messageId).toContain("messages/");

      expectSentMessage(ctx.mockChatApi, "Thanks for the");
    });
  });
});
