import type { Lock, Logger, QueueEntry, StateAdapter } from "chat";
import { ConsoleLogger } from "chat";
import { createClient, type RedisClientType } from "redis";

export interface RedisStateAdapterOptions {
  /** Key prefix for all Redis keys (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger?: Logger;
  /** Redis connection URL (e.g., redis://localhost:6379) */
  url: string;
}

export interface RedisStateClientOptions {
  /** Existing redis client instance */
  client: RedisClientType;
  /** Key prefix for all Redis keys (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger?: Logger;
}

export interface CreateRedisStateOptions {
  /** Existing redis client instance */
  client?: RedisClientType;
  /** Key prefix for all Redis keys (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger?: Logger;
  /** Redis connection URL (e.g., redis://localhost:6379) */
  url?: string;
}

/**
 * Redis state adapter for production use.
 *
 * Provides persistent subscriptions and distributed locking
 * across multiple server instances.
 */
export class RedisStateAdapter implements StateAdapter {
  private readonly client: RedisClientType;
  private readonly keyPrefix: string;
  private readonly logger: Logger;
  private readonly ownsClient: boolean;
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  constructor(options: RedisStateAdapterOptions | RedisStateClientOptions) {
    if ("client" in options) {
      this.client = options.client;
      this.ownsClient = false;
    } else {
      this.client = createClient({ url: options.url });
      this.ownsClient = true;
    }
    this.keyPrefix = options.keyPrefix || "chat-sdk";
    this.logger = options.logger ?? new ConsoleLogger("info").child("redis");

    // Handle connection errors
    this.client.on("error", (err) => {
      this.logger.error("Redis client error", { error: err });
    });
    this.client.on("ready", () => {
      this.connected = true;
    });
    this.client.on("reconnecting", () => {
      this.connected = false;
    });
    this.client.on("end", () => {
      this.connected = false;
    });
  }

  private key(type: "sub" | "lock" | "cache" | "queue", id: string): string {
    return `${this.keyPrefix}:${type}:${id}`;
  }

  private subscriptionsSetKey(): string {
    return `${this.keyPrefix}:subscriptions`;
  }

  private async waitForReady(): Promise<void> {
    if (this.client.isReady) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let lastError: unknown;

      const handleReady = () => {
        cleanup();
        resolve();
      };

      const handleError = (error: unknown) => {
        lastError = error;
      };

      const handleEnd = () => {
        cleanup();
        reject(
          lastError ??
            new Error("Redis client connection ended before becoming ready.")
        );
      };

      const cleanup = () => {
        this.client.off("ready", handleReady);
        this.client.off("error", handleError);
        this.client.off("end", handleEnd);
      };

      this.client.on("ready", handleReady);
      this.client.on("error", handleError);
      this.client.on("end", handleEnd);

      if (this.client.isReady) {
        cleanup();
        resolve();
      }
    });
  }

  async connect(): Promise<void> {
    if (this.connected && this.client.isReady) {
      return;
    }

    // Reuse existing connection attempt to avoid race conditions
    if (!this.connectPromise) {
      const connectPromise = (async () => {
        if (this.ownsClient && !(this.client.isReady || this.client.isOpen)) {
          await this.client.connect();
        }

        await this.waitForReady();
        this.connected = true;
      })()
        .catch((error) => {
          throw error;
        })
        .finally(() => {
          if (this.connectPromise === connectPromise) {
            this.connectPromise = null;
          }
        });
      this.connectPromise = connectPromise;
    }

    await this.connectPromise;
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      if (this.ownsClient) {
        await this.client.close();
      }
      this.connected = false;
      this.connectPromise = null;
    }
  }

  async subscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    await this.client.sAdd(this.subscriptionsSetKey(), threadId);
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    await this.client.sRem(this.subscriptionsSetKey(), threadId);
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    this.ensureConnected();
    const result = await this.client.sIsMember(
      this.subscriptionsSetKey(),
      threadId
    );
    return result === 1;
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    this.ensureConnected();

    const token = generateToken();
    const lockKey = this.key("lock", threadId);

    // Use SET NX EX for atomic lock acquisition
    const acquired = await this.client.set(lockKey, token, {
      NX: true,
      PX: ttlMs,
    });

    if (acquired) {
      return {
        threadId,
        token,
        expiresAt: Date.now() + ttlMs,
      };
    }

    return null;
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    this.ensureConnected();
    const lockKey = this.key("lock", threadId);
    await this.client.del(lockKey);
  }

  async releaseLock(lock: Lock): Promise<void> {
    this.ensureConnected();

    const lockKey = this.key("lock", lock.threadId);

    // Use Lua script for atomic check-and-delete
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    await this.client.eval(script, {
      keys: [lockKey],
      arguments: [lock.token],
    });
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    this.ensureConnected();

    const lockKey = this.key("lock", lock.threadId);

    // Use Lua script for atomic check-and-extend
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("pexpire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;

    const result = await this.client.eval(script, {
      keys: [lockKey],
      arguments: [lock.token, ttlMs.toString()],
    });

    return result === 1;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    this.ensureConnected();

    const cacheKey = this.key("cache", key);
    const value = await this.client.get(cacheKey);

    if (value === null) {
      return null;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      // If parsing fails, return as string
      return value as unknown as T;
    }
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.ensureConnected();

    const cacheKey = this.key("cache", key);
    const serialized = JSON.stringify(value);

    if (ttlMs) {
      await this.client.set(cacheKey, serialized, { PX: ttlMs });
    } else {
      await this.client.set(cacheKey, serialized);
    }
  }

  async setIfNotExists(
    key: string,
    value: unknown,
    ttlMs?: number
  ): Promise<boolean> {
    this.ensureConnected();

    const cacheKey = this.key("cache", key);
    const serialized = JSON.stringify(value);

    const result = ttlMs
      ? await this.client.set(cacheKey, serialized, { NX: true, PX: ttlMs })
      : await this.client.set(cacheKey, serialized, { NX: true });

    return result !== null;
  }

  async delete(key: string): Promise<void> {
    this.ensureConnected();

    const cacheKey = this.key("cache", key);
    await this.client.del(cacheKey);
  }

  async appendToList(
    key: string,
    value: unknown,
    options?: { maxLength?: number; ttlMs?: number }
  ): Promise<void> {
    this.ensureConnected();

    const listKey = `${this.keyPrefix}:list:${key}`;
    const serialized = JSON.stringify(value);
    const maxLength = options?.maxLength ?? 0;
    const ttlMs = options?.ttlMs ?? 0;

    // Atomic RPUSH + LTRIM + PEXPIRE via Lua
    const script = `
      redis.call("rpush", KEYS[1], ARGV[1])
      if tonumber(ARGV[2]) > 0 then
        redis.call("ltrim", KEYS[1], -tonumber(ARGV[2]), -1)
      end
      if tonumber(ARGV[3]) > 0 then
        redis.call("pexpire", KEYS[1], tonumber(ARGV[3]))
      end
      return 1
    `;

    await this.client.eval(script, {
      keys: [listKey],
      arguments: [serialized, maxLength.toString(), ttlMs.toString()],
    });
  }

  async enqueue(
    threadId: string,
    entry: QueueEntry,
    maxSize: number
  ): Promise<number> {
    this.ensureConnected();

    const queueKey = this.key("queue", threadId);
    const serialized = JSON.stringify(entry);

    // Atomic RPUSH + LTRIM + PEXPIRE via Lua
    const script = `
      redis.call("rpush", KEYS[1], ARGV[1])
      if tonumber(ARGV[2]) > 0 then
        redis.call("ltrim", KEYS[1], -tonumber(ARGV[2]), -1)
      end
      redis.call("pexpire", KEYS[1], ARGV[3])
      return redis.call("llen", KEYS[1])
    `;

    const ttlMs = Math.max(entry.expiresAt - Date.now(), 60_000).toString();

    const result = await this.client.eval(script, {
      keys: [queueKey],
      arguments: [serialized, maxSize.toString(), ttlMs],
    });

    return result as number;
  }

  async dequeue(threadId: string): Promise<QueueEntry | null> {
    this.ensureConnected();

    const queueKey = this.key("queue", threadId);
    const value = await this.client.lPop(queueKey);

    if (value === null) {
      return null;
    }

    return JSON.parse(value) as QueueEntry;
  }

  async queueDepth(threadId: string): Promise<number> {
    this.ensureConnected();

    const queueKey = this.key("queue", threadId);
    return await this.client.lLen(queueKey);
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    this.ensureConnected();

    const listKey = `${this.keyPrefix}:list:${key}`;
    const values = await this.client.lRange(listKey, 0, -1);

    return values.map((v) => JSON.parse(v) as T);
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(
        "RedisStateAdapter is not connected. Call connect() first."
      );
    }
  }

  /**
   * Get the underlying Redis client for advanced usage.
   */
  getClient(): RedisClientType {
    return this.client;
  }
}

function generateToken(): string {
  return `redis_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

export function createRedisState(
  options: CreateRedisStateOptions = {}
): RedisStateAdapter {
  if (options.client) {
    return new RedisStateAdapter({
      client: options.client,
      keyPrefix: options.keyPrefix,
      logger: options.logger,
    });
  }

  const url = options.url ?? process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      "Redis url is required. Set REDIS_URL or provide url in options."
    );
  }
  const resolved: RedisStateAdapterOptions = {
    url,
    keyPrefix: options.keyPrefix,
    logger: options.logger,
  };
  return new RedisStateAdapter(resolved);
}
