import type {
  ChannelHistoryApi,
  FetchOptions,
  FetchResult,
  ListThreadsOptions,
  ListThreadsResult,
} from "../types";
import type {
  AdapterResolver,
  ListThreadsWithMessagesOptions,
  ListThreadsWithMessagesResult,
  ThreadWithMessages,
} from "./types";

const DEFAULT_MAX_THREADS = 5;

/**
 * Channel-level history implementation.
 *
 * The `messages()` and `threads()` methods satisfy the {@link ChannelHistoryApi}
 * interface and delegate to the appropriate adapter method.
 *
 * The extended method `listThreadsWithMessages()` is not part of the interface
 * but provides a convenient way to retrieve threads together with their
 * messages in a single call.
 *
 * Adapter resolution: the adapter name is derived from the channel ID prefix
 * (`{adapter}:{channel}`).
 */
export class ChannelHistoryApiImpl implements ChannelHistoryApi {
  private readonly getAdapter: AdapterResolver;

  constructor(getAdapter: AdapterResolver) {
    this.getAdapter = getAdapter;
  }

  /**
   * Fetch top-level messages in a channel (not thread replies).
   *
   * Uses `adapter.fetchChannelMessages` when available, falling back to
   * `adapter.fetchMessages` for adapters that unify channel and thread
   * addressing (e.g. Discord, Telegram).
   *
   * @throws if the adapter for the channel ID is not registered
   */
  async listMessages(
    channelId: string,
    options?: FetchOptions
  ): Promise<FetchResult> {
    const adapter = this.requireAdapter(channelId);

    if (adapter.fetchChannelMessages) {
      return adapter.fetchChannelMessages(channelId, options);
    }

    // Fallback: treat the channelId as a thread ID for adapters that do not
    // distinguish between channel-level and thread-level messages.
    return adapter.fetchMessages(channelId, options);
  }

  /**
   * List threads in a channel.
   *
   * Delegates to `adapter.listThreads`.
   *
   * @throws if the adapter does not implement `listThreads`
   */
  async listThreads(
    channelId: string,
    options?: ListThreadsOptions
  ): Promise<ListThreadsResult> {
    const adapter = this.requireAdapter(channelId);

    if (!adapter.listThreads) {
      throw new Error(
        `history.channel.listThreads: adapter "${adapter.name}" does not implement listThreads`
      );
    }

    return adapter.listThreads(channelId, options);
  }

  /**
   * Convenience method: list threads and fetch a page of messages for each.
   *
   * Fetches up to `maxThreads` (default 5) threads, then retrieves
   * `messagesPerThread` messages for each in parallel.
   *
   * @throws if the adapter does not implement `listThreads`
   */
  async listThreadsWithMessages(
    channelId: string,
    options?: ListThreadsWithMessagesOptions
  ): Promise<ListThreadsWithMessagesResult> {
    const maxThreads = options?.maxThreads ?? DEFAULT_MAX_THREADS;
    const messagesPerThread = options?.messagesPerThread;

    const threadsResult = await this.listThreads(channelId, {
      cursor: options?.cursor,
      limit: maxThreads,
    });

    const adapter = this.requireAdapter(channelId);
    const threads: ThreadWithMessages[] = await Promise.all(
      threadsResult.threads.map(async (summary) => {
        const result = await adapter.fetchMessages(
          summary.id,
          messagesPerThread !== undefined
            ? { limit: messagesPerThread }
            : undefined
        );
        return { threadId: summary.id, messages: result.messages };
      })
    );

    return {
      threads,
      nextCursor: threadsResult.nextCursor,
    };
  }

  private requireAdapter(id: string) {
    const adapterName = id.split(":")[0];
    if (!adapterName) {
      throw new Error(
        `history.channel: cannot resolve adapter from ID "${id}" — expected format "{adapter}:{channel}"`
      );
    }
    const adapter = this.getAdapter(adapterName);
    if (!adapter) {
      throw new Error(
        `history.channel: no adapter registered with name "${adapterName}"`
      );
    }
    return adapter;
  }
}
