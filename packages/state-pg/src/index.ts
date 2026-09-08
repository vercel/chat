import type { Lock, Logger, QueueEntry, StateAdapter } from "chat";
import { ConsoleLogger } from "chat";
import pg from "pg";

export interface PostgresStateAdapterUrlOptions {
  /** Create tables and indexes on connect (default: true). Disable for migration-owned schemas. */
  autoCreateSchema?: boolean;
  client?: never;
  /** Key prefix for all rows (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger?: Logger;
  /** Postgres connection URL. Defaults to POSTGRES_URL or DATABASE_URL env var. */
  url?: string;
}

export interface PostgresStateAdapterClientOptions {
  /** Create tables and indexes on connect (default: true). Disable for migration-owned schemas. */
  autoCreateSchema?: boolean;
  /** Existing pg.Pool instance */
  client: pg.Pool;
  /** Key prefix for all rows (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger?: Logger;
}

export type PostgresStateAdapterOptions =
  | PostgresStateAdapterUrlOptions
  | PostgresStateAdapterClientOptions;

/**
 * @deprecated Use `PostgresStateAdapterClientOptions`. Renamed for consistency
 * with the rest of the state adapter packages.
 */
export type PostgresStateClientOptions = PostgresStateAdapterClientOptions;

/**
 * @deprecated Use `PostgresStateAdapterOptions`. Renamed for consistency with
 * the rest of the state adapter packages.
 */
export type CreatePostgresStateOptions = PostgresStateAdapterOptions;

/**
 * Complete adapter schema, in execution order. `connect()` runs these with
 * `autoCreateSchema: true`; migration-owned deployments can run them from
 * their own tooling. Table and index names are unqualified and resolve
 * against the connection's `search_path`.
 */
export const postgresSchemaStatements: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS chat_state_subscriptions (
    key_prefix text NOT NULL,
    thread_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (key_prefix, thread_id)
  )`,
  `CREATE TABLE IF NOT EXISTS chat_state_locks (
    key_prefix text NOT NULL,
    thread_id text NOT NULL,
    token text NOT NULL,
    expires_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (key_prefix, thread_id)
  )`,
  `CREATE TABLE IF NOT EXISTS chat_state_cache (
    key_prefix text NOT NULL,
    cache_key text NOT NULL,
    value text NOT NULL,
    expires_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (key_prefix, cache_key)
  )`,
  `CREATE INDEX IF NOT EXISTS chat_state_locks_expires_idx
    ON chat_state_locks (expires_at)`,
  `CREATE INDEX IF NOT EXISTS chat_state_cache_expires_idx
    ON chat_state_cache (expires_at)`,
  `CREATE TABLE IF NOT EXISTS chat_state_lists (
    key_prefix text NOT NULL,
    list_key text NOT NULL,
    seq bigserial NOT NULL,
    value text NOT NULL,
    expires_at timestamptz,
    PRIMARY KEY (key_prefix, list_key, seq)
  )`,
  `CREATE INDEX IF NOT EXISTS chat_state_lists_expires_idx
    ON chat_state_lists (expires_at)`,
  `CREATE TABLE IF NOT EXISTS chat_state_queues (
    key_prefix text NOT NULL,
    thread_id text NOT NULL,
    seq bigserial NOT NULL,
    value text NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (key_prefix, thread_id, seq)
  )`,
  `CREATE INDEX IF NOT EXISTS chat_state_queues_expires_idx
    ON chat_state_queues (expires_at)`,
];

// Privileges each table actually needs. Subscriptions and queues are never
// updated: subscribe() uses ON CONFLICT DO NOTHING, which needs INSERT only.
const tablePrivileges: Readonly<Record<string, readonly string[]>> = {
  chat_state_subscriptions: ["SELECT", "INSERT", "DELETE"],
  chat_state_locks: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  chat_state_cache: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  chat_state_lists: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  chat_state_queues: ["SELECT", "INSERT", "DELETE"],
};

const sequenceTables = ["chat_state_lists", "chat_state_queues"] as const;

// has_table_privilege() with a comma-separated list is true when ANY listed
// privilege is held, so each privilege is checked on its own and ANDed.
function tablePrivilegeCheck(table: string, privileges: readonly string[]) {
  return privileges
    .map((privilege) => `has_table_privilege('${table}', '${privilege}')`)
    .join(" AND ");
}

// nextval() is allowed by either USAGE or UPDATE on the sequence, and identity
// columns skip the sequence permission check entirely. pg_get_serial_sequence
// returns NULL (skipped) when seq has no owned sequence.
function sequencePrivilegeCheck(table: string) {
  return (
    `(SELECT attidentity <> '' FROM pg_catalog.pg_attribute WHERE attrelid = '${table}'::regclass AND attname = 'seq')` +
    ` OR has_sequence_privilege(pg_get_serial_sequence('${table}', 'seq'), 'USAGE, UPDATE')`
  );
}

// One round trip, no DDL rights needed. A missing table raises 42P01; a
// missing grant yields false.
const schemaProbe = `SELECT ${[
  ...Object.entries(tablePrivileges).map(
    ([table, privileges]) =>
      `${tablePrivilegeCheck(table, privileges)} AS ${table}`
  ),
  ...sequenceTables.map(
    (table) => `${sequencePrivilegeCheck(table)} AS ${table}_seq`
  ),
].join(",\n  ")}`;

const schemaErrorPrefix = "PostgreSQL state schema is not ready";
const schemaErrorHint =
  "Run the adapter migration on this database and search_path, grant the runtime role access, or set autoCreateSchema: true.";

export class PostgresStateAdapter implements StateAdapter {
  private readonly autoCreateSchema: boolean;
  private readonly pool: pg.Pool;
  private readonly keyPrefix: string;
  private readonly logger: Logger;
  private readonly ownsClient: boolean;
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  constructor(options: PostgresStateAdapterOptions) {
    if ("client" in options && options.client) {
      this.pool = options.client;
      this.ownsClient = false;
    } else {
      const url = options.url;
      if (!url) {
        throw new Error(
          "Postgres url is required. Set POSTGRES_URL or DATABASE_URL, or provide it in options."
        );
      }
      this.pool = new pg.Pool({ connectionString: url });
      this.ownsClient = true;
    }

    this.autoCreateSchema = options.autoCreateSchema ?? true;
    this.keyPrefix = options.keyPrefix || "chat-sdk";
    this.logger = options.logger ?? new ConsoleLogger("info").child("postgres");
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (!this.connectPromise) {
      this.connectPromise = (async () => {
        try {
          await this.pool.query("SELECT 1");
          if (this.autoCreateSchema) {
            await this.ensureSchema();
          } else {
            await this.verifySchema();
          }
          this.connected = true;
        } catch (error) {
          this.connectPromise = null;
          this.logger.error("Postgres connect failed", { error });
          throw error;
        }
      })();
    }

    await this.connectPromise;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    if (this.ownsClient) {
      await this.pool.end();
    }

    this.connected = false;
    this.connectPromise = null;
  }

  async subscribe(threadId: string): Promise<void> {
    this.ensureConnected();

    await this.pool.query(
      `INSERT INTO chat_state_subscriptions (key_prefix, thread_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [this.keyPrefix, threadId]
    );
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.ensureConnected();

    await this.pool.query(
      `DELETE FROM chat_state_subscriptions
       WHERE key_prefix = $1 AND thread_id = $2`,
      [this.keyPrefix, threadId]
    );
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    this.ensureConnected();

    const result = await this.pool.query(
      `SELECT 1 FROM chat_state_subscriptions
       WHERE key_prefix = $1 AND thread_id = $2
       LIMIT 1`,
      [this.keyPrefix, threadId]
    );

    return result.rows.length > 0;
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    this.ensureConnected();

    const token = generateToken();
    const expiresAt = new Date(Date.now() + ttlMs);

    const result = await this.pool.query(
      `INSERT INTO chat_state_locks (key_prefix, thread_id, token, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key_prefix, thread_id) DO UPDATE
         SET token = EXCLUDED.token,
             expires_at = EXCLUDED.expires_at,
             updated_at = now()
         WHERE chat_state_locks.expires_at <= now()
       RETURNING thread_id, token, expires_at`,
      [this.keyPrefix, threadId, token, expiresAt]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return {
      threadId: result.rows[0].thread_id as string,
      token: result.rows[0].token as string,
      expiresAt: (result.rows[0].expires_at as Date).getTime(),
    };
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    this.ensureConnected();

    await this.pool.query(
      `DELETE FROM chat_state_locks
       WHERE key_prefix = $1 AND thread_id = $2`,
      [this.keyPrefix, threadId]
    );
  }

  async releaseLock(lock: Lock): Promise<void> {
    this.ensureConnected();

    await this.pool.query(
      `DELETE FROM chat_state_locks
       WHERE key_prefix = $1 AND thread_id = $2 AND token = $3`,
      [this.keyPrefix, lock.threadId, lock.token]
    );
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    this.ensureConnected();

    const result = await this.pool.query(
      `UPDATE chat_state_locks
       SET expires_at = now() + $1 * interval '1 millisecond',
           updated_at = now()
       WHERE key_prefix = $2
         AND thread_id = $3
         AND token = $4
         AND expires_at > now()
       RETURNING thread_id`,
      [ttlMs, this.keyPrefix, lock.threadId, lock.token]
    );

    return result.rows.length > 0;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    this.ensureConnected();

    const result = await this.pool.query(
      `SELECT value FROM chat_state_cache
       WHERE key_prefix = $1 AND cache_key = $2
         AND (expires_at IS NULL OR expires_at > now())
       LIMIT 1`,
      [this.keyPrefix, key]
    );

    if (result.rows.length === 0) {
      // Opportunistic cleanup of expired entry
      await this.pool.query(
        `DELETE FROM chat_state_cache
         WHERE key_prefix = $1 AND cache_key = $2
           AND expires_at <= now()`,
        [this.keyPrefix, key]
      );

      return null;
    }

    try {
      return JSON.parse(result.rows[0].value as string) as T;
    } catch {
      return result.rows[0].value as unknown as T;
    }
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.ensureConnected();

    const serialized = JSON.stringify(value);
    const expiresAt = ttlMs ? new Date(Date.now() + ttlMs) : null;

    await this.pool.query(
      `INSERT INTO chat_state_cache (key_prefix, cache_key, value, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key_prefix, cache_key) DO UPDATE
         SET value = EXCLUDED.value,
             expires_at = EXCLUDED.expires_at,
             updated_at = now()`,
      [this.keyPrefix, key, serialized, expiresAt]
    );
  }

  async setIfNotExists(
    key: string,
    value: unknown,
    ttlMs?: number
  ): Promise<boolean> {
    this.ensureConnected();

    const serialized = JSON.stringify(value);
    const expiresAt = ttlMs ? new Date(Date.now() + ttlMs) : null;

    const result = await this.pool.query(
      `INSERT INTO chat_state_cache (key_prefix, cache_key, value, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key_prefix, cache_key) DO UPDATE
         SET value = EXCLUDED.value,
             expires_at = EXCLUDED.expires_at,
             updated_at = now()
         WHERE chat_state_cache.expires_at IS NOT NULL
           AND chat_state_cache.expires_at <= now()
       RETURNING cache_key`,
      [this.keyPrefix, key, serialized, expiresAt]
    );

    return result.rows.length > 0;
  }

  async delete(key: string): Promise<void> {
    this.ensureConnected();

    await this.pool.query(
      `DELETE FROM chat_state_cache
       WHERE key_prefix = $1 AND cache_key = $2`,
      [this.keyPrefix, key]
    );
  }

  async appendToList(
    key: string,
    value: unknown,
    options?: { maxLength?: number; ttlMs?: number }
  ): Promise<void> {
    this.ensureConnected();

    const serialized = JSON.stringify(value);
    const expiresAt = options?.ttlMs
      ? new Date(Date.now() + options.ttlMs)
      : null;

    // Insert the new entry
    await this.pool.query(
      `INSERT INTO chat_state_lists (key_prefix, list_key, value, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [this.keyPrefix, key, serialized, expiresAt]
    );

    // Trim overflow if maxLength is specified
    if (options?.maxLength) {
      await this.pool.query(
        `DELETE FROM chat_state_lists
         WHERE key_prefix = $1 AND list_key = $2 AND seq IN (
           SELECT seq FROM chat_state_lists
           WHERE key_prefix = $1 AND list_key = $2
           ORDER BY seq ASC
           OFFSET 0
           LIMIT GREATEST(
             (SELECT count(*) FROM chat_state_lists WHERE key_prefix = $1 AND list_key = $2) - $3,
             0
           )
         )`,
        [this.keyPrefix, key, options.maxLength]
      );
    }

    // Update TTL on all entries for this key
    if (expiresAt) {
      await this.pool.query(
        `UPDATE chat_state_lists
         SET expires_at = $3
         WHERE key_prefix = $1 AND list_key = $2`,
        [this.keyPrefix, key, expiresAt]
      );
    }
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    this.ensureConnected();

    const result = await this.pool.query(
      `SELECT value FROM chat_state_lists
       WHERE key_prefix = $1 AND list_key = $2
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY seq ASC`,
      [this.keyPrefix, key]
    );

    return result.rows.map((row) => JSON.parse(row.value as string) as T);
  }

  async enqueue(
    threadId: string,
    entry: QueueEntry,
    maxSize: number
  ): Promise<number> {
    this.ensureConnected();

    const serialized = JSON.stringify(entry);
    const expiresAt = new Date(entry.expiresAt);

    // Purge expired entries first to avoid phantom queue pressure
    await this.pool.query(
      `DELETE FROM chat_state_queues
       WHERE key_prefix = $1 AND thread_id = $2 AND expires_at <= now()`,
      [this.keyPrefix, threadId]
    );

    // Insert the new entry
    await this.pool.query(
      `INSERT INTO chat_state_queues (key_prefix, thread_id, value, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [this.keyPrefix, threadId, serialized, expiresAt]
    );

    // Trim overflow (keep newest maxSize non-expired entries)
    if (maxSize > 0) {
      await this.pool.query(
        `DELETE FROM chat_state_queues
         WHERE key_prefix = $1 AND thread_id = $2 AND seq IN (
           SELECT seq FROM chat_state_queues
           WHERE key_prefix = $1 AND thread_id = $2
             AND expires_at > now()
           ORDER BY seq ASC
           OFFSET 0
           LIMIT GREATEST(
             (SELECT count(*) FROM chat_state_queues
              WHERE key_prefix = $1 AND thread_id = $2 AND expires_at > now()) - $3,
             0
           )
         )`,
        [this.keyPrefix, threadId, maxSize]
      );
    }

    // Return current non-expired depth
    const result = await this.pool.query(
      `SELECT count(*) as depth FROM chat_state_queues
       WHERE key_prefix = $1 AND thread_id = $2 AND expires_at > now()`,
      [this.keyPrefix, threadId]
    );

    return Number.parseInt(result.rows[0].depth as string, 10);
  }

  async dequeue(threadId: string): Promise<QueueEntry | null> {
    this.ensureConnected();

    // Purge expired entries first
    await this.pool.query(
      `DELETE FROM chat_state_queues
       WHERE key_prefix = $1 AND thread_id = $2 AND expires_at <= now()`,
      [this.keyPrefix, threadId]
    );

    // Atomically select + delete the oldest non-expired entry
    const result = await this.pool.query(
      `DELETE FROM chat_state_queues
       WHERE key_prefix = $1 AND thread_id = $2
         AND seq = (
           SELECT seq FROM chat_state_queues
           WHERE key_prefix = $1 AND thread_id = $2
             AND expires_at > now()
           ORDER BY seq ASC
           LIMIT 1
         )
       RETURNING value`,
      [this.keyPrefix, threadId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return JSON.parse(result.rows[0].value as string) as QueueEntry;
  }

  async queueDepth(threadId: string): Promise<number> {
    this.ensureConnected();

    const result = await this.pool.query(
      `SELECT count(*) as depth FROM chat_state_queues
       WHERE key_prefix = $1 AND thread_id = $2 AND expires_at > now()`,
      [this.keyPrefix, threadId]
    );

    return Number.parseInt(result.rows[0].depth as string, 10);
  }

  getClient(): pg.Pool {
    return this.pool;
  }

  private async ensureSchema(): Promise<void> {
    for (const statement of postgresSchemaStatements) {
      await this.pool.query(statement);
    }
  }

  /**
   * Fail fast when a migration-owned schema is missing tables or grants, so
   * the problem surfaces at connect() instead of inside the first message.
   */
  private async verifySchema(): Promise<void> {
    let result: pg.QueryResult<Record<string, boolean | null>>;
    try {
      result = await this.pool.query(schemaProbe);
    } catch (error) {
      throw new Error(
        `${schemaErrorPrefix}: ${error instanceof Error ? error.message : String(error)}. ${schemaErrorHint}`,
        { cause: error }
      );
    }

    const missing = Object.entries(result.rows[0] ?? {})
      .filter(([, granted]) => granted === false)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(
        `${schemaErrorPrefix}: the current role lacks privileges on ${missing.join(", ")}. ${schemaErrorHint}`
      );
    }
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(
        "PostgresStateAdapter is not connected. Call connect() first."
      );
    }
  }
}

function generateToken(): string {
  return `pg_${crypto.randomUUID()}`;
}

export function createPostgresState(
  options: PostgresStateAdapterOptions = {}
): PostgresStateAdapter {
  if ("client" in options && options.client) {
    return new PostgresStateAdapter(options);
  }

  const urlOptions = options as PostgresStateAdapterUrlOptions;
  const url =
    urlOptions.url || process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Postgres url is required. Set POSTGRES_URL or DATABASE_URL, or provide it in options."
    );
  }

  return new PostgresStateAdapter({
    autoCreateSchema: options.autoCreateSchema,
    url,
    keyPrefix: options.keyPrefix,
    logger: options.logger,
  });
}
