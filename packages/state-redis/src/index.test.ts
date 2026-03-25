import type { Logger } from "chat";
import { describe, expect, it, vi } from "vitest";
import { createRedisState, RedisStateAdapter } from "./index";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("RedisStateAdapter", () => {
  it("should export createRedisState function", () => {
    expect(typeof createRedisState).toBe("function");
  });

  it("should create an adapter instance", () => {
    const adapter = createRedisState({
      url: "redis://localhost:6379",
      logger: mockLogger,
    });
    expect(adapter).toBeInstanceOf(RedisStateAdapter);
  });

  it("should have appendToList method", () => {
    const adapter = createRedisState({
      url: "redis://localhost:6379",
      logger: mockLogger,
    });
    expect(typeof adapter.appendToList).toBe("function");
  });

  it("should have getList method", () => {
    const adapter = createRedisState({
      url: "redis://localhost:6379",
      logger: mockLogger,
    });
    expect(typeof adapter.getList).toBe("function");
  });

  it("should have enqueue method", () => {
    const adapter = createRedisState({
      url: "redis://localhost:6379",
      logger: mockLogger,
    });
    expect(typeof adapter.enqueue).toBe("function");
  });

  it("should have dequeue method", () => {
    const adapter = createRedisState({
      url: "redis://localhost:6379",
      logger: mockLogger,
    });
    expect(typeof adapter.dequeue).toBe("function");
  });

  it("should have queueDepth method", () => {
    const adapter = createRedisState({
      url: "redis://localhost:6379",
      logger: mockLogger,
    });
    expect(typeof adapter.queueDepth).toBe("function");
  });

  // Note: Integration tests with a real Redis instance would go here
  // but require a running Redis server, so they're skipped by default

  describe.skip("integration tests (require Redis)", () => {
    it("should connect to Redis", async () => {
      const adapter = createRedisState({
        url: process.env.REDIS_URL || "redis://localhost:6379",
        logger: mockLogger,
      });
      await adapter.connect();
      await adapter.disconnect();
    });

    it("should force-release a lock regardless of token", async () => {
      const adapter = createRedisState({
        url: process.env.REDIS_URL || "redis://localhost:6379",
        logger: mockLogger,
      });
      await adapter.connect();

      const lock = await adapter.acquireLock("thread-force-test", 5000);
      expect(lock).not.toBeNull();

      await adapter.forceReleaseLock("thread-force-test");

      const lock2 = await adapter.acquireLock("thread-force-test", 5000);
      expect(lock2).not.toBeNull();
      expect(lock2?.token).not.toBe(lock?.token);

      await adapter.disconnect();
    });

    it("should no-op when force-releasing a non-existent lock", async () => {
      const adapter = createRedisState({
        url: process.env.REDIS_URL || "redis://localhost:6379",
        logger: mockLogger,
      });
      await adapter.connect();

      await expect(
        adapter.forceReleaseLock("nonexistent")
      ).resolves.toBeUndefined();

      await adapter.disconnect();
    });
  });
});
