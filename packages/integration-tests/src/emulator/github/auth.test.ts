/**
 * Asserts that the GitHubAdapter, when wired against the in-process GitHub
 * emulator via `apiUrl`, auto-resolves its bot user id from
 * `users.getAuthenticated` (i.e. `GET /user`) during `Chat.initialize()`.
 * This proves the Octokit client correctly reaches the emulator and that the
 * emulator's `GET /user` returns the seeded bot user.
 */

import { createHmac, generateKeyPairSync } from "node:crypto";
import { createGitHubAdapter, type GitHubAdapter } from "@chat-adapter/github";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat } from "chat";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createWaitUntilTracker } from "../../test-scenarios";
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

  it.each([
    "issue_comment",
    "pull_request_review_comment",
  ])("checks the installation before dispatching %s through Chat", async (event) => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const adapter = createGitHubAdapter({
      apiUrl: emulator.apiUrl,
      appId: "12345",
      privateKey,
      installationId: 111,
      botUserId: emulator.botUserId,
      webhookSecret: emulator.webhookSecret,
      logger: silentLogger,
    });
    chat = new Chat({
      userName: emulator.botLogin,
      adapters: { github: adapter },
      state: createMemoryState(),
      logger: silentLogger,
    });
    const handler = vi.fn();
    chat.onNewMessage((thread, message) => {
      handler(thread.id, message.id);
    });
    await chat.initialize();
    const tracker = createWaitUntilTracker();

    for (const [index, installation] of [999, undefined, 111].entries()) {
      const commentId = 100 + index;
      handler.mockClear();
      const body = JSON.stringify({
        action: "created",
        installation:
          installation === undefined ? undefined : { id: installation },
        repository: {
          id: 1,
          name: emulator.repo,
          full_name: `${emulator.owner}/${emulator.repo}`,
          owner: {
            id: emulator.botUserId,
            login: emulator.owner,
            type: "User",
          },
        },
        sender: {
          id: emulator.humanUserId,
          login: emulator.humanLogin,
          type: "User",
        },
        comment: {
          id: commentId,
          body: "hello bot",
          user: {
            id: emulator.humanUserId,
            login: emulator.humanLogin,
            type: "User",
          },
          created_at: "2026-10-13T00:00:00Z",
          updated_at: "2026-10-13T00:00:00Z",
          html_url: `https://github.com/${emulator.owner}/${emulator.repo}/issues/${emulator.issueNumber}#issuecomment-${commentId}`,
        },
        issue: { number: emulator.issueNumber, title: "Test issue" },
        pull_request: { number: emulator.prNumber, title: "Test PR" },
      });
      const signature = createHmac("sha256", emulator.webhookSecret)
        .update(body)
        .digest("hex");
      const response = await chat.webhooks.github(
        new Request("https://example.invalid/webhook/github", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-github-event": event,
            "x-hub-signature-256": `sha256=${signature}`,
          },
          body,
        }),
        { waitUntil: tracker.waitUntil, propagateHandlerErrors: true }
      );
      await tracker.waitForAll();

      expect(response.status).toBe(installation === 999 ? 404 : 200);
      if (installation === 999) {
        expect(handler).not.toHaveBeenCalled();
      } else {
        expect(handler).toHaveBeenCalledWith(
          expect.any(String),
          String(commentId)
        );
      }
    }
  });
});
