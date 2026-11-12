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

type Compare = (a: Message<unknown>, b: Message<unknown>) => number;

function snapshot(messages: Message<unknown>[]): string[] {
  return messages.map(
    (item) => `${item.id}@${item.metadata.dateSent.getTime()}/${item.text}`
  );
}

/** Replace or append by ID, then run a stable sort over the whole array. */
function referenceUpsert(
  messages: Message<unknown>[],
  item: Message<unknown>,
  compare: Compare = compareMessagesByTime
): Message<unknown>[] {
  const index = messages.findIndex((existing) => existing.id === item.id);
  if (index >= 0) {
    messages[index] = item;
  } else {
    messages.push(item);
  }
  return messages.sort(compare);
}

function createRandom(seed: number): (bound: number) => number {
  let state = seed;
  return (bound) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) % 4_294_967_296;
    if (state < 0) {
      state += 4_294_967_296;
    }
    return Math.floor((state / 4_294_967_296) * bound);
  };
}

const reversed: Compare = (a, b) => compareMessagesByTime(b, a);
const byText: Compare = (a, b) => a.text.localeCompare(b.text);

describe("messageSequence", () => {
  it("reads a trailing sequence number", () => {
    expect(messageSequence("mid.abc:12")).toBe(12);
  });

  it("returns 0 without one", () => {
    expect(messageSequence("mid.abc")).toBe(0);
  });

  it("reads only the last segment", () => {
    expect(messageSequence("mid:7:22")).toBe(22);
    expect(messageSequence("mid:12.abc")).toBe(0);
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

  it("mutates and returns the same array", () => {
    const messages: Message<unknown>[] = [];
    expect(upsertMessage(messages, message("a", 1000))).toBe(messages);
    expect(upsertMessage(messages, message("b", 500))).toBe(messages);
    expect(upsertMessage(messages, message("a", 100, "new"))).toBe(messages);
    expect(snapshot(messages)).toEqual(["a@100/new", "b@500/b"]);
  });

  describe("matches replace-or-append followed by a stable sort", () => {
    const tied = () => [
      message("a", 1000),
      message("b", 2000),
      message("c", 2000),
      message("d", 2000),
      message("e", 3000),
    ];

    it.each<[string, Message<unknown>[], Message<unknown>, Compare, string[]]>([
      [
        "insert into an empty array",
        [],
        message("x", 1000),
        compareMessagesByTime,
        ["x"],
      ],
      [
        "insert after messages it ties with",
        tied(),
        message("x", 2000),
        compareMessagesByTime,
        ["a", "b", "c", "d", "x", "e"],
      ],
      [
        "insert an older message that arrives late",
        tied(),
        message("x", 500),
        compareMessagesByTime,
        ["x", "a", "b", "c", "d", "e"],
      ],
      [
        "insert the newest message",
        tied(),
        message("x", 4000),
        compareMessagesByTime,
        ["a", "b", "c", "d", "e", "x"],
      ],
      [
        "replace without moving inside a tie",
        tied(),
        message("c", 2000, "new"),
        compareMessagesByTime,
        ["a", "b", "c", "d", "e"],
      ],
      [
        "replace with a later timestamp",
        tied(),
        message("a", 2500),
        compareMessagesByTime,
        ["b", "c", "d", "a", "e"],
      ],
      [
        "replace with an earlier timestamp",
        tied(),
        message("e", 500),
        compareMessagesByTime,
        ["e", "a", "b", "c", "d"],
      ],
      [
        "replace moving forward into a tie",
        tied(),
        message("a", 2000),
        compareMessagesByTime,
        ["a", "b", "c", "d", "e"],
      ],
      [
        "replace moving backward into a tie",
        tied(),
        message("e", 2000),
        compareMessagesByTime,
        ["a", "b", "c", "d", "e"],
      ],
      [
        "replace moving out of a tie",
        tied(),
        message("c", 5000),
        compareMessagesByTime,
        ["a", "b", "d", "e", "c"],
      ],
      [
        "replace moving forward past a message into a tie",
        [message("p", 1000), message("q", 1500), ...tied().slice(1)],
        message("p", 2000),
        compareMessagesByTime,
        ["q", "p", "b", "c", "d", "e"],
      ],
      [
        "replace moving backward past a message into a tie",
        [...tied().slice(0, 4), message("q", 2500), message("p", 3000)],
        message("p", 2000),
        compareMessagesByTime,
        ["a", "b", "c", "d", "p", "q"],
      ],
      [
        "insert with a reversed comparator",
        tied().reverse(),
        message("x", 2000),
        reversed,
        ["e", "d", "c", "b", "x", "a"],
      ],
      [
        "replace with a reversed comparator",
        tied().reverse(),
        message("a", 2500),
        reversed,
        ["e", "a", "d", "c", "b"],
      ],
    ])("%s", (_label, initial, item, compare, expected) => {
      const reference = referenceUpsert([...initial], item, compare);
      const actual = upsertMessage([...initial], item, compare);
      expect(ids(reference)).toEqual(expected);
      expect(snapshot(actual)).toEqual(snapshot(reference));
    });

    it.each<[string, Compare | undefined]>([
      ["the default comparator", undefined],
      ["a reversed comparator", reversed],
      ["a comparator on another field", byText],
    ])(
      "over a seeded sequence of upserts with %s",
      (_label, compare) => {
        const random = createRandom(20_240_611);
        const actual: Message<unknown>[] = [];
        const reference: Message<unknown>[] = [];
        let replacements = 0;
        let ties = 0;

        for (let step = 0; step < 1500; step++) {
          const id = `m${random(90)}:${random(2)}`;
          const item = message(id, 1000 * random(6), `t${random(4)}`);
          if (reference.some((existing) => existing.id === id)) {
            replacements++;
          }
          if (
            reference.some(
              (existing) =>
                existing.id !== id &&
                (compare ?? compareMessagesByTime)(existing, item) === 0
            )
          ) {
            ties++;
          }
          referenceUpsert(reference, item, compare);
          upsertMessage(actual, item, compare);
          const expected = snapshot(reference).join("\n");
          if (snapshot(actual).join("\n") !== expected) {
            expect(snapshot(actual)).toEqual(snapshot(reference));
          }
        }

        expect(snapshot(actual)).toEqual(snapshot(reference));
        expect(reference.length).toBeGreaterThan(64);
        expect(replacements).toBeGreaterThan(500);
        expect(ties).toBeGreaterThan(500);
      },
      30_000
    );
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

  it("ignores an unknown cursor on a forward page", () => {
    const page = paginateMessages(messages, {
      limit: 2,
      direction: "forward",
      cursor: "missing",
    });
    expect(ids(page.messages)).toEqual(["m1", "m2"]);
    expect(page.nextCursor).toBe("m2");
  });

  it("returns an empty backward page when the cursor is the first message", () => {
    expect(paginateMessages(messages, { limit: 2, cursor: "m1" })).toEqual({
      messages: [],
      nextCursor: undefined,
    });
  });

  it("returns an empty forward page when the cursor is the last message", () => {
    expect(
      paginateMessages(messages, {
        limit: 2,
        direction: "forward",
        cursor: "m5",
      })
    ).toEqual({ messages: [], nextCursor: undefined });
  });

  it("defaults the limit to 50 and clamps it to 1..100", () => {
    const many = Array.from({ length: 150 }, (_, index) =>
      message(`n${index}`, index * 1000)
    );
    expect(paginateMessages(many, {}).messages).toHaveLength(50);
    expect(paginateMessages(many, { limit: 0 }).messages).toHaveLength(1);
    expect(paginateMessages(many, { limit: -3 }).messages).toHaveLength(1);
    expect(paginateMessages(many, { limit: 500 }).messages).toHaveLength(100);
  });
});
