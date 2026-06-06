/**
 * Verifies `fetchChannelMessages` and `fetchMessages` against the emulator's
 * conversations.history and conversations.replies APIs using real HTTP rather
 * than mock WebClient calls.
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
  postAsHuman,
  type SlackEmulatorHandle,
  silentLogger,
} from "./utils";

describe("Slack emulator: fetchMessages round-trip", () => {
  let emulator: SlackEmulatorHandle;
  let chat: Chat<{ slack: SlackAdapter }> | undefined;
  let adapter!: SlackAdapter;

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
    await instance.initialize();
    return instance;
  }

  it("returns channel history seeded via the emulator store", async () => {
    await setupChat();

    await postAsHuman(emulator, { text: "older human note" });
    await postAsHuman(emulator, { text: "newer human note" });

    const channelId = adapter.channelIdFromThreadId(
      adapter.encodeThreadId({
        channel: emulator.channelId,
        threadTs: "",
      })
    );

    const result = await adapter.fetchChannelMessages(channelId, { limit: 10 });

    expect(result.messages.length).toBeGreaterThanOrEqual(2);
    expect(result.messages.map((m) => m.text)).toEqual(
      expect.arrayContaining(["older human note", "newer human note"])
    );
  });

  it("returns threaded replies via conversations.replies", async () => {
    const activeChat = await setupChat();
    const tracker = createWaitUntilTracker();

    activeChat.onNewMention(async (thread) => {
      await thread.post("bot reply one");
      await thread.post("bot reply two");
    });

    const threadTs = "1700000000.300001";
    const event = createSlackEvent({
      type: "app_mention",
      text: `<@${EMULATOR_BOT_USER_ID}> thread please`,
      userId: emulator.humanUserId,
      messageTs: threadTs,
      threadTs,
      channel: emulator.channelId,
      teamId: emulator.teamId,
    });
    const req = createSlackWebhookRequest(event, emulator.signingSecret);
    await activeChat.webhooks.slack(req, { waitUntil: tracker.waitUntil });
    await tracker.waitForAll();

    const threadId = adapter.encodeThreadId({
      channel: emulator.channelId,
      threadTs,
    });
    const result = await adapter.fetchMessages(threadId, { limit: 10 });

    expect(result.messages.map((m) => m.text)).toEqual(
      expect.arrayContaining(["bot reply one", "bot reply two"])
    );
  });
});
