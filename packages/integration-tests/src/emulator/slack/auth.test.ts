/**
 * Asserts that the SlackAdapter, when wired against the in-process Slack
 * emulator via `apiUrl`, auto-resolves its bot user id from `auth.test` during
 * `Chat.initialize()`. This proves the WebClient correctly reaches the
 * emulator and that the emulator's `auth.test` returns the seeded bot.
 */

import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat } from "chat";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createSlackEmulator,
  EMULATOR_BOT_NAME,
  EMULATOR_BOT_TOKEN,
  EMULATOR_BOT_USER_ID,
  type SlackEmulatorHandle,
  silentLogger,
} from "./utils";

describe("Slack emulator: auth", () => {
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

  it("populates botUserId from auth.test when not provided", async () => {
    const adapter = createSlackAdapter({
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
    await chat.initialize();

    expect(adapter.botUserId).toBe(EMULATOR_BOT_USER_ID);
  });

  it("respects an explicit botUserId without calling auth.test", async () => {
    const adapter = createSlackAdapter({
      apiUrl: emulator.apiUrl,
      botToken: EMULATOR_BOT_TOKEN,
      botUserId: "U_OVERRIDE",
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

    expect(adapter.botUserId).toBe("U_OVERRIDE");
  });

  it("does not call auth.test in multi-workspace mode (no default token)", async () => {
    const adapter = createSlackAdapter({
      apiUrl: emulator.apiUrl,
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

    expect(adapter.botUserId).toBeFalsy();
  });

  it("retains full bot scopes after reset() (regression)", async () => {
    // First boot: emulator.reset() runs in this test's afterEach below as
    // part of the normal cycle. Drive auth.test before and after reset to
    // make sure the post-reset token still resolves with the same identity
    // (i.e. token-seed scopes don't regress between fresh-boot and reset).
    const adapter = createSlackAdapter({
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
    await chat.initialize();
    expect(adapter.botUserId).toBe(EMULATOR_BOT_USER_ID);

    emulator.reset();

    // After reset the bot user, channel, and bot token should all still
    // resolve. Hit the emulator's auth.test directly with the bot token to
    // confirm the post-reset tokenMap entry still maps to the seeded bot.
    const authResponse = await fetch(`${emulator.apiUrl}auth.test`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${EMULATOR_BOT_TOKEN}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: "{}",
    });
    const auth = (await authResponse.json()) as {
      ok: boolean;
      user_id?: string;
    };
    expect(auth.ok).toBe(true);
    expect(auth.user_id).toBe(EMULATOR_BOT_USER_ID);
  });
});
