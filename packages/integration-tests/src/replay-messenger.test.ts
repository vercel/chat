/**
 * Replay tests for Messenger webhook flows.
 *
 * These tests replay Messenger webhook payloads to verify DM handling,
 * message history, reactions, postbacks, and channel operations.
 */

import {
  createMessengerAdapter,
  type MessengerAdapter,
} from "@chat-adapter/messenger";
import { createMemoryState } from "@chat-adapter/state-memory";
import {
  type ActionEvent,
  type Channel,
  Chat,
  type Logger,
  type Message,
  type ReactionEvent,
  type Thread,
} from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtures from "../fixtures/replay/dm/messenger.json";
import {
  createMessengerWebhookRequest,
  createMockMessengerApi,
  MESSENGER_APP_SECRET,
  MESSENGER_PAGE_ACCESS_TOKEN,
  MESSENGER_VERIFY_TOKEN,
  type MockMessengerApi,
  setupMessengerFetchMock,
} from "./messenger-utils";
import { createWaitUntilTracker } from "./test-scenarios";

interface CapturedDM {
  channel: Channel | null;
  message: Message | null;
  thread: Thread | null;
}

interface CapturedAction {
  event: ActionEvent | null;
}

interface CapturedReaction {
  event: ReactionEvent | null;
}

const mockLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => mockLogger,
};

describe("Messenger", () => {
  describe("direct messages", () => {
    let adapter: MessengerAdapter;
    let captured: CapturedDM;
    let capturedAction: CapturedAction;
    let capturedReaction: CapturedReaction;
    let chat: Chat<{ messenger: MessengerAdapter }>;
    let cleanupFetchMock: (() => void) | undefined;
    let mockApi: MockMessengerApi;

    beforeEach(() => {
      vi.clearAllMocks();
      mockApi = createMockMessengerApi();
      cleanupFetchMock = setupMessengerFetchMock(mockApi, {
        pageId: fixtures.pageId,
      });

      adapter = createMessengerAdapter({
        appSecret: MESSENGER_APP_SECRET,
        pageAccessToken: MESSENGER_PAGE_ACCESS_TOKEN,
        verifyToken: MESSENGER_VERIFY_TOKEN,
        userName: fixtures.botName,
        logger: mockLogger,
      });

      chat = new Chat({
        adapters: { messenger: adapter },
        logger: "error",
        state: createMemoryState(),
        userName: fixtures.botName,
      });

      captured = {
        channel: null,
        message: null,
        thread: null,
      };

      capturedAction = { event: null };
      capturedReaction = { event: null };

      chat.onDirectMessage(async (thread, message, channel) => {
        captured.thread = thread;
        captured.message = message;
        captured.channel = channel;
        await channel.post(`Echo: ${message.text}`);
      });

      chat.onAction("hello", async (event) => {
        capturedAction.event = event;
        if (event.thread) {
          await event.thread.post("Hello from action handler!");
        }
      });

      chat.onAction(async (event) => {
        if (!capturedAction.event) {
          capturedAction.event = event;
        }
      });

      chat.onReaction(async (event) => {
        capturedReaction.event = event;
      });
    });

    afterEach(async () => {
      await chat.shutdown();
      cleanupFetchMock?.();
    });

    async function sendWebhook(payload: unknown): Promise<void> {
      const tracker = createWaitUntilTracker();
      await chat.webhooks.messenger(createMessengerWebhookRequest(payload), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();
    }

    it("parses a DM webhook and calls the DM handler", async () => {
      await sendWebhook(fixtures.firstMessage);

      expect(captured.message).not.toBeNull();
      expect(captured.message?.text).toBe("What is Vercel?");
      expect(captured.message?.author.userId).toBe("200000000000001");
      expect(captured.message?.author.isBot).toBe(false);
      expect(captured.message?.author.isMe).toBe(false);
    });

    it("constructs correct thread and channel IDs", async () => {
      await sendWebhook(fixtures.firstMessage);

      expect(captured.thread).not.toBeNull();
      expect(captured.thread?.id).toBe("messenger:200000000000001");
      expect(captured.thread?.isDM).toBe(true);
      expect(captured.thread?.adapter.name).toBe("messenger");

      expect(captured.channel).not.toBeNull();
      expect(captured.channel?.id).toBe(captured.thread?.id);
      expect(captured.channel?.isDM).toBe(true);
    });

    it("sends a response via the Graph API", async () => {
      await sendWebhook(fixtures.firstMessage);

      expect(mockApi.sentMessages).toHaveLength(1);
      expect(mockApi.sentMessages[0].to).toBe("200000000000001");
      expect(mockApi.sentMessages[0].text).toContain("Echo: What is Vercel?");
    });

    it("ignores delivery confirmations", async () => {
      await sendWebhook(fixtures.deliveryConfirmation);

      expect(captured.message).toBeNull();
      expect(mockApi.sentMessages).toHaveLength(0);
    });

    it("ignores read confirmations", async () => {
      await sendWebhook(fixtures.readConfirmation);

      expect(captured.message).toBeNull();
      expect(mockApi.sentMessages).toHaveLength(0);
    });

    it("handles sequential DM messages", async () => {
      await sendWebhook(fixtures.firstMessage);
      expect(captured.message?.text).toBe("What is Vercel?");

      mockApi.clearMocks();
      captured.message = null;

      await sendWebhook(fixtures.secondMessage);
      expect((captured as CapturedDM).message?.text).toBe("Tell me more");
      expect(mockApi.sentMessages).toHaveLength(1);
      expect(mockApi.sentMessages[0].text).toContain("Echo: Tell me more");
    });

    it("persists message history for DM threads", async () => {
      await sendWebhook(fixtures.firstMessage);
      mockApi.clearMocks();
      captured.message = null;

      await sendWebhook(fixtures.secondMessage);

      const channel = captured.channel;
      expect(channel).not.toBeNull();
      const messages: Message[] = [];
      if (channel) {
        for await (const msg of channel.messages) {
          messages.push(msg);
        }
      }
      expect(messages.length).toBeGreaterThanOrEqual(2);
    });

    it("caches echo messages without triggering handler", async () => {
      await sendWebhook(fixtures.echoMessage);

      expect(captured.message).toBeNull();
      expect(mockApi.sentMessages).toHaveLength(0);
    });
  });

  describe("reactions", () => {
    let adapter: MessengerAdapter;
    let capturedReaction: CapturedReaction;
    let chat: Chat<{ messenger: MessengerAdapter }>;
    let cleanupFetchMock: (() => void) | undefined;
    let mockApi: MockMessengerApi;

    beforeEach(() => {
      vi.clearAllMocks();
      mockApi = createMockMessengerApi();
      cleanupFetchMock = setupMessengerFetchMock(mockApi, {
        pageId: fixtures.pageId,
      });

      adapter = createMessengerAdapter({
        appSecret: MESSENGER_APP_SECRET,
        pageAccessToken: MESSENGER_PAGE_ACCESS_TOKEN,
        verifyToken: MESSENGER_VERIFY_TOKEN,
        userName: fixtures.botName,
        logger: mockLogger,
      });

      chat = new Chat({
        adapters: { messenger: adapter },
        logger: "error",
        state: createMemoryState(),
        userName: fixtures.botName,
      });

      capturedReaction = { event: null };

      chat.onReaction(async (event) => {
        capturedReaction.event = event;
      });
    });

    afterEach(async () => {
      await chat.shutdown();
      cleanupFetchMock?.();
    });

    async function sendWebhook(payload: unknown): Promise<void> {
      const tracker = createWaitUntilTracker();
      await chat.webhooks.messenger(createMessengerWebhookRequest(payload), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();
    }

    it("handles reaction added events", async () => {
      await sendWebhook(fixtures.reactionAdded);

      expect(capturedReaction.event).not.toBeNull();
      expect(capturedReaction.event?.added).toBe(true);
      expect(capturedReaction.event?.rawEmoji).toBe("❤");
      expect(capturedReaction.event?.messageId).toBe("m_FAKE_MSG_ID_001");
    });

    it("handles reaction removed events", async () => {
      await sendWebhook(fixtures.reactionRemoved);

      expect(capturedReaction.event).not.toBeNull();
      expect(capturedReaction.event?.added).toBe(false);
      expect(capturedReaction.event?.rawEmoji).toBe("❤");
    });
  });

  describe("postbacks", () => {
    let adapter: MessengerAdapter;
    let capturedAction: CapturedAction;
    let chat: Chat<{ messenger: MessengerAdapter }>;
    let cleanupFetchMock: (() => void) | undefined;
    let mockApi: MockMessengerApi;

    beforeEach(() => {
      vi.clearAllMocks();
      mockApi = createMockMessengerApi();
      cleanupFetchMock = setupMessengerFetchMock(mockApi, {
        pageId: fixtures.pageId,
      });

      adapter = createMessengerAdapter({
        appSecret: MESSENGER_APP_SECRET,
        pageAccessToken: MESSENGER_PAGE_ACCESS_TOKEN,
        verifyToken: MESSENGER_VERIFY_TOKEN,
        userName: fixtures.botName,
        logger: mockLogger,
      });

      chat = new Chat({
        adapters: { messenger: adapter },
        logger: "error",
        state: createMemoryState(),
        userName: fixtures.botName,
      });

      capturedAction = { event: null };

      chat.onAction("hello", async (event) => {
        capturedAction.event = event;
        if (event.thread) {
          await event.thread.post("Hello from action handler!");
        }
      });

      chat.onAction("GET_STARTED", async (event) => {
        capturedAction.event = event;
      });
    });

    afterEach(async () => {
      await chat.shutdown();
      cleanupFetchMock?.();
    });

    async function sendWebhook(payload: unknown): Promise<void> {
      const tracker = createWaitUntilTracker();
      await chat.webhooks.messenger(createMessengerWebhookRequest(payload), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();
    }

    it("decodes chat: prefixed postback payloads", async () => {
      await sendWebhook(fixtures.postbackClick);

      expect(capturedAction.event).not.toBeNull();
      expect(capturedAction.event?.actionId).toBe("hello");
      expect(capturedAction.event?.value).toBeUndefined();
    });

    it("handles legacy postback payloads as passthrough", async () => {
      await sendWebhook(fixtures.legacyPostback);

      expect(capturedAction.event).not.toBeNull();
      expect(capturedAction.event?.actionId).toBe("GET_STARTED");
      expect(capturedAction.event?.value).toBe("GET_STARTED");
    });

    it("sends response from postback action handler", async () => {
      await sendWebhook(fixtures.postbackClick);

      expect(mockApi.sentMessages).toHaveLength(1);
      expect(mockApi.sentMessages[0].text).toBe("Hello from action handler!");
    });
  });

  describe("attachments", () => {
    let adapter: MessengerAdapter;
    let captured: CapturedDM;
    let chat: Chat<{ messenger: MessengerAdapter }>;
    let cleanupFetchMock: (() => void) | undefined;
    let mockApi: MockMessengerApi;

    beforeEach(() => {
      vi.clearAllMocks();
      mockApi = createMockMessengerApi();
      cleanupFetchMock = setupMessengerFetchMock(mockApi, {
        pageId: fixtures.pageId,
      });

      adapter = createMessengerAdapter({
        appSecret: MESSENGER_APP_SECRET,
        pageAccessToken: MESSENGER_PAGE_ACCESS_TOKEN,
        verifyToken: MESSENGER_VERIFY_TOKEN,
        userName: fixtures.botName,
        logger: mockLogger,
      });

      chat = new Chat({
        adapters: { messenger: adapter },
        logger: "error",
        state: createMemoryState(),
        userName: fixtures.botName,
      });

      captured = {
        channel: null,
        message: null,
        thread: null,
      };

      chat.onDirectMessage(async (thread, message, channel) => {
        captured.thread = thread;
        captured.message = message;
        captured.channel = channel;
      });
    });

    afterEach(async () => {
      await chat.shutdown();
      cleanupFetchMock?.();
    });

    async function sendWebhook(payload: unknown): Promise<void> {
      const tracker = createWaitUntilTracker();
      await chat.webhooks.messenger(createMessengerWebhookRequest(payload), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();
    }

    it("parses image attachments", async () => {
      await sendWebhook(fixtures.imageAttachment);

      expect(captured.message).not.toBeNull();
      expect(captured.message?.attachments).toHaveLength(1);
      expect(captured.message?.attachments[0].type).toBe("image");
      expect(captured.message?.attachments[0].url).toBe(
        "https://example.com/image.jpg"
      );
    });
  });
});
