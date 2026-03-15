import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lock, Logger } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createSupabaseState, SupabaseStateAdapter } = await import("./index");

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

    it("should create an adapter with custom schema and keyPrefix", () => {
      const { client } = createMockSupabaseClient();
      const adapter = createSupabaseState({
        client,
        keyPrefix: "custom-prefix",
        logger: mockLogger,
        schema: "custom_state",
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
        expect(lock).not.toBeNull();
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

    it("should use a custom schema for RPC calls", async () => {
      const mock = createMockSupabaseClient(() => ({ data: true, error: null }));
      const customSchemaAdapter = new SupabaseStateAdapter({
        client: mock.client,
        logger: mockLogger,
        schema: "bot_state",
      });

      await customSchemaAdapter.connect();
      await customSchemaAdapter.subscribe("thread1");

      expect(mock.calls[0]?.schema).toBe("bot_state");
      expect(mock.calls[1]?.schema).toBe("bot_state");
    });
  });
});
