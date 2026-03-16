import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import type { Lock, Logger } from "chat";
import pg from "pg";
import { GenericContainer, Wait } from "testcontainers";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { createSupabaseState, SupabaseStateAdapter } = await import("./index");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_PREFIX = "chat-sdk";

const mockLogger: Logger = {
  child: () => mockLogger,
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

type RpcArgs = Record<string, unknown> | undefined;
type RpcCall = { args?: RpcArgs; fn: string; schema: string };
type RpcResponse = { data: unknown; error: Error | null };

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, reject, resolve };
}

function createMockSupabaseClient(
  handler?: (schemaName: string, fn: string, args?: RpcArgs) => RpcResponse | Promise<RpcResponse>
) {
  const calls: RpcCall[] = [];
  const resolvedHandler =
    handler ?? (() => ({ data: null, error: null } satisfies RpcResponse));

  const schema = vi.fn().mockImplementation((schemaName: string) => ({
    rpc: vi.fn().mockImplementation((fn: string, args?: RpcArgs) => {
      calls.push({ args, fn, schema: schemaName });
      return Promise.resolve(resolvedHandler(schemaName, fn, args));
    }),
  }));

  return {
    calls,
    client: { schema } as unknown as SupabaseClient<any, any, any>,
    schema,
  };
}

describe("SupabaseStateAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should export createSupabaseState function", () => {
    expect(typeof createSupabaseState).toBe("function");
  });

  it("should export SupabaseStateAdapter class", () => {
    expect(typeof SupabaseStateAdapter).toBe("function");
  });

  describe("createSupabaseState", () => {
    it("should create an adapter with an existing client", () => {
      const { client } = createMockSupabaseClient();
      const adapter = createSupabaseState({ client, logger: mockLogger });
      expect(adapter).toBeInstanceOf(SupabaseStateAdapter);
    });

    it("should create an adapter with custom keyPrefix", () => {
      const { client } = createMockSupabaseClient();
      const adapter = createSupabaseState({
        client,
        keyPrefix: "custom-prefix",
        logger: mockLogger,
      });
      expect(adapter).toBeInstanceOf(SupabaseStateAdapter);
    });

    it("should use default logger when none provided", () => {
      const { client } = createMockSupabaseClient();
      const adapter = createSupabaseState({ client });
      expect(adapter).toBeInstanceOf(SupabaseStateAdapter);
    });

    it("should throw when no client is provided", () => {
      expect(() =>
        createSupabaseState({} as Parameters<typeof createSupabaseState>[0])
      ).toThrow("Supabase client is required");
    });
  });

  describe("ensureConnected", () => {
    function createUnconnectedAdapter() {
      const { client } = createMockSupabaseClient();
      return new SupabaseStateAdapter({ client, logger: mockLogger });
    }

    it("should throw when calling subscribe before connect", async () => {
      const adapter = createUnconnectedAdapter();
      await expect(adapter.subscribe("thread1")).rejects.toThrow("not connected");
    });

    it("should throw when calling acquireLock before connect", async () => {
      const adapter = createUnconnectedAdapter();
      await expect(adapter.acquireLock("thread1", 5000)).rejects.toThrow(
        "not connected"
      );
    });

    it("should throw when calling releaseLock before connect", async () => {
      const adapter = createUnconnectedAdapter();
      const lock: Lock = {
        expiresAt: Date.now() + 5000,
        threadId: "thread1",
        token: "tok",
      };
      await expect(adapter.releaseLock(lock)).rejects.toThrow("not connected");
    });

    it("should throw when calling get before connect", async () => {
      const adapter = createUnconnectedAdapter();
      await expect(adapter.get("key")).rejects.toThrow("not connected");
    });

    it("should throw when calling appendToList before connect", async () => {
      const adapter = createUnconnectedAdapter();
      await expect(adapter.appendToList("key", "value")).rejects.toThrow(
        "not connected"
      );
    });
  });

  describe("with mock client", () => {
    let adapter: InstanceType<typeof SupabaseStateAdapter>;
    let calls: RpcCall[];
    let response: RpcResponse;

    beforeEach(async () => {
      response = { data: true, error: null };
      const mock = createMockSupabaseClient(() => response);
      calls = mock.calls;
      adapter = new SupabaseStateAdapter({
        client: mock.client,
        logger: mockLogger,
      });
      await adapter.connect();
      calls.length = 0;
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe("connect / disconnect", () => {
      it("should be idempotent on connect", async () => {
        await adapter.connect();
        await adapter.connect();
        expect(calls).toEqual([]);
      });

      it("should deduplicate concurrent connect calls", async () => {
        const deferred = createDeferred<RpcResponse>();
        const mock = createMockSupabaseClient(() => deferred.promise);
        const concurrentAdapter = new SupabaseStateAdapter({
          client: mock.client,
          logger: mockLogger,
        });

        const pending = Promise.all([
          concurrentAdapter.connect(),
          concurrentAdapter.connect(),
        ]);

        expect(mock.calls).toHaveLength(1);
        expect(mock.calls[0]).toMatchObject({
          args: {},
          fn: "chat_state_connect",
          schema: "chat_state",
        });

        deferred.resolve({ data: true, error: null });
        await pending;
      });

      it("should be idempotent on disconnect", async () => {
        await adapter.disconnect();
        await adapter.disconnect();
      });

      it("should handle connect failure and allow retry", async () => {
        const error = new Error("migration missing");
        const mock = createMockSupabaseClient(() => ({ data: null, error }));
        const failingAdapter = new SupabaseStateAdapter({
          client: mock.client,
          logger: mockLogger,
        });

        await expect(failingAdapter.connect()).rejects.toThrow("migration missing");
        expect(mockLogger.error).toHaveBeenCalled();

        await expect(failingAdapter.connect()).rejects.toThrow("migration missing");
        expect(mock.calls).toHaveLength(2);
      });
    });

    describe("subscriptions", () => {
      it("should subscribe using the expected RPC and arguments", async () => {
        await adapter.subscribe("slack:C123:1234.5678");
        expect(calls[0]).toEqual({
          args: {
            p_key_prefix: "chat-sdk",
            p_thread_id: "slack:C123:1234.5678",
          },
          fn: "chat_state_subscribe",
          schema: "chat_state",
        });
      });

      it("should unsubscribe using the expected RPC and arguments", async () => {
        await adapter.unsubscribe("slack:C123:1234.5678");
        expect(calls[0]).toEqual({
          args: {
            p_key_prefix: "chat-sdk",
            p_thread_id: "slack:C123:1234.5678",
          },
          fn: "chat_state_unsubscribe",
          schema: "chat_state",
        });
      });

      it("should return true when subscribed", async () => {
        response = { data: true, error: null };
        const result = await adapter.isSubscribed("thread1");
        expect(result).toBe(true);
      });

      it("should return false when not subscribed", async () => {
        response = { data: false, error: null };
        const result = await adapter.isSubscribed("thread1");
        expect(result).toBe(false);
      });
    });

    describe("locking", () => {
      it("should acquire a lock when lock data is returned", async () => {
        response = {
          data: {
            expiresAt: Date.now() + 5000,
            threadId: "thread1",
            token: "sb_test-token",
          },
          error: null,
        };

        const lock = await adapter.acquireLock("thread1", 5000);
        expect(lock !== null).toBe(true);
        expect(lock?.threadId).toBe("thread1");
        expect(lock?.token).toBe("sb_test-token");
      });

      it("should return null when lock is already held", async () => {
        response = { data: null, error: null };
        const lock = await adapter.acquireLock("thread1", 5000);
        expect(lock).toBeNull();
      });

      it("should release a lock with the expected RPC arguments", async () => {
        const lock: Lock = {
          expiresAt: Date.now() + 5000,
          threadId: "thread1",
          token: "sb_test-token",
        };

        await adapter.releaseLock(lock);
        expect(calls[0]).toEqual({
          args: {
            p_key_prefix: "chat-sdk",
            p_thread_id: "thread1",
            p_token: "sb_test-token",
          },
          fn: "chat_state_release_lock",
          schema: "chat_state",
        });
      });

      it("should return true when lock extension succeeds", async () => {
        response = { data: true, error: null };
        const lock: Lock = {
          expiresAt: Date.now() + 5000,
          threadId: "thread1",
          token: "sb_test-token",
        };

        const result = await adapter.extendLock(lock, 5000);
        expect(result).toBe(true);
      });

      it("should force-release a lock with the expected RPC arguments", async () => {
        await adapter.forceReleaseLock("thread1");
        expect(calls[0]).toEqual({
          args: {
            p_key_prefix: "chat-sdk",
            p_thread_id: "thread1",
          },
          fn: "chat_state_force_release_lock",
          schema: "chat_state",
        });
      });
    });

    describe("cache", () => {
      it("should return JSON data on cache hit", async () => {
        response = { data: { foo: "bar" }, error: null };
        const result = await adapter.get("key");
        expect(result).toEqual({ foo: "bar" });
      });

      it("should return string data on cache hit", async () => {
        response = { data: "plain-text", error: null };
        const result = await adapter.get("key");
        expect(result).toBe("plain-text");
      });

      it("should return null on cache miss", async () => {
        response = { data: null, error: null };
        const result = await adapter.get("key");
        expect(result).toBeNull();
      });

      it("should set a value with the expected RPC arguments", async () => {
        await adapter.set("key", { foo: "bar" }, 5000);
        expect(calls[0]).toEqual({
          args: {
            p_cache_key: "key",
            p_key_prefix: "chat-sdk",
            p_ttl_ms: 5000,
            p_value: { foo: "bar" },
          },
          fn: "chat_state_set",
          schema: "chat_state",
        });
      });

      it("should return true when setIfNotExists stores a value", async () => {
        response = { data: true, error: null };
        const result = await adapter.setIfNotExists("key", "value", 5000);
        expect(result).toBe(true);
      });

      it("should delete a key with the expected RPC arguments", async () => {
        await adapter.delete("key");
        expect(calls[0]).toEqual({
          args: {
            p_cache_key: "key",
            p_key_prefix: "chat-sdk",
          },
          fn: "chat_state_delete",
          schema: "chat_state",
        });
      });
    });

    describe("appendToList / getList", () => {
      it("should append to a list with the expected RPC arguments", async () => {
        await adapter.appendToList("mylist", { foo: "bar" }, { maxLength: 10, ttlMs: 60000 });
        expect(calls[0]).toEqual({
          args: {
            p_key_prefix: "chat-sdk",
            p_list_key: "mylist",
            p_max_length: 10,
            p_ttl_ms: 60000,
            p_value: { foo: "bar" },
          },
          fn: "chat_state_append_to_list",
          schema: "chat_state",
        });
      });

      it("should pass p_max_length null when maxLength is 0 or omitted (no trim)", async () => {
        await adapter.appendToList("mylist", { x: 1 }, { maxLength: 0 });
        expect(calls[0].args).toMatchObject({ p_max_length: null });

        await adapter.appendToList("mylist", { x: 2 });
        expect(calls[1].args).toMatchObject({ p_max_length: null });
      });

      it("should return parsed list items from getList", async () => {
        response = { data: [{ id: 1 }, { id: 2 }], error: null };
        const result = await adapter.getList("mylist");
        expect(result).toEqual([{ id: 1 }, { id: 2 }]);
      });

      it("should return empty array when getList returns null", async () => {
        response = { data: null, error: null };
        const result = await adapter.getList("mylist");
        expect(result).toEqual([]);
      });
    });

    describe("getClient", () => {
      it("should return the underlying client", () => {
        const client = adapter.getClient();
        expect(client).toBeDefined();
      });
    });
  });

  // Integration: real Postgres via Testcontainers. Run with pnpm test:integration (RUN_INTEGRATION=1).
  describe.skipIf(!process.env.RUN_INTEGRATION)(
    "integration (Testcontainers Postgres)",
    { timeout: 120_000 },
    () => {
      let container: Awaited<ReturnType<GenericContainer["start"]>>;
      let pool: pg.Pool;
      let connectionString: string;

      beforeAll(async () => {
        const postgres = await new GenericContainer("postgres:16-alpine")
          .withEnvironment({ POSTGRES_PASSWORD: "postgres" })
          .withExposedPorts(5432)
          .withWaitStrategy(
            Wait.forLogMessage(/database system is ready to accept connections/, 2)
          )
          .withStartupTimeout(60_000)
          .start();

        container = postgres;
        const host = postgres.getHost();
        const port = postgres.getMappedPort(5432);
        connectionString = `postgres://postgres:postgres@${host}:${port}/postgres`;

        pool = new pg.Pool({ connectionString });

        await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
          CREATE ROLE service_role;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated;
        END IF;
      END $$;
    `);

        const sqlPath = path.join(__dirname, "..", "sql", "chat_state.sql");
        const migrationSql = fs.readFileSync(sqlPath, "utf-8");
        await postgres.copyContentToContainer([
          { content: migrationSql, target: "/tmp/chat_state.sql" },
        ]);
        // Stop on first error so we see which statement failed (e.g. CREATE FUNCTION).
        const exec = await postgres.exec([
          "psql",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          "postgres",
          "-f",
          "/tmp/chat_state.sql",
        ]);
        if (exec.exitCode !== 0) {
          const out = exec.output ?? "";
          const err = (exec as { errorOutput?: string }).errorOutput ?? "";
          throw new Error(
            `Migration failed: exit ${exec.exitCode}\nstdout:\n${out}\nstderr:\n${err}`
          );
        }

        // Ensure append_to_list was created (catches CREATE failures that would otherwise surface as "function does not exist").
        const { rows: procs } = await pool.query<{ proname: string; args: string }>(`
          SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
          FROM pg_proc p
          JOIN pg_namespace n ON p.pronamespace = n.oid
          WHERE n.nspname = 'chat_state'
          ORDER BY p.proname
        `);
        const appendFn = procs.find((r) => r.proname === "chat_state_append_to_list");
        if (!appendFn) {
          throw new Error(
            `chat_state_append_to_list not found after migration. Functions in chat_state: ${procs.map((p) => `${p.proname}(${p.args})`).join(", ")}`
          );
        }
      }, 90_000);

      afterAll(async () => {
        if (pool) await pool.end();
        if (container) await container.stop();
      });

      describe("schema and RPC exposure", () => {
        it("chat_state schema exists", async () => {
          const { rows } = await pool.query(
            "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'chat_state'"
          );
          expect(rows).toHaveLength(1);
          expect(rows[0].schema_name).toBe("chat_state");
        });

        it("chat_state_connect returns true", async () => {
          const { rows } = await pool.query(
            "SELECT chat_state.chat_state_connect() AS result"
          );
          expect(rows).toHaveLength(1);
          expect(rows[0].result).toBe(true);
        });

        it("chat_state_subscribe / is_subscribed / unsubscribe", async () => {
          await pool.query("SELECT chat_state.chat_state_subscribe($1, $2)", [
            KEY_PREFIX,
            "thread-1",
          ]);
          const { rows: sub } = await pool.query(
            "SELECT chat_state.chat_state_is_subscribed($1, $2) AS result",
            [KEY_PREFIX, "thread-1"]
          );
          expect(sub[0].result).toBe(true);

          await pool.query("SELECT chat_state.chat_state_unsubscribe($1, $2)", [
            KEY_PREFIX,
            "thread-1",
          ]);
          const { rows: unsub } = await pool.query(
            "SELECT chat_state.chat_state_is_subscribed($1, $2) AS result",
            [KEY_PREFIX, "thread-1"]
          );
          expect(unsub[0].result).toBe(false);
        });

        it("chat_state_acquire_lock returns lock shape and expires when held", async () => {
          const token1 = "sb_test_" + Date.now();
          const ttlMs = 30_000;
          const { rows: r1 } = await pool.query(
            "SELECT chat_state.chat_state_acquire_lock($1, $2, $3, $4) AS result",
            [KEY_PREFIX, "thread-lock", token1, ttlMs]
          );
          expect(r1).toHaveLength(1);
          const lock = r1[0].result as {
            threadId: string;
            token: string;
            expiresAt: number;
          } | null;
          expect(lock !== null).toBe(true);
          expect(lock!.threadId).toBe("thread-lock");
          expect(lock!.token).toBe(token1);
          expect(typeof lock!.expiresAt).toBe("number");
          expect(lock!.expiresAt).toBeGreaterThan(Date.now());

          const token2 = "sb_other_" + Date.now();
          const { rows: r2 } = await pool.query(
            "SELECT chat_state.chat_state_acquire_lock($1, $2, $3, $4) AS result",
            [KEY_PREFIX, "thread-lock", token2, ttlMs]
          );
          expect(r2[0].result).toBeNull();

          await pool.query(
            "SELECT chat_state.chat_state_release_lock($1, $2, $3)",
            [KEY_PREFIX, "thread-lock", token1]
          );
        });

        it("chat_state_set / get / delete and jsonb roundtrip", async () => {
          await pool.query(
            "SELECT chat_state.chat_state_set($1, $2, $3, $4)",
            [
              KEY_PREFIX,
              "cache-key-1",
              JSON.stringify({ foo: "bar", n: 42 }),
              60_000,
            ]
          );
          const { rows: get } = await pool.query(
            "SELECT chat_state.chat_state_get($1, $2) AS result",
            [KEY_PREFIX, "cache-key-1"]
          );
          expect(get[0].result).toEqual({ foo: "bar", n: 42 });

          await pool.query("SELECT chat_state.chat_state_delete($1, $2)", [
            KEY_PREFIX,
            "cache-key-1",
          ]);
          const { rows: miss } = await pool.query(
            "SELECT chat_state.chat_state_get($1, $2) AS result",
            [KEY_PREFIX, "cache-key-1"]
          );
          expect(miss[0].result).toBeNull();
        });

        it("chat_state_set_if_not_exists inserts only when missing or expired", async () => {
          const { rows: first } = await pool.query(
            "SELECT chat_state.chat_state_set_if_not_exists($1, $2, $3, $4) AS result",
            [KEY_PREFIX, "dedupe-key", JSON.stringify(true), 10_000]
          );
          expect(first[0].result).toBe(true);

          const { rows: second } = await pool.query(
            "SELECT chat_state.chat_state_set_if_not_exists($1, $2, $3, $4) AS result",
            [KEY_PREFIX, "dedupe-key", JSON.stringify(true), 10_000]
          );
          expect(second[0].result).toBe(false);
        });

        it("chat_state_append_to_list and get_list", async () => {
          await pool.query(
            "SELECT chat_state.chat_state_append_to_list($1::text, $2::text, $3::jsonb, $4::bigint, $5::bigint)",
            [KEY_PREFIX, "list-1", JSON.stringify({ id: 1 }), 10, 60_000]
          );
          await pool.query(
            "SELECT chat_state.chat_state_append_to_list($1::text, $2::text, $3::jsonb, $4::bigint, $5::bigint)",
            [KEY_PREFIX, "list-1", JSON.stringify({ id: 2 }), 10, 60_000]
          );
          const { rows } = await pool.query(
            "SELECT chat_state.chat_state_get_list($1, $2) AS result",
            [KEY_PREFIX, "list-1"]
          );
          expect(rows[0].result).toEqual([{ id: 1 }, { id: 2 }]);
        });

        it("chat_state_cleanup_expired returns counts", async () => {
          const { rows } = await pool.query(
            "SELECT chat_state.chat_state_cleanup_expired() AS result"
          );
          const result = rows[0].result as {
            cache: number;
            lists: number;
            locks: number;
          };
          expect(typeof result.cache).toBe("number");
          expect(typeof result.lists).toBe("number");
          expect(typeof result.locks).toBe("number");
        });
      });

      describe("adapter against real Postgres", () => {
        const RPC_PARAM_ORDER: Record<string, string[]> = {
          chat_state_connect: [],
          chat_state_subscribe: ["p_key_prefix", "p_thread_id"],
          chat_state_unsubscribe: ["p_key_prefix", "p_thread_id"],
          chat_state_is_subscribed: ["p_key_prefix", "p_thread_id"],
          chat_state_acquire_lock: [
            "p_key_prefix",
            "p_thread_id",
            "p_token",
            "p_ttl_ms",
          ],
          chat_state_force_release_lock: ["p_key_prefix", "p_thread_id"],
          chat_state_release_lock: [
            "p_key_prefix",
            "p_thread_id",
            "p_token",
          ],
          chat_state_extend_lock: [
            "p_key_prefix",
            "p_thread_id",
            "p_token",
            "p_ttl_ms",
          ],
          chat_state_get: ["p_key_prefix", "p_cache_key"],
          chat_state_set: [
            "p_key_prefix",
            "p_cache_key",
            "p_value",
            "p_ttl_ms",
          ],
          chat_state_set_if_not_exists: [
            "p_key_prefix",
            "p_cache_key",
            "p_value",
            "p_ttl_ms",
          ],
          chat_state_delete: ["p_key_prefix", "p_cache_key"],
          chat_state_append_to_list: [
            "p_key_prefix",
            "p_list_key",
            "p_value",
            "p_max_length",
            "p_ttl_ms",
          ],
          chat_state_get_list: ["p_key_prefix", "p_list_key"],
          chat_state_cleanup_expired: ["p_key_prefix"],
        };

        it("adapter connect, subscribe, get, set with pg-backed fake client", async () => {
          const poolForClient = new pg.Pool({ connectionString });

          const fakeSupabase = {
            schema: (_schemaName: string) => ({
              rpc: async (fn: string, args: Record<string, unknown>) => {
                const paramOrder = RPC_PARAM_ORDER[fn] ?? [];
                const values = paramOrder.map((name) => args[name]);
                const placeholders = values
                  .map((_, i) => `$${i + 1}`)
                  .join(", ");
                const sql = `SELECT chat_state.${fn}(${placeholders}) AS result`;
                const { rows } = await poolForClient.query(
                  sql,
                  values as unknown[]
                );
                const data = rows[0]?.result ?? null;
                return { data, error: null };
              },
            }),
          } as unknown as ReturnType<typeof createClient>;

          const adapter = createSupabaseState({ client: fakeSupabase });
          await adapter.connect();
          await adapter.subscribe("integration-thread");
          const subscribed = await adapter.isSubscribed("integration-thread");
          expect(subscribed).toBe(true);

          await adapter.set("integration-cache-key", { x: 1 }, 5000);
          const value =
            await adapter.get<{ x: number }>("integration-cache-key");
          expect(value).toEqual({ x: 1 });

          await adapter.disconnect();
          await poolForClient.end();
        });
      });
    }
  );
});
