import {
  createGoogleChatAdapter,
  type GoogleChatAdapter,
} from "@chat-adapter/gchat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat, type Logger } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ANY_CHAR_REGEX = /./;
const HELP_REGEX = /help/i;

import {
  createGoogleChatEvent,
  createGoogleChatWebhookRequest,
  createMockGoogleChatApi,
  GCHAT_BOT_NAME,
  GCHAT_TEST_CREDENTIALS,
  getGoogleChatThreadId,
  injectMockGoogleChatApi,
  type MockGoogleChatApi,
} from "./gchat-utils";
import { createWaitUntilTracker } from "./test-scenarios";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => mockLogger,
};

describe("Google Chat Integration", () => {
  let chat: Chat<{ gchat: GoogleChatAdapter }>;
  let state: ReturnType<typeof createMemoryState>;
  let gchatAdapter: GoogleChatAdapter;
  let mockChatApi: MockGoogleChatApi;
  let tracker: ReturnType<typeof createWaitUntilTracker>;

  const TEST_SPACE_NAME = "spaces/AAAA_BBBB";
  const TEST_THREAD_NAME = "spaces/AAAA_BBBB/threads/CCCC_DDDD";
  const TEST_THREAD_ID = getGoogleChatThreadId(
    TEST_SPACE_NAME,
    TEST_THREAD_NAME
  );

  beforeEach(() => {
    vi.clearAllMocks();

    state = createMemoryState();
    gchatAdapter = createGoogleChatAdapter({
      credentials: GCHAT_TEST_CREDENTIALS,
      userName: GCHAT_BOT_NAME,
      logger: mockLogger,
    });

    mockChatApi = createMockGoogleChatApi();
    injectMockGoogleChatApi(gchatAdapter, mockChatApi);

    chat = new Chat({
      userName: GCHAT_BOT_NAME,
      adapters: { gchat: gchatAdapter },
      state,
      logger: "error",
    });

    tracker = createWaitUntilTracker();
  });

  afterEach(async () => {
    await chat.shutdown();
  });

  describe("event handling", () => {
    it("should handle non-message events gracefully", async () => {
      // Event without messagePayload (e.g., app installation, card interactions, etc.)
      const event = {
        commonEventObject: {
          userLocale: "en",
          hostApp: "CHAT",
          platform: "WEB",
        },
        chat: {
          user: {
            name: "users/user-123",
            displayName: "John Doe",
            type: "HUMAN",
          },
          eventTime: new Date().toISOString(),
          // No messagePayload - represents a non-message event
        },
      };

      const request = new Request("https://example.com/webhook/gchat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });

      const response = await chat.webhooks.gchat(request);
      expect(response.status).toBe(200);
    });

    it("should return error for invalid JSON", async () => {
      const request = new Request("https://example.com/webhook/gchat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json",
      });

      const response = await chat.webhooks.gchat(request);
      expect(response.status).toBe(400);
    });
  });

  describe("message handling", () => {
    it("should handle an @mention and call the handler", async () => {
      const handlerMock = vi.fn();
      chat.onNewMention(async (thread, message) => {
        handlerMock(thread.id, message.text);
        await thread.post("Hello from Google Chat!");
      });

      const event = createGoogleChatEvent({
        text: `@${GCHAT_BOT_NAME} hello bot!`,
        messageName: `${TEST_SPACE_NAME}/messages/msg-001`,
        spaceName: TEST_SPACE_NAME,
        threadName: TEST_THREAD_NAME,
        senderId: "users/user-123",
        senderName: "John Doe",
        hasBotMention: true,
      });

      const request = createGoogleChatWebhookRequest(event);
      const response = await chat.webhooks.gchat(request, {
        waitUntil: tracker.waitUntil,
      });
      expect(response.status).toBe(200);

      await tracker.waitForAll();

      expect(handlerMock).toHaveBeenCalledWith(
        TEST_THREAD_ID,
        `@${GCHAT_BOT_NAME} hello bot!`
      );

      expect(mockChatApi.sentMessages).toContainEqual(
        expect.objectContaining({
          parent: TEST_SPACE_NAME,
          text: "Hello from Google Chat!",
        })
      );
    });

    it("should handle messages in subscribed threads", async () => {
      chat.onNewMention(async (thread) => {
        await thread.subscribe();
        await thread.post("I'm now listening!");
      });

      const subscribedHandler = vi.fn();
      chat.onSubscribedMessage(async (thread, message) => {
        subscribedHandler(thread.id, message.text);
        await thread.post(`You said: ${message.text}`);
      });

      // Initial mention to subscribe
      const mentionEvent = createGoogleChatEvent({
        text: `@${GCHAT_BOT_NAME} subscribe me`,
        messageName: `${TEST_SPACE_NAME}/messages/msg-001`,
        spaceName: TEST_SPACE_NAME,
        threadName: TEST_THREAD_NAME,
        senderId: "users/user-123",
        senderName: "John Doe",
        hasBotMention: true,
      });

      await chat.webhooks.gchat(createGoogleChatWebhookRequest(mentionEvent), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(mockChatApi.sentMessages).toContainEqual(
        expect.objectContaining({ text: "I'm now listening!" })
      );

      mockChatApi.clearMocks();

      // Follow-up message in same thread
      const followUpEvent = createGoogleChatEvent({
        text: "This is a follow-up message",
        messageName: `${TEST_SPACE_NAME}/messages/msg-002`,
        spaceName: TEST_SPACE_NAME,
        threadName: TEST_THREAD_NAME,
        senderId: "users/user-123",
        senderName: "John Doe",
      });

      await chat.webhooks.gchat(createGoogleChatWebhookRequest(followUpEvent), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(subscribedHandler).toHaveBeenCalledWith(
        TEST_THREAD_ID,
        "This is a follow-up message"
      );

      expect(mockChatApi.sentMessages).toContainEqual(
        expect.objectContaining({
          text: "You said: This is a follow-up message",
        })
      );
    });

    it("should handle messages matching a pattern", async () => {
      const patternHandler = vi.fn();
      chat.onNewMessage(HELP_REGEX, async (thread, message) => {
        patternHandler(message.text);
        await thread.post("Here is some help!");
      });

      const event = createGoogleChatEvent({
        text: "I need help with something",
        messageName: `${TEST_SPACE_NAME}/messages/msg-001`,
        spaceName: TEST_SPACE_NAME,
        threadName: TEST_THREAD_NAME,
        senderId: "users/user-123",
        senderName: "John Doe",
      });

      await chat.webhooks.gchat(createGoogleChatWebhookRequest(event), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(patternHandler).toHaveBeenCalledWith("I need help with something");
      expect(mockChatApi.sentMessages).toContainEqual(
        expect.objectContaining({ text: "Here is some help!" })
      );
    });

    it("should skip messages from this bot (isMe)", async () => {
      const handlerMock = vi.fn();
      chat.onNewMessage(ANY_CHAR_REGEX, () => {
        handlerMock();
      });

      // Set the bot's user ID so it can identify its own messages
      const botUserId = "users/bot-user-123";
      gchatAdapter.botUserId = botUserId;

      const event = createGoogleChatEvent({
        text: "Bot's own message",
        messageName: `${TEST_SPACE_NAME}/messages/msg-001`,
        spaceName: TEST_SPACE_NAME,
        threadName: TEST_THREAD_NAME,
        senderId: botUserId, // Same as the bot's user ID
        senderName: GCHAT_BOT_NAME,
        senderType: "BOT",
      });

      await chat.webhooks.gchat(createGoogleChatWebhookRequest(event), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(handlerMock).not.toHaveBeenCalled();
    });

    it("should process messages from other bots (not isMe)", async () => {
      const handlerMock = vi.fn();
      chat.onNewMessage(ANY_CHAR_REGEX, () => {
        handlerMock();
      });

      // Set the bot's user ID
      gchatAdapter.botUserId = "users/my-bot-123";

      // Send a message from a DIFFERENT bot
      const event = createGoogleChatEvent({
        text: "Message from another bot",
        messageName: `${TEST_SPACE_NAME}/messages/msg-001`,
        spaceName: TEST_SPACE_NAME,
        threadName: TEST_THREAD_NAME,
        senderId: "users/other-bot-456", // Different bot
        senderName: "Other Bot",
        senderType: "BOT",
      });

      await chat.webhooks.gchat(createGoogleChatWebhookRequest(event), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Should process messages from other bots
      expect(handlerMock).toHaveBeenCalled();
    });
  });

  describe("message editing and reactions", () => {
    it("should allow editing a sent message", async () => {
      chat.onNewMention(async (thread) => {
        const msg = await thread.post("Original message");
        await msg.edit("Edited message");
      });

      const event = createGoogleChatEvent({
        text: `@${GCHAT_BOT_NAME} edit test`,
        messageName: `${TEST_SPACE_NAME}/messages/msg-001`,
        spaceName: TEST_SPACE_NAME,
        threadName: TEST_THREAD_NAME,
        senderId: "users/user-123",
        senderName: "John Doe",
        hasBotMention: true,
      });

      await chat.webhooks.gchat(createGoogleChatWebhookRequest(event), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(mockChatApi.updatedMessages).toContainEqual(
        expect.objectContaining({ text: "Edited message" })
      );
    });

    it("should allow adding reactions to messages", async () => {
      chat.onNewMention(async (thread) => {
        const msg = await thread.post("React to this!");
        await msg.addReaction("👍");
      });

      const event = createGoogleChatEvent({
        text: `@${GCHAT_BOT_NAME} react`,
        messageName: `${TEST_SPACE_NAME}/messages/msg-001`,
        spaceName: TEST_SPACE_NAME,
        threadName: TEST_THREAD_NAME,
        senderId: "users/user-123",
        senderName: "John Doe",
        hasBotMention: true,
      });

      await chat.webhooks.gchat(createGoogleChatWebhookRequest(event), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(mockChatApi.addedReactions).toContainEqual(
        expect.objectContaining({ emoji: "👍" })
      );
    });
  });

  describe("thread operations", () => {
    it("should include thread info in message objects", async () => {
      let capturedMessage: unknown;
      chat.onNewMention((_thread, message) => {
        capturedMessage = message;
      });

      const event = createGoogleChatEvent({
        text: `@${GCHAT_BOT_NAME} test`,
        messageName: `${TEST_SPACE_NAME}/messages/msg-001`,
        spaceName: TEST_SPACE_NAME,
        threadName: TEST_THREAD_NAME,
        senderId: "users/user-123",
        senderName: "John Doe",
        hasBotMention: true,
      });

      await chat.webhooks.gchat(createGoogleChatWebhookRequest(event), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(capturedMessage).toBeDefined();
      const msg = capturedMessage as {
        threadId: string;
        author: { userId: string; userName: string; isBot: boolean };
      };
      expect(msg.threadId).toBe(TEST_THREAD_ID);
      expect(msg.author.userId).toBe("users/user-123");
      expect(msg.author.userName).toBe("John Doe");
      expect(msg.author.isBot).toBe(false);
    });
  });

  describe("markdown formatting", () => {
    it("should convert markdown to Google Chat format in posted messages", async () => {
      chat.onNewMention(async (thread) => {
        await thread.post({
          markdown: "**Bold** and _italic_ and `code`",
        });
      });

      const event = createGoogleChatEvent({
        text: `@${GCHAT_BOT_NAME} markdown test`,
        messageName: `${TEST_SPACE_NAME}/messages/msg-001`,
        spaceName: TEST_SPACE_NAME,
        threadName: TEST_THREAD_NAME,
        senderId: "users/user-123",
        senderName: "John Doe",
        hasBotMention: true,
      });

      await chat.webhooks.gchat(createGoogleChatWebhookRequest(event), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Google Chat uses *bold* and _italic_
      const sent = mockChatApi.sentMessages[0];
      expect(sent.text).toContain("*Bold*");
      expect(sent.text).toContain("_italic_");
      expect(sent.text).toContain("`code`");
    });

    it("should pass @mentions through as-is in posted messages", async () => {
      chat.onNewMention(async (thread) => {
        await thread.post("Hey @john, check this out!");
      });

      const event = createGoogleChatEvent({
        text: `@${GCHAT_BOT_NAME} mention test`,
        messageName: `${TEST_SPACE_NAME}/messages/msg-001`,
        spaceName: TEST_SPACE_NAME,
        threadName: TEST_THREAD_NAME,
        senderId: "users/user-123",
        senderName: "John Doe",
        hasBotMention: true,
      });

      await chat.webhooks.gchat(createGoogleChatWebhookRequest(event), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Google Chat: @mentions are passed through as-is (no conversion needed)
      const sent = mockChatApi.sentMessages[0];
      expect(sent.text).toBe("Hey @john, check this out!");
    });
  });

  describe("multi-message conversation flow", () => {
    it("should handle a full conversation with multiple messages in a thread", async () => {
      const conversationLog: string[] = [];
      let messageCount = 0;

      chat.onNewMention(async (thread, message) => {
        conversationLog.push(`mention: ${message.text}`);
        await thread.subscribe();
        await thread.post(
          "Hi! I'm now listening to this thread. How can I help?"
        );
      });

      chat.onSubscribedMessage(async (thread, message) => {
        conversationLog.push(`subscribed: ${message.text}`);
        messageCount++;

        if (message.text.includes("weather")) {
          const response = await thread.post(
            "Let me check the weather for you..."
          );
          await response.edit("The weather today is sunny, 72°F!");
        } else if (message.text.includes("thanks")) {
          const response = await thread.post(
            "You're welcome! Let me know if you need anything else."
          );
          await response.addReaction("😊");
        } else {
          await thread.post(`Got it! You said: "${message.text}"`);
        }
      });

      // Message 1: Initial mention
      const mentionEvent = createGoogleChatEvent({
        text: `@${GCHAT_BOT_NAME} hey bot!`,
        messageName: `${TEST_SPACE_NAME}/messages/msg-001`,
        spaceName: TEST_SPACE_NAME,
        threadName: TEST_THREAD_NAME,
        senderId: "users/user-123",
        senderName: "John Doe",
        hasBotMention: true,
      });

      await chat.webhooks.gchat(createGoogleChatWebhookRequest(mentionEvent), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(conversationLog).toContain(`mention: @${GCHAT_BOT_NAME} hey bot!`);
      expect(mockChatApi.sentMessages).toContainEqual(
        expect.objectContaining({
          text: "Hi! I'm now listening to this thread. How can I help?",
        })
      );

      mockChatApi.clearMocks();

      // Message 2: Weather query
      const weatherEvent = createGoogleChatEvent({
        text: "What's the weather like?",
        messageName: `${TEST_SPACE_NAME}/messages/msg-002`,
        spaceName: TEST_SPACE_NAME,
        threadName: TEST_THREAD_NAME,
        senderId: "users/user-123",
        senderName: "John Doe",
      });

      await chat.webhooks.gchat(createGoogleChatWebhookRequest(weatherEvent), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(conversationLog).toContain("subscribed: What's the weather like?");
      expect(mockChatApi.sentMessages).toContainEqual(
        expect.objectContaining({
          text: "Let me check the weather for you...",
        })
      );
      expect(mockChatApi.updatedMessages).toContainEqual(
        expect.objectContaining({ text: "The weather today is sunny, 72°F!" })
      );

      mockChatApi.clearMocks();

      // Message 3: Follow-up
      const followUpEvent = createGoogleChatEvent({
        text: "That sounds nice!",
        messageName: `${TEST_SPACE_NAME}/messages/msg-003`,
        spaceName: TEST_SPACE_NAME,
        threadName: TEST_THREAD_NAME,
        senderId: "users/user-123",
        senderName: "John Doe",
      });

      await chat.webhooks.gchat(createGoogleChatWebhookRequest(followUpEvent), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(conversationLog).toContain("subscribed: That sounds nice!");

      mockChatApi.clearMocks();

      // Message 4: Thanks
      const thanksEvent = createGoogleChatEvent({
        text: "thanks for your help!",
        messageName: `${TEST_SPACE_NAME}/messages/msg-004`,
        spaceName: TEST_SPACE_NAME,
        threadName: TEST_THREAD_NAME,
        senderId: "users/user-123",
        senderName: "John Doe",
      });

      await chat.webhooks.gchat(createGoogleChatWebhookRequest(thanksEvent), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(conversationLog).toContain("subscribed: thanks for your help!");
      expect(mockChatApi.addedReactions).toContainEqual(
        expect.objectContaining({ emoji: "😊" })
      );

      expect(messageCount).toBe(3);
      expect(conversationLog).toEqual([
        `mention: @${GCHAT_BOT_NAME} hey bot!`,
        "subscribed: What's the weather like?",
        "subscribed: That sounds nice!",
        "subscribed: thanks for your help!",
      ]);
    });

    it("should handle multiple concurrent threads independently", async () => {
      const threadResponses: Record<string, string[]> = {};

      chat.onNewMention(async (thread, message) => {
        const threadId = thread.id;
        if (!threadResponses[threadId]) {
          threadResponses[threadId] = [];
        }
        threadResponses[threadId].push(message.text);
        await thread.subscribe();
        await thread.post("Subscribed to Google Chat thread");
      });

      chat.onSubscribedMessage(async (thread, message) => {
        const threadId = thread.id;
        if (!threadResponses[threadId]) {
          threadResponses[threadId] = [];
        }
        threadResponses[threadId].push(message.text);
        await thread.post(`Reply: ${message.text}`);
      });

      const thread1Name = "spaces/AAAA_BBBB/threads/thread-1";
      const thread2Name = "spaces/AAAA_BBBB/threads/thread-2";
      const thread1Id = getGoogleChatThreadId(TEST_SPACE_NAME, thread1Name);
      const thread2Id = getGoogleChatThreadId(TEST_SPACE_NAME, thread2Name);

      // Start thread 1
      const thread1Mention = createGoogleChatEvent({
        text: `@${GCHAT_BOT_NAME} Thread 1 start`,
        messageName: `${TEST_SPACE_NAME}/messages/t1-msg-001`,
        spaceName: TEST_SPACE_NAME,
        threadName: thread1Name,
        senderId: "users/user-A",
        senderName: "User A",
        hasBotMention: true,
      });

      await chat.webhooks.gchat(
        createGoogleChatWebhookRequest(thread1Mention),
        {
          waitUntil: tracker.waitUntil,
        }
      );
      await tracker.waitForAll();

      // Start thread 2
      const thread2Mention = createGoogleChatEvent({
        text: `@${GCHAT_BOT_NAME} Thread 2 start`,
        messageName: `${TEST_SPACE_NAME}/messages/t2-msg-001`,
        spaceName: TEST_SPACE_NAME,
        threadName: thread2Name,
        senderId: "users/user-B",
        senderName: "User B",
        hasBotMention: true,
      });

      await chat.webhooks.gchat(
        createGoogleChatWebhookRequest(thread2Mention),
        {
          waitUntil: tracker.waitUntil,
        }
      );
      await tracker.waitForAll();

      mockChatApi.clearMocks();

      // Follow-up to thread 1
      const thread1FollowUp = createGoogleChatEvent({
        text: "Thread 1 message",
        messageName: `${TEST_SPACE_NAME}/messages/t1-msg-002`,
        spaceName: TEST_SPACE_NAME,
        threadName: thread1Name,
        senderId: "users/user-A",
        senderName: "User A",
      });

      await chat.webhooks.gchat(
        createGoogleChatWebhookRequest(thread1FollowUp),
        {
          waitUntil: tracker.waitUntil,
        }
      );
      await tracker.waitForAll();

      // Follow-up to thread 2
      const thread2FollowUp = createGoogleChatEvent({
        text: "Thread 2 message",
        messageName: `${TEST_SPACE_NAME}/messages/t2-msg-002`,
        spaceName: TEST_SPACE_NAME,
        threadName: thread2Name,
        senderId: "users/user-B",
        senderName: "User B",
      });

      await chat.webhooks.gchat(
        createGoogleChatWebhookRequest(thread2FollowUp),
        {
          waitUntil: tracker.waitUntil,
        }
      );
      await tracker.waitForAll();

      // Verify thread isolation
      expect(threadResponses[thread1Id]).toEqual([
        `@${GCHAT_BOT_NAME} Thread 1 start`,
        "Thread 1 message",
      ]);

      expect(threadResponses[thread2Id]).toEqual([
        `@${GCHAT_BOT_NAME} Thread 2 start`,
        "Thread 2 message",
      ]);
    });
  });
});
