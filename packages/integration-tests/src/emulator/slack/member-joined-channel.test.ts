/**
 * member_joined_channel event via conversations.join against a channel
 * the bot has not yet joined.
 */

import type { MemberJoinedChannelEvent } from "chat";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createEmulatorChatHarness,
  createSlackEmulator,
  type EmulatorChatHarness,
  joinChannelAsBot,
  type SlackEmulatorHandle,
  seedChannelWithoutBot,
  waitForDelivery,
} from "./utils";

const UNJOINED_CHANNEL_ID = "C_UNJOINED";
const UNJOINED_CHANNEL_NAME = "unjoined-channel";

describe("Slack emulator: member_joined_channel flow", () => {
  let emulator: SlackEmulatorHandle;
  let harness: EmulatorChatHarness;

  beforeAll(async () => {
    emulator = await createSlackEmulator();
  });

  afterAll(async () => {
    await emulator.close();
  });

  beforeEach(async () => {
    seedChannelWithoutBot(emulator, {
      channelId: UNJOINED_CHANNEL_ID,
      name: UNJOINED_CHANNEL_NAME,
    });
    harness = await createEmulatorChatHarness(emulator, {
      withForwarder: true,
    });
  });

  afterEach(async () => {
    await harness.teardown();
  });

  it("delivers member_joined_channel when the bot joins via conversations.join", async () => {
    const captured = vi.fn<(event: MemberJoinedChannelEvent) => void>();
    harness.chat.onMemberJoinedChannel((event) => {
      captured(event);
    });

    await joinChannelAsBot(emulator, UNJOINED_CHANNEL_ID);

    await waitForDelivery(
      emulator,
      (d) => d.event === "member_joined_channel" && d.success
    );
    await harness.tracker.waitForAll();

    expect(captured).toHaveBeenCalledTimes(1);
    expect(captured.mock.calls[0]?.[0]).toMatchObject({
      userId: emulator.botUserId,
      channelId: `slack:${UNJOINED_CHANNEL_ID}:`,
    });

    const channel = emulator.slackStore.channels.findOneBy(
      "channel_id",
      UNJOINED_CHANNEL_ID
    );
    expect(channel?.members).toContain(emulator.botUserId);
  });
});
