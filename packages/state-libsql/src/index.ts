import type { Lock, Logger, QueueEntry, StateAdapter } from "chat";
import { ConsoleLogger } from "chat";
import Database from "libsql/promise";

export interface LibSqlDatabaseOptions {
  /** Auth token for remote libSQL / Turso connections. */
  authToken?: string;
  /** Encryption key for encrypted local databases. */
  encryptionKey?: string;
  /** Open the replica in offline mode. */
  offline?: boolean;
  /** Sync period in seconds when using embedded replicas. */
  syncPeriod?: number;
  /** Sync URL for embedded-replica mode (local file mirrored from remote). */
  syncUrl?: string;
  /** Connection timeout in seconds. */
  timeout?: number;
}

export interface LibSqlStateAdapterOptions extends LibSqlDatabaseOptions {
  /** Key prefix for all rows (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger?: Logger;
  /**
   * libSQL database URL. Use a local path (e.g. `./chat-state.db`), `:memory:`,
   * or a remote URL (`libsql://`, `http(s)://`, `ws(s)://`).
   */
  url: string;
}

export interface LibSqlStateClientOptions {
  /** Existing libsql Database instance (opened via `libsql/promise`). */
  client: Database;
  /** Key prefix for all rows (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger?: Logger;
}

export type CreateLibSqlStateOptions =
  | (Partial<LibSqlStateAdapterOptions> & { client?: never })
  | (Partial<Omit<LibSqlStateClientOptions, "client">> & {
      client: Database;
    });

// Minimal typing for libsql/promise — the shipped .d.ts is incomplete.
interface LibSqlStatement {
  all(...args: unknown[]): Promise<Record<string, unknown>[]>;
  get(...args: unknown[]): Record<string, unknown> | undefined;
  run(...args: unknown[]): {
    changes: number;
    lastInsertRowid: number | bigint;
  };
}

interface LibSqlTxFn<R> {
  deferred(): Promise<R>;
  exclusive(): Promise<R>;
  immediate(): Promise<R>;
  (): Promise<R>;
}

interface LibSqlDatabase {
  close(): void;
  exec(sql: string): Promise<unknown>;
  open: boolean;
  prepare(sql: string): Promise<LibSqlStatement>;
  transaction<R>(fn: () => R): LibSqlTxFn<R>;
}

function asDb(db: Database): LibSqlDatabase {
  return db as unknown as LibSqlDatabase;
}

export class LibSqlStateAdapter implements StateAdapter {
  private readonly db: LibSqlDatabase;
  private readonly keyPrefix: string;
  private readonly logger: Logger;
  private readonly ownsClient: boolean;
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  constructor(options: LibSqlStateAdapterOptions | LibSqlStateClientOptions) {
    if ("client" in options) {
      this.db = asDb(options.client);
      this.ownsClient = false;
    } else {
      this.db = asDb(
        new Database(options.url, {
          authToken: options.authToken,
          syncUrl: options.syncUrl,
          syncPeriod: options.syncPeriod,
          encryptionKey: options.encryptionKey,
          offline: options.offline,
          timeout: options.timeout,
        })
      );
      this.ownsClient = true;
    }

    this.keyPrefix = options.keyPrefix || "chat-sdk";
    this.logger = options.logger ?? new ConsoleLogger("info").child("libsql");
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (!this.connectPromise) {
      this.connectPromise = (async () => {
        try {
          await this.db.exec("SELECT 1");
          await this.ensureSchema();
          this.connected = true;
        } catch (error) {
          this.connectPromise = null;
          this.logger.error("libSQL connect failed", { error });
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
      this.db.close();
    }

    this.connected = false;
    this.connectPromise = null;
  }

  async subscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    const stmt = await this.db.prepare(
      `INSERT INTO chat_state_subscriptions (key_prefix, thread_id)
       VALUES (?, ?)
       ON CONFLICT DO NOTHING`
    );
    stmt.run(this.keyPrefix, threadId);
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    const stmt = await this.db.prepare(
      `DELETE FROM chat_state_subscriptions
       WHERE key_prefix = ? AND thread_id = ?`
    );
    stmt.run(this.keyPrefix, threadId);
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    this.ensureConnected();
    const stmt = await this.db.prepare(
      `SELECT 1 AS present FROM chat_state_subscriptions
       WHERE key_prefix = ? AND thread_id = ?
       LIMIT 1`
    );
    const row = stmt.get(this.keyPrefix, threadId);
    return row !== undefined;
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    this.ensureConnected();

    const token = generateToken();
    const now = Date.now();
    const expiresAt = now + ttlMs;

    const delExpired = await this.db.prepare(
      `DELETE FROM chat_state_locks
       WHERE key_prefix = ? AND thread_id = ? AND expires_at <= ?`
    );
    const insert = await this.db.prepare(
      `INSERT INTO chat_state_locks (key_prefix, thread_id, token, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (key_prefix, thread_id) DO NOTHING
       RETURNING thread_id, token, expires_at`
    );

    const row = await this.db
      .transaction(() => {
        delExpired.run(this.keyPrefix, threadId, now);
        return insert.get(this.keyPrefix, threadId, token, expiresAt, now);
      })
      .immediate();

    if (!row) {
      return null;
    }

    return {
      threadId: row.thread_id as string,
      token: row.token as string,
      expiresAt: Number(row.expires_at),
    };
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    this.ensureConnected();
    const stmt = await this.db.prepare(
      `DELETE FROM chat_state_locks
       WHERE key_prefix = ? AND thread_id = ?`
    );
    stmt.run(this.keyPrefix, threadId);
  }

  async releaseLock(lock: Lock): Promise<void> {
    this.ensureConnected();
    const stmt = await this.db.prepare(
      `DELETE FROM chat_state_locks
       WHERE key_prefix = ? AND thread_id = ? AND token = ?`
    );
    stmt.run(this.keyPrefix, lock.threadId, lock.token);
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    this.ensureConnected();

    const now = Date.now();
    const stmt = await this.db.prepare(
      `UPDATE chat_state_locks
       SET expires_at = ?, updated_at = ?
       WHERE key_prefix = ? AND thread_id = ? AND token = ? AND expires_at > ?
       RETURNING thread_id`
    );
    const row = stmt.get(
      now + ttlMs,
      now,
      this.keyPrefix,
      lock.threadId,
      lock.token,
      now
    );
    return row !== undefined;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    this.ensureConnected();

    const now = Date.now();
    const select = await this.db.prepare(
      `SELECT value FROM chat_state_cache
       WHERE key_prefix = ? AND cache_key = ?
         AND (expires_at IS NULL OR expires_at > ?)
       LIMIT 1`
    );
    const row = select.get(this.keyPrefix, key, now);

    if (!row) {
      // Opportunistic cleanup of any stale row.
      const del = await this.db.prepare(
        `DELETE FROM chat_state_cache
         WHERE key_prefix = ? AND cache_key = ?
           AND expires_at IS NOT NULL AND expires_at <= ?`
      );
      del.run(this.keyPrefix, key, now);
      return null;
    }

    const value = row.value as string;
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.ensureConnected();

    const now = Date.now();
    const serialized = JSON.stringify(value);
    const expiresAt = ttlMs ? now + ttlMs : null;

    const stmt = await this.db.prepare(
      `INSERT INTO chat_state_cache (key_prefix, cache_key, value, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (key_prefix, cache_key) DO UPDATE
         SET value = excluded.value,
             expires_at = excluded.expires_at,
             updated_at = excluded.updated_at`
    );
    stmt.run(this.keyPrefix, key, serialized, expiresAt, now);
  }

  async setIfNotExists(
    key: string,
    value: unknown,
    ttlMs?: number
  ): Promise<boolean> {
    this.ensureConnected();

    const now = Date.now();
    const serialized = JSON.stringify(value);
    const expiresAt = ttlMs ? now + ttlMs : null;

    const delExpired = await this.db.prepare(
      `DELETE FROM chat_state_cache
       WHERE key_prefix = ? AND cache_key = ?
         AND expires_at IS NOT NULL AND expires_at <= ?`
    );
    const insert = await this.db.prepare(
      `INSERT INTO chat_state_cache (key_prefix, cache_key, value, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (key_prefix, cache_key) DO NOTHING
       RETURNING cache_key`
    );

    const row = await this.db
      .transaction(() => {
        delExpired.run(this.keyPrefix, key, now);
        return insert.get(this.keyPrefix, key, serialized, expiresAt, now);
      })
      .immediate();

    return row !== undefined;
  }

  async delete(key: string): Promise<void> {
    this.ensureConnected();
    const stmt = await this.db.prepare(
      `DELETE FROM chat_state_cache
       WHERE key_prefix = ? AND cache_key = ?`
    );
    stmt.run(this.keyPrefix, key);
  }

  async appendToList(
    key: string,
    value: unknown,
    options?: { maxLength?: number; ttlMs?: number }
  ): Promise<void> {
    this.ensureConnected();

    const serialized = JSON.stringify(value);
    const expiresAt = options?.ttlMs ? Date.now() + options.ttlMs : null;

    const insert = await this.db.prepare(
      `INSERT INTO chat_state_lists (key_prefix, list_key, value, expires_at)
       VALUES (?, ?, ?, ?)`
    );
    const refreshTtl = await this.db.prepare(
      `UPDATE chat_state_lists
       SET expires_at = ?
       WHERE key_prefix = ? AND list_key = ?`
    );
    const trim = await this.db.prepare(
      `DELETE FROM chat_state_lists
       WHERE key_prefix = ? AND list_key = ? AND seq NOT IN (
         SELECT seq FROM chat_state_lists
         WHERE key_prefix = ? AND list_key = ?
         ORDER BY seq DESC
         LIMIT ?
       )`
    );

    await this.db
      .transaction(() => {
        insert.run(this.keyPrefix, key, serialized, expiresAt);
        if (expiresAt !== null) {
          refreshTtl.run(expiresAt, this.keyPrefix, key);
        }
        if (options?.maxLength && options.maxLength > 0) {
          trim.run(this.keyPrefix, key, this.keyPrefix, key, options.maxLength);
        }
      })
      .immediate();
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    this.ensureConnected();

    const now = Date.now();
    const del = await this.db.prepare(
      `DELETE FROM chat_state_lists
       WHERE key_prefix = ? AND list_key = ?
         AND expires_at IS NOT NULL AND expires_at <= ?`
    );
    del.run(this.keyPrefix, key, now);

    const select = await this.db.prepare(
      `SELECT value FROM chat_state_lists
       WHERE key_prefix = ? AND list_key = ?
       ORDER BY seq ASC`
    );
    const rows = await select.all(this.keyPrefix, key);
    return rows.map((row) => {
      const value = row.value as string;
      try {
        return JSON.parse(value) as T;
      } catch {
        return value as unknown as T;
      }
    });
  }

  async enqueue(
    threadId: string,
    entry: QueueEntry,
    maxSize: number
  ): Promise<number> {
    this.ensureConnected();

    const now = Date.now();
    const serialized = JSON.stringify(entry);

    const purge = await this.db.prepare(
      `DELETE FROM chat_state_queues
       WHERE key_prefix = ? AND thread_id = ? AND expires_at <= ?`
    );
    const insert = await this.db.prepare(
      `INSERT INTO chat_state_queues (key_prefix, thread_id, value, expires_at)
       VALUES (?, ?, ?, ?)`
    );
    const trim = await this.db.prepare(
      `DELETE FROM chat_state_queues
       WHERE key_prefix = ? AND thread_id = ? AND seq NOT IN (
         SELECT seq FROM chat_state_queues
         WHERE key_prefix = ? AND thread_id = ?
         ORDER BY seq DESC
         LIMIT ?
       )`
    );
    const countStmt = await this.db.prepare(
      `SELECT COUNT(*) AS depth FROM chat_state_queues
       WHERE key_prefix = ? AND thread_id = ? AND expires_at > ?`
    );

    const depth = await this.db
      .transaction(() => {
        purge.run(this.keyPrefix, threadId, now);
        insert.run(this.keyPrefix, threadId, serialized, entry.expiresAt);
        if (maxSize > 0) {
          trim.run(this.keyPrefix, threadId, this.keyPrefix, threadId, maxSize);
        }
        const row = countStmt.get(this.keyPrefix, threadId, now);
        return toNumber(row?.depth);
      })
      .immediate();

    return depth;
  }

  async dequeue(threadId: string): Promise<QueueEntry | null> {
    this.ensureConnected();

    const now = Date.now();
    const purge = await this.db.prepare(
      `DELETE FROM chat_state_queues
       WHERE key_prefix = ? AND thread_id = ? AND expires_at <= ?`
    );
    const pick = await this.db.prepare(
      `SELECT seq, value FROM chat_state_queues
       WHERE key_prefix = ? AND thread_id = ? AND expires_at > ?
       ORDER BY seq ASC
       LIMIT 1`
    );
    const del = await this.db.prepare(
      "DELETE FROM chat_state_queues WHERE seq = ?"
    );

    const value = await this.db
      .transaction(() => {
        purge.run(this.keyPrefix, threadId, now);
        const row = pick.get(this.keyPrefix, threadId, now);
        if (!row) {
          return null;
        }
        del.run(row.seq);
        return row.value as string;
      })
      .immediate();

    if (value === null) {
      return null;
    }

    return JSON.parse(value) as QueueEntry;
  }

  async queueDepth(threadId: string): Promise<number> {
    this.ensureConnected();
    const stmt = await this.db.prepare(
      `SELECT COUNT(*) AS depth FROM chat_state_queues
       WHERE key_prefix = ? AND thread_id = ? AND expires_at > ?`
    );
    const row = stmt.get(this.keyPrefix, threadId, Date.now());
    return toNumber(row?.depth);
  }

  getClient(): Database {
    return this.db as unknown as Database;
  }

  private async ensureSchema(): Promise<void> {
    await this.db.exec(
      `CREATE TABLE IF NOT EXISTS chat_state_subscriptions (
        key_prefix TEXT NOT NULL,
        thread_id  TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        PRIMARY KEY (key_prefix, thread_id)
      )`
    );
    await this.db.exec(
      `CREATE TABLE IF NOT EXISTS chat_state_locks (
        key_prefix TEXT NOT NULL,
        thread_id  TEXT NOT NULL,
        token      TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (key_prefix, thread_id)
      )`
    );
    await this.db.exec(
      `CREATE TABLE IF NOT EXISTS chat_state_cache (
        key_prefix TEXT NOT NULL,
        cache_key  TEXT NOT NULL,
        value      TEXT NOT NULL,
        expires_at INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (key_prefix, cache_key)
      )`
    );
    await this.db.exec(
      `CREATE INDEX IF NOT EXISTS chat_state_locks_expires_idx
       ON chat_state_locks (expires_at)`
    );
    await this.db.exec(
      `CREATE INDEX IF NOT EXISTS chat_state_cache_expires_idx
       ON chat_state_cache (expires_at)
       WHERE expires_at IS NOT NULL`
    );
    await this.db.exec(
      `CREATE TABLE IF NOT EXISTS chat_state_lists (
        seq        INTEGER PRIMARY KEY AUTOINCREMENT,
        key_prefix TEXT NOT NULL,
        list_key   TEXT NOT NULL,
        value      TEXT NOT NULL,
        expires_at INTEGER
      )`
    );
    await this.db.exec(
      `CREATE INDEX IF NOT EXISTS chat_state_lists_key_idx
       ON chat_state_lists (key_prefix, list_key, seq)`
    );
    await this.db.exec(
      `CREATE INDEX IF NOT EXISTS chat_state_lists_expires_idx
       ON chat_state_lists (expires_at)
       WHERE expires_at IS NOT NULL`
    );
    await this.db.exec(
      `CREATE TABLE IF NOT EXISTS chat_state_queues (
        seq        INTEGER PRIMARY KEY AUTOINCREMENT,
        key_prefix TEXT NOT NULL,
        thread_id  TEXT NOT NULL,
        value      TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )`
    );
    await this.db.exec(
      `CREATE INDEX IF NOT EXISTS chat_state_queues_thread_idx
       ON chat_state_queues (key_prefix, thread_id, seq)`
    );
    await this.db.exec(
      `CREATE INDEX IF NOT EXISTS chat_state_queues_expires_idx
       ON chat_state_queues (expires_at)`
    );
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(
        "LibSqlStateAdapter is not connected. Call connect() first."
      );
    }
  }
}

function toNumber(value: unknown): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return Number.parseInt(value, 10);
  }
  return 0;
}

function generateToken(): string {
  return `libsql_${crypto.randomUUID()}`;
}

export function createLibSqlState(
  options: CreateLibSqlStateOptions = {}
): LibSqlStateAdapter {
  if ("client" in options && options.client) {
    return new LibSqlStateAdapter({
      client: options.client,
      keyPrefix: options.keyPrefix,
      logger: options.logger,
    });
  }

  const url = options.url || process.env.TURSO_DATABASE_URL;

  if (!url) {
    throw new Error(
      "libSQL url is required. Set TURSO_DATABASE_URL or provide it in options."
    );
  }

  const authToken = options.authToken || process.env.TURSO_AUTH_TOKEN;

  return new LibSqlStateAdapter({
    url,
    authToken,
    syncUrl: options.syncUrl,
    syncPeriod: options.syncPeriod,
    encryptionKey: options.encryptionKey,
    offline: options.offline,
    timeout: options.timeout,
    keyPrefix: options.keyPrefix,
    logger: options.logger,
  });
}
