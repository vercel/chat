import type { Lock, Logger } from "chat";
import type pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockEnd = vi.fn().mockResolvedValue(undefined);
const mockQuery = vi.fn().mockResolvedValue({ rows: [] });

vi.mock("pg", () => {
  class MockPool {
    query = mockQuery;
    end = mockEnd;
  }
  return { default: { Pool: MockPool } };
});

const { createPostgresState, PostgresStateAdapter } = await import("./index");

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function createMockPool(
  queryFn?: (text: string, params?: unknown[]) => { rows: unknown[] }
) {
  const defaultQueryFn = () => ({ rows: [] as unknown[] });
  const resolvedQueryFn = queryFn ?? defaultQueryFn;

  return {
    query: vi
      .fn()
      .mockImplementation((text: string, params?: unknown[]) =>
        Promise.resolve(resolvedQueryFn(text, params))
      ),
    end: vi.fn().mockResolvedValue(undefined),
  } as unknown as pg.Pool;
}

describe("PostgresStateAdapter", () => {
  it("should export createPostgresState function", () => {
    expect(typeof createPostgresState).toBe("function");
  });

  it("should export PostgresStateAdapter class", () => {
    expect(typeof PostgresStateAdapter).toBe("function");
  });

  describe("createPostgresState", () => {
    it("should create an adapter with url option", () => {
      const adapter = createPostgresState({
        url: "postgres://postgres:postgres@localhost:5432/chat",
        logger: mockLogger,
      });
      expect(adapter).toBeInstanceOf(PostgresStateAdapter);
    });

    it("should create an adapter with custom keyPrefix", () => {
      const adapter = createPostgresState({
        url: "postgres://postgres:postgres@localhost:5432/chat",
        keyPrefix: "custom-prefix",
        logger: mockLogger,
      });
      expect(adapter).toBeInstanceOf(PostgresStateAdapter);
    });

    it("should create an adapter with an existing client", () => {
      const client = createMockPool();
      const adapter = createPostgresState({ client, logger: mockLogger });
      expect(adapter).toBeInstanceOf(PostgresStateAdapter);
    });

    it("should use default logger when none provided", () => {
      const adapter = createPostgresState({
        url: "postgres://postgres:postgres@localhost:5432/chat",
      });
      expect(adapter).toBeInstanceOf(PostgresStateAdapter);
    });

    it("should throw when no url or env var is available", () => {
      vi.stubEnv("POSTGRES_URL", "");
      vi.stubEnv("DATABASE_URL", "");

      try {
        expect(() => createPostgresState({ logger: mockLogger })).toThrow(
          "Postgres url is required"
        );
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("should use POSTGRES_URL env var as fallback", () => {
      vi.stubEnv(
        "POSTGRES_URL",
        "postgres://postgres:postgres@localhost:5432/chat"
      );

      try {
        const adapter = createPostgresState({ logger: mockLogger });
        expect(adapter).toBeInstanceOf(PostgresStateAdapter);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("should use DATABASE_URL env var as fallback", () => {
      vi.stubEnv("POSTGRES_URL", "");
      vi.stubEnv(
        "DATABASE_URL",
        "postgres://postgres:postgres@localhost:5432/chat"
      );

      try {
        const adapter = createPostgresState({ logger: mockLogger });
        expect(adapter).toBeInstanceOf(PostgresStateAdapter);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe("ensureConnected", () => {
    it("should throw when calling subscribe before connect", async () => {
      const adapter = new PostgresStateAdapter({
        client: createMockPool(),
        logger: mockLogger,
      });
      await expect(adapter.subscribe("thread1")).rejects.toThrow(
        "not connected"
      );
    });

    it("should throw when calling unsubscribe before connect", async () => {
      const adapter = new PostgresStateAdapter({
        client: createMockPool(),
        logger: mockLogger,
      });
      await expect(adapter.unsubscribe("thread1")).rejects.toThrow(
        "not connected"
      );
    });

    it("should throw when calling isSubscribed before connect", async () => {
      const adapter = new PostgresStateAdapter({
        client: createMockPool(),
        logger: mockLogger,
      });
      await expect(adapter.isSubscribed("thread1")).rejects.toThrow(
        "not connected"
      );
    });

    it("should throw when calling acquireLock before connect", async () => {
      const adapter = new PostgresStateAdapter({
        client: createMockPool(),
        logger: mockLogger,
      });
      await expect(adapter.acquireLock("thread1", 5000)).rejects.toThrow(
        "not connected"
      );
    });

    it("should throw when calling releaseLock before connect", async () => {
      const adapter = new PostgresStateAdapter({
        client: createMockPool(),
        logger: mockLogger,
      });
      const fakeLock: Lock = {
        threadId: "thread1",
        token: "tok",
        expiresAt: Date.now() + 5000,
      };
      await expect(adapter.releaseLock(fakeLock)).rejects.toThrow(
        "not connected"
      );
    });

    it("should throw when calling extendLock before connect", async () => {
      const adapter = new PostgresStateAdapter({
        client: createMockPool(),
        logger: mockLogger,
      });
      const fakeLock: Lock = {
        threadId: "thread1",
        token: "tok",
        expiresAt: Date.now() + 5000,
      };
      await expect(adapter.extendLock(fakeLock, 5000)).rejects.toThrow(
        "not connected"
      );
    });

    it("should throw when calling get before connect", async () => {
      const adapter = new PostgresStateAdapter({
        client: createMockPool(),
        logger: mockLogger,
      });
      await expect(adapter.get("key")).rejects.toThrow("not connected");
    });

    it("should throw when calling set before connect", async () => {
      const adapter = new PostgresStateAdapter({
        client: createMockPool(),
        logger: mockLogger,
      });
      await expect(adapter.set("key", "value")).rejects.toThrow(
        "not connected"
      );
    });

    it("should throw when calling setIfNotExists before connect", async () => {
      const adapter = new PostgresStateAdapter({
        client: createMockPool(),
        logger: mockLogger,
      });
      await expect(adapter.setIfNotExists("key", "value")).rejects.toThrow(
        "not connected"
      );
    });

    it("should throw when calling delete before connect", async () => {
      const adapter = new PostgresStateAdapter({
        client: createMockPool(),
        logger: mockLogger,
      });
      await expect(adapter.delete("key")).rejects.toThrow("not connected");
    });
  });

  describe("with mock client", () => {
    let adapter: InstanceType<typeof PostgresStateAdapter>;
    let queryRows: unknown[];
    let pool: pg.Pool;

    beforeEach(async () => {
      queryRows = [];
      pool = createMockPool(() => ({ rows: queryRows }));
      adapter = new PostgresStateAdapter({
        client: pool,
        logger: mockLogger,
      });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe("connect / disconnect", () => {
      it("should be idempotent on connect", async () => {
        await adapter.connect();
        await adapter.connect();
      });

      it("should deduplicate concurrent connect calls", async () => {
        const client = createMockPool();
        const a = new PostgresStateAdapter({ client, logger: mockLogger });
        await Promise.all([a.connect(), a.connect()]);
      });

      it("should be idempotent on disconnect", async () => {
        await adapter.disconnect();
        await adapter.disconnect();
      });

      it("should not call pool.end() when using external client", async () => {
        const client = createMockPool();
        const a = new PostgresStateAdapter({ client, logger: mockLogger });
        await a.connect();
        await a.disconnect();
        expect(client.end).not.toHaveBeenCalled();
      });

      it("should call pool.end() when adapter owns the client", async () => {
        mockEnd.mockClear();
        const a = new PostgresStateAdapter({
          url: "postgres://localhost:5432/test",
          logger: mockLogger,
        });
        await a.connect();
        await a.disconnect();
        expect(mockEnd).toHaveBeenCalled();
      });

      it("should handle connect failure", async () => {
        const failPool = {
          query: vi.fn().mockRejectedValue(new Error("connection refused")),
          end: vi.fn(),
        } as unknown as pg.Pool;

        const a = new PostgresStateAdapter({
          client: failPool,
          logger: mockLogger,
        });
        await expect(a.connect()).rejects.toThrow("connection refused");
        expect(mockLogger.error).toHaveBeenCalled();

        // Retry should attempt again (connectPromise was reset)
        await expect(a.connect()).rejects.toThrow("connection refused");
      });
    });

    describe("subscriptions", () => {
      it("should subscribe without throwing", async () => {
        await adapter.subscribe("slack:C123:1234.5678");
      });

      it("should unsubscribe without throwing", async () => {
        await adapter.unsubscribe("slack:C123:1234.5678");
      });

      it("should return true when subscribed", async () => {
        queryRows = [{ "?column?": 1 }];
        const result = await adapter.isSubscribed("slack:C123:1234.5678");
        expect(result).toBe(true);
      });

      it("should return false when not subscribed", async () => {
        queryRows = [];
        const result = await adapter.isSubscribed("slack:C123:1234.5678");
        expect(result).toBe(false);
      });
    });

    describe("locking", () => {
      it("should acquire a lock when row is returned", async () => {
        const expiresAt = new Date(Date.now() + 5000);
        queryRows = [
          {
            thread_id: "thread1",
            token: "pg_test-token",
            expires_at: expiresAt,
          },
        ];

        const lock = await adapter.acquireLock("thread1", 5000);
        expect(lock).not.toBeNull();
        expect(lock?.threadId).toBe("thread1");
        expect(lock?.token).toBe("pg_test-token");
        expect(lock?.expiresAt).toBe(expiresAt.getTime());
      });

      it("should return null when lock is already held", async () => {
        queryRows = [];
        const lock = await adapter.acquireLock("thread1", 5000);
        expect(lock).toBeNull();
      });

      it("should release a lock without throwing", async () => {
        const lock: Lock = {
          threadId: "thread1",
          token: "pg_test-token",
          expiresAt: Date.now() + 5000,
        };
        await adapter.releaseLock(lock);
      });

      it("should return true when lock is extended", async () => {
        queryRows = [{ thread_id: "thread1" }];
        const lock: Lock = {
          threadId: "thread1",
          token: "pg_test-token",
          expiresAt: Date.now() + 5000,
        };
        const result = await adapter.extendLock(lock, 5000);
        expect(result).toBe(true);
      });

      it("should return false when lock extension fails", async () => {
        queryRows = [];
        const lock: Lock = {
          threadId: "thread1",
          token: "pg_test-token",
          expiresAt: Date.now() + 5000,
        };
        const result = await adapter.extendLock(lock, 5000);
        expect(result).toBe(false);
      });

      it("should force-release a lock without checking token", async () => {
        await adapter.forceReleaseLock("thread1");
        expect(pool.query).toHaveBeenCalledWith(
          expect.stringContaining("DELETE FROM chat_state_locks"),
          ["chat-sdk", "thread1"]
        );
      });

      it("should no-op when force-releasing a non-existent lock", async () => {
        await expect(
          adapter.forceReleaseLock("nonexistent")
        ).resolves.toBeUndefined();
      });
    });

    describe("cache", () => {
      it("should return parsed JSON value on cache hit", async () => {
        queryRows = [{ value: '{"foo":"bar"}' }];
        const result = await adapter.get("key");
        expect(result).toEqual({ foo: "bar" });
      });

      it("should return raw value when JSON parsing fails", async () => {
        queryRows = [{ value: "not-json" }];
        const result = await adapter.get("key");
        expect(result).toBe("not-json");
      });

      it("should return null and clean up on cache miss", async () => {
        queryRows = [];
        const result = await adapter.get("key");
        expect(result).toBeNull();
      });

      it("should set a value without throwing", async () => {
        await adapter.set("key", { foo: "bar" });
      });

      it("should set a value with TTL without throwing", async () => {
        await adapter.set("key", "value", 5000);
      });

      it("should return true when setIfNotExists inserts a new key", async () => {
        queryRows = [{ cache_key: "key" }];
        const result = await adapter.setIfNotExists("key", "value");
        expect(result).toBe(true);
      });

      it("should return false when setIfNotExists finds existing key", async () => {
        queryRows = [];
        const result = await adapter.setIfNotExists("key", "value");
        expect(result).toBe(false);
      });

      it("should support setIfNotExists with TTL", async () => {
        queryRows = [{ cache_key: "key" }];
        const result = await adapter.setIfNotExists("key", "value", 5000);
        expect(result).toBe(true);
      });

      it("should delete a value without throwing", async () => {
        await adapter.delete("key");
      });
    });

    describe("getClient", () => {
      it("should return the underlying client", () => {
        const client = adapter.getClient();
        expect(client).toBeDefined();
      });
    });
  });

  describe.skip("integration tests (require Postgres)", () => {
    it("should connect to Postgres", async () => {
      const adapter = createPostgresState({
        url:
          process.env.POSTGRES_URL ||
          "postgres://postgres:postgres@localhost:5432/chat",
        logger: mockLogger,
      });
      await adapter.connect();
      await adapter.disconnect();
    });
  });
});
