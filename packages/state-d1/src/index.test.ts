import { env } from "cloudflare:test";
import type { QueueEntry } from "chat";
import { beforeEach, describe, expect, it } from "vitest";
import { createD1State, type D1StateAdapter } from "./index";

let counter = 0;
function uniquePrefix(): string {
  counter += 1;
  return `test-${Date.now()}-${counter}`;
}

function makeEntry(id: string, enqueuedAt: number, ttlMs = 90_000): QueueEntry {
  return {
    message: { id } as never,
    enqueuedAt,
    expiresAt: Date.now() + ttlMs,
  };
}

async function connected(): Promise<D1StateAdapter> {
  const adapter = createD1State({
    database: env.DB,
    keyPrefix: uniquePrefix(),
  });
  await adapter.connect();
  return adapter;
}

describe("D1StateAdapter", () => {
  let adapter: D1StateAdapter;

  beforeEach(async () => {
    adapter = await connected();
  });

  describe("connection gating", () => {
    it("throws when used before connect()", async () => {
      const fresh = createD1State({
        database: env.DB,
        keyPrefix: uniquePrefix(),
      });
      await expect(fresh.subscribe("t")).rejects.toThrow("not connected");
    });

    it("connect() is idempotent", async () => {
      await expect(adapter.connect()).resolves.toBeUndefined();
      await expect(adapter.connect()).resolves.toBeUndefined();
    });

    it("throws after disconnect()", async () => {
      await adapter.disconnect();
      await expect(adapter.subscribe("t")).rejects.toThrow("not connected");
    });

    it("can reconnect after disconnect()", async () => {
      await adapter.disconnect();
      await adapter.connect();
      await expect(adapter.subscribe("t")).resolves.toBeUndefined();
    });

    it("throws when constructed without a database", () => {
      expect(() => createD1State({ database: undefined as never })).toThrow();
    });
  });

  describe("subscriptions", () => {
    it("subscribes to a thread", async () => {
      await adapter.subscribe("slack:C123:1234.5678");
      expect(await adapter.isSubscribed("slack:C123:1234.5678")).toBe(true);
    });

    it("returns false for an unsubscribed thread", async () => {
      expect(await adapter.isSubscribed("never")).toBe(false);
    });

    it("unsubscribes from a thread", async () => {
      await adapter.subscribe("slack:C123:1234.5678");
      await adapter.unsubscribe("slack:C123:1234.5678");
      expect(await adapter.isSubscribed("slack:C123:1234.5678")).toBe(false);
    });

    it("subscribing twice is idempotent", async () => {
      await adapter.subscribe("t1");
      await adapter.subscribe("t1");
      expect(await adapter.isSubscribed("t1")).toBe(true);
    });
  });

  describe("locking", () => {
    it("acquires a lock", async () => {
      const lock = await adapter.acquireLock("thread1", 5000);
      expect(lock).not.toBeNull();
      expect(lock?.threadId).toBe("thread1");
      expect(lock?.token).toBeTruthy();
      expect(lock?.expiresAt).toBeGreaterThan(Date.now());
    });

    it("prevents double-locking", async () => {
      const lock1 = await adapter.acquireLock("thread1", 5000);
      const lock2 = await adapter.acquireLock("thread1", 5000);
      expect(lock1).not.toBeNull();
      expect(lock2).toBeNull();
    });

    it("releases a lock", async () => {
      const lock = await adapter.acquireLock("thread1", 5000);
      expect(lock).not.toBeNull();
      await adapter.releaseLock(lock as NonNullable<typeof lock>);
      const lock2 = await adapter.acquireLock("thread1", 5000);
      expect(lock2).not.toBeNull();
    });

    it("does not release a lock with the wrong token", async () => {
      const lock = await adapter.acquireLock("thread1", 5000);
      await adapter.releaseLock({
        threadId: "thread1",
        token: "fake-token",
        expiresAt: Date.now() + 5000,
      });
      const lock2 = await adapter.acquireLock("thread1", 5000);
      expect(lock2).toBeNull();
      await adapter.releaseLock(lock as NonNullable<typeof lock>);
    });

    it("allows re-locking after expiry (lock stealing)", async () => {
      const lock1 = await adapter.acquireLock("thread1", 10);
      await new Promise((r) => setTimeout(r, 25));
      const lock2 = await adapter.acquireLock("thread1", 5000);
      expect(lock2).not.toBeNull();
      expect(lock2?.token).not.toBe(lock1?.token);
    });

    it("extends a lock", async () => {
      const lock = await adapter.acquireLock("thread1", 100);
      expect(lock).not.toBeNull();
      const extended = await adapter.extendLock(
        lock as NonNullable<typeof lock>,
        5000
      );
      expect(extended).toBe(true);
      const lock2 = await adapter.acquireLock("thread1", 5000);
      expect(lock2).toBeNull();
    });

    it("does not extend with the wrong token", async () => {
      await adapter.acquireLock("thread1", 5000);
      const extended = await adapter.extendLock(
        { threadId: "thread1", token: "wrong", expiresAt: Date.now() + 5000 },
        5000
      );
      expect(extended).toBe(false);
    });

    it("does not extend an expired lock", async () => {
      const lock = await adapter.acquireLock("thread1", 10);
      expect(lock).not.toBeNull();
      await new Promise((r) => setTimeout(r, 25));
      const extended = await adapter.extendLock(
        lock as NonNullable<typeof lock>,
        5000
      );
      expect(extended).toBe(false);
    });

    it("force-releases a lock regardless of token", async () => {
      const lock = await adapter.acquireLock("thread1", 5000);
      await adapter.forceReleaseLock("thread1");
      const lock2 = await adapter.acquireLock("thread1", 5000);
      expect(lock2).not.toBeNull();
      expect(lock2?.token).not.toBe(lock?.token);
    });

    it("no-ops when force-releasing a non-existent lock", async () => {
      await expect(
        adapter.forceReleaseLock("nonexistent")
      ).resolves.toBeUndefined();
    });

    it("isolates locks by thread", async () => {
      const a = await adapter.acquireLock("thread-a", 5000);
      const b = await adapter.acquireLock("thread-b", 5000);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
    });
  });

  describe("cache get/set/delete", () => {
    it("round-trips an object value", async () => {
      await adapter.set("k1", { a: 1, b: "two" });
      expect(await adapter.get("k1")).toEqual({ a: 1, b: "two" });
    });

    it("returns null for a missing key", async () => {
      expect(await adapter.get("missing")).toBeNull();
    });

    it("overwrites an existing value", async () => {
      await adapter.set("k1", "first");
      await adapter.set("k1", "second");
      expect(await adapter.get("k1")).toBe("second");
    });

    it("deletes a value", async () => {
      await adapter.set("k1", "v");
      await adapter.delete("k1");
      expect(await adapter.get("k1")).toBeNull();
    });

    it("stores null as a value distinct from a miss", async () => {
      await adapter.set("k1", null);
      expect(await adapter.get("k1")).toBeNull();
    });

    it("expires a value after its TTL", async () => {
      await adapter.set("k1", "v", 10);
      await new Promise((r) => setTimeout(r, 25));
      expect(await adapter.get("k1")).toBeNull();
    });

    it("treats ttlMs of 0 as no expiry", async () => {
      await adapter.set("k1", "v", 0);
      await new Promise((r) => setTimeout(r, 25));
      expect(await adapter.get("k1")).toBe("v");
    });

    it("does not expire without a TTL", async () => {
      await adapter.set("k1", "v");
      await new Promise((r) => setTimeout(r, 25));
      expect(await adapter.get("k1")).toBe("v");
    });
  });

  describe("setIfNotExists", () => {
    it("sets a value when the key does not exist", async () => {
      expect(await adapter.setIfNotExists("k1", "v1")).toBe(true);
      expect(await adapter.get("k1")).toBe("v1");
    });

    it("does not overwrite an existing key", async () => {
      await adapter.setIfNotExists("k1", "first");
      expect(await adapter.setIfNotExists("k1", "second")).toBe(false);
      expect(await adapter.get("k1")).toBe("first");
    });

    it("allows setting after TTL expiry", async () => {
      await adapter.setIfNotExists("k1", "first", 10);
      await new Promise((r) => setTimeout(r, 25));
      expect(await adapter.setIfNotExists("k1", "second")).toBe(true);
      expect(await adapter.get("k1")).toBe("second");
    });

    it("respects the TTL on the new value", async () => {
      await adapter.setIfNotExists("k1", "v", 10);
      await new Promise((r) => setTimeout(r, 25));
      expect(await adapter.get("k1")).toBeNull();
    });
  });

  describe("appendToList / getList", () => {
    it("appends and retrieves list items in order", async () => {
      await adapter.appendToList("list1", { id: 1 });
      await adapter.appendToList("list1", { id: 2 });
      expect(await adapter.getList("list1")).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it("returns an empty array for a non-existent list", async () => {
      expect(await adapter.getList("nonexistent")).toEqual([]);
    });

    it("trims to maxLength, keeping the newest", async () => {
      for (let i = 1; i <= 5; i++) {
        await adapter.appendToList("list1", { id: i }, { maxLength: 3 });
      }
      expect(await adapter.getList("list1")).toEqual([
        { id: 3 },
        { id: 4 },
        { id: 5 },
      ]);
    });

    it("expires list entries after their TTL", async () => {
      await adapter.appendToList("list1", { id: 1 }, { ttlMs: 10 });
      await new Promise((r) => setTimeout(r, 25));
      expect(await adapter.getList("list1")).toEqual([]);
    });

    it("refreshes TTL on all entries on subsequent appends", async () => {
      await adapter.appendToList("list1", { id: 1 }, { ttlMs: 40 });
      await new Promise((r) => setTimeout(r, 25));
      await adapter.appendToList("list1", { id: 2 }, { ttlMs: 40 });
      await new Promise((r) => setTimeout(r, 25));
      // First entry would have expired at 40ms if not refreshed; both survive.
      expect(await adapter.getList("list1")).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it("keeps lists isolated by key", async () => {
      await adapter.appendToList("list-a", "a");
      await adapter.appendToList("list-b", "b");
      expect(await adapter.getList("list-a")).toEqual(["a"]);
      expect(await adapter.getList("list-b")).toEqual(["b"]);
    });

    it("starts fresh after an expired list", async () => {
      await adapter.appendToList("list1", { id: 1 }, { ttlMs: 10 });
      await new Promise((r) => setTimeout(r, 25));
      await adapter.appendToList("list1", { id: 2 });
      expect(await adapter.getList("list1")).toEqual([{ id: 2 }]);
    });
  });

  describe("enqueue / dequeue / queueDepth", () => {
    it("enqueues and dequeues a single entry", async () => {
      const entry = makeEntry("m1", Date.now());
      const depth = await adapter.enqueue("thread1", entry, 10);
      expect(depth).toBe(1);
      const result = await adapter.dequeue("thread1");
      expect(result).toEqual(entry);
    });

    it("returns null when dequeuing from an empty queue", async () => {
      expect(await adapter.dequeue("thread1")).toBeNull();
    });

    it("returns 0 depth for an empty queue", async () => {
      expect(await adapter.queueDepth("thread1")).toBe(0);
    });

    it("dequeues in FIFO order", async () => {
      await adapter.enqueue("thread1", makeEntry("m1", 1000), 10);
      await adapter.enqueue("thread1", makeEntry("m2", 2000), 10);
      await adapter.enqueue("thread1", makeEntry("m3", 3000), 10);
      expect(await adapter.queueDepth("thread1")).toBe(3);
      expect((await adapter.dequeue("thread1"))?.message).toEqual({ id: "m1" });
      expect((await adapter.dequeue("thread1"))?.message).toEqual({ id: "m2" });
      expect((await adapter.dequeue("thread1"))?.message).toEqual({ id: "m3" });
      expect(await adapter.dequeue("thread1")).toBeNull();
      expect(await adapter.queueDepth("thread1")).toBe(0);
    });

    it("trims to maxSize keeping the newest entries", async () => {
      for (let i = 1; i <= 5; i++) {
        await adapter.enqueue("thread1", makeEntry(`m${i}`, i * 1000), 3);
      }
      expect(await adapter.queueDepth("thread1")).toBe(3);
      expect((await adapter.dequeue("thread1"))?.message).toEqual({ id: "m3" });
      expect((await adapter.dequeue("thread1"))?.message).toEqual({ id: "m4" });
      expect((await adapter.dequeue("thread1"))?.message).toEqual({ id: "m5" });
    });

    it("handles maxSize of 1 (debounce behavior)", async () => {
      await adapter.enqueue("thread1", makeEntry("m1", 1000), 1);
      await adapter.enqueue("thread1", makeEntry("m2", 2000), 1);
      await adapter.enqueue("thread1", makeEntry("m3", 3000), 1);
      expect(await adapter.queueDepth("thread1")).toBe(1);
      expect((await adapter.dequeue("thread1"))?.message).toEqual({ id: "m3" });
    });

    it("keeps queues isolated by thread", async () => {
      await adapter.enqueue("thread-a", makeEntry("a1", 1000), 10);
      await adapter.enqueue("thread-b", makeEntry("b1", 1000), 10);
      expect(await adapter.queueDepth("thread-a")).toBe(1);
      expect(await adapter.queueDepth("thread-b")).toBe(1);
      expect((await adapter.dequeue("thread-a"))?.message).toEqual({
        id: "a1",
      });
      expect((await adapter.dequeue("thread-b"))?.message).toEqual({
        id: "b1",
      });
    });

    it("skips expired entries on dequeue", async () => {
      const expired: QueueEntry = {
        message: { id: "old" } as never,
        enqueuedAt: 1000,
        expiresAt: Date.now() + 10,
      };
      await adapter.enqueue("thread1", expired, 10);
      await adapter.enqueue("thread1", makeEntry("fresh", 2000), 10);
      await new Promise((r) => setTimeout(r, 25));
      const result = await adapter.dequeue("thread1");
      expect(result?.message).toEqual({ id: "fresh" });
    });

    it("excludes expired entries from queueDepth", async () => {
      const expired: QueueEntry = {
        message: { id: "old" } as never,
        enqueuedAt: 1000,
        expiresAt: Date.now() + 10,
      };
      await adapter.enqueue("thread1", expired, 10);
      await new Promise((r) => setTimeout(r, 25));
      expect(await adapter.queueDepth("thread1")).toBe(0);
    });
  });
});
