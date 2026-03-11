import type { Lock, StateAdapter } from "chat";

interface MemoryLock extends Lock {
  expiresAt: number;
  threadId: string;
  token: string;
}

interface CachedValue<T = unknown> {
  expiresAt: number | null; // null = no expiry
  value: T;
}

/**
 * In-memory state adapter for development and testing.
 *
 * WARNING: State is not persisted across restarts.
 * Use RedisStateAdapter for production.
 */
export class MemoryStateAdapter implements StateAdapter {
  private readonly subscriptions = new Set<string>();
  private readonly locks = new Map<string, MemoryLock>();
  private readonly cache = new Map<string, CachedValue>();
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    // Reuse existing connection attempt to avoid race conditions
    if (!this.connectPromise) {
      this.connectPromise = Promise.resolve().then(() => {
        if (process.env.NODE_ENV === "production") {
          console.warn(
            "[chat] MemoryStateAdapter is not recommended for production. " +
              "Consider using @chat-adapter/state-redis instead."
          );
        }
        this.connected = true;
      });
    }

    await this.connectPromise;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.connectPromise = null;
    this.subscriptions.clear();
    this.locks.clear();
  }

  async subscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    this.subscriptions.add(threadId);
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    this.subscriptions.delete(threadId);
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    this.ensureConnected();
    return this.subscriptions.has(threadId);
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    this.ensureConnected();
    this.cleanExpiredLocks();

    // Check if already locked
    const existingLock = this.locks.get(threadId);
    if (existingLock && existingLock.expiresAt > Date.now()) {
      return null;
    }

    // Create new lock
    const lock: MemoryLock = {
      threadId,
      token: generateToken(),
      expiresAt: Date.now() + ttlMs,
    };

    this.locks.set(threadId, lock);
    return lock;
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    this.ensureConnected();
    this.locks.delete(threadId);
  }

  async releaseLock(lock: Lock): Promise<void> {
    this.ensureConnected();

    const existingLock = this.locks.get(lock.threadId);
    if (existingLock && existingLock.token === lock.token) {
      this.locks.delete(lock.threadId);
    }
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    this.ensureConnected();

    const existingLock = this.locks.get(lock.threadId);
    if (!existingLock || existingLock.token !== lock.token) {
      return false;
    }

    if (existingLock.expiresAt < Date.now()) {
      // Lock has already expired
      this.locks.delete(lock.threadId);
      return false;
    }

    // Extend the lock
    existingLock.expiresAt = Date.now() + ttlMs;
    return true;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    this.ensureConnected();

    const cached = this.cache.get(key);
    if (!cached) {
      return null;
    }

    // Check if expired
    if (cached.expiresAt !== null && cached.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }

    return cached.value as T;
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.ensureConnected();

    this.cache.set(key, {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : null,
    });
  }

  async setIfNotExists(
    key: string,
    value: unknown,
    ttlMs?: number
  ): Promise<boolean> {
    this.ensureConnected();

    const existing = this.cache.get(key);
    if (existing) {
      // Check if expired
      if (existing.expiresAt !== null && existing.expiresAt <= Date.now()) {
        this.cache.delete(key);
      } else {
        return false;
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : null,
    });
    return true;
  }

  async delete(key: string): Promise<void> {
    this.ensureConnected();
    this.cache.delete(key);
  }

  async appendToList(
    key: string,
    value: unknown,
    options?: { maxLength?: number; ttlMs?: number }
  ): Promise<void> {
    this.ensureConnected();

    const cached = this.cache.get(key);
    let list: unknown[];

    if (cached && cached.expiresAt !== null && cached.expiresAt <= Date.now()) {
      // Expired — start fresh
      list = [];
    } else if (cached && Array.isArray(cached.value)) {
      list = cached.value;
    } else {
      list = [];
    }

    list.push(value);

    if (options?.maxLength && list.length > options.maxLength) {
      list = list.slice(list.length - options.maxLength);
    }

    this.cache.set(key, {
      value: list,
      expiresAt: options?.ttlMs ? Date.now() + options.ttlMs : null,
    });
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    this.ensureConnected();

    const cached = this.cache.get(key);
    if (!cached) {
      return [];
    }

    if (cached.expiresAt !== null && cached.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return [];
    }

    if (Array.isArray(cached.value)) {
      return cached.value as T[];
    }

    return [];
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(
        "MemoryStateAdapter is not connected. Call connect() first."
      );
    }
  }

  private cleanExpiredLocks(): void {
    const now = Date.now();
    for (const [threadId, lock] of this.locks) {
      if (lock.expiresAt <= now) {
        this.locks.delete(threadId);
      }
    }
  }

  // For testing purposes
  _getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  _getLockCount(): number {
    this.cleanExpiredLocks();
    return this.locks.size;
  }
}

function generateToken(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

export function createMemoryState(): MemoryStateAdapter {
  return new MemoryStateAdapter();
}
