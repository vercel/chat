/**
 * Replay tests for Slack multi-workspace support.
 *
 * Tests that the adapter correctly resolves bot tokens from installations
 * stored in the state adapter (instead of a hardcoded bot token).
 */

import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat, type Message, type Thread } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import team1 from "../fixtures/replay/slack-multi-workspace/team1.json";
import team2 from "../fixtures/replay/slack-multi-workspace/team2.json";
import {
  createSignedSlackRequest,
  createWaitUntilTracker,
} from "./replay-test-utils";
import {
  createMockSlackClient,
  injectMockSlackClient,
  type MockSlackClient,
  SLACK_SIGNING_SECRET,
} from "./slack-utils";

const mockLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => mockLogger,
};

describe("Slack Multi-Workspace Replay Tests", () => {
  let chat: Chat<{ slack: SlackAdapter }>;
  let adapter: SlackAdapter;
  let mockClient: MockSlackClient;
  let tracker: ReturnType<typeof createWaitUntilTracker>;
  let capturedMention: { thread: Thread; message: Message } | null;

  beforeEach(async () => {
    vi.clearAllMocks();
    capturedMention = null;

    // Create adapter WITHOUT botToken (multi-workspace mode)
    adapter = createSlackAdapter({
      signingSecret: SLACK_SIGNING_SECRET,
      logger: mockLogger,
    });

    mockClient = createMockSlackClient();
    mockClient.auth.test.mockResolvedValue({
      ok: true,
      user_id: team1.botUserId,
      user: team1.botName,
    });
    injectMockSlackClient(adapter, mockClient);

    const state = createMemoryState();
    chat = new Chat({
      userName: team1.botName,
      adapters: { slack: adapter },
      state,
      logger: "error",
    });

    // Initialize so the adapter can access state
    await chat.initialize();

    // Seed installations for both workspaces
    await adapter.setInstallation(team1.teamId, {
      botToken: "xoxb-multi-workspace-token",
      botUserId: team1.botUserId,
      teamName: team1.teamName,
    });
    await adapter.setInstallation(team2.teamId, {
      botToken: "xoxb-team2-token",
      botUserId: team2.botUserId,
      teamName: team2.teamName,
    });

    chat.onNewMention(async (thread, message) => {
      capturedMention = { thread, message };
      await thread.post("Got it!");
    });

    tracker = createWaitUntilTracker();
  });

  afterEach(async () => {
    await chat.shutdown();
  });

  it("should resolve token from installation and handle mention", async () => {
    await chat.webhooks.slack(
      createSignedSlackRequest(JSON.stringify(team1.mention)),
      { waitUntil: tracker.waitUntil },
    );
    await tracker.waitForAll();

    expect(capturedMention).not.toBeNull();
    expect(capturedMention?.message.text).toContain("testing");
    expect(capturedMention?.message.author.userId).toBe(
      team1.mention.event.user,
    );
    expect(capturedMention?.thread.adapter.name).toBe("slack");

    // Verify the resolved token was used for API calls
    expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "xoxb-multi-workspace-token",
      }),
    );
  });

  it("should reject webhook when no installation exists for team", async () => {
    // Delete the installation
    await adapter.deleteInstallation(team1.teamId);

    await chat.webhooks.slack(
      createSignedSlackRequest(JSON.stringify(team1.mention)),
      { waitUntil: tracker.waitUntil },
    );
    await tracker.waitForAll();

    // Mention handler should NOT have been called
    expect(capturedMention).toBeNull();
  });

  it("should store and retrieve installations correctly", async () => {
    const installation1 = await adapter.getInstallation(team1.teamId);
    expect(installation1).not.toBeNull();
    expect(installation1?.botToken).toBe("xoxb-multi-workspace-token");
    expect(installation1?.botUserId).toBe(team1.botUserId);
    expect(installation1?.teamName).toBe(team1.teamName);

    const installation2 = await adapter.getInstallation(team2.teamId);
    expect(installation2).not.toBeNull();
    expect(installation2?.botToken).toBe("xoxb-team2-token");
    expect(installation2?.botUserId).toBe(team2.botUserId);
    expect(installation2?.teamName).toBe(team2.teamName);
  });

  it("should resolve different tokens for different teams", async () => {
    // Track mentions per team
    const mentions: Array<{ thread: Thread; message: Message }> = [];
    chat.onNewMention(async (thread, message) => {
      mentions.push({ thread, message });
      await thread.post("Got it!");
    });

    // Send webhook from team 1
    await chat.webhooks.slack(
      createSignedSlackRequest(JSON.stringify(team1.mention)),
      { waitUntil: tracker.waitUntil },
    );
    await tracker.waitForAll();

    // Verify team 1's token was used
    expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "xoxb-multi-workspace-token",
      }),
    );

    // Send webhook from team 2
    mockClient.chat.postMessage.mockClear();
    tracker = createWaitUntilTracker();

    await chat.webhooks.slack(
      createSignedSlackRequest(JSON.stringify(team2.mention)),
      { waitUntil: tracker.waitUntil },
    );
    await tracker.waitForAll();

    // Verify team 2's token was used
    expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "xoxb-team2-token",
      }),
    );

    // Both mentions were captured (2 from this handler + 1 from beforeEach handler)
    expect(mentions).toHaveLength(2);
    expect(mentions[0].message.text).toContain("testing");
    expect(mentions[1].message.text).toContain("hello from team 2");
    expect(mentions[1].message.author.userId).toBe(team2.mention.event.user);
  });

  it("should encrypt token when encryption key is provided", async () => {
    // Create adapter with encryption
    const encryptedAdapter = createSlackAdapter({
      signingSecret: SLACK_SIGNING_SECRET,
      encryptionKey:
        "2068256fc05df3dae73647e2fca5340c2132de9b4d575a84091f02fa74bc99b6",
      logger: mockLogger,
    });

    const state = createMemoryState();
    const encryptedChat = new Chat({
      userName: team1.botName,
      adapters: { slack: encryptedAdapter },
      state,
      logger: "error",
    });

    await encryptedChat.initialize();

    await encryptedAdapter.setInstallation(team1.teamId, {
      botToken: "xoxb-secret-token",
      botUserId: team1.botUserId,
      teamName: "encrypted-workspace",
    });

    // Retrieve should decrypt transparently
    const installation = await encryptedAdapter.getInstallation(team1.teamId);
    expect(installation?.botToken).toBe("xoxb-secret-token");

    // Verify the raw state has encrypted data (not plaintext)
    await state.connect();
    const rawData = await state.get(`slack:installation:${team1.teamId}`);
    expect(rawData).toBeDefined();
    // The botToken in raw state should be an encrypted object, not a string
    const raw = rawData as Record<string, unknown>;
    expect(typeof raw.botToken).toBe("object");

    await encryptedChat.shutdown();
  });
});
