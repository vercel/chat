const LIST_THREADS_UNSUPPORTED_RE = /does not implement listThreads/;

import { beforeEach, describe, expect, it, type Mock, type vi } from "vitest";

import { createMockAdapter, createTestMessage } from "../mock-adapter";
import type { Adapter } from "../types";
import { ChannelHistoryApiImpl } from "./channel";

describe("ChannelHistoryApiImpl", () => {
  let mockAdapter: Adapter;
  let api: ChannelHistoryApiImpl;

  beforeEach(() => {
    mockAdapter = createMockAdapter("slack");
    api = new ChannelHistoryApiImpl((name) =>
      name === "slack" ? mockAdapter : undefined
    );
  });

  it("listMessages uses fetchChannelMessages when available", async () => {
    const msg = createTestMessage("m1", "channel msg");
    (mockAdapter.fetchChannelMessages as Mock).mockResolvedValue({
      messages: [msg],
      nextCursor: "next",
    });

    const result = await api.listMessages("slack:C123", { limit: 10 });

    expect(mockAdapter.fetchChannelMessages).toHaveBeenCalledWith(
      "slack:C123",
      {
        limit: 10,
      }
    );
    expect(result.messages).toEqual([msg]);
  });

  it("listMessages falls back to fetchMessages when fetchChannelMessages is absent", async () => {
    mockAdapter.fetchChannelMessages = undefined;
    const msg = createTestMessage("m1", "fallback");
    (mockAdapter.fetchMessages as Mock).mockResolvedValue({
      messages: [msg],
    });

    const result = await api.listMessages("slack:C123");

    expect(mockAdapter.fetchMessages).toHaveBeenCalledWith(
      "slack:C123",
      undefined
    );
    expect(result.messages).toEqual([msg]);
  });

  it("listThreads delegates to adapter.listThreads", async () => {
    const root = createTestMessage("root", "thread root");
    (mockAdapter.listThreads as Mock).mockResolvedValue({
      threads: [
        {
          id: "slack:C123:1111.2222",
          rootMessage: root,
          replyCount: 3,
        },
      ],
      nextCursor: "t-cursor",
    });

    const result = await api.listThreads("slack:C123", { limit: 5 });

    expect(mockAdapter.listThreads).toHaveBeenCalledWith("slack:C123", {
      limit: 5,
    });
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0]?.id).toBe("slack:C123:1111.2222");
    expect(result.nextCursor).toBe("t-cursor");
  });

  it("listThreads throws when adapter does not implement listThreads", async () => {
    mockAdapter.listThreads = undefined;

    await expect(api.listThreads("slack:C123")).rejects.toThrow(
      LIST_THREADS_UNSUPPORTED_RE
    );
  });

  it("listThreadsWithMessages fetches messages for each thread", async () => {
    const root = createTestMessage("root", "root text");
    (mockAdapter.listThreads as Mock).mockResolvedValue({
      threads: [
        { id: "slack:C123:1111.2222", rootMessage: root },
        { id: "slack:C123:3333.4444", rootMessage: root },
      ],
    });
    (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>).mockImplementation(
      async (threadId: string) => ({
        messages: [createTestMessage(`${threadId}-r`, `reply for ${threadId}`)],
      })
    );

    const result = await api.listThreadsWithMessages("slack:C123", {
      maxThreads: 2,
      messagesPerThread: 1,
    });

    expect(result.threads).toHaveLength(2);
    expect(result.threads[0]?.threadId).toBe("slack:C123:1111.2222");
    expect(result.threads[0]?.messages[0]?.text).toContain("1111.2222");
  });
});
