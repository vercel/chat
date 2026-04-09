/**
 * Replay tests for Zoom webhook flows.
 *
 * These tests replay Zoom webhook payloads to verify bot_notification
 * and team_chat.app_mention event handling flows.
 */

import { createMemoryState } from "@chat-adapter/state-memory";
import { createZoomAdapter, type ZoomAdapter } from "@chat-adapter/zoom";
import { Chat, type Logger, Message, type Thread } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtures from "../fixtures/replay/zoom/zoom.json";
import { createWaitUntilTracker } from "./test-scenarios";
import {
  createZoomWebhookRequest,
  setupZoomFetchMock,
  ZOOM_CREDENTIALS,
} from "./zoom-utils";

const ALL_MESSAGES_PATTERN = /.*/;

const mockLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => mockLogger,
};

describe("Replay Tests - Zoom bot_notification", () => {
  let adapter: ZoomAdapter;
  let capturedThread: Thread | null;
  let capturedMessage: Message | null;
  let chat: Chat<{ zoom: ZoomAdapter }>;
  let cleanupFetchMock: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanupFetchMock = setupZoomFetchMock();

    adapter = createZoomAdapter({
      ...ZOOM_CREDENTIALS,
      userName: fixtures.botName,
      logger: mockLogger,
    });

    chat = new Chat({
      adapters: { zoom: adapter },
      logger: "error",
      state: createMemoryState(),
      userName: fixtures.botName,
    });

    capturedThread = null;
    capturedMessage = null;

    chat.onNewMessage(ALL_MESSAGES_PATTERN, async (thread, message) => {
      capturedThread = thread;
      capturedMessage = message;
    });
  });

  afterEach(async () => {
    await chat.shutdown();
    cleanupFetchMock();
  });

  it("should parse a bot_notification webhook into a normalized Message", async () => {
    const tracker = createWaitUntilTracker();
    await chat.webhooks.zoom(
      createZoomWebhookRequest(fixtures.botNotification),
      { waitUntil: tracker.waitUntil }
    );
    await tracker.waitForAll();

    expect(capturedMessage).not.toBeNull();
    expect(capturedMessage?.text).toBe("hello world");
    expect(capturedMessage?.author.userId).toBe("U00FAKEUSER1");
    expect(capturedMessage?.author.userName).toBe("Alice");
  });

  it("should construct correct threadId for bot_notification", async () => {
    const tracker = createWaitUntilTracker();
    await chat.webhooks.zoom(
      createZoomWebhookRequest(fixtures.botNotification),
      { waitUntil: tracker.waitUntil }
    );
    await tracker.waitForAll();

    expect(capturedThread).not.toBeNull();
    // threadId = zoom:{toJid}:{event_ts}
    expect(capturedThread?.id).toBe(
      "zoom:channel-id-123@conference.xmpp.zoom.us:1712600000000"
    );
    expect(capturedThread?.adapter.name).toBe("zoom");
  });
});

describe("Replay Tests - Zoom team_chat.app_mention", () => {
  let adapter: ZoomAdapter;
  let capturedThread: Thread | null;
  let capturedMessage: Message | null;
  let chat: Chat<{ zoom: ZoomAdapter }>;
  let cleanupFetchMock: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanupFetchMock = setupZoomFetchMock();

    adapter = createZoomAdapter({
      ...ZOOM_CREDENTIALS,
      userName: fixtures.botName,
      logger: mockLogger,
    });

    chat = new Chat({
      adapters: { zoom: adapter },
      logger: "error",
      state: createMemoryState(),
      userName: fixtures.botName,
    });

    capturedThread = null;
    capturedMessage = null;

    chat.onNewMessage(ALL_MESSAGES_PATTERN, async (thread, message) => {
      capturedThread = thread;
      capturedMessage = message;
    });
  });

  afterEach(async () => {
    await chat.shutdown();
    cleanupFetchMock();
  });

  it("should parse a team_chat.app_mention webhook into a normalized Message", async () => {
    const tracker = createWaitUntilTracker();
    await chat.webhooks.zoom(createZoomWebhookRequest(fixtures.appMention), {
      waitUntil: tracker.waitUntil,
    });
    await tracker.waitForAll();

    expect(capturedMessage).not.toBeNull();
    expect(capturedMessage?.text).toBe("@bot please help");
    expect(capturedMessage?.author.userId).toBe("user-id-3");
  });

  it("should construct correct threadId for team_chat.app_mention", async () => {
    const tracker = createWaitUntilTracker();
    await chat.webhooks.zoom(createZoomWebhookRequest(fixtures.appMention), {
      waitUntil: tracker.waitUntil,
    });
    await tracker.waitForAll();

    expect(capturedThread).not.toBeNull();
    // threadId = zoom:{channel_id}:{message_id}
    expect(capturedThread?.id).toBe(
      "zoom:channel-id-123:5DD614F4-DD19-ABCD-EF12-000000000001"
    );
    expect(capturedThread?.adapter.name).toBe("zoom");
  });
});

describe("Subscribe Flow - Zoom THRD-02", () => {
  let adapter: ZoomAdapter;
  let capturedSubscribedMessage: Message | null;
  let chat: Chat<{ zoom: ZoomAdapter }>;
  let cleanupFetchMock: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanupFetchMock = setupZoomFetchMock();

    adapter = createZoomAdapter({
      ...ZOOM_CREDENTIALS,
      userName: fixtures.botName,
      logger: mockLogger,
    });

    chat = new Chat({
      adapters: { zoom: adapter },
      logger: "error",
      state: createMemoryState(),
      userName: fixtures.botName,
    });

    capturedSubscribedMessage = null;

    chat.onNewMessage(ALL_MESSAGES_PATTERN, async (thread) => {
      await thread.subscribe();
    });

    chat.onSubscribedMessage(async (_thread, message) => {
      capturedSubscribedMessage = message;
    });
  });

  afterEach(async () => {
    await chat.shutdown();
    cleanupFetchMock();
  });

  it("should fire onSubscribedMessage when replaying a subscribed thread", async () => {
    // Send once — onNewMessage fires, subscribe() called, thread stored in state
    const tracker1 = createWaitUntilTracker();
    await chat.webhooks.zoom(
      createZoomWebhookRequest(fixtures.botNotification),
      { waitUntil: tracker1.waitUntil }
    );
    await tracker1.waitForAll();

    // onSubscribedMessage should NOT have fired yet (first send subscribes, doesn't replay)
    expect(capturedSubscribedMessage).toBeNull();

    // The first webhook subscribed threadId = zoom:channel-id-123@conference.xmpp.zoom.us:1712600000000.
    // To trigger onSubscribedMessage, we send a second message on that same thread ID
    // with a distinct message ID (to bypass deduplication).
    // We use handleIncomingMessage directly so we can supply the exact threadId
    // and a fresh message ID — this is the standard approach when the adapter assigns
    // per-message thread IDs (as Zoom does via event_ts).
    const subscribedThreadId =
      "zoom:channel-id-123@conference.xmpp.zoom.us:1712600000000";
    const followUpMessage = new Message({
      id: "follow-up-msg-1",
      threadId: subscribedThreadId,
      text: "hello world",
      formatted: { type: "root", children: [] },
      raw: {},
      author: {
        userId: "U00FAKEUSER1",
        userName: "Alice",
        fullName: "Alice",
        isBot: false,
        isMe: false,
      },
      metadata: {
        dateSent: new Date(fixtures.botNotification.event_ts),
        edited: false,
      },
      attachments: [],
    });
    await chat.handleIncomingMessage(
      adapter,
      subscribedThreadId,
      followUpMessage
    );

    expect(capturedSubscribedMessage).not.toBeNull();
    expect(capturedSubscribedMessage?.text).toBe("hello world");
  });
});
