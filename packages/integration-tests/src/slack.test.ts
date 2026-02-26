import { createHmac } from "node:crypto";
import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat, type Logger } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockSlackClient,
  createSlackBlockActionsRequest,
  createSlackEvent,
  createSlackWebhookRequest,
  getSlackThreadId,
  injectMockSlackClient,
  type MockSlackClient,
  SLACK_BOT_TOKEN,
  SLACK_BOT_USER_ID,
  SLACK_BOT_USERNAME,
  SLACK_SIGNING_SECRET,
} from "./slack-utils";
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

describe("Slack Integration", () => {
  let chat: Chat<{ slack: SlackAdapter }>;
  let state: ReturnType<typeof createMemoryState>;
  let slackAdapter: SlackAdapter;
  let mockClient: MockSlackClient;
  let tracker: ReturnType<typeof createWaitUntilTracker>;

  const TEST_CHANNEL = "C123456";
  const TEST_THREAD_TS = "1234567890.000001";
  const TEST_THREAD_ID = getSlackThreadId(TEST_CHANNEL, TEST_THREAD_TS);

  beforeEach(() => {
    vi.clearAllMocks();

    state = createMemoryState();
    slackAdapter = createSlackAdapter({
      botToken: SLACK_BOT_TOKEN,
      signingSecret: SLACK_SIGNING_SECRET,
      botUserId: SLACK_BOT_USER_ID,
      userName: SLACK_BOT_USERNAME,
      logger: mockLogger,
    });

    mockClient = createMockSlackClient();
    injectMockSlackClient(slackAdapter, mockClient);

    chat = new Chat({
      userName: SLACK_BOT_USERNAME,
      adapters: { slack: slackAdapter },
      state,
      logger: "error",
    });

    tracker = createWaitUntilTracker();
  });

  afterEach(async () => {
    await chat.shutdown();
  });

  describe("URL verification", () => {
    it("should respond to Slack URL verification challenge", async () => {
      const request = createSlackWebhookRequest({
        type: "url_verification",
        challenge: "test-challenge-token",
      });

      const response = await chat.webhooks.slack(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.challenge).toBe("test-challenge-token");
    });
  });

  describe("message handling", () => {
    it("should handle an @mention and call the handler", async () => {
      const handlerMock = vi.fn();
      chat.onNewMention(async (thread, message) => {
        handlerMock(thread.id, message.text);
        await thread.post("Hello back!");
      });

      const event = createSlackEvent({
        type: "app_mention",
        text: `<@${SLACK_BOT_USER_ID}> hello bot!`,
        userId: "U_USER_123",
        messageTs: "1234567890.111111",
        threadTs: TEST_THREAD_TS,
        channel: TEST_CHANNEL,
      });

      const request = createSlackWebhookRequest(event);
      const response = await chat.webhooks.slack(request, {
        waitUntil: tracker.waitUntil,
      });
      expect(response.status).toBe(200);

      await tracker.waitForAll();

      expect(handlerMock).toHaveBeenCalledWith(
        TEST_THREAD_ID,
        `@${SLACK_BOT_USER_ID} hello bot!`
      );

      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: TEST_CHANNEL,
          thread_ts: TEST_THREAD_TS,
          text: "Hello back!",
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
      const mentionEvent = createSlackEvent({
        type: "app_mention",
        text: `@${SLACK_BOT_USERNAME} subscribe me`,
        userId: "U_USER_123",
        messageTs: "1234567890.111111",
        threadTs: TEST_THREAD_TS,
        channel: TEST_CHANNEL,
      });

      await chat.webhooks.slack(createSlackWebhookRequest(mentionEvent), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: "I'm now listening!" })
      );

      vi.clearAllMocks();

      // Follow-up message in same thread
      const followUpEvent = createSlackEvent({
        type: "message",
        text: "This is a follow-up message",
        userId: "U_USER_123",
        messageTs: "1234567890.222222",
        threadTs: TEST_THREAD_TS,
        channel: TEST_CHANNEL,
      });

      await chat.webhooks.slack(createSlackWebhookRequest(followUpEvent), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(subscribedHandler).toHaveBeenCalledWith(
        TEST_THREAD_ID,
        "This is a follow-up message"
      );

      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
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

      const event = createSlackEvent({
        type: "message",
        text: "I need help with something",
        userId: "U_USER_123",
        messageTs: "1234567890.111111",
        threadTs: TEST_THREAD_TS,
        channel: TEST_CHANNEL,
      });

      await chat.webhooks.slack(createSlackWebhookRequest(event), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(patternHandler).toHaveBeenCalledWith("I need help with something");
      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Here is some help!" })
      );
    });

    it("should skip messages from the bot itself", async () => {
      const handlerMock = vi.fn();
      chat.onNewMessage(ANY_CHAR_REGEX, () => {
        handlerMock();
      });

      const event = createSlackEvent({
        type: "message",
        text: "Bot's own message",
        userId: SLACK_BOT_USER_ID,
        messageTs: "1234567890.111111",
        threadTs: TEST_THREAD_TS,
        channel: TEST_CHANNEL,
        botId: "B123",
      });

      await chat.webhooks.slack(createSlackWebhookRequest(event), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(handlerMock).not.toHaveBeenCalled();
    });
  });

  describe("message editing and reactions", () => {
    it("should allow editing a sent message", async () => {
      chat.onNewMention(async (thread) => {
        const msg = await thread.post("Original message");
        await msg.edit("Edited message");
      });

      const event = createSlackEvent({
        type: "app_mention",
        text: `@${SLACK_BOT_USERNAME} edit test`,
        userId: "U_USER_123",
        messageTs: "1234567890.111111",
        threadTs: TEST_THREAD_TS,
        channel: TEST_CHANNEL,
      });

      await chat.webhooks.slack(createSlackWebhookRequest(event), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(mockClient.chat.update).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Edited message" })
      );
    });

    it("should allow adding reactions to messages", async () => {
      chat.onNewMention(async (thread) => {
        const msg = await thread.post("React to this!");
        await msg.addReaction("thumbsup");
      });

      const event = createSlackEvent({
        type: "app_mention",
        text: `@${SLACK_BOT_USERNAME} react`,
        userId: "U_USER_123",
        messageTs: "1234567890.111111",
        threadTs: TEST_THREAD_TS,
        channel: TEST_CHANNEL,
      });

      await chat.webhooks.slack(createSlackWebhookRequest(event), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(mockClient.reactions.add).toHaveBeenCalledWith(
        expect.objectContaining({ name: "thumbsup" })
      );
    });
  });

  describe("error handling", () => {
    it("should reject requests with invalid signatures", async () => {
      const request = new Request("https://example.com/webhook/slack", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-slack-request-timestamp": Math.floor(Date.now() / 1000).toString(),
          "x-slack-signature": "v0=invalid_signature",
        },
        body: JSON.stringify({ type: "event_callback", event: {} }),
      });

      const response = await chat.webhooks.slack(request);
      expect(response.status).toBe(401);
    });

    it("should reject requests with missing signature headers", async () => {
      const request = new Request("https://example.com/webhook/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "event_callback", event: {} }),
      });

      const response = await chat.webhooks.slack(request);
      expect(response.status).toBe(401);
    });

    it("should reject requests with stale timestamps", async () => {
      const body = JSON.stringify({ type: "event_callback", event: {} });
      const timestamp = (Math.floor(Date.now() / 1000) - 600).toString();
      const sigBasestring = `v0:${timestamp}:${body}`;
      const signature =
        "v0=" +
        createHmac("sha256", SLACK_SIGNING_SECRET)
          .update(sigBasestring)
          .digest("hex");

      const request = new Request("https://example.com/webhook/slack", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signature,
        },
        body,
      });

      const response = await chat.webhooks.slack(request);
      expect(response.status).toBe(401);
    });
  });

  describe("markdown formatting", () => {
    it("should convert markdown to Slack format in posted messages", async () => {
      chat.onNewMention(async (thread) => {
        await thread.post({
          markdown: "**Bold** and _italic_ and `code`",
        });
      });

      const event = createSlackEvent({
        type: "app_mention",
        text: `@${SLACK_BOT_USERNAME} markdown test`,
        userId: "U_USER_123",
        messageTs: "1234567890.111111",
        threadTs: TEST_THREAD_TS,
        channel: TEST_CHANNEL,
      });

      await chat.webhooks.slack(createSlackWebhookRequest(event), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Slack uses *bold*, _italic_, and `code`
      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("*Bold*"),
        })
      );
    });

    it("should convert @mentions to Slack format in posted messages", async () => {
      chat.onNewMention(async (thread) => {
        await thread.post("Hey @john, check this out!");
      });

      const event = createSlackEvent({
        type: "app_mention",
        text: `@${SLACK_BOT_USERNAME} mention test`,
        userId: "U_USER_123",
        messageTs: "1234567890.111111",
        threadTs: TEST_THREAD_TS,
        channel: TEST_CHANNEL,
      });

      await chat.webhooks.slack(createSlackWebhookRequest(event), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // @mentions should be converted to Slack's <@mention> format
      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Hey <@john>, check this out!",
        })
      );
    });
  });

  describe("thread operations", () => {
    it("should include thread info in message objects", async () => {
      let capturedMessage: unknown;
      chat.onNewMention((_thread, message) => {
        capturedMessage = message;
      });

      const event = createSlackEvent({
        type: "app_mention",
        text: `@${SLACK_BOT_USERNAME} test`,
        userId: "U_USER_123",
        messageTs: "1234567890.111111",
        threadTs: TEST_THREAD_TS,
        channel: TEST_CHANNEL,
      });

      await chat.webhooks.slack(createSlackWebhookRequest(event), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(capturedMessage).toBeDefined();
      const msg = capturedMessage as {
        threadId: string;
        author: { userId: string; isBot: boolean; isMe: boolean };
      };
      expect(msg.threadId).toBe(TEST_THREAD_ID);
      expect(msg.author.userId).toBe("U_USER_123");
      expect(msg.author.isBot).toBe(false);
      expect(msg.author.isMe).toBe(false);
    });

    it("should handle typing indicator", async () => {
      chat.onNewMention(async (thread) => {
        await thread.startTyping();
        await thread.post("Done typing!");
      });

      const event = createSlackEvent({
        type: "app_mention",
        text: `@${SLACK_BOT_USERNAME} typing test`,
        userId: "U_USER_123",
        messageTs: "1234567890.111111",
        threadTs: TEST_THREAD_TS,
        channel: TEST_CHANNEL,
      });

      await chat.webhooks.slack(createSlackWebhookRequest(event), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Done typing!" })
      );
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
          await response.addReaction("thumbsup");
        } else {
          await thread.post(`Got it! You said: "${message.text}"`);
        }
      });

      // Message 1: Initial mention
      const mentionEvent = createSlackEvent({
        type: "app_mention",
        text: `<@${SLACK_BOT_USER_ID}> hey bot!`,
        userId: "U_USER_123",
        messageTs: "1234567890.100000",
        threadTs: "1234567890.100000",
        channel: TEST_CHANNEL,
      });

      await chat.webhooks.slack(createSlackWebhookRequest(mentionEvent), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(conversationLog).toContain(
        `mention: @${SLACK_BOT_USER_ID} hey bot!`
      );
      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Hi! I'm now listening to this thread. How can I help?",
        })
      );

      vi.clearAllMocks();

      // Message 2: Weather query
      const weatherEvent = createSlackEvent({
        type: "message",
        text: "What's the weather like?",
        userId: "U_USER_123",
        messageTs: "1234567890.200000",
        threadTs: "1234567890.100000",
        channel: TEST_CHANNEL,
      });

      await chat.webhooks.slack(createSlackWebhookRequest(weatherEvent), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(conversationLog).toContain("subscribed: What's the weather like?");
      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Let me check the weather for you...",
        })
      );
      expect(mockClient.chat.update).toHaveBeenCalledWith(
        expect.objectContaining({ text: "The weather today is sunny, 72°F!" })
      );

      vi.clearAllMocks();

      // Message 3: Follow-up
      const followUpEvent = createSlackEvent({
        type: "message",
        text: "That sounds nice!",
        userId: "U_USER_123",
        messageTs: "1234567890.300000",
        threadTs: "1234567890.100000",
        channel: TEST_CHANNEL,
      });

      await chat.webhooks.slack(createSlackWebhookRequest(followUpEvent), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(conversationLog).toContain("subscribed: That sounds nice!");

      vi.clearAllMocks();

      // Message 4: Thanks
      const thanksEvent = createSlackEvent({
        type: "message",
        text: "thanks for your help!",
        userId: "U_USER_123",
        messageTs: "1234567890.400000",
        threadTs: "1234567890.100000",
        channel: TEST_CHANNEL,
      });

      await chat.webhooks.slack(createSlackWebhookRequest(thanksEvent), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(conversationLog).toContain("subscribed: thanks for your help!");
      expect(mockClient.reactions.add).toHaveBeenCalledWith(
        expect.objectContaining({ name: "thumbsup" })
      );

      expect(messageCount).toBe(3);
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
        await thread.post("Subscribed to thread");
      });

      chat.onSubscribedMessage(async (thread, message) => {
        const threadId = thread.id;
        if (!threadResponses[threadId]) {
          threadResponses[threadId] = [];
        }
        threadResponses[threadId].push(message.text);
        await thread.post(`Reply: ${message.text}`);
      });

      const thread1Ts = "1111111111.000001";
      const thread2Ts = "2222222222.000001";
      const thread1Id = getSlackThreadId(TEST_CHANNEL, thread1Ts);
      const thread2Id = getSlackThreadId(TEST_CHANNEL, thread2Ts);

      // Start thread 1
      const thread1Mention = createSlackEvent({
        type: "app_mention",
        text: `<@${SLACK_BOT_USER_ID}> Thread 1 start`,
        userId: "U_USER_A",
        messageTs: thread1Ts,
        threadTs: thread1Ts,
        channel: TEST_CHANNEL,
      });

      await chat.webhooks.slack(createSlackWebhookRequest(thread1Mention), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Start thread 2
      const thread2Mention = createSlackEvent({
        type: "app_mention",
        text: `<@${SLACK_BOT_USER_ID}> Thread 2 start`,
        userId: "U_USER_B",
        messageTs: thread2Ts,
        threadTs: thread2Ts,
        channel: TEST_CHANNEL,
      });

      await chat.webhooks.slack(createSlackWebhookRequest(thread2Mention), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      vi.clearAllMocks();

      // Follow-up to thread 1
      const thread1FollowUp = createSlackEvent({
        type: "message",
        text: "Thread 1 message",
        userId: "U_USER_A",
        messageTs: "1111111111.000002",
        threadTs: thread1Ts,
        channel: TEST_CHANNEL,
      });

      await chat.webhooks.slack(createSlackWebhookRequest(thread1FollowUp), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Follow-up to thread 2
      const thread2FollowUp = createSlackEvent({
        type: "message",
        text: "Thread 2 message",
        userId: "U_USER_B",
        messageTs: "2222222222.000002",
        threadTs: thread2Ts,
        channel: TEST_CHANNEL,
      });

      await chat.webhooks.slack(createSlackWebhookRequest(thread2FollowUp), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      // Verify thread isolation
      expect(threadResponses[thread1Id]).toEqual([
        `@${SLACK_BOT_USER_ID} Thread 1 start`,
        "Thread 1 message",
      ]);

      expect(threadResponses[thread2Id]).toEqual([
        `@${SLACK_BOT_USER_ID} Thread 2 start`,
        "Thread 2 message",
      ]);
    });
  });

  describe("file uploads", () => {
    it("should upload files when posting a message with files", async () => {
      chat.onNewMention(async (thread) => {
        await thread.post({
          markdown: "Here's your file:",
          files: [
            {
              data: Buffer.from("test file content"),
              filename: "test.txt",
              mimeType: "text/plain",
            },
          ],
        });
      });

      const event = createSlackEvent({
        type: "app_mention",
        text: `@${SLACK_BOT_USERNAME} send file`,
        userId: "U_USER_123",
        messageTs: "1234567890.111111",
        threadTs: TEST_THREAD_TS,
        channel: TEST_CHANNEL,
      });

      await chat.webhooks.slack(createSlackWebhookRequest(event), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(mockClient.files.uploadV2).toHaveBeenCalledWith(
        expect.objectContaining({
          channel_id: TEST_CHANNEL,
          file_uploads: [expect.objectContaining({ filename: "test.txt" })],
        })
      );
      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("Here's your file:"),
        })
      );
    });

    it("should upload multiple files", async () => {
      chat.onNewMention(async (thread) => {
        await thread.post({
          markdown: "Multiple files:",
          files: [
            { data: Buffer.from("file1"), filename: "file1.txt" },
            { data: Buffer.from("file2"), filename: "file2.txt" },
          ],
        });
      });

      const event = createSlackEvent({
        type: "app_mention",
        text: `@${SLACK_BOT_USERNAME} send files`,
        userId: "U_USER_123",
        messageTs: "1234567890.111111",
        threadTs: TEST_THREAD_TS,
        channel: TEST_CHANNEL,
      });

      await chat.webhooks.slack(createSlackWebhookRequest(event), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(mockClient.files.uploadV2).toHaveBeenCalledTimes(1);
      expect(mockClient.files.uploadV2).toHaveBeenCalledWith(
        expect.objectContaining({
          channel_id: TEST_CHANNEL,
          file_uploads: [
            expect.objectContaining({ filename: "file1.txt" }),
            expect.objectContaining({ filename: "file2.txt" }),
          ],
        })
      );
    });

    it("should handle files-only messages (no text)", async () => {
      chat.onNewMention(async (thread) => {
        await thread.post({
          markdown: "",
          files: [{ data: Buffer.from("content"), filename: "doc.pdf" }],
        });
      });

      const event = createSlackEvent({
        type: "app_mention",
        text: `@${SLACK_BOT_USERNAME} file only`,
        userId: "U_USER_123",
        messageTs: "1234567890.111111",
        threadTs: TEST_THREAD_TS,
        channel: TEST_CHANNEL,
      });

      await chat.webhooks.slack(createSlackWebhookRequest(event), {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(mockClient.files.uploadV2).toHaveBeenCalled();
    });
  });

  describe("action handling", () => {
    it("should handle block_actions from card buttons", async () => {
      const handlerMock = vi.fn();
      chat.onAction("approve", async (event) => {
        handlerMock(event.actionId, event.value, event.user.userId);
        await event.thread.post("Action received!");
      });

      const request = createSlackBlockActionsRequest({
        actionId: "approve",
        actionValue: "order-123",
        userId: "U_USER_123",
        messageTs: TEST_THREAD_TS,
        channel: TEST_CHANNEL,
      });

      const response = await chat.webhooks.slack(request, {
        waitUntil: tracker.waitUntil,
      });
      expect(response.status).toBe(200);

      await tracker.waitForAll();

      expect(handlerMock).toHaveBeenCalledWith(
        "approve",
        "order-123",
        "U_USER_123"
      );
      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Action received!",
        })
      );
    });

    it("should not call handler for non-matching action IDs", async () => {
      const handlerMock = vi.fn();
      chat.onAction("approve", () => {
        handlerMock();
      });

      const request = createSlackBlockActionsRequest({
        actionId: "reject",
        userId: "U_USER_123",
        messageTs: TEST_THREAD_TS,
        channel: TEST_CHANNEL,
      });

      await chat.webhooks.slack(request, {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(handlerMock).not.toHaveBeenCalled();
    });

    it("should call catch-all action handler", async () => {
      const handlerMock = vi.fn();
      chat.onAction((event) => {
        handlerMock(event.actionId);
      });

      const request = createSlackBlockActionsRequest({
        actionId: "any-action",
        userId: "U_USER_123",
        messageTs: TEST_THREAD_TS,
        channel: TEST_CHANNEL,
      });

      await chat.webhooks.slack(request, {
        waitUntil: tracker.waitUntil,
      });
      await tracker.waitForAll();

      expect(handlerMock).toHaveBeenCalledWith("any-action");
    });
  });
});
