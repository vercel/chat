import { beforeEach, describe, expect, it, vi } from "vitest";

const HELP_REGEX = /help/i;
const HELLO_REGEX = /hello/i;

import { Chat } from "./chat";
import { getEmoji } from "./emoji";
import { LockError } from "./errors";
import { jsx } from "./jsx-runtime";
import {
  createMockAdapter,
  createMockState,
  createTestMessage,
  mockLogger,
} from "./mock-adapter";
import { Modal, type ModalElement, TextInput } from "./modals";
import type {
  ActionEvent,
  Adapter,
  ModalSubmitEvent,
  ReactionEvent,
  StateAdapter,
} from "./types";

describe("Chat", () => {
  let chat: Chat<{ slack: Adapter }>;
  let mockAdapter: Adapter;
  let mockState: StateAdapter;

  beforeEach(async () => {
    mockAdapter = createMockAdapter("slack");
    mockState = createMockState();

    chat = new Chat({
      userName: "testbot",
      adapters: { slack: mockAdapter },
      state: mockState,
      logger: mockLogger,
    });

    // Trigger initialization by calling webhooks
    await chat.webhooks.slack(
      new Request("http://test.com", { method: "POST" })
    );
  });

  it("should initialize adapters", () => {
    expect(mockAdapter.initialize).toHaveBeenCalledWith(chat);
    expect(mockState.connect).toHaveBeenCalled();
  });

  it("should register webhook handlers", () => {
    expect(chat.webhooks.slack).toBeDefined();
    expect(typeof chat.webhooks.slack).toBe("function");
  });

  it("should preserve null fallback streaming placeholder config", async () => {
    mockAdapter.stream = undefined;

    const customChat = new Chat({
      userName: "testbot",
      adapters: { slack: mockAdapter },
      state: mockState,
      logger: mockLogger,
      fallbackStreamingPlaceholderText: null,
    });

    await customChat.webhooks.slack(
      new Request("http://test.com", { method: "POST" })
    );

    // Use a mention handler to exercise the full Chat → Thread pipeline
    customChat.onNewMention(async (_thread, _message) => {
      await _thread.post({
        async *[Symbol.asyncIterator]() {
          yield "H";
          yield "i";
        },
      });
    });

    const message = createTestMessage("msg-1", "Hey @slack-bot help me");
    await customChat.handleIncomingMessage(
      mockAdapter,
      "slack:C123:1234.5678",
      message
    );

    expect(mockAdapter.postMessage).not.toHaveBeenCalledWith(
      "slack:C123:1234.5678",
      "..."
    );
    expect(mockAdapter.editMessage).toHaveBeenLastCalledWith(
      "slack:C123:1234.5678",
      "msg-1",
      { markdown: "Hi" }
    );
  });

  it("should call onNewMention handler when bot is mentioned", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    chat.onNewMention(handler);

    // Note: mockAdapter has userName "slack-bot", so we mention that
    const message = createTestMessage("msg-1", "Hey @slack-bot help me");

    await chat.handleIncomingMessage(
      mockAdapter,
      "slack:C123:1234.5678",
      message
    );

    expect(handler).toHaveBeenCalled();
    expect(mockState.acquireLock).toHaveBeenCalled();
    expect(mockState.releaseLock).toHaveBeenCalled();
  });

  it("should call onSubscribedMessage handler for subscribed threads", async () => {
    const mentionHandler = vi.fn().mockResolvedValue(undefined);
    const subscribedHandler = vi.fn().mockResolvedValue(undefined);

    chat.onNewMention(mentionHandler);
    chat.onSubscribedMessage(subscribedHandler);

    // Subscribe to the thread
    await mockState.subscribe("slack:C123:1234.5678");

    const message = createTestMessage("msg-1", "Follow up message");

    await chat.handleIncomingMessage(
      mockAdapter,
      "slack:C123:1234.5678",
      message
    );

    expect(subscribedHandler).toHaveBeenCalled();
    expect(mentionHandler).not.toHaveBeenCalled();
  });

  it("should skip messages from self", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    chat.onNewMention(handler);

    const message = createTestMessage("msg-1", "I am the bot", {
      author: {
        userId: "BOT",
        userName: "testbot",
        fullName: "Test Bot",
        isBot: true,
        isMe: true,
      },
    });

    await chat.handleIncomingMessage(
      mockAdapter,
      "slack:C123:1234.5678",
      message
    );

    expect(handler).not.toHaveBeenCalled();
  });

  describe("message deduplication", () => {
    it("should skip duplicate messages with the same id", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onNewMention(handler);

      const message1 = createTestMessage("msg-1", "Hey @slack-bot help");
      const message2 = createTestMessage("msg-1", "Hey @slack-bot help");

      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message1
      );
      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message2
      );

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should use default dedupe TTL of 5 minutes", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onNewMention(handler);

      const message = createTestMessage("msg-1", "Hey @slack-bot help");
      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      expect(mockState.setIfNotExists).toHaveBeenCalledWith(
        "dedupe:slack:msg-1",
        true,
        300_000
      );
    });

    it("should use custom dedupeTtlMs when configured", async () => {
      const customChat = new Chat({
        userName: "testbot",
        adapters: { slack: mockAdapter },
        state: mockState,
        logger: mockLogger,
        dedupeTtlMs: 300_000,
      });

      await customChat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );

      const handler = vi.fn().mockResolvedValue(undefined);
      customChat.onNewMention(handler);

      const message = createTestMessage("msg-2", "Hey @slack-bot help");
      await customChat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      expect(mockState.setIfNotExists).toHaveBeenCalledWith(
        "dedupe:slack:msg-2",
        true,
        300_000
      );
    });

    it("should use atomic setIfNotExists for deduplication", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onNewMention(handler);

      const message = createTestMessage("msg-1", "Hey @slack-bot help");
      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      // Verify setIfNotExists was called (not separate get+set)
      expect(mockState.setIfNotExists).toHaveBeenCalledTimes(1);
      expect(mockState.get).not.toHaveBeenCalledWith(
        expect.stringContaining("dedupe:")
      );
    });

    it("should handle concurrent duplicates atomically", async () => {
      // Simulate the race: make setIfNotExists return false on second call
      let callCount = 0;
      (mockState.setIfNotExists as ReturnType<typeof vi.fn>).mockImplementation(
        async () => {
          callCount++;
          return callCount === 1;
        }
      );

      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onNewMention(handler);

      const msg1 = createTestMessage("ts-1", "Hey @slack-bot help");
      const msg2 = createTestMessage("ts-1", "Hey @slack-bot help");

      // Send both concurrently
      await Promise.allSettled([
        chat.handleIncomingMessage(mockAdapter, "slack:C123:ts-1", msg1),
        chat.handleIncomingMessage(mockAdapter, "slack:C123:ts-1", msg2),
      ]);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should trigger onNewMention for message events containing a bot mention", async () => {
      // Simulates the Slack message.channels event (not app_mention) that
      // contains <@BOT_ID> — detectMention should still identify it
      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onNewMention(handler);

      const message = createTestMessage("msg-1", "Hey @slack-bot help");

      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should not trigger onNewMention when message event has no bot mention", async () => {
      const mentionHandler = vi.fn().mockResolvedValue(undefined);
      const patternHandler = vi.fn().mockResolvedValue(undefined);
      chat.onNewMention(mentionHandler);
      chat.onNewMessage(HELLO_REGEX, patternHandler);

      const message = createTestMessage("msg-1", "hello everyone");

      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      expect(mentionHandler).not.toHaveBeenCalled();
      expect(patternHandler).toHaveBeenCalledTimes(1);
    });
  });

  it("should match message patterns", async () => {
    const helpHandler = vi.fn().mockResolvedValue(undefined);
    chat.onNewMessage(HELP_REGEX, helpHandler);

    const message = createTestMessage("msg-1", "Can someone help me?");

    await chat.handleIncomingMessage(
      mockAdapter,
      "slack:C123:1234.5678",
      message
    );

    expect(helpHandler).toHaveBeenCalled();
  });

  describe("isMention property", () => {
    it("should set isMention=true when bot is mentioned", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onNewMention(handler);

      const message = createTestMessage("msg-1", "Hey @slack-bot help me");

      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      expect(handler).toHaveBeenCalled();
      // The message passed to handler should have isMention set
      const [, receivedMessage] = handler.mock.calls[0];
      expect(receivedMessage.isMention).toBe(true);
    });

    it("should set isMention=false when bot is not mentioned", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onNewMessage(HELP_REGEX, handler);

      const message = createTestMessage("msg-1", "I need help");

      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      expect(handler).toHaveBeenCalled();
      const [, receivedMessage] = handler.mock.calls[0];
      expect(receivedMessage.isMention).toBe(false);
    });

    it("should set isMention=true in subscribed thread when mentioned", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onSubscribedMessage(handler);

      // Subscribe to the thread
      await mockState.subscribe("slack:C123:1234.5678");

      // Message with @mention
      const message = createTestMessage(
        "msg-1",
        "Hey @slack-bot what about this?"
      );

      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      expect(handler).toHaveBeenCalled();
      const [, receivedMessage] = handler.mock.calls[0];
      expect(receivedMessage.isMention).toBe(true);
    });
  });

  describe("onNewMention behavior in subscribed threads", () => {
    it("should NOT call onNewMention for mentions in subscribed threads", async () => {
      const mentionHandler = vi.fn().mockResolvedValue(undefined);
      const subscribedHandler = vi.fn().mockResolvedValue(undefined);

      chat.onNewMention(mentionHandler);
      chat.onSubscribedMessage(subscribedHandler);

      // Subscribe to the thread first
      await mockState.subscribe("slack:C123:1234.5678");

      // Now send a message WITH @mention in the subscribed thread
      const message = createTestMessage(
        "msg-1",
        "Hey @slack-bot are you there?"
      );

      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      // onSubscribedMessage should fire, NOT onNewMention
      expect(subscribedHandler).toHaveBeenCalled();
      expect(mentionHandler).not.toHaveBeenCalled();
    });

    it("should call onNewMention only for mentions in unsubscribed threads", async () => {
      const mentionHandler = vi.fn().mockResolvedValue(undefined);
      const subscribedHandler = vi.fn().mockResolvedValue(undefined);

      chat.onNewMention(mentionHandler);
      chat.onSubscribedMessage(subscribedHandler);

      // Thread is NOT subscribed - send a message with @mention
      const message = createTestMessage("msg-1", "Hey @slack-bot help me");

      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      // onNewMention should fire, NOT onSubscribedMessage
      expect(mentionHandler).toHaveBeenCalled();
      expect(subscribedHandler).not.toHaveBeenCalled();
    });
  });

  describe("onDirectMessage", () => {
    it("should route DMs to directMessage handler with channel", async () => {
      const dmHandler = vi.fn().mockResolvedValue(undefined);
      const mentionHandler = vi.fn().mockResolvedValue(undefined);

      chat.onDirectMessage(dmHandler);
      chat.onNewMention(mentionHandler);

      const message = createTestMessage("msg-1", "Hello bot");

      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:DU123:1234.5678",
        message
      );

      expect(dmHandler).toHaveBeenCalled();
      expect(mentionHandler).not.toHaveBeenCalled();
      // Verify channel is passed as third argument
      const callArgs = dmHandler.mock.calls[0];
      expect(callArgs).toHaveLength(3);
      expect(callArgs[2]).toBeDefined();
      expect(callArgs[2].id).toBe("slack:DU123");
    });

    it("should fall through to onNewMention when no DM handlers registered", async () => {
      const mentionHandler = vi.fn().mockResolvedValue(undefined);
      chat.onNewMention(mentionHandler);

      const message = createTestMessage("msg-1", "Hello bot");

      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:DU123:1234.5678",
        message
      );

      expect(mentionHandler).toHaveBeenCalled();
    });

    it("should route subscribed DM threads to onDirectMessage, not onSubscribedMessage", async () => {
      const dmHandler = vi.fn().mockResolvedValue(undefined);
      const subscribedHandler = vi.fn().mockResolvedValue(undefined);

      chat.onDirectMessage(dmHandler);
      chat.onSubscribedMessage(subscribedHandler);

      await mockState.subscribe("slack:DU123:1234.5678");
      const message = createTestMessage("msg-1", "Follow up DM");

      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:DU123:1234.5678",
        message
      );

      expect(dmHandler).toHaveBeenCalled();
      expect(subscribedHandler).not.toHaveBeenCalled();
    });

    it("should not route non-DM mentions to directMessage handler", async () => {
      const dmHandler = vi.fn().mockResolvedValue(undefined);
      const mentionHandler = vi.fn().mockResolvedValue(undefined);

      chat.onDirectMessage(dmHandler);
      chat.onNewMention(mentionHandler);

      const message = createTestMessage("msg-1", "Hey @slack-bot help");

      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      expect(mentionHandler).toHaveBeenCalled();
      expect(dmHandler).not.toHaveBeenCalled();
    });
  });

  describe("thread.isSubscribed()", () => {
    it("should return true for subscribed threads", async () => {
      let capturedThread: { isSubscribed: () => Promise<boolean> } | null =
        null;
      const handler = vi.fn().mockImplementation(async (thread) => {
        capturedThread = thread;
      });
      chat.onSubscribedMessage(handler);

      await mockState.subscribe("slack:C123:1234.5678");
      const message = createTestMessage("msg-1", "Follow up");

      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      expect(capturedThread).not.toBeNull();
      // In subscribed context, isSubscribed() should short-circuit to true
      const isSubscribed = await capturedThread?.isSubscribed();
      expect(isSubscribed).toBe(true);
    });

    it("should return false for unsubscribed threads", async () => {
      let capturedThread: { isSubscribed: () => Promise<boolean> } | null =
        null;
      const handler = vi.fn().mockImplementation(async (thread) => {
        capturedThread = thread;
      });
      chat.onNewMention(handler);

      const message = createTestMessage("msg-1", "Hey @slack-bot help");

      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      expect(capturedThread).not.toBeNull();
      const isSubscribed = await capturedThread?.isSubscribed();
      expect(isSubscribed).toBe(false);
    });
  });

  describe("Reactions", () => {
    it("should call onReaction handler for all reactions", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onReaction(handler);

      const event: Omit<ReactionEvent, "thread"> = {
        emoji: getEmoji("thumbs_up"),
        rawEmoji: "+1",
        added: true,
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        messageId: "msg-1",
        threadId: "slack:C123:1234.5678",
        adapter: mockAdapter,
        raw: {},
      };

      chat.processReaction(event);
      // Wait for async processing
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalled();
      // Verify the event includes thread and all original properties
      const receivedEvent = handler.mock.calls[0][0] as ReactionEvent;
      expect(receivedEvent.emoji).toBe(event.emoji);
      expect(receivedEvent.rawEmoji).toBe(event.rawEmoji);
      expect(receivedEvent.thread).toBeDefined();
    });

    it("should call onReaction handler for specific emoji", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onReaction(["thumbs_up", "heart"], handler);

      const thumbsUpEvent: Omit<ReactionEvent, "thread"> = {
        emoji: getEmoji("thumbs_up"),
        rawEmoji: "+1",
        added: true,
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        messageId: "msg-1",
        threadId: "slack:C123:1234.5678",
        adapter: mockAdapter,
        raw: {},
      };

      const fireEvent: Omit<ReactionEvent, "thread"> = {
        emoji: getEmoji("fire"),
        rawEmoji: "fire",
        added: true,
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        messageId: "msg-1",
        threadId: "slack:C123:1234.5678",
        adapter: mockAdapter,
        raw: {},
      };

      chat.processReaction(thumbsUpEvent);
      chat.processReaction(fireEvent);
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalledTimes(1);
      // Check the handler was called with thumbs_up emoji
      const receivedEvent = handler.mock.calls[0][0] as ReactionEvent;
      expect(receivedEvent.emoji).toBe(thumbsUpEvent.emoji);
    });

    it("should skip reactions from self", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onReaction(handler);

      const event: Omit<ReactionEvent, "thread"> = {
        emoji: getEmoji("thumbs_up"),
        rawEmoji: "+1",
        added: true,
        user: {
          userId: "BOT",
          userName: "testbot",
          fullName: "Test Bot",
          isBot: true,
          isMe: true,
        },
        messageId: "msg-1",
        threadId: "slack:C123:1234.5678",
        adapter: mockAdapter,
        raw: {},
      };

      chat.processReaction(event);
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).not.toHaveBeenCalled();
    });

    it("should match by rawEmoji when specified in filter", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      // Filter by raw emoji format
      chat.onReaction(["+1"], handler);

      const event: Omit<ReactionEvent, "thread"> = {
        emoji: getEmoji("thumbs_up"),
        rawEmoji: "+1",
        added: true,
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        messageId: "msg-1",
        threadId: "slack:C123:1234.5678",
        adapter: mockAdapter,
        raw: {},
      };

      chat.processReaction(event);
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalled();
      const receivedEvent = handler.mock.calls[0][0] as ReactionEvent;
      expect(receivedEvent.rawEmoji).toBe(event.rawEmoji);
    });

    it("should handle removed reactions", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onReaction(handler);

      const event: Omit<ReactionEvent, "thread"> = {
        emoji: getEmoji("thumbs_up"),
        rawEmoji: "+1",
        added: false,
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        messageId: "msg-1",
        threadId: "slack:C123:1234.5678",
        adapter: mockAdapter,
        raw: {},
      };

      chat.processReaction(event);
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0].added).toBe(false);
    });

    it("should match Teams-style reactions (EmojiValue with string filter)", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      // Register with string filter (as done in bot.ts)
      chat.onReaction(["thumbs_up", "heart", "fire", "rocket"], handler);

      // Teams sends rawEmoji: "like" which gets normalized to EmojiValue with name: "thumbs_up"
      const teamsEvent: Omit<ReactionEvent, "thread"> = {
        emoji: getEmoji("thumbs_up"), // Normalized by fromTeams()
        rawEmoji: "like", // Teams format
        added: true,
        user: {
          userId: "29:abc123",
          userName: "unknown",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        messageId: "1767297849909",
        threadId: "teams:abc:def",
        adapter: mockAdapter,
        raw: {},
      };

      chat.processReaction(teamsEvent);
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalledTimes(1);
      const receivedEvent = handler.mock.calls[0][0] as ReactionEvent;
      expect(receivedEvent.emoji).toBe(teamsEvent.emoji);
    });

    it("should match EmojiValue by object identity", async () => {
      const thumbsUp = getEmoji("thumbs_up");
      const handler = vi.fn().mockResolvedValue(undefined);
      // Register with EmojiValue object
      chat.onReaction([thumbsUp], handler);

      const event: Omit<ReactionEvent, "thread"> = {
        emoji: thumbsUp, // Same EmojiValue singleton
        rawEmoji: "like",
        added: true,
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        messageId: "msg-1",
        threadId: "slack:C123:1234.5678",
        adapter: mockAdapter,
        raw: {},
      };

      chat.processReaction(event);
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalled();
    });

    it("should include thread property in ReactionEvent", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onReaction(handler);

      const event: Omit<ReactionEvent, "thread"> = {
        emoji: getEmoji("thumbs_up"),
        rawEmoji: "+1",
        added: true,
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        messageId: "msg-1",
        threadId: "slack:C123:1234.5678",
        adapter: mockAdapter,
        raw: {},
      };

      chat.processReaction(event);
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalled();
      const receivedEvent = handler.mock.calls[0][0] as ReactionEvent;
      // Verify thread is present and has expected properties
      expect(receivedEvent.thread).toBeDefined();
      expect(receivedEvent.thread.id).toBe("slack:C123:1234.5678");
      expect(typeof receivedEvent.thread.post).toBe("function");
      expect(typeof receivedEvent.thread.isSubscribed).toBe("function");
    });

    it("should allow posting from reaction thread", async () => {
      const handler = vi
        .fn()
        .mockImplementation(async (event: ReactionEvent) => {
          await event.thread.post("Thanks for the reaction!");
        });
      chat.onReaction(handler);

      const event: Omit<ReactionEvent, "thread"> = {
        emoji: getEmoji("thumbs_up"),
        rawEmoji: "+1",
        added: true,
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        messageId: "msg-1",
        threadId: "slack:C123:1234.5678",
        adapter: mockAdapter,
        raw: {},
      };

      chat.processReaction(event);
      await new Promise((r) => setTimeout(r, 20));

      expect(handler).toHaveBeenCalled();
      expect(mockAdapter.postMessage).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        "Thanks for the reaction!"
      );
    });
  });

  describe("Actions", () => {
    it("should call onAction handler for all actions", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onAction(handler);

      const event: Omit<ActionEvent, "thread" | "openModal"> = {
        actionId: "approve",
        value: "order-123",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        messageId: "msg-1",
        threadId: "slack:C123:1234.5678",
        adapter: mockAdapter,
        raw: {},
      };

      chat.processAction(event);
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalled();
      const receivedEvent = handler.mock.calls[0][0] as ActionEvent;
      expect(receivedEvent.actionId).toBe("approve");
      expect(receivedEvent.value).toBe("order-123");
      expect(receivedEvent.thread).toBeDefined();
    });

    it("should call onAction handler for specific action IDs", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onAction(["approve", "reject"], handler);

      const approveEvent: Omit<ActionEvent, "thread" | "openModal"> = {
        actionId: "approve",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        messageId: "msg-1",
        threadId: "slack:C123:1234.5678",
        adapter: mockAdapter,
        raw: {},
      };

      const skipEvent: Omit<ActionEvent, "thread" | "openModal"> = {
        actionId: "skip",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        messageId: "msg-1",
        threadId: "slack:C123:1234.5678",
        adapter: mockAdapter,
        raw: {},
      };

      chat.processAction(approveEvent);
      chat.processAction(skipEvent);
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalledTimes(1);
      const receivedEvent = handler.mock.calls[0][0] as ActionEvent;
      expect(receivedEvent.actionId).toBe("approve");
    });

    it("should call onAction handler for single action ID", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onAction("approve", handler);

      const event: Omit<ActionEvent, "thread" | "openModal"> = {
        actionId: "approve",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        messageId: "msg-1",
        threadId: "slack:C123:1234.5678",
        adapter: mockAdapter,
        raw: {},
      };

      chat.processAction(event);
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalled();
    });

    it("should skip actions from self", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onAction(handler);

      const event: Omit<ActionEvent, "thread" | "openModal"> = {
        actionId: "approve",
        user: {
          userId: "BOT",
          userName: "testbot",
          fullName: "Test Bot",
          isBot: true,
          isMe: true,
        },
        messageId: "msg-1",
        threadId: "slack:C123:1234.5678",
        adapter: mockAdapter,
        raw: {},
      };

      chat.processAction(event);
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).not.toHaveBeenCalled();
    });

    it("should include thread property in ActionEvent", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onAction(handler);

      const event: Omit<ActionEvent, "thread" | "openModal"> = {
        actionId: "approve",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        messageId: "msg-1",
        threadId: "slack:C123:1234.5678",
        adapter: mockAdapter,
        raw: {},
      };

      chat.processAction(event);
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalled();
      const receivedEvent = handler.mock.calls[0][0] as ActionEvent;
      expect(receivedEvent.thread).toBeDefined();
      expect(receivedEvent.thread.id).toBe("slack:C123:1234.5678");
      expect(typeof receivedEvent.thread.post).toBe("function");
    });

    it("should allow posting from action thread", async () => {
      const handler = vi.fn().mockImplementation(async (event: ActionEvent) => {
        await event.thread.post("Action received!");
      });
      chat.onAction(handler);

      const event: Omit<ActionEvent, "thread" | "openModal"> = {
        actionId: "approve",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        messageId: "msg-1",
        threadId: "slack:C123:1234.5678",
        adapter: mockAdapter,
        raw: {},
      };

      chat.processAction(event);
      await new Promise((r) => setTimeout(r, 20));

      expect(handler).toHaveBeenCalled();
      expect(mockAdapter.postMessage).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        "Action received!"
      );
    });

    it("should provide openModal method that calls adapter.openModal", async () => {
      let capturedEvent: ActionEvent | undefined;
      const handler = vi.fn().mockImplementation(async (event: ActionEvent) => {
        capturedEvent = event;
      });
      chat.onAction(handler);

      const event: Omit<ActionEvent, "thread" | "openModal"> = {
        actionId: "open_form",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        messageId: "msg-1",
        threadId: "slack:C123:1234.5678",
        adapter: mockAdapter,
        raw: {},
        triggerId: "trigger-123",
      };

      chat.processAction(event);
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalled();
      expect(capturedEvent?.openModal).toBeDefined();

      // Call openModal with a ModalElement
      const modal: ModalElement = {
        type: "modal",
        callbackId: "test_modal",
        title: "Test Modal",
        children: [],
      };
      const result = await capturedEvent?.openModal(modal);

      // openModal should be called with triggerId, modal, and a contextId string
      expect(mockAdapter.openModal).toHaveBeenCalledWith(
        "trigger-123",
        modal,
        expect.any(String) // contextId (UUID)
      );
      expect(result).toEqual({ viewId: "V123" });

      // Verify context was stored in state (contextId is a UUID)
      const calls = (mockState.set as ReturnType<typeof vi.fn>).mock.calls;
      const modalContextCall = calls.find((c: unknown[]) =>
        (c[0] as string).startsWith("modal-context:")
      );
      expect(modalContextCall).toBeDefined();
      expect(modalContextCall?.[1]).toMatchObject({
        thread: expect.objectContaining({
          _type: "chat:Thread",
          id: "slack:C123:1234.5678",
        }),
      });
    });

    it("should convert JSX Modal to ModalElement in openModal", async () => {
      let capturedEvent: ActionEvent | undefined;
      const handler = vi.fn().mockImplementation(async (event: ActionEvent) => {
        capturedEvent = event;
      });
      chat.onAction(handler);

      const event: Omit<ActionEvent, "thread" | "openModal"> = {
        actionId: "open_form",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        messageId: "msg-1",
        threadId: "slack:C123:1234.5678",
        adapter: mockAdapter,
        raw: {},
        triggerId: "trigger-123",
      };

      chat.processAction(event);
      await new Promise((r) => setTimeout(r, 10));

      // Call openModal with a JSX Modal element
      const jsxModal = jsx(Modal, {
        callbackId: "jsx_modal",
        title: "JSX Modal",
        children: [jsx(TextInput, { id: "name", label: "Name" })],
      });
      const result = await capturedEvent?.openModal(jsxModal);

      // Should have converted JSX to ModalElement before calling adapter
      // openModal should be called with triggerId, modal, and a contextId string
      expect(mockAdapter.openModal).toHaveBeenCalledWith(
        "trigger-123",
        expect.objectContaining({
          type: "modal",
          callbackId: "jsx_modal",
          title: "JSX Modal",
        }),
        expect.any(String) // contextId (UUID)
      );
      expect(result).toEqual({ viewId: "V123" });
    });

    it("should return undefined from openModal when triggerId is missing", async () => {
      let capturedEvent: ActionEvent | undefined;
      const handler = vi.fn().mockImplementation(async (event: ActionEvent) => {
        capturedEvent = event;
      });
      chat.onAction(handler);

      const event: Omit<ActionEvent, "thread" | "openModal"> = {
        actionId: "open_form",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        messageId: "msg-1",
        threadId: "slack:C123:1234.5678",
        adapter: mockAdapter,
        raw: {},
        // No triggerId
      };

      chat.processAction(event);
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalled();

      const modal: ModalElement = {
        type: "modal",
        callbackId: "test_modal",
        title: "Test Modal",
        children: [],
      };
      const result = await capturedEvent?.openModal(modal);

      expect(result).toBeUndefined();
      expect(mockAdapter.openModal).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Cannot open modal: no triggerId available"
      );
    });

    it("should return undefined from openModal when adapter does not support modals", async () => {
      // Create adapter without openModal
      const adapterWithoutModals: Adapter = {
        ...mockAdapter,
        openModal: undefined,
      };

      let capturedEvent: ActionEvent | undefined;
      const handler = vi.fn().mockImplementation(async (event: ActionEvent) => {
        capturedEvent = event;
      });
      chat.onAction(handler);

      const event: Omit<ActionEvent, "thread" | "openModal"> = {
        actionId: "open_form",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        messageId: "msg-1",
        threadId: "slack:C123:1234.5678",
        adapter: adapterWithoutModals,
        raw: {},
        triggerId: "trigger-123",
      };

      chat.processAction(event);
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalled();

      const modal: ModalElement = {
        type: "modal",
        callbackId: "test_modal",
        title: "Test Modal",
        children: [],
      };
      const result = await capturedEvent?.openModal(modal);

      expect(result).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Cannot open modal: slack does not support modals"
      );
    });

    it("should open modal when action has empty threadId (no thread context)", async () => {
      let capturedEvent: ActionEvent | undefined;
      const handler = vi.fn().mockImplementation(async (event: ActionEvent) => {
        capturedEvent = event;
      });
      chat.onAction(handler);

      // Home tab actions have no thread context → empty threadId
      const event: Omit<ActionEvent, "thread" | "openModal"> = {
        actionId: "home_select_scope",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        messageId: "",
        threadId: "",
        adapter: mockAdapter,
        raw: {},
        triggerId: "trigger-456",
      };

      chat.processAction(event);
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalled();
      // thread should be null for empty threadId
      expect(capturedEvent?.thread).toBeNull();
      expect(capturedEvent?.openModal).toBeDefined();

      const modal: ModalElement = {
        type: "modal",
        callbackId: "select_scope_form",
        title: "Select a team",
        children: [],
      };
      const result = await capturedEvent?.openModal(modal);

      expect(mockAdapter.openModal).toHaveBeenCalledWith(
        "trigger-456",
        modal,
        expect.any(String)
      );
      expect(result).toEqual({ viewId: "V123" });

      // Modal context should store undefined thread
      const calls = (mockState.set as ReturnType<typeof vi.fn>).mock.calls;
      const modalContextCall = calls.find((c: unknown[]) =>
        (c[0] as string).startsWith("modal-context:")
      );
      expect(modalContextCall).toBeDefined();
      expect(modalContextCall?.[1]).toMatchObject({
        thread: undefined,
      });
    });
  });

  describe("openDM", () => {
    it("should infer Slack adapter from U... userId", async () => {
      const thread = await chat.openDM("U123456");

      expect(mockAdapter.openDM).toHaveBeenCalledWith("U123456");
      expect(thread).toBeDefined();
      expect(thread.id).toBe("slack:DU123456:");
    });

    it("should accept Author object and extract userId", async () => {
      const author = {
        userId: "U789ABC",
        userName: "testuser",
        fullName: "Test User",
        isBot: false,
        isMe: false,
      };
      const thread = await chat.openDM(author);

      expect(mockAdapter.openDM).toHaveBeenCalledWith("U789ABC");
      expect(thread).toBeDefined();
      expect(thread.id).toBe("slack:DU789ABC:");
    });

    it("should throw error for unknown userId format", async () => {
      await expect(chat.openDM("invalid-user-id")).rejects.toThrow(
        'Cannot infer adapter from userId "invalid-user-id"'
      );
    });

    it("should allow posting to DM thread", async () => {
      const thread = await chat.openDM("U123456");
      await thread.post("Hello via DM!");

      expect(mockAdapter.postMessage).toHaveBeenCalledWith(
        "slack:DU123456:",
        "Hello via DM!"
      );
    });
  });

  describe("isDM", () => {
    it("should return true for DM threads", async () => {
      const thread = await chat.openDM("U123456");

      expect(thread.isDM).toBe(true);
    });

    it("should return false for non-DM threads", async () => {
      let capturedThread: { isDM: boolean } | null = null;
      const handler = vi.fn().mockImplementation(async (thread) => {
        capturedThread = thread;
      });
      chat.onNewMention(handler);

      const message = createTestMessage("msg-1", "Hey @slack-bot help");

      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      expect(capturedThread).not.toBeNull();
      expect(capturedThread?.isDM).toBe(false);
    });

    it("should use adapter isDM method for detection", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onNewMention(handler);

      const message = createTestMessage("msg-1", "Hey @slack-bot help");

      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      expect(mockAdapter.isDM).toHaveBeenCalledWith("slack:C123:1234.5678");
    });
  });

  describe("Slash Commands", () => {
    it("should call onSlashCommand handler for all commands", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onSlashCommand(handler);

      const event = {
        command: "/help",
        text: "topic",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        adapter: mockAdapter,
        raw: { channel_id: "C456" },
        channelId: "slack:C456",
        triggerId: "trigger-123",
      };

      chat.processSlashCommand(event);
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalled();
      const receivedEvent = handler.mock.calls[0][0];
      expect(receivedEvent.command).toBe("/help");
      expect(receivedEvent.text).toBe("topic");
      expect(receivedEvent.channel).toBeDefined();
    });

    it("should call onSlashCommand handler for specific command", async () => {
      const helpHandler = vi.fn().mockResolvedValue(undefined);
      const statusHandler = vi.fn().mockResolvedValue(undefined);

      chat.onSlashCommand("/help", helpHandler);
      chat.onSlashCommand("/status", statusHandler);

      const helpEvent = {
        command: "/help",
        text: "",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        adapter: mockAdapter,
        raw: { channel_id: "C456" },
        channelId: "slack:C456",
      };

      chat.processSlashCommand(helpEvent);
      await new Promise((r) => setTimeout(r, 10));

      expect(helpHandler).toHaveBeenCalled();
      expect(statusHandler).not.toHaveBeenCalled();
    });

    it("should call onSlashCommand handler for multiple commands", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onSlashCommand(["/status", "/health"], handler);

      const statusEvent = {
        command: "/status",
        text: "",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        adapter: mockAdapter,
        raw: { channel_id: "C456" },
        channelId: "slack:C456",
      };

      const healthEvent = {
        command: "/health",
        text: "",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        adapter: mockAdapter,
        raw: { channel_id: "C456" },
        channelId: "slack:C456",
      };

      const helpEvent = {
        command: "/help",
        text: "",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        adapter: mockAdapter,
        raw: { channel_id: "C456" },
        channelId: "slack:C456",
      };

      chat.processSlashCommand(statusEvent);
      chat.processSlashCommand(healthEvent);
      chat.processSlashCommand(helpEvent);
      await new Promise((r) => setTimeout(r, 10));

      // Should be called for /status and /health, but not /help
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("should skip slash commands from self", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onSlashCommand(handler);

      const event = {
        command: "/help",
        text: "",
        user: {
          userId: "BOT",
          userName: "testbot",
          fullName: "Test Bot",
          isBot: true,
          isMe: true,
        },
        adapter: mockAdapter,
        raw: { channel_id: "C456" },
        channelId: "slack:C456",
      };

      chat.processSlashCommand(event);
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).not.toHaveBeenCalled();
    });

    it("should normalize command names without leading slash", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      // Register with "help" (no slash) - should be normalized to "/help"
      chat.onSlashCommand("help", handler);

      const event = {
        command: "/help",
        text: "",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        adapter: mockAdapter,
        raw: { channel_id: "C456" },
        channelId: "slack:C456",
      };

      chat.processSlashCommand(event);
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalled();
    });

    it("should provide channel.post method", async () => {
      const handler = vi.fn().mockImplementation(async (event) => {
        await event.channel.post("Hello from slash command!");
      });
      chat.onSlashCommand(handler);

      const event = {
        command: "/help",
        text: "",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        adapter: mockAdapter,
        raw: { channel_id: "C456" },
        channelId: "slack:C456",
      };

      chat.processSlashCommand(event);
      await new Promise((r) => setTimeout(r, 20));

      expect(handler).toHaveBeenCalled();
      expect(mockAdapter.postChannelMessage).toHaveBeenCalledWith(
        "slack:C456",
        "Hello from slash command!"
      );
    });

    it("should provide openModal method that calls adapter.openModal", async () => {
      let capturedEvent:
        | {
            openModal: (
              modal: ModalElement
            ) => Promise<{ viewId: string } | undefined>;
          }
        | undefined;
      const handler = vi.fn().mockImplementation(async (event) => {
        capturedEvent = event;
      });
      chat.onSlashCommand(handler);

      const event = {
        command: "/feedback",
        text: "",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        adapter: mockAdapter,
        raw: { channel_id: "C456" },
        channelId: "slack:C456",
        triggerId: "trigger-123",
      };

      chat.processSlashCommand(event);
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalled();
      expect(capturedEvent?.openModal).toBeDefined();

      // Call openModal with a ModalElement
      const modal: ModalElement = {
        type: "modal",
        callbackId: "feedback_modal",
        title: "Feedback",
        children: [],
      };
      const result = await capturedEvent?.openModal(modal);

      expect(mockAdapter.openModal).toHaveBeenCalledWith(
        "trigger-123",
        modal,
        expect.any(String) // contextId
      );
      expect(result).toEqual({ viewId: "V123" });
    });

    it("should convert JSX Modal to ModalElement in openModal", async () => {
      let capturedEvent:
        | {
            openModal: (
              modal: unknown
            ) => Promise<{ viewId: string } | undefined>;
          }
        | undefined;
      const handler = vi.fn().mockImplementation(async (event) => {
        capturedEvent = event;
      });
      chat.onSlashCommand(handler);

      const event = {
        command: "/feedback",
        text: "",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        adapter: mockAdapter,
        raw: { channel_id: "C456" },
        channelId: "slack:C456",
        triggerId: "trigger-123",
      };

      chat.processSlashCommand(event);
      await new Promise((r) => setTimeout(r, 10));

      const jsxModal = jsx(Modal, {
        callbackId: "jsx_modal",
        title: "JSX Modal",
        children: [jsx(TextInput, { id: "name", label: "Name" })],
      });
      const result = await capturedEvent?.openModal(jsxModal);

      expect(mockAdapter.openModal).toHaveBeenCalledWith(
        "trigger-123",
        expect.objectContaining({
          type: "modal",
          callbackId: "jsx_modal",
          title: "JSX Modal",
        }),
        expect.any(String) // contextId
      );
      expect(result).toEqual({ viewId: "V123" });
    });

    it("should return undefined from openModal when triggerId is missing", async () => {
      let capturedEvent:
        | {
            openModal: (
              modal: ModalElement
            ) => Promise<{ viewId: string } | undefined>;
          }
        | undefined;
      const handler = vi.fn().mockImplementation(async (event) => {
        capturedEvent = event;
      });
      chat.onSlashCommand(handler);

      const event = {
        command: "/feedback",
        text: "",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        adapter: mockAdapter,
        raw: { channel_id: "C456" },
        channelId: "slack:C456",
      };

      chat.processSlashCommand(event);
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalled();

      const modal: ModalElement = {
        type: "modal",
        callbackId: "test_modal",
        title: "Test Modal",
        children: [],
      };
      const result = await capturedEvent?.openModal(modal);

      expect(result).toBeUndefined();
      expect(mockAdapter.openModal).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Cannot open modal: no triggerId available"
      );
    });

    it("should return undefined from openModal when adapter does not support modals", async () => {
      const adapterWithoutModals: Adapter = {
        ...mockAdapter,
        openModal: undefined,
      };

      let capturedEvent:
        | {
            openModal: (
              modal: ModalElement
            ) => Promise<{ viewId: string } | undefined>;
          }
        | undefined;
      const handler = vi.fn().mockImplementation(async (event) => {
        capturedEvent = event;
      });
      chat.onSlashCommand(handler);

      const event = {
        command: "/feedback",
        text: "",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        adapter: adapterWithoutModals,
        raw: { channel_id: "C456" },
        channelId: "slack:C456",
        triggerId: "trigger-123",
      };

      chat.processSlashCommand(event);
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalled();

      const modal: ModalElement = {
        type: "modal",
        callbackId: "test_modal",
        title: "Test Modal",
        children: [],
      };
      const result = await capturedEvent?.openModal(modal);

      expect(result).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Cannot open modal: slack does not support modals"
      );
    });

    it("should run both specific and catch-all handlers", async () => {
      const specificHandler = vi.fn().mockResolvedValue(undefined);
      const catchAllHandler = vi.fn().mockResolvedValue(undefined);

      chat.onSlashCommand("/help", specificHandler);
      chat.onSlashCommand(catchAllHandler);

      const event = {
        command: "/help",
        text: "",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        adapter: mockAdapter,
        raw: { channel_id: "C456" },
        channelId: "slack:C456",
      };

      chat.processSlashCommand(event);
      await new Promise((r) => setTimeout(r, 10));

      expect(specificHandler).toHaveBeenCalled();
      expect(catchAllHandler).toHaveBeenCalled();
    });

    it("should store channel context when opening modal and provide relatedChannel in modal submit", async () => {
      // Open a modal from slash command
      let capturedEvent:
        | {
            openModal: (
              modal: ModalElement
            ) => Promise<{ viewId: string } | undefined>;
          }
        | undefined;
      const slashHandler = vi.fn().mockImplementation(async (event) => {
        capturedEvent = event;
      });
      chat.onSlashCommand(slashHandler);

      const slashCommandEvent = {
        command: "/feedback",
        text: "",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        adapter: mockAdapter,
        raw: { channel_id: "C456" },
        channelId: "slack:C456",
        triggerId: "trigger-123",
      };

      chat.processSlashCommand(slashCommandEvent);
      await new Promise((r) => setTimeout(r, 10));

      // Open modal
      const modal: ModalElement = {
        type: "modal",
        callbackId: "slash_feedback",
        title: "Feedback",
        children: [],
      };
      await capturedEvent?.openModal(modal);

      // Get the contextId from the openModal call
      const contextId = (mockAdapter.openModal as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[2];

      // Now submit the modal
      let modalSubmitEvent: ModalSubmitEvent | undefined;
      const modalSubmitHandler = vi
        .fn()
        .mockImplementation(async (event: ModalSubmitEvent) => {
          modalSubmitEvent = event;
        });
      chat.onModalSubmit("slash_feedback", modalSubmitHandler);

      await chat.processModalSubmit(
        {
          callbackId: "slash_feedback",
          viewId: "V123",
          values: { message: "Great feedback!" },
          user: {
            userId: "U123",
            userName: "user",
            fullName: "Test User",
            isBot: false,
            isMe: false,
          },
          adapter: mockAdapter,
          raw: {},
        },
        contextId
      );

      expect(modalSubmitHandler).toHaveBeenCalled();
      expect(modalSubmitEvent?.relatedChannel).toBeDefined();
      expect(modalSubmitEvent?.relatedChannel?.id).toBe("slack:C456");
      expect(modalSubmitEvent?.relatedThread).toBeUndefined();
      expect(modalSubmitEvent?.relatedMessage).toBeUndefined();
    });

    it("should allow posting to relatedChannel from modal submit handler", async () => {
      let capturedEvent:
        | {
            openModal: (
              modal: ModalElement
            ) => Promise<{ viewId: string } | undefined>;
          }
        | undefined;
      const slashHandler = vi.fn().mockImplementation(async (event) => {
        capturedEvent = event;
      });
      chat.onSlashCommand(slashHandler);

      const slashCommandEvent = {
        command: "/feedback",
        text: "",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        adapter: mockAdapter,
        raw: { channel_id: "C456" },
        channelId: "slack:C456",
        triggerId: "trigger-123",
      };

      chat.processSlashCommand(slashCommandEvent);
      await new Promise((r) => setTimeout(r, 10));

      const modal: ModalElement = {
        type: "modal",
        callbackId: "slash_feedback_post",
        title: "Feedback",
        children: [],
      };
      await capturedEvent?.openModal(modal);
      const contextId = (mockAdapter.openModal as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[2];
      chat.onModalSubmit("slash_feedback_post", async (event) => {
        if (event.relatedChannel) {
          await event.relatedChannel.post("Thank you for your feedback!");
        }
        return undefined;
      });

      await chat.processModalSubmit(
        {
          callbackId: "slash_feedback_post",
          viewId: "V123",
          values: { message: "Great feedback!" },
          user: {
            userId: "U123",
            userName: "user",
            fullName: "Test User",
            isBot: false,
            isMe: false,
          },
          adapter: mockAdapter,
          raw: {},
        },
        contextId
      );

      expect(mockAdapter.postChannelMessage).toHaveBeenCalledWith(
        "slack:C456",
        "Thank you for your feedback!"
      );
    });

    it("should provide relatedChannel from action-triggered modal (extracted from thread)", async () => {
      let capturedActionEvent: ActionEvent | undefined;
      const actionHandler = vi
        .fn()
        .mockImplementation(async (event: ActionEvent) => {
          capturedActionEvent = event;
        });
      chat.onAction("feedback_button", actionHandler);

      const actionEvent: Omit<ActionEvent, "thread" | "openModal"> = {
        actionId: "feedback_button",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        messageId: "msg-1",
        threadId: "slack:C789:1234.5678",
        adapter: mockAdapter,
        raw: {},
        triggerId: "trigger-action-123",
      };

      chat.processAction(actionEvent);
      await new Promise((r) => setTimeout(r, 10));

      expect(actionHandler).toHaveBeenCalled();

      const modal: ModalElement = {
        type: "modal",
        callbackId: "action_feedback",
        title: "Feedback",
        children: [],
      };
      await capturedActionEvent?.openModal(modal);

      let modalSubmitEvent: ModalSubmitEvent | undefined;
      const modalSubmitHandler = vi
        .fn()
        .mockImplementation(async (event: ModalSubmitEvent) => {
          modalSubmitEvent = event;
        });
      chat.onModalSubmit("action_feedback", modalSubmitHandler);

      const contextId = (mockAdapter.openModal as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[2];

      await chat.processModalSubmit(
        {
          callbackId: "action_feedback",
          viewId: "V456",
          values: { message: "Button feedback!" },
          user: {
            userId: "U123",
            userName: "user",
            fullName: "Test User",
            isBot: false,
            isMe: false,
          },
          adapter: mockAdapter,
          raw: {},
        },
        contextId
      );

      expect(modalSubmitHandler).toHaveBeenCalled();
      expect(modalSubmitEvent?.relatedChannel).toBeDefined();
      expect(modalSubmitEvent?.relatedChannel?.id).toBe("slack:C789");
      expect(modalSubmitEvent?.relatedThread).toBeDefined();
      expect(modalSubmitEvent?.relatedThread?.id).toBe("slack:C789:1234.5678");
    });
  });

  describe("onLockConflict", () => {
    it("should drop by default when lock is held", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      chat.onNewMention(handler);

      // Acquire lock to simulate another handler
      await mockState.acquireLock("slack:C123:1234.5678", 30000);

      const message = createTestMessage("msg-lock-1", "Hey @slack-bot");

      await expect(
        chat.handleIncomingMessage(mockAdapter, "slack:C123:1234.5678", message)
      ).rejects.toThrow(LockError);

      expect(handler).not.toHaveBeenCalled();
    });

    it("should force-release lock when onLockConflict is 'force'", async () => {
      const forceChat = new Chat({
        userName: "testbot",
        adapters: { slack: mockAdapter },
        state: mockState,
        logger: mockLogger,
        onLockConflict: "force",
      });

      await forceChat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );

      const handler = vi.fn().mockResolvedValue(undefined);
      forceChat.onNewMention(handler);

      // Acquire lock to simulate another handler
      await mockState.acquireLock("slack:C123:1234.5678", 30000);

      const message = createTestMessage("msg-lock-2", "Hey @slack-bot");

      await forceChat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      expect(mockState.forceReleaseLock).toHaveBeenCalledWith(
        "slack:C123:1234.5678"
      );
      // Verify lock was re-acquired after force-release
      const lastAcquireCall = mockState.acquireLock.mock.calls.at(-1);
      expect(lastAcquireCall[0]).toBe("slack:C123:1234.5678");
      expect(handler).toHaveBeenCalled();
    });

    it("should support callback returning 'force'", async () => {
      const callbackChat = new Chat({
        userName: "testbot",
        adapters: { slack: mockAdapter },
        state: mockState,
        logger: mockLogger,
        onLockConflict: (_threadId, _message) => "force",
      });

      await callbackChat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );

      const handler = vi.fn().mockResolvedValue(undefined);
      callbackChat.onNewMention(handler);

      await mockState.acquireLock("slack:C123:1234.5678", 30000);

      const message = createTestMessage("msg-lock-3", "Hey @slack-bot");

      await callbackChat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      expect(handler).toHaveBeenCalled();
    });

    it("should support callback returning 'drop'", async () => {
      const callbackChat = new Chat({
        userName: "testbot",
        adapters: { slack: mockAdapter },
        state: mockState,
        logger: mockLogger,
        onLockConflict: (_threadId, _message) => "drop",
      });

      await callbackChat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );

      const handler = vi.fn().mockResolvedValue(undefined);
      callbackChat.onNewMention(handler);

      await mockState.acquireLock("slack:C123:1234.5678", 30000);

      const message = createTestMessage("msg-lock-4", "Hey @slack-bot");

      await expect(
        callbackChat.handleIncomingMessage(
          mockAdapter,
          "slack:C123:1234.5678",
          message
        )
      ).rejects.toThrow(LockError);

      expect(handler).not.toHaveBeenCalled();
    });

    it("should support async callback", async () => {
      const asyncChat = new Chat({
        userName: "testbot",
        adapters: { slack: mockAdapter },
        state: mockState,
        logger: mockLogger,
        onLockConflict: async (_threadId, _message) => "force",
      });

      await asyncChat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );

      const handler = vi.fn().mockResolvedValue(undefined);
      asyncChat.onNewMention(handler);

      await mockState.acquireLock("slack:C123:1234.5678", 30000);

      const message = createTestMessage("msg-lock-5", "Hey @slack-bot");

      await asyncChat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("persistMessageHistory", () => {
    it("should cache incoming messages when adapter has persistMessageHistory", async () => {
      const adapter = createMockAdapter("whatsapp");
      (adapter as { persistMessageHistory: boolean }).persistMessageHistory =
        true;
      const state = createMockState();

      const persistChat = new Chat({
        userName: "testbot",
        adapters: { whatsapp: adapter },
        state,
        logger: mockLogger,
      });

      await persistChat.webhooks.whatsapp(
        new Request("http://test.com", { method: "POST" })
      );

      const message = createTestMessage("msg-1", "Hello from WhatsApp");
      await persistChat.handleIncomingMessage(
        adapter,
        "whatsapp:phone:user1",
        message
      );

      // Check that message was stored in state cache
      const stored = state.cache.get("msg-history:whatsapp:phone:user1");
      expect(stored).toBeDefined();
      expect(Array.isArray(stored)).toBe(true);
      expect((stored as Array<{ id: string }>)[0].id).toBe("msg-1");
    });

    it("should NOT cache incoming messages when adapter does not set persistMessageHistory", async () => {
      const message = createTestMessage("msg-2", "Hello from Slack");
      await chat.handleIncomingMessage(
        mockAdapter,
        "slack:C123:1234.5678",
        message
      );

      // No msg-history key should exist
      const stored = (mockState as unknown as { cache: Map<string, unknown> })
        .cache;
      const historyKeys = [...stored.keys()].filter((k) =>
        k.startsWith("msg-history:")
      );
      expect(historyKeys).toHaveLength(0);
    });
  });
});
