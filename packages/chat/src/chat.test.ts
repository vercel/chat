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

  it("should disconnect adapters during shutdown", async () => {
    await chat.shutdown();

    expect(mockAdapter.disconnect).toHaveBeenCalledTimes(1);
    expect(mockState.disconnect).toHaveBeenCalledTimes(1);
  });

  it("should disconnect adapter before state adapter during shutdown", async () => {
    await chat.shutdown();

    const adapterDisconnectCall = (
      mockAdapter.disconnect as ReturnType<typeof vi.fn>
    ).mock.invocationCallOrder[0];
    const stateDisconnectCall = (
      mockState.disconnect as ReturnType<typeof vi.fn>
    ).mock.invocationCallOrder[0];
    expect(adapterDisconnectCall).toBeLessThan(stateDisconnectCall);
  });

  it("should allow adapters without disconnect during shutdown", async () => {
    const adapterWithoutDisconnect: Adapter = {
      ...createMockAdapter("slack"),
      disconnect: undefined,
    };
    const state = createMockState();
    const localChat = new Chat({
      userName: "testbot",
      adapters: { slack: adapterWithoutDisconnect },
      state,
      logger: mockLogger,
    });

    await localChat.webhooks.slack(
      new Request("http://test.com", { method: "POST" })
    );
    await expect(localChat.shutdown()).resolves.toBeUndefined();
    expect(state.disconnect).toHaveBeenCalledTimes(1);
  });

  it("should disconnect all adapters during shutdown", async () => {
    const slackAdapter = createMockAdapter("slack");
    const discordAdapter = createMockAdapter("discord");
    const state = createMockState();
    const multiAdapterChat = new Chat({
      userName: "testbot",
      adapters: { slack: slackAdapter, discord: discordAdapter },
      state,
      logger: mockLogger,
    });

    await multiAdapterChat.webhooks.slack(
      new Request("http://test.com", { method: "POST" })
    );
    await multiAdapterChat.shutdown();

    expect(slackAdapter.disconnect).toHaveBeenCalledTimes(1);
    expect(discordAdapter.disconnect).toHaveBeenCalledTimes(1);
    expect(state.disconnect).toHaveBeenCalledTimes(1);
  });

  it("should continue shutdown even if an adapter disconnect fails", async () => {
    const failingAdapter = createMockAdapter("slack");
    const healthyAdapter = createMockAdapter("discord");
    (failingAdapter.disconnect as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("connection lost")
    );
    const state = createMockState();
    const multiAdapterChat = new Chat({
      userName: "testbot",
      adapters: { slack: failingAdapter, discord: healthyAdapter },
      state,
      logger: mockLogger,
    });

    await multiAdapterChat.webhooks.slack(
      new Request("http://test.com", { method: "POST" })
    );
    await expect(multiAdapterChat.shutdown()).resolves.toBeUndefined();

    expect(healthyAdapter.disconnect).toHaveBeenCalledTimes(1);
    expect(state.disconnect).toHaveBeenCalledTimes(1);
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
      expect(callArgs.length).toBeGreaterThanOrEqual(3);
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

      chat.processAction(event, undefined);
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

      chat.processAction(approveEvent, undefined);
      chat.processAction(skipEvent, undefined);
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

      chat.processAction(event, undefined);
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

      chat.processAction(event, undefined);
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

      chat.processAction(event, undefined);
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

      chat.processAction(event, undefined);
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

      chat.processAction(event, undefined);
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

      chat.processAction(event, undefined);
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

      chat.processAction(event, undefined);
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

      chat.processAction(event, undefined);
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

      chat.processAction(event, undefined);
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

  describe("Options Load", () => {
    it("should call onOptionsLoad handler for a matching action ID", async () => {
      const handler = vi
        .fn()
        .mockResolvedValue([{ label: "Maria Garcia", value: "person_123" }]);
      chat.onOptionsLoad("person_select", handler);

      const options = await chat.processOptionsLoad({
        actionId: "person_select",
        query: "mar",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        adapter: mockAdapter,
        raw: {},
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          actionId: "person_select",
          query: "mar",
        })
      );
      expect(options).toEqual([{ label: "Maria Garcia", value: "person_123" }]);
    });

    it("should prefer specific handlers before catch-all handlers", async () => {
      const catchAll = vi
        .fn()
        .mockResolvedValue([{ label: "Fallback", value: "fallback" }]);
      const specific = vi
        .fn()
        .mockResolvedValue([{ label: "Specific", value: "specific" }]);
      chat.onOptionsLoad(catchAll);
      chat.onOptionsLoad("person_select", specific);

      const options = await chat.processOptionsLoad({
        actionId: "person_select",
        query: "mar",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        adapter: mockAdapter,
        raw: {},
      });

      expect(specific).toHaveBeenCalledTimes(1);
      expect(catchAll).not.toHaveBeenCalled();
      expect(options).toEqual([{ label: "Specific", value: "specific" }]);
    });

    it("should fall back to catch-all handlers when no specific handler matches", async () => {
      const catchAll = vi
        .fn()
        .mockResolvedValue([{ label: "Fallback", value: "fallback" }]);
      chat.onOptionsLoad(catchAll);

      const options = await chat.processOptionsLoad({
        actionId: "unknown_select",
        query: "test",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        adapter: mockAdapter,
        raw: {},
      });

      expect(catchAll).toHaveBeenCalledTimes(1);
      expect(options).toEqual([{ label: "Fallback", value: "fallback" }]);
    });

    it("should continue after handler errors", async () => {
      const failingHandler = vi.fn().mockRejectedValue(new Error("boom"));
      const fallbackHandler = vi
        .fn()
        .mockResolvedValue([{ label: "Recovered", value: "recovered" }]);
      chat.onOptionsLoad("person_select", failingHandler);
      chat.onOptionsLoad(fallbackHandler);

      const options = await chat.processOptionsLoad({
        actionId: "person_select",
        query: "mar",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        adapter: mockAdapter,
        raw: {},
      });

      expect(failingHandler).toHaveBeenCalledTimes(1);
      expect(fallbackHandler).toHaveBeenCalledTimes(1);
      expect(options).toEqual([{ label: "Recovered", value: "recovered" }]);
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Options load handler error",
        expect.objectContaining({ actionId: "person_select" })
      );
    });

    it("should support returning option groups", async () => {
      const handler = vi.fn().mockResolvedValue([
        {
          label: "Recent",
          options: [{ label: "Alice", value: "u1" }],
        },
        {
          label: "All",
          options: [
            { label: "Bob", value: "u2" },
            { label: "Carol", value: "u3" },
          ],
        },
      ]);
      chat.onOptionsLoad("user_select", handler);

      const result = await chat.processOptionsLoad({
        actionId: "user_select",
        query: "",
        user: {
          userId: "U123",
          userName: "user",
          fullName: "Test User",
          isBot: false,
          isMe: false,
        },
        adapter: mockAdapter,
        raw: {},
      });

      expect(result).toHaveLength(2);
      expect((result as Array<{ label: string }>)[0].label).toBe("Recent");
    });
  });

  describe("thread", () => {
    it("should return a Thread handle for a valid thread ID", () => {
      const thread = chat.thread("slack:C123:1234.5678");
      expect(thread).toBeDefined();
      expect(thread.id).toBe("slack:C123:1234.5678");
    });

    it("should allow posting to a thread handle", async () => {
      const thread = chat.thread("slack:C123:1234.5678");
      await thread.post("Hello from outside a webhook!");
      expect(mockAdapter.postMessage).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        "Hello from outside a webhook!"
      );
    });

    it("should throw for an invalid thread ID", () => {
      expect(() => chat.thread("")).toThrow("Invalid thread ID");
    });

    it("should throw for an unknown adapter prefix", () => {
      expect(() => chat.thread("unknown:C123:1234.5678")).toThrow(
        'Adapter "unknown" not found'
      );
    });
  });

  describe("getUser", () => {
    it("should return user info from adapter", async () => {
      mockAdapter.getUser = vi.fn().mockResolvedValue({
        userId: "U123456",
        userName: "alice",
        fullName: "Alice Smith",
        email: "alice@example.com",
        avatarUrl: "https://example.com/alice.png",
        isBot: false,
      });

      const user = await chat.getUser("U123456");
      expect(user).not.toBeNull();
      expect(user?.email).toBe("alice@example.com");
      expect(user?.fullName).toBe("Alice Smith");
      expect(mockAdapter.getUser).toHaveBeenCalledWith("U123456");
    });

    it("should accept Author object", async () => {
      mockAdapter.getUser = vi.fn().mockResolvedValue({
        userId: "U789",
        userName: "bob",
        fullName: "Bob Jones",
        isBot: false,
      });

      const user = await chat.getUser({
        userId: "U789",
        userName: "bob",
        fullName: "Bob Jones",
        isBot: false,
        isMe: false,
      });
      expect(mockAdapter.getUser).toHaveBeenCalledWith("U789");
      expect(user?.fullName).toBe("Bob Jones");
    });

    it("should throw when adapter does not support getUser", async () => {
      await expect(chat.getUser("U123456")).rejects.toThrow(
        "does not support getUser"
      );
    });

    it("should return null when user is not found", async () => {
      mockAdapter.getUser = vi.fn().mockResolvedValue(null);
      const user = await chat.getUser("U999999");
      expect(user).toBeNull();
    });

    it("should throw error for unknown userId format", async () => {
      mockAdapter.getUser = vi.fn().mockResolvedValue(null);
      await expect(chat.getUser("invalid-user-id")).rejects.toThrow(
        'Cannot infer adapter from userId "invalid-user-id"'
      );
    });

    it("should infer linear adapter from a UUID", async () => {
      const linearAdapter = createMockAdapter("linear");
      linearAdapter.getUser = vi.fn().mockResolvedValue({
        userId: "8f1f3c7e-d4e1-4f9a-bf2b-1c3d4e5f6a7b",
        userName: "ben",
        fullName: "Ben Sabic",
        isBot: false,
      });
      const multi = new Chat({
        userName: "testbot",
        adapters: { slack: mockAdapter, linear: linearAdapter },
        state: createMockState(),
        logger: mockLogger,
      });

      const user = await multi.getUser("8f1f3c7e-d4e1-4f9a-bf2b-1c3d4e5f6a7b");
      expect(user?.fullName).toBe("Ben Sabic");
      expect(linearAdapter.getUser).toHaveBeenCalledWith(
        "8f1f3c7e-d4e1-4f9a-bf2b-1c3d4e5f6a7b"
      );
    });

    it("should infer telegram from numeric id when only telegram is registered", async () => {
      const telegramAdapter = createMockAdapter("telegram");
      telegramAdapter.getUser = vi.fn().mockResolvedValue({
        userId: "987654321",
        userName: "alice",
        fullName: "Alice",
        isBot: false,
      });
      const multi = new Chat({
        userName: "testbot",
        adapters: { telegram: telegramAdapter },
        state: createMockState(),
        logger: mockLogger,
      });

      const user = await multi.getUser("987654321");
      expect(user?.userName).toBe("alice");
      expect(telegramAdapter.getUser).toHaveBeenCalledWith("987654321");
    });

    it("should infer github from numeric id when only github is registered", async () => {
      const githubAdapter = createMockAdapter("github");
      githubAdapter.getUser = vi.fn().mockResolvedValue({
        userId: "12345",
        userName: "octocat",
        fullName: "The Octocat",
        isBot: false,
      });
      const multi = new Chat({
        userName: "testbot",
        adapters: { github: githubAdapter },
        state: createMockState(),
        logger: mockLogger,
      });

      const user = await multi.getUser("12345");
      expect(user?.userName).toBe("octocat");
    });

    it("should infer discord for 17-19 digit snowflake when only discord is registered", async () => {
      const discordAdapter = createMockAdapter("discord");
      discordAdapter.getUser = vi.fn().mockResolvedValue({
        userId: "175928847299117063",
        userName: "discordbot",
        fullName: "Discord User",
        isBot: false,
      });
      const multi = new Chat({
        userName: "testbot",
        adapters: { discord: discordAdapter },
        state: createMockState(),
        logger: mockLogger,
      });

      const user = await multi.getUser("175928847299117063");
      expect(user?.fullName).toBe("Discord User");
    });

    it("should throw AMBIGUOUS_USER_ID when numeric id matches multiple registered adapters", async () => {
      const discordAdapter = createMockAdapter("discord");
      const telegramAdapter = createMockAdapter("telegram");
      const multi = new Chat({
        userName: "testbot",
        adapters: { discord: discordAdapter, telegram: telegramAdapter },
        state: createMockState(),
        logger: mockLogger,
      });

      await expect(multi.getUser("175928847299117063")).rejects.toThrow(
        "ambiguous"
      );
    });

    it("should not match GitHub-style logins as Slack ids (case sensitivity)", async () => {
      // "user123" used to match the case-insensitive Slack regex; now must not.
      const githubAdapter = createMockAdapter("github");
      const multi = new Chat({
        userName: "testbot",
        adapters: { slack: mockAdapter, github: githubAdapter },
        state: createMockState(),
        logger: mockLogger,
      });

      await expect(multi.getUser("user123")).rejects.toThrow(
        'Cannot infer adapter from userId "user123"'
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

      chat.processAction(actionEvent, undefined);
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

  describe("concurrency: queue", () => {
    it("should process queued messages with skipped context after handler finishes", async () => {
      const state = createMockState();
      const adapter = createMockAdapter("slack");

      const queueChat = new Chat({
        userName: "testbot",
        adapters: { slack: adapter },
        state,
        logger: mockLogger,
        concurrency: "queue",
      });

      await queueChat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );

      const receivedContexts: Array<
        { skipped: string[]; totalSinceLastHandler: number } | undefined
      > = [];
      const handler = vi
        .fn()
        .mockImplementation(async (_thread, _message, context) => {
          receivedContexts.push(
            context
              ? {
                  skipped: context.skipped.map((m: { text: string }) => m.text),
                  totalSinceLastHandler: context.totalSinceLastHandler,
                }
              : undefined
          );
        });
      queueChat.onNewMention(handler);

      // First message processes immediately (lock acquired)
      const msg1 = createTestMessage("msg-q-1", "Hey @slack-bot first");
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        msg1
      );

      expect(handler).toHaveBeenCalledTimes(1);
      expect(receivedContexts[0]).toBeUndefined();
    });

    it("should enqueue messages when lock is held and drain after", async () => {
      const state = createMockState();
      const adapter = createMockAdapter("slack");

      const queueChat = new Chat({
        userName: "testbot",
        adapters: { slack: adapter },
        state,
        logger: mockLogger,
        concurrency: "queue",
      });

      await queueChat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );

      const receivedMessages: string[] = [];
      const receivedContexts: Array<
        { skipped: string[]; totalSinceLastHandler: number } | undefined
      > = [];

      const handler = vi
        .fn()
        .mockImplementation(async (_thread, message, context) => {
          receivedMessages.push(message.text);
          receivedContexts.push(
            context
              ? {
                  skipped: context.skipped.map((m: { text: string }) => m.text),
                  totalSinceLastHandler: context.totalSinceLastHandler,
                }
              : undefined
          );
        });
      queueChat.onNewMention(handler);

      // Pre-acquire lock to simulate busy handler
      await state.acquireLock("slack:C123:1234.5678", 30000);

      // These messages should be enqueued
      const msg1 = createTestMessage("msg-q-2", "Hey @slack-bot second");
      const msg2 = createTestMessage("msg-q-3", "Hey @slack-bot third");
      const msg3 = createTestMessage("msg-q-4", "Hey @slack-bot fourth");

      // Messages go to queue (no error thrown)
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        msg1
      );
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        msg2
      );
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        msg3
      );

      // Handler not called yet — lock was held
      expect(handler).not.toHaveBeenCalled();

      // Now release the lock and send a new message that acquires it
      await state.forceReleaseLock("slack:C123:1234.5678");
      const msg4 = createTestMessage("msg-q-5", "Hey @slack-bot fifth");
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        msg4
      );

      // Handler should have been called for msg4 (direct) then msg3 (latest from queue)
      // msg4 runs first (lock holder), then drains queue: gets [msg1, msg2, msg3]
      // and calls handler with msg3 as message, [msg1, msg2] as skipped
      expect(handler).toHaveBeenCalledTimes(2);
      expect(receivedMessages[0]).toBe("Hey @slack-bot fifth");
      expect(receivedContexts[0]).toBeUndefined();
      expect(receivedMessages[1]).toBe("Hey @slack-bot fourth");
      expect(receivedContexts[1]).toEqual({
        skipped: ["Hey @slack-bot second", "Hey @slack-bot third"],
        totalSinceLastHandler: 3,
      });
    });
  });

  describe("concurrency: queue attachment rehydration", () => {
    function createJsonRoundtripState() {
      const state = createMockState();
      const realEnqueue = state.enqueue.getMockImplementation();
      if (!realEnqueue) {
        throw new Error("Expected enqueue to have a mock implementation");
      }
      vi.mocked(state.enqueue).mockImplementation(
        async (threadId, entry, maxSize) => {
          // Simulate real state adapter: JSON.stringify strips functions
          const serialized = JSON.parse(JSON.stringify(entry));
          return realEnqueue(threadId, serialized, maxSize);
        }
      );
      return state;
    }

    it("should call rehydrateAttachment on deserialized attachments missing fetchData", async () => {
      const state = createJsonRoundtripState();
      const adapter = createMockAdapter("slack");
      const mockFetchData = vi.fn().mockResolvedValue(Buffer.from("data"));
      adapter.rehydrateAttachment = vi.fn().mockImplementation((att) => ({
        ...att,
        fetchData: mockFetchData,
      }));

      const queueChat = new Chat({
        userName: "testbot",
        adapters: { slack: adapter },
        state,
        logger: mockLogger,
        concurrency: "queue",
      });

      await queueChat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );

      const receivedAttachments: unknown[] = [];
      queueChat.onNewMention(
        vi.fn().mockImplementation(async (_thread, message) => {
          receivedAttachments.push(message.attachments);
        })
      );

      // Pre-acquire lock so the message gets enqueued (and JSON-serialized)
      await state.acquireLock("slack:C123:1234.5678", 30000);

      const msg = createTestMessage("msg-att-1", "Hey @slack-bot file", {
        attachments: [
          {
            type: "file" as const,
            url: "https://example.com/f.pdf",
            name: "f.pdf",
            fetchMetadata: { url: "https://example.com/f.pdf" },
            fetchData: () => Promise.resolve(Buffer.from("original")),
          },
        ],
      });

      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        msg
      );

      // Release lock and trigger drain with a new message
      await state.forceReleaseLock("slack:C123:1234.5678");
      const trigger = createTestMessage("msg-att-2", "Hey @slack-bot trigger");
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        trigger
      );

      // rehydrateAttachment should have been called for the queued message
      expect(adapter.rehydrateAttachment).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "file",
          fetchMetadata: { url: "https://example.com/f.pdf" },
        })
      );

      // The handler should receive the attachment with fetchData restored
      expect(receivedAttachments.length).toBeGreaterThanOrEqual(1);
      const queuedAttachments = receivedAttachments.find(
        (atts) =>
          Array.isArray(atts) && atts.length > 0 && atts[0].name === "f.pdf"
      ) as { fetchData?: () => Promise<Buffer> }[];
      expect(queuedAttachments).toBeDefined();
      expect(queuedAttachments[0].fetchData).toBe(mockFetchData);
    });

    it("should skip rehydration for attachments that already have fetchData", async () => {
      const state = createMockState(); // no JSON roundtrip — Message survives as instance
      const adapter = createMockAdapter("slack");
      adapter.rehydrateAttachment = vi.fn();

      const queueChat = new Chat({
        userName: "testbot",
        adapters: { slack: adapter },
        state,
        logger: mockLogger,
        concurrency: "queue",
      });

      await queueChat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );

      const originalFetchData = vi
        .fn()
        .mockResolvedValue(Buffer.from("original"));

      const receivedAttachments: unknown[] = [];
      queueChat.onNewMention(
        vi.fn().mockImplementation(async (_thread, message) => {
          receivedAttachments.push(message.attachments);
        })
      );

      await state.acquireLock("slack:C123:1234.5678", 30000);

      const msg = createTestMessage("msg-skip-1", "Hey @slack-bot file", {
        attachments: [
          {
            type: "file" as const,
            url: "https://example.com/f.pdf",
            fetchData: originalFetchData,
          },
        ],
      });

      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        msg
      );

      await state.forceReleaseLock("slack:C123:1234.5678");
      const trigger = createTestMessage("msg-skip-2", "Hey @slack-bot trigger");
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        trigger
      );

      // rehydrateAttachment should NOT have been called — fetchData was already present
      expect(adapter.rehydrateAttachment).not.toHaveBeenCalled();
    });

    it("should leave attachments unchanged when adapter has no rehydrateAttachment", async () => {
      const state = createJsonRoundtripState();
      const adapter = createMockAdapter("slack");
      // adapter has no rehydrateAttachment (default from createMockAdapter)

      const queueChat = new Chat({
        userName: "testbot",
        adapters: { slack: adapter },
        state,
        logger: mockLogger,
        concurrency: "queue",
      });

      await queueChat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );

      const receivedAttachments: unknown[] = [];
      queueChat.onNewMention(
        vi.fn().mockImplementation(async (_thread, message) => {
          receivedAttachments.push(message.attachments);
        })
      );

      await state.acquireLock("slack:C123:1234.5678", 30000);

      const msg = createTestMessage("msg-noop-1", "Hey @slack-bot file", {
        attachments: [
          {
            type: "file" as const,
            url: "https://example.com/f.pdf",
            fetchMetadata: { url: "https://example.com/f.pdf" },
            fetchData: () => Promise.resolve(Buffer.from("data")),
          },
        ],
      });

      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        msg
      );

      await state.forceReleaseLock("slack:C123:1234.5678");
      const trigger = createTestMessage("msg-noop-2", "Hey @slack-bot trigger");
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        trigger
      );

      // Attachment should still have fetchMetadata but no fetchData (lost in JSON roundtrip)
      const queuedAttachments = receivedAttachments.find(
        (atts) =>
          Array.isArray(atts) &&
          atts.length > 0 &&
          atts[0].url === "https://example.com/f.pdf"
      ) as { fetchData?: unknown; fetchMetadata?: unknown }[];
      expect(queuedAttachments).toBeDefined();
      expect(queuedAttachments[0].fetchMetadata).toEqual({
        url: "https://example.com/f.pdf",
      });
      expect(queuedAttachments[0].fetchData).toBeUndefined();
    });
  });

  describe("concurrency: queue with onSubscribedMessage", () => {
    it("should pass skipped context to subscribed message handlers", async () => {
      const state = createMockState();
      const adapter = createMockAdapter("slack");

      const queueChat = new Chat({
        userName: "testbot",
        adapters: { slack: adapter },
        state,
        logger: mockLogger,
        concurrency: "queue",
      });

      await queueChat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );

      const receivedMessages: string[] = [];
      const receivedContexts: Array<
        { skipped: string[]; totalSinceLastHandler: number } | undefined
      > = [];

      queueChat.onNewMention(async (thread) => {
        await thread.subscribe();
      });

      queueChat.onSubscribedMessage(async (_thread, message, context) => {
        receivedMessages.push(message.text);
        receivedContexts.push(
          context
            ? {
                skipped: context.skipped.map((m: { text: string }) => m.text),
                totalSinceLastHandler: context.totalSinceLastHandler,
              }
            : undefined
        );
      });

      // First message: mention that subscribes the thread
      const msg0 = createTestMessage(
        "msg-sub-0",
        "Hey @slack-bot subscribe me"
      );
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        msg0
      );

      // Now the thread is subscribed. Pre-acquire lock to simulate busy handler.
      await state.acquireLock("slack:C123:1234.5678", 30000);

      // These messages go to subscribed handler — but lock is held, so they queue
      const msg1 = createTestMessage("msg-sub-1", "first follow-up");
      const msg2 = createTestMessage("msg-sub-2", "second follow-up");
      const msg3 = createTestMessage("msg-sub-3", "third follow-up");

      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        msg1
      );
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        msg2
      );
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        msg3
      );

      // Release lock and send another message
      await state.forceReleaseLock("slack:C123:1234.5678");
      const msg4 = createTestMessage("msg-sub-4", "fourth follow-up");
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        msg4
      );

      // msg4 processed directly (no context), then queue drained:
      // [msg1, msg2, msg3] → handler(msg3, { skipped: [msg1, msg2] })
      expect(receivedMessages).toEqual(["fourth follow-up", "third follow-up"]);
      expect(receivedContexts[0]).toBeUndefined();
      expect(receivedContexts[1]).toEqual({
        skipped: ["first follow-up", "second follow-up"],
        totalSinceLastHandler: 3,
      });
    });
  });

  describe("concurrency: queue edge cases", () => {
    it("should drop newest when queue is full with drop-newest policy", async () => {
      const state = createMockState();
      const adapter = createMockAdapter("slack");

      const queueChat = new Chat({
        userName: "testbot",
        adapters: { slack: adapter },
        state,
        logger: mockLogger,
        concurrency: {
          strategy: "queue",
          maxQueueSize: 2,
          onQueueFull: "drop-newest",
        },
      });

      await queueChat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );

      queueChat.onNewMention(vi.fn().mockResolvedValue(undefined));

      // Hold the lock
      await state.acquireLock("slack:C123:1234.5678", 30000);

      // Enqueue 2 messages (fills the queue)
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        createTestMessage("msg-dq-1", "Hey @slack-bot one")
      );
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        createTestMessage("msg-dq-2", "Hey @slack-bot two")
      );

      // Third message should be silently dropped (drop-newest)
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        createTestMessage("msg-dq-3", "Hey @slack-bot three")
      );

      // Queue should still have depth 2
      expect(await state.queueDepth("slack:C123:1234.5678")).toBe(2);
    });

    it("should drop oldest when queue is full with drop-oldest policy", async () => {
      const state = createMockState();
      const adapter = createMockAdapter("slack");

      const queueChat = new Chat({
        userName: "testbot",
        adapters: { slack: adapter },
        state,
        logger: mockLogger,
        concurrency: {
          strategy: "queue",
          maxQueueSize: 2,
          onQueueFull: "drop-oldest",
        },
      });

      await queueChat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );

      const receivedMessages: string[] = [];
      queueChat.onNewMention(
        vi.fn().mockImplementation(async (_thread, message) => {
          receivedMessages.push(message.text);
        })
      );

      // Hold the lock
      await state.acquireLock("slack:C123:1234.5678", 30000);

      // Enqueue 3 messages with maxSize 2 → first should be evicted
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        createTestMessage("msg-do-1", "Hey @slack-bot one")
      );
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        createTestMessage("msg-do-2", "Hey @slack-bot two")
      );
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        createTestMessage("msg-do-3", "Hey @slack-bot three")
      );

      expect(await state.queueDepth("slack:C123:1234.5678")).toBe(2);

      // Release and trigger drain
      await state.forceReleaseLock("slack:C123:1234.5678");
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        createTestMessage("msg-do-4", "Hey @slack-bot four")
      );

      // msg-do-4 processed directly, then drain gets [msg-do-2, msg-do-3]
      // (msg-do-1 was evicted), processes msg-do-3 with skipped [msg-do-2]
      expect(receivedMessages[0]).toBe("Hey @slack-bot four");
      expect(receivedMessages[1]).toBe("Hey @slack-bot three");
    });

    it("should skip expired entries during drain", async () => {
      const state = createMockState();
      const adapter = createMockAdapter("slack");

      const queueChat = new Chat({
        userName: "testbot",
        adapters: { slack: adapter },
        state,
        logger: mockLogger,
        concurrency: {
          strategy: "queue",
          queueEntryTtlMs: 1, // Expire almost immediately
        },
      });

      await queueChat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );

      const receivedMessages: string[] = [];
      queueChat.onNewMention(
        vi.fn().mockImplementation(async (_thread, message) => {
          receivedMessages.push(message.text);
        })
      );

      // Hold the lock
      await state.acquireLock("slack:C123:1234.5678", 30000);

      // Enqueue a message with 1ms TTL
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        createTestMessage("msg-exp-1", "Hey @slack-bot expired")
      );

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Release and trigger drain
      await state.forceReleaseLock("slack:C123:1234.5678");
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        createTestMessage("msg-exp-2", "Hey @slack-bot fresh")
      );

      // Only the fresh message should be processed (expired one skipped)
      expect(receivedMessages).toEqual(["Hey @slack-bot fresh"]);
    });

    it("should work with onNewMessage pattern handlers", async () => {
      const state = createMockState();
      const adapter = createMockAdapter("slack");

      const queueChat = new Chat({
        userName: "testbot",
        adapters: { slack: adapter },
        state,
        logger: mockLogger,
        concurrency: "queue",
      });

      await queueChat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );

      const receivedMessages: string[] = [];
      queueChat.onNewMessage(
        HELP_REGEX,
        vi.fn().mockImplementation(async (_thread, message, context) => {
          receivedMessages.push(message.text);
          if (context) {
            for (const s of context.skipped) {
              receivedMessages.push(`skipped:${s.text}`);
            }
          }
        })
      );

      // Hold the lock
      await state.acquireLock("slack:C123:1234.5678", 30000);

      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        createTestMessage("msg-pat-1", "!help first")
      );
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        createTestMessage("msg-pat-2", "!help second")
      );

      // Release and trigger drain
      await state.forceReleaseLock("slack:C123:1234.5678");
      await queueChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        createTestMessage("msg-pat-3", "!help third")
      );

      // Direct message processed, then drain with skipped context
      expect(receivedMessages[0]).toBe("!help third");
      expect(receivedMessages[1]).toBe("!help second");
      expect(receivedMessages[2]).toBe("skipped:!help first");
    });
  });

  describe("concurrency: debounce", () => {
    it("should debounce the first message and process after delay", async () => {
      vi.useFakeTimers();
      const state = createMockState();
      const adapter = createMockAdapter("slack");

      const debounceChat = new Chat({
        userName: "testbot",
        adapters: { slack: adapter },
        state,
        logger: mockLogger,
        concurrency: { strategy: "debounce", debounceMs: 100 },
      });

      await debounceChat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );

      const handler = vi.fn().mockResolvedValue(undefined);
      debounceChat.onNewMention(handler);

      const msg = createTestMessage("msg-d-1", "Hey @slack-bot debounce");

      // Start processing — acquires lock, enters debounce loop
      const promise = debounceChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        msg
      );

      // Handler should NOT be called yet (debounce timer hasn't fired)
      expect(handler).not.toHaveBeenCalled();

      // Advance past debounce window
      await vi.advanceTimersByTimeAsync(150);
      await promise;

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][1].text).toBe("Hey @slack-bot debounce");

      vi.useRealTimers();
    });

    it("should only process the last message in a burst", async () => {
      vi.useFakeTimers();
      const state = createMockState();
      const adapter = createMockAdapter("slack");

      const debounceChat = new Chat({
        userName: "testbot",
        adapters: { slack: adapter },
        state,
        logger: mockLogger,
        concurrency: { strategy: "debounce", debounceMs: 100 },
      });

      await debounceChat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );

      const handler = vi.fn().mockResolvedValue(undefined);
      debounceChat.onNewMention(handler);

      // First message acquires lock and enters debounce loop
      const msg1 = createTestMessage("msg-d-2", "Hey @slack-bot first");
      const promise = debounceChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        msg1
      );

      // Second message while debounce is waiting — overwrites pending
      const msg2 = createTestMessage("msg-d-3", "Hey @slack-bot second");
      await debounceChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        msg2
      );

      // Third message — overwrites again
      const msg3 = createTestMessage("msg-d-4", "Hey @slack-bot third");
      await debounceChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        msg3
      );

      // Advance past first debounce — should see msg3 replaced msg1
      // but msg3 superseded it, so debounce loops again
      await vi.advanceTimersByTimeAsync(150);
      // Advance past second debounce
      await vi.advanceTimersByTimeAsync(150);
      await promise;

      // Only one handler call with the last message
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][1].text).toBe("Hey @slack-bot third");

      vi.useRealTimers();
    });
  });

  describe("concurrency: concurrent", () => {
    it("should process messages without acquiring a lock", async () => {
      const state = createMockState();
      const adapter = createMockAdapter("slack");

      const concurrentChat = new Chat({
        userName: "testbot",
        adapters: { slack: adapter },
        state,
        logger: mockLogger,
        concurrency: "concurrent",
      });

      await concurrentChat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );

      const handler = vi.fn().mockResolvedValue(undefined);
      concurrentChat.onNewMention(handler);

      // Pre-acquire lock — should NOT block concurrent strategy
      await state.acquireLock("slack:C123:1234.5678", 30000);

      const msg = createTestMessage("msg-c-1", "Hey @slack-bot concurrent");
      await concurrentChat.handleIncomingMessage(
        adapter,
        "slack:C123:1234.5678",
        msg
      );

      // Handler should be called even though lock was held
      expect(handler).toHaveBeenCalledTimes(1);
      // Lock methods should not have been called by concurrent strategy
      // (the pre-acquire above is manual)
    });

    it("should cap in-flight handlers at maxConcurrent per thread", async () => {
      const state = createMockState();
      const adapter = createMockAdapter("slack");

      const chat = new Chat({
        userName: "testbot",
        adapters: { slack: adapter },
        state,
        logger: mockLogger,
        concurrency: { strategy: "concurrent", maxConcurrent: 2 },
      });

      await chat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );

      let inFlight = 0;
      let peakInFlight = 0;
      const releases: Array<() => void> = [];

      chat.onNewMention(async () => {
        inFlight++;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        inFlight--;
      });

      const threadId = "slack:C123:1234.5678";
      const pending = Array.from({ length: 5 }, (_, i) =>
        chat.handleIncomingMessage(
          adapter,
          threadId,
          createTestMessage(`msg-mc-${i}`, "Hey @slack-bot")
        )
      );

      // Let the first wave of handlers start.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(inFlight).toBe(2);

      // Drain each slot one at a time and assert cap holds.
      while (releases.length > 0) {
        const release = releases.shift();
        release?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(inFlight).toBeLessThanOrEqual(2);
      }

      await Promise.all(pending);
      expect(peakInFlight).toBe(2);
    });

    it("should track slots per thread independently", async () => {
      const state = createMockState();
      const adapter = createMockAdapter("slack");

      const chat = new Chat({
        userName: "testbot",
        adapters: { slack: adapter },
        state,
        logger: mockLogger,
        concurrency: { strategy: "concurrent", maxConcurrent: 1 },
      });

      await chat.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );

      const releases: Array<() => void> = [];
      const handler = vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            releases.push(resolve);
          })
      );
      chat.onNewMention(handler);

      const pendingA = chat.handleIncomingMessage(
        adapter,
        "slack:C123:thread-A",
        createTestMessage("msg-a", "Hey @slack-bot")
      );
      const pendingB = chat.handleIncomingMessage(
        adapter,
        "slack:C123:thread-B",
        createTestMessage("msg-b", "Hey @slack-bot")
      );

      await new Promise((resolve) => setTimeout(resolve, 0));
      // Both threads dispatch immediately because they are independent.
      expect(handler).toHaveBeenCalledTimes(2);

      for (const release of releases) {
        release();
      }
      await Promise.all([pendingA, pendingB]);
    });

    it("should warn when maxConcurrent is set with a non-concurrent strategy", () => {
      const state = createMockState();
      const adapter = createMockAdapter("slack");

      new Chat({
        userName: "testbot",
        adapters: { slack: adapter },
        state,
        logger: mockLogger,
        concurrency: { strategy: "queue", maxConcurrent: 2 },
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("maxConcurrent has no effect when strategy is")
      );
    });

    it("should throw when maxConcurrent is less than 1", () => {
      const state = createMockState();
      const adapter = createMockAdapter("slack");

      expect(
        () =>
          new Chat({
            userName: "testbot",
            adapters: { slack: adapter },
            state,
            logger: mockLogger,
            concurrency: { strategy: "concurrent", maxConcurrent: 0 },
          })
      ).toThrow("maxConcurrent must be >= 1");
    });
  });

  describe("lockScope", () => {
    it("should use threadId as lock key with default (thread) scope", async () => {
      const state = createMockState();
      const adapter = createMockAdapter("slack");

      const chat2 = new Chat({
        userName: "testbot",
        adapters: { slack: adapter },
        state,
        logger: mockLogger,
      });

      await chat2.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );

      chat2.onNewMention(vi.fn().mockResolvedValue(undefined));

      const msg = createTestMessage("msg-ls-1", "Hey @slack-bot");
      await chat2.handleIncomingMessage(adapter, "slack:C123:1234.5678", msg);

      // Lock should have been acquired on the full threadId
      expect(state.acquireLock).toHaveBeenCalledWith(
        "slack:C123:1234.5678",
        expect.any(Number)
      );
    });

    it("should use channelId as lock key with channel scope on adapter", async () => {
      const state = createMockState();
      const adapter = createMockAdapter("telegram");
      (adapter as { lockScope: string }).lockScope = "channel";

      const chat2 = new Chat({
        userName: "testbot",
        adapters: { telegram: adapter },
        state,
        logger: mockLogger,
      });

      await chat2.webhooks.telegram(
        new Request("http://test.com", { method: "POST" })
      );

      chat2.onNewMention(vi.fn().mockResolvedValue(undefined));

      const msg = createTestMessage("msg-ls-2", "Hey @telegram-bot");
      await chat2.handleIncomingMessage(adapter, "telegram:C123:topic456", msg);

      // channelIdFromThreadId returns first two parts: "telegram:C123"
      expect(state.acquireLock).toHaveBeenCalledWith(
        "telegram:C123",
        expect.any(Number)
      );
    });

    it("should use channelId as lock key with channel scope on config", async () => {
      const state = createMockState();
      const adapter = createMockAdapter("slack");

      const chat2 = new Chat({
        userName: "testbot",
        adapters: { slack: adapter },
        state,
        logger: mockLogger,
        lockScope: "channel",
      });

      await chat2.webhooks.slack(
        new Request("http://test.com", { method: "POST" })
      );

      chat2.onNewMention(vi.fn().mockResolvedValue(undefined));

      const msg = createTestMessage("msg-ls-3", "Hey @slack-bot");
      await chat2.handleIncomingMessage(adapter, "slack:C123:1234.5678", msg);

      // channelIdFromThreadId returns "slack:C123"
      expect(state.acquireLock).toHaveBeenCalledWith(
        "slack:C123",
        expect.any(Number)
      );
    });

    it("should support async lockScope resolver function", async () => {
      const state = createMockState();
      const adapter = createMockAdapter("telegram");

      const chat2 = new Chat({
        userName: "testbot",
        adapters: { telegram: adapter },
        state,
        logger: mockLogger,
        lockScope: async ({ isDM }) => {
          // Simulate async lookup (e.g., checking channel config in DB)
          return isDM ? "thread" : "channel";
        },
      });

      await chat2.webhooks.telegram(
        new Request("http://test.com", { method: "POST" })
      );

      chat2.onNewMention(vi.fn().mockResolvedValue(undefined));

      // Non-DM: should use channel scope
      const msg = createTestMessage("msg-ls-4", "Hey @telegram-bot");
      await chat2.handleIncomingMessage(adapter, "telegram:C123:topic456", msg);

      expect(state.acquireLock).toHaveBeenCalledWith(
        "telegram:C123",
        expect.any(Number)
      );
    });

    it("should queue on channel-scoped lock key", async () => {
      const state = createMockState();
      const adapter = createMockAdapter("telegram");
      (adapter as { lockScope: string }).lockScope = "channel";

      const chat2 = new Chat({
        userName: "testbot",
        adapters: { telegram: adapter },
        state,
        logger: mockLogger,
        concurrency: "queue",
      });

      await chat2.webhooks.telegram(
        new Request("http://test.com", { method: "POST" })
      );

      chat2.onNewMention(vi.fn().mockResolvedValue(undefined));

      // Pre-hold the channel lock to force the second message to enqueue
      await state.acquireLock("telegram:C123", 30000);

      // Both messages from different topics should use the channel lock key
      const msg1 = createTestMessage("msg-ls-5", "Hey @telegram-bot first");
      await chat2.handleIncomingMessage(adapter, "telegram:C123:topic1", msg1);

      const msg2 = createTestMessage("msg-ls-6", "Hey @telegram-bot second");
      await chat2.handleIncomingMessage(adapter, "telegram:C123:topic2", msg2);

      // Both should have been enqueued on the channel key (not topic keys)
      const enqueueCalls = state.enqueue.mock.calls;
      expect(enqueueCalls.length).toBe(2);
      for (const call of enqueueCalls) {
        expect(call[0]).toBe("telegram:C123");
      }
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
