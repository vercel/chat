/**
 * Inbound `reaction_added` flow: a human reacts to a bot message in the
 * emulator, the event is forwarded to `chat.webhooks.slack(...)`, and
 * `onReaction` handlers run with a live Thread.
 */

import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat, type ReactionEvent } from "chat";
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
import { createSlackEvent, createSlackWebhookRequest } from "../../slack-utils";
import { createWaitUntilTracker } from "../../test-scenarios";
import {
  addReactionAsHuman,
  createSlackEmulator,
  EMULATOR_BOT_NAME,
  EMULATOR_BOT_TOKEN,
  EMULATOR_BOT_USER_ID,
  type SlackEmulatorHandle,
  type SlackWebhookForwarder,
  silentLogger,
  startSlackWebhookForwarder,
  waitForDelivery,
} from "./utils";

describe("Slack emulator: inbound reaction_added flow", () => {
  let emulator: SlackEmulatorHandle;
  let chat: Chat<{ slack: SlackAdapter }> | undefined;
  let adapter!: SlackAdapter;
  let forwarder: SlackWebhookForwarder | undefined;
  let tracker!: ReturnType<typeof createWaitUntilTracker>;

  beforeAll(async () => {
    emulator = await createSlackEmulator();
  });

  afterAll(async () => {
    await emulator.close();
  });

  beforeEach(async () => {
    adapter = createSlackAdapter({
      apiUrl: emulator.apiUrl,
      botToken: EMULATOR_BOT_TOKEN,
      signingSecret: emulator.signingSecret,
      userName: EMULATOR_BOT_NAME,
      logger: silentLogger,
    });
    chat = new Chat({
      userName: EMULATOR_BOT_NAME,
      adapters: { slack: adapter },
      state: createMemoryState(),
      logger: silentLogger,
    });
    tracker = createWaitUntilTracker();
    await chat.initialize();

    const activeChat = chat;
    forwarder = await startSlackWebhookForwarder({
      signingSecret: emulator.signingSecret,
      teamId: emulator.teamId,
      webhooks: emulator.webhooks,
      onWebhook: (request) =>
        activeChat.webhooks.slack(request, { waitUntil: tracker.waitUntil }),
    });
  });

  afterEach(async () => {
    if (forwarder) {
      await forwarder.close();
      forwarder = undefined;
    }
    if (chat) {
      await chat.shutdown();
      chat = undefined;
    }
    emulator.reset();
  });

  async function deliverMention(threadTs: string) {
    if (!chat) {
      throw new Error("chat not initialized");
    }

    const event = createSlackEvent({
      type: "app_mention",
      text: `<@${EMULATOR_BOT_USER_ID}> ping`,
      userId: emulator.humanUserId,
      messageTs: threadTs,
      threadTs,
      channel: emulator.channelId,
      teamId: emulator.teamId,
    });
    const req = createSlackWebhookRequest(event, emulator.signingSecret);
    const res = await chat.webhooks.slack(req, {
      waitUntil: tracker.waitUntil,
    });
    if (res.status !== 200) {
      throw new Error(`webhook handler returned ${res.status}`);
    }
    await tracker.waitForAll();
  }

  it("delivers reaction_added to onReaction and allows a threaded reply", async () => {
    if (!chat) {
      throw new Error("chat not initialized");
    }

    const captured = vi.fn<(event: ReactionEvent) => void>();
    chat.onReaction(async (event) => {
      captured(event);
      await event.thread?.post(`Thanks for the ${event.emoji}!`);
    });

    chat.onNewMention(async (thread) => {
      await thread.post("react to me");
    });

    const threadTs = "1700000000.200001";
    await deliverMention(threadTs);

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
    await tracker.waitForAll();

    expect(captured).toHaveBeenCalledTimes(1);
    expect(captured.mock.calls[0]?.[0]).toMatchObject({
      adapter,
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
