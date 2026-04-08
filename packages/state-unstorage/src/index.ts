import type { Lock, Logger, QueueEntry, StateAdapter } from "chat";
import { ConsoleLogger } from "chat";
import { createStorage, type Driver, type Storage } from "unstorage";

interface LockRecord {
  expiresAt: number;
  token: string;
}

interface ValueRecord<T = unknown> {
  expiresAt: number | null;
  value: T;
}

interface ListRecord {
  expiresAt: number | null;
  items: unknown[];
}

interface QueueRecord {
  expiresAt: number;
  items: QueueEntry[];
}

interface MutexState {
  locked: boolean;
  waiters: Array<() => void>;
}

/**
 * Options for creating an unstorage-backed state adapter.
 */
export interface UnstorageStateAdapterOptions {
  /**
   * Driver used to create an internal unstorage instance.
   *
   * If omitted, unstorage's default in-memory driver is used.
   */
  driver?: Driver;
  /** Key prefix for all keys in storage (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for diagnostics and error reporting */
  logger?: Logger;
  /**
   * Existing unstorage instance.
   *
   * When provided, this adapter will not call `storage.dispose()` on disconnect.
   */
  storage?: Storage;
}

/**
 * Factory options for `createUnstorageState`.
 */
export interface CreateUnstorageStateOptions
  extends UnstorageStateAdapterOptions {}

/**
 * State adapter implementation built on top of unstorage.
 *
 * This adapter preserves the Chat SDK `StateAdapter` contract while delegating
 * persistence to any unstorage-compatible backend.
 */
export class UnstorageStateAdapter implements StateAdapter {
  private readonly keyPrefix: string;
  private readonly logger: Logger;
  private readonly ownsStorage: boolean;
  private readonly mutexes = new Map<string, MutexState>();
  private readonly storage: Storage;
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  constructor(options: UnstorageStateAdapterOptions = {}) {
    if (options.storage && options.driver) {
      throw new Error(
        "Provide either storage or driver, not both, when creating UnstorageStateAdapter."
      );
    }

    this.storage = options.storage ?? createStorage({ driver: options.driver });
    this.ownsStorage = !options.storage;
    this.keyPrefix = options.keyPrefix ?? "chat-sdk";
    this.logger =
      options.logger ?? new ConsoleLogger("info").child("unstorage");
  }

  /**
   * Connect to the underlying storage backend.
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (!this.connectPromise) {
      this.connectPromise = Promise.resolve().then(() => {
        this.connected = true;
      });
    }

    await this.connectPromise;
  }

  /**
   * Disconnect from the storage backend.
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    if (this.ownsStorage) {
      await this.storage.dispose();
    }

    this.connected = false;
    this.connectPromise = null;
    this.mutexes.clear();
  }

  /**
   * Subscribe to a thread.
   */
  async subscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    await this.withMutex(this.subscriptionsSetKey(), async () => {
      const subscriptions = await this.readSubscriptions();
      if (!subscriptions.includes(threadId)) {
        subscriptions.push(threadId);
        await this.storage.setItem(this.subscriptionsSetKey(), subscriptions);
      }
    });
  }

  /**
   * Unsubscribe from a thread.
   */
  async unsubscribe(threadId: string): Promise<void> {
    this.ensureConnected();
    await this.withMutex(this.subscriptionsSetKey(), async () => {
      const subscriptions = await this.readSubscriptions();
      const filtered = subscriptions.filter((id) => id !== threadId);
      await this.storage.setItem(this.subscriptionsSetKey(), filtered);
    });
  }

  /**
   * Check whether a thread is currently subscribed.
   */
  async isSubscribed(threadId: string): Promise<boolean> {
    this.ensureConnected();
    const subscriptions = await this.readSubscriptions();
    return subscriptions.includes(threadId);
  }

  /**
   * Acquire a lock for a specific thread.
   */
  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    this.ensureConnected();

    const lockKey = this.key("lock", threadId);
    return this.withMutex(lockKey, async () => {
      const current = await this.readLock(lockKey);
      if (current && current.expiresAt > Date.now()) {
        return null;
      }

      const token = generateToken();
      const expiresAt = Date.now() + ttlMs;

      await this.storage.setItem<LockRecord>(lockKey, { token, expiresAt });

      return {
        threadId,
        token,
        expiresAt,
      };
    });
  }

  /**
   * Force-release lock regardless of token ownership.
   */
  async forceReleaseLock(threadId: string): Promise<void> {
    this.ensureConnected();
    await this.storage.removeItem(this.key("lock", threadId));
  }

  /**
   * Release lock if the token matches the current lock owner.
   */
  async releaseLock(lock: Lock): Promise<void> {
    this.ensureConnected();

    const lockKey = this.key("lock", lock.threadId);
    await this.withMutex(lockKey, async () => {
      const current = await this.readLock(lockKey);
      if (current?.token === lock.token) {
        await this.storage.removeItem(lockKey);
      }
    });
  }

  /**
   * Extend lock TTL if token matches and lock is still active.
   */
  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    this.ensureConnected();

    const lockKey = this.key("lock", lock.threadId);
    return this.withMutex(lockKey, async () => {
      const current = await this.readLock(lockKey);
      if (!current || current.token !== lock.token) {
        return false;
      }

      if (current.expiresAt <= Date.now()) {
        await this.storage.removeItem(lockKey);
        return false;
      }

      await this.storage.setItem<LockRecord>(lockKey, {
        token: current.token,
        expiresAt: Date.now() + ttlMs,
      });
      return true;
    });
  }

  /**
   * Get cached value.
   */
  async get<T = unknown>(key: string): Promise<T | null> {
    this.ensureConnected();

    const cacheKey = this.key("cache", key);
    const record = await this.readValueRecord<T>(cacheKey);

    if (!record) {
      return null;
    }

    if (record.expiresAt !== null && record.expiresAt <= Date.now()) {
      await this.storage.removeItem(cacheKey);
      return null;
    }

    return record.value;
  }

  /**
   * Set cached value with optional TTL.
   */
  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.ensureConnected();

    const expiresAt = ttlMs ? Date.now() + ttlMs : null;
    await this.storage.setItem<ValueRecord<T>>(this.key("cache", key), {
      value,
      expiresAt,
    });
  }

  /**
   * Atomically set cached value only if key does not already exist.
   */
  async setIfNotExists(
    key: string,
    value: unknown,
    ttlMs?: number
  ): Promise<boolean> {
    this.ensureConnected();

    const cacheKey = this.key("cache", key);
    return this.withMutex(cacheKey, async () => {
      const current = await this.readValueRecord(cacheKey);
      if (
        current &&
        (current.expiresAt === null || current.expiresAt > Date.now())
      ) {
        return false;
      }

      await this.storage.setItem<ValueRecord>(cacheKey, {
        value,
        expiresAt: ttlMs ? Date.now() + ttlMs : null,
      });
      return true;
    });
  }

  /**
   * Delete cached value.
   */
  async delete(key: string): Promise<void> {
    this.ensureConnected();
    await this.storage.removeItem(this.key("cache", key));
  }

  /**
   * Append value to a list, optionally trimming to max length and refreshing TTL.
   */
  async appendToList(
    key: string,
    value: unknown,
    options?: { maxLength?: number; ttlMs?: number }
  ): Promise<void> {
    this.ensureConnected();

    const listKey = this.key("list", key);
    await this.withMutex(listKey, async () => {
      const now = Date.now();
      const current = await this.readListRecord(listKey);

      const currentExpiresAt = current?.expiresAt ?? null;
      const isExpired = currentExpiresAt !== null && currentExpiresAt <= now;

      const items = isExpired ? [] : [...(current?.items ?? [])];
      items.push(value);

      const maxLength = options?.maxLength ?? 0;
      const trimmedItems =
        maxLength > 0 && items.length > maxLength
          ? items.slice(items.length - maxLength)
          : items;

      let expiresAt: number | null;
      if (options?.ttlMs !== undefined) {
        expiresAt = options.ttlMs > 0 ? now + options.ttlMs : null;
      } else if (isExpired) {
        expiresAt = null;
      } else {
        expiresAt = currentExpiresAt;
      }

      await this.storage.setItem<ListRecord>(listKey, {
        items: trimmedItems,
        expiresAt,
      });
    });
  }

  /**
   * Enqueue an entry and keep only newest `maxSize` entries.
   */
  async enqueue(
    threadId: string,
    entry: QueueEntry,
    maxSize: number
  ): Promise<number> {
    this.ensureConnected();

    const queueKey = this.key("queue", threadId);
    return this.withMutex(queueKey, async () => {
      const now = Date.now();
      const current = await this.readQueueRecord(queueKey);

      const isExpired = current ? current.expiresAt <= now : false;
      const items = isExpired ? [] : [...(current?.items ?? [])];

      items.push(entry);
      if (maxSize > 0 && items.length > maxSize) {
        items.splice(0, items.length - maxSize);
      }

      const ttlMs = Math.max(entry.expiresAt - now, 60_000);
      await this.storage.setItem<QueueRecord>(queueKey, {
        items,
        expiresAt: now + ttlMs,
      });

      return items.length;
    });
  }

  /**
   * Dequeue the oldest queued entry for a thread.
   */
  async dequeue(threadId: string): Promise<QueueEntry | null> {
    this.ensureConnected();

    const queueKey = this.key("queue", threadId);
    return this.withMutex(queueKey, async () => {
      const now = Date.now();
      const current = await this.readQueueRecord(queueKey);

      if (!current || current.expiresAt <= now || current.items.length === 0) {
        await this.storage.removeItem(queueKey);
        return null;
      }

      const queueItems = current.items;
      const [entry, ...rest] = queueItems;
      if (!entry) {
        return null;
      }

      if (rest.length === 0) {
        await this.storage.removeItem(queueKey);
      } else {
        await this.storage.setItem<QueueRecord>(queueKey, {
          items: rest,
          expiresAt: current.expiresAt,
        });
      }

      return entry;
    });
  }

  /**
   * Get current queue depth for a thread.
   */
  async queueDepth(threadId: string): Promise<number> {
    this.ensureConnected();

    const queueKey = this.key("queue", threadId);
    const current = await this.readQueueRecord(queueKey);

    if (!current) {
      return 0;
    }

    if (current.expiresAt <= Date.now()) {
      await this.storage.removeItem(queueKey);
      return 0;
    }

    return current.items.length;
  }

  /**
   * Read list values in insertion order.
   */
  async getList<T = unknown>(key: string): Promise<T[]> {
    this.ensureConnected();

    const listKey = this.key("list", key);
    const record = await this.readListRecord(listKey);

    if (!record) {
      return [];
    }

    if (record.expiresAt !== null && record.expiresAt <= Date.now()) {
      await this.storage.removeItem(listKey);
      return [];
    }

    return record.items as T[];
  }

  /**
   * Exposes underlying unstorage instance.
   */
  getStorage(): Storage {
    return this.storage;
  }

  private key(
    type: "cache" | "list" | "lock" | "queue" | "sub",
    id: string
  ): string {
    return `${this.keyPrefix}:${type}:${id}`;
  }

  private subscriptionsSetKey(): string {
    return `${this.keyPrefix}:subscriptions`;
  }

  private async readSubscriptions(): Promise<string[]> {
    const raw = await this.storage.getItem<unknown>(this.subscriptionsSetKey());
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.filter((entry): entry is string => typeof entry === "string");
  }

  private async readLock(key: string): Promise<LockRecord | null> {
    const raw = await this.storage.getItem<unknown>(key);
    if (!isObject(raw)) {
      return null;
    }

    const expiresAt = raw.expiresAt;
    const token = raw.token;
    if (typeof expiresAt !== "number" || typeof token !== "string") {
      return null;
    }

    return { expiresAt, token };
  }

  private async readValueRecord<T = unknown>(
    key: string
  ): Promise<ValueRecord<T> | null> {
    const raw = await this.storage.getItem<unknown>(key);
    if (!(isObject(raw) && "value" in raw)) {
      return null;
    }

    const expiresAt = raw.expiresAt;
    if (expiresAt !== null && typeof expiresAt !== "number") {
      return null;
    }

    return {
      value: raw.value as T,
      expiresAt: expiresAt ?? null,
    };
  }

  private async readListRecord(key: string): Promise<ListRecord | null> {
    const raw = await this.storage.getItem<unknown>(key);
    if (!(isObject(raw) && Array.isArray(raw.items))) {
      return null;
    }

    const expiresAt = raw.expiresAt;
    if (
      expiresAt !== null &&
      expiresAt !== undefined &&
      typeof expiresAt !== "number"
    ) {
      return null;
    }

    return {
      items: raw.items,
      expiresAt: expiresAt ?? null,
    };
  }

  private async readQueueRecord(key: string): Promise<QueueRecord | null> {
    const raw = await this.storage.getItem<unknown>(key);
    if (!(isObject(raw) && Array.isArray(raw.items))) {
      return null;
    }

    const expiresAt = raw.expiresAt;
    if (typeof expiresAt !== "number") {
      return null;
    }

    return {
      items: raw.items as QueueEntry[],
      expiresAt,
    };
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(
        "UnstorageStateAdapter is not connected. Call connect() first."
      );
    }
  }

  private async withMutex<T>(key: string, task: () => Promise<T>): Promise<T> {
    const release = await this.acquireMutex(key);
    try {
      return await task();
    } finally {
      release();
    }
  }

  private async acquireMutex(key: string): Promise<() => void> {
    let state = this.mutexes.get(key);
    if (!state) {
      state = { locked: false, waiters: [] };
      this.mutexes.set(key, state);
    }

    if (!state.locked) {
      state.locked = true;
      return () => this.releaseMutex(key);
    }

    await new Promise<void>((resolve) => {
      state.waiters.push(resolve);
    });

    return () => this.releaseMutex(key);
  }

  private releaseMutex(key: string): void {
    const state = this.mutexes.get(key);
    if (!state) {
      return;
    }

    const next = state.waiters.shift();
    if (next) {
      next();
      return;
    }

    state.locked = false;
    this.mutexes.delete(key);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function generateToken(): string {
  return `unstorage_${Date.now()}_${Math.random().toString(36).slice(2, 15)}`;
}

/**
 * Create a new unstorage-backed state adapter.
 */
export function createUnstorageState(
  options: CreateUnstorageStateOptions = {}
): UnstorageStateAdapter {
  return new UnstorageStateAdapter(options);
}
