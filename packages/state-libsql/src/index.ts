import { type Client, type Config, createClient } from "@libsql/client";
import type { Lock, Logger, QueueEntry, StateAdapter } from "chat";
import { ConsoleLogger } from "chat";

// LibSQL

export interface LibSqlStateAdapterOptions {
  /** Auth token for remote libSQL / Turso connections. */
  authToken?: string;
  /** Additional libsql client config (encryption key, sync, tls, intMode…). */
  config?: Omit<Config, "url" | "authToken">;
  /** Key prefix for all rows (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger?: Logger;
  /** libSQL connection URL. Supports `file:`, `libsql:`, `http(s):`, `ws(s):`. */
  url: string;
}

export interface LibSqlStateClientOptions {
  /** Existing libsql Client instance */
  client: Client;
  /** Key prefix for all rows (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger?: Logger;
}

export type CreateLibSqlStateOptions =
  | (Partial<LibSqlStateAdapterOptions> & { client?: never })
  | (Partial<Omit<LibSqlStateClientOptions, "client">> & {
      client: Client;
    });

type Primitive = string | number | null;

export class LibSqlStateAdapter implements StateAdapter {
  private readonly client: Client;
  private readonly keyPrefix: string;
  private readonly logger: Logger;
  private readonly ownsClient: boolean;
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  constructor(options: LibSqlStateAdapterOptions | LibSqlStateClientOptions) {
    if ("client" in options) {
      this.client = options.client;
      this.ownsClient = false;
    } else {
      this.client = createClient({
        ...options.config,
        url: options.url,
        authToken: options.authToken,
      });
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
          await this.client.execute("SELECT 1");
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
      this.client.close();
    }

    this.connected = false;
    this.connectPromise = null;
  }

  async subscribe(threadId: string): Promise<void> {
    this.ensureConnected();

    await this.client.execute({
      sql: `INSERT INTO chat_state_subscriptions (key_prefix, thread_id)
            VALUES (?, ?)
            ON CONFLICT DO NOTHING`,
      args: [this.keyPrefix, threadId],
    });
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.ensureConnected();

    await this.client.execute({
      sql: `DELETE FROM chat_state_subscriptions
            WHERE key_prefix = ? AND thread_id = ?`,
      args: [this.keyPrefix, threadId],
    });
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    this.ensureConnected();

    const result = await this.client.execute({
      sql: `SELECT 1 FROM chat_state_subscriptions
            WHERE key_prefix = ? AND thread_id = ?
            LIMIT 1`,
      args: [this.keyPrefix, threadId],
    });

    return result.rows.length > 0;
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    this.ensureConnected();

    const token = generateToken();
    const now = Date.now();
    const expiresAt = now + ttlMs;

    // Clear any expired lock for this thread first, then insert.
    // Using a transaction so the check+insert is atomic even on remote libSQL.
    const tx = await this.client.transaction("write");
    try {
      await tx.execute({
        sql: `DELETE FROM chat_state_locks
              WHERE key_prefix = ? AND thread_id = ? AND expires_at <= ?`,
        args: [this.keyPrefix, threadId, now],
      });

      const result = await tx.execute({
        sql: `INSERT INTO chat_state_locks (key_prefix, thread_id, token, expires_at, updated_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (key_prefix, thread_id) DO NOTHING
              RETURNING thread_id, token, expires_at`,
        args: [this.keyPrefix, threadId, token, expiresAt, now],
      });

      await tx.commit();

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        threadId: row.thread_id as string,
        token: row.token as string,
        expiresAt: Number(row.expires_at as number),
      };
    } catch (error) {
      tx.close();
      throw error;
    }
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    this.ensureConnected();

    await this.client.execute({
      sql: `DELETE FROM chat_state_locks
            WHERE key_prefix = ? AND thread_id = ?`,
      args: [this.keyPrefix, threadId],
    });
  }

  async releaseLock(lock: Lock): Promise<void> {
    this.ensureConnected();

    await this.client.execute({
      sql: `DELETE FROM chat_state_locks
            WHERE key_prefix = ? AND thread_id = ? AND token = ?`,
      args: [this.keyPrefix, lock.threadId, lock.token],
    });
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    this.ensureConnected();

    const now = Date.now();
    const result = await this.client.execute({
      sql: `UPDATE chat_state_locks
            SET expires_at = ?, updated_at = ?
            WHERE key_prefix = ?
              AND thread_id = ?
              AND token = ?
              AND expires_at > ?
            RETURNING thread_id`,
      args: [now + ttlMs, now, this.keyPrefix, lock.threadId, lock.token, now],
    });

    return result.rows.length > 0;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    this.ensureConnected();

    const now = Date.now();
    const result = await this.client.execute({
      sql: `SELECT value FROM chat_state_cache
            WHERE key_prefix = ? AND cache_key = ?
              AND (expires_at IS NULL OR expires_at > ?)
            LIMIT 1`,
      args: [this.keyPrefix, key, now],
    });

    if (result.rows.length === 0) {
      // Opportunistic cleanup of expired entry
      await this.client.execute({
        sql: `DELETE FROM chat_state_cache
              WHERE key_prefix = ? AND cache_key = ?
                AND expires_at IS NOT NULL AND expires_at <= ?`,
        args: [this.keyPrefix, key, now],
      });

      return null;
    }

    const value = result.rows[0].value as string;
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

    await this.client.execute({
      sql: `INSERT INTO chat_state_cache (key_prefix, cache_key, value, expires_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (key_prefix, cache_key) DO UPDATE
              SET value = excluded.value,
                  expires_at = excluded.expires_at,
                  updated_at = excluded.updated_at`,
      args: [this.keyPrefix, key, serialized, expiresAt, now],
    });
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

    // Clear any expired entry first so setIfNotExists can "win" after TTL passes,
    // matching the Redis SET NX PX semantics.
    const tx = await this.client.transaction("write");
    try {
      await tx.execute({
        sql: `DELETE FROM chat_state_cache
              WHERE key_prefix = ? AND cache_key = ?
                AND expires_at IS NOT NULL AND expires_at <= ?`,
        args: [this.keyPrefix, key, now],
      });

      const result = await tx.execute({
        sql: `INSERT INTO chat_state_cache (key_prefix, cache_key, value, expires_at, updated_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (key_prefix, cache_key) DO NOTHING
              RETURNING cache_key`,
        args: [this.keyPrefix, key, serialized, expiresAt, now],
      });

      await tx.commit();
      return result.rows.length > 0;
    } catch (error) {
      tx.close();
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    this.ensureConnected();

    await this.client.execute({
      sql: `DELETE FROM chat_state_cache
            WHERE key_prefix = ? AND cache_key = ?`,
      args: [this.keyPrefix, key],
    });
  }

  async appendToList(
    key: string,
    value: unknown,
    options?: { maxLength?: number; ttlMs?: number }
  ): Promise<void> {
    this.ensureConnected();

    const serialized = JSON.stringify(value);
    const expiresAt = options?.ttlMs ? Date.now() + options.ttlMs : null;

    const tx = await this.client.transaction("write");
    try {
      await tx.execute({
        sql: `INSERT INTO chat_state_lists (key_prefix, list_key, value, expires_at)
              VALUES (?, ?, ?, ?)`,
        args: [this.keyPrefix, key, serialized, expiresAt],
      });

      // Refresh TTL on all entries for this key (matches Redis PEXPIRE behaviour).
      if (expiresAt !== null) {
        await tx.execute({
          sql: `UPDATE chat_state_lists
                SET expires_at = ?
                WHERE key_prefix = ? AND list_key = ?`,
          args: [expiresAt, this.keyPrefix, key],
        });
      }

      // Trim to maxLength: keep only the newest entries (highest seq).
      if (options?.maxLength && options.maxLength > 0) {
        await tx.execute({
          sql: `DELETE FROM chat_state_lists
                WHERE key_prefix = ? AND list_key = ? AND seq NOT IN (
                  SELECT seq FROM chat_state_lists
                  WHERE key_prefix = ? AND list_key = ?
                  ORDER BY seq DESC
                  LIMIT ?
                )`,
          args: [this.keyPrefix, key, this.keyPrefix, key, options.maxLength],
        });
      }

      await tx.commit();
    } catch (error) {
      tx.close();
      throw error;
    }
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    this.ensureConnected();

    const now = Date.now();

    // Opportunistic cleanup of expired entries for this key.
    await this.client.execute({
      sql: `DELETE FROM chat_state_lists
            WHERE key_prefix = ? AND list_key = ?
              AND expires_at IS NOT NULL AND expires_at <= ?`,
      args: [this.keyPrefix, key, now],
    });

    const result = await this.client.execute({
      sql: `SELECT value FROM chat_state_lists
            WHERE key_prefix = ? AND list_key = ?
            ORDER BY seq ASC`,
      args: [this.keyPrefix, key],
    });

    return result.rows.map((row) => {
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
    const expiresAt = entry.expiresAt;

    const tx = await this.client.transaction("write");
    try {
      // Purge expired entries first to avoid phantom queue pressure.
      await tx.execute({
        sql: `DELETE FROM chat_state_queues
              WHERE key_prefix = ? AND thread_id = ? AND expires_at <= ?`,
        args: [this.keyPrefix, threadId, now],
      });

      await tx.execute({
        sql: `INSERT INTO chat_state_queues (key_prefix, thread_id, value, expires_at)
              VALUES (?, ?, ?, ?)`,
        args: [this.keyPrefix, threadId, serialized, expiresAt],
      });

      // Trim overflow (keep newest maxSize entries).
      if (maxSize > 0) {
        await tx.execute({
          sql: `DELETE FROM chat_state_queues
                WHERE key_prefix = ? AND thread_id = ? AND seq NOT IN (
                  SELECT seq FROM chat_state_queues
                  WHERE key_prefix = ? AND thread_id = ?
                  ORDER BY seq DESC
                  LIMIT ?
                )`,
          args: [this.keyPrefix, threadId, this.keyPrefix, threadId, maxSize],
        });
      }

      const depthResult = await tx.execute({
        sql: `SELECT COUNT(*) AS depth FROM chat_state_queues
              WHERE key_prefix = ? AND thread_id = ? AND expires_at > ?`,
        args: [this.keyPrefix, threadId, now],
      });

      await tx.commit();
      return toNumber(depthResult.rows[0].depth);
    } catch (error) {
      tx.close();
      throw error;
    }
  }

  async dequeue(threadId: string): Promise<QueueEntry | null> {
    this.ensureConnected();

    const now = Date.now();
    const tx = await this.client.transaction("write");
    try {
      await tx.execute({
        sql: `DELETE FROM chat_state_queues
              WHERE key_prefix = ? AND thread_id = ? AND expires_at <= ?`,
        args: [this.keyPrefix, threadId, now],
      });

      const selected = await tx.execute({
        sql: `SELECT seq, value FROM chat_state_queues
              WHERE key_prefix = ? AND thread_id = ? AND expires_at > ?
              ORDER BY seq ASC
              LIMIT 1`,
        args: [this.keyPrefix, threadId, now],
      });

      if (selected.rows.length === 0) {
        await tx.commit();
        return null;
      }

      const row = selected.rows[0];
      await tx.execute({
        sql: "DELETE FROM chat_state_queues WHERE seq = ?",
        args: [row.seq as Primitive],
      });

      await tx.commit();
      return JSON.parse(row.value as string) as QueueEntry;
    } catch (error) {
      tx.close();
      throw error;
    }
  }

  async queueDepth(threadId: string): Promise<number> {
    this.ensureConnected();

    const result = await this.client.execute({
      sql: `SELECT COUNT(*) AS depth FROM chat_state_queues
            WHERE key_prefix = ? AND thread_id = ? AND expires_at > ?`,
      args: [this.keyPrefix, threadId, Date.now()],
    });

    return toNumber(result.rows[0].depth);
  }

  getClient(): Client {
    return this.client;
  }

  private async ensureSchema(): Promise<void> {
    await this.client.execute(
      `CREATE TABLE IF NOT EXISTS chat_state_subscriptions (
        key_prefix TEXT NOT NULL,
        thread_id  TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        PRIMARY KEY (key_prefix, thread_id)
      )`
    );
    await this.client.execute(
      `CREATE TABLE IF NOT EXISTS chat_state_locks (
        key_prefix TEXT NOT NULL,
        thread_id  TEXT NOT NULL,
        token      TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (key_prefix, thread_id)
      )`
    );
    await this.client.execute(
      `CREATE TABLE IF NOT EXISTS chat_state_cache (
        key_prefix TEXT NOT NULL,
        cache_key  TEXT NOT NULL,
        value      TEXT NOT NULL,
        expires_at INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (key_prefix, cache_key)
      )`
    );
    await this.client.execute(
      `CREATE INDEX IF NOT EXISTS chat_state_locks_expires_idx
       ON chat_state_locks (expires_at)`
    );
    await this.client.execute(
      `CREATE INDEX IF NOT EXISTS chat_state_cache_expires_idx
       ON chat_state_cache (expires_at)
       WHERE expires_at IS NOT NULL`
    );
    await this.client.execute(
      `CREATE TABLE IF NOT EXISTS chat_state_lists (
        seq        INTEGER PRIMARY KEY AUTOINCREMENT,
        key_prefix TEXT NOT NULL,
        list_key   TEXT NOT NULL,
        value      TEXT NOT NULL,
        expires_at INTEGER
      )`
    );
    await this.client.execute(
      `CREATE INDEX IF NOT EXISTS chat_state_lists_key_idx
       ON chat_state_lists (key_prefix, list_key, seq)`
    );
    await this.client.execute(
      `CREATE INDEX IF NOT EXISTS chat_state_lists_expires_idx
       ON chat_state_lists (expires_at)
       WHERE expires_at IS NOT NULL`
    );
    await this.client.execute(
      `CREATE TABLE IF NOT EXISTS chat_state_queues (
        seq        INTEGER PRIMARY KEY AUTOINCREMENT,
        key_prefix TEXT NOT NULL,
        thread_id  TEXT NOT NULL,
        value      TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )`
    );
    await this.client.execute(
      `CREATE INDEX IF NOT EXISTS chat_state_queues_thread_idx
       ON chat_state_queues (key_prefix, thread_id, seq)`
    );
    await this.client.execute(
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
    config: options.config,
    keyPrefix: options.keyPrefix,
    logger: options.logger,
  });
}
