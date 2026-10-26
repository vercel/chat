import type { Message } from "chat";
import { describe, expect, it } from "vitest";
import {
  compareMessagesByTime,
  messageSequence,
  paginateMessages,
  upsertMessage,
} from "./message-cache";

function message(id: string, time: number, text = id): Message<unknown> {
  return {
    id,
    text,
    metadata: { dateSent: new Date(time) },
  } as unknown as Message<unknown>;
}

function ids(messages: Message<unknown>[]): string[] {
  return messages.map((item) => item.id);
}

describe("messageSequence", () => {
  it("reads a trailing sequence number", () => {
    expect(messageSequence("mid.abc:12")).toBe(12);
  });

  it("returns 0 without one", () => {
    expect(messageSequence("mid.abc")).toBe(0);
  });
});

describe("compareMessagesByTime", () => {
  it("orders by send time, then by sequence", () => {
    const messages = [
      message("b:2", 2000),
      message("a:3", 1000),
      message("a:1", 1000),
    ];
    expect(ids(messages.sort(compareMessagesByTime))).toEqual([
      "a:1",
      "a:3",
      "b:2",
    ]);
  });

  it("breaks ties with a custom sequence function", () => {
    const messages = [message("a:1", 1000), message("a:3", 1000)];
    expect(
      ids(
        messages.sort((x, y) =>
          compareMessagesByTime(x, y, (id) => -messageSequence(id))
        )
      )
    ).toEqual(["a:3", "a:1"]);
  });
});

describe("upsertMessage", () => {
  it("inserts in sorted order", () => {
    const messages = [message("a", 1000), message("c", 3000)];
    upsertMessage(messages, message("b", 2000));
    expect(ids(messages)).toEqual(["a", "b", "c"]);
  });

  it("replaces a message with the same ID", () => {
    const messages = [message("a", 1000, "old")];
    upsertMessage(messages, message("a", 1000, "new"));
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe("new");
  });

  it("uses a custom comparator", () => {
    const messages = [message("a", 1000)];
    upsertMessage(messages, message("b", 2000), (x, y) =>
      compareMessagesByTime(y, x)
    );
    expect(ids(messages)).toEqual(["b", "a"]);
  });
});

describe("paginateMessages", () => {
  const messages = ["m1", "m2", "m3", "m4", "m5"].map((id, index) =>
    message(id, index * 1000)
  );

  it("returns an empty page for no messages", () => {
    expect(paginateMessages([], {})).toEqual({ messages: [] });
  });

  it("pages backward from the newest message by default", () => {
    const page = paginateMessages(messages, { limit: 2 });
    expect(ids(page.messages)).toEqual(["m4", "m5"]);
    expect(page.nextCursor).toBe("m4");

    const next = paginateMessages(messages, {
      limit: 2,
      cursor: page.nextCursor,
    });
    expect(ids(next.messages)).toEqual(["m2", "m3"]);
    expect(next.nextCursor).toBe("m2");
  });

  it("omits the cursor on the last backward page", () => {
    const page = paginateMessages(messages, { limit: 2, cursor: "m3" });
    expect(ids(page.messages)).toEqual(["m1", "m2"]);
    expect(page.nextCursor).toBeUndefined();
  });

  it("pages forward from the oldest message", () => {
    const page = paginateMessages(messages, { limit: 2, direction: "forward" });
    expect(ids(page.messages)).toEqual(["m1", "m2"]);
    expect(page.nextCursor).toBe("m2");

    const last = paginateMessages(messages, {
      limit: 3,
      direction: "forward",
      cursor: "m2",
    });
    expect(ids(last.messages)).toEqual(["m3", "m4", "m5"]);
    expect(last.nextCursor).toBeUndefined();
  });

  it("ignores an unknown cursor", () => {
    const page = paginateMessages(messages, { limit: 1, cursor: "missing" });
    expect(ids(page.messages)).toEqual(["m5"]);
  });

  it("clamps the limit to 1..100", () => {
    expect(paginateMessages(messages, { limit: 0 }).messages).toHaveLength(1);
    expect(paginateMessages(messages, { limit: 500 }).messages).toHaveLength(5);
  });
});
