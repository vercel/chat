/**
 * Inbound `reaction_added` flow: a human reacts to a bot message in the
 * emulator, the event is forwarded to `chat.webhooks.slack(...)`, and
 * `onReaction` handlers run with a live Thread.
 */

import type { ReactionEvent } from "chat";
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
  addReactionAsHuman,
  createEmulatorChatHarness,
  createSlackEmulator,
  deliverMention,
  EMULATOR_BOT_USER_ID,
  type EmulatorChatHarness,
  type SlackEmulatorHandle,
  waitForDelivery,
} from "./utils";

describe("Slack emulator: inbound reaction_added flow", () => {
  let emulator: SlackEmulatorHandle;
  let harness: EmulatorChatHarness;

  beforeAll(async () => {
    emulator = await createSlackEmulator();
  });

  afterAll(async () => {
    await emulator.close();
  });

  beforeEach(async () => {
    harness = await createEmulatorChatHarness(emulator, {
      withForwarder: true,
    });
  });

  afterEach(async () => {
    await harness.teardown();
  });

  it("delivers reaction_added to onReaction and allows a threaded reply", async () => {
    const captured = vi.fn<(event: ReactionEvent) => void>();
    harness.chat.onReaction(async (event) => {
      captured(event);
      await event.thread?.post(`Thanks for the ${event.emoji}!`);
    });

    harness.chat.onNewMention(async (thread) => {
      await thread.post("react to me");
    });

    const threadTs = "1700000000.200001";
    await deliverMention(emulator, harness, threadTs);

    const botMessage = emulator.slackStore.messages
      .all()
      .find(
        (m) =>
          m.channel_id === emulator.channelId && m.user === EMULATOR_BOT_USER_ID
      );
    expect(botMessage?.ts).toBeDefined();
    if (!botMessage?.ts) {
      return;
    }

    await addReactionAsHuman(emulator, {
      channel: emulator.channelId,
      name: "tada",
      timestamp: botMessage.ts,
    });

    await waitForDelivery(
      emulator,
      (d) => d.event === "reaction_added" && d.success
    );
    await harness.tracker.waitForAll();

    expect(captured).toHaveBeenCalledTimes(1);
    expect(captured.mock.calls[0]?.[0]).toMatchObject({
      adapter: harness.adapter,
      rawEmoji: "tada",
      user: expect.objectContaining({ userId: emulator.humanUserId }),
    });

    const replies = emulator.slackStore.messages
      .all()
      .filter(
        (m) =>
          m.channel_id === emulator.channelId &&
          m.user === EMULATOR_BOT_USER_ID &&
          m.text.includes("Thanks for the :tada:")
      );
    expect(replies).toHaveLength(1);
  });
});
