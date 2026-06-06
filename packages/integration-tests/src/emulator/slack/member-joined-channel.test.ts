/**
 * member_joined_channel event via conversations.join against a channel
 * the bot has not yet joined.
 */

import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat, type MemberJoinedChannelEvent } from "chat";
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
import { createWaitUntilTracker } from "../../test-scenarios";
import {
  createSlackEmulator,
  EMULATOR_BOT_NAME,
  EMULATOR_BOT_TOKEN,
  joinChannelAsBot,
  type SlackEmulatorHandle,
  type SlackWebhookForwarder,
  seedChannelWithoutBot,
  silentLogger,
  startSlackWebhookForwarder,
  waitForDelivery,
} from "./utils";

const UNJOINED_CHANNEL_ID = "C_UNJOINED";
const UNJOINED_CHANNEL_NAME = "unjoined-channel";

describe("Slack emulator: member_joined_channel flow", () => {
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
    seedChannelWithoutBot(emulator, {
      channelId: UNJOINED_CHANNEL_ID,
      name: UNJOINED_CHANNEL_NAME,
    });

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

  it("delivers member_joined_channel when the bot joins via conversations.join", async () => {
    if (!chat) {
      throw new Error("chat not initialized");
    }

    const captured = vi.fn<(event: MemberJoinedChannelEvent) => void>();
    chat.onMemberJoinedChannel((event) => {
      captured(event);
    });

    await joinChannelAsBot(emulator, UNJOINED_CHANNEL_ID);

    await waitForDelivery(
      emulator,
      (d) => d.event === "member_joined_channel" && d.success
    );
    await tracker.waitForAll();

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
