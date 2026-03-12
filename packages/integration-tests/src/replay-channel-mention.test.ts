/**
 * Replay test for channel mention resolution.
 *
 * Verifies that bare channel mentions like <#C123> in Slack messages
 * get resolved to display names via conversations.info API.
 *
 * Recorded from: session-channel-names-6a569a0b19d8ef6b90f47681710abe13f48b9c10
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtures from "../fixtures/replay/channel-mention/slack.json";
import {
  createSlackTestContext,
  expectSentMessage,
  expectValidMention,
  type SlackTestContext,
} from "./replay-test-utils";

describe("Replay - Channel Mention Resolution", () => {
  let ctx: SlackTestContext;

  beforeEach(() => {
    vi.clearAllMocks();

    ctx = createSlackTestContext(
      { botName: fixtures.botName, botUserId: fixtures.botUserId },
      {
        onMention: async (thread, message) => {
          await thread.subscribe();
          await thread.post(`I see: ${message.text}`);
        },
      }
    );

    // Mock conversations.info to return a channel name for the bare channel mention
    ctx.mockClient.conversations.info.mockResolvedValue({
      ok: true,
      channel: { id: "C00FAKECHAN2", name: "test-help-channel" },
    });
  });

  afterEach(async () => {
    await ctx.chat.shutdown();
  });

  it("should resolve bare <#C123> channel mention to channel name", async () => {
    await ctx.sendWebhook(fixtures.mention);

    expectValidMention(ctx.captured, {
      adapterName: "slack",
      authorUserId: "U00FAKEUSER1",
      threadIdContains: "C00FAKECHAN1",
    });

    // The bare channel mention <#C00FAKECHAN2> should be resolved
    // to #test-help-channel in the parsed message text
    expect(ctx.captured.mentionMessage?.text).toContain("#test-help-channel");

    // conversations.info should have been called to resolve the channel name
    expect(ctx.mockClient.conversations.info).toHaveBeenCalled();

    expectSentMessage(ctx.mockClient, "#test-help-channel");
  });

  it("should leave labeled channel mentions unchanged", async () => {
    // Create a variant with a labeled channel mention <#C123|already-named>
    const labeledFixture = {
      ...fixtures.mention,
      event: {
        ...fixtures.mention.event,
        text: "<@U00FAKEBOT01> Check <#C00FAKECHAN2|already-named>",
        ts: "1773327463.999999",
        event_ts: "1773327463.999999",
      },
    };

    ctx.mockClient.conversations.info.mockClear();
    await ctx.sendWebhook(labeledFixture);

    // The labeled mention should preserve its name
    expect(ctx.captured.mentionMessage?.text).toContain("#already-named");

    // conversations.info should NOT be called for labeled channel mentions
    expect(ctx.mockClient.conversations.info).not.toHaveBeenCalled();
  });
});
