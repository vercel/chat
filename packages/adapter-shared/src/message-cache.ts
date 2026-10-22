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
 * Insert or replace `message` in `messages` by ID, then sort with `compare`.
 * Mutates and returns `messages`.
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
  if (index >= 0) {
    messages[index] = message;
  } else {
    messages.push(message);
  }
  messages.sort(compare);
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

  const indexes = new Map(
    messages.map((message, index) => [message.id, index])
  );

  if (direction === "backward") {
    const end =
      options.cursor && indexes.has(options.cursor)
        ? (indexes.get(options.cursor) ?? messages.length)
        : messages.length;
    const start = Math.max(0, end - limit);
    const page = messages.slice(start, end);
    return {
      messages: page,
      nextCursor: start > 0 ? page[0]?.id : undefined,
    };
  }

  const start =
    options.cursor && indexes.has(options.cursor)
      ? (indexes.get(options.cursor) ?? -1) + 1
      : 0;
  const end = Math.min(messages.length, start + limit);
  const page = messages.slice(start, end);
  return {
    messages: page,
    nextCursor: end < messages.length ? page.at(-1)?.id : undefined,
  };
}
