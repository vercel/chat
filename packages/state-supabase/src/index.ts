import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lock, Logger, StateAdapter } from "chat";
import { ConsoleLogger } from "chat";

const DEFAULT_KEY_PREFIX = "chat-sdk";
const DEFAULT_SCHEMA = "chat_state";

const RPC = {
  acquireLock: "chat_state_acquire_lock",
  appendToList: "chat_state_append_to_list",
  connect: "chat_state_connect",
  delete: "chat_state_delete",
  extendLock: "chat_state_extend_lock",
  forceReleaseLock: "chat_state_force_release_lock",
  get: "chat_state_get",
  getList: "chat_state_get_list",
  isSubscribed: "chat_state_is_subscribed",
  releaseLock: "chat_state_release_lock",
  set: "chat_state_set",
  setIfNotExists: "chat_state_set_if_not_exists",
  subscribe: "chat_state_subscribe",
  unsubscribe: "chat_state_unsubscribe",
} as const;

type AnySupabaseClient = SupabaseClient<any, any, any>;
type RpcArgs = Record<string, unknown>;

interface StoredLock {
  expiresAt: number;
  threadId: string;
  token: string;
}

export interface CreateSupabaseStateOptions {
  /** Existing Supabase client instance. Prefer a server-side service-role client. */
  client: AnySupabaseClient;
  /** Key prefix for all state rows (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger?: Logger;
  /** Schema containing the state RPC functions (default: "chat_state") */
  schema?: string;
}

export class SupabaseStateAdapter implements StateAdapter {
  private readonly client: AnySupabaseClient;
  private readonly keyPrefix: string;
  private readonly logger: Logger;
  private readonly schemaName: string;
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  constructor(options: CreateSupabaseStateOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix || DEFAULT_KEY_PREFIX;
    this.logger = options.logger ?? new ConsoleLogger("info").child("supabase");
    this.schemaName = options.schema || DEFAULT_SCHEMA;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (!this.connectPromise) {
      this.connectPromise = (async () => {
        try {
          await this.callRpc<boolean>(RPC.connect);
          this.connected = true;
        } catch (error) {
          this.connectPromise = null;
          this.logger.error("Supabase connect failed", { error });
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

    this.connected = false;
    this.connectPromise = null;
  }

  async subscribe(threadId: string): Promise<void> {
    this.ensureConnected();

    await this.callRpc<boolean>(RPC.subscribe, {
      p_key_prefix: this.keyPrefix,
      p_thread_id: threadId,
    });
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.ensureConnected();

    await this.callRpc<boolean>(RPC.unsubscribe, {
      p_key_prefix: this.keyPrefix,
      p_thread_id: threadId,
    });
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    this.ensureConnected();

    const result = await this.callRpc<boolean>(RPC.isSubscribed, {
      p_key_prefix: this.keyPrefix,
      p_thread_id: threadId,
    });

    return Boolean(result);
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    this.ensureConnected();

    const result = await this.callRpc<StoredLock | null>(RPC.acquireLock, {
      p_key_prefix: this.keyPrefix,
      p_thread_id: threadId,
      p_ttl_ms: ttlMs,
      p_token: generateToken(),
    });

    return normalizeLock(result);
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    this.ensureConnected();

    await this.callRpc<boolean>(RPC.forceReleaseLock, {
      p_key_prefix: this.keyPrefix,
      p_thread_id: threadId,
    });
  }

  async releaseLock(lock: Lock): Promise<void> {
    this.ensureConnected();

    await this.callRpc<boolean>(RPC.releaseLock, {
      p_key_prefix: this.keyPrefix,
      p_thread_id: lock.threadId,
      p_token: lock.token,
    });
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    this.ensureConnected();

    const result = await this.callRpc<boolean>(RPC.extendLock, {
      p_key_prefix: this.keyPrefix,
      p_thread_id: lock.threadId,
      p_ttl_ms: ttlMs,
      p_token: lock.token,
    });

    return Boolean(result);
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    this.ensureConnected();

    const result = await this.callRpc<T | null>(RPC.get, {
      p_cache_key: key,
      p_key_prefix: this.keyPrefix,
    });

    return result ?? null;
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.ensureConnected();

    await this.callRpc<boolean>(RPC.set, {
      p_cache_key: key,
      p_key_prefix: this.keyPrefix,
      p_ttl_ms: ttlMs ?? null,
      p_value: value,
    });
  }

  async setIfNotExists(
    key: string,
    value: unknown,
    ttlMs?: number
  ): Promise<boolean> {
    this.ensureConnected();

    const result = await this.callRpc<boolean>(RPC.setIfNotExists, {
      p_cache_key: key,
      p_key_prefix: this.keyPrefix,
      p_ttl_ms: ttlMs ?? null,
      p_value: value,
    });

    return Boolean(result);
  }

  async delete(key: string): Promise<void> {
    this.ensureConnected();

    await this.callRpc<boolean>(RPC.delete, {
      p_cache_key: key,
      p_key_prefix: this.keyPrefix,
    });
  }

  async appendToList(
    key: string,
    value: unknown,
    options?: { maxLength?: number; ttlMs?: number }
  ): Promise<void> {
    this.ensureConnected();

    await this.callRpc<boolean>(RPC.appendToList, {
      p_key_prefix: this.keyPrefix,
      p_list_key: key,
      p_max_length: options?.maxLength ?? null,
      p_ttl_ms: options?.ttlMs ?? null,
      p_value: value,
    });
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    this.ensureConnected();

    const result = await this.callRpc<T[] | null>(RPC.getList, {
      p_key_prefix: this.keyPrefix,
      p_list_key: key,
    });

    return Array.isArray(result) ? result : [];
  }

  getClient(): AnySupabaseClient {
    return this.client;
  }

  private async callRpc<T>(fn: string, args: RpcArgs = {}): Promise<T> {
    const { data, error } = await this.client
      .schema(this.schemaName)
      .rpc(fn, args);

    if (error) {
      throw error;
    }

    return data as T;
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(
        "SupabaseStateAdapter is not connected. Call connect() first."
      );
    }
  }
}

function generateToken(): string {
  return `sb_${randomUUID()}`;
}

function normalizeLock(lock: StoredLock | null): Lock | null {
  if (!lock) {
    return null;
  }

  const expiresAt =
    typeof lock.expiresAt === "number" ? lock.expiresAt : Number(lock.expiresAt);

  if (!Number.isFinite(expiresAt)) {
    return null;
  }

  return {
    expiresAt,
    threadId: lock.threadId,
    token: lock.token,
  };
}

export function createSupabaseState(
  options: CreateSupabaseStateOptions
): SupabaseStateAdapter {
  if (!options?.client) {
    throw new Error(
      "Supabase client is required. Create a server-side Supabase client and pass it in options."
    );
  }

  return new SupabaseStateAdapter(options);
}
