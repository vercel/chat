/**
 * History API types — re-exports from the canonical type definitions plus
 * new aliases and supplementary types for the History API module.
 *
 * The source-of-truth interfaces (HistoryApi, ThreadHistoryApi,
 * ChannelHistoryApi, UserHistoryApi, UserHistoryConfig, HistoryConfig) live in
 * `packages/chat/src/types.ts` and are re-exported here for convenience.
 * Consumers that only need one sub-API can import directly from `../types`.
 */

export type {
  AppendInput,
  AppendOptions,
  ChannelHistoryApi,
  CountQuery,
  DeleteTarget,
  DurationString,
  FetchOptions,
  FetchResult,
  HistoryApi,
  HistoryConfig,
  ListQuery,
  ListThreadsOptions,
  ListThreadsResult,
  ThreadHistoryApi,
  // Transcripts backwards-compat API
  TranscriptEntry,
  TranscriptRole,
  TranscriptsApi,
  TranscriptsConfig,
  UserHistoryApi,
  UserHistoryConfig,
} from "../types";

import type { Adapter } from "../types";

// =============================================================================
// New aliases (canonical renames — the old names remain in types.ts)
// =============================================================================

/**
 * Canonical alias for {@link HistoryEntry}.
 */
/** Canonical alias for {@link TranscriptRole}. */
export type {
  HistoryEntry as UserHistoryEntry,
  TranscriptRole as UserHistoryRole,
} from "../types";

// =============================================================================
// Supplementary types for the extended impl API
// =============================================================================

/**
 * A thread ID with its collected messages — returned by the extended
 * {@link ChannelHistoryApiImpl.listThreadsWithMessages} helper.
 */
export interface ThreadWithMessages<TRawMessage = unknown> {
  messages: import("../message").Message<TRawMessage>[];
  threadId: string;
}

/** Options for `ChannelHistoryApiImpl.listThreadsWithMessages`. */
export interface ListThreadsWithMessagesOptions {
  /** Cursor for thread pagination. */
  cursor?: string;
  /**
   * Maximum number of threads to fetch (and then retrieve messages for).
   * @default 5
   */
  maxThreads?: number;
  /** Maximum messages to fetch per thread. */
  messagesPerThread?: number;
}

/** Result of `ChannelHistoryApiImpl.listThreadsWithMessages`. */
export interface ListThreadsWithMessagesResult<TRawMessage = unknown> {
  nextCursor?: string;
  threads: ThreadWithMessages<TRawMessage>[];
}

/** Options for `ThreadHistoryApiImpl.collect`. */
export interface ThreadHistoryCollectOptions {
  /**
   * Maximum total messages to collect. Defaults to all messages in the thread.
   */
  limit?: number;
}

// =============================================================================
// Prompt helpers
// =============================================================================

/**
 * A normalized entry suitable for passing to an LLM as part of a chat history
 * (e.g. AI SDK's `CoreMessage`).
 */
export interface PromptEntry {
  content: string;
  role: "user" | "assistant" | "system";
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Resolver function that maps an adapter name to its `Adapter` instance.
 * Passed to thread and channel impls so they can resolve adapters lazily.
 *
 * @internal
 */
export type AdapterResolver = (name: string) => Adapter | undefined;
