const NO_THREAD_HISTORY_CACHE_RE = /no ThreadHistoryCache/;

import { beforeEach, describe, expect, it, type Mock, type vi } from "vitest";

import {
  createMockAdapter,
  createMockState,
  createTestMessage,
} from "../mock-adapter";
import { ThreadHistoryCache } from "../thread-history";
import type { Adapter } from "../types";
import { ThreadHistoryApiImpl } from "./thread";

describe("ThreadHistoryApiImpl", () => {
  let mockAdapter: Adapter;
  let cache: ThreadHistoryCache;
  let api: ThreadHistoryApiImpl;

  beforeEach(() => {
    mockAdapter = createMockAdapter("slack");
    cache = new ThreadHistoryCache(createMockState());
    api = new ThreadHistoryApiImpl(
      (name) => (name === "slack" ? mockAdapter : undefined),
      cache
    );
  });

  it("list delegates to adapter.fetchMessages when messages exist", async () => {
    const msg = createTestMessage("m1", "hello");
    (mockAdapter.fetchMessages as Mock).mockResolvedValue({
      messages: [msg],
      nextCursor: "cursor-1",
    });

    const result = await api.list("slack:C123:1234.5678", { limit: 10 });

    expect(mockAdapter.fetchMessages).toHaveBeenCalledWith(
      "slack:C123:1234.5678",
      { limit: 10 }
    );
    expect(result.messages).toEqual([msg]);
    expect(result.nextCursor).toBe("cursor-1");
  });

  it("list falls back to cache when adapter returns no messages", async () => {
    (mockAdapter.fetchMessages as Mock).mockResolvedValue({
      messages: [],
    });

    const cached = createTestMessage("c1", "cached");
    await cache.append("slack:C123:1234.5678", cached);

    const result = await api.list("slack:C123:1234.5678", { limit: 5 });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.text).toBe("cached");
  });

  it("collect yields adapter messages when available", async () => {
    const m1 = createTestMessage("m1", "one");
    const m2 = createTestMessage("m2", "two");
    (mockAdapter.fetchMessages as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ messages: [m1], nextCursor: "c2" })
      .mockResolvedValueOnce({ messages: [m2] });

    const collected: string[] = [];
    for await (const msg of api.collect("slack:C123:1234.5678")) {
      collected.push(msg.text);
    }

    expect(collected).toEqual(["one", "two"]);
  });

  it("collect falls back to cache when adapter returns nothing", async () => {
    (mockAdapter.fetchMessages as Mock).mockResolvedValue({
      messages: [],
    });

    const cached = createTestMessage("c1", "from cache");
    await cache.append("slack:C123:1234.5678", cached);

    const collected: string[] = [];
    for await (const msg of api.collect("slack:C123:1234.5678")) {
      collected.push(msg.text);
    }

    expect(collected).toEqual(["from cache"]);
  });

  it("append writes to the thread history cache", async () => {
    const msg = createTestMessage("m1", "stored");
    await api.append("slack:C123:1234.5678", msg);

    const stored = await cache.getMessages("slack:C123:1234.5678");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.text).toBe("stored");
  });

  it("append throws when no cache was provided", async () => {
    const noCacheApi = new ThreadHistoryApiImpl((name) =>
      name === "slack" ? mockAdapter : undefined
    );
    const msg = createTestMessage("m1", "x");

    await expect(
      noCacheApi.append("slack:C123:1234.5678", msg)
    ).rejects.toThrow(NO_THREAD_HISTORY_CACHE_RE);
  });
});
