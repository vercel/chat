/**
 * Scheduled message round-trip via chat.scheduleMessage and cancel().
 */

import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat } from "chat";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSlackEvent, createSlackWebhookRequest } from "../../slack-utils";
import { createWaitUntilTracker } from "../../test-scenarios";
import {
  createSlackEmulator,
  EMULATOR_BOT_NAME,
  EMULATOR_BOT_TOKEN,
  EMULATOR_BOT_USER_ID,
  type SlackEmulatorHandle,
  silentLogger,
} from "./utils";

const ONE_HOUR_MS = 60 * 60 * 1000;

describe("Slack emulator: scheduled messages", () => {
  let emulator: SlackEmulatorHandle;
  let chat: Chat<{ slack: SlackAdapter }> | undefined;
  let adapter!: SlackAdapter;
  let tracker!: ReturnType<typeof createWaitUntilTracker>;

  beforeAll(async () => {
    emulator = await createSlackEmulator();
  });

  afterAll(async () => {
    await emulator.close();
  });

  afterEach(async () => {
    if (chat) {
      await chat.shutdown();
      chat = undefined;
    }
    emulator.reset();
  });

  async function setupChat(): Promise<Chat<{ slack: SlackAdapter }>> {
    adapter = createSlackAdapter({
      apiUrl: emulator.apiUrl,
      botToken: EMULATOR_BOT_TOKEN,
      signingSecret: emulator.signingSecret,
      userName: EMULATOR_BOT_NAME,
      logger: silentLogger,
    });
    const instance = new Chat({
      userName: EMULATOR_BOT_NAME,
      adapters: { slack: adapter },
      state: createMemoryState(),
      logger: silentLogger,
    });
    chat = instance;
    tracker = createWaitUntilTracker();
    await instance.initialize();
    return instance;
  }

  it("schedules a message in the emulator store and can cancel it", async () => {
    const activeChat = await setupChat();

    activeChat.onNewMention(async (thread) => {
      const postAt = new Date(Date.now() + ONE_HOUR_MS);
      const scheduled = await thread.schedule("scheduled hello", { postAt });
      expect(scheduled.scheduledMessageId).toBeTruthy();

      const stored = emulator.slackStore.scheduledMessages
        .all()
        .find((m) => m.scheduled_message_id === scheduled.scheduledMessageId);
      expect(stored?.text).toBe("scheduled hello");
      expect(stored?.channel_id).toBe(emulator.channelId);

      await scheduled.cancel();

      const afterCancel = emulator.slackStore.scheduledMessages
        .all()
        .find((m) => m.scheduled_message_id === scheduled.scheduledMessageId);
      expect(afterCancel).toBeUndefined();
    });

    const threadTs = "1700000000.600001";
    const event = createSlackEvent({
      type: "app_mention",
      text: `<@${EMULATOR_BOT_USER_ID}> schedule please`,
      userId: emulator.humanUserId,
      messageTs: threadTs,
      threadTs,
      channel: emulator.channelId,
      teamId: emulator.teamId,
    });
    const req = createSlackWebhookRequest(event, emulator.signingSecret);
    await activeChat.webhooks.slack(req, { waitUntil: tracker.waitUntil });
    await tracker.waitForAll();
  });
});
