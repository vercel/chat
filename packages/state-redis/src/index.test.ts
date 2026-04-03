import { EventEmitter } from "node:events";
import type { Logger } from "chat";
import type { RedisClientType } from "redis";
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

  it("should create an adapter with url and default logger", () => {
    const adapter = createRedisState({
      url: "redis://localhost:6379",
    });

    expect(adapter).toBeInstanceOf(RedisStateAdapter);
  });

  it("should accept an existing redis client", () => {
    const client = {
      close: vi.fn(),
      connect: vi.fn(),
      isOpen: true,
      isReady: true,
      on: vi.fn(),
    } as unknown as RedisClientType;

    const adapter = createRedisState({
      client,
      logger: mockLogger,
    });

    expect(adapter).toBeInstanceOf(RedisStateAdapter);
    expect(adapter.getClient()).toBe(client);
  });

  it("should wait for an injected open client to become ready", async () => {
    const emitter = new EventEmitter();
    const client = Object.assign(emitter, {
      close: vi.fn(),
      connect: vi.fn(),
      isOpen: true,
      isReady: false,
    }) as unknown as RedisClientType & {
      isReady: boolean;
    };

    const adapter = createRedisState({
      client,
      logger: mockLogger,
    });

    let resolved = false;
    const connectPromise = adapter.connect().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(client.connect).not.toHaveBeenCalled();

    client.isReady = true;
    emitter.emit("ready");

    await connectPromise;
    expect(resolved).toBe(true);
  });

  it("should ignore transient errors while waiting for an injected client to recover", async () => {
    const emitter = new EventEmitter();
    const client = Object.assign(emitter, {
      close: vi.fn(),
      connect: vi.fn(),
      isOpen: true,
      isReady: false,
    }) as unknown as RedisClientType & {
      isOpen: boolean;
      isReady: boolean;
    };

    const adapter = createRedisState({
      client,
      logger: mockLogger,
    });

    let resolved = false;
    const connectPromise = adapter.connect().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    emitter.emit("error", new Error("Socket closed unexpectedly"));
    client.isOpen = false;
    emitter.emit("reconnecting");

    await Promise.resolve();
    expect(resolved).toBe(false);

    client.isOpen = true;
    client.isReady = true;
    emitter.emit("ready");

    await connectPromise;
    expect(resolved).toBe(true);
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("should wait for an injected client to become ready again after reconnecting", async () => {
    const emitter = new EventEmitter();
    const client = Object.assign(emitter, {
      close: vi.fn(),
      connect: vi.fn(),
      isOpen: true,
      isReady: true,
    }) as unknown as RedisClientType & {
      isOpen: boolean;
      isReady: boolean;
    };

    const adapter = createRedisState({
      client,
      logger: mockLogger,
    });

    await adapter.connect();
    expect(client.connect).not.toHaveBeenCalled();

    client.isReady = false;
    client.isOpen = false;
    emitter.emit("reconnecting");

    let resolved = false;
    const reconnectPromise = adapter.connect().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(client.connect).not.toHaveBeenCalled();

    client.isOpen = true;
    client.isReady = true;
    emitter.emit("ready");

    await reconnectPromise;
    expect(resolved).toBe(true);
  });

  it("should reject when an injected client ends before becoming ready", async () => {
    const emitter = new EventEmitter();
    const client = Object.assign(emitter, {
      close: vi.fn(),
      connect: vi.fn(),
      isOpen: true,
      isReady: false,
    }) as unknown as RedisClientType;

    const adapter = createRedisState({
      client,
      logger: mockLogger,
    });

    const connectPromise = adapter.connect();
    const error = new Error("Socket closed unexpectedly");

    emitter.emit("error", error);
    emitter.emit("end");

    await expect(connectPromise).rejects.toBe(error);
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
