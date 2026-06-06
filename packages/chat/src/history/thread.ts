import type { Message } from "../message";
import type { FetchOptions, FetchResult, ThreadHistoryApi } from "../types";
import type { AdapterResolver, ThreadHistoryCollectOptions } from "./types";

/**
 * Per-thread message history implementation.
 *
 * The `list()` method satisfies the {@link ThreadHistoryApi} interface and
 * delegates to `adapter.fetchMessages`.
 *
 * The extended methods `collect()` and `append()` are not part of the
 * interface but are available on the concrete class:
 * - `collect()` — async generator that paginates through all thread messages
 * - `append()` — appends to a {@link ThreadHistoryCache}-backed store (for
 *   adapters with `persistThreadHistory: true`, accessed via the optional
 *   `cache` argument on the constructor)
 *
 * Adapter resolution: the adapter name is derived from the thread ID prefix
 * (`{adapter}:{channel}:{thread}`).
 */
export class ThreadHistoryApiImpl implements ThreadHistoryApi {
  private readonly getAdapter: AdapterResolver;
  private readonly cache: ThreadHistoryCacheLike | undefined;

  constructor(getAdapter: AdapterResolver, cache?: ThreadHistoryCacheLike) {
    this.getAdapter = getAdapter;
    this.cache = cache;
  }

  /**
   * Fetch a single page of messages from a thread.
   *
   * Uses `adapter.fetchMessages`. If the adapter cannot be resolved (e.g.
   * the adapter name embedded in the thread ID is not registered), throws.
   */
  async list(threadId: string, options?: FetchOptions): Promise<FetchResult> {
    const adapterName = threadId.split(":")[0];
    const adapter = adapterName ? this.getAdapter(adapterName) : undefined;

    if (adapter) {
      const result = await adapter.fetchMessages(threadId, options);
      if (result.messages.length > 0 || !this.cache) {
        return result;
      }
    }

    if (this.cache) {
      const cached = await this.cache.getMessages(threadId, options?.limit);
      return { messages: cached, nextCursor: undefined };
    }

    throw new Error(
      `history.thread.list: no adapter or cache found for thread "${threadId}"`
    );
  }

  /**
   * Async generator that yields all messages in the thread in chronological
   * order, handling pagination automatically.
   *
   * Falls back to the `ThreadHistoryCache` (if one was provided at
   * construction time) when the adapter cannot be resolved — useful for
   * platforms like Telegram/WhatsApp that use the SDK-side store.
   */
  async *collect(
    threadId: string,
    options?: ThreadHistoryCollectOptions
  ): AsyncIterable<Message> {
    const adapterName = threadId.split(":")[0];
    const adapter = adapterName ? this.getAdapter(adapterName) : undefined;
    const limit = options?.limit;
    let collected = 0;

    if (adapter) {
      let cursor: string | undefined;
      let yieldedAny = false;
      do {
        const fetchLimit =
          limit !== undefined ? Math.min(100, limit - collected) : 100;
        const result: FetchResult = await adapter.fetchMessages(threadId, {
          direction: "forward",
          cursor,
          limit: fetchLimit,
        });
        for (const message of result.messages) {
          yieldedAny = true;
          yield message;
          collected++;
          if (limit !== undefined && collected >= limit) {
            return;
          }
        }
        cursor = result.nextCursor;
      } while (cursor !== undefined);

      if (yieldedAny) {
        return;
      }
    }

    // Cache fallback for adapters that don't have server-side history
    if (this.cache) {
      const messages = await this.cache.getMessages(threadId, limit);
      for (const message of messages) {
        yield message;
      }
      return;
    }

    throw new Error(
      `history.thread.collect: no adapter or cache found for thread "${threadId}"`
    );
  }

  /**
   * Append a message to the SDK-side per-thread history cache.
   *
   * Only available when a `ThreadHistoryCache` was passed at construction
   * time. Used by adapters that set `persistThreadHistory: true`.
   */
  async append(threadId: string, message: Message): Promise<void> {
    if (!this.cache) {
      throw new Error(
        "history.thread.append: no ThreadHistoryCache was provided at construction"
      );
    }
    await this.cache.append(threadId, message);
  }
}

/**
 * Minimal shape of the `ThreadHistoryCache` needed by this module.
 * Avoids a hard import of `ThreadHistoryCache` to keep the module testable.
 *
 * @internal
 */
export interface ThreadHistoryCacheLike {
  append(threadId: string, message: Message): Promise<void>;
  getMessages(threadId: string, limit?: number): Promise<Message[]>;
}
