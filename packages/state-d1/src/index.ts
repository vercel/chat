import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";
import type { Lock, Logger, QueueEntry, StateAdapter } from "chat";
import { ConsoleLogger } from "chat";

export interface D1StateAdapterOptions {
  /** Cloudflare D1 database binding (required). */
  database: D1Database;
  /** Key prefix for all rows (default: "chat-sdk"). */
  keyPrefix?: string;
  /** Logger instance for error reporting. */
  logger?: Logger;
}

const DEFAULT_KEY_PREFIX = "chat-sdk";

const CREATE_SUBSCRIPTIONS = `CREATE TABLE IF NOT EXISTS chat_state_subscriptions (
  key_prefix TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (key_prefix, thread_id)
)`;

const CREATE_LOCKS = `CREATE TABLE IF NOT EXISTS chat_state_locks (
  key_prefix TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (key_prefix, thread_id)
)`;

const CREATE_LOCKS_INDEX = `CREATE INDEX IF NOT EXISTS chat_state_locks_expires_idx
  ON chat_state_locks (expires_at)`;

const CREATE_CACHE = `CREATE TABLE IF NOT EXISTS chat_state_cache (
  key_prefix TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (key_prefix, cache_key)
)`;

const CREATE_CACHE_INDEX = `CREATE INDEX IF NOT EXISTS chat_state_cache_expires_idx
  ON chat_state_cache (expires_at)`;

const CREATE_LISTS = `CREATE TABLE IF NOT EXISTS chat_state_lists (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  key_prefix TEXT NOT NULL,
  list_key TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER
)`;

const CREATE_LISTS_KEY_INDEX = `CREATE INDEX IF NOT EXISTS chat_state_lists_key_idx
  ON chat_state_lists (key_prefix, list_key, seq)`;

const CREATE_LISTS_EXPIRES_INDEX = `CREATE INDEX IF NOT EXISTS chat_state_lists_expires_idx
  ON chat_state_lists (expires_at)`;

const CREATE_QUEUES = `CREATE TABLE IF NOT EXISTS chat_state_queues (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  key_prefix TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL
)`;

const CREATE_QUEUES_THREAD_INDEX = `CREATE INDEX IF NOT EXISTS chat_state_queues_thread_idx
  ON chat_state_queues (key_prefix, thread_id, seq)`;

const CREATE_QUEUES_EXPIRES_INDEX = `CREATE INDEX IF NOT EXISTS chat_state_queues_expires_idx
  ON chat_state_queues (expires_at)`;

/**
 * Cloudflare D1 (SQLite) state adapter for Chat SDK.
 *
 * Persists subscriptions, distributed locks, key-value cache, ordered lists,
 * and per-thread FIFO queues in a D1 database. The D1 binding is always
 * injected via {@link D1StateAdapterOptions.database}; the adapter does not
 * own the connection lifecycle, so {@link D1StateAdapter.disconnect} only
 * flips the internal connected flag.
 *
 * @example
 * ```typescript
 * import { Chat } from "chat";
 * import { createD1State } from "@chat-adapter/state-d1";
 *
 * const bot = new Chat({
 *   userName: "mybot",
 *   adapters: { ... },
 *   state: createD1State({ database: env.DB }),
 * });
 * ```
 */
export class D1StateAdapter implements StateAdapter {
  private readonly database: D1Database;
  private readonly keyPrefix: string;
  private readonly logger: Logger;
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  constructor(options: D1StateAdapterOptions) {
    if (!options.database) {
      throw new Error("D1StateAdapter requires a `database` D1 binding.");
    }

    this.database = options.database;
    this.keyPrefix = options.keyPrefix || DEFAULT_KEY_PREFIX;
    this.logger = options.logger ?? new ConsoleLogger("info").child("d1");
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (!this.connectPromise) {
      this.connectPromise = (async () => {
        try {
          await this.ensureSchema();
          this.connected = true;
        } catch (error) {
          this.connectPromise = null;
          this.logger.error("D1 connect failed", { error });
          throw error;
        }
      })();
    }

    await this.connectPromise;
  }

  disconnect(): Promise<void> {
    // The D1 binding is owned by the runtime, not this adapter — nothing to
    // close. Flip the flag so subsequent calls require a fresh connect().
    this.connected = false;
    this.connectPromise = null;
    return Promise.resolve();
  }

  async subscribe(threadId: string): Promise<void> {
    this.ensureConnected();

    await this.database
      .prepare(
        `INSERT OR IGNORE INTO chat_state_subscriptions (key_prefix, thread_id, created_at)
         VALUES (?, ?, ?)`
      )
      .bind(this.keyPrefix, threadId, Date.now())
      .run();
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.ensureConnected();

    await this.database
      .prepare(
        `DELETE FROM chat_state_subscriptions
         WHERE key_prefix = ? AND thread_id = ?`
      )
      .bind(this.keyPrefix, threadId)
      .run();
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    this.ensureConnected();

    const row = await this.database
      .prepare(
        `SELECT 1 FROM chat_state_subscriptions
         WHERE key_prefix = ? AND thread_id = ?
         LIMIT 1`
      )
      .bind(this.keyPrefix, threadId)
      .first();

    return row !== null;
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    this.ensureConnected();

    const now = Date.now();
    const token = generateToken();
    const expiresAt = now + ttlMs;

    // Atomic insert-or-steal-expired. The ON CONFLICT update only fires when
    // the existing lock is expired; RETURNING yields a row iff we inserted or
    // stole the lock (D1 returns nothing when the WHERE clause blocks the
    // update — verified against real D1).
    const row = await this.database
      .prepare(
        `INSERT INTO chat_state_locks (key_prefix, thread_id, token, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key_prefix, thread_id) DO UPDATE SET
           token = excluded.token,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at
         WHERE chat_state_locks.expires_at <= ?
         RETURNING token, expires_at`
      )
      .bind(this.keyPrefix, threadId, token, expiresAt, now, now)
      .first<{ token: string; expires_at: number }>();

    if (!row) {
      return null;
    }

    return { threadId, token: row.token, expiresAt: row.expires_at };
  }

  async releaseLock(lock: Lock): Promise<void> {
    this.ensureConnected();

    await this.database
      .prepare(
        `DELETE FROM chat_state_locks
         WHERE key_prefix = ? AND thread_id = ? AND token = ?`
      )
      .bind(this.keyPrefix, lock.threadId, lock.token)
      .run();
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    this.ensureConnected();

    const now = Date.now();
    const result = await this.database
      .prepare(
        `UPDATE chat_state_locks
         SET expires_at = ?, updated_at = ?
         WHERE key_prefix = ? AND thread_id = ? AND token = ? AND expires_at > ?`
      )
      .bind(now + ttlMs, now, this.keyPrefix, lock.threadId, lock.token, now)
      .run();

    return result.meta.changes > 0;
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    this.ensureConnected();

    await this.database
      .prepare(
        `DELETE FROM chat_state_locks
         WHERE key_prefix = ? AND thread_id = ?`
      )
      .bind(this.keyPrefix, threadId)
      .run();
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    this.ensureConnected();

    const row = await this.database
      .prepare(
        `SELECT value FROM chat_state_cache
         WHERE key_prefix = ? AND cache_key = ?
           AND (expires_at IS NULL OR expires_at > ?)
         LIMIT 1`
      )
      .bind(this.keyPrefix, key, Date.now())
      .first<{ value: string }>();

    if (!row) {
      return null;
    }

    return parseJson<T>(row.value);
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.ensureConnected();

    const now = Date.now();
    const expiresAt = ttlMs ? now + ttlMs : null;

    await this.database
      .prepare(
        `INSERT INTO chat_state_cache (key_prefix, cache_key, value, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key_prefix, cache_key) DO UPDATE SET
           value = excluded.value,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`
      )
      .bind(this.keyPrefix, key, JSON.stringify(value), expiresAt, now)
      .run();
  }

  async setIfNotExists(
    key: string,
    value: unknown,
    ttlMs?: number
  ): Promise<boolean> {
    this.ensureConnected();

    const now = Date.now();
    const expiresAt = ttlMs ? now + ttlMs : null;

    // Drop an expired entry then insert-if-absent in one atomic batch.
    // The second statement's RETURNING row is present iff we inserted.
    const results = await this.database.batch([
      this.database
        .prepare(
          `DELETE FROM chat_state_cache
           WHERE key_prefix = ? AND cache_key = ?
             AND expires_at IS NOT NULL AND expires_at <= ?`
        )
        .bind(this.keyPrefix, key, now),
      this.database
        .prepare(
          `INSERT INTO chat_state_cache (key_prefix, cache_key, value, expires_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(key_prefix, cache_key) DO NOTHING
           RETURNING cache_key`
        )
        .bind(this.keyPrefix, key, JSON.stringify(value), expiresAt, now),
    ]);

    return (results[1].results as unknown[]).length > 0;
  }

  async delete(key: string): Promise<void> {
    this.ensureConnected();

    await this.database
      .prepare(
        `DELETE FROM chat_state_cache
         WHERE key_prefix = ? AND cache_key = ?`
      )
      .bind(this.keyPrefix, key)
      .run();
  }

  async appendToList(
    key: string,
    value: unknown,
    options?: { maxLength?: number; ttlMs?: number }
  ): Promise<void> {
    this.ensureConnected();

    const now = Date.now();
    const expiresAt = options?.ttlMs ? now + options.ttlMs : null;
    const serialized = JSON.stringify(value);

    const statements: D1PreparedStatement[] = [
      this.database
        .prepare(
          `INSERT INTO chat_state_lists (key_prefix, list_key, value, expires_at)
           VALUES (?, ?, ?, ?)`
        )
        .bind(this.keyPrefix, key, serialized, expiresAt),
    ];

    // Refresh TTL on ALL entries for this key (matches Redis PEXPIRE behavior).
    if (expiresAt !== null) {
      statements.push(
        this.database
          .prepare(
            `UPDATE chat_state_lists SET expires_at = ?
             WHERE key_prefix = ? AND list_key = ?`
          )
          .bind(expiresAt, this.keyPrefix, key)
      );
    }

    // Trim to maxLength: keep only the newest entries (highest seq).
    if (options?.maxLength && options.maxLength > 0) {
      statements.push(
        this.database
          .prepare(
            `DELETE FROM chat_state_lists
             WHERE key_prefix = ? AND list_key = ? AND seq NOT IN (
               SELECT seq FROM chat_state_lists
               WHERE key_prefix = ? AND list_key = ?
               ORDER BY seq DESC LIMIT ?
             )`
          )
          .bind(this.keyPrefix, key, this.keyPrefix, key, options.maxLength)
      );
    }

    await this.database.batch(statements);
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    this.ensureConnected();

    const now = Date.now();
    // Purge expired entries first, then read what remains in insertion order.
    await this.database
      .prepare(
        `DELETE FROM chat_state_lists
         WHERE key_prefix = ? AND list_key = ?
           AND expires_at IS NOT NULL AND expires_at <= ?`
      )
      .bind(this.keyPrefix, key, now)
      .run();

    const result = await this.database
      .prepare(
        `SELECT value FROM chat_state_lists
         WHERE key_prefix = ? AND list_key = ?
         ORDER BY seq ASC`
      )
      .bind(this.keyPrefix, key)
      .all<{ value: string }>();

    return result.results.map((row) => parseJson<T>(row.value));
  }

  async enqueue(
    threadId: string,
    entry: QueueEntry,
    maxSize: number
  ): Promise<number> {
    this.ensureConnected();

    const now = Date.now();
    const serialized = JSON.stringify(entry);

    const statements: D1PreparedStatement[] = [
      // Purge expired entries to avoid phantom queue pressure.
      this.database
        .prepare(
          `DELETE FROM chat_state_queues
           WHERE key_prefix = ? AND thread_id = ? AND expires_at <= ?`
        )
        .bind(this.keyPrefix, threadId, now),
      this.database
        .prepare(
          `INSERT INTO chat_state_queues (key_prefix, thread_id, value, expires_at)
           VALUES (?, ?, ?, ?)`
        )
        .bind(this.keyPrefix, threadId, serialized, entry.expiresAt),
    ];

    // Trim overflow: keep newest maxSize non-expired entries.
    if (maxSize > 0) {
      statements.push(
        this.database
          .prepare(
            `DELETE FROM chat_state_queues
             WHERE key_prefix = ? AND thread_id = ? AND seq NOT IN (
               SELECT seq FROM chat_state_queues
               WHERE key_prefix = ? AND thread_id = ? AND expires_at > ?
               ORDER BY seq DESC LIMIT ?
             )`
          )
          .bind(
            this.keyPrefix,
            threadId,
            this.keyPrefix,
            threadId,
            now,
            maxSize
          )
      );
    }

    statements.push(
      this.database
        .prepare(
          `SELECT COUNT(*) AS depth FROM chat_state_queues
           WHERE key_prefix = ? AND thread_id = ? AND expires_at > ?`
        )
        .bind(this.keyPrefix, threadId, now)
    );

    const results = await this.database.batch<{ depth: number }>(statements);
    const depthRow = results.at(-1)?.results?.[0];
    return depthRow ? depthRow.depth : 0;
  }

  async dequeue(threadId: string): Promise<QueueEntry | null> {
    this.ensureConnected();

    const now = Date.now();

    // Purge expired entries, then atomically pop the oldest survivor.
    const results = await this.database.batch([
      this.database
        .prepare(
          `DELETE FROM chat_state_queues
           WHERE key_prefix = ? AND thread_id = ? AND expires_at <= ?`
        )
        .bind(this.keyPrefix, threadId, now),
      this.database
        .prepare(
          `DELETE FROM chat_state_queues
           WHERE seq = (
             SELECT seq FROM chat_state_queues
             WHERE key_prefix = ? AND thread_id = ? AND expires_at > ?
             ORDER BY seq ASC LIMIT 1
           )
           RETURNING value`
        )
        .bind(this.keyPrefix, threadId, now),
    ]);

    const row = (results[1].results as { value: string }[])[0];
    if (!row) {
      return null;
    }

    return parseJson<QueueEntry>(row.value);
  }

  async queueDepth(threadId: string): Promise<number> {
    this.ensureConnected();

    const row = await this.database
      .prepare(
        `SELECT COUNT(*) AS depth FROM chat_state_queues
         WHERE key_prefix = ? AND thread_id = ? AND expires_at > ?`
      )
      .bind(this.keyPrefix, threadId, Date.now())
      .first<{ depth: number }>();

    return row ? row.depth : 0;
  }

  private async ensureSchema(): Promise<void> {
    await this.database.batch([
      this.database.prepare(CREATE_SUBSCRIPTIONS),
      this.database.prepare(CREATE_LOCKS),
      this.database.prepare(CREATE_LOCKS_INDEX),
      this.database.prepare(CREATE_CACHE),
      this.database.prepare(CREATE_CACHE_INDEX),
      this.database.prepare(CREATE_LISTS),
      this.database.prepare(CREATE_LISTS_KEY_INDEX),
      this.database.prepare(CREATE_LISTS_EXPIRES_INDEX),
      this.database.prepare(CREATE_QUEUES),
      this.database.prepare(CREATE_QUEUES_THREAD_INDEX),
      this.database.prepare(CREATE_QUEUES_EXPIRES_INDEX),
    ]);
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error("D1StateAdapter is not connected. Call connect() first.");
    }
  }
}

function parseJson<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

function generateToken(): string {
  return `d1_${crypto.randomUUID()}`;
}

export function createD1State(options: D1StateAdapterOptions): D1StateAdapter {
  return new D1StateAdapter(options);
}
