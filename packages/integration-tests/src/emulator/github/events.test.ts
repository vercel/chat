/**
 * Inbound `event_callback` flow: the human user posts a comment to the
 * emulator, which dispatches an `issue_comment` (or `pull_request_review_comment`)
 * webhook with a real `X-Hub-Signature-256` to our local forwarder, which
 * hands the request to `chat.webhooks.github(...)`. The SDK's `onNewMention`
 * / `onNewMessage` handlers then run with a live Thread and the bot's reply
 * lands back in the emulator.
 *
 * Unlike the Slack flow there is no re-signing bridge — `@emulators/core`'s
 * dispatcher already signs deliveries with `sha256=<hex>` exactly as the
 * GitHub adapter expects.
 */

import { createGitHubAdapter, type GitHubAdapter } from "@chat-adapter/github";
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
  createGitHubEmulator,
  type GitHubEmulatorHandle,
  type GitHubWebhookForwarder,
  postIssueCommentAsHuman,
  postReviewCommentReplyAsHuman,
  silentLogger,
  startGitHubWebhookForwarder,
  waitForGitHubDelivery,
} from "./utils";

const ANY_CHAR_PATTERN = /.+/;

describe("GitHub emulator: inbound webhook flow", () => {
  let emulator: GitHubEmulatorHandle;
  let chat: Chat<{ github: GitHubAdapter }>;
  let adapter: GitHubAdapter;
  let forwarder: GitHubWebhookForwarder;
  let tracker: ReturnType<typeof createWaitUntilTracker>;

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
    tracker = createWaitUntilTracker();
    await chat.initialize();

    forwarder = await startGitHubWebhookForwarder({
      onWebhook: (request) =>
        chat.webhooks.github(request, { waitUntil: tracker.waitUntil }),
      owner: emulator.owner,
      repo: emulator.repo,
      webhooks: emulator.webhooks,
      webhookSecret: emulator.webhookSecret,
    });
  });

  afterEach(async () => {
    await forwarder.close();
    await chat.shutdown();
    emulator.reset();
  });

  it("delivers a human-authored issue comment to onNewMessage and posts a reply", async () => {
    const captured = vi.fn<(thread: Thread, message: Message) => void>();
    chat.onNewMessage(ANY_CHAR_PATTERN, async (thread, message) => {
      captured(thread, message);
      await thread.post("got it");
    });

    // Post on the seeded standalone issue (#1). The emulator's `formatIssue`
    // doesn't surface a `pull_request` link on PR-as-issues, so all
    // dispatched issue_comment payloads classify as issue threads on the
    // SDK side; using the real issue keeps the assertion honest.
    await postIssueCommentAsHuman(emulator, {
      issueNumber: emulator.issueNumber,
      body: "hello bot",
    });

    await waitForGitHubDelivery(
      emulator,
      (d) => d.event === "issue_comment" && d.success
    );
    await tracker.waitForAll();

    expect(captured).toHaveBeenCalledTimes(1);
    const [thread, message] = captured.mock.calls[0];
    expect(thread.id).toBe(
      `github:${emulator.owner}/${emulator.repo}:issue:${emulator.issueNumber}`
    );
    expect(message.text).toContain("hello bot");

    const replies = emulator.ghStore.comments
      .all()
      .filter(
        (c) =>
          c.user_id === emulator.botUserId &&
          c.comment_type === "issue" &&
          c.issue_number === emulator.issueNumber
      );
    expect(replies.map((c) => c.body)).toEqual(["got it"]);
  });

  it("delivers a human-authored review comment reply to handlers and posts a threaded reply", async () => {
    const handler = vi.fn<(thread: Thread, message: Message) => void>();
    chat.onNewMessage(ANY_CHAR_PATTERN, async (thread, message) => {
      handler(thread, message);
      await thread.post("noted");
    });

    await postReviewCommentReplyAsHuman(emulator, {
      body: "what about this edge case?",
    });

    await waitForGitHubDelivery(
      emulator,
      (d) => d.event === "pull_request_review_comment" && d.success
    );
    await tracker.waitForAll();

    expect(handler).toHaveBeenCalled();
    const [thread] = handler.mock.calls[0];
    // Review-comment threads use the rc:<commentId> suffix where <commentId>
    // is the *parent* (root) review comment id.
    expect(thread.id).toBe(
      `github:${emulator.owner}/${emulator.repo}:${emulator.prNumber}:rc:${emulator.reviewCommentId}`
    );

    const replies = emulator.ghStore.comments
      .all()
      .filter(
        (c) => c.user_id === emulator.botUserId && c.comment_type === "review"
      );
    expect(replies.map((c) => c.body)).toEqual(["noted"]);
    expect(replies[0].in_reply_to_id).toBe(emulator.reviewCommentId);
  });

  it("does not invoke handlers for the bot's own messages", async () => {
    const handler = vi.fn();
    chat.onNewMessage(ANY_CHAR_PATTERN, () => {
      handler();
    });

    // A real human message should fire the handler once.
    await postIssueCommentAsHuman(emulator, {
      issueNumber: emulator.issueNumber,
      body: "first human comment",
    });
    await waitForGitHubDelivery(
      emulator,
      (d) => d.event === "issue_comment" && d.success
    );
    await tracker.waitForAll();
    expect(handler).toHaveBeenCalledTimes(1);
    handler.mockClear();

    // A bot-authored comment on the emulator should also fire `issue_comment`,
    // but the adapter's self-filtering must drop it before the handler runs.
    const response = await fetch(
      `${emulator.apiUrl}/repos/${emulator.owner}/${emulator.repo}/issues/${emulator.issueNumber}/comments`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${emulator.botToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ body: "bot speaks" }),
      }
    );
    expect(response.ok).toBe(true);

    // Wait for the second issue_comment delivery (will be at least 2 total).
    await waitForGitHubDelivery(
      emulator,
      (d) =>
        d.event === "issue_comment" &&
        d.success &&
        emulator.webhooks
          .getDeliveries()
          .filter((x) => x.event === "issue_comment").length >= 2
    );
    await tracker.waitForAll();

    expect(handler).not.toHaveBeenCalled();
  });
});
