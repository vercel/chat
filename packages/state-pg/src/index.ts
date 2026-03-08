import type { Lock, Logger, StateAdapter } from "chat";
import { ConsoleLogger } from "chat";
import pg from "pg";

export interface PostgresStateAdapterOptions {
  /** Key prefix for all rows (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger?: Logger;
  /** Postgres connection URL */
  url: string;
}

export interface PostgresStateClientOptions {
  /** Existing pg.Pool instance */
  client: pg.Pool;
  /** Key prefix for all rows (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger?: Logger;
}

export type CreatePostgresStateOptions =
  | (Partial<PostgresStateAdapterOptions> & { client?: never })
  | (Partial<Omit<PostgresStateClientOptions, "client">> & {
      client: pg.Pool;
    });

export class PostgresStateAdapter implements StateAdapter {
  private readonly pool: pg.Pool;
  private readonly keyPrefix: string;
  private readonly logger: Logger;
  private readonly ownsClient: boolean;
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  constructor(
    options: PostgresStateAdapterOptions | PostgresStateClientOptions
  ) {
    if ("client" in options) {
      this.pool = options.client;
      this.ownsClient = false;
    } else {
      this.pool = new pg.Pool({ connectionString: options.url });
      this.ownsClient = true;
    }

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
          await this.ensureSchema();
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
       ON CONFLICT (key_prefix, cache_key) DO NOTHING
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

  getClient(): pg.Pool {
    return this.pool;
  }

  private async ensureSchema(): Promise<void> {
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS chat_state_subscriptions (
        key_prefix text NOT NULL,
        thread_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (key_prefix, thread_id)
      )`
    );
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS chat_state_locks (
        key_prefix text NOT NULL,
        thread_id text NOT NULL,
        token text NOT NULL,
        expires_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (key_prefix, thread_id)
      )`
    );
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS chat_state_cache (
        key_prefix text NOT NULL,
        cache_key text NOT NULL,
        value text NOT NULL,
        expires_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (key_prefix, cache_key)
      )`
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS chat_state_locks_expires_idx
       ON chat_state_locks (expires_at)`
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS chat_state_cache_expires_idx
       ON chat_state_cache (expires_at)`
    );
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
  options: CreatePostgresStateOptions = {}
): PostgresStateAdapter {
  if ("client" in options && options.client) {
    return new PostgresStateAdapter({
      client: options.client,
      keyPrefix: options.keyPrefix,
      logger: options.logger,
    });
  }

  const url =
    options.url || process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Postgres url is required. Set POSTGRES_URL or DATABASE_URL, or provide it in options."
    );
  }

  return new PostgresStateAdapter({
    url,
    keyPrefix: options.keyPrefix,
    logger: options.logger,
  });
}
