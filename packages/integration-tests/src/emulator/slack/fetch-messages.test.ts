/**
 * Verifies `fetchChannelMessages` and `fetchMessages` against the emulator's
 * conversations.history and conversations.replies APIs using real HTTP rather
 * than mock WebClient calls.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  createEmulatorChatHarness,
  createSlackEmulator,
  deliverMention,
  type EmulatorChatHarness,
  postAsHuman,
  type SlackEmulatorHandle,
} from "./utils";

describe("Slack emulator: fetchMessages round-trip", () => {
  let emulator: SlackEmulatorHandle;
  let harness: EmulatorChatHarness;

  beforeAll(async () => {
    emulator = await createSlackEmulator();
  });

  afterAll(async () => {
    await emulator.close();
  });

  beforeEach(async () => {
    harness = await createEmulatorChatHarness(emulator);
  });

  afterEach(async () => {
    await harness.teardown();
  });

  it("returns channel history seeded via the emulator store", async () => {
    await postAsHuman(emulator, { text: "older human note" });
    await postAsHuman(emulator, { text: "newer human note" });

    // fetchChannelMessages takes the channel-level id (`slack:CHANNEL`).
    const result = await harness.adapter.fetchChannelMessages(
      `slack:${emulator.channelId}`,
      { limit: 10 }
    );

    expect(result.messages.length).toBeGreaterThanOrEqual(2);
    expect(result.messages.map((m) => m.text)).toEqual(
      expect.arrayContaining(["older human note", "newer human note"])
    );
  });

  it("returns threaded replies via conversations.replies", async () => {
    harness.chat.onNewMention(async (thread) => {
      await thread.post("bot reply one");
      await thread.post("bot reply two");
    });

    const threadTs = "1700000000.300001";
    await deliverMention(emulator, harness, threadTs, "thread please");

    const threadId = harness.adapter.encodeThreadId({
      channel: emulator.channelId,
      threadTs,
    });
    const result = await harness.adapter.fetchMessages(threadId, { limit: 10 });

    expect(result.messages.map((m) => m.text)).toEqual(
      expect.arrayContaining(["bot reply one", "bot reply two"])
    );
  });
});
