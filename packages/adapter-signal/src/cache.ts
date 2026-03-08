import type { FetchOptions, FetchResult, Message } from "chat";
import type { SignalRawMessage } from "./types";

const MESSAGE_ID_PATTERN = /^(.*)\|(\d+)$/;

export class SignalMessageCache {
  private readonly threads = new Map<string, Message<SignalRawMessage>[]>();

  cache(message: Message<SignalRawMessage>): void {
    const existing = this.threads.get(message.threadId) ?? [];
    const index = existing.findIndex((item) => item.id === message.id);

    if (index >= 0) {
      existing[index] = message;
    } else {
      existing.push(message);
    }

    existing.sort((a, b) => this.compareMessages(a, b));
    this.threads.set(message.threadId, existing);
  }

  findByTimestamp(
    threadId: string,
    timestamp: number
  ): Message<SignalRawMessage> | undefined {
    const messages = this.threads.get(threadId) ?? [];
    return messages.find(
      (message) => messageTimestamp(message.id) === timestamp
    );
  }

  findByTimestampAcrossThreads(
    timestamp: number
  ): Message<SignalRawMessage> | undefined {
    for (const messages of this.threads.values()) {
      const matched = messages.find(
        (message) => messageTimestamp(message.id) === timestamp
      );
      if (matched) {
        return matched;
      }
    }

    return undefined;
  }

  findById(
    threadId: string,
    messageId: string
  ): Message<SignalRawMessage> | undefined {
    const messages = this.threads.get(threadId) ?? [];
    return messages.find((message) => message.id === messageId);
  }

  getThread(threadId: string): Message<SignalRawMessage>[] {
    return [...(this.threads.get(threadId) ?? [])].sort((a, b) =>
      this.compareMessages(a, b)
    );
  }

  deleteById(messageId: string): void {
    for (const [threadId, messages] of this.threads.entries()) {
      const filtered = messages.filter((message) => message.id !== messageId);
      if (filtered.length === 0) {
        this.threads.delete(threadId);
      } else if (filtered.length !== messages.length) {
        this.threads.set(threadId, filtered);
      }
    }
  }

  deleteByTimestamp(threadId: string, timestamp: number): void {
    const messages = this.threads.get(threadId);
    if (!messages) {
      return;
    }

    const filtered = messages.filter(
      (message) => messageTimestamp(message.id) !== timestamp
    );

    if (filtered.length === 0) {
      this.threads.delete(threadId);
      return;
    }

    if (filtered.length !== messages.length) {
      this.threads.set(threadId, filtered);
    }
  }

  paginate(
    messages: Message<SignalRawMessage>[],
    options: FetchOptions
  ): FetchResult<SignalRawMessage> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    const direction = options.direction ?? "backward";

    if (messages.length === 0) {
      return { messages: [] };
    }

    const indexById = new Map(
      messages.map((message, index) => [message.id, index])
    );

    if (direction === "backward") {
      const end =
        options.cursor && indexById.has(options.cursor)
          ? (indexById.get(options.cursor) ?? messages.length)
          : messages.length;
      const start = Math.max(0, end - limit);
      const page = messages.slice(start, end);

      return {
        messages: page,
        nextCursor: start > 0 ? page[0]?.id : undefined,
      };
    }

    const start =
      options.cursor && indexById.has(options.cursor)
        ? (indexById.get(options.cursor) ?? -1) + 1
        : 0;

    const end = Math.min(messages.length, start + limit);
    const page = messages.slice(start, end);

    return {
      messages: page,
      nextCursor: end < messages.length ? page.at(-1)?.id : undefined,
    };
  }

  private compareMessages(
    a: Message<SignalRawMessage>,
    b: Message<SignalRawMessage>
  ): number {
    const timestampDifference =
      a.metadata.dateSent.getTime() - b.metadata.dateSent.getTime();
    if (timestampDifference !== 0) {
      return timestampDifference;
    }

    return messageTimestamp(a.id) - messageTimestamp(b.id);
  }
}

export function messageTimestamp(messageId: string): number {
  const matched = messageId.match(MESSAGE_ID_PATTERN);
  if (matched) {
    const timestamp = Number.parseInt(matched[2], 10);
    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
  }

  const fallback = Number.parseInt(messageId, 10);
  return Number.isFinite(fallback) ? fallback : 0;
}
