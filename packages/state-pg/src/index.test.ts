import { readFile } from "node:fs/promises";
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

const { createPostgresState, PostgresStateAdapter, postgresSchemaStatements } =
  await import("./index");

const schemaProbe = expect.stringContaining("has_table_privilege(");
const migrationHeading = "### Migration-owned schema";
const sqlFences = /```sql[^\n]*\r?\n([\s\S]*?)```/g;
const whitespace = /\s+/g;

/** Statements of the DDL block under the migration heading, whitespace-normalized. */
async function documentedSchemaStatements(path: string): Promise<string[]> {
  const content = await readFile(new URL(path, import.meta.url), "utf8");
  const section = content.split(migrationHeading)[1] ?? "";
  const block =
    Array.from(section.matchAll(sqlFences), (match) => match[1]).find((sql) =>
      sql.trimStart().startsWith(postgresSchemaStatements[0].slice(0, 40))
    ) ?? "";
  return block
    .split(";")
    .map((statement) => statement.replaceAll(whitespace, " ").trim())
    .filter(Boolean);
}

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

  describe("schema initialization", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      mockQuery.mockReset().mockResolvedValue({ rows: [] });
      mockEnd.mockClear();
    });

    it.each([
      undefined,
      true,
    ])("creates every table and index when autoCreateSchema is %s", async (autoCreateSchema) => {
      const client = createMockPool();
      const adapter = new PostgresStateAdapter({ client, autoCreateSchema });
      await adapter.connect();
      expect(vi.mocked(client.query).mock.calls.map(([sql]) => sql)).toEqual([
        "SELECT 1",
        ...postgresSchemaStatements,
      ]);
    });

    it("keeps the published migration in sync with the statements connect() runs", async () => {
      const source = postgresSchemaStatements.map((statement) =>
        statement.replaceAll(whitespace, " ").trim()
      );
      expect(source).toHaveLength(9);
      await expect(documentedSchemaStatements("../README.md")).resolves.toEqual(
        source
      );
      await expect(
        documentedSchemaStatements(
          "../../../apps/docs/content/adapters/official/postgres.mdx"
        )
      ).resolves.toEqual(source);
    });

    it.each([
      "constructor",
      "factory",
    ])("probes instead of creating the schema for an external pool via %s", async (method) => {
      const client = createMockPool();
      const options = { client, autoCreateSchema: false };
      const adapter =
        method === "constructor"
          ? new PostgresStateAdapter(options)
          : createPostgresState(options);
      await Promise.all([
        adapter.connect(),
        adapter.connect(),
        adapter.connect(),
      ]);
      await adapter.connect();
      expect(vi.mocked(client.query).mock.calls).toEqual([
        ["SELECT 1"],
        [schemaProbe],
      ]);
      expect(vi.mocked(client.query).mock.calls[1][0]).not.toContain("CREATE");
      await adapter.disconnect();
      expect(client.end).not.toHaveBeenCalled();
      await adapter.connect();
      expect(client.query).toHaveBeenCalledTimes(4);
    });

    it("probes only the privileges each table needs", async () => {
      const client = createMockPool();
      const adapter = new PostgresStateAdapter({
        client,
        autoCreateSchema: false,
      });
      await adapter.connect();
      const probe = vi.mocked(client.query).mock.calls[1][0] as string;
      for (const table of ["chat_state_subscriptions", "chat_state_queues"]) {
        expect(probe).toContain(`has_table_privilege('${table}', 'DELETE')`);
        expect(probe).not.toContain(
          `has_table_privilege('${table}', 'UPDATE')`
        );
        expect(probe).not.toContain(
          `has_column_privilege('${table}', 'expires_at', 'UPDATE')`
        );
      }
      for (const table of [
        "chat_state_locks",
        "chat_state_cache",
        "chat_state_lists",
      ]) {
        expect(probe).toContain(
          `has_column_privilege('${table}', 'expires_at', 'UPDATE')`
        );
      }
      expect(probe).toContain(
        "has_column_privilege('chat_state_cache', 'updated_at', 'UPDATE')"
      );
      expect(probe).not.toContain(
        "has_column_privilege('chat_state_cache', 'updated_at', 'INSERT')"
      );
      expect(probe).not.toContain("has_any_column_privilege");
      for (const table of ["chat_state_lists", "chat_state_queues"]) {
        expect(probe).toContain(
          `has_sequence_privilege(pg_get_serial_sequence('${table}', 'seq'), 'USAGE, UPDATE')`
        );
        expect(probe).toContain(`attrelid = '${table}'::regclass`);
      }
    });

    it("rejects connect() when a migration-owned table is missing", async () => {
      const client = createMockPool();
      const error = Object.assign(
        new Error('relation "chat_state_locks" does not exist'),
        { code: "42P01" }
      );
      vi.mocked(client.query).mockImplementation((sql: string) =>
        sql === "SELECT 1"
          ? Promise.resolve({ rows: [] })
          : Promise.reject(error)
      );
      const adapter = createPostgresState({
        client,
        autoCreateSchema: false,
        logger: mockLogger,
      });
      await expect(adapter.connect()).rejects.toMatchObject({
        message: expect.stringContaining(
          'PostgreSQL state schema is not ready: relation "chat_state_locks" does not exist. Run the adapter migration'
        ),
        cause: error,
      });
      await expect(adapter.get("key")).rejects.toThrow("not connected");
    });

    it("rejects connect() naming every object the runtime role cannot use", async () => {
      const client = createMockPool((sql) => ({
        rows:
          sql === "SELECT 1"
            ? []
            : [
                {
                  chat_state_subscriptions: true,
                  chat_state_locks: true,
                  chat_state_cache: false,
                  chat_state_lists: true,
                  chat_state_queues: true,
                  chat_state_lists_seq: null,
                  chat_state_queues_seq: false,
                },
              ],
      }));
      const adapter = createPostgresState({
        client,
        autoCreateSchema: false,
        logger: mockLogger,
      });
      await expect(adapter.connect()).rejects.toThrow(
        "PostgreSQL state schema is not ready: the current role lacks privileges on chat_state_cache, chat_state_queues_seq. Run the adapter migration"
      );
    });

    it.each([
      "constructor",
      "factory",
      "POSTGRES_URL",
      "DATABASE_URL",
    ])("forwards opt-out for a URL from %s and closes the owned pool", async (source) => {
      mockQuery.mockClear();
      const url = "postgres://localhost:5432/test";
      vi.stubEnv("POSTGRES_URL", source === "POSTGRES_URL" ? url : "");
      vi.stubEnv("DATABASE_URL", source === "DATABASE_URL" ? url : "");
      const adapter =
        source === "constructor"
          ? new PostgresStateAdapter({ url, autoCreateSchema: false })
          : createPostgresState({
              ...(source === "factory" ? { url } : {}),
              autoCreateSchema: false,
            });
      await Promise.all([adapter.connect(), adapter.connect()]);
      await adapter.connect();
      expect(mockQuery.mock.calls).toEqual([["SELECT 1"], [schemaProbe]]);
      await adapter.disconnect();
      expect(mockEnd).toHaveBeenCalledTimes(1);
    });

    it("retries a failed connectivity check without DDL", async () => {
      const client = createMockPool();
      const error = new Error("connection refused");
      vi.mocked(client.query).mockRejectedValueOnce(error);
      const adapter = createPostgresState({
        client,
        autoCreateSchema: false,
        logger: mockLogger,
      });
      const results = await Promise.allSettled([
        adapter.connect(),
        adapter.connect(),
      ]);
      expect(results).toEqual([
        { status: "rejected", reason: error },
        { status: "rejected", reason: error },
      ]);
      expect(client.query).toHaveBeenCalledExactlyOnceWith("SELECT 1");
      expect(mockLogger.error).toHaveBeenCalledWith("Postgres connect failed", {
        error,
      });
      await expect(adapter.get("key")).rejects.toThrow("not connected");
      await adapter.connect();
      expect(vi.mocked(client.query).mock.calls).toEqual([
        ["SELECT 1"],
        ["SELECT 1"],
        [schemaProbe],
      ]);
      await expect(adapter.subscribe("thread")).resolves.toBeUndefined();
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

      it("should allow setIfNotExists to replace expired keys", async () => {
        queryRows = [{ cache_key: "key" }];
        const result = await adapter.setIfNotExists("key", "value", 5000);

        expect(result).toBe(true);
        expect(pool.query).toHaveBeenCalledWith(
          expect.stringContaining(
            `WHERE chat_state_cache.expires_at IS NOT NULL
           AND chat_state_cache.expires_at <= now()`
          ),
          ["chat-sdk", "key", '"value"', expect.any(Date)]
        );
      });

      it("should delete a value without throwing", async () => {
        await adapter.delete("key");
      });
    });

    describe("appendToList / getList", () => {
      it("should call INSERT for appendToList", async () => {
        await adapter.appendToList("mylist", { foo: "bar" });
        const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
        const insertCall = calls.find(
          (c: unknown[]) =>
            typeof c[0] === "string" &&
            c[0].includes("INSERT INTO chat_state_lists")
        );
        expect(insertCall).toBeTruthy();
        expect(insertCall[1]).toContain("chat-sdk"); // keyPrefix
        expect(insertCall[1]).toContain("mylist");
        expect(insertCall[1]).toContain('{"foo":"bar"}');
      });

      it("should trim overflow when maxLength is specified", async () => {
        await adapter.appendToList("mylist", { id: 1 }, { maxLength: 10 });
        const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
        const deleteCall = calls.find(
          (c: unknown[]) =>
            typeof c[0] === "string" &&
            c[0].includes("DELETE FROM chat_state_lists")
        );
        expect(deleteCall).toBeTruthy();
      });

      it("should update TTL when ttlMs is specified", async () => {
        await adapter.appendToList("mylist", { id: 1 }, { ttlMs: 60000 });
        const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
        const updateCall = calls.find(
          (c: unknown[]) =>
            typeof c[0] === "string" && c[0].includes("UPDATE chat_state_lists")
        );
        expect(updateCall).toBeTruthy();
      });

      it("should return parsed list items from getList", async () => {
        queryRows = [{ value: '{"id":1}' }, { value: '{"id":2}' }];
        const result = await adapter.getList("mylist");
        expect(result).toEqual([{ id: 1 }, { id: 2 }]);
      });

      it("should return empty array when no rows exist", async () => {
        queryRows = [];
        const result = await adapter.getList("mylist");
        expect(result).toEqual([]);
      });
    });

    describe("enqueue / dequeue / queueDepth", () => {
      it("should purge expired entries before enqueue", async () => {
        queryRows = [{ depth: "1" }];
        const entry = {
          message: { id: "m1" },
          enqueuedAt: Date.now(),
          expiresAt: Date.now() + 90000,
        };
        await adapter.enqueue("thread1", entry as never, 10);

        const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
        const purgeCall = calls.find(
          (c: unknown[]) =>
            typeof c[0] === "string" &&
            c[0].includes("DELETE FROM chat_state_queues") &&
            c[0].includes("expires_at <= now()")
        );
        expect(purgeCall).toBeTruthy();
      });

      it("should purge expired entries before dequeue", async () => {
        queryRows = [];
        await adapter.dequeue("thread1");

        const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
        const purgeCall = calls.find(
          (c: unknown[]) =>
            typeof c[0] === "string" &&
            c[0].includes("DELETE FROM chat_state_queues") &&
            c[0].includes("expires_at <= now()")
        );
        expect(purgeCall).toBeTruthy();
      });

      it("should only count non-expired entries in queueDepth", async () => {
        queryRows = [{ depth: "2" }];
        await adapter.queueDepth("thread1");

        const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
        const countCall = calls.find(
          (c: unknown[]) =>
            typeof c[0] === "string" &&
            c[0].includes("count(*)") &&
            c[0].includes("expires_at > now()")
        );
        expect(countCall).toBeTruthy();
      });

      it("should only count non-expired entries in enqueue depth", async () => {
        queryRows = [{ depth: "1" }];
        const entry = {
          message: { id: "m1" },
          enqueuedAt: Date.now(),
          expiresAt: Date.now() + 90000,
        };
        await adapter.enqueue("thread1", entry as never, 10);

        const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
        const countCall = calls.find(
          (c: unknown[]) =>
            typeof c[0] === "string" &&
            c[0].includes("count(*)") &&
            c[0].includes("chat_state_queues") &&
            c[0].includes("expires_at > now()")
        );
        expect(countCall).toBeTruthy();
      });

      it("should call INSERT for enqueue", async () => {
        queryRows = [{ depth: "1" }];
        const entry = {
          message: { id: "m1", text: "hello" },
          enqueuedAt: Date.now(),
          expiresAt: Date.now() + 90000,
        };
        await adapter.enqueue("thread1", entry as never, 10);

        const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
        const insertCall = calls.find(
          (c: unknown[]) =>
            typeof c[0] === "string" &&
            c[0].includes("INSERT INTO chat_state_queues")
        );
        expect(insertCall).toBeTruthy();
        expect(insertCall[1]).toContain("chat-sdk");
        expect(insertCall[1]).toContain("thread1");
      });

      it("should trim overflow when maxSize is specified", async () => {
        queryRows = [{ depth: "1" }];
        const entry = {
          message: { id: "m1" },
          enqueuedAt: Date.now(),
          expiresAt: Date.now() + 90000,
        };
        await adapter.enqueue("thread1", entry as never, 5);

        const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
        const deleteCall = calls.find(
          (c: unknown[]) =>
            typeof c[0] === "string" &&
            c[0].includes("DELETE FROM chat_state_queues")
        );
        expect(deleteCall).toBeTruthy();
      });

      it("should return depth from enqueue", async () => {
        queryRows = [{ depth: "3" }];
        const entry = {
          message: { id: "m1" },
          enqueuedAt: Date.now(),
          expiresAt: Date.now() + 90000,
        };
        const depth = await adapter.enqueue("thread1", entry as never, 10);
        expect(depth).toBe(3);
      });

      it("should return parsed entry from dequeue", async () => {
        const entry = {
          message: { id: "m1", text: "hello" },
          enqueuedAt: 1000,
          expiresAt: 91000,
        };
        queryRows = [{ value: JSON.stringify(entry) }];
        const result = await adapter.dequeue("thread1");
        expect(result).toEqual(entry);
      });

      it("should return null from dequeue when queue is empty", async () => {
        queryRows = [];
        const result = await adapter.dequeue("thread1");
        expect(result).toBeNull();
      });

      it("should call atomic DELETE-RETURNING for dequeue", async () => {
        queryRows = [];
        await adapter.dequeue("thread1");

        const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
        const deleteCall = calls.find(
          (c: unknown[]) =>
            typeof c[0] === "string" &&
            c[0].includes("DELETE FROM chat_state_queues") &&
            c[0].includes("RETURNING value")
        );
        expect(deleteCall).toBeTruthy();
      });

      it("should return depth from queueDepth", async () => {
        queryRows = [{ depth: "5" }];
        const depth = await adapter.queueDepth("thread1");
        expect(depth).toBe(5);
      });

      it("should return 0 depth when no rows exist", async () => {
        queryRows = [{ depth: "0" }];
        const depth = await adapter.queueDepth("thread1");
        expect(depth).toBe(0);
      });
    });

    describe("getClient", () => {
      it("should return the underlying client", () => {
        const client = adapter.getClient();
        expect(client).toBeDefined();
      });
    });
  });
});
