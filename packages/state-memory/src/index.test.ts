import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryState, type MemoryStateAdapter } from "./index";

describe("MemoryStateAdapter", () => {
  let adapter: MemoryStateAdapter;

  beforeEach(async () => {
    adapter = createMemoryState();
    await adapter.connect();
  });

  describe("subscriptions", () => {
    it("should subscribe to a thread", async () => {
      await adapter.subscribe("slack:C123:1234.5678");
      expect(await adapter.isSubscribed("slack:C123:1234.5678")).toBe(true);
    });

    it("should unsubscribe from a thread", async () => {
      await adapter.subscribe("slack:C123:1234.5678");
      await adapter.unsubscribe("slack:C123:1234.5678");
      expect(await adapter.isSubscribed("slack:C123:1234.5678")).toBe(false);
    });
  });

  describe("locking", () => {
    it("should acquire a lock", async () => {
      const lock = await adapter.acquireLock("thread1", 5000);
      expect(lock).not.toBeNull();
      expect(lock?.threadId).toBe("thread1");
      expect(lock?.token).toBeTruthy();
    });

    it("should prevent double-locking", async () => {
      const lock1 = await adapter.acquireLock("thread1", 5000);
      const lock2 = await adapter.acquireLock("thread1", 5000);

      expect(lock1).not.toBeNull();
      expect(lock2).toBeNull();
    });

    it("should release a lock", async () => {
      const lock = await adapter.acquireLock("thread1", 5000);
      expect(lock).not.toBeNull();
      await adapter.releaseLock(lock as NonNullable<typeof lock>);

      const lock2 = await adapter.acquireLock("thread1", 5000);
      expect(lock2).not.toBeNull();
    });

    it("should not release a lock with wrong token", async () => {
      const lock = await adapter.acquireLock("thread1", 5000);

      // Try to release with fake lock
      await adapter.releaseLock({
        threadId: "thread1",
        token: "fake-token",
        expiresAt: Date.now() + 5000,
      });

      // Original lock should still be held
      const lock2 = await adapter.acquireLock("thread1", 5000);
      expect(lock2).toBeNull();

      // Clean up
      expect(lock).not.toBeNull();
      await adapter.releaseLock(lock as NonNullable<typeof lock>);
    });

    it("should allow re-locking after expiry", async () => {
      const lock1 = await adapter.acquireLock("thread1", 10); // 10ms TTL

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 20));

      const lock2 = await adapter.acquireLock("thread1", 5000);
      expect(lock2).not.toBeNull();
      expect(lock2?.token).not.toBe(lock1?.token);
    });

    it("should extend a lock", async () => {
      const lock = await adapter.acquireLock("thread1", 100);
      expect(lock).not.toBeNull();

      // Extend the lock
      const extended = await adapter.extendLock(
        lock as NonNullable<typeof lock>,
        5000
      );
      expect(extended).toBe(true);

      // Should still be locked
      const lock2 = await adapter.acquireLock("thread1", 5000);
      expect(lock2).toBeNull();
    });

    it("should force-release a lock regardless of token", async () => {
      const lock = await adapter.acquireLock("thread1", 5000);
      expect(lock).not.toBeNull();

      await adapter.forceReleaseLock("thread1");

      const lock2 = await adapter.acquireLock("thread1", 5000);
      expect(lock2).not.toBeNull();
      expect(lock2?.token).not.toBe(lock?.token);
    });

    it("should no-op when force-releasing a non-existent lock", async () => {
      await expect(
        adapter.forceReleaseLock("nonexistent")
      ).resolves.toBeUndefined();
    });

    it("should not extend an expired lock", async () => {
      const lock = await adapter.acquireLock("thread1", 10);
      expect(lock).not.toBeNull();

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 20));

      const extended = await adapter.extendLock(
        lock as NonNullable<typeof lock>,
        5000
      );
      expect(extended).toBe(false);
    });
  });

  describe("setIfNotExists", () => {
    it("should set a value when key does not exist", async () => {
      const result = await adapter.setIfNotExists("key1", "value1");
      expect(result).toBe(true);
      expect(await adapter.get("key1")).toBe("value1");
    });

    it("should not overwrite an existing key", async () => {
      await adapter.setIfNotExists("key1", "first");
      const result = await adapter.setIfNotExists("key1", "second");
      expect(result).toBe(false);
      expect(await adapter.get("key1")).toBe("first");
    });

    it("should allow setting after TTL expiry", async () => {
      await adapter.setIfNotExists("key1", "first", 10);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const result = await adapter.setIfNotExists("key1", "second");
      expect(result).toBe(true);
      expect(await adapter.get("key1")).toBe("second");
    });

    it("should respect TTL on the new value", async () => {
      await adapter.setIfNotExists("key1", "value", 10);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(await adapter.get("key1")).toBeNull();
    });
  });

  describe("appendToList / getList", () => {
    it("should append and retrieve list items", async () => {
      await adapter.appendToList("list1", { id: 1 });
      await adapter.appendToList("list1", { id: 2 });

      const result = await adapter.getList("list1");
      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it("should return empty array for non-existent list", async () => {
      const result = await adapter.getList("nonexistent");
      expect(result).toEqual([]);
    });

    it("should trim to maxLength, keeping newest", async () => {
      for (let i = 1; i <= 5; i++) {
        await adapter.appendToList("list1", { id: i }, { maxLength: 3 });
      }

      const result = await adapter.getList("list1");
      expect(result).toEqual([{ id: 3 }, { id: 4 }, { id: 5 }]);
    });

    it("should respect TTL on lists", async () => {
      await adapter.appendToList("list1", { id: 1 }, { ttlMs: 10 });
      await new Promise((resolve) => setTimeout(resolve, 20));

      const result = await adapter.getList("list1");
      expect(result).toEqual([]);
    });

    it("should refresh TTL on subsequent appends", async () => {
      vi.useFakeTimers();

      try {
        await adapter.appendToList("list1", { id: 1 }, { ttlMs: 50 });
        await vi.advanceTimersByTimeAsync(30);

        // Append again — refreshes TTL
        await adapter.appendToList("list1", { id: 2 }, { ttlMs: 50 });

        const result = await adapter.getList("list1");
        expect(result).toEqual([{ id: 1 }, { id: 2 }]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("should keep lists isolated by key", async () => {
      await adapter.appendToList("list-a", "a");
      await adapter.appendToList("list-b", "b");

      expect(await adapter.getList("list-a")).toEqual(["a"]);
      expect(await adapter.getList("list-b")).toEqual(["b"]);
    });

    it("should start fresh after expired list", async () => {
      await adapter.appendToList("list1", { id: 1 }, { ttlMs: 10 });
      await new Promise((resolve) => setTimeout(resolve, 20));

      await adapter.appendToList("list1", { id: 2 });
      const result = await adapter.getList("list1");
      expect(result).toEqual([{ id: 2 }]);
    });
  });

  describe("enqueue / dequeue / queueDepth", () => {
    it("should enqueue and dequeue a single entry", async () => {
      const entry = {
        message: { id: "m1", text: "hello" },
        enqueuedAt: Date.now(),
        expiresAt: Date.now() + 90000,
      };
      const depth = await adapter.enqueue("thread1", entry as never, 10);
      expect(depth).toBe(1);

      const result = await adapter.dequeue("thread1");
      expect(result).toEqual(entry);
    });

    it("should return null when dequeuing from empty queue", async () => {
      const result = await adapter.dequeue("thread1");
      expect(result).toBeNull();
    });

    it("should return null when dequeuing from nonexistent thread", async () => {
      const result = await adapter.dequeue("nonexistent");
      expect(result).toBeNull();
    });

    it("should return 0 depth for empty queue", async () => {
      const depth = await adapter.queueDepth("thread1");
      expect(depth).toBe(0);
    });

    it("should dequeue in FIFO order", async () => {
      const entry1 = {
        message: { id: "m1" },
        enqueuedAt: 1000,
        expiresAt: Date.now() + 90000,
      };
      const entry2 = {
        message: { id: "m2" },
        enqueuedAt: 2000,
        expiresAt: Date.now() + 90000,
      };
      const entry3 = {
        message: { id: "m3" },
        enqueuedAt: 3000,
        expiresAt: Date.now() + 90000,
      };

      await adapter.enqueue("thread1", entry1 as never, 10);
      await adapter.enqueue("thread1", entry2 as never, 10);
      await adapter.enqueue("thread1", entry3 as never, 10);

      expect(await adapter.queueDepth("thread1")).toBe(3);

      const r1 = await adapter.dequeue("thread1");
      expect(r1?.message).toEqual({ id: "m1" });

      const r2 = await adapter.dequeue("thread1");
      expect(r2?.message).toEqual({ id: "m2" });

      const r3 = await adapter.dequeue("thread1");
      expect(r3?.message).toEqual({ id: "m3" });

      expect(await adapter.dequeue("thread1")).toBeNull();
      expect(await adapter.queueDepth("thread1")).toBe(0);
    });

    it("should trim to maxSize keeping newest entries", async () => {
      for (let i = 1; i <= 5; i++) {
        await adapter.enqueue(
          "thread1",
          {
            message: { id: `m${i}` },
            enqueuedAt: i * 1000,
            expiresAt: Date.now() + 90000,
          } as never,
          3
        );
      }

      expect(await adapter.queueDepth("thread1")).toBe(3);

      const r1 = await adapter.dequeue("thread1");
      expect(r1?.message).toEqual({ id: "m3" });

      const r2 = await adapter.dequeue("thread1");
      expect(r2?.message).toEqual({ id: "m4" });

      const r3 = await adapter.dequeue("thread1");
      expect(r3?.message).toEqual({ id: "m5" });
    });

    it("should handle maxSize of 1 (debounce behavior)", async () => {
      await adapter.enqueue(
        "thread1",
        {
          message: { id: "m1" },
          enqueuedAt: 1000,
          expiresAt: Date.now() + 90000,
        } as never,
        1
      );
      await adapter.enqueue(
        "thread1",
        {
          message: { id: "m2" },
          enqueuedAt: 2000,
          expiresAt: Date.now() + 90000,
        } as never,
        1
      );
      await adapter.enqueue(
        "thread1",
        {
          message: { id: "m3" },
          enqueuedAt: 3000,
          expiresAt: Date.now() + 90000,
        } as never,
        1
      );

      expect(await adapter.queueDepth("thread1")).toBe(1);
      const result = await adapter.dequeue("thread1");
      expect(result?.message).toEqual({ id: "m3" });
    });

    it("should keep queues isolated by thread", async () => {
      await adapter.enqueue(
        "thread-a",
        {
          message: { id: "a1" },
          enqueuedAt: 1000,
          expiresAt: Date.now() + 90000,
        } as never,
        10
      );
      await adapter.enqueue(
        "thread-b",
        {
          message: { id: "b1" },
          enqueuedAt: 1000,
          expiresAt: Date.now() + 90000,
        } as never,
        10
      );

      expect(await adapter.queueDepth("thread-a")).toBe(1);
      expect(await adapter.queueDepth("thread-b")).toBe(1);

      const ra = await adapter.dequeue("thread-a");
      expect(ra?.message).toEqual({ id: "a1" });

      const rb = await adapter.dequeue("thread-b");
      expect(rb?.message).toEqual({ id: "b1" });
    });

    it("should clear queues on disconnect", async () => {
      await adapter.enqueue(
        "thread1",
        {
          message: { id: "m1" },
          enqueuedAt: 1000,
          expiresAt: Date.now() + 90000,
        } as never,
        10
      );

      await adapter.disconnect();
      await adapter.connect();

      expect(await adapter.queueDepth("thread1")).toBe(0);
      expect(await adapter.dequeue("thread1")).toBeNull();
    });
  });

  describe("connection", () => {
    it("should throw when not connected", async () => {
      const newAdapter = createMemoryState();
      await expect(newAdapter.subscribe("test")).rejects.toThrow(
        "not connected"
      );
    });

    it("should clear state on disconnect", async () => {
      await adapter.subscribe("thread1");
      await adapter.acquireLock("thread1", 5000);

      await adapter.disconnect();
      await adapter.connect();

      expect(await adapter.isSubscribed("thread1")).toBe(false);
      const lock = await adapter.acquireLock("thread1", 5000);
      expect(lock).not.toBeNull();
    });
  });
});
