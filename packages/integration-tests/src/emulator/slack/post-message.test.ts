/**
 * Verifies that outbound `thread.post` / `Message.edit` / `Message.delete`
 * round-trip through the SlackAdapter's WebClient and land in the in-process
 * emulator's stateful store.
 *
 * The test drives the SDK with a hand-signed inbound `app_mention` webhook
 * (using the emulator's signing secret) so that handlers run with a live
 * Thread, then asserts on the emulator's `messages` collection rather than on
 * mock call records — proving the full HTTP path against a real Slack-shaped
 * server.
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

describe("Slack emulator: chat.postMessage round-trip", () => {
  let emulator: SlackEmulatorHandle;
  let chat: Chat<{ slack: SlackAdapter }>;
  let adapter: SlackAdapter;
  let tracker: ReturnType<typeof createWaitUntilTracker>;

  beforeAll(async () => {
    emulator = await createSlackEmulator();
  });

  afterAll(async () => {
    await emulator.close();
  });

  afterEach(async () => {
    if (chat) {
      await chat.shutdown();
    }
    emulator.reset();
  });

  async function setupChat() {
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
  }

  async function deliverMention(threadTs: string) {
    const event = createSlackEvent({
      type: "app_mention",
      text: `<@${EMULATOR_BOT_USER_ID}> ping`,
      userId: "U_USER_TEST",
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

  it("posts a plain text reply that lands in the emulator's message store", async () => {
    await setupChat();

    chat.onNewMention(async (thread) => {
      await thread.post("Hello from the bot!");
    });

    const threadTs = "1700000000.000001";
    await deliverMention(threadTs);

    const messages = emulator.slackStore.messages
      .all()
      .filter((m) => m.channel_id === emulator.channelId);
    const reply = messages.find((m) => m.user === EMULATOR_BOT_USER_ID);
    expect(reply).toBeDefined();
    expect(reply?.text).toBe("Hello from the bot!");
    expect(reply?.thread_ts).toBe(threadTs);
  });

  it("threads the reply under thread_ts so conversations.replies sees it", async () => {
    await setupChat();

    chat.onNewMention(async (thread) => {
      await thread.post("first reply");
      await thread.post("second reply");
    });

    const threadTs = "1700000000.000002";
    await deliverMention(threadTs);

    // Hit conversations.replies via HTTP to prove the messages are
    // discoverable through Slack's threading API, not just via the raw store.
    const repliesResponse = await fetch(
      `${emulator.apiUrl}conversations.replies`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${EMULATOR_BOT_TOKEN}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ channel: emulator.channelId, ts: threadTs }),
      }
    );
    const json = (await repliesResponse.json()) as {
      messages: Array<{ text: string; user: string }>;
      ok: boolean;
    };
    expect(json.ok).toBe(true);
    const replyTexts = json.messages
      .filter((m) => m.user === EMULATOR_BOT_USER_ID)
      .map((m) => m.text);
    expect(replyTexts).toEqual(["first reply", "second reply"]);
  });

  it("editMessage updates the stored text via chat.update", async () => {
    await setupChat();

    chat.onNewMention(async (thread) => {
      const msg = await thread.post("draft");
      await msg.edit("final");
    });

    const threadTs = "1700000000.000003";
    await deliverMention(threadTs);

    const reply = emulator.slackStore.messages
      .all()
      .find(
        (m) =>
          m.channel_id === emulator.channelId && m.user === EMULATOR_BOT_USER_ID
      );
    expect(reply?.text).toBe("final");
  });

  it("deleteMessage removes the message via chat.delete", async () => {
    await setupChat();

    chat.onNewMention(async (thread) => {
      const msg = await thread.post("transient");
      await msg.delete();
    });

    const threadTs = "1700000000.000004";
    await deliverMention(threadTs);

    const replies = emulator.slackStore.messages
      .all()
      .filter(
        (m) =>
          m.channel_id === emulator.channelId && m.user === EMULATOR_BOT_USER_ID
      );
    expect(replies).toHaveLength(0);
  });

  it("sends markdown via the markdown_text channel", async () => {
    await setupChat();

    chat.onNewMention(async (thread) => {
      await thread.post({ markdown: "**bold** and _italic_" });
    });

    const threadTs = "1700000000.000005";
    await deliverMention(threadTs);

    // The emulator only stores `text`, but Slack allows posts that have a
    // markdown_text body and an empty plain text. Verify the post landed at
    // all (any new message in the channel) so the round-trip succeeded.
    const replies = emulator.slackStore.messages
      .all()
      .filter(
        (m) =>
          m.channel_id === emulator.channelId && m.user === EMULATOR_BOT_USER_ID
      );
    expect(replies.length).toBeGreaterThan(0);
  });
});
