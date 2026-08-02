import {
  createInstagramAdapter,
  type InstagramAdapter,
} from "@chat-adapter/instagram";
import { createMemoryState } from "@chat-adapter/state-memory";
import {
  type ActionEvent,
  Chat,
  type Logger,
  type Message,
  type ReactionEvent,
  type Thread,
} from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtures from "../fixtures/replay/dm/instagram.json";
import {
  createInstagramWebhookRequest,
  createMockInstagramApi,
  INSTAGRAM_ACCESS_TOKEN,
  INSTAGRAM_APP_SECRET,
  INSTAGRAM_VERIFY_TOKEN,
  type MockInstagramApi,
  setupInstagramFetchMock,
} from "./instagram-utils";
import { createWaitUntilTracker } from "./test-scenarios";

const mockLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => mockLogger,
};

describe("Instagram", () => {
  let adapter: InstagramAdapter;
  let chat: Chat<{ instagram: InstagramAdapter }>;
  let cleanupFetch: (() => void) | undefined;
  let mockApi: MockInstagramApi;
  let capturedMessage: Message | null;
  let capturedThread: Thread | null;
  let capturedAction: ActionEvent | null;
  let capturedReaction: ReactionEvent | null;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi = createMockInstagramApi();
    cleanupFetch = setupInstagramFetchMock(mockApi, fixtures.accountId);
    adapter = createInstagramAdapter({
      accessToken: INSTAGRAM_ACCESS_TOKEN,
      accountId: fixtures.accountId,
      appSecret: INSTAGRAM_APP_SECRET,
      verifyToken: INSTAGRAM_VERIFY_TOKEN,
      userName: fixtures.botName,
      logger: mockLogger,
    });
    chat = new Chat({
      adapters: { instagram: adapter },
      logger: "error",
      state: createMemoryState(),
      userName: fixtures.botName,
    });
    capturedMessage = null;
    capturedThread = null;
    capturedAction = null;
    capturedReaction = null;

    chat.onDirectMessage(async (thread, message) => {
      capturedThread = thread;
      capturedMessage = message;
      await thread.post(`Echo: ${message.text}`);
    });
    chat.onAction(async (action) => {
      capturedAction = action;
    });
    chat.onReaction(async (reaction) => {
      capturedReaction = reaction;
    });
  });

  afterEach(async () => {
    await chat.shutdown();
    cleanupFetch?.();
  });

  async function sendWebhook(payload: unknown): Promise<void> {
    const tracker = createWaitUntilTracker();
    await chat.webhooks.instagram(createInstagramWebhookRequest(payload), {
      waitUntil: tracker.waitUntil,
    });
    await tracker.waitForAll();
  }

  it("handles an account-scoped direct message and replies", async () => {
    await sendWebhook(fixtures.firstMessage);
    expect(capturedMessage?.text).toBe("Do you ship to Córdoba?");
    expect(capturedMessage?.author.userId).toBe(fixtures.userId);
    expect(capturedThread?.id).toBe(
      `instagram:${fixtures.accountId}:${fixtures.userId}`
    );
    expect(capturedThread?.isDM).toBe(true);
    expect(mockApi.sentMessages).toEqual([
      expect.objectContaining({
        to: fixtures.userId,
        text: "Echo: Do you ship to Córdoba?",
      }),
    ]);
  });

  it("normalizes a story reply with its media context", async () => {
    await sendWebhook(fixtures.storyReply);
    expect(capturedMessage?.text).toBe("Is this available?");
    expect(capturedMessage?.attachments).toEqual([
      expect.objectContaining({
        type: "image",
        url: "https://cdn.example.com/story.jpg",
      }),
    ]);
  });

  it("routes quick replies through action handlers", async () => {
    await sendWebhook(fixtures.quickReply);
    expect(capturedAction).toMatchObject({
      actionId: "confirm",
      value: "yes",
      threadId: `instagram:${fixtures.accountId}:${fixtures.userId}`,
    });
    expect(capturedMessage).toBeNull();
  });

  it("routes received reactions", async () => {
    await sendWebhook(fixtures.reactionAdded);
    expect(capturedReaction).toMatchObject({
      added: true,
      messageId: "mid_ig_text_001",
      rawEmoji: "❤️",
      threadId: `instagram:${fixtures.accountId}:${fixtures.userId}`,
    });
  });

  it("caches echo events without dispatching a DM", async () => {
    await sendWebhook(fixtures.echoMessage);
    expect(capturedMessage).toBeNull();
    expect(mockApi.sentMessages).toHaveLength(0);
  });
});
