import type { Lock, Logger, StateAdapter } from "chat";
import { ConsoleLogger } from "chat";
import postgres, { type Sql } from "postgres";

export interface PostgresStateAdapterOptions {
  /** Key prefix for all rows (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger?: Logger;
  /** Postgres connection URL */
  url: string;
}

export interface PostgresStateClientOptions {
  /** Existing postgres client instance */
  client: Sql;
  /** Key prefix for all rows (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger?: Logger;
}

export type CreatePostgresStateOptions =
  | (Partial<PostgresStateAdapterOptions> & { client?: never })
  | (Partial<Omit<PostgresStateClientOptions, "client">> & {
      client: Sql;
    });

export class PostgresStateAdapter implements StateAdapter {
  private readonly client: Sql;
  private readonly keyPrefix: string;
  private readonly logger: Logger;
  private readonly ownsClient: boolean;
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  constructor(
    options: PostgresStateAdapterOptions | PostgresStateClientOptions
  ) {
    if ("client" in options) {
      this.client = options.client;
      this.ownsClient = false;
    } else {
      this.client = postgres(options.url);
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
          await this.client`select 1`;
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
      await this.client.end();
    }

    this.connected = false;
    this.connectPromise = null;
  }

  async subscribe(threadId: string): Promise<void> {
    this.ensureConnected();

    await this.client`
      insert into chat_state_subscriptions (key_prefix, thread_id)
      values (${this.keyPrefix}, ${threadId})
      on conflict do nothing
    `;
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.ensureConnected();

    await this.client`
      delete from chat_state_subscriptions
      where key_prefix = ${this.keyPrefix}
        and thread_id = ${threadId}
    `;
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    this.ensureConnected();

    const rows = await this.client`
      select 1 from chat_state_subscriptions
      where key_prefix = ${this.keyPrefix}
        and thread_id = ${threadId}
      limit 1
    `;

    return rows.length > 0;
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    this.ensureConnected();

    const token = generateToken();
    const expiresAt = new Date(Date.now() + ttlMs);

    const rows = await this.client`
      insert into chat_state_locks (key_prefix, thread_id, token, expires_at)
      values (${this.keyPrefix}, ${threadId}, ${token}, ${expiresAt})
      on conflict (key_prefix, thread_id) do update
        set token = excluded.token,
            expires_at = excluded.expires_at,
            updated_at = now()
        where chat_state_locks.expires_at <= now()
      returning thread_id, token, expires_at
    `;

    if (rows.length === 0) {
      return null;
    }

    return {
      threadId: rows[0].thread_id as string,
      token: rows[0].token as string,
      expiresAt: (rows[0].expires_at as Date).getTime(),
    };
  }

  async releaseLock(lock: Lock): Promise<void> {
    this.ensureConnected();

    await this.client`
      delete from chat_state_locks
      where key_prefix = ${this.keyPrefix}
        and thread_id = ${lock.threadId}
        and token = ${lock.token}
    `;
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    this.ensureConnected();

    const rows = await this.client`
      update chat_state_locks
      set expires_at = now() + ${ttlMs} * interval '1 millisecond',
          updated_at = now()
      where key_prefix = ${this.keyPrefix}
        and thread_id = ${lock.threadId}
        and token = ${lock.token}
        and expires_at > now()
      returning thread_id
    `;

    return rows.length > 0;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    this.ensureConnected();

    const rows = await this.client`
      select value from chat_state_cache
      where key_prefix = ${this.keyPrefix}
        and cache_key = ${key}
        and (expires_at is null or expires_at > now())
      limit 1
    `;

    if (rows.length === 0) {
      // Opportunistic cleanup of expired entry
      await this.client`
        delete from chat_state_cache
        where key_prefix = ${this.keyPrefix}
          and cache_key = ${key}
          and expires_at <= now()
      `;

      return null;
    }

    try {
      return JSON.parse(rows[0].value as string) as T;
    } catch {
      return rows[0].value as unknown as T;
    }
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.ensureConnected();

    const serialized = JSON.stringify(value);
    const expiresAt = ttlMs ? new Date(Date.now() + ttlMs) : null;

    await this.client`
      insert into chat_state_cache (key_prefix, cache_key, value, expires_at)
      values (${this.keyPrefix}, ${key}, ${serialized}, ${expiresAt})
      on conflict (key_prefix, cache_key) do update
        set value = excluded.value,
            expires_at = excluded.expires_at,
            updated_at = now()
    `;
  }

  async setIfNotExists(
    key: string,
    value: unknown,
    ttlMs?: number
  ): Promise<boolean> {
    this.ensureConnected();

    const serialized = JSON.stringify(value);
    const expiresAt = ttlMs ? new Date(Date.now() + ttlMs) : null;

    const rows = await this.client`
      insert into chat_state_cache (key_prefix, cache_key, value, expires_at)
      values (${this.keyPrefix}, ${key}, ${serialized}, ${expiresAt})
      on conflict (key_prefix, cache_key) do nothing
      returning cache_key
    `;

    return rows.length > 0;
  }

  async delete(key: string): Promise<void> {
    this.ensureConnected();

    await this.client`
      delete from chat_state_cache
      where key_prefix = ${this.keyPrefix}
        and cache_key = ${key}
    `;
  }

  getClient(): Sql {
    return this.client;
  }

  private async ensureSchema(): Promise<void> {
    await this.client`
      create table if not exists chat_state_subscriptions (
        key_prefix text not null,
        thread_id text not null,
        created_at timestamptz not null default now(),
        primary key (key_prefix, thread_id)
      )
    `;
    await this.client`
      create table if not exists chat_state_locks (
        key_prefix text not null,
        thread_id text not null,
        token text not null,
        expires_at timestamptz not null,
        updated_at timestamptz not null default now(),
        primary key (key_prefix, thread_id)
      )
    `;
    await this.client`
      create table if not exists chat_state_cache (
        key_prefix text not null,
        cache_key text not null,
        value text not null,
        expires_at timestamptz,
        updated_at timestamptz not null default now(),
        primary key (key_prefix, cache_key)
      )
    `;
    await this.client`
      create index if not exists chat_state_locks_expires_idx
      on chat_state_locks (expires_at)
    `;
    await this.client`
      create index if not exists chat_state_cache_expires_idx
      on chat_state_cache (expires_at)
    `;
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
