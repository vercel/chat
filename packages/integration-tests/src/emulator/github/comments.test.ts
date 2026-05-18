/**
 * Verifies that outbound `thread.post` / `Message.edit` / `Message.delete` on
 * GitHub issue and PR-level conversation threads round-trip through the
 * adapter's Octokit client and land in the in-process emulator's stateful
 * store.
 *
 * Drives the adapter via PAT-mode auth pointing at the emulator's `apiUrl`,
 * obtains a Thread directly from `chat.thread(...)` (no inbound webhook
 * needed), and asserts on the emulator's `comments` collection.
 */

import { createGitHubAdapter, type GitHubAdapter } from "@chat-adapter/github";
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
import {
  createGitHubEmulator,
  type GitHubEmulatorHandle,
  silentLogger,
} from "./utils";

describe("GitHub emulator: issue/PR comment round-trip", () => {
  let emulator: GitHubEmulatorHandle;
  let chat: Chat<{ github: GitHubAdapter }>;
  let adapter: GitHubAdapter;

  beforeAll(async () => {
    emulator = await createGitHubEmulator();
  });

  afterAll(async () => {
    await emulator.close();
  });

  beforeEach(async () => {
    adapter = createGitHubAdapter({
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
  });

  afterEach(async () => {
    await chat.shutdown();
    emulator.reset();
  });

  function botCommentsForRepo() {
    return emulator.ghStore.comments
      .all()
      .filter((c) => c.user_id === emulator.botUserId);
  }

  it("posts an issue comment via issues.createComment", async () => {
    const threadId = `github:${emulator.owner}/${emulator.repo}:issue:${emulator.issueNumber}`;
    const thread = chat.thread(threadId);

    await thread.post("Hello from the bot on the issue");

    const comments = botCommentsForRepo();
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("Hello from the bot on the issue");
    expect(comments[0].issue_number).toBe(emulator.issueNumber);
    expect(comments[0].comment_type).toBe("issue");
  });

  it("posts a PR-level conversation comment via issues.createComment", async () => {
    const threadId = `github:${emulator.owner}/${emulator.repo}:${emulator.prNumber}`;
    const thread = chat.thread(threadId);

    await thread.post("Hello from the bot on the PR");

    const comments = botCommentsForRepo();
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("Hello from the bot on the PR");
    expect(comments[0].issue_number).toBe(emulator.prNumber);
    expect(comments[0].comment_type).toBe("issue");
  });

  it("editMessage updates the stored comment body via issues.updateComment", async () => {
    const threadId = `github:${emulator.owner}/${emulator.repo}:${emulator.prNumber}`;
    const thread = chat.thread(threadId);

    const message = await thread.post("draft");
    await message.edit("final");

    const comments = botCommentsForRepo();
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("final");
  });

  it("deleteMessage removes the comment via issues.deleteComment", async () => {
    const threadId = `github:${emulator.owner}/${emulator.repo}:${emulator.prNumber}`;
    const thread = chat.thread(threadId);

    const message = await thread.post("transient");
    await message.delete();

    expect(botCommentsForRepo()).toHaveLength(0);
  });
});
