/**
 * Verifies that replies on a review-comment thread route through the GitHub
 * adapter's `pulls.createReplyForReviewComment` (POST
 * `/repos/:owner/:repo/pulls/:number/comments` with `in_reply_to_id`) and
 * land in the emulator's `comments` collection with `comment_type: "review"`.
 *
 * The review-comment edit and delete paths are covered too: the adapter
 * routes those through `pulls.updateReviewComment` and
 * `pulls.deleteReviewComment` respectively.
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

describe("GitHub emulator: review comment round-trip", () => {
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

  function reviewCommentThreadId(): string {
    return `github:${emulator.owner}/${emulator.repo}:${emulator.prNumber}:rc:${emulator.reviewCommentId}`;
  }

  function reviewCommentsByBot() {
    return emulator.ghStore.comments
      .all()
      .filter(
        (c) => c.user_id === emulator.botUserId && c.comment_type === "review"
      );
  }

  it("posts a review-comment reply with in_reply_to_id pointing at the parent", async () => {
    const thread = chat.thread(reviewCommentThreadId());
    await thread.post("LGTM, fixing this in a follow-up");

    const replies = reviewCommentsByBot();
    expect(replies).toHaveLength(1);
    expect(replies[0].body).toBe("LGTM, fixing this in a follow-up");
    expect(replies[0].in_reply_to_id).toBe(emulator.reviewCommentId);
    expect(replies[0].pull_number).toBe(emulator.prNumber);
  });

  it("editMessage updates a review comment via pulls.updateReviewComment", async () => {
    const thread = chat.thread(reviewCommentThreadId());
    const message = await thread.post("first take");
    await message.edit("updated take");

    const replies = reviewCommentsByBot();
    expect(replies).toHaveLength(1);
    expect(replies[0].body).toBe("updated take");
  });

  it("deleteMessage removes a review comment via pulls.deleteReviewComment", async () => {
    const thread = chat.thread(reviewCommentThreadId());
    const message = await thread.post("temporary");
    await message.delete();

    expect(reviewCommentsByBot()).toHaveLength(0);
  });
});
