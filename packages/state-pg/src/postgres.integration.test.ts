import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { QueueEntry } from "chat";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresState } from "./index";

// Explicit opt-in: never use an application's POSTGRES_URL for destructive tests.
// Requires a disposable database and an administrator that can CREATE ROLE and SET ROLE.
const testUrl = process.env.POSTGRES_TEST_URL;
const migrationBlock = /```sql\n([\s\S]*?)```/;
const ttlMs = 300_000;

describe.skipIf(!testUrl)("PostgreSQL migration-owned schema", () => {
  const suffix = randomUUID().replaceAll("-", "");
  const schema = `chat_test_${suffix}`;
  const role = `chat_runtime_${suffix}`;
  const pools: pg.Pool[] = [];
  let admin: pg.Pool;
  let runtime: pg.Pool;
  let state: ReturnType<typeof createPostgresState>;
  let schemaCreated = false;
  let roleCreated = false;

  function createRuntimePool(max = 1) {
    const pool = new pg.Pool({
      connectionString: testUrl,
      options: `-c search_path=${schema} -c role=${role}`,
      max,
    });
    pools.push(pool);
    return pool;
  }

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: testUrl, max: 1 });
    // Identifiers are generated from a UUID, never user-supplied SQL.
    await admin.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    await admin.query(
      `CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`
    );
    roleCreated = true;
    await admin.query(`SET search_path TO ${schema}`);

    // Execute the published migration itself so documentation drift breaks this test.
    const readme = await readFile(
      new URL("../README.md", import.meta.url),
      "utf8"
    );
    const docs = await readFile(
      new URL(
        "../../../apps/docs/content/adapters/official/postgres.mdx",
        import.meta.url
      ),
      "utf8"
    );
    const migration = migrationBlock.exec(
      readme.split("### Migration-owned schema")[1]
    )?.[1];
    if (
      !migration ||
      migrationBlock.exec(docs.split("### Migration-owned schema")[1])?.[1] !==
        migration
    ) {
      throw new Error(
        "README and adapter docs must contain the same complete migration SQL"
      );
    }
    await admin.query(migration);
    await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`
    );
    await admin.query(
      `GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`
    );
    runtime = createRuntimePool();
    state = createPostgresState({ client: runtime, autoCreateSchema: false });
    await state.connect();
  });

  afterAll(async () => {
    await state?.disconnect();
    await Promise.all(pools.map(async (pool) => await pool.end()));
    try {
      if (schemaCreated) {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      }
      if (roleCreated) {
        await admin.query(`DROP ROLE ${role}`);
      }
    } finally {
      await admin?.end();
    }
  });

  it("supports every state family without object ownership or schema CREATE", async () => {
    const privileges = await runtime.query(
      "SELECT current_user AS role, has_schema_privilege(current_user, $1, 'CREATE') AS can_create",
      [schema]
    );
    expect(privileges.rows).toEqual([{ role, can_create: false }]);
    await expect(
      runtime.query("CREATE TABLE forbidden (id integer)")
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtime.query("CREATE INDEX forbidden ON chat_state_cache (cache_key)")
    ).rejects.toMatchObject({ code: "42501" });
    await state.subscribe("thread");
    expect(await state.isSubscribed("thread")).toBe(true);
    await state.unsubscribe("thread");
    expect(await state.isSubscribed("thread")).toBe(false);
    await state.set("cache", { count: 1 }, ttlMs);
    expect(await state.get("cache")).toEqual({ count: 1 });
    await state.delete("cache");
    expect(await state.get("cache")).toBeNull();
    const lock = await state.acquireLock("thread", ttlMs);
    expect(lock).not.toBeNull();
    if (!lock) {
      throw new Error("Expected lock acquisition");
    }
    expect(await state.acquireLock("thread", ttlMs)).toBeNull();
    expect(await state.extendLock(lock, ttlMs)).toBe(true);
    await state.releaseLock(lock);
    expect(await state.acquireLock("thread", ttlMs)).not.toBeNull();
    await state.forceReleaseLock("thread");
    await state.appendToList("list", { count: 1 }, { ttlMs, maxLength: 1 });
    await state.appendToList("list", { count: 2 }, { ttlMs, maxLength: 1 });
    expect(await state.getList("list")).toEqual([{ count: 2 }]);
    const entry = {
      message: { id: "message" },
      enqueuedAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    } as QueueEntry;
    expect(await state.enqueue("thread", entry, 10)).toBe(1);
    expect(await state.queueDepth("thread")).toBe(1);
    expect(await state.dequeue("thread")).toEqual(entry);
    expect(await state.dequeue("thread")).toBeNull();
    expect(await state.queueDepth("thread")).toBe(0);
  });

  it("checks connectivity without requiring tables to exist", async () => {
    const pool = new pg.Pool({
      connectionString: testUrl,
      options: `-c search_path=pg_catalog -c role=${role}`,
    });
    pools.push(pool);
    const adapter = createPostgresState({
      client: pool,
      autoCreateSchema: false,
    });
    await adapter.connect();
    await expect(adapter.subscribe("missing")).rejects.toMatchObject({
      code: "42P01",
    });
    await adapter.disconnect();
    await expect(pool.query("SELECT 1")).resolves.toMatchObject({
      rowCount: 1,
    });
  });

  it("claims an absent key and preserves future-expiring and permanent values", async () => {
    expect(await state.setIfNotExists("absent", "first", ttlMs)).toBe(true);
    const before = await runtime.query(
      "SELECT value, expires_at FROM chat_state_cache WHERE cache_key = $1",
      ["absent"]
    );
    expect(await state.setIfNotExists("absent", "second", ttlMs)).toBe(false);
    const after = await runtime.query(
      "SELECT value, expires_at FROM chat_state_cache WHERE cache_key = $1",
      ["absent"]
    );
    expect(after.rows).toEqual(before.rows);
    await state.set("permanent", "first");
    expect(await state.setIfNotExists("permanent", "second", ttlMs)).toBe(
      false
    );
    expect(await state.get("permanent")).toBe("first");
    const other = createPostgresState({
      client: runtime,
      autoCreateSchema: false,
      keyPrefix: "other",
    });
    await other.connect();
    expect(await other.setIfNotExists("permanent", "independent", ttlMs)).toBe(
      true
    );
    expect(await other.get("permanent")).toBe("independent");
    expect(await state.get("permanent")).toBe("first");
  });

  it.each([
    ttlMs,
    undefined,
  ])("renews an expired entry without get(), replacement TTL %s", async (replacementTtl) => {
    const key = `expired-${replacementTtl}`;
    await runtime.query(
      "INSERT INTO chat_state_cache (key_prefix, cache_key, value, expires_at, updated_at) VALUES ($1, $2, $3, now() - interval '1 day', now() - interval '1 day')",
      ["chat-sdk", key, '"old"']
    );
    expect(await state.setIfNotExists(key, "new", replacementTtl)).toBe(true);
    const result = await runtime.query(
      "SELECT value, expires_at, updated_at > now() - interval '1 minute' AS updated FROM chat_state_cache WHERE cache_key = $1",
      [key]
    );
    expect(result.rows[0].value).toBe('"new"');
    expect(result.rows[0].updated).toBe(true);
    if (replacementTtl) {
      expect(result.rows[0].expires_at.getTime()).toBeGreaterThan(Date.now());
    } else {
      expect(result.rows[0].expires_at).toBeNull();
    }
  });

  it("renews at the exact expiry boundary using the same transaction clock", async () => {
    // A dedicated max:1 pool keeps BEGIN, seed, adapter query and ROLLBACK on one connection.
    const pool = createRuntimePool();
    const adapter = createPostgresState({
      client: pool,
      autoCreateSchema: false,
    });
    await adapter.connect();
    await pool.query("BEGIN");
    try {
      await pool.query(
        "INSERT INTO chat_state_cache (key_prefix, cache_key, value, expires_at) VALUES ('chat-sdk', 'boundary', '\"old\"', now())"
      );
      expect(await adapter.setIfNotExists("boundary", "new", ttlMs)).toBe(true);
      expect(await adapter.get("boundary")).toBe("new");
    } finally {
      await pool.query("ROLLBACK");
    }
  });

  it.each([
    "absent",
    "expired",
  ])("has exactly one winner for concurrent %s-key claims", async (initialState) => {
    const key = `concurrent-${initialState}`;
    if (initialState === "expired") {
      await runtime.query(
        "INSERT INTO chat_state_cache (key_prefix, cache_key, value, expires_at) VALUES ($1, $2, $3, now() - interval '1 day')",
        ["chat-sdk", key, '"old"']
      );
    }
    const contenders = Array.from({ length: 8 }, () =>
      createPostgresState({
        client: createRuntimePool(),
        autoCreateSchema: false,
      })
    );
    await Promise.all(
      contenders.map(async (adapter) => await adapter.connect())
    );
    const pids = await Promise.all(
      contenders.map(
        async (adapter) =>
          (await adapter.getClient().query("SELECT pg_backend_pid() AS pid"))
            .rows[0].pid
      )
    );
    expect(new Set(pids).size).toBe(contenders.length);
    const results = await Promise.all(
      contenders.map(
        async (adapter, index) =>
          await adapter.setIfNotExists(key, index, ttlMs)
      )
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await state.get(key)).toBe(results.indexOf(true));
  });
});
