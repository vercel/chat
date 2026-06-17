/**
 * DM flow via conversations.open + inbound message events forwarded through
 * the emulator webhook bridge.
 */

import type { Message, Thread } from "chat";
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
  postAsHuman,
  type SlackEmulatorHandle,
  waitForDelivery,
} from "./utils";

describe("Slack emulator: DM inbound flow", () => {
  let emulator: SlackEmulatorHandle;
  let harness: EmulatorChatHarness;
  let dmChannelId!: string;
  let dmThreadId!: string;

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
    dmThreadId = await harness.adapter.openDM(emulator.humanUserId);
    dmChannelId = harness.adapter.decodeThreadId(dmThreadId).channel;
  });

  afterEach(async () => {
    await harness.teardown();
  });

  it("opens a DM channel via conversations.open", () => {
    expect(dmChannelId.startsWith("D")).toBe(true);
    expect(harness.adapter.isDM(dmThreadId)).toBe(true);
  });

  it("delivers a human DM to onDirectMessage and posts a reply", async () => {
    const captured = vi.fn<(thread: Thread, message: Message) => void>();
    harness.chat.onDirectMessage(async (thread, message) => {
      captured(thread, message);
      await thread.post("DM reply from bot");
    });

    await postAsHuman(emulator, {
      channel: dmChannelId,
      text: "hello in dm",
    });

    await waitForDelivery(emulator, (d) => d.event === "message" && d.success);
    await harness.tracker.waitForAll();

    expect(captured).toHaveBeenCalledTimes(1);
    const [thread, message] = captured.mock.calls[0] ?? [];
    expect(harness.adapter.decodeThreadId(thread.id).channel).toBe(dmChannelId);
    expect(message.text).toBe("hello in dm");

    const replies = emulator.slackStore.messages
      .all()
      .filter(
        (m) => m.channel_id === dmChannelId && m.user === emulator.botUserId
      );
    expect(replies.map((r) => r.text)).toEqual(["DM reply from bot"]);
  });
});
