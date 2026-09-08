import { randomUUID } from "node:crypto";
import type { QueueEntry } from "chat";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresState, postgresSchemaStatements } from "./index";

// Explicit opt-in: never use an application's POSTGRES_URL for destructive tests.
// Requires a disposable database and an administrator with CREATEROLE and
// CREATE on the database. Superuser is not required.
const testUrl = process.env.POSTGRES_TEST_URL;
const ttlMs = 300_000;
// Postgres reports whichever missing relation it resolves first.
const missingRelation =
  /^PostgreSQL state schema is not ready: relation "chat_state_[a-z]+" does not exist\. Run the adapter migration/;

describe.skipIf(!testUrl)("PostgreSQL migration-owned schema", () => {
  const suffix = randomUUID().replaceAll("-", "");
  const schema = `chat_test_${suffix}`;
  const role = `chat_runtime_${suffix}`;
  const pools: pg.Pool[] = [];
  let admin: pg.Pool;
  let runtime: pg.Pool;
  let state: ReturnType<typeof createPostgresState>;
  const schemas: string[] = [];
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
    // search_path travels with every connection the pool hands out, unlike a
    // one-off SET, which pg-pool would lose if it replaced the client.
    admin = new pg.Pool({
      connectionString: testUrl,
      options: `-c search_path=${schema}`,
      max: 1,
    });
    // Identifiers are generated from a UUID, never user-supplied SQL.
    await admin.query(`CREATE SCHEMA ${schema}`);
    schemas.push(schema);
    await admin.query(
      `CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`
    );
    roleCreated = true;
    // A non-superuser admin needs membership to SET ROLE on the runtime pools.
    await admin.query(`GRANT ${role} TO CURRENT_USER`);

    // The same statements connect() runs with autoCreateSchema: true. The unit
    // suite proves the README and adapter docs publish this exact migration.
    for (const statement of postgresSchemaStatements) {
      await admin.query(statement);
    }
    // Least privilege rather than the README's blanket grants: no UPDATE on
    // the two tables the adapter never updates, and nextval via UPDATE only
    // on the queue sequence.
    await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await admin.query(
      `GRANT SELECT, INSERT, DELETE ON chat_state_subscriptions, chat_state_queues TO ${role}`
    );
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON chat_state_locks, chat_state_cache, chat_state_lists TO ${role}`
    );
    await admin.query(
      `GRANT USAGE ON SEQUENCE chat_state_lists_seq_seq TO ${role}`
    );
    await admin.query(
      `GRANT UPDATE ON SEQUENCE chat_state_queues_seq_seq TO ${role}`
    );
    runtime = createRuntimePool();
    state = createPostgresState({ client: runtime, autoCreateSchema: false });
    await state.connect();
  });

  afterAll(async () => {
    await state?.disconnect();
    await Promise.all(pools.map(async (pool) => await pool.end()));
    try {
      for (const created of schemas) {
        await admin.query(`DROP SCHEMA ${created} CASCADE`);
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
    const granted = await runtime.query(
      `SELECT has_table_privilege('chat_state_subscriptions', 'UPDATE') AS subscriptions_update,
              has_table_privilege('chat_state_queues', 'UPDATE') AS queues_update,
              has_sequence_privilege('chat_state_queues_seq_seq', 'USAGE') AS queues_seq_usage`
    );
    expect(granted.rows).toEqual([
      {
        subscriptions_update: false,
        queues_update: false,
        queues_seq_usage: false,
      },
    ]);
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

  it("fails connect() with a descriptive error when the tables are missing", async () => {
    const pool = new pg.Pool({
      connectionString: testUrl,
      options: `-c search_path=pg_catalog -c role=${role}`,
    });
    pools.push(pool);
    const adapter = createPostgresState({
      client: pool,
      autoCreateSchema: false,
    });
    await expect(adapter.connect()).rejects.toMatchObject({
      message: expect.stringMatching(missingRelation),
      cause: expect.objectContaining({ code: "42P01" }),
    });
    await expect(adapter.subscribe("missing")).rejects.toThrow("not connected");
    await expect(pool.query("SELECT 1")).resolves.toMatchObject({
      rowCount: 1,
    });
  });

  it("fails connect() naming the objects the runtime role cannot use", async () => {
    const adapter = createPostgresState({
      client: createRuntimePool(),
      autoCreateSchema: false,
    });
    await admin.query(`REVOKE INSERT ON chat_state_cache FROM ${role}`);
    await admin.query(
      `REVOKE UPDATE ON SEQUENCE chat_state_queues_seq_seq FROM ${role}`
    );
    try {
      await expect(adapter.connect()).rejects.toThrow(
        "PostgreSQL state schema is not ready: the current role lacks privileges on chat_state_cache, chat_state_queues_seq."
      );
    } finally {
      await admin.query(`GRANT INSERT ON chat_state_cache TO ${role}`);
      await admin.query(
        `GRANT UPDATE ON SEQUENCE chat_state_queues_seq_seq TO ${role}`
      );
    }
    await expect(adapter.connect()).resolves.toBeUndefined();
  });

  it("accepts identity columns without any sequence grant", async () => {
    const identitySchema = `${schema}_identity`;
    const owner = new pg.Pool({
      connectionString: testUrl,
      options: `-c search_path=${identitySchema}`,
      max: 1,
    });
    pools.push(owner);
    await owner.query(`CREATE SCHEMA ${identitySchema}`);
    schemas.push(identitySchema);
    for (const statement of postgresSchemaStatements) {
      await owner.query(
        statement.replace(
          "seq bigserial NOT NULL",
          "seq bigint GENERATED ALWAYS AS IDENTITY"
        )
      );
    }
    await owner.query(`GRANT USAGE ON SCHEMA ${identitySchema} TO ${role}`);
    await owner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${identitySchema} TO ${role}`
    );
    const pool = new pg.Pool({
      connectionString: testUrl,
      options: `-c search_path=${identitySchema} -c role=${role}`,
      max: 1,
    });
    pools.push(pool);
    const adapter = createPostgresState({
      client: pool,
      autoCreateSchema: false,
    });
    await adapter.connect();
    await adapter.appendToList("list", { count: 1 }, { ttlMs });
    expect(await adapter.getList("list")).toEqual([{ count: 1 }]);
    const entry = {
      message: { id: "message" },
      enqueuedAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    } as QueueEntry;
    expect(await adapter.enqueue("thread", entry, 10)).toBe(1);
    expect(await adapter.dequeue("thread")).toEqual(entry);
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
