/**
 * Replay tests for Channel abstraction.
 *
 * Tests channel-level operations (thread.channel, channel.messages,
 * channel.post, channel.fetchMetadata) using recorded webhook payloads.
 *
 * Fixtures are loaded from fixtures/replay/channel/
 */

import type { ActionEvent, Channel, Message } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import discordFixtures from "../fixtures/replay/channel/discord.json";
import gchatFixtures from "../fixtures/replay/channel/gchat.json";
import slackFixtures from "../fixtures/replay/channel/slack.json";
import teamsFixtures from "../fixtures/replay/channel/teams.json";
import {
  createDiscordTestContext,
  createGchatTestContext,
  createSlackTestContext,
  createTeamsTestContext,
  type DiscordTestContext,
  expectValidAction,
  type GchatTestContext,
  type SlackTestContext,
  type TeamsTestContext,
} from "./replay-test-utils";

describe("Replay Tests - Channel", () => {
  describe("Slack", () => {
    let ctx: SlackTestContext;
    let capturedAction: ActionEvent | null = null;

    beforeEach(() => {
      capturedAction = null;

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
          onAction: async (event) => {
            capturedAction = event;
          },
        },
      );

      // Mock conversations.info for fetchMetadata
      ctx.mockClient.conversations.info.mockResolvedValue({
        ok: true,
        channel: {
          id: "C0A511MBCUW",
          name: "chat-sdk",
          is_im: false,
          num_members: 5,
          purpose: { value: "Chat SDK testing" },
          topic: { value: "Channel topic" },
        },
      });

      // Mock conversations.history for channel messages
      ctx.mockClient.conversations.history.mockResolvedValue({
        ok: true,
        messages: [
          {
            type: "message",
            user: "U03STHCA1JM",
            text: "<@U0A56JUFP9A> Hey",
            ts: "1771287144.743569",
            thread_ts: "1771287144.743569",
          },
          {
            type: "message",
            user: "U03STHCA1JM",
            text: "Bar2",
            ts: "1771287114.209979",
          },
          {
            type: "message",
            user: "U03STHCA1JM",
            text: "Foo2",
            ts: "1771287111.962609",
          },
        ],
        has_more: false,
      });

      // Mock users.info for user lookups
      ctx.mockClient.users.info.mockResolvedValue({
        ok: true,
        user: {
          name: "malte",
          real_name: "Malte Ubl",
          profile: { display_name: "Malte Ubl", real_name: "Malte Ubl" },
        },
      });
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should handle channel-post action and access thread.channel", async () => {
      // First subscribe via mention
      await ctx.sendWebhook(slackFixtures.mention);

      // Send channel-post action
      await ctx.sendSlackAction(slackFixtures.channel_post_action);

      expectValidAction(capturedAction, {
        actionId: "channel-post",
        userId: "U03STHCA1JM",
        userName: "malte",
        adapterName: "slack",
        channelId: "C0A511MBCUW",
        isDM: false,
      });
    });

    it("should derive correct channel ID from thread", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      await ctx.sendSlackAction(slackFixtures.channel_post_action);

      const channel = capturedAction?.thread.channel;
      expect(channel).toBeDefined();
      expect(channel?.id).toBe("slack:C0A511MBCUW");
    });

    it("should fetch channel metadata", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      await ctx.sendSlackAction(slackFixtures.channel_post_action);

      const channel = capturedAction?.thread.channel;
      expect(channel).toBeDefined();

      const info = await channel?.fetchMetadata();
      expect(info?.name).toBe("#chat-sdk");
      expect(info?.isDM).toBe(false);
      expect(info?.memberCount).toBe(5);
      expect(info?.metadata).toEqual({
        purpose: "Chat SDK testing",
        topic: "Channel topic",
      });

      // Name should be cached after fetchMetadata
      expect(channel?.name).toBe("#chat-sdk");
    });

    it("should iterate channel messages newest first", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      await ctx.sendSlackAction(slackFixtures.channel_post_action);

      const channel = capturedAction?.thread.channel as Channel;

      const messages: Message[] = [];
      for await (const msg of channel.messages) {
        messages.push(msg);
      }

      // Messages should be in reverse chronological order (newest first)
      expect(messages).toHaveLength(3);
      // Newest first (conversations.history returns newest-first, reversed to
      // chronological within page, then reversed again for backward iteration)
      expect(messages[0].text).toContain("Hey");
      expect(messages[1].text).toBe("Bar2");
      expect(messages[2].text).toBe("Foo2");

      // Verify fetchChannelMessages was called with backward direction
      expect(ctx.mockClient.conversations.history).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C0A511MBCUW",
        }),
      );
    });

    it("should post to channel top-level via channel.post", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      await ctx.sendSlackAction(slackFixtures.channel_post_action);

      const channel = capturedAction?.thread.channel as Channel;

      await channel.post("Hello from channel!");

      // Should call postMessage (via postChannelMessage which delegates to
      // postMessage with empty threadTs)
      expect(ctx.mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C0A511MBCUW",
          text: "Hello from channel!",
        }),
      );
    });

    it("should allow breaking out of channel.messages early", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      await ctx.sendSlackAction(slackFixtures.channel_post_action);

      const channel = capturedAction?.thread.channel as Channel;

      // Only get first 2 messages
      const messages: Message[] = [];
      for await (const msg of channel.messages) {
        messages.push(msg);
        if (messages.length >= 2) break;
      }

      expect(messages).toHaveLength(2);
    });

    it("should cache channel instance on thread", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      await ctx.sendSlackAction(slackFixtures.channel_post_action);

      const thread = capturedAction?.thread;
      const channel1 = thread?.channel;
      const channel2 = thread?.channel;
      expect(channel1).toBe(channel2);
    });
  });

  describe("Google Chat", () => {
    let ctx: GchatTestContext;
    let capturedAction: ActionEvent | null = null;

    beforeEach(() => {
      vi.clearAllMocks();
      capturedAction = null;

      ctx = createGchatTestContext(
        {
          botName: gchatFixtures.botName,
          botUserId: gchatFixtures.botUserId,
        },
        {
          onMention: async (thread) => {
            await thread.subscribe();
            await thread.post("Welcome!");
          },
          onAction: async (event) => {
            capturedAction = event;
          },
        },
      );
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should handle channel-post action and access thread.channel", async () => {
      // First subscribe via mention
      await ctx.sendWebhook(gchatFixtures.mention);
      ctx.mockChatApi.clearMocks();

      // Send channel-post button click
      await ctx.sendWebhook(gchatFixtures.channel_post_action);

      expectValidAction(capturedAction, {
        actionId: "channel-post",
        userId: gchatFixtures.userId,
        userName: gchatFixtures.userDisplayName,
        adapterName: "gchat",
        isDM: false,
      });
    });

    it("should derive correct channel ID from thread", async () => {
      await ctx.sendWebhook(gchatFixtures.mention);
      await ctx.sendWebhook(gchatFixtures.channel_post_action);

      const channel = capturedAction?.thread.channel;
      expect(channel).toBeDefined();
      expect(channel?.id).toBe(`gchat:${gchatFixtures.spaceName}`);
    });

    it("should fetch channel metadata via spaces.get", async () => {
      await ctx.sendWebhook(gchatFixtures.mention);
      await ctx.sendWebhook(gchatFixtures.channel_post_action);

      const channel = capturedAction?.thread.channel;
      expect(channel).toBeDefined();

      const info = await channel?.fetchMetadata();
      expect(info?.id).toBe(`gchat:${gchatFixtures.spaceName}`);
      // MockChatApi returns "Test Space" as displayName
      expect(info?.name).toBe("Test Space");
      expect(info?.metadata).toBeDefined();
    });

    it("should post to channel top-level (no thread field)", async () => {
      await ctx.sendWebhook(gchatFixtures.mention);
      await ctx.sendWebhook(gchatFixtures.channel_post_action);

      const channel = capturedAction?.thread.channel as Channel;
      ctx.mockChatApi.clearMocks();

      await channel.post("Hello from channel!");

      // Verify spaces.messages.create was called
      expect(ctx.mockChatApi.spaces.messages.create).toHaveBeenCalled();

      // The sent message should have no thread field (top-level post)
      const sentMessage = ctx.mockChatApi.sentMessages[0];
      expect(sentMessage).toBeDefined();
      expect(sentMessage?.parent).toBe(gchatFixtures.spaceName);
      expect(sentMessage?.text).toBe("Hello from channel!");
      // Top-level post: thread should be undefined (not scoped to a thread)
      expect(sentMessage?.thread).toBeUndefined();
    });

    it("should cache channel instance on thread", async () => {
      await ctx.sendWebhook(gchatFixtures.mention);
      await ctx.sendWebhook(gchatFixtures.channel_post_action);

      const thread = capturedAction?.thread;
      const channel1 = thread?.channel;
      const channel2 = thread?.channel;
      expect(channel1).toBe(channel2);
    });
  });

  describe("Discord", () => {
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

    it("should derive correct channel ID from thread via mention", async () => {
      ctx = await createDiscordTestContext(
        { applicationId: discordFixtures.applicationId },
        {
          onMention: async (thread) => {
            const channel = thread.channel;
            expect(channel).toBeDefined();
            expect(channel.id).toBe(
              `discord:${discordFixtures.guildId}:${discordFixtures.channelId}`,
            );
          },
        },
      );

      await ctx.sendGatewayEvent(discordFixtures.mention);
    });

    it("should handle channel-post button click in thread", async () => {
      ctx = await createDiscordTestContext(
        { applicationId: discordFixtures.applicationId },
        {
          onAction: async (event) => {
            capturedAction = event;
          },
        },
      );

      // Button click happens inside a thread (channel type 11 with parent_id)
      const response = await ctx.sendWebhook(
        discordFixtures.channel_post_action as Record<string, unknown>,
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.type).toBe(6); // DEFERRED_UPDATE_MESSAGE

      expectValidAction(capturedAction, {
        actionId: "channel-post",
        userId: discordFixtures.userId,
        userName: discordFixtures.userName,
        adapterName: "discord",
        isDM: false,
      });
    });

    it("should resolve parent channel from thread interaction", async () => {
      ctx = await createDiscordTestContext(
        { applicationId: discordFixtures.applicationId },
        {
          onAction: async (event) => {
            capturedAction = event;
          },
        },
      );

      await ctx.sendWebhook(
        discordFixtures.channel_post_action as Record<string, unknown>,
      );

      // The action's thread should have the 4-part ID (guild:channel:thread)
      expect(capturedAction?.thread.id).toBe(
        `discord:${discordFixtures.guildId}:${discordFixtures.channelId}:${discordFixtures.threadChannelId}`,
      );

      // Channel should point to the parent channel, not the thread
      const channel = capturedAction?.thread.channel;
      expect(channel).toBeDefined();
      expect(channel?.id).toBe(
        `discord:${discordFixtures.guildId}:${discordFixtures.channelId}`,
      );
    });

    it("should have channel.isDM = false for guild channels", async () => {
      ctx = await createDiscordTestContext(
        { applicationId: discordFixtures.applicationId },
        {
          onMention: async (thread) => {
            const channel = thread.channel;
            expect(channel.isDM).toBe(false);
          },
        },
      );

      await ctx.sendGatewayEvent(discordFixtures.mention);
    });

    it("should post to parent channel via channel.post", async () => {
      ctx = await createDiscordTestContext(
        { applicationId: discordFixtures.applicationId },
        {
          onAction: async (event) => {
            capturedAction = event;
          },
        },
      );

      await ctx.sendWebhook(
        discordFixtures.channel_post_action as Record<string, unknown>,
      );

      const channel = capturedAction?.thread.channel as Channel;
      await channel.post("Hello from channel!");

      // Verify message was posted to the parent channel, not the thread
      expect(ctx.mockApi.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Hello from channel!",
        }),
      );
    });
  });

  describe("Teams", () => {
    let ctx: TeamsTestContext;
    let capturedAction: ActionEvent | null = null;

    beforeEach(() => {
      vi.clearAllMocks();
      capturedAction = null;

      ctx = createTeamsTestContext(
        {
          botName: teamsFixtures.botName,
          appId: teamsFixtures.appId,
        },
        {
          onMention: async (thread) => {
            await thread.subscribe();
          },
          onAction: async (event) => {
            capturedAction = event;
          },
        },
      );
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should handle channel-post action from production recording", async () => {
      // First subscribe via mention
      await ctx.sendWebhook(teamsFixtures.mention);

      // Send channel-post action (Action.Submit with value.actionId)
      await ctx.sendWebhook(teamsFixtures.channel_post_action);

      expectValidAction(capturedAction, {
        actionId: "channel-post",
        userId: teamsFixtures.userId,
        userName: teamsFixtures.userName,
        adapterName: "teams",
      });
    });

    it("should derive correct channel ID (strip messageid)", async () => {
      await ctx.sendWebhook(teamsFixtures.mention);
      await ctx.sendWebhook(teamsFixtures.channel_post_action);

      const channel = capturedAction?.thread.channel;
      expect(channel).toBeDefined();

      // Channel ID should use the base conversation ID without ;messageid=
      // Encoded as teams:{b64(baseConversationId)}:{b64(serviceUrl)}
      const channelId = channel?.id;
      expect(channelId).toBeDefined();
      expect(channelId).toContain("teams:");

      // Decode and verify it doesn't contain messageid
      const parts = channelId?.split(":");
      if (parts?.[1]) {
        const decodedConvId = Buffer.from(parts[1], "base64url").toString(
          "utf-8",
        );
        expect(decodedConvId).toBe(teamsFixtures.baseConversationId);
        expect(decodedConvId).not.toContain("messageid");
      }
    });

    it("should post to channel top-level via channel.post", async () => {
      await ctx.sendWebhook(teamsFixtures.mention);
      await ctx.sendWebhook(teamsFixtures.channel_post_action);

      const channel = capturedAction?.thread.channel as Channel;
      await channel.post("Hello from channel!");

      // Verify sendActivity was called via the mock bot adapter
      expect(ctx.mockBotAdapter.sentActivities.length).toBeGreaterThan(0);
    });

    it("should cache channel instance on thread", async () => {
      await ctx.sendWebhook(teamsFixtures.mention);
      await ctx.sendWebhook(teamsFixtures.channel_post_action);

      const thread = capturedAction?.thread;
      const channel1 = thread?.channel;
      const channel2 = thread?.channel;
      expect(channel1).toBe(channel2);
    });
  });
});
