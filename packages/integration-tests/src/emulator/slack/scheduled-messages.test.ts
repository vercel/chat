/**
 * Scheduled message round-trip via chat.scheduleMessage and cancel().
 */

import type { ScheduledMessage } from "chat";
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
  type SlackEmulatorHandle,
} from "./utils";

const ONE_HOUR_MS = 60 * 60 * 1000;

describe("Slack emulator: scheduled messages", () => {
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

  it("schedules a message in the emulator store and can cancel it", async () => {
    // Capture the scheduled handle from the handler, but run the assertions in
    // the test body. Chat.processMessage swallows handler rejections (they are
    // only logged via waitUntil), so an `expect` thrown inside onNewMention
    // would never fail the test — the assertions must live where Vitest sees
    // them.
    let scheduled: ScheduledMessage | undefined;
    harness.chat.onNewMention(async (thread) => {
      const postAt = new Date(Date.now() + ONE_HOUR_MS);
      scheduled = await thread.schedule("scheduled hello", { postAt });
    });

    const threadTs = "1700000000.600001";
    await deliverMention(emulator, harness, threadTs, "schedule please");

    // Guard against a vacuous pass: if onNewMention never fired, none of the
    // scheduling behavior was exercised.
    if (!scheduled) {
      throw new Error("onNewMention handler did not fire");
    }
    expect(scheduled.scheduledMessageId).toBeTruthy();

    const stored = emulator.slackStore.scheduledMessages
      .all()
      .find((m) => m.scheduled_message_id === scheduled?.scheduledMessageId);
    expect(stored?.text).toBe("scheduled hello");
    expect(stored?.channel_id).toBe(emulator.channelId);

    await scheduled.cancel();

    const afterCancel = emulator.slackStore.scheduledMessages
      .all()
      .find((m) => m.scheduled_message_id === scheduled?.scheduledMessageId);
    expect(afterCancel).toBeUndefined();
  });
});
