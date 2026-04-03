import type { Logger } from "chat";
import { describe, expect, it, vi } from "vitest";
import { createIoRedisState, IoRedisStateAdapter } from "./index";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("IoRedisStateAdapter", () => {
  it("should export createIoRedisState function", () => {
    expect(typeof createIoRedisState).toBe("function");
  });

  it("should create an adapter instance with URL", () => {
    const adapter = createIoRedisState({
      url: "redis://localhost:6379",
      logger: mockLogger,
    });
    expect(adapter).toBeInstanceOf(IoRedisStateAdapter);
    // Clean up - disconnect the auto-connected client
    adapter.getClient().disconnect();
  });

  it("should have appendToList method", () => {
    const adapter = createIoRedisState({
      url: "redis://localhost:6379",
      logger: mockLogger,
    });
    expect(typeof adapter.appendToList).toBe("function");
    adapter.getClient().disconnect();
  });

  it("should have getList method", () => {
    const adapter = createIoRedisState({
      url: "redis://localhost:6379",
      logger: mockLogger,
    });
    expect(typeof adapter.getList).toBe("function");
    adapter.getClient().disconnect();
  });

  it("should have enqueue method", () => {
    const adapter = createIoRedisState({
      url: "redis://localhost:6379",
      logger: mockLogger,
    });
    expect(typeof adapter.enqueue).toBe("function");
    adapter.getClient().disconnect();
  });

  it("should have dequeue method", () => {
    const adapter = createIoRedisState({
      url: "redis://localhost:6379",
      logger: mockLogger,
    });
    expect(typeof adapter.dequeue).toBe("function");
    adapter.getClient().disconnect();
  });

  it("should have queueDepth method", () => {
    const adapter = createIoRedisState({
      url: "redis://localhost:6379",
      logger: mockLogger,
    });
    expect(typeof adapter.queueDepth).toBe("function");
    adapter.getClient().disconnect();
  });

  // Note: Integration tests with a real Redis instance would go here
  // but require a running Redis server, so they're skipped by default

  describe.skip("integration tests (require Redis)", () => {
    it("should connect to Redis", async () => {
      const adapter = createIoRedisState({
        url: process.env.REDIS_URL || "redis://localhost:6379",
        logger: mockLogger,
      });
      await adapter.connect();
      await adapter.disconnect();
    });

    it("should force-release a lock regardless of token", async () => {
      const adapter = createIoRedisState({
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
      const adapter = createIoRedisState({
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
