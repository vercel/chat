/**
 * Replay tests for Slack fetchMessages functionality.
 *
 * These tests use actual recorded API responses to verify message fetching
 * works correctly. Messages are numbered 1-14 to verify correct chronological ordering.
 */

import { createMemoryState } from "@chat-adapter/state-memory";
import { ThreadImpl } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXPECTED_NUMBERED_TEXTS,
  SLACK_BOT_USER_ID,
  SLACK_CHANNEL,
  SLACK_HUMAN_USER_ID,
  SLACK_RAW_MESSAGES,
  SLACK_THREAD_ID,
  SLACK_THREAD_TS,
} from "./fixtures/replay/fetch-messages";
import {
  createSlackTestContext,
  type SlackTestContext,
} from "./replay-test-utils";

describe("fetchMessages Replay Tests - Slack", () => {
  let ctx: SlackTestContext;

  beforeEach(() => {
    vi.clearAllMocks();

    ctx = createSlackTestContext(
      { botName: "Chat SDK Bot", botUserId: SLACK_BOT_USER_ID },
      {},
    );

    // Mock conversations.replies to return actual recorded messages
    ctx.mockClient.conversations.replies.mockImplementation(
      async (params: {
        channel: string;
        ts: string;
        limit?: number;
        oldest?: string;
        latest?: string;
      }) => {
        let messages = [...SLACK_RAW_MESSAGES];
        const limit = params.limit || 100;

        // Handle oldest/latest filtering for pagination
        if (params.oldest) {
          const oldest = params.oldest;
          messages = messages.filter(
            (m) => Number.parseFloat(m.ts) > Number.parseFloat(oldest),
          );
        }
        if (params.latest) {
          const latest = params.latest;
          messages = messages.filter(
            (m) => Number.parseFloat(m.ts) < Number.parseFloat(latest),
          );
        }

        const sliced = messages.slice(0, limit);
        const hasMore = messages.length > limit;

        return {
          ok: true,
          messages: sliced,
          has_more: hasMore,
          response_metadata: hasMore
            ? { next_cursor: "next-cursor" }
            : undefined,
        };
      },
    );

    // Mock users.info for display name lookup
    ctx.mockClient.users.info.mockImplementation(
      async (params: { user: string }) => {
        const users: Record<
          string,
          { name: string; real_name: string; is_bot?: boolean }
        > = {
          [SLACK_HUMAN_USER_ID]: { name: "malteubl", real_name: "Malte Ubl" },
          [SLACK_BOT_USER_ID]: {
            name: "chatsdkbot",
            real_name: "Chat SDK Bot",
            is_bot: true,
          },
        };
        const user = users[params.user];
        return {
          ok: true,
          user: user ? { id: params.user, ...user } : undefined,
        };
      },
    );
  });

  afterEach(async () => {
    await ctx.chat.shutdown();
  });

  it("should call API with correct params for forward direction", async () => {
    await ctx.adapter.fetchMessages(SLACK_THREAD_ID, {
      limit: 25,
      direction: "forward",
    });

    // Forward direction: uses requested limit, native cursor pagination
    expect(ctx.mockClient.conversations.replies).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: SLACK_CHANNEL,
        ts: SLACK_THREAD_TS,
        limit: 25,
        cursor: undefined,
      }),
    );
  });

  it("should call API with correct params for backward direction", async () => {
    await ctx.adapter.fetchMessages(SLACK_THREAD_ID, {
      limit: 50,
      direction: "backward",
    });

    // Backward direction: uses larger batch size min(1000, max(limit*2, 200))
    // For limit=50: min(1000, max(100, 200)) = 200
    expect(ctx.mockClient.conversations.replies).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: SLACK_CHANNEL,
        ts: SLACK_THREAD_TS,
        limit: 200,
        latest: undefined,
        inclusive: false,
      }),
    );
  });

  it("should return all messages in chronological order", async () => {
    const result = await ctx.adapter.fetchMessages(SLACK_THREAD_ID, {
      limit: 100,
      direction: "forward",
    });

    // Should have all 19 messages
    expect(result.messages).toHaveLength(19);

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
    const result = await ctx.adapter.fetchMessages(SLACK_THREAD_ID, {
      limit: 100,
      direction: "backward",
    });

    expect(result.messages).toHaveLength(19);

    // Extract numbered messages and verify order
    const numberedMessages = result.messages.filter((m) =>
      EXPECTED_NUMBERED_TEXTS.includes(m.text || ""),
    );
    const texts = numberedMessages.map((m) => m.text);
    expect(texts).toEqual(EXPECTED_NUMBERED_TEXTS);
  });

  it("should correctly identify bot vs human messages", async () => {
    const result = await ctx.adapter.fetchMessages(SLACK_THREAD_ID, {
      limit: 100,
    });

    const botMessages = result.messages.filter((m) => m.author.isBot);
    const humanMessages = result.messages.filter((m) => !m.author.isBot);

    // 4 bot messages (Welcome, Fetch Results, 2x Thanks)
    expect(botMessages).toHaveLength(4);
    // 15 human messages (Hey + 14 numbered)
    expect(humanMessages).toHaveLength(15);

    // All bot messages should have isMe: true
    for (const msg of botMessages) {
      expect(msg.author.isMe).toBe(true);
      expect(msg.author.userId).toBe(SLACK_BOT_USER_ID);
    }

    // All human messages should have isMe: false
    for (const msg of humanMessages) {
      expect(msg.author.isMe).toBe(false);
      expect(msg.author.userId).toBe(SLACK_HUMAN_USER_ID);
    }
  });

  it("should resolve user display names", async () => {
    const result = await ctx.adapter.fetchMessages(SLACK_THREAD_ID, {
      limit: 100,
    });

    // Human messages should have resolved display names
    const humanMessage = result.messages.find(
      (m) => m.author.userId === SLACK_HUMAN_USER_ID,
    );
    expect(humanMessage?.author.userName).toBe("Malte Ubl");
    expect(humanMessage?.author.fullName).toBe("Malte Ubl");

    // Bot messages should have bot name
    const botMessage = result.messages.find(
      (m) => m.author.userId === SLACK_BOT_USER_ID,
    );
    expect(botMessage?.author.userName).toBe("Chat SDK Bot");
  });

  it("should respect limit parameter", async () => {
    const result = await ctx.adapter.fetchMessages(SLACK_THREAD_ID, {
      limit: 5,
      direction: "forward",
    });

    expect(result.messages).toHaveLength(5);

    // First 5 messages: Hey, Welcome, Fetch Results, "1", "2"
    expect(result.messages[0].text).toContain("Hey");
    expect(result.messages[3].text).toBe("1");
    expect(result.messages[4].text).toBe("2");
  });
});

describe("allMessages Replay Tests - Slack", () => {
  let ctx: SlackTestContext;

  beforeEach(() => {
    vi.clearAllMocks();

    ctx = createSlackTestContext(
      { botName: "Chat SDK Bot", botUserId: SLACK_BOT_USER_ID },
      {},
    );

    // Mock conversations.replies to return actual recorded messages
    ctx.mockClient.conversations.replies.mockImplementation(
      async (params: {
        channel: string;
        ts: string;
        limit?: number;
        oldest?: string;
        latest?: string;
      }) => {
        let messages = [...SLACK_RAW_MESSAGES];
        const limit = params.limit || 100;

        if (params.oldest) {
          const oldest = params.oldest;
          messages = messages.filter(
            (m) => Number.parseFloat(m.ts) > Number.parseFloat(oldest),
          );
        }
        if (params.latest) {
          const latest = params.latest;
          messages = messages.filter(
            (m) => Number.parseFloat(m.ts) < Number.parseFloat(latest),
          );
        }

        const sliced = messages.slice(0, limit);
        const hasMore = messages.length > limit;

        return {
          ok: true,
          messages: sliced,
          has_more: hasMore,
          response_metadata: hasMore
            ? { next_cursor: "next-cursor" }
            : undefined,
        };
      },
    );

    // Mock users.info
    ctx.mockClient.users.info.mockImplementation(
      async (params: { user: string }) => {
        const users: Record<
          string,
          { name: string; real_name: string; is_bot?: boolean }
        > = {
          [SLACK_HUMAN_USER_ID]: { name: "malteubl", real_name: "Malte Ubl" },
          [SLACK_BOT_USER_ID]: {
            name: "chatsdkbot",
            real_name: "Chat SDK Bot",
            is_bot: true,
          },
        };
        const user = users[params.user];
        return {
          ok: true,
          user: user ? { id: params.user, ...user } : undefined,
        };
      },
    );
  });

  afterEach(async () => {
    await ctx.chat.shutdown();
  });

  it("should iterate all messages in chronological order via thread.allMessages", async () => {
    const stateAdapter = createMemoryState();
    const thread = new ThreadImpl({
      id: SLACK_THREAD_ID,
      adapter: ctx.adapter,
      channelId: SLACK_CHANNEL,
      stateAdapter,
    });

    // Collect all messages from the async iterator
    const messages = [];
    for await (const msg of thread.allMessages) {
      messages.push(msg);
    }

    // Should have all 19 messages
    expect(messages).toHaveLength(19);

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
      id: SLACK_THREAD_ID,
      adapter: ctx.adapter,
      channelId: SLACK_CHANNEL,
      stateAdapter,
    });

    // Consume the iterator
    for await (const _ of thread.allMessages) {
      // Just iterate
    }

    // allMessages uses forward direction with limit 100
    expect(ctx.mockClient.conversations.replies).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: SLACK_CHANNEL,
        ts: SLACK_THREAD_TS,
        limit: 100,
        cursor: undefined,
      }),
    );
  });
});
