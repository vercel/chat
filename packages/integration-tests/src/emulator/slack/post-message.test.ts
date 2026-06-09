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
  EMULATOR_BOT_TOKEN,
  EMULATOR_BOT_USER_ID,
  type EmulatorChatHarness,
  type SlackEmulatorHandle,
} from "./utils";

describe("Slack emulator: chat.postMessage round-trip", () => {
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

  it("posts a plain text reply that lands in the emulator's message store", async () => {
    harness.chat.onNewMention(async (thread) => {
      await thread.post("Hello from the bot!");
    });

    const threadTs = "1700000000.000001";
    await deliverMention(emulator, harness, threadTs);

    const messages = emulator.slackStore.messages
      .all()
      .filter((m) => m.channel_id === emulator.channelId);
    const reply = messages.find((m) => m.user === EMULATOR_BOT_USER_ID);
    expect(reply).toBeDefined();
    expect(reply?.text).toBe("Hello from the bot!");
    expect(reply?.thread_ts).toBe(threadTs);
  });

  it("threads the reply under thread_ts so conversations.replies sees it", async () => {
    harness.chat.onNewMention(async (thread) => {
      await thread.post("first reply");
      await thread.post("second reply");
    });

    const threadTs = "1700000000.000002";
    await deliverMention(emulator, harness, threadTs);

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
    harness.chat.onNewMention(async (thread) => {
      const msg = await thread.post("draft");
      await msg.edit("final");
    });

    const threadTs = "1700000000.000003";
    await deliverMention(emulator, harness, threadTs);

    const reply = emulator.slackStore.messages
      .all()
      .find(
        (m) =>
          m.channel_id === emulator.channelId && m.user === EMULATOR_BOT_USER_ID
      );
    expect(reply?.text).toBe("final");
  });

  it("deleteMessage removes the message via chat.delete", async () => {
    harness.chat.onNewMention(async (thread) => {
      const msg = await thread.post("transient");
      await msg.delete();
    });

    const threadTs = "1700000000.000004";
    await deliverMention(emulator, harness, threadTs);

    const replies = emulator.slackStore.messages
      .all()
      .filter(
        (m) =>
          m.channel_id === emulator.channelId && m.user === EMULATOR_BOT_USER_ID
      );
    expect(replies).toHaveLength(0);
  });

  it("sends an ephemeral message via chat.postEphemeral", async () => {
    harness.chat.onNewMention(async (thread) => {
      await thread.postEphemeral(emulator.humanUserId, "only you see this", {
        fallbackToDM: false,
      });
    });

    const threadTs = "1700000000.000005";
    await deliverMention(emulator, harness, threadTs);

    const ephemeral = emulator.slackStore.ephemeralMessages
      .all()
      .filter(
        (m) =>
          m.channel_id === emulator.channelId &&
          m.target_user === emulator.humanUserId
      );
    expect(ephemeral.map((m) => m.text)).toEqual(["only you see this"]);
  });
});
