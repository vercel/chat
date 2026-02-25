import { createMemoryState } from "@chat-adapter/state-memory";
import { createTeamsAdapter, type TeamsAdapter } from "@chat-adapter/teams";
import { Chat, type Logger } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockBotAdapter,
  createTeamsActivity,
  createTeamsWebhookRequest,
  DEFAULT_TEAMS_SERVICE_URL,
  getTeamsThreadId,
  injectMockBotAdapter,
  type MockBotAdapter,
  TEAMS_APP_ID,
  TEAMS_APP_PASSWORD,
  TEAMS_BOT_ID,
  TEAMS_BOT_NAME,
} from "./teams-utils";
import { createWaitUntilTracker } from "./test-scenarios";

const ANY_CHAR_REGEX = /./;
const HELP_REGEX = /help/i;

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => mockLogger,
};

describe("Teams Integration", () => {
  let chat: Chat<{ teams: TeamsAdapter }>;
  let state: ReturnType<typeof createMemoryState>;
  let teamsAdapter: TeamsAdapter;
  let mockBotAdapter: MockBotAdapter;
  let tracker: ReturnType<typeof createWaitUntilTracker>;

  const TEST_CONVERSATION_ID = "19:meeting_123@thread.v2";
  const TEST_THREAD_ID = getTeamsThreadId(
    TEST_CONVERSATION_ID,
    DEFAULT_TEAMS_SERVICE_URL
  );

  beforeEach(() => {
    vi.clearAllMocks();

    state = createMemoryState();
    teamsAdapter = createTeamsAdapter({
      appId: TEAMS_APP_ID,
      appPassword: TEAMS_APP_PASSWORD,
      userName: TEAMS_BOT_NAME,
      logger: mockLogger,
    });

    mockBotAdapter = createMockBotAdapter();
    injectMockBotAdapter(teamsAdapter, mockBotAdapter);

    chat = new Chat({
      userName: TEAMS_BOT_NAME,
      adapters: { teams: teamsAdapter },
      state,
      logger: "error",
    });

    tracker = createWaitUntilTracker();
  });

  afterEach(async () => {
    await chat.shutdown();
  });

  describe("message handling", () => {
    it("should handle an @mention and call the handler", async () => {
      const handlerMock = vi.fn();
      chat.onNewMention(async (thread, message) => {
        handlerMock(thread.id, message.text);
        await thread.post("Hello from Teams!");
      });

      const activity = createTeamsActivity({
        text: `<at>${TEAMS_BOT_NAME}</at> hello bot!`,
        messageId: "msg-001",
        conversationId: TEST_CONVERSATION_ID,
        fromId: "user-123",
        fromName: "John Doe",
        mentions: [
          {
            id: TEAMS_BOT_ID,
            name: TEAMS_BOT_NAME,
            text: `<at>${TEAMS_BOT_NAME}</at>`,
          },
        ],
      });

      const request = createTeamsWebhookRequest(activity);
      const response = await chat.webhooks.teams(request, {
        waitUntil: tracker.waitUntil,
      });
      expect(response.status).toBe(200);

      await tracker.waitForAll();

      // Mentions are normalized to @name format
      expect(handlerMock).toHaveBeenCalledWith(
        TEST_THREAD_ID,
        `@${TEAMS_BOT_NAME} hello bot!`
      );

      expect(mockBotAdapter.sentActivities.length).toBeGreaterThan(0);
      const sentActivity = mockBotAdapter.sentActivities[0] as { text: string };
      expect(sentActivity.text).toBe("Hello from Teams!");
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
      const mentionActivity = createTeamsActivity({
        text: `<at>${TEAMS_BOT_NAME}</at> subscribe me`,
        messageId: "msg-001",
        conversationId: TEST_CONVERSATION_ID,
        fromId: "user-123",
        fromName: "John Doe",
        mentions: [
          {
            id: TEAMS_BOT_ID,
            name: TEAMS_BOT_NAME,
            text: `<at>${TEAMS_BOT_NAME}</at>`,
          },
        ],
      });

      await chat.webhooks.teams(createTeamsWebhookRequest(mentionActivity), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(mockBotAdapter.sentActivities).toContainEqual(
        expect.objectContaining({ text: "I'm now listening!" })
      );

      mockBotAdapter.clearMocks();

      // Follow-up message in same thread
      const followUpActivity = createTeamsActivity({
        text: "This is a follow-up message",
        messageId: "msg-002",
        conversationId: TEST_CONVERSATION_ID,
        fromId: "user-123",
        fromName: "John Doe",
      });

      await chat.webhooks.teams(createTeamsWebhookRequest(followUpActivity), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(subscribedHandler).toHaveBeenCalledWith(
        TEST_THREAD_ID,
        "This is a follow-up message"
      );

      expect(mockBotAdapter.sentActivities).toContainEqual(
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

      const activity = createTeamsActivity({
        text: "I need help with something",
        messageId: "msg-001",
        conversationId: TEST_CONVERSATION_ID,
        fromId: "user-123",
        fromName: "John Doe",
      });

      await chat.webhooks.teams(createTeamsWebhookRequest(activity), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(patternHandler).toHaveBeenCalledWith("I need help with something");
      expect(mockBotAdapter.sentActivities).toContainEqual(
        expect.objectContaining({ text: "Here is some help!" })
      );
    });

    it("should skip messages from the bot itself", async () => {
      const handlerMock = vi.fn();
      chat.onNewMessage(ANY_CHAR_REGEX, () => {
        handlerMock();
      });

      const activity = createTeamsActivity({
        text: "Bot's own message",
        messageId: "msg-001",
        conversationId: TEST_CONVERSATION_ID,
        fromId: TEAMS_BOT_ID,
        fromName: TEAMS_BOT_NAME,
        isFromBot: true,
        recipientId: TEAMS_BOT_ID,
      });

      await chat.webhooks.teams(createTeamsWebhookRequest(activity), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(handlerMock).not.toHaveBeenCalled();
    });

    it("should skip non-message activity types", async () => {
      const handlerMock = vi.fn();
      chat.onNewMessage(ANY_CHAR_REGEX, () => {
        handlerMock();
      });

      const activity = createTeamsActivity({
        type: "conversationUpdate",
        text: "",
        messageId: "msg-001",
        conversationId: TEST_CONVERSATION_ID,
        fromId: "user-123",
        fromName: "John Doe",
      });

      await chat.webhooks.teams(createTeamsWebhookRequest(activity), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(handlerMock).not.toHaveBeenCalled();
    });
  });

  describe("message editing", () => {
    it("should allow editing a sent message", async () => {
      chat.onNewMention(async (thread) => {
        const msg = await thread.post("Original message");
        await msg.edit("Edited message");
      });

      const activity = createTeamsActivity({
        text: `<at>${TEAMS_BOT_NAME}</at> edit test`,
        messageId: "msg-001",
        conversationId: TEST_CONVERSATION_ID,
        fromId: "user-123",
        fromName: "John Doe",
        mentions: [
          {
            id: TEAMS_BOT_ID,
            name: TEAMS_BOT_NAME,
            text: `<at>${TEAMS_BOT_NAME}</at>`,
          },
        ],
      });

      await chat.webhooks.teams(createTeamsWebhookRequest(activity), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(mockBotAdapter.updatedActivities).toContainEqual(
        expect.objectContaining({ text: "Edited message" })
      );
    });
  });

  describe("thread operations", () => {
    it("should include thread info in message objects", async () => {
      let capturedMessage: unknown;
      chat.onNewMention((_thread, message) => {
        capturedMessage = message;
      });

      const activity = createTeamsActivity({
        text: `<at>${TEAMS_BOT_NAME}</at> test`,
        messageId: "msg-001",
        conversationId: TEST_CONVERSATION_ID,
        fromId: "user-123",
        fromName: "John Doe",
        mentions: [
          {
            id: TEAMS_BOT_ID,
            name: TEAMS_BOT_NAME,
            text: `<at>${TEAMS_BOT_NAME}</at>`,
          },
        ],
      });

      await chat.webhooks.teams(createTeamsWebhookRequest(activity), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(capturedMessage).toBeDefined();
      const msg = capturedMessage as {
        threadId: string;
        author: { userId: string; userName: string; isBot: boolean };
      };
      expect(msg.threadId).toBe(TEST_THREAD_ID);
      expect(msg.author.userId).toBe("user-123");
      expect(msg.author.userName).toBe("John Doe");
      expect(msg.author.isBot).toBe(false);
    });
  });

  describe("markdown formatting", () => {
    it("should convert markdown to Teams format in posted messages", async () => {
      chat.onNewMention(async (thread) => {
        await thread.post({
          markdown: "**Bold** and _italic_ and `code`",
        });
      });

      const activity = createTeamsActivity({
        text: `<at>${TEAMS_BOT_NAME}</at> markdown test`,
        messageId: "msg-001",
        conversationId: TEST_CONVERSATION_ID,
        fromId: "user-123",
        fromName: "John Doe",
        mentions: [
          {
            id: TEAMS_BOT_ID,
            name: TEAMS_BOT_NAME,
            text: `<at>${TEAMS_BOT_NAME}</at>`,
          },
        ],
      });

      await chat.webhooks.teams(createTeamsWebhookRequest(activity), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Teams uses standard markdown
      const sentActivity = mockBotAdapter.sentActivities[0] as { text: string };
      expect(sentActivity.text).toContain("**Bold**");
      expect(sentActivity.text).toContain("_italic_");
      expect(sentActivity.text).toContain("`code`");
    });

    it("should convert @mentions to Teams format in posted messages", async () => {
      chat.onNewMention(async (thread) => {
        await thread.post("Hey @john, check this out!");
      });

      const activity = createTeamsActivity({
        text: `<at>${TEAMS_BOT_NAME}</at> mention test`,
        messageId: "msg-001",
        conversationId: TEST_CONVERSATION_ID,
        fromId: "user-123",
        fromName: "John Doe",
        mentions: [
          {
            id: TEAMS_BOT_ID,
            name: TEAMS_BOT_NAME,
            text: `<at>${TEAMS_BOT_NAME}</at>`,
          },
        ],
      });

      await chat.webhooks.teams(createTeamsWebhookRequest(activity), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // @mentions should be converted to Teams' <at>mention</at> format
      const sentActivity = mockBotAdapter.sentActivities[0] as { text: string };
      expect(sentActivity.text).toBe("Hey <at>john</at>, check this out!");
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
          await thread.post(
            "You're welcome! Let me know if you need anything else."
          );
        } else {
          await thread.post(`Got it! You said: "${message.text}"`);
        }
      });

      // Message 1: Initial mention
      const mentionActivity = createTeamsActivity({
        text: `<at>${TEAMS_BOT_NAME}</at> hey bot!`,
        messageId: "msg-001",
        conversationId: TEST_CONVERSATION_ID,
        fromId: "user-123",
        fromName: "John Doe",
        mentions: [
          {
            id: TEAMS_BOT_ID,
            name: TEAMS_BOT_NAME,
            text: `<at>${TEAMS_BOT_NAME}</at>`,
          },
        ],
      });

      await chat.webhooks.teams(createTeamsWebhookRequest(mentionActivity), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(conversationLog).toContain(`mention: @${TEAMS_BOT_NAME} hey bot!`);
      expect(mockBotAdapter.sentActivities).toContainEqual(
        expect.objectContaining({
          text: "Hi! I'm now listening to this thread. How can I help?",
        })
      );

      mockBotAdapter.clearMocks();

      // Message 2: Weather query
      const weatherActivity = createTeamsActivity({
        text: "What's the weather like?",
        messageId: "msg-002",
        conversationId: TEST_CONVERSATION_ID,
        fromId: "user-123",
        fromName: "John Doe",
      });

      await chat.webhooks.teams(createTeamsWebhookRequest(weatherActivity), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(conversationLog).toContain("subscribed: What's the weather like?");
      expect(mockBotAdapter.sentActivities).toContainEqual(
        expect.objectContaining({
          text: "Let me check the weather for you...",
        })
      );
      expect(mockBotAdapter.updatedActivities).toContainEqual(
        expect.objectContaining({ text: "The weather today is sunny, 72°F!" })
      );

      mockBotAdapter.clearMocks();

      // Message 3: Follow-up
      const followUpActivity = createTeamsActivity({
        text: "That sounds nice!",
        messageId: "msg-003",
        conversationId: TEST_CONVERSATION_ID,
        fromId: "user-123",
        fromName: "John Doe",
      });

      await chat.webhooks.teams(createTeamsWebhookRequest(followUpActivity), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(conversationLog).toContain("subscribed: That sounds nice!");

      mockBotAdapter.clearMocks();

      // Message 4: Thanks
      const thanksActivity = createTeamsActivity({
        text: "thanks for your help!",
        messageId: "msg-004",
        conversationId: TEST_CONVERSATION_ID,
        fromId: "user-123",
        fromName: "John Doe",
      });

      await chat.webhooks.teams(createTeamsWebhookRequest(thanksActivity), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(conversationLog).toContain("subscribed: thanks for your help!");
      expect(mockBotAdapter.sentActivities).toContainEqual(
        expect.objectContaining({
          text: "You're welcome! Let me know if you need anything else.",
        })
      );

      expect(messageCount).toBe(3);
      expect(conversationLog).toEqual([
        `mention: @${TEAMS_BOT_NAME} hey bot!`,
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
        await thread.post("Subscribed to Teams thread");
      });

      chat.onSubscribedMessage(async (thread, message) => {
        const threadId = thread.id;
        if (!threadResponses[threadId]) {
          threadResponses[threadId] = [];
        }
        threadResponses[threadId].push(message.text);
        await thread.post(`Reply: ${message.text}`);
      });

      const thread1ConversationId = "19:thread1@thread.v2";
      const thread2ConversationId = "19:thread2@thread.v2";
      const thread1Id = getTeamsThreadId(
        thread1ConversationId,
        DEFAULT_TEAMS_SERVICE_URL
      );
      const thread2Id = getTeamsThreadId(
        thread2ConversationId,
        DEFAULT_TEAMS_SERVICE_URL
      );

      // Start thread 1
      const thread1Mention = createTeamsActivity({
        text: `<at>${TEAMS_BOT_NAME}</at> Thread 1 start`,
        messageId: "t1-msg-001",
        conversationId: thread1ConversationId,
        fromId: "user-A",
        fromName: "User A",
        mentions: [
          {
            id: TEAMS_BOT_ID,
            name: TEAMS_BOT_NAME,
            text: `<at>${TEAMS_BOT_NAME}</at>`,
          },
        ],
      });

      await chat.webhooks.teams(createTeamsWebhookRequest(thread1Mention), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Start thread 2
      const thread2Mention = createTeamsActivity({
        text: `<at>${TEAMS_BOT_NAME}</at> Thread 2 start`,
        messageId: "t2-msg-001",
        conversationId: thread2ConversationId,
        fromId: "user-B",
        fromName: "User B",
        mentions: [
          {
            id: TEAMS_BOT_ID,
            name: TEAMS_BOT_NAME,
            text: `<at>${TEAMS_BOT_NAME}</at>`,
          },
        ],
      });

      await chat.webhooks.teams(createTeamsWebhookRequest(thread2Mention), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      mockBotAdapter.clearMocks();

      // Follow-up to thread 1
      const thread1FollowUp = createTeamsActivity({
        text: "Thread 1 message",
        messageId: "t1-msg-002",
        conversationId: thread1ConversationId,
        fromId: "user-A",
        fromName: "User A",
      });

      await chat.webhooks.teams(createTeamsWebhookRequest(thread1FollowUp), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Follow-up to thread 2
      const thread2FollowUp = createTeamsActivity({
        text: "Thread 2 message",
        messageId: "t2-msg-002",
        conversationId: thread2ConversationId,
        fromId: "user-B",
        fromName: "User B",
      });

      await chat.webhooks.teams(createTeamsWebhookRequest(thread2FollowUp), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Verify thread isolation (mentions are normalized to @name format)
      expect(threadResponses[thread1Id]).toEqual([
        `@${TEAMS_BOT_NAME} Thread 1 start`,
        "Thread 1 message",
      ]);

      expect(threadResponses[thread2Id]).toEqual([
        `@${TEAMS_BOT_NAME} Thread 2 start`,
        "Thread 2 message",
      ]);
    });
  });

  describe("file uploads", () => {
    it("should include files as inline data URI attachments", async () => {
      chat.onNewMention(async (thread) => {
        await thread.post({
          markdown: "Here's your file:",
          files: [
            {
              data: Buffer.from("test content"),
              filename: "test.txt",
              mimeType: "text/plain",
            },
          ],
        });
      });

      const activity = createTeamsActivity({
        text: `<at>${TEAMS_BOT_NAME}</at> send file`,
        messageId: "msg-file",
        conversationId: TEST_CONVERSATION_ID,
        fromId: "user-123",
        fromName: "John Doe",
        mentions: [
          {
            id: TEAMS_BOT_ID,
            name: TEAMS_BOT_NAME,
            text: `<at>${TEAMS_BOT_NAME}</at>`,
          },
        ],
      });

      await chat.webhooks.teams(createTeamsWebhookRequest(activity), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Verify sentActivities contains the message with attachments
      const sentWithAttachments = mockBotAdapter.sentActivities.find(
        (act: unknown) =>
          typeof act === "object" &&
          act !== null &&
          "attachments" in act &&
          Array.isArray((act as { attachments: unknown[] }).attachments)
      );

      expect(sentWithAttachments).toBeDefined();
      const attachments = (
        sentWithAttachments as {
          attachments: Array<{ name?: string; contentType?: string }>;
        }
      ).attachments;
      expect(
        attachments.some(
          (a) => a.name === "test.txt" && a.contentType === "text/plain"
        )
      ).toBe(true);
    });
  });
});
