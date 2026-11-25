/**
 * In-memory message history for adapters whose platform API cannot list past
 * messages (for example Telegram, Messenger, and Instagram). Messages are kept
 * per thread, sorted by send time, and paged with message-ID cursors.
 * {@link MessageStore} bounds that history by message count per thread and by
 * an estimate of retained memory across all threads.
 */

import type { FetchOptions, FetchResult, Message } from "chat";

const MESSAGE_SEQUENCE_PATTERN = /:(\d+)$/;

/**
 * Read the trailing `:{n}` sequence number from a message ID, or 0 when the ID
 * has none.
 */
export function messageSequence(messageId: string): number {
  const match = messageId.match(MESSAGE_SEQUENCE_PATTERN);
  return match ? Number.parseInt(match[1], 10) : 0;
}

/**
 * Order messages by send time, breaking ties with `sequence` (defaults to
 * {@link messageSequence}).
 */
export function compareMessagesByTime<TRaw>(
  a: Message<TRaw>,
  b: Message<TRaw>,
  sequence: (messageId: string) => number = messageSequence
): number {
  const timeDifference =
    a.metadata.dateSent.getTime() - b.metadata.dateSent.getTime();
  if (timeDifference !== 0) {
    return timeDifference;
  }
  return sequence(a.id) - sequence(b.id);
}

/**
 * Index of the first of `messages` that sorts after `message`, or after or
 * equal to it when `inclusive` is set. `messages` must be sorted by `compare`.
 */
function sortedIndex<TRaw>(
  messages: Message<TRaw>[],
  message: Message<TRaw>,
  compare: (a: Message<TRaw>, b: Message<TRaw>) => number,
  inclusive: boolean
): number {
  let low = 0;
  let high = messages.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const order = compare(messages[middle], message);
    if (order > 0 || (inclusive && order === 0)) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}

/**
 * Insert or replace `message` in `messages` by ID, keeping the array sorted by
 * `compare`. Mutates and returns `messages`.
 *
 * `messages` must already be sorted by `compare`, which holds for an array
 * that starts empty and only changes through this function with the same
 * comparator. The result matches replacing or appending the message and then
 * running a stable sort: a new message lands after the messages it ties with,
 * and a replaced message keeps its place among them.
 */
export function upsertMessage<TRaw>(
  messages: Message<TRaw>[],
  message: Message<TRaw>,
  compare: (
    a: Message<TRaw>,
    b: Message<TRaw>
  ) => number = compareMessagesByTime
): Message<TRaw>[] {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index < 0) {
    messages.splice(sortedIndex(messages, message, compare, false), 0, message);
    return messages;
  }

  const fitsAfterPrevious =
    index === 0 || compare(messages[index - 1], message) <= 0;
  const fitsBeforeNext =
    index === messages.length - 1 || compare(message, messages[index + 1]) <= 0;
  if (fitsAfterPrevious && fitsBeforeNext) {
    messages[index] = message;
    return messages;
  }

  messages.splice(index, 1);
  const first = sortedIndex(messages, message, compare, true);
  const last = sortedIndex(messages, message, compare, false);
  messages.splice(Math.min(Math.max(index, first), last), 0, message);
  return messages;
}

/**
 * Page through messages sorted oldest first. The cursor is a message ID:
 * backward pages end before it, forward pages start after it. `limit` defaults
 * to 50 and is clamped to 1..100.
 */
export function paginateMessages<TRaw>(
  messages: Message<TRaw>[],
  options: FetchOptions
): FetchResult<TRaw> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
  const direction = options.direction ?? "backward";
  if (messages.length === 0) {
    return { messages: [] };
  }

  const cursorIndex = options.cursor
    ? messages.findIndex((message) => message.id === options.cursor)
    : -1;

  if (direction === "backward") {
    const end = cursorIndex >= 0 ? cursorIndex : messages.length;
    const start = Math.max(0, end - limit);
    const page = messages.slice(start, end);
    return {
      messages: page,
      nextCursor: start > 0 ? page[0]?.id : undefined,
    };
  }

  const start = cursorIndex + 1;
  const end = Math.min(messages.length, start + limit);
  const page = messages.slice(start, end);
  return {
    messages: page,
    nextCursor: end < messages.length ? page.at(-1)?.id : undefined,
  };
}

/** Default cap on messages kept per thread, matching core `ThreadHistory`. */
export const DEFAULT_MAX_MESSAGES_PER_THREAD = 100;

/** Default budget for {@link MessageStore.weight}, in approximate bytes. */
export const DEFAULT_MAX_MESSAGE_STORE_WEIGHT = 64 * 1024 * 1024;

/**
 * Approximate heap bytes retained per mdast node, including its `position`
 * object and `children` array. Measured on Node.js at 240 to 415 bytes per
 * node across emphasis-heavy, list, and link-heavy markdown.
 */
export const MESSAGE_WEIGHT_BYTES_PER_NODE = 400;

/** Approximate heap bytes per string character (two-byte strings). */
export const MESSAGE_WEIGHT_BYTES_PER_CHAR = 2;

/** Fixed bytes charged per message for the object, author, and metadata. */
export const MESSAGE_WEIGHT_BASE_BYTES = 1024;

function formattedWeight(root: unknown): number {
  let weight = 0;
  const pending: unknown[] = [root];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const node = pending.pop();
    if (typeof node !== "object" || node === null || seen.has(node)) {
      continue;
    }
    seen.add(node);
    weight += MESSAGE_WEIGHT_BYTES_PER_NODE;
    const { value, url, children } = node as {
      children?: unknown;
      url?: unknown;
      value?: unknown;
    };
    if (typeof value === "string") {
      weight += value.length * MESSAGE_WEIGHT_BYTES_PER_CHAR;
    }
    if (typeof url === "string") {
      weight += url.length * MESSAGE_WEIGHT_BYTES_PER_CHAR;
    }
    if (Array.isArray(children)) {
      for (const child of children) {
        pending.push(child);
      }
    }
  }
  return weight;
}

/**
 * Estimate the heap bytes a message retains: a fixed base, its `text`, and
 * every node and string in its `formatted` tree, plus the same for each
 * message along its `replyTo` chain. `raw` and attachments are not measured.
 *
 * The estimate is meant to rank and bound messages, not to match the heap
 * exactly. It errs high: within about 2x of measured usage for formatted
 * messages, and about 3x for plain ASCII prose, where it stays small anyway.
 */
export function estimateMessageWeight<TRaw>(message: Message<TRaw>): number {
  let weight = 0;
  const seen = new Set<Message<TRaw>>();
  let current: Message<TRaw> | undefined = message;
  while (current && !seen.has(current)) {
    seen.add(current);
    weight +=
      MESSAGE_WEIGHT_BASE_BYTES +
      (typeof current.text === "string"
        ? current.text.length * MESSAGE_WEIGHT_BYTES_PER_CHAR
        : 0) +
      formattedWeight(current.formatted);
    current = current.replyTo;
  }
  return weight;
}

/** Options for {@link MessageStore}. */
export interface MessageStoreOptions<TRaw = unknown> {
  /** Sort order within a thread. Defaults to {@link compareMessagesByTime}. */
  compare?: (a: Message<TRaw>, b: Message<TRaw>) => number;
  /**
   * Most messages kept per thread. Defaults to
   * {@link DEFAULT_MAX_MESSAGES_PER_THREAD}.
   */
  maxMessagesPerThread?: number;
  /**
   * Budget for the summed {@link estimateMessageWeight} of all stored
   * messages, in approximate bytes. Defaults to
   * {@link DEFAULT_MAX_MESSAGE_STORE_WEIGHT}.
   */
  maxWeight?: number;
}

interface StoredThread<TRaw> {
  messages: Message<TRaw>[];
  weight: number;
}

interface StoredEntry<TRaw> {
  message: Message<TRaw>;
  weight: number;
}

/**
 * Bounded in-memory message history, keyed by `message.threadId`.
 *
 * Two limits apply on every {@link MessageStore.upsert}. A thread keeps at
 * most `maxMessagesPerThread` messages and drops its oldest beyond that. When
 * the total {@link MessageStore.weight} passes `maxWeight`, the store drops
 * the oldest message of whichever thread weighs the most, and repeats until
 * it fits, so one busy thread gives up its own history before it costs quiet
 * threads theirs.
 */
export class MessageStore<TRaw = unknown> {
  private readonly compare: (a: Message<TRaw>, b: Message<TRaw>) => number;
  private readonly maxMessagesPerThread: number;
  private readonly maxWeight: number;
  private readonly threadsById = new Map<string, StoredThread<TRaw>>();
  /** Message ID, then thread ID, in insertion order. */
  private readonly entriesById = new Map<
    string,
    Map<string, StoredEntry<TRaw>>
  >();
  private totalWeight = 0;
  private totalMessages = 0;

  constructor(options: MessageStoreOptions<TRaw> = {}) {
    const maxMessagesPerThread =
      options.maxMessagesPerThread ?? DEFAULT_MAX_MESSAGES_PER_THREAD;
    const maxWeight = options.maxWeight ?? DEFAULT_MAX_MESSAGE_STORE_WEIGHT;
    if (!(Number.isInteger(maxMessagesPerThread) && maxMessagesPerThread > 0)) {
      throw new Error(
        `MessageStore maxMessagesPerThread must be a positive integer, received ${maxMessagesPerThread}`
      );
    }
    if (!(maxWeight > 0)) {
      throw new Error(
        `MessageStore maxWeight must be a positive number, received ${maxWeight}`
      );
    }
    this.compare = options.compare ?? compareMessagesByTime;
    this.maxMessagesPerThread = maxMessagesPerThread;
    this.maxWeight = maxWeight;
  }

  /** Summed weight estimate of every stored message, in approximate bytes. */
  get weight(): number {
    return this.totalWeight;
  }

  /** Number of stored messages across all threads. */
  get size(): number {
    return this.totalMessages;
  }

  /** Number of threads holding at least one message. */
  get threadCount(): number {
    return this.threadsById.size;
  }

  /**
   * Insert `message` into its thread, or replace the message with the same ID
   * there, then apply both limits.
   *
   * A message that alone weighs more than `maxWeight` is not stored and
   * evicts nothing. If it would have replaced a stored message, that message
   * is removed, since it no longer matches the latest version.
   *
   * The message is also not kept when it sorts before everything in a thread
   * that is already full. The weight budget otherwise never drops the message
   * being upserted.
   */
  upsert(message: Message<TRaw>): void {
    const threadId = message.threadId;
    const weight = estimateMessageWeight(message);
    let thread = this.threadsById.get(threadId);
    const replaced = this.entriesById.get(message.id)?.get(threadId);

    if (weight > this.maxWeight) {
      if (thread && replaced) {
        this.removeAt(
          threadId,
          thread,
          thread.messages.indexOf(replaced.message)
        );
      }
      return;
    }

    if (!thread) {
      thread = { messages: [], weight: 0 };
      this.threadsById.set(threadId, thread);
    }
    if (replaced) {
      thread.weight -= replaced.weight;
      this.totalWeight -= replaced.weight;
      this.totalMessages--;
    }

    upsertMessage(thread.messages, message, this.compare);
    thread.weight += weight;
    this.totalWeight += weight;
    this.totalMessages++;

    let threadIds = this.entriesById.get(message.id);
    if (!threadIds) {
      threadIds = new Map();
      this.entriesById.set(message.id, threadIds);
    }
    threadIds.set(threadId, { message, weight });

    while (thread.messages.length > this.maxMessagesPerThread) {
      this.removeAt(threadId, thread, 0);
    }
    if (this.totalWeight > this.maxWeight) {
      this.evictToBudget(message);
    }
  }

  /**
   * The stored message with this ID. When several threads hold the ID, the
   * thread that stored it first wins.
   */
  find(messageId: string): Message<TRaw> | undefined {
    const threadIds = this.entriesById.get(messageId);
    if (!threadIds) {
      return undefined;
    }
    for (const entry of threadIds.values()) {
      return entry.message;
    }
    return undefined;
  }

  /**
   * Remove the message with this ID from every thread that holds it. Returns
   * whether anything was removed.
   */
  delete(messageId: string): boolean {
    const threadIds = this.entriesById.get(messageId);
    if (!threadIds) {
      return false;
    }
    for (const [threadId, entry] of [...threadIds]) {
      const thread = this.threadsById.get(threadId);
      if (!thread) {
        continue;
      }
      const index = thread.messages.indexOf(entry.message);
      if (index >= 0) {
        this.removeAt(threadId, thread, index);
      }
    }
    return true;
  }

  /** A copy of the thread's messages, sorted oldest first. */
  messages(threadId: string): Message<TRaw>[] {
    return [...(this.threadsById.get(threadId)?.messages ?? [])];
  }

  /** The newest message in the thread. */
  latest(threadId: string): Message<TRaw> | undefined {
    return this.threadsById.get(threadId)?.messages.at(-1);
  }

  /** IDs of the threads holding at least one message. */
  threadIds(): IterableIterator<string> {
    return this.threadsById.keys();
  }

  /**
   * Every thread as `[threadId, messages]`, with messages copied and sorted
   * oldest first.
   */
  *threads(): IterableIterator<[string, Message<TRaw>[]]> {
    for (const [threadId, thread] of this.threadsById) {
      yield [threadId, [...thread.messages]];
    }
  }

  /** Remove every message. */
  clear(): void {
    this.threadsById.clear();
    this.entriesById.clear();
    this.totalWeight = 0;
    this.totalMessages = 0;
  }

  private removeAt(
    threadId: string,
    thread: StoredThread<TRaw>,
    index: number
  ): void {
    const [removed] = thread.messages.splice(index, 1);
    const threadIds = this.entriesById.get(removed.id);
    const entry = threadIds?.get(threadId);
    if (threadIds && entry) {
      thread.weight -= entry.weight;
      this.totalWeight -= entry.weight;
      this.totalMessages--;
      threadIds.delete(threadId);
      if (threadIds.size === 0) {
        this.entriesById.delete(removed.id);
      }
    }
    if (thread.messages.length === 0) {
      this.threadsById.delete(threadId);
    }
  }

  /**
   * Drop the oldest message of the heaviest thread until the store fits its
   * budget, sparing `keep`. Each pass removes one message. `keep` fits the
   * budget on its own, so the loop ends before it is the only message left.
   */
  private evictToBudget(keep: Message<TRaw>): void {
    while (this.totalWeight > this.maxWeight) {
      let heaviestId: string | undefined;
      let heaviest: StoredThread<TRaw> | undefined;
      for (const [threadId, thread] of this.threadsById) {
        const spared =
          thread.messages.length === 1 && thread.messages[0] === keep;
        if (!spared && (!heaviest || thread.weight > heaviest.weight)) {
          heaviestId = threadId;
          heaviest = thread;
        }
      }
      if (heaviestId === undefined || !heaviest) {
        return;
      }
      this.removeAt(
        heaviestId,
        heaviest,
        heaviest.messages[0] === keep ? 1 : 0
      );
    }
  }
}
