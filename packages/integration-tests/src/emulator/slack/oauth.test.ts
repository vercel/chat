/**
 * OAuth v2 install flow against the in-process emulator. The emulator's
 * `/oauth/v2/authorize/callback` issues a one-time `code`, the SDK's
 * `handleOAuthCallback` exchanges it via `oauth.v2.access`, and the resulting
 * installation is persisted in the state adapter.
 *
 * The exchanged token also lives in the emulator's tokenMap, so a follow-up
 * `chat.postMessage` using that token (which is what the adapter does when
 * resolving multi-workspace events) succeeds end-to-end.
 */

import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat } from "chat";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createSlackEmulator,
  EMULATOR_BOT_NAME,
  EMULATOR_OAUTH_CLIENT_ID,
  EMULATOR_OAUTH_CLIENT_SECRET,
  type SlackEmulatorHandle,
  silentLogger,
} from "./utils";

const BOT_TOKEN_PATTERN = /^xoxb-/;
const BOT_USER_ID_PATTERN = /^U[A-Z0-9]+$/;
const INVALID_CODE_PATTERN = /invalid_code/;
const INVALID_CLIENT_ID_PATTERN = /invalid_client_id/;

describe("Slack emulator: OAuth v2 install flow", () => {
  let emulator: SlackEmulatorHandle;
  let chat: Chat<{ slack: SlackAdapter }> | undefined;

  beforeAll(async () => {
    emulator = await createSlackEmulator();
  });

  afterEach(async () => {
    if (chat) {
      await chat.shutdown();
      chat = undefined;
    }
    emulator.reset();
  });

  afterAll(async () => {
    await emulator.close();
  });

  /** Drive the emulator's authorize/callback endpoint to obtain a fresh `code`. */
  async function obtainAuthCode(
    redirectUri: string,
    state = "abc"
  ): Promise<string> {
    const params = new URLSearchParams({
      user_id: emulator.humanUserId,
      redirect_uri: redirectUri,
      scope: "chat:write,channels:read",
      state,
      client_id: EMULATOR_OAUTH_CLIENT_ID,
    });
    const response = await fetch(
      `${emulator.baseUrl}/oauth/v2/authorize/callback`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        redirect: "manual",
      }
    );
    if (response.status !== 302) {
      throw new Error(
        `expected 302 from authorize/callback, got ${response.status}`
      );
    }
    const location = response.headers.get("location");
    if (!location) {
      throw new Error("authorize/callback did not return a Location header");
    }
    const url = new URL(location);
    const code = url.searchParams.get("code");
    if (!code) {
      throw new Error("authorize/callback redirect missing 'code' param");
    }
    return code;
  }

  it("exchanges an authorization code via oauth.v2.access and persists the installation", async () => {
    const adapter = createSlackAdapter({
      apiUrl: emulator.apiUrl,
      clientId: EMULATOR_OAUTH_CLIENT_ID,
      clientSecret: EMULATOR_OAUTH_CLIENT_SECRET,
      signingSecret: emulator.signingSecret,
      userName: EMULATOR_BOT_NAME,
      logger: silentLogger,
    });
    const state = createMemoryState();
    chat = new Chat({
      userName: EMULATOR_BOT_NAME,
      adapters: { slack: adapter },
      state,
      logger: silentLogger,
    });
    await chat.initialize();

    const redirectUri = "http://localhost:3000/api/auth/callback/slack";
    const code = await obtainAuthCode(redirectUri);

    const callbackUrl = new URL("https://example.com/auth/slack/callback");
    callbackUrl.searchParams.set("code", code);
    const result = await adapter.handleOAuthCallback(
      new Request(callbackUrl, { method: "GET" }),
      { redirectUri }
    );

    expect(result.teamId).toBe(emulator.teamId);
    expect(result.installation.botToken).toMatch(BOT_TOKEN_PATTERN);
    // The install mints a dedicated bot user id (Slack-style `U` + hex), which
    // must be a real bot in the store and must not be the installing human.
    expect(result.installation.botUserId).toMatch(BOT_USER_ID_PATTERN);
    expect(result.installation.botUserId).not.toBe(emulator.humanUserId);
    const botUser = emulator.slackStore.users.findOneBy(
      "user_id",
      result.installation.botUserId
    );
    expect(botUser).toBeDefined();
    expect(botUser?.is_bot).toBe(true);
    expect(result.installation.teamName).toBe(emulator.teamName);

    // The installation is observable via the adapter's getInstallation helper,
    // which reads from the state adapter under `slack:installation:<teamId>`.
    const stored = await adapter.getInstallation(emulator.teamId);
    expect(stored?.botToken).toBe(result.installation.botToken);
  });

  it("rejects an invalid code with an AuthenticationError", async () => {
    const adapter = createSlackAdapter({
      apiUrl: emulator.apiUrl,
      clientId: EMULATOR_OAUTH_CLIENT_ID,
      clientSecret: EMULATOR_OAUTH_CLIENT_SECRET,
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
    await chat.initialize();

    const callbackUrl = new URL("https://example.com/auth/slack/callback");
    callbackUrl.searchParams.set("code", "definitely-not-a-real-code");

    await expect(
      adapter.handleOAuthCallback(new Request(callbackUrl), {
        redirectUri: "http://localhost:3000/api/auth/callback/slack",
      })
    ).rejects.toThrow(INVALID_CODE_PATTERN);
  });

  it("rejects mismatched client_secret", async () => {
    const adapter = createSlackAdapter({
      apiUrl: emulator.apiUrl,
      clientId: EMULATOR_OAUTH_CLIENT_ID,
      clientSecret: "wrong-secret",
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
    await chat.initialize();

    const code = await obtainAuthCode(
      "http://localhost:3000/api/auth/callback/slack"
    );
    const callbackUrl = new URL("https://example.com/auth/slack/callback");
    callbackUrl.searchParams.set("code", code);

    await expect(
      adapter.handleOAuthCallback(new Request(callbackUrl), {
        redirectUri: "http://localhost:3000/api/auth/callback/slack",
      })
    ).rejects.toThrow(INVALID_CLIENT_ID_PATTERN);
  });

  it("uses the freshly issued token for subsequent API calls", async () => {
    const adapter = createSlackAdapter({
      apiUrl: emulator.apiUrl,
      clientId: EMULATOR_OAUTH_CLIENT_ID,
      clientSecret: EMULATOR_OAUTH_CLIENT_SECRET,
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
    await chat.initialize();

    const redirectUri = "http://localhost:3000/api/auth/callback/slack";
    const code = await obtainAuthCode(redirectUri);
    const callbackUrl = new URL("https://example.com/auth/slack/callback");
    callbackUrl.searchParams.set("code", code);
    const { installation } = await adapter.handleOAuthCallback(
      new Request(callbackUrl),
      { redirectUri }
    );

    // Manually drive the adapter's `withBotToken` context to post via the
    // token issued by OAuth. This mirrors what the adapter does internally
    // when handling a webhook with a known team_id.
    const before = emulator.slackStore.messages.all().length;
    if (!chat) {
      throw new Error("chat not initialized");
    }
    const thread = chat.thread(`slack:${emulator.channelId}:1700000099.000099`);
    await adapter.withBotToken(installation.botToken, async () => {
      await thread.post("from oauth-issued token");
    });
    const after = emulator.slackStore.messages.all();
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)?.text).toBe("from oauth-issued token");
  });
});
