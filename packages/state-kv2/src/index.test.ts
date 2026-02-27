import { KV2 } from "@vercel/kv2";
import { FakeBlobStore, FakeCache } from "@vercel/kv2/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKv2State, Kv2StateAdapter } from "./index.js";

const KV2_TOKEN_RE = /^kv2_/;

const mockLogger = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

function createTestAdapter(): Kv2StateAdapter {
  const blobStore = new FakeBlobStore();
  const kv = new KV2({ blobStore, prefix: "test/", cache: new FakeCache() });
  return createKv2State({ client: kv, logger: mockLogger });
}

describe("Kv2StateAdapter", () => {
  let adapter: Kv2StateAdapter;

  beforeEach(async () => {
    adapter = createTestAdapter();
    await adapter.connect();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  it("should create an adapter with createKv2State", () => {
    const state = createTestAdapter();
    expect(state).toBeInstanceOf(Kv2StateAdapter);
  });

  it("should throw if not connected", async () => {
    const state = createTestAdapter();
    await expect(state.subscribe("test:ch:th")).rejects.toThrow(
      "not connected"
    );
  });

  describe("subscriptions", () => {
    it("should subscribe and check subscription", async () => {
      await adapter.subscribe("slack:C123:1234567890.123456");
      const result = await adapter.isSubscribed("slack:C123:1234567890.123456");
      expect(result).toBe(true);
    });

    it("should return false for unsubscribed thread", async () => {
      const result = await adapter.isSubscribed("slack:C123:nonexistent");
      expect(result).toBe(false);
    });

    it("should unsubscribe", async () => {
      await adapter.subscribe("slack:C123:1234567890.123456");
      await adapter.unsubscribe("slack:C123:1234567890.123456");
      const result = await adapter.isSubscribed("slack:C123:1234567890.123456");
      expect(result).toBe(false);
    });

    it("should list subscriptions", async () => {
      await adapter.subscribe("slack:C123:thread1");
      await adapter.subscribe("slack:C456:thread2");
      await adapter.subscribe("teams:conv1:thread3");

      const all: string[] = [];
      for await (const threadId of adapter.listSubscriptions()) {
        all.push(threadId);
      }
      expect(all).toHaveLength(3);
      expect(all).toContain("slack:C123:thread1");
      expect(all).toContain("teams:conv1:thread3");
    });

    it("should filter subscriptions by adapter name", async () => {
      await adapter.subscribe("slack:C123:thread1");
      await adapter.subscribe("slack:C456:thread2");
      await adapter.subscribe("teams:conv1:thread3");

      const slackOnly: string[] = [];
      for await (const threadId of adapter.listSubscriptions("slack")) {
        slackOnly.push(threadId);
      }
      expect(slackOnly).toHaveLength(2);
      expect(slackOnly).toContain("slack:C123:thread1");
      expect(slackOnly).toContain("slack:C456:thread2");
    });
  });

  describe("locking", () => {
    it("should acquire a lock", async () => {
      const lock = await adapter.acquireLock("thread-1", 5000);
      expect(lock).not.toBeNull();
      expect(lock?.threadId).toBe("thread-1");
      expect(lock?.token).toMatch(KV2_TOKEN_RE);
    });

    it("should fail to acquire an already-held lock", async () => {
      await adapter.acquireLock("thread-1", 5000);
      const second = await adapter.acquireLock("thread-1", 5000);
      expect(second).toBeNull();
    });

    it("should release a lock", async () => {
      const lock = await adapter.acquireLock("thread-1", 5000);
      expect(lock).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: asserted above
      await adapter.releaseLock(lock!);

      const second = await adapter.acquireLock("thread-1", 5000);
      expect(second).not.toBeNull();
    });

    it("should acquire an expired lock", async () => {
      const lock = await adapter.acquireLock("thread-1", 1);
      expect(lock).not.toBeNull();

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 10));

      const second = await adapter.acquireLock("thread-1", 5000);
      expect(second).not.toBeNull();
      expect(second?.token).not.toBe(lock?.token);
    });

    it("should extend a lock", async () => {
      const lock = await adapter.acquireLock("thread-1", 5000);
      expect(lock).not.toBeNull();

      // biome-ignore lint/style/noNonNullAssertion: asserted above
      const extended = await adapter.extendLock(lock!, 10000);
      expect(extended).toBe(true);
    });

    it("should fail to extend with wrong token", async () => {
      await adapter.acquireLock("thread-1", 5000);
      const fakeLock = {
        threadId: "thread-1",
        token: "wrong_token",
        expiresAt: Date.now() + 5000,
      };
      const result = await adapter.extendLock(fakeLock, 10000);
      expect(result).toBe(false);
    });
  });

  describe("cache", () => {
    it("should set and get a value", async () => {
      await adapter.set("key1", { hello: "world" });
      const result = await adapter.get("key1");
      expect(result).toEqual({ hello: "world" });
    });

    it("should return null for missing key", async () => {
      const result = await adapter.get("nonexistent");
      expect(result).toBeNull();
    });

    it("should delete a value", async () => {
      await adapter.set("key1", "value1");
      await adapter.delete("key1");
      const result = await adapter.get("key1");
      expect(result).toBeNull();
    });

    it("should respect TTL expiration", async () => {
      await adapter.set("key1", "value1", 1);

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await adapter.get("key1");
      expect(result).toBeNull();
    });

    it("should persist values without TTL", async () => {
      await adapter.set("key1", "value1");

      // Small delay
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await adapter.get("key1");
      expect(result).toBe("value1");
    });
  });
});
