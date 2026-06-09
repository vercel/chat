/**
 * Test utilities for spinning up an in-process Slack emulator (`@emulators/slack`)
 * and bridging its outbound webhook deliveries back into the SDK.
 *
 * The Slack adapter exposes an `apiUrl` config that re-points the underlying
 * `WebClient` at any Slack-compatible host. This helper boots the emulator
 * with a known team/channel/bot/token seed, wraps it in an HTTP server, and
 * returns the URL plus direct handles to the store and webhook dispatcher so
 * tests can read state and register subscribers without going through HTTP.
 *
 * The emulator's `WebhookDispatcher.dispatch` only emits GitHub-style
 * `X-Hub-Signature-256` headers, so for inbound `event_callback` flows we run
 * a tiny Node `http` forwarder that re-signs each delivery with a Slack-style
 * `x-slack-signature` / `x-slack-request-timestamp` pair before handing the
 * request to the SDK's `chat.webhooks.slack(...)`.
 */

import { createHmac } from "node:crypto";
import { createServer as createNodeServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import type { Store, TokenMap, WebhookDispatcher } from "@emulators/core";
import { createServer as createCoreServer } from "@emulators/core";
import { getSlackStore, type SlackStore, slackPlugin } from "@emulators/slack";
import { serve } from "@hono/node-server";
import { Chat, type Logger } from "chat";
import { createSlackEvent, createSlackWebhookRequest } from "../../slack-utils";
import { createWaitUntilTracker } from "../../test-scenarios";

/**
 * Silent logger shared across emulator-backed tests so we don't spam test
 * output with adapter-internal info / warn / debug noise. Tests that want to
 * assert on logger calls should still spin up their own `vi.fn()`-based
 * logger instead.
 */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

const EMULATOR_TEAM_ID = "T_TEST";
const EMULATOR_TEAM_NAME = "Test Workspace";
const EMULATOR_TEAM_DOMAIN = "test-workspace";
export const EMULATOR_BOT_USER_ID = "U_BOT_TEST";
export const EMULATOR_BOT_NAME = "testbot";
export const EMULATOR_BOT_TOKEN = "xoxb-test-token";
const EMULATOR_HUMAN_USER_ID = "U_USER_TEST";
const EMULATOR_HUMAN_USER_NAME = "humanuser";
const EMULATOR_HUMAN_USER_TOKEN = "xoxp-human-test-token";
const EMULATOR_CHANNEL_ID = "C_TEST";
const EMULATOR_CHANNEL_NAME = "test-channel";
const EMULATOR_SIGNING_SECRET = "test-signing-secret";
export const EMULATOR_OAUTH_CLIENT_ID = "1234.5678";
export const EMULATOR_OAUTH_CLIENT_SECRET = "client-secret-test";

interface EmulatorSeed {
  bots: Array<{ userId: string; name: string; token: string }>;
  channels: Array<{ id: string; name: string }>;
  humans: Array<{ userId: string; name: string; token?: string }>;
  team: { id: string; name: string; domain: string };
}

const DEFAULT_SEED: EmulatorSeed = {
  team: {
    id: EMULATOR_TEAM_ID,
    name: EMULATOR_TEAM_NAME,
    domain: EMULATOR_TEAM_DOMAIN,
  },
  bots: [
    {
      userId: EMULATOR_BOT_USER_ID,
      name: EMULATOR_BOT_NAME,
      token: EMULATOR_BOT_TOKEN,
    },
  ],
  humans: [
    {
      userId: EMULATOR_HUMAN_USER_ID,
      name: EMULATOR_HUMAN_USER_NAME,
      token: EMULATOR_HUMAN_USER_TOKEN,
    },
  ],
  channels: [{ id: EMULATOR_CHANNEL_ID, name: EMULATOR_CHANNEL_NAME }],
};

export interface SlackEmulatorHandle {
  /** Slack `apiUrl` to pass to `createSlackAdapter({ apiUrl })`. Always trailing-slashed. */
  apiUrl: string;
  /** HTTP origin without the `/api/` suffix. Useful for hitting `/oauth/v2/authorize` etc. */
  baseUrl: string;
  botName: string;
  botToken: string;
  botUserId: string;
  channelId: string;
  channelName: string;
  /** Shut down the underlying HTTP server. */
  close: () => Promise<void>;
  humanUserId: string;
  humanUserName: string;
  humanUserToken: string;
  /** Reset state and re-seed (also re-registers the inbound forwarder if any). */
  reset: () => void;
  signingSecret: string;
  slackStore: SlackStore;
  /** Direct access to the emulator's in-memory store for assertions/seeding. */
  store: Store;
  teamDomain: string;
  teamId: string;
  teamName: string;
  tokenMap: TokenMap;
  /** Direct access to the webhook dispatcher (subscribe/unregister/inspect). */
  webhooks: WebhookDispatcher;
}

/**
 * Boot an in-process Slack emulator on an ephemeral port. The returned handle
 * surfaces both HTTP-level info (`apiUrl`) and direct access to the emulator's
 * store and webhooks, so tests can assert on emulator state cheaply.
 */
export async function createSlackEmulator(): Promise<SlackEmulatorHandle> {
  const seed = DEFAULT_SEED;

  // Reserve the listening port up front so the emulator can be created with a
  // `baseUrl` that matches where it actually binds. The emulator bakes this
  // baseUrl into self-built URLs (file upload URLs, permalinks), so passing the
  // real origin here means tests can fetch those URLs directly without
  // rewriting the host.
  const port = await allocateEphemeralPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const apiUrl = `${baseUrl}/api/`;

  const { app, store, webhooks, tokenMap } = createCoreServer(slackPlugin, {
    port,
    baseUrl,
    tokens: buildTokenSeedEntries(seed),
  });

  const httpServer = await listen(app.fetch, port);

  // Slack plugin's seed() installs a default team/channel/admin user that we
  // don't use; replace with our own deterministic ids so tests can refer to
  // T_TEST / C_TEST / U_BOT_TEST instead of generated values.
  applySeed(store, seed);

  return {
    apiUrl,
    baseUrl,
    botToken: seed.bots[0].token,
    botUserId: seed.bots[0].userId,
    botName: seed.bots[0].name,
    channelId: seed.channels[0].id,
    channelName: seed.channels[0].name,
    humanUserId: seed.humans[0].userId,
    humanUserName: seed.humans[0].name,
    humanUserToken: seed.humans[0].token ?? "",
    signingSecret: EMULATOR_SIGNING_SECRET,
    teamId: seed.team.id,
    teamName: seed.team.name,
    teamDomain: seed.team.domain,
    store,
    slackStore: getSlackStore(store),
    webhooks,
    tokenMap,
    reset: () => {
      store.reset();
      webhooks.clear();
      applyTokenSeed(tokenMap, seed);
      applySeed(store, seed);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function listen(
  fetch: (req: Request) => Response | Promise<Response>,
  port: number
) {
  return new Promise<Server>((resolve) => {
    const server = serve({ fetch, port, hostname: "127.0.0.1" }, () => {
      resolve(server as unknown as Server);
    }) as unknown as Server;
  });
}

/**
 * Bind an ephemeral port (port 0 → OS-assigned), read the assigned port, then
 * release it so the emulator server can claim it. There is a small window
 * between release and re-bind, but concurrent `listen(0)` calls receive
 * distinct ports from the OS so this is safe for in-process tests.
 */
function allocateEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNodeServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

const BOT_TOKEN_SCOPES = [
  "chat:write",
  "channels:read",
  "channels:history",
  "channels:join",
  "bookmarks:read",
  "bookmarks:write",
  "files:write",
  "im:read",
  "im:history",
  "im:write",
  "users:read",
  "reactions:read",
  "reactions:write",
];

const HUMAN_TOKEN_SCOPES = [
  "chat:write",
  "channels:read",
  "channels:history",
  "reactions:write",
];

interface SeededTokenEntry {
  id: number;
  login: string;
  scopes: string[];
}

/**
 * Single source of truth for the token map seed. Both the initial
 * `createCoreServer({ tokens })` call and `reset()` (via `applyTokenSeed`)
 * use this so the scopes granted to each token never drift between fresh
 * boots and post-reset state.
 */
function buildTokenSeedEntries(
  seed: EmulatorSeed
): Record<string, SeededTokenEntry> {
  const tokens: Record<string, SeededTokenEntry> = {};
  let id = 1;
  for (const bot of seed.bots) {
    tokens[bot.token] = {
      id: id++,
      login: bot.userId,
      scopes: [...BOT_TOKEN_SCOPES],
    };
  }
  for (const human of seed.humans) {
    if (!human.token) {
      continue;
    }
    tokens[human.token] = {
      id: id++,
      login: human.userId,
      scopes: [...HUMAN_TOKEN_SCOPES],
    };
  }
  return tokens;
}

function applyTokenSeed(tokenMap: TokenMap, seed: EmulatorSeed) {
  tokenMap.clear();
  for (const [token, entry] of Object.entries(buildTokenSeedEntries(seed))) {
    tokenMap.set(token, entry);
  }
}

/**
 * Public seed shape for `addEmulatorWorkspace`, identical to the internal
 * `EmulatorSeed` so multi-workspace tests can stamp additional teams/bots/
 * channels onto an already-booted emulator at runtime.
 */
export interface AdditionalWorkspaceSeed {
  bots: Array<{ name: string; token: string; userId: string }>;
  channels: Array<{ id: string; name: string }>;
  humans?: Array<{ name: string; token?: string; userId: string }>;
  team: { domain: string; id: string; name: string };
}

/**
 * Register an additional workspace (team + bot user + channel + token) on
 * an already-booted emulator. Used by multi-workspace tests to set up two
 * tenants on a single emulator instance.
 */
export function addEmulatorWorkspace(
  emulator: SlackEmulatorHandle,
  seed: AdditionalWorkspaceSeed
): void {
  const fullSeed: EmulatorSeed = {
    team: seed.team,
    bots: seed.bots,
    channels: seed.channels,
    humans: seed.humans ?? [],
  };
  applySeed(emulator.store, fullSeed);
  let nextId = emulator.tokenMap.size + 1;
  for (const bot of seed.bots) {
    emulator.tokenMap.set(bot.token, {
      id: nextId++,
      login: bot.userId,
      scopes: [...BOT_TOKEN_SCOPES],
    });
  }
  for (const human of seed.humans ?? []) {
    if (!human.token) {
      continue;
    }
    emulator.tokenMap.set(human.token, {
      id: nextId++,
      login: human.userId,
      scopes: [...HUMAN_TOKEN_SCOPES],
    });
  }
}

function applySeed(store: Store, seed: EmulatorSeed) {
  const ss = getSlackStore(store);

  ss.teams.insert({
    team_id: seed.team.id,
    name: seed.team.name,
    domain: seed.team.domain,
  });

  for (const bot of seed.bots) {
    ss.users.insert({
      user_id: bot.userId,
      team_id: seed.team.id,
      name: bot.name,
      real_name: bot.name,
      email: `${bot.name}@${seed.team.domain}.test`,
      is_admin: false,
      is_bot: true,
      deleted: false,
      profile: {
        display_name: bot.name,
        real_name: bot.name,
        email: `${bot.name}@${seed.team.domain}.test`,
        image_48: "",
        image_192: "",
      },
    });
    ss.bots.insert({
      bot_id: `B_${bot.userId}`,
      name: bot.name,
      deleted: false,
      icons: { image_48: "" },
    });
  }

  for (const human of seed.humans) {
    ss.users.insert({
      user_id: human.userId,
      team_id: seed.team.id,
      name: human.name,
      real_name: human.name,
      email: `${human.name}@${seed.team.domain}.test`,
      is_admin: false,
      is_bot: false,
      deleted: false,
      profile: {
        display_name: human.name,
        real_name: human.name,
        email: `${human.name}@${seed.team.domain}.test`,
        image_48: "",
        image_192: "",
      },
    });
  }

  const memberIds = [
    ...seed.bots.map((b) => b.userId),
    ...seed.humans.map((h) => h.userId),
  ];
  for (const ch of seed.channels) {
    insertChannel(ss, {
      channelId: ch.id,
      name: ch.name,
      members: memberIds,
      teamId: seed.team.id,
    });
  }

  ss.oauthApps.insert({
    client_id: EMULATOR_OAUTH_CLIENT_ID,
    client_secret: EMULATOR_OAUTH_CLIENT_SECRET,
    name: "Test Slack App",
    redirect_uris: ["http://localhost:3000/api/auth/callback/slack"],
  });

  store.setData("slack.signing_secret", EMULATOR_SIGNING_SECRET);
}

/**
 * Insert a public channel into the Slack store. Shared by `applySeed` (initial
 * boot + reset) and `seedChannelWithoutBot` so the channel record shape lives
 * in one place. The first member is treated as the creator.
 */
function insertChannel(
  ss: SlackStore,
  options: {
    channelId: string;
    members: string[];
    name: string;
    teamId: string;
  }
): void {
  const now = Math.floor(Date.now() / 1000);
  const creator = options.members[0] ?? "";
  ss.channels.insert({
    channel_id: options.channelId,
    team_id: options.teamId,
    name: options.name,
    is_channel: true,
    is_private: false,
    is_archived: false,
    topic: { value: "", creator, last_set: now },
    purpose: { value: "", creator, last_set: now },
    members: options.members,
    creator,
    num_members: options.members.length,
  });
}

/**
 * Inbound webhook bridge: the emulator's dispatcher posts plain JSON to a URL,
 * and the SDK expects Slack-style HMAC-signed requests. The forwarder accepts
 * the emulator's POST, augments the envelope with `team_id` / `api_app_id`
 * (which Slack's real Events API includes but the emulator omits), re-signs
 * with HMAC-SHA256 against `signingSecret`, and hands the request to the
 * supplied `onWebhook` callback.
 */
export interface SlackWebhookForwarder {
  close: () => Promise<void>;
  /** Subscription id returned by `webhooks.register`, in case the test wants to remove it. */
  subscriptionId: number;
  url: string;
}

export interface ForwarderOptions {
  apiAppId?: string;
  onWebhook: (request: Request) => Promise<Response> | Response;
  /**
   * Resolve the `team_id` to inject into the envelope for a given dispatched
   * event. Defaults to a constant `teamId`. Multi-workspace tests pass a
   * function that maps `event.channel` to the owning team.
   */
  resolveTeamId?: (envelope: {
    event?: { channel?: string };
  }) => string | undefined;
  signingSecret: string;
  teamId: string;
  webhooks: WebhookDispatcher;
}

export async function startSlackWebhookForwarder(
  options: ForwarderOptions
): Promise<SlackWebhookForwarder> {
  const {
    signingSecret,
    teamId,
    apiAppId = "A_TEST",
    onWebhook,
    resolveTeamId,
    webhooks,
  } = options;

  const httpServer = createNodeServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(chunk as Buffer);
    });
    req.on("end", async () => {
      try {
        const rawBody = Buffer.concat(chunks).toString("utf8");
        const augmented = augmentEventEnvelope(
          rawBody,
          teamId,
          apiAppId,
          resolveTeamId
        );
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const signature = signSlackBody(augmented, timestamp, signingSecret);

        const request = new Request("https://example.invalid/webhook/slack", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-slack-request-timestamp": timestamp,
            "x-slack-signature": signature,
          },
          body: augmented,
        });

        const response = await onWebhook(request);
        res.statusCode = response.status;
        const text = await response.text();
        res.end(text);
      } catch (err) {
        res.statusCode = 500;
        res.end(err instanceof Error ? err.message : "forwarder error");
      }
    });
    req.on("error", () => {
      res.statusCode = 400;
      res.end();
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });

  const port = (httpServer.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/`;

  const subscription = webhooks.register({
    url,
    events: ["*"],
    active: true,
    owner: "slack",
  });

  return {
    url,
    subscriptionId: subscription.id,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/**
 * Add `team_id` and `api_app_id` to an outer `event_callback` envelope so that
 * the SDK's multi-workspace token resolver sees the fields it expects. The
 * emulator's dispatch payload only contains `{ type, event }`.
 */
function augmentEventEnvelope(
  rawBody: string,
  defaultTeamId: string,
  apiAppId: string,
  resolveTeamId?: (envelope: {
    event?: { channel?: string };
  }) => string | undefined
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return rawBody;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { type?: unknown }).type !== "event_callback"
  ) {
    return rawBody;
  }
  const envelope = parsed as {
    api_app_id?: unknown;
    event?: { channel?: string };
    event_id?: unknown;
    event_time?: unknown;
    team_id?: unknown;
  };
  if (envelope.team_id === undefined) {
    const resolved = resolveTeamId?.(envelope);
    envelope.team_id = resolved ?? defaultTeamId;
  }
  if (envelope.api_app_id === undefined) {
    envelope.api_app_id = apiAppId;
  }
  if (envelope.event_id === undefined) {
    envelope.event_id = `Ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  if (envelope.event_time === undefined) {
    envelope.event_time = Math.floor(Date.now() / 1000);
  }
  return JSON.stringify(envelope);
}

function signSlackBody(
  body: string,
  timestamp: string,
  signingSecret: string
): string {
  const base = `v0:${timestamp}:${body}`;
  return `v0=${createHmac("sha256", signingSecret).update(base).digest("hex")}`;
}

/**
 * POST to an emulator Slack Web API method with bearer auth, parse the JSON
 * envelope, and throw if the call was not `ok`. Centralizes the auth header,
 * content-type, and error-envelope handling shared by every emulator helper.
 * Defaults to the bot token; pass `token` to act as another user.
 */
async function callEmulatorApi<T extends { error?: string; ok: boolean }>(
  emulator: SlackEmulatorHandle,
  method: string,
  body: Record<string, unknown>,
  options: { token?: string } = {}
): Promise<T> {
  const token = options.token ?? emulator.botToken;
  const response = await fetch(`${emulator.apiUrl}${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as T;
  if (!json.ok) {
    throw new Error(`emulator ${method} failed: ${JSON.stringify(json)}`);
  }
  return json;
}

/**
 * Convenience: post a message to a channel via the emulator using the human
 * user token, mirroring an end-user posting in Slack. Returns the inserted
 * message's `ts` so tests can correlate replies/threads.
 */
export async function postAsHuman(
  emulator: SlackEmulatorHandle,
  options: {
    channel?: string;
    text: string;
    threadTs?: string;
  }
): Promise<{ channel: string; ts: string }> {
  const channel = options.channel ?? emulator.channelId;
  const json = await callEmulatorApi<{
    channel: string;
    ok: boolean;
    ts: string;
  }>(
    emulator,
    "chat.postMessage",
    { channel, text: options.text, thread_ts: options.threadTs },
    { token: emulator.humanUserToken }
  );
  return { channel: json.channel, ts: json.ts };
}

/**
 * Add a reaction as the seeded human user. Dispatches `reaction_added` when
 * the emulator webhook forwarder is registered.
 */
export async function addReactionAsHuman(
  emulator: SlackEmulatorHandle,
  options: {
    channel: string;
    name: string;
    timestamp: string;
  }
): Promise<void> {
  await callEmulatorApi(
    emulator,
    "reactions.add",
    {
      channel: options.channel,
      name: options.name,
      timestamp: options.timestamp,
    },
    { token: emulator.humanUserToken }
  );
}

/**
 * Obtain a single-use trigger id for `views.open` / `views.push`.
 */
export async function generateViewTriggerId(
  emulator: SlackEmulatorHandle
): Promise<string> {
  const json = await callEmulatorApi<{
    ok: boolean;
    trigger_id?: string;
  }>(emulator, "views.generateTriggerId", { user_id: emulator.humanUserId });
  if (!json.trigger_id) {
    throw new Error(
      `emulator views.generateTriggerId returned no trigger_id: ${JSON.stringify(json)}`
    );
  }
  return json.trigger_id;
}

/**
 * Join a channel as the seeded bot user via `conversations.join`.
 * Dispatches `member_joined_channel` when the webhook forwarder is active.
 */
export async function joinChannelAsBot(
  emulator: SlackEmulatorHandle,
  channelId: string
): Promise<void> {
  await callEmulatorApi(emulator, "conversations.join", { channel: channelId });
}

/**
 * Seed a public channel that only contains the human user (bot not yet joined).
 */
export function seedChannelWithoutBot(
  emulator: SlackEmulatorHandle,
  options: { channelId: string; name: string }
): void {
  insertChannel(emulator.slackStore, {
    channelId: options.channelId,
    name: options.name,
    members: [emulator.humanUserId],
    teamId: emulator.teamId,
  });
}

export async function addBookmarkViaApi(
  emulator: SlackEmulatorHandle,
  options: {
    channelId: string;
    link: string;
    title: string;
  }
): Promise<{ bookmarkId: string }> {
  const json = await callEmulatorApi<{
    bookmark?: { id?: string };
    ok: boolean;
  }>(emulator, "bookmarks.add", {
    channel_id: options.channelId,
    type: "link",
    title: options.title,
    link: options.link,
  });
  if (!json.bookmark?.id) {
    throw new Error(
      `emulator bookmarks.add returned no bookmark id: ${JSON.stringify(json)}`
    );
  }
  return { bookmarkId: json.bookmark.id };
}

export async function listBookmarksViaApi(
  emulator: SlackEmulatorHandle,
  channelId: string
): Promise<Array<{ id: string; link: string; title: string }>> {
  const json = await callEmulatorApi<{
    bookmarks?: Array<{ id: string; link: string; title: string }>;
    ok: boolean;
  }>(emulator, "bookmarks.list", { channel_id: channelId });
  return json.bookmarks ?? [];
}

export interface EmulatorChatHarness {
  adapter: SlackAdapter;
  chat: Chat<{ slack: SlackAdapter }>;
  /** Present only when `withForwarder` was requested. */
  forwarder?: SlackWebhookForwarder;
  /** Close the forwarder (if any), shut down the chat, and reset the emulator. */
  teardown: () => Promise<void>;
  tracker: ReturnType<typeof createWaitUntilTracker>;
}

/**
 * Boot a `Chat` wired to the emulator with the silent logger, in-memory state,
 * and a shared waitUntil tracker — the setup every emulator-backed test repeats.
 * With `withForwarder: true` it also starts the inbound webhook forwarder so
 * emulator-dispatched events (reactions, joins, DMs) reach
 * `chat.webhooks.slack(...)`. Call the returned `teardown` from `afterEach`.
 */
export async function createEmulatorChatHarness(
  emulator: SlackEmulatorHandle,
  options: { withForwarder?: boolean } = {}
): Promise<EmulatorChatHarness> {
  const adapter = createSlackAdapter({
    apiUrl: emulator.apiUrl,
    botToken: EMULATOR_BOT_TOKEN,
    signingSecret: emulator.signingSecret,
    userName: EMULATOR_BOT_NAME,
    logger: silentLogger,
  });
  const chat = new Chat({
    userName: EMULATOR_BOT_NAME,
    adapters: { slack: adapter },
    state: createMemoryState(),
    logger: silentLogger,
  });
  const tracker = createWaitUntilTracker();
  await chat.initialize();

  let forwarder: SlackWebhookForwarder | undefined;
  if (options.withForwarder) {
    forwarder = await startSlackWebhookForwarder({
      signingSecret: emulator.signingSecret,
      teamId: emulator.teamId,
      webhooks: emulator.webhooks,
      onWebhook: (request) =>
        chat.webhooks.slack(request, { waitUntil: tracker.waitUntil }),
    });
  }

  const teardown = async () => {
    if (forwarder) {
      await forwarder.close();
    }
    await chat.shutdown();
    emulator.reset();
  };

  return { adapter, chat, tracker, forwarder, teardown };
}

/**
 * Deliver an `app_mention` of the bot into the seeded channel via a signed
 * webhook request, assert the handler returned 200, and drain the tracker so
 * all `waitUntil`-tracked handler work has settled before returning.
 */
export async function deliverMention(
  emulator: SlackEmulatorHandle,
  harness: Pick<EmulatorChatHarness, "chat" | "tracker">,
  threadTs: string,
  text = "ping"
): Promise<void> {
  const event = createSlackEvent({
    type: "app_mention",
    text: `<@${EMULATOR_BOT_USER_ID}> ${text}`,
    userId: emulator.humanUserId,
    messageTs: threadTs,
    threadTs,
    channel: emulator.channelId,
    teamId: emulator.teamId,
  });
  const req = createSlackWebhookRequest(event, emulator.signingSecret);
  const res = await harness.chat.webhooks.slack(req, {
    waitUntil: harness.tracker.waitUntil,
  });
  if (res.status !== 200) {
    throw new Error(`webhook handler returned ${res.status}`);
  }
  await harness.tracker.waitForAll();
}

/**
 * Wait until at least one webhook delivery has been recorded, with a small
 * polling loop to absorb async dispatch timing.
 */
export async function waitForDelivery(
  emulator: SlackEmulatorHandle,
  predicate: (
    delivery: ReturnType<WebhookDispatcher["getDeliveries"]>[number]
  ) => boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const intervalMs = options.intervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const deliveries = emulator.webhooks.getDeliveries();
    if (deliveries.some(predicate)) {
      return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `waitForDelivery: predicate never matched (${emulator.webhooks
      .getDeliveries()
      .map((d) => d.event)
      .join(", ")})`
  );
}
