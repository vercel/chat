import { Message, type SerializedMessage } from "./message";
import type { StateAdapter } from "./types";

/** Default maximum number of messages to store per thread */
const DEFAULT_MAX_MESSAGES = 100;

/** Default TTL for message history (7 days in milliseconds) */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Key prefix for message history entries */
const KEY_PREFIX = "msg-history:";

export interface MessageHistoryConfig {
  /** Maximum messages to keep per thread (default: 100) */
  maxMessages?: number;
  /** TTL for cached history in milliseconds (default: 7 days) */
  ttlMs?: number;
}

/**
 * Persistent message history cache backed by the StateAdapter.
 *
 * Used by adapters that lack server-side message history APIs (e.g., WhatsApp, Telegram).
 * Messages are atomically appended via `state.appendToList()`, which is safe
 * without holding a thread lock.
 */
export class MessageHistoryCache {
  private readonly state: StateAdapter;
  private readonly maxMessages: number;
  private readonly ttlMs: number;

  constructor(state: StateAdapter, config?: MessageHistoryConfig) {
    this.state = state;
    this.maxMessages = config?.maxMessages ?? DEFAULT_MAX_MESSAGES;
    this.ttlMs = config?.ttlMs ?? DEFAULT_TTL_MS;
  }

  /**
   * Atomically append a message to the history for a thread.
   * Trims to maxMessages (keeps newest) and refreshes TTL.
   */
  async append(threadId: string, message: Message): Promise<void> {
    const key = `${KEY_PREFIX}${threadId}`;

    // Serialize with raw nulled out to save storage
    const serialized = message.toJSON();
    serialized.raw = null;

    await this.state.appendToList(key, serialized, {
      maxLength: this.maxMessages,
      ttlMs: this.ttlMs,
    });
  }

  /**
   * Get messages for a thread in chronological order (oldest first).
   *
   * @param threadId - The thread ID
   * @param limit - Optional limit on number of messages to return (returns newest N)
   */
  async getMessages(threadId: string, limit?: number): Promise<Message[]> {
    const key = `${KEY_PREFIX}${threadId}`;
    const stored = await this.state.getList<SerializedMessage>(key);

    const sliced =
      limit && stored.length > limit
        ? stored.slice(stored.length - limit)
        : stored;

    return sliced.map((s) => Message.fromJSON(s));
  }
}
