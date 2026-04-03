import { beforeEach, describe, expect, it } from "vitest";

import { MessageHistoryCache } from "./message-history";
import type { MockStateAdapter } from "./mock-adapter";
import { createMockState, createTestMessage } from "./mock-adapter";

describe("MessageHistoryCache", () => {
  let state: MockStateAdapter;
  let cache: MessageHistoryCache;

  beforeEach(() => {
    state = createMockState();
    cache = new MessageHistoryCache(state);
  });

  it("should append and retrieve messages", async () => {
    const msg1 = createTestMessage("m1", "Hello");
    const msg2 = createTestMessage("m2", "World");

    await cache.append("thread-1", msg1);
    await cache.append("thread-1", msg2);

    const messages = await cache.getMessages("thread-1");
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe("m1");
    expect(messages[0].text).toBe("Hello");
    expect(messages[1].id).toBe("m2");
    expect(messages[1].text).toBe("World");
  });

  it("should use appendToList for atomic appends", async () => {
    const msg = createTestMessage("m1", "Hello");

    await cache.append("thread-1", msg);

    expect(state.appendToList).toHaveBeenCalledTimes(1);
    expect(state.appendToList).toHaveBeenCalledWith(
      "msg-history:thread-1",
      expect.objectContaining({ id: "m1" }),
      { maxLength: 100, ttlMs: 7 * 24 * 60 * 60 * 1000 }
    );
  });

  it("should trim to maxMessages, keeping newest", async () => {
    const smallCache = new MessageHistoryCache(state, { maxMessages: 3 });

    for (let i = 1; i <= 5; i++) {
      await smallCache.append(
        "thread-1",
        createTestMessage(`m${i}`, `Msg ${i}`)
      );
    }

    const messages = await smallCache.getMessages("thread-1");
    expect(messages).toHaveLength(3);
    expect(messages[0].id).toBe("m3");
    expect(messages[1].id).toBe("m4");
    expect(messages[2].id).toBe("m5");
  });

  it("should strip raw field on storage", async () => {
    const msg = createTestMessage("m1", "Hello");
    msg.raw = { secret: "data", nested: { deep: true } };

    await cache.append("thread-1", msg);

    // Check what was passed to appendToList
    const appendedValue = (
      state.appendToList as ReturnType<typeof import("vitest").vi.fn>
    ).mock.calls[0][1] as {
      raw: unknown;
    };
    expect(appendedValue.raw).toBeNull();
  });

  it("should return empty array for unknown thread", async () => {
    const messages = await cache.getMessages("nonexistent");
    expect(messages).toHaveLength(0);
  });

  it("should support limit parameter in getMessages", async () => {
    for (let i = 1; i <= 10; i++) {
      await cache.append("thread-1", createTestMessage(`m${i}`, `Msg ${i}`));
    }

    const messages = await cache.getMessages("thread-1", 3);
    expect(messages).toHaveLength(3);
    // Should return the newest 3
    expect(messages[0].id).toBe("m8");
    expect(messages[1].id).toBe("m9");
    expect(messages[2].id).toBe("m10");
  });

  it("should keep threads isolated", async () => {
    await cache.append("thread-1", createTestMessage("m1", "Thread 1"));
    await cache.append("thread-2", createTestMessage("m2", "Thread 2"));

    const msgs1 = await cache.getMessages("thread-1");
    const msgs2 = await cache.getMessages("thread-2");

    expect(msgs1).toHaveLength(1);
    expect(msgs1[0].text).toBe("Thread 1");
    expect(msgs2).toHaveLength(1);
    expect(msgs2[0].text).toBe("Thread 2");
  });
});
