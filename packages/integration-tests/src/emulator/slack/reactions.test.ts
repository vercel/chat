/**
 * Round-trip tests for adding and removing reactions through the SlackAdapter
 * against the in-process emulator. Reactions are written by the SDK via
 * `reactions.add` / `reactions.remove` and verified either by reading the
 * emulator's `messages` collection directly (which embeds a `reactions` array)
 * or by hitting `reactions.get` over HTTP.
 */

import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat } from "chat";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
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

describe("Slack emulator: reactions round-trip", () => {
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
  });

  afterEach(async () => {
    await chat.shutdown();
    emulator.reset();
  });

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

  it("addReaction writes a reaction visible via reactions.get", async () => {
    chat.onNewMention(async (thread) => {
      const msg = await thread.post("react to this");
      await msg.addReaction("thumbsup");
    });

    const threadTs = "1700000000.100001";
    await deliverMention(threadTs);

    const botMessage = emulator.slackStore.messages
      .all()
      .find(
        (m) =>
          m.channel_id === emulator.channelId && m.user === EMULATOR_BOT_USER_ID
      );
    expect(botMessage).toBeDefined();
    if (!botMessage) {
      return;
    }

    const reactionsResponse = await fetch(`${emulator.apiUrl}reactions.get`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${EMULATOR_BOT_TOKEN}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: emulator.channelId,
        timestamp: botMessage.ts,
      }),
    });
    const json = (await reactionsResponse.json()) as {
      message: {
        reactions: Array<{ count: number; name: string; users: string[] }>;
      };
      ok: boolean;
    };
    expect(json.ok).toBe(true);
    expect(json.message.reactions).toEqual([
      expect.objectContaining({
        name: "thumbsup",
        count: 1,
        users: [EMULATOR_BOT_USER_ID],
      }),
    ]);
  });

  it("removeReaction undoes a previously added reaction", async () => {
    chat.onNewMention(async (thread) => {
      const msg = await thread.post("toggle me");
      await msg.addReaction("eyes");
      await msg.removeReaction("eyes");
    });

    const threadTs = "1700000000.100002";
    await deliverMention(threadTs);

    const botMessage = emulator.slackStore.messages
      .all()
      .find(
        (m) =>
          m.channel_id === emulator.channelId && m.user === EMULATOR_BOT_USER_ID
      );
    expect(botMessage?.reactions).toEqual([]);
  });

  it("supports multi-user reactions on the same message", async () => {
    // Bot adds one reaction via the SDK, then a human user adds the same
    // reaction directly through the emulator API. The store should track both.
    chat.onNewMention(async (thread) => {
      const msg = await thread.post("party");
      await msg.addReaction("tada");
    });

    const threadTs = "1700000000.100003";
    await deliverMention(threadTs);

    const botMessage = emulator.slackStore.messages
      .all()
      .find(
        (m) =>
          m.channel_id === emulator.channelId && m.user === EMULATOR_BOT_USER_ID
      );
    expect(botMessage).toBeDefined();
    if (!botMessage) {
      return;
    }

    const humanReaction = await fetch(`${emulator.apiUrl}reactions.add`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${emulator.humanUserToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: emulator.channelId,
        timestamp: botMessage.ts,
        name: "tada",
      }),
    });
    expect((await humanReaction.json()).ok).toBe(true);

    const refreshed = emulator.slackStore.messages.get(botMessage.id);
    expect(refreshed?.reactions[0]).toEqual(
      expect.objectContaining({
        name: "tada",
        count: 2,
        users: expect.arrayContaining([
          EMULATOR_BOT_USER_ID,
          emulator.humanUserId,
        ]),
      })
    );
  });
});
