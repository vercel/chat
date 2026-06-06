/**
 * DM flow via conversations.open + inbound message events forwarded through
 * the emulator webhook bridge.
 */

import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat, type Message, type Thread } from "chat";
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
  postAsHuman,
  type SlackEmulatorHandle,
  type SlackWebhookForwarder,
  silentLogger,
  startSlackWebhookForwarder,
  waitForDelivery,
} from "./utils";

describe("Slack emulator: DM inbound flow", () => {
  let emulator: SlackEmulatorHandle;
  let chat: Chat<{ slack: SlackAdapter }>;
  let adapter: SlackAdapter;
  let forwarder: SlackWebhookForwarder;
  let tracker: ReturnType<typeof createWaitUntilTracker>;
  let dmChannelId: string;
  let dmThreadId: string;

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

    dmThreadId = await adapter.openDM(emulator.humanUserId);
    dmChannelId = adapter.decodeThreadId(dmThreadId).channel;

    forwarder = await startSlackWebhookForwarder({
      signingSecret: emulator.signingSecret,
      teamId: emulator.teamId,
      webhooks: emulator.webhooks,
      onWebhook: (request) =>
        chat.webhooks.slack(request, { waitUntil: tracker.waitUntil }),
    });
  });

  afterEach(async () => {
    if (forwarder) {
      await forwarder.close();
    }
    if (chat) {
      await chat.shutdown();
    }
    emulator.reset();
  });

  it("opens a DM channel via conversations.open", () => {
    expect(dmChannelId.startsWith("D")).toBe(true);
    expect(adapter.isDM(dmThreadId)).toBe(true);
  });

  it("delivers a human DM to onDirectMessage and posts a reply", async () => {
    const captured = vi.fn<(thread: Thread, message: Message) => void>();
    chat.onDirectMessage(async (thread, message) => {
      captured(thread, message);
      await thread.post("DM reply from bot");
    });

    await postAsHuman(emulator, {
      channel: dmChannelId,
      text: "hello in dm",
    });

    await waitForDelivery(emulator, (d) => d.event === "message" && d.success);
    await tracker.waitForAll();

    expect(captured).toHaveBeenCalledTimes(1);
    const [thread, message] = captured.mock.calls[0] ?? [];
    expect(adapter.decodeThreadId(thread.id).channel).toBe(dmChannelId);
    expect(message.text).toBe("hello in dm");

    const replies = emulator.slackStore.messages
      .all()
      .filter(
        (m) => m.channel_id === dmChannelId && m.user === emulator.botUserId
      );
    expect(replies.map((r) => r.text)).toEqual(["DM reply from bot"]);
  });
});
