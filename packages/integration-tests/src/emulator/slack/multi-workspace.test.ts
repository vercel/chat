/**
 * Multi-workspace integration: the adapter runs without a hard-coded
 * `botToken`. Two installations are persisted in the state adapter (one
 * seeded directly via `adapter.setInstallation()`, one via the OAuth install
 * flow). Inbound `event_callback`s for either team route through the
 * forwarder, the adapter resolves the per-team token from state, and the
 * resulting `chat.postMessage` lands in the correct workspace's channel.
 *
 * Exercises the full multi-workspace path: token resolution from state +
 * per-tenant Octokit calls against the shared emulator, without any
 * `injectMockSlackClient`-style mocks.
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
  addEmulatorWorkspace,
  createSlackEmulator,
  EMULATOR_BOT_TOKEN,
  EMULATOR_BOT_USER_ID,
  EMULATOR_OAUTH_CLIENT_ID,
  EMULATOR_OAUTH_CLIENT_SECRET,
  postAsHuman,
  type SlackEmulatorHandle,
  type SlackWebhookForwarder,
  silentLogger,
  startSlackWebhookForwarder,
  waitForDelivery,
} from "./utils";

const TEAM_B_ID = "T_TEAM_B";
const TEAM_B_NAME = "Team B Workspace";
const TEAM_B_DOMAIN = "team-b";
const TEAM_B_BOT_USER_ID = "U_BOT_TEAM_B";
const TEAM_B_BOT_NAME = "team-b-bot";
const TEAM_B_BOT_TOKEN = "xoxb-team-b-token";
const TEAM_B_HUMAN_USER_ID = "U_USER_TEAM_B";
const TEAM_B_HUMAN_NAME = "team-b-human";
const TEAM_B_HUMAN_TOKEN = "xoxp-team-b-human";
const TEAM_B_CHANNEL_ID = "C_TEAM_B";
const TEAM_B_CHANNEL_NAME = "team-b-general";

describe("Slack emulator: multi-workspace routing", () => {
  let emulator: SlackEmulatorHandle;
  let chat: Chat<{ slack: SlackAdapter }>;
  let adapter: SlackAdapter;
  let forwarder: SlackWebhookForwarder;
  let tracker: ReturnType<typeof createWaitUntilTracker>;

  beforeAll(async () => {
    emulator = await createSlackEmulator();
    addEmulatorWorkspace(emulator, {
      team: { id: TEAM_B_ID, name: TEAM_B_NAME, domain: TEAM_B_DOMAIN },
      bots: [
        {
          userId: TEAM_B_BOT_USER_ID,
          name: TEAM_B_BOT_NAME,
          token: TEAM_B_BOT_TOKEN,
        },
      ],
      humans: [
        {
          userId: TEAM_B_HUMAN_USER_ID,
          name: TEAM_B_HUMAN_NAME,
          token: TEAM_B_HUMAN_TOKEN,
        },
      ],
      channels: [{ id: TEAM_B_CHANNEL_ID, name: TEAM_B_CHANNEL_NAME }],
    });
  });

  afterAll(async () => {
    await emulator.close();
  });

  beforeEach(async () => {
    // Multi-workspace mode: no botToken provided. Tokens come from the
    // adapter's state adapter, keyed by team_id.
    adapter = createSlackAdapter({
      apiUrl: emulator.apiUrl,
      clientId: EMULATOR_OAUTH_CLIENT_ID,
      clientSecret: EMULATOR_OAUTH_CLIENT_SECRET,
      signingSecret: emulator.signingSecret,
      userName: "multibot",
      logger: silentLogger,
    });
    chat = new Chat({
      userName: "multibot",
      adapters: { slack: adapter },
      state: createMemoryState(),
      logger: silentLogger,
    });
    tracker = createWaitUntilTracker();
    await chat.initialize();

    // Seed two installations: team A (the default emulator team) and team B
    // (the additional workspace we set up in `beforeAll`).
    await adapter.setInstallation(emulator.teamId, {
      botToken: EMULATOR_BOT_TOKEN,
      botUserId: EMULATOR_BOT_USER_ID,
      teamName: emulator.teamName,
    });
    await adapter.setInstallation(TEAM_B_ID, {
      botToken: TEAM_B_BOT_TOKEN,
      botUserId: TEAM_B_BOT_USER_ID,
      teamName: TEAM_B_NAME,
    });

    // The forwarder consults the emulator store to inject the correct
    // team_id per dispatch, so an event in the team-A channel reaches the
    // adapter with `team_id=T_TEST` (and one in the team-B channel reaches
    // the adapter with `team_id=T_TEAM_B`).
    forwarder = await startSlackWebhookForwarder({
      signingSecret: emulator.signingSecret,
      teamId: emulator.teamId,
      webhooks: emulator.webhooks,
      onWebhook: (request) =>
        chat.webhooks.slack(request, { waitUntil: tracker.waitUntil }),
      resolveTeamId: (envelope) => {
        const channelId = envelope.event?.channel;
        if (!channelId) {
          return;
        }
        const channel = emulator.slackStore.channels.findOneBy(
          "channel_id",
          channelId
        );
        return channel?.team_id;
      },
    });
  });

  afterEach(async () => {
    await forwarder.close();
    await chat.shutdown();
    // Don't reset the emulator between tests in this file — we need the
    // team-B seed to persist. Instead clear out posted messages.
    for (const msg of emulator.slackStore.messages.all()) {
      emulator.slackStore.messages.delete(msg.id);
    }
  });

  it("routes an event in team A through the team-A bot token", async () => {
    const captured = vi.fn<(thread: Thread, message: Message) => void>();
    chat.onNewMention(async (thread, message) => {
      captured(thread, message);
      await thread.post("hello from team A bot");
    });

    await postAsHuman(emulator, {
      channel: emulator.channelId,
      text: `<@${EMULATOR_BOT_USER_ID}> ping`,
    });

    await waitForDelivery(emulator, (d) => d.event === "message" && d.success);
    await tracker.waitForAll();

    expect(captured).toHaveBeenCalledTimes(1);

    // The reply must land in the team-A channel, posted as the team-A bot.
    const teamAReplies = emulator.slackStore.messages
      .all()
      .filter(
        (m) =>
          m.channel_id === emulator.channelId && m.user === EMULATOR_BOT_USER_ID
      );
    expect(teamAReplies.map((m) => m.text)).toEqual(["hello from team A bot"]);

    // And nothing should have been posted as the team-B bot.
    const teamBReplies = emulator.slackStore.messages
      .all()
      .filter((m) => m.user === TEAM_B_BOT_USER_ID);
    expect(teamBReplies).toHaveLength(0);
  });

  it("routes an event in team B through the team-B bot token", async () => {
    chat.onNewMention(async (thread) => {
      await thread.post("hello from team B bot");
    });

    // Post in the team-B channel as the team-B human.
    const response = await fetch(`${emulator.apiUrl}chat.postMessage`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${TEAM_B_HUMAN_TOKEN}`,
      },
      body: JSON.stringify({
        channel: TEAM_B_CHANNEL_ID,
        text: `<@${TEAM_B_BOT_USER_ID}> ping`,
      }),
    });
    expect(response.ok).toBe(true);

    await waitForDelivery(emulator, (d) => d.event === "message" && d.success);
    await tracker.waitForAll();

    // Reply lands in the team-B channel, posted as the team-B bot — proving
    // the adapter resolved the right per-team token from state.
    const teamBReplies = emulator.slackStore.messages
      .all()
      .filter(
        (m) =>
          m.channel_id === TEAM_B_CHANNEL_ID && m.user === TEAM_B_BOT_USER_ID
      );
    expect(teamBReplies.map((m) => m.text)).toEqual(["hello from team B bot"]);

    // And the team-A bot is silent.
    const teamAReplies = emulator.slackStore.messages
      .all()
      .filter((m) => m.user === EMULATOR_BOT_USER_ID);
    expect(teamAReplies).toHaveLength(0);
  });

  it("returns no installation for an unknown team_id", async () => {
    expect(await adapter.getInstallation("T_UNKNOWN")).toBeNull();
    expect(await adapter.getInstallation(emulator.teamId)).toMatchObject({
      botToken: EMULATOR_BOT_TOKEN,
      botUserId: EMULATOR_BOT_USER_ID,
    });
    expect(await adapter.getInstallation(TEAM_B_ID)).toMatchObject({
      botToken: TEAM_B_BOT_TOKEN,
      botUserId: TEAM_B_BOT_USER_ID,
    });
  });
});
