/**
 * Inbound `event_callback` flow: a human posts a message to the emulator,
 * which dispatches a webhook to our local forwarder, which signs the body and
 * hands it to `chat.webhooks.slack(...)`. The SDK's handlers then run with a
 * live Thread, and we assert that the bot's reply lands back in the emulator.
 *
 * This is the only Slack adapter test in the repo that exercises a full
 * inbound-then-outbound round-trip without any hand-crafted webhook payloads.
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
  EMULATOR_BOT_USER_ID,
  postAsHuman,
  type SlackEmulatorHandle,
  type SlackWebhookForwarder,
  silentLogger,
  startSlackWebhookForwarder,
  waitForDelivery,
} from "./utils";

const SLACK_THREAD_ID_PATTERN = /^slack:C_TEST:/;
const HELP_PATTERN = /help/i;
const ANY_CHAR_PATTERN = /.+/;

describe("Slack emulator: inbound event_callback flow", () => {
  let emulator: SlackEmulatorHandle;
  let chat: Chat<{ slack: SlackAdapter }>;
  let adapter: SlackAdapter;
  let forwarder: SlackWebhookForwarder;
  let tracker: ReturnType<typeof createWaitUntilTracker>;

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

    forwarder = await startSlackWebhookForwarder({
      signingSecret: emulator.signingSecret,
      teamId: emulator.teamId,
      webhooks: emulator.webhooks,
      onWebhook: (request) =>
        chat.webhooks.slack(request, { waitUntil: tracker.waitUntil }),
    });
  });

  afterEach(async () => {
    await forwarder.close();
    await chat.shutdown();
    emulator.reset();
  });

  it("delivers a human-authored message to onNewMention and posts a reply", async () => {
    const captured = vi.fn<(thread: Thread, message: Message) => void>();
    chat.onNewMention(async (thread, message) => {
      captured(thread, message);
      await thread.post("Hi there!");
    });

    await postAsHuman(emulator, {
      text: `<@${EMULATOR_BOT_USER_ID}> hello bot`,
    });

    await waitForDelivery(emulator, (d) => d.event === "message" && d.success);
    await tracker.waitForAll();

    expect(captured).toHaveBeenCalledTimes(1);
    const [thread, message] = captured.mock.calls[0];
    expect(thread.id).toMatch(SLACK_THREAD_ID_PATTERN);
    expect(message.text).toContain("hello bot");

    const replies = emulator.slackStore.messages
      .all()
      .filter(
        (m) =>
          m.channel_id === emulator.channelId && m.user === EMULATOR_BOT_USER_ID
      );
    expect(replies.map((r) => r.text)).toEqual(["Hi there!"]);
  });

  it("delivers a non-mention message to onNewMessage matchers", async () => {
    const helpHandler = vi.fn();
    chat.onNewMessage(HELP_PATTERN, async (thread, message) => {
      helpHandler(message.text);
      await thread.post("Sure, here's help!");
    });

    await postAsHuman(emulator, { text: "I need help with deployments" });

    await waitForDelivery(emulator, (d) => d.event === "message" && d.success);
    await tracker.waitForAll();

    expect(helpHandler).toHaveBeenCalledWith("I need help with deployments");

    const replies = emulator.slackStore.messages
      .all()
      .filter((m) => m.user === EMULATOR_BOT_USER_ID);
    expect(replies.map((r) => r.text)).toEqual(["Sure, here's help!"]);
  });

  it("does not invoke handlers for the bot's own messages", async () => {
    const handler = vi.fn();
    chat.onNewMessage(ANY_CHAR_PATTERN, () => {
      handler();
    });

    // Bot speaks first via the SDK (which emits a `message` event from the
    // emulator since the underlying call was chat.postMessage). The adapter's
    // self-filtering should drop it before reaching the user handler.
    await postAsHuman(emulator, { text: "real human message" });
    await waitForDelivery(emulator, (d) => d.event === "message" && d.success);
    await tracker.waitForAll();
    handler.mockClear();

    // Now send a message AS the bot (using the bot token directly against the
    // emulator). The adapter should ignore it because it's the bot's own
    // message coming back via the events feed.
    await fetch(`${emulator.apiUrl}chat.postMessage`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${EMULATOR_BOT_TOKEN}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: emulator.channelId,
        text: "bot speaking",
      }),
    });

    // Wait for the second delivery (we now expect 2 total).
    await waitForDelivery(emulator, (d) => d.event === "message" && d.success, {
      timeoutMs: 1000,
    });
    await tracker.waitForAll();

    expect(handler).not.toHaveBeenCalled();
  });

  it("threads the bot's reply under the original message via thread_ts", async () => {
    chat.onNewMention(async (thread) => {
      await thread.post("threaded reply");
    });

    const { ts } = await postAsHuman(emulator, {
      text: `<@${EMULATOR_BOT_USER_ID}> talk to me`,
    });

    await waitForDelivery(emulator, (d) => d.event === "message" && d.success);
    await tracker.waitForAll();

    const reply = emulator.slackStore.messages
      .all()
      .find(
        (m) =>
          m.channel_id === emulator.channelId && m.user === EMULATOR_BOT_USER_ID
      );
    expect(reply?.thread_ts).toBe(ts);
  });
});
