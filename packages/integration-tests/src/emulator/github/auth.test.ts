/**
 * Asserts that the GitHubAdapter, when wired against the in-process GitHub
 * emulator via `apiUrl`, auto-resolves its bot user id from
 * `users.getAuthenticated` (i.e. `GET /user`) during `Chat.initialize()`.
 * This proves the Octokit client correctly reaches the emulator and that the
 * emulator's `GET /user` returns the seeded bot user.
 */

import { createGitHubAdapter, type GitHubAdapter } from "@chat-adapter/github";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat } from "chat";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createGitHubEmulator,
  type GitHubEmulatorHandle,
  silentLogger,
} from "./utils";

describe("GitHub emulator: auth", () => {
  let emulator: GitHubEmulatorHandle;
  let chat: Chat<{ github: GitHubAdapter }> | undefined;

  beforeAll(async () => {
    emulator = await createGitHubEmulator();
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

  it("populates botUserId from GET /user during initialize()", async () => {
    const adapter = createGitHubAdapter({
      apiUrl: emulator.apiUrl,
      token: emulator.botToken,
      webhookSecret: emulator.webhookSecret,
      userName: emulator.botLogin,
      logger: silentLogger,
    });
    chat = new Chat({
      userName: emulator.botLogin,
      adapters: { github: adapter },
      state: createMemoryState(),
      logger: silentLogger,
    });
    await chat.initialize();

    expect(adapter.botUserId).toBe(String(emulator.botUserId));
  });

  it("respects an explicit botUserId without calling GET /user", async () => {
    const adapter = createGitHubAdapter({
      apiUrl: emulator.apiUrl,
      token: emulator.botToken,
      webhookSecret: emulator.webhookSecret,
      botUserId: 99_999,
      userName: emulator.botLogin,
      logger: silentLogger,
    });
    chat = new Chat({
      userName: emulator.botLogin,
      adapters: { github: adapter },
      state: createMemoryState(),
      logger: silentLogger,
    });
    await chat.initialize();

    expect(adapter.botUserId).toBe("99999");
  });
});
