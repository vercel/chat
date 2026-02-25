/**
 * Replay tests for Google Chat fetchMessages functionality.
 *
 * These tests use actual recorded API responses to verify message fetching
 * works correctly. Messages are numbered 1-14 to verify correct chronological ordering.
 */

import { createMemoryState } from "@chat-adapter/state-memory";
import { type Message, ThreadImpl } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXPECTED_NUMBERED_TEXTS,
  GCHAT_BOT_USER_ID,
  GCHAT_HUMAN_USER_ID,
  GCHAT_RAW_MESSAGES,
  GCHAT_SPACE,
  GCHAT_THREAD,
  GCHAT_THREAD_ID,
} from "./fixtures/replay/fetch-messages";
import {
  createGchatTestContext,
  type GchatTestContext,
} from "./replay-test-utils";

describe("fetchMessages Replay Tests - Google Chat", () => {
  let ctx: GchatTestContext;

  beforeEach(() => {
    vi.clearAllMocks();

    ctx = createGchatTestContext(
      { botName: "Chat SDK Demo", botUserId: GCHAT_BOT_USER_ID },
      {}
    );

    // Mock messages.list to return actual recorded messages
    (
      ctx.mockChatApi.spaces.messages.list as ReturnType<typeof vi.fn>
    ).mockImplementation(
      (params: {
        parent: string;
        pageSize?: number;
        pageToken?: string;
        orderBy?: string;
      }) => {
        const isDescending = params.orderBy === "createTime desc";
        // Return messages in the order requested by API
        const messages = isDescending
          ? [...GCHAT_RAW_MESSAGES].reverse()
          : [...GCHAT_RAW_MESSAGES];

        const limit = params.pageSize || 50;
        const sliced = messages.slice(0, limit);

        return {
          data: {
            messages: sliced,
            nextPageToken:
              messages.length > limit ? "next-page-token" : undefined,
          },
        };
      }
    );
  });

  afterEach(async () => {
    await ctx.chat.shutdown();
  });

  it("should call API with correct params for forward direction", async () => {
    await ctx.adapter.fetchMessages(GCHAT_THREAD_ID, {
      limit: 25,
      direction: "forward",
    });

    // Forward direction: fetches all messages (pageSize: 1000 for efficiency)
    // No orderBy = defaults to createTime ASC (oldest first)
    expect(ctx.mockChatApi.spaces.messages.list).toHaveBeenCalledWith({
      parent: GCHAT_SPACE,
      pageSize: 1000,
      pageToken: undefined,
      filter: `thread.name = "${GCHAT_THREAD}"`,
    });
  });

  it("should call API with correct params for backward direction", async () => {
    await ctx.adapter.fetchMessages(GCHAT_THREAD_ID, {
      limit: 50,
      direction: "backward",
    });

    // Backward direction: respects limit, uses descending order
    expect(ctx.mockChatApi.spaces.messages.list).toHaveBeenCalledWith({
      parent: GCHAT_SPACE,
      pageSize: 50,
      pageToken: undefined,
      filter: `thread.name = "${GCHAT_THREAD}"`,
      orderBy: "createTime desc",
    });
  });

  it("should return all messages in chronological order", async () => {
    const result = await ctx.adapter.fetchMessages(GCHAT_THREAD_ID, {
      limit: 100,
      direction: "forward",
    });

    // Should have all 19 messages (4 bot + 15 human messages)
    expect(result.messages).toHaveLength(19);

    // Extract just the numbered messages (filter out bot messages)
    const numberedMessages = result.messages.filter(
      (m) => !m.author.isBot && EXPECTED_NUMBERED_TEXTS.includes(m.text || "")
    );

    // Should have exactly 14 numbered messages
    expect(numberedMessages).toHaveLength(14);

    // Verify they are in correct chronological order (1, 2, 3, ... 14)
    const texts = numberedMessages.map((m) => m.text);
    expect(texts).toEqual(EXPECTED_NUMBERED_TEXTS);
  });

  it("should return messages in chronological order with backward direction", async () => {
    const result = await ctx.adapter.fetchMessages(GCHAT_THREAD_ID, {
      limit: 100,
      direction: "backward",
    });

    // Backward still returns in chronological order (oldest to newest within the page)
    expect(result.messages).toHaveLength(19);

    // Extract numbered messages and verify order
    const numberedMessages = result.messages.filter(
      (m) => !m.author.isBot && EXPECTED_NUMBERED_TEXTS.includes(m.text || "")
    );
    const texts = numberedMessages.map((m) => m.text);
    expect(texts).toEqual(EXPECTED_NUMBERED_TEXTS);
  });

  it("should correctly identify bot vs human messages", async () => {
    const result = await ctx.adapter.fetchMessages(GCHAT_THREAD_ID, {
      limit: 100,
    });

    const botMessages = result.messages.filter((m) => m.author.isBot);
    const humanMessages = result.messages.filter((m) => !m.author.isBot);

    // 4 bot messages total (2 welcome cards + 2 "Thanks")
    expect(botMessages).toHaveLength(4);
    // 14 numbered human messages + 1 "Hey" = 15
    expect(humanMessages).toHaveLength(15);

    // All bot messages should have isMe: true
    for (const msg of botMessages) {
      expect(msg.author.isMe).toBe(true);
      expect(msg.author.userId).toBe(GCHAT_BOT_USER_ID);
    }

    // All human messages should have isMe: false
    for (const msg of humanMessages) {
      expect(msg.author.isMe).toBe(false);
      expect(msg.author.userId).toBe(GCHAT_HUMAN_USER_ID);
    }
  });

  it("should handle card-only messages with empty text", async () => {
    const result = await ctx.adapter.fetchMessages(GCHAT_THREAD_ID, {
      limit: 100,
    });

    // Find messages that have cardsV2 but no text
    const cardOnlyMessages = result.messages.filter(
      (m) =>
        (m.raw as { cardsV2?: unknown[] }).cardsV2 && (!m.text || m.text === "")
    );

    // Should have 2 card-only messages (welcome card + fetch results card)
    expect(cardOnlyMessages).toHaveLength(2);

    // Both should be from the bot
    for (const msg of cardOnlyMessages) {
      expect(msg.author.isBot).toBe(true);
      expect(msg.author.isMe).toBe(true);
    }
  });

  it("should respect limit parameter", async () => {
    const result = await ctx.adapter.fetchMessages(GCHAT_THREAD_ID, {
      limit: 5,
      direction: "forward",
    });

    expect(result.messages).toHaveLength(5);

    // First 5 messages should be: Hey, bot card 1, bot card 2, "1", "2"
    expect(result.messages[0].text).toBe("@Chat SDK Demo Hey");
    expect(result.messages[3].text).toBe("1");
    expect(result.messages[4].text).toBe("2");
  });
});

describe("allMessages Replay Tests - Google Chat", () => {
  let ctx: GchatTestContext;

  beforeEach(() => {
    vi.clearAllMocks();

    ctx = createGchatTestContext(
      { botName: "Chat SDK Demo", botUserId: GCHAT_BOT_USER_ID },
      {}
    );

    // Mock messages.list to return actual recorded messages
    (
      ctx.mockChatApi.spaces.messages.list as ReturnType<typeof vi.fn>
    ).mockImplementation(
      (params: {
        parent: string;
        pageSize?: number;
        pageToken?: string;
        orderBy?: string;
      }) => {
        const isDescending = params.orderBy === "createTime desc";
        const messages = isDescending
          ? [...GCHAT_RAW_MESSAGES].reverse()
          : [...GCHAT_RAW_MESSAGES];

        const limit = params.pageSize || 50;
        const sliced = messages.slice(0, limit);

        return {
          data: {
            messages: sliced,
            nextPageToken:
              messages.length > limit ? "next-page-token" : undefined,
          },
        };
      }
    );
  });

  afterEach(async () => {
    await ctx.chat.shutdown();
  });

  it("should iterate all messages in chronological order via thread.allMessages", async () => {
    // Create a Thread using ThreadImpl with the mocked adapter
    const stateAdapter = createMemoryState();
    const thread = new ThreadImpl({
      id: GCHAT_THREAD_ID,
      adapter: ctx.adapter,
      channelId: GCHAT_SPACE,
      stateAdapter,
    });

    // Collect all messages from the async iterator
    const messages: Message[] = [];
    for await (const msg of thread.allMessages) {
      messages.push(msg);
    }

    // Should have all 19 messages
    expect(messages).toHaveLength(19);

    // Extract numbered messages and verify chronological order
    const numberedMessages = messages.filter((m) =>
      EXPECTED_NUMBERED_TEXTS.includes(m.text || "")
    );
    expect(numberedMessages).toHaveLength(14);

    const texts = numberedMessages.map((m) => m.text);
    expect(texts).toEqual(EXPECTED_NUMBERED_TEXTS);
  });

  it("should call fetchMessages with forward direction and limit 100", async () => {
    const stateAdapter = createMemoryState();
    const thread = new ThreadImpl({
      id: GCHAT_THREAD_ID,
      adapter: ctx.adapter,
      channelId: GCHAT_SPACE,
      stateAdapter,
    });

    // Consume the iterator
    for await (const _ of thread.allMessages) {
      // Just iterate
    }

    // allMessages uses forward direction with limit 100 internally
    // GChat forward fetches with pageSize 1000 (max efficiency)
    expect(ctx.mockChatApi.spaces.messages.list).toHaveBeenCalledWith({
      parent: GCHAT_SPACE,
      pageSize: 1000,
      pageToken: undefined,
      filter: `thread.name = "${GCHAT_THREAD}"`,
    });
  });
});
