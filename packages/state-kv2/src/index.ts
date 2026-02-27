import {
  KV2,
  type KV2Options,
  type KVLike,
  KVVersionConflictError,
  type TypedKV,
} from "@vercel/kv2";
import type { Lock, Logger, StateAdapter } from "chat";

const TRAILING_SLASH_RE = /\/$/;

interface LockValue {
  expiresAt: number;
  token: string;
}

interface CachedValue<T = unknown> {
  expiresAt: number | null;
  value: T;
}

export interface Kv2StateAdapterOptions {
  /** Key prefix for all keys (default: "chat-sdk/") */
  keyPrefix?: string;
  /** Options passed to the KV2 constructor */
  kv2Options?: Omit<KV2Options, "prefix">;
  /** Logger instance for error reporting */
  logger: Logger;
}

export interface Kv2StateAdapterClientOptions {
  /** Existing KVLike instance (KV2, UpstreamKV, or TypedKV) */
  client: KVLike<unknown>;
  /** Key prefix for all keys (default: "chat-sdk/") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger: Logger;
}

/**
 * Vercel KV2 state adapter for production serverless use.
 *
 * Uses Vercel Blob-backed KV2 for persistent subscriptions,
 * distributed locking, and caching. Works in serverless
 * environments without persistent connections.
 *
 * Note: KV2 does not support TTL natively. TTLs for locks and
 * cache entries are enforced on read by checking stored timestamps.
 *
 * @example
 * ```typescript
 * const state = createKv2State({
 *   logger: myLogger,
 * });
 *
 * // Or with an existing KV2 client
 * const kv = new KV2({ prefix: "myapp/" });
 * const state = createKv2State({
 *   client: kv,
 *   logger: myLogger,
 * });
 * ```
 */
export class Kv2StateAdapter implements StateAdapter {
  private readonly subs: TypedKV<boolean, unknown>;
  private readonly locks: TypedKV<LockValue, unknown>;
  private readonly cache: TypedKV<CachedValue, unknown>;
  private readonly logger: Logger;
  private connected = false;

  constructor(options: Kv2StateAdapterOptions | Kv2StateAdapterClientOptions) {
    let kv: KVLike<unknown>;
    if ("client" in options) {
      kv = options.client;
    } else {
      const prefix = (options.keyPrefix ?? "chat-sdk").replace(
        TRAILING_SLASH_RE,
        ""
      );
      kv = new KV2({
        ...options.kv2Options,
        prefix: `${prefix}/`,
      });
    }

    this.subs = kv.getStore<boolean>("sub/");
    this.locks = kv.getStore<LockValue>("lock/");
    this.cache = kv.getStore<CachedValue>("cache/");
    this.logger = options.logger;
  }

  async connect(): Promise<void> {
    // KV2 is HTTP-based and doesn't require an explicit connection.
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async subscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    await this.subs.set(threadId, true);
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    await this.subs.delete(threadId);
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    this.ensureConnected();
    const result = await this.subs.get(threadId);
    return result.exists;
  }

  async *listSubscriptions(adapterName?: string): AsyncIterable<string> {
    this.ensureConnected();

    for await (const threadId of this.subs.keys()) {
      if (adapterName) {
        if (threadId.startsWith(`${adapterName}:`)) {
          yield threadId;
        }
      } else {
        yield threadId;
      }
    }
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    this.ensureConnected();

    const token = generateToken();
    const now = Date.now();
    const lockData: LockValue = {
      token,
      expiresAt: now + ttlMs,
    };

    const existing = await this.locks.get(threadId);

    if (existing.exists) {
      const existingValue = await existing.value;

      if (existingValue.expiresAt > now) {
        // Lock is still active
        return null;
      }

      // Lock has expired — try to take it over using optimistic locking
      try {
        await existing.update(lockData);
        return {
          threadId,
          token,
          expiresAt: lockData.expiresAt,
        };
      } catch (error) {
        if (error instanceof KVVersionConflictError) {
          // Someone else took the lock
          return null;
        }
        throw error;
      }
    }

    // No lock exists — try to create one atomically
    try {
      await this.locks.set(threadId, lockData, undefined, {
        override: false,
      });
      return {
        threadId,
        token,
        expiresAt: lockData.expiresAt,
      };
    } catch (error) {
      if (error instanceof KVVersionConflictError) {
        // Someone else created the lock first
        return null;
      }
      throw error;
    }
  }

  async releaseLock(lock: Lock): Promise<void> {
    this.ensureConnected();

    const existing = await this.locks.get(lock.threadId);
    if (!existing.exists) {
      return;
    }

    const value = await existing.value;
    if (value.token !== lock.token) {
      return;
    }

    try {
      await this.locks.delete(lock.threadId);
    } catch (error) {
      this.logger.error("Failed to release lock", {
        threadId: lock.threadId,
        error,
      });
    }
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    this.ensureConnected();

    const existing = await this.locks.get(lock.threadId);
    if (!existing.exists) {
      return false;
    }

    const value = await existing.value;
    if (value.token !== lock.token) {
      return false;
    }

    if (value.expiresAt < Date.now()) {
      return false;
    }

    try {
      await existing.update({
        token: lock.token,
        expiresAt: Date.now() + ttlMs,
      });
      return true;
    } catch (error) {
      if (error instanceof KVVersionConflictError) {
        return false;
      }
      throw error;
    }
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    this.ensureConnected();

    const result = await this.cache.get(key);
    if (!result.exists) {
      return null;
    }

    const cached = await result.value;

    // Check if expired
    if (cached.expiresAt !== null && cached.expiresAt <= Date.now()) {
      // Clean up expired entry in the background
      this.cache.delete(key).catch((error: unknown) => {
        this.logger.error("Failed to delete expired cache entry", {
          key,
          error,
        });
      });
      return null;
    }

    return cached.value as T;
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.ensureConnected();

    const cached: CachedValue<T> = {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : null,
    };

    await this.cache.set(key, cached);
  }

  async delete(key: string): Promise<void> {
    this.ensureConnected();
    await this.cache.delete(key);
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(
        "Kv2StateAdapter is not connected. Call connect() first."
      );
    }
  }
}

function generateToken(): string {
  return `kv2_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Create a Vercel KV2 state adapter.
 *
 * @example
 * ```typescript
 * // Default configuration (uses BLOB_READ_WRITE_TOKEN env var)
 * const state = createKv2State({
 *   logger: myLogger,
 * });
 *
 * // With an existing KV2 client
 * import { KV2 } from "@vercel/kv2";
 * const kv = new KV2({ prefix: "myapp/" });
 * const state = createKv2State({
 *   client: kv,
 *   logger: myLogger,
 * });
 * ```
 */
export function createKv2State(
  options: Kv2StateAdapterOptions | Kv2StateAdapterClientOptions
): Kv2StateAdapter {
  return new Kv2StateAdapter(options);
}
