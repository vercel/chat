import { Message } from "chat";
import { describe, expect, it } from "vitest";
import { messageTimestamp, SignalMessageCache } from "./cache";
import type { SignalRawMessage } from "./types";

function createTestMessage(
  id: string,
  text: string,
  threadId: string,
  dateSent = new Date()
): Message<SignalRawMessage> {
  return new Message<SignalRawMessage>({
    id,
    text,
    threadId,
    formatted: { type: "root", children: [] },
    raw: {
      kind: "outgoing" as const,
      author: "+10000000000",
      recipient: "+15551234567",
      text,
      timestamp: Date.now(),
    },
    author: {
      userId: "signal:+10000000000",
      userName: "bot",
      fullName: "bot",
      isBot: true,
      isMe: true,
    },
    metadata: {
      dateSent,
      edited: false,
    },
    attachments: [],
    isMention: false,
  });
}

describe("messageTimestamp", () => {
  it("extracts timestamp from author|timestamp format", () => {
    expect(messageTimestamp("+15551234567|1735689600000")).toBe(1735689600000);
  });

  it("parses plain numeric message IDs", () => {
    expect(messageTimestamp("1735689600000")).toBe(1735689600000);
  });

  it("returns 0 for non-numeric message IDs", () => {
    expect(messageTimestamp("not-a-number")).toBe(0);
  });

  it("handles UUID author in message ID", () => {
    expect(messageTimestamp("d77d6cbf-4a80-4f7e-a8ad-c53fdbf36f4d|42")).toBe(
      42
    );
  });
});

describe("SignalMessageCache", () => {
  const THREAD = "signal:+15551234567";

  describe("cache", () => {
    it("stores and retrieves messages", () => {
      const cache = new SignalMessageCache();
      const msg = createTestMessage("+1|100", "hello", THREAD);
      cache.cache(msg);

      expect(cache.findById(THREAD, "+1|100")).toBe(msg);
    });

    it("updates existing messages with the same ID", () => {
      const cache = new SignalMessageCache();
      const msg1 = createTestMessage("+1|100", "hello", THREAD);
      const msg2 = createTestMessage("+1|100", "updated", THREAD);

      cache.cache(msg1);
      cache.cache(msg2);

      const result = cache.findById(THREAD, "+1|100");
      expect(result?.text).toBe("updated");
      expect(cache.getThread(THREAD)).toHaveLength(1);
    });

    it("sorts messages by timestamp", () => {
      const cache = new SignalMessageCache();
      cache.cache(createTestMessage("+1|300", "third", THREAD, new Date(3000)));
      cache.cache(createTestMessage("+1|100", "first", THREAD, new Date(1000)));
      cache.cache(
        createTestMessage("+1|200", "second", THREAD, new Date(2000))
      );

      const thread = cache.getThread(THREAD);
      expect(thread.map((m) => m.text)).toEqual(["first", "second", "third"]);
    });
  });

  describe("findByTimestamp", () => {
    it("finds message by timestamp", () => {
      const cache = new SignalMessageCache();
      const msg = createTestMessage("+1|42", "hello", THREAD);
      cache.cache(msg);

      expect(cache.findByTimestamp(THREAD, 42)).toBe(msg);
    });

    it("returns undefined for non-existent timestamp", () => {
      const cache = new SignalMessageCache();
      expect(cache.findByTimestamp(THREAD, 42)).toBeUndefined();
    });
  });

  describe("findByTimestampAcrossThreads", () => {
    it("finds messages across different threads", () => {
      const cache = new SignalMessageCache();
      const thread2 = "signal:+15559876543";
      const msg = createTestMessage("+1|42", "hello", thread2);
      cache.cache(msg);

      expect(cache.findByTimestampAcrossThreads(42)).toBe(msg);
    });

    it("returns undefined when no match exists", () => {
      const cache = new SignalMessageCache();
      expect(cache.findByTimestampAcrossThreads(99999)).toBeUndefined();
    });
  });

  describe("deleteById", () => {
    it("removes a message by ID", () => {
      const cache = new SignalMessageCache();
      cache.cache(createTestMessage("+1|100", "hello", THREAD));
      cache.cache(createTestMessage("+1|200", "world", THREAD));

      cache.deleteById("+1|100");

      expect(cache.findById(THREAD, "+1|100")).toBeUndefined();
      expect(cache.findById(THREAD, "+1|200")).toBeDefined();
    });

    it("removes thread entry when last message is deleted", () => {
      const cache = new SignalMessageCache();
      cache.cache(createTestMessage("+1|100", "hello", THREAD));

      cache.deleteById("+1|100");

      expect(cache.getThread(THREAD)).toEqual([]);
    });
  });

  describe("deleteByTimestamp", () => {
    it("removes messages matching a timestamp", () => {
      const cache = new SignalMessageCache();
      cache.cache(createTestMessage("+1|100", "hello", THREAD, new Date(1000)));
      cache.cache(createTestMessage("+1|200", "world", THREAD, new Date(2000)));

      cache.deleteByTimestamp(THREAD, 100);

      expect(cache.findByTimestamp(THREAD, 100)).toBeUndefined();
      expect(cache.findByTimestamp(THREAD, 200)).toBeDefined();
    });

    it("does nothing for non-existent thread", () => {
      const cache = new SignalMessageCache();
      cache.deleteByTimestamp("signal:nonexistent", 100);
    });
  });

  describe("paginate", () => {
    function buildSortedMessages(count: number): Message<SignalRawMessage>[] {
      return Array.from({ length: count }, (_, i) =>
        createTestMessage(
          `+1|${i + 1}`,
          `m${i + 1}`,
          THREAD,
          new Date((i + 1) * 1000)
        )
      );
    }

    it("returns empty result for empty messages", () => {
      const cache = new SignalMessageCache();
      const result = cache.paginate([], {});
      expect(result.messages).toEqual([]);
    });

    it("paginates backward from end", () => {
      const cache = new SignalMessageCache();
      const messages = buildSortedMessages(5);

      const result = cache.paginate(messages, {
        limit: 2,
        direction: "backward",
      });
      expect(result.messages.map((m) => m.text)).toEqual(["m4", "m5"]);
      expect(result.nextCursor).toBe("+1|4");
    });

    it("paginates forward from start", () => {
      const cache = new SignalMessageCache();
      const messages = buildSortedMessages(5);

      const result = cache.paginate(messages, {
        limit: 2,
        direction: "forward",
      });
      expect(result.messages.map((m) => m.text)).toEqual(["m1", "m2"]);
      expect(result.nextCursor).toBe("+1|2");
    });

    it("uses cursor for backward pagination", () => {
      const cache = new SignalMessageCache();
      const messages = buildSortedMessages(5);

      const result = cache.paginate(messages, {
        limit: 2,
        direction: "backward",
        cursor: "+1|4",
      });
      expect(result.messages.map((m) => m.text)).toEqual(["m2", "m3"]);
    });

    it("uses cursor for forward pagination", () => {
      const cache = new SignalMessageCache();
      const messages = buildSortedMessages(5);

      const result = cache.paginate(messages, {
        limit: 2,
        direction: "forward",
        cursor: "+1|2",
      });
      expect(result.messages.map((m) => m.text)).toEqual(["m3", "m4"]);
    });

    it("clamps limit between 1 and 100", () => {
      const cache = new SignalMessageCache();
      const messages = buildSortedMessages(3);

      const result = cache.paginate(messages, { limit: 0 });
      expect(result.messages).toHaveLength(1);

      const result2 = cache.paginate(messages, { limit: 200 });
      expect(result2.messages).toHaveLength(3);
    });

    it("returns no nextCursor when all messages fit", () => {
      const cache = new SignalMessageCache();
      const messages = buildSortedMessages(2);

      const result = cache.paginate(messages, {
        limit: 10,
        direction: "forward",
      });
      expect(result.nextCursor).toBeUndefined();
    });
  });
});
