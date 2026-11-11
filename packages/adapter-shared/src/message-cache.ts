/**
 * In-memory message history for adapters whose platform API cannot list past
 * messages (for example Messenger and Instagram). Messages are kept per thread,
 * sorted by send time, and paged with message-ID cursors.
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
