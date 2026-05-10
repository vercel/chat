/**
 * Asserts that the SlackAdapter, when wired against the in-process Slack
 * emulator via `apiUrl`, auto-resolves its bot user id from `auth.test` during
 * `Chat.initialize()`. This proves the WebClient correctly reaches the
 * emulator and that the emulator's `auth.test` returns the seeded bot.
 */

import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat, type Logger } from "chat";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createSlackEmulator,
  EMULATOR_BOT_NAME,
  EMULATOR_BOT_TOKEN,
  EMULATOR_BOT_USER_ID,
  type SlackEmulatorHandle,
} from "./slack-emulator-utils";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

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
});
