import { beforeEach, describe, expect, it } from "vitest";
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
