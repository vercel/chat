import type { Lock, Logger, StateAdapter } from "chat";
import Redis from "ioredis";

export interface IoRedisStateAdapterOptions {
  /** Key prefix for all Redis keys (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger: Logger;
  /** Redis connection URL (e.g., redis://localhost:6379) */
  url: string;
}

export interface IoRedisStateClientOptions {
  /** Existing ioredis client instance */
  client: Redis;
  /** Key prefix for all Redis keys (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger: Logger;
}

/**
 * Redis state adapter using ioredis for production use.
 *
 * Provides persistent subscriptions and distributed locking
 * across multiple server instances.
 *
 * @example
 * ```typescript
 * // With URL
 * const state = createIoRedisState({ url: process.env.REDIS_URL });
 *
 * // With existing client
 * const client = new Redis(process.env.REDIS_URL);
 * const state = createIoRedisState({ client });
 * ```
 */
export class IoRedisStateAdapter implements StateAdapter {
  private readonly client: Redis;
  private readonly keyPrefix: string;
  private readonly logger: Logger;
  private connected = false;
  private connectPromise: Promise<void> | null = null;
  private readonly ownsClient: boolean;

  constructor(options: IoRedisStateAdapterOptions | IoRedisStateClientOptions) {
    if ("client" in options) {
      this.client = options.client;
      this.ownsClient = false;
    } else {
      this.client = new Redis(options.url);
      this.ownsClient = true;
    }
    this.keyPrefix = options.keyPrefix || "chat-sdk";
    this.logger = options.logger;

    // Handle connection errors
    this.client.on("error", (err) => {
      this.logger.error("ioredis client error", { error: err });
    });
  }

  private key(type: "sub" | "lock" | "cache", id: string): string {
    return `${this.keyPrefix}:${type}:${id}`;
  }

  private subscriptionsSetKey(): string {
    return `${this.keyPrefix}:subscriptions`;
  }

  async connect(): Promise<void> {
    // ioredis auto-connects, but we track state for consistency
    if (this.connected) {
      return;
    }

    // Reuse existing connection attempt to avoid race conditions
    if (!this.connectPromise) {
      this.connectPromise = new Promise<void>((resolve, reject) => {
        if (this.client.status === "ready") {
          this.connected = true;
          resolve();
          return;
        }

        this.client.once("ready", () => {
          this.connected = true;
          resolve();
        });

        this.client.once("error", (err) => {
          reject(err);
        });
      });
    }

    await this.connectPromise;
  }

  async disconnect(): Promise<void> {
    if (this.connected && this.ownsClient) {
      await this.client.quit();
      this.connected = false;
      this.connectPromise = null;
    }
  }

  async subscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    await this.client.sadd(this.subscriptionsSetKey(), threadId);
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    await this.client.srem(this.subscriptionsSetKey(), threadId);
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    this.ensureConnected();
    const result = await this.client.sismember(
      this.subscriptionsSetKey(),
      threadId
    );
    return result === 1;
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    this.ensureConnected();

    const token = generateToken();
    const lockKey = this.key("lock", threadId);

    // Use SET NX PX for atomic lock acquisition
    const acquired = await this.client.set(lockKey, token, "PX", ttlMs, "NX");

    if (acquired === "OK") {
      return {
        threadId,
        token,
        expiresAt: Date.now() + ttlMs,
      };
    }

    return null;
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

    await this.client.eval(script, 1, lockKey, lock.token);
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

    const result = await this.client.eval(
      script,
      1,
      lockKey,
      lock.token,
      ttlMs.toString()
    );

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
      await this.client.set(cacheKey, serialized, "PX", ttlMs);
    } else {
      await this.client.set(cacheKey, serialized);
    }
  }

  async delete(key: string): Promise<void> {
    this.ensureConnected();

    const cacheKey = this.key("cache", key);
    await this.client.del(cacheKey);
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(
        "IoRedisStateAdapter is not connected. Call connect() first."
      );
    }
  }

  /**
   * Get the underlying ioredis client for advanced usage.
   */
  getClient(): Redis {
    return this.client;
  }
}

function generateToken(): string {
  return `ioredis_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Create an ioredis state adapter.
 *
 * @example
 * ```typescript
 * // With URL
 * const state = createIoRedisState({ url: process.env.REDIS_URL });
 *
 * // With existing client
 * import Redis from "ioredis";
 * const client = new Redis(process.env.REDIS_URL);
 * const state = createIoRedisState({ client });
 * ```
 */
export function createIoRedisState(
  options: IoRedisStateAdapterOptions | IoRedisStateClientOptions
): IoRedisStateAdapter {
  return new IoRedisStateAdapter(options);
}
