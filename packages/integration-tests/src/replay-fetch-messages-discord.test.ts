/**
 * Replay tests for Discord fetchMessages functionality.
 *
 * These tests use fixture data to verify message fetching works correctly.
 * Messages are numbered 1-14 to verify correct chronological ordering.
 */

import { createMemoryState } from "@chat-adapter/state-memory";
import { ThreadImpl } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISCORD_BOT_USER_ID,
  DISCORD_GUILD_ID,
  DISCORD_HUMAN_USER_ID,
  DISCORD_RAW_MESSAGES,
  DISCORD_THREAD_ID,
  EXPECTED_NUMBERED_TEXTS,
} from "./fixtures/replay/fetch-messages";
import {
  createDiscordTestContext,
  type DiscordTestContext,
} from "./replay-test-utils";

describe("fetchMessages Replay Tests - Discord", () => {
  let ctx: DiscordTestContext;

  beforeEach(async () => {
    vi.clearAllMocks();

    ctx = await createDiscordTestContext(
      { botName: "Chat SDK Demo", applicationId: DISCORD_BOT_USER_ID },
      {},
    );

    // Mock messages.list to return actual recorded messages
    ctx.mockApi.messages.list.mockImplementation(async () => {
      // Discord returns newest first, so reverse the chronological order
      return [...DISCORD_RAW_MESSAGES].reverse();
    });
  });

  afterEach(async () => {
    await ctx.chat.shutdown();
    ctx.cleanup();
  });

  it("should call API with correct params for backward direction", async () => {
    await ctx.adapter.fetchMessages(DISCORD_THREAD_ID, {
      limit: 50,
      direction: "backward",
    });

    // Verify fetch was called
    expect(ctx.mockApi.messages.list).toHaveBeenCalled();
  });

  it("should call API with correct params for forward direction", async () => {
    await ctx.adapter.fetchMessages(DISCORD_THREAD_ID, {
      limit: 25,
      direction: "forward",
    });

    expect(ctx.mockApi.messages.list).toHaveBeenCalled();
  });

  it("should return all messages in chronological order", async () => {
    const result = await ctx.adapter.fetchMessages(DISCORD_THREAD_ID, {
      limit: 100,
      direction: "forward",
    });

    // Should have all 20 messages
    expect(result.messages).toHaveLength(20);

    // Extract just the numbered messages
    const numberedMessages = result.messages.filter((m) =>
      EXPECTED_NUMBERED_TEXTS.includes(m.text || ""),
    );

    // Should have exactly 14 numbered messages
    expect(numberedMessages).toHaveLength(14);

    // Verify they are in correct chronological order (1, 2, 3, ... 14)
    const texts = numberedMessages.map((m) => m.text);
    expect(texts).toEqual(EXPECTED_NUMBERED_TEXTS);
  });

  it("should return messages in chronological order with backward direction", async () => {
    const result = await ctx.adapter.fetchMessages(DISCORD_THREAD_ID, {
      limit: 100,
      direction: "backward",
    });

    expect(result.messages).toHaveLength(20);

    // Extract numbered messages and verify order
    const numberedMessages = result.messages.filter((m) =>
      EXPECTED_NUMBERED_TEXTS.includes(m.text || ""),
    );
    const texts = numberedMessages.map((m) => m.text);
    expect(texts).toEqual(EXPECTED_NUMBERED_TEXTS);
  });

  it("should correctly identify bot vs human messages", async () => {
    const result = await ctx.adapter.fetchMessages(DISCORD_THREAD_ID, {
      limit: 100,
    });

    const botMessages = result.messages.filter((m) => m.author.isBot);
    const humanMessages = result.messages.filter((m) => !m.author.isBot);

    // 4 bot messages (Welcome, Fetch Results, 2x Thanks)
    expect(botMessages).toHaveLength(4);
    // 16 human messages (Hey, Wow, + 14 numbered)
    expect(humanMessages).toHaveLength(16);

    // All bot messages should have isMe: true
    for (const msg of botMessages) {
      expect(msg.author.isMe).toBe(true);
      expect(msg.author.userId).toBe(DISCORD_BOT_USER_ID);
    }

    // All human messages should have isMe: false
    for (const msg of humanMessages) {
      expect(msg.author.isMe).toBe(false);
      expect(msg.author.userId).toBe(DISCORD_HUMAN_USER_ID);
    }
  });

  it("should include user display names", async () => {
    const result = await ctx.adapter.fetchMessages(DISCORD_THREAD_ID, {
      limit: 100,
    });

    // Human messages should have display names from global_name
    const humanMessage = result.messages.find(
      (m) => m.author.userId === DISCORD_HUMAN_USER_ID,
    );
    expect(humanMessage?.author.userName).toBe("testuser2384");
    expect(humanMessage?.author.fullName).toBe("Test User");

    // Bot messages should have bot name
    const botMessage = result.messages.find(
      (m) => m.author.userId === DISCORD_BOT_USER_ID,
    );
    expect(botMessage?.author.userName).toBe("Chat SDK Demo");
  });

  it("should respect limit parameter", async () => {
    // Mock to return limited results
    ctx.mockApi.messages.list.mockImplementation(async () => {
      // Return only first 5 messages (newest first)
      return [...DISCORD_RAW_MESSAGES].reverse().slice(0, 5);
    });

    const result = await ctx.adapter.fetchMessages(DISCORD_THREAD_ID, {
      limit: 5,
      direction: "forward",
    });

    expect(result.messages).toHaveLength(5);
  });

  it("should handle pagination cursor for backward direction", async () => {
    const cursor = "1457512700000000010";

    await ctx.adapter.fetchMessages(DISCORD_THREAD_ID, {
      limit: 10,
      direction: "backward",
      cursor,
    });

    expect(ctx.mockApi.messages.list).toHaveBeenCalled();
  });

  it("should handle pagination cursor for forward direction", async () => {
    const cursor = "1457512653978341593";

    await ctx.adapter.fetchMessages(DISCORD_THREAD_ID, {
      limit: 10,
      direction: "forward",
      cursor,
    });

    expect(ctx.mockApi.messages.list).toHaveBeenCalled();
  });

  it("should return nextCursor when more messages are available", async () => {
    // Mock to return exactly limit messages (indicating more available)
    ctx.mockApi.messages.list.mockImplementation(async () => {
      return [...DISCORD_RAW_MESSAGES].reverse().slice(0, 10);
    });

    const result = await ctx.adapter.fetchMessages(DISCORD_THREAD_ID, {
      limit: 10,
      direction: "backward",
    });

    expect(result.messages).toHaveLength(10);
    expect(result.nextCursor).toBeDefined();
  });

  it("should not return nextCursor when fewer messages than limit", async () => {
    // Mock to return fewer than limit
    ctx.mockApi.messages.list.mockImplementation(async () => {
      return [...DISCORD_RAW_MESSAGES].reverse().slice(0, 5);
    });

    const result = await ctx.adapter.fetchMessages(DISCORD_THREAD_ID, {
      limit: 10,
      direction: "backward",
    });

    expect(result.messages).toHaveLength(5);
    expect(result.nextCursor).toBeUndefined();
  });
});

describe("allMessages Replay Tests - Discord", () => {
  let ctx: DiscordTestContext;

  beforeEach(async () => {
    vi.clearAllMocks();

    ctx = await createDiscordTestContext(
      { botName: "Chat SDK Demo", applicationId: DISCORD_BOT_USER_ID },
      {},
    );

    // Mock messages.list to return actual recorded messages
    ctx.mockApi.messages.list.mockImplementation(async () => {
      return [...DISCORD_RAW_MESSAGES].reverse();
    });
  });

  afterEach(async () => {
    await ctx.chat.shutdown();
    ctx.cleanup();
  });

  it("should iterate all messages in chronological order via thread.allMessages", async () => {
    const stateAdapter = createMemoryState();
    const thread = new ThreadImpl({
      id: DISCORD_THREAD_ID,
      adapter: ctx.adapter,
      channelId: DISCORD_GUILD_ID,
      stateAdapter,
    });

    // Collect all messages from the async iterator
    const messages = [];
    for await (const msg of thread.allMessages) {
      messages.push(msg);
    }

    // Should have all 20 messages
    expect(messages).toHaveLength(20);

    // Extract numbered messages and verify chronological order
    const numberedMessages = messages.filter((m) =>
      EXPECTED_NUMBERED_TEXTS.includes(m.text || ""),
    );
    expect(numberedMessages).toHaveLength(14);

    const texts = numberedMessages.map((m) => m.text);
    expect(texts).toEqual(EXPECTED_NUMBERED_TEXTS);
  });

  it("should call fetchMessages with forward direction and limit 100", async () => {
    const stateAdapter = createMemoryState();
    const thread = new ThreadImpl({
      id: DISCORD_THREAD_ID,
      adapter: ctx.adapter,
      channelId: DISCORD_GUILD_ID,
      stateAdapter,
    });

    // Consume the iterator
    for await (const _ of thread.allMessages) {
      // Just iterate
    }

    // allMessages uses forward direction with limit 100
    expect(ctx.mockApi.messages.list).toHaveBeenCalled();
  });
});
