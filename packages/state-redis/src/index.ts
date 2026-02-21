import type { Lock, Logger, StateAdapter } from "chat";
import { createClient, type RedisClientType } from "redis";

export interface RedisStateAdapterOptions {
  /** Key prefix for all Redis keys (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger: Logger;
  /** Redis connection URL (e.g., redis://localhost:6379) */
  url: string;
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
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  constructor(options: RedisStateAdapterOptions) {
    this.client = createClient({ url: options.url });
    this.keyPrefix = options.keyPrefix || "chat-sdk";
    this.logger = options.logger;

    // Handle connection errors
    this.client.on("error", (err) => {
      this.logger.error("Redis client error", { error: err });
    });
  }

  private key(type: "sub" | "lock" | "cache", id: string): string {
    return `${this.keyPrefix}:${type}:${id}`;
  }

  private subscriptionsSetKey(): string {
    return `${this.keyPrefix}:subscriptions`;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    // Reuse existing connection attempt to avoid race conditions
    if (!this.connectPromise) {
      this.connectPromise = this.client.connect().then(() => {
        this.connected = true;
      });
    }

    await this.connectPromise;
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.quit();
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
    return this.client.sIsMember(this.subscriptionsSetKey(), threadId);
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

  async delete(key: string): Promise<void> {
    this.ensureConnected();

    const cacheKey = this.key("cache", key);
    await this.client.del(cacheKey);
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
  options: RedisStateAdapterOptions
): RedisStateAdapter {
  return new RedisStateAdapter(options);
}
