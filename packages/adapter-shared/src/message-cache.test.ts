import { Message, parseMarkdown } from "chat";
import { describe, expect, it } from "vitest";
import {
  compareMessagesByTime,
  DEFAULT_MAX_MESSAGE_STORE_WEIGHT,
  DEFAULT_MAX_MESSAGES_PER_THREAD,
  estimateMessageWeight,
  MESSAGE_WEIGHT_BASE_BYTES,
  MESSAGE_WEIGHT_BYTES_PER_CHAR,
  MESSAGE_WEIGHT_BYTES_PER_NODE,
  MessageStore,
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

interface RealMessageOptions {
  replyTo?: Message<unknown>;
  threadId?: string;
}

function realMessage(
  id: string,
  time: number,
  markdown: string,
  options: RealMessageOptions = {}
): Message<unknown> {
  return new Message<unknown>({
    id,
    threadId: options.threadId ?? "t:1",
    text: markdown,
    formatted: parseMarkdown(markdown),
    raw: {},
    author: {
      userId: "u1",
      userName: "user",
      fullName: "User",
      isBot: false,
      isMe: false,
    },
    metadata: { dateSent: new Date(time), edited: false },
    attachments: [],
    replyTo: options.replyTo,
  });
}

const DENSE = "**a** _b_ `c` ".repeat(40);
const LIGHT = "hello there";

/**
 * Recount the store from its own listing and return every mismatch: weight,
 * size, thread count, per-thread order, and whether each listed ID is found.
 */
function audit(
  store: MessageStore<unknown>,
  compare: Compare = compareMessagesByTime
): string[] {
  const problems: string[] = [];
  let weight = 0;
  let count = 0;
  let threadCount = 0;
  for (const [threadId, messages] of store.threads()) {
    threadCount++;
    const listed = ids(messages).join(",");
    if (messages.length === 0) {
      problems.push(`${threadId} is empty`);
    }
    if (ids(store.messages(threadId)).join(",") !== listed) {
      problems.push(`${threadId} lists differ`);
    }
    if (store.latest(threadId) !== messages.at(-1)) {
      problems.push(`${threadId} latest differs`);
    }
    if (ids([...messages].sort(compare)).join(",") !== listed) {
      problems.push(`${threadId} is not sorted`);
    }
    if (new Set(ids(messages)).size !== messages.length) {
      problems.push(`${threadId} repeats an ID`);
    }
    for (const item of messages) {
      if (item.threadId !== threadId) {
        problems.push(`${item.id} is in the wrong thread`);
      }
      if (store.find(item.id)?.id !== item.id) {
        problems.push(`${item.id} is not findable`);
      }
      weight += estimateMessageWeight(item);
      count++;
    }
  }
  if (store.weight !== weight) {
    problems.push(`weight ${store.weight}, recounted ${weight}`);
  }
  if (store.size !== count) {
    problems.push(`size ${store.size}, recounted ${count}`);
  }
  if (store.threadCount !== threadCount) {
    problems.push(`threadCount ${store.threadCount}, recounted ${threadCount}`);
  }
  if ([...store.threadIds()].length !== threadCount) {
    problems.push("threadIds differ from threads");
  }
  return problems;
}

describe("estimateMessageWeight", () => {
  it("charges the base, the text, and each node and string of the tree", () => {
    // root > paragraph > text("hi")
    expect(estimateMessageWeight(realMessage("a", 0, "hi"))).toBe(
      MESSAGE_WEIGHT_BASE_BYTES +
        3 * MESSAGE_WEIGHT_BYTES_PER_NODE +
        (2 + 2) * MESSAGE_WEIGHT_BYTES_PER_CHAR
    );
  });

  it("counts link URLs", () => {
    const short = estimateMessageWeight(
      realMessage("a", 0, "[x](https://a.io)")
    );
    const long = estimateMessageWeight(
      realMessage("a", 0, "[x](https://a.io/0123456789)")
    );
    // 11 more characters in both the text and the URL.
    expect(long - short).toBe(2 * 11 * MESSAGE_WEIGHT_BYTES_PER_CHAR);
  });

  it("weighs markup-dense text far above prose of the same length", () => {
    const dense = "**a** _b_ `c` ".repeat(290);
    const prose = "x".repeat(dense.length);
    const denseWeight = estimateMessageWeight(realMessage("a", 0, dense));
    const proseWeight = estimateMessageWeight(realMessage("b", 0, prose));
    expect(denseWeight).toBeGreaterThan(20 * proseWeight);
    expect(denseWeight).toBeGreaterThan(2000 * MESSAGE_WEIGHT_BYTES_PER_NODE);
  });

  it("adds the weight of the replyTo chain", () => {
    const grandparent = realMessage("g", 0, DENSE);
    const parent = realMessage("p", 1, LIGHT, { replyTo: grandparent });
    const plain = realMessage("c", 2, LIGHT);
    const reply = realMessage("c", 2, LIGHT, { replyTo: parent });
    expect(estimateMessageWeight(parent)).toBe(
      estimateMessageWeight(plain) + estimateMessageWeight(grandparent)
    );
    expect(estimateMessageWeight(reply)).toBe(
      2 * estimateMessageWeight(plain) + estimateMessageWeight(grandparent)
    );
  });

  it("stops on a replyTo cycle", () => {
    const first = realMessage("a", 0, LIGHT);
    const second = realMessage("b", 1, LIGHT);
    first.replyTo = second;
    let reads = 0;
    Object.defineProperty(second, "replyTo", {
      get() {
        reads++;
        if (reads > 10) {
          throw new Error("replyTo cycle was followed more than once");
        }
        return first;
      },
    });
    expect(estimateMessageWeight(first)).toBe(
      2 * estimateMessageWeight(realMessage("c", 0, LIGHT))
    );
  });

  it("counts each node once when the formatted tree contains a cycle", () => {
    const item = realMessage("a", 0, "x");
    const root: { type: string; children: unknown[] } = {
      type: "root",
      children: [],
    };
    const text = { type: "text", value: "hello" };
    let reads = 0;
    const paragraph = {
      type: "paragraph",
      get children() {
        reads++;
        if (reads > 10) {
          throw new Error("formatted cycle was walked more than once");
        }
        return [text, root, paragraph, text];
      },
    };
    root.children.push(paragraph);
    item.formatted = root as typeof item.formatted;

    expect(estimateMessageWeight(item)).toBe(
      MESSAGE_WEIGHT_BASE_BYTES +
        3 * MESSAGE_WEIGHT_BYTES_PER_NODE +
        (1 + 5) * MESSAGE_WEIGHT_BYTES_PER_CHAR
    );
  });

  it("walks a tree deeper than the call stack allows", () => {
    const item = realMessage("a", 0, "x");
    let node: { type: string; children: unknown[] } = {
      type: "blockquote",
      children: [],
    };
    const top = node;
    const depth = 200_000;
    for (let level = 1; level < depth; level++) {
      const child = { type: "blockquote", children: [] };
      node.children.push(child);
      node = child;
    }
    item.formatted = { type: "root", children: [top] } as typeof item.formatted;
    expect(estimateMessageWeight(item)).toBe(
      MESSAGE_WEIGHT_BASE_BYTES +
        MESSAGE_WEIGHT_BYTES_PER_CHAR +
        (depth + 1) * MESSAGE_WEIGHT_BYTES_PER_NODE
    );
  });
});

describe("MessageStore", () => {
  it("exports defaults of 100 messages per thread and 64 MB", () => {
    expect(DEFAULT_MAX_MESSAGES_PER_THREAD).toBe(100);
    expect(DEFAULT_MAX_MESSAGE_STORE_WEIGHT).toBe(64 * 1024 * 1024);
  });

  it.each([
    ["maxMessagesPerThread", 0],
    ["maxMessagesPerThread", -1],
    ["maxMessagesPerThread", 1.5],
    ["maxMessagesPerThread", Number.NaN],
    ["maxWeight", 0],
    ["maxWeight", -5],
    ["maxWeight", Number.NaN],
  ])("rejects %s of %s", (option, value) => {
    expect(() => new MessageStore({ [option]: value })).toThrow(option);
  });

  it("stores messages per thread, sorted oldest first", () => {
    const store = new MessageStore<unknown>();
    store.upsert(realMessage("b", 2000, LIGHT));
    store.upsert(realMessage("a", 1000, LIGHT));
    store.upsert(realMessage("z", 500, LIGHT, { threadId: "t:2" }));

    expect(ids(store.messages("t:1"))).toEqual(["a", "b"]);
    expect(ids(store.messages("t:2"))).toEqual(["z"]);
    expect(store.messages("t:missing")).toEqual([]);
    expect(store.latest("t:1")?.id).toBe("b");
    expect(store.latest("t:missing")).toBeUndefined();
    expect([...store.threadIds()]).toEqual(["t:1", "t:2"]);
    expect(
      [...store.threads()].map(([threadId, items]) => [threadId, ids(items)])
    ).toEqual([
      ["t:1", ["a", "b"]],
      ["t:2", ["z"]],
    ]);
    expect(store.size).toBe(3);
    expect(store.threadCount).toBe(2);
    expect(audit(store)).toEqual([]);
  });

  it("finds a message in any thread and returns undefined otherwise", () => {
    const store = new MessageStore<unknown>();
    const first = realMessage("a", 1000, LIGHT);
    const second = realMessage("b", 1000, LIGHT, { threadId: "t:2" });
    store.upsert(first);
    store.upsert(second);
    expect(store.find("a")).toBe(first);
    expect(store.find("b")).toBe(second);
    expect(store.find("c")).toBeUndefined();
  });

  it("hands out copies that cannot change the store", () => {
    const store = new MessageStore<unknown>();
    store.upsert(realMessage("a", 1000, LIGHT));
    store.upsert(realMessage("b", 2000, LIGHT));
    const weight = store.weight;

    store.messages("t:1").length = 0;
    for (const [, items] of store.threads()) {
      items.reverse();
      items.pop();
    }

    expect(ids(store.messages("t:1"))).toEqual(["a", "b"]);
    expect(store.weight).toBe(weight);
    expect(audit(store)).toEqual([]);
  });

  it("uses a custom comparator for order and for which end is oldest", () => {
    const store = new MessageStore<unknown>({
      compare: reversed,
      maxMessagesPerThread: 2,
    });
    for (const [id, time] of [
      ["a", 1000],
      ["b", 2000],
      ["c", 3000],
    ] as const) {
      store.upsert(realMessage(id, time, LIGHT));
    }
    expect(ids(store.messages("t:1"))).toEqual(["b", "a"]);
    expect(store.find("c")).toBeUndefined();
    expect(audit(store, reversed)).toEqual([]);
  });

  describe("per-thread cap", () => {
    it("drops the oldest messages beyond the cap", () => {
      const cap = 5;
      const extra = 3;
      const store = new MessageStore<unknown>({ maxMessagesPerThread: cap });
      for (let index = 0; index < cap + extra; index++) {
        store.upsert(realMessage(`m${index}`, index * 1000, LIGHT));
        expect(audit(store)).toEqual([]);
      }

      for (let index = 0; index < extra; index++) {
        expect(store.find(`m${index}`)).toBeUndefined();
      }
      expect(ids(store.messages("t:1"))).toEqual([
        "m3",
        "m4",
        "m5",
        "m6",
        "m7",
      ]);
      expect(store.size).toBe(cap);
      expect(store.weight).toBe(
        cap * estimateMessageWeight(realMessage("x", 0, LIGHT))
      );
    });

    it("applies the cap to each thread on its own", () => {
      const store = new MessageStore<unknown>({ maxMessagesPerThread: 2 });
      for (let index = 0; index < 4; index++) {
        store.upsert(realMessage(`a${index}`, index, LIGHT));
        store.upsert(
          realMessage(`b${index}`, index, LIGHT, { threadId: "t:2" })
        );
      }
      expect(ids(store.messages("t:1"))).toEqual(["a2", "a3"]);
      expect(ids(store.messages("t:2"))).toEqual(["b2", "b3"]);
      expect(audit(store)).toEqual([]);
    });

    it("defaults to 100 messages per thread", () => {
      const store = new MessageStore<unknown>();
      for (let index = 0; index < 103; index++) {
        store.upsert(realMessage(`m${index}`, index, LIGHT));
      }
      const kept = ids(store.messages("t:1"));
      expect(kept).toHaveLength(100);
      expect(kept[0]).toBe("m3");
      expect(kept.at(-1)).toBe("m102");
      expect(store.find("m2")).toBeUndefined();
    });

    it("trims by send time when an older message arrives late", () => {
      const store = new MessageStore<unknown>({ maxMessagesPerThread: 3 });
      store.upsert(realMessage("d", 4000, LIGHT));
      store.upsert(realMessage("b", 2000, LIGHT));
      store.upsert(realMessage("e", 5000, LIGHT));
      expect(ids(store.messages("t:1"))).toEqual(["b", "d", "e"]);

      store.upsert(realMessage("c", 3000, LIGHT));
      expect(ids(store.messages("t:1"))).toEqual(["c", "d", "e"]);
      expect(store.find("b")).toBeUndefined();

      // Older than everything in a full thread: dropped on arrival.
      store.upsert(realMessage("a", 1000, LIGHT));
      expect(store.find("a")).toBeUndefined();
      expect(ids(store.messages("t:1"))).toEqual(["c", "d", "e"]);
      expect(audit(store)).toEqual([]);
    });

    it("does not trim when a message is replaced in a full thread", () => {
      const store = new MessageStore<unknown>({ maxMessagesPerThread: 2 });
      store.upsert(realMessage("a", 1000, LIGHT));
      store.upsert(realMessage("b", 2000, LIGHT));
      store.upsert(realMessage("a", 1000, "edited"));
      expect(ids(store.messages("t:1"))).toEqual(["a", "b"]);
      expect(store.find("a")?.text).toBe("edited");
      expect(audit(store)).toEqual([]);
    });
  });

  describe("weight accounting", () => {
    it("sums the estimate of every stored message", () => {
      const store = new MessageStore<unknown>();
      const dense = realMessage("a", 1000, DENSE);
      const light = realMessage("b", 2000, LIGHT, { threadId: "t:2" });
      expect(store.weight).toBe(0);
      store.upsert(dense);
      expect(store.weight).toBe(estimateMessageWeight(dense));
      store.upsert(light);
      expect(store.weight).toBe(
        estimateMessageWeight(dense) + estimateMessageWeight(light)
      );
    });

    it("changes by exactly the difference when a message is replaced", () => {
      const store = new MessageStore<unknown>();
      const other = realMessage("o", 500, LIGHT);
      const light = realMessage("a", 1000, LIGHT);
      const heavy = realMessage("a", 1000, DENSE);
      const difference =
        estimateMessageWeight(heavy) - estimateMessageWeight(light);
      expect(difference).toBeGreaterThan(0);

      store.upsert(other);
      store.upsert(light);
      const before = store.weight;

      store.upsert(heavy);
      expect(store.weight).toBe(before + difference);
      expect(store.size).toBe(2);
      expect(store.find("a")).toBe(heavy);

      store.upsert(light);
      expect(store.weight).toBe(before);
      expect(store.size).toBe(2);
      expect(store.find("a")).toBe(light);
      expect(ids(store.messages("t:1"))).toEqual(["o", "a"]);
      expect(audit(store)).toEqual([]);
    });

    it("returns to zero once every message is deleted", () => {
      const store = new MessageStore<unknown>();
      const all = [
        realMessage("a", 1000, DENSE),
        realMessage("b", 2000, LIGHT),
        realMessage("c", 3000, DENSE, { threadId: "t:2" }),
      ];
      for (const item of all) {
        store.upsert(item);
      }

      expect(store.delete("a")).toBe(true);
      expect(store.weight).toBe(
        estimateMessageWeight(all[1]) + estimateMessageWeight(all[2])
      );
      expect(store.find("a")).toBeUndefined();
      expect(ids(store.messages("t:1"))).toEqual(["b"]);
      expect(store.delete("a")).toBe(false);

      expect(store.delete("c")).toBe(true);
      expect([...store.threadIds()]).toEqual(["t:1"]);
      expect(store.delete("b")).toBe(true);

      expect(store.weight).toBe(0);
      expect(store.size).toBe(0);
      expect(store.threadCount).toBe(0);
      expect([...store.threads()]).toEqual([]);
    });

    it("deletes an ID from every thread that holds it", () => {
      const store = new MessageStore<unknown>();
      const inFirst = realMessage("same", 1000, LIGHT);
      const inSecond = realMessage("same", 1000, DENSE, { threadId: "t:2" });
      const bystander = realMessage("other", 2000, LIGHT, { threadId: "t:2" });
      store.upsert(inFirst);
      store.upsert(inSecond);
      store.upsert(bystander);
      expect(store.size).toBe(3);
      expect(store.find("same")).toBe(inFirst);
      expect(audit(store)).toEqual([]);

      expect(store.delete("same")).toBe(true);
      expect(store.find("same")).toBeUndefined();
      expect([...store.threadIds()]).toEqual(["t:2"]);
      expect(ids(store.messages("t:2"))).toEqual(["other"]);
      expect(store.weight).toBe(estimateMessageWeight(bystander));
      expect(audit(store)).toEqual([]);
    });

    it("keeps the other thread's copy when one copy of an ID is trimmed", () => {
      const store = new MessageStore<unknown>({ maxMessagesPerThread: 1 });
      const kept = realMessage("same", 1000, LIGHT, { threadId: "t:2" });
      store.upsert(realMessage("same", 1000, LIGHT));
      store.upsert(kept);
      store.upsert(realMessage("newer", 2000, LIGHT));

      expect(ids(store.messages("t:1"))).toEqual(["newer"]);
      expect(store.find("same")).toBe(kept);
      expect(audit(store)).toEqual([]);
    });

    it("clears everything", () => {
      const store = new MessageStore<unknown>();
      store.upsert(realMessage("a", 1000, DENSE));
      store.clear();
      expect(store.weight).toBe(0);
      expect(store.size).toBe(0);
      expect(store.find("a")).toBeUndefined();
      expect(store.messages("t:1")).toEqual([]);
    });
  });

  describe("weight budget", () => {
    const denseWeight = estimateMessageWeight(realMessage("x", 0, DENSE));
    const lightWeight = estimateMessageWeight(realMessage("x", 0, LIGHT));

    it("takes the oldest messages from the heaviest thread and spares a light one", () => {
      const maxWeight = 3 * denseWeight + 3 * lightWeight;
      const store = new MessageStore<unknown>({ maxWeight });
      for (let index = 0; index < 3; index++) {
        store.upsert(
          realMessage(`l${index}`, index, LIGHT, { threadId: "t:light" })
        );
        expect(store.weight).toBeLessThanOrEqual(maxWeight);
      }
      for (let index = 0; index < 6; index++) {
        store.upsert(
          realMessage(`h${index}`, 100 + index, DENSE, { threadId: "t:heavy" })
        );
        expect(store.weight).toBeLessThanOrEqual(maxWeight);
        expect(audit(store)).toEqual([]);
      }

      expect(ids(store.messages("t:light"))).toEqual(["l0", "l1", "l2"]);
      expect(ids(store.messages("t:heavy"))).toEqual(["h3", "h4", "h5"]);
      for (const id of ["h0", "h1", "h2"]) {
        expect(store.find(id)).toBeUndefined();
      }
      expect(store.weight).toBe(maxWeight);
    });

    it("keeps a new light message and evicts from the heavy thread instead", () => {
      const maxWeight = 2 * denseWeight + lightWeight;
      const store = new MessageStore<unknown>({ maxWeight });
      store.upsert(realMessage("h0", 1, DENSE, { threadId: "t:heavy" }));
      store.upsert(realMessage("h1", 2, DENSE, { threadId: "t:heavy" }));
      store.upsert(realMessage("l0", 3, LIGHT, { threadId: "t:light" }));
      store.upsert(realMessage("l1", 4, LIGHT, { threadId: "t:light" }));

      expect(ids(store.messages("t:heavy"))).toEqual(["h1"]);
      expect(ids(store.messages("t:light"))).toEqual(["l0", "l1"]);
      expect(audit(store)).toEqual([]);
    });

    it("spares the upserted message when it is the oldest of the heaviest thread", () => {
      const maxWeight = 2 * denseWeight;
      const store = new MessageStore<unknown>({ maxWeight });
      store.upsert(realMessage("b", 2000, DENSE));
      store.upsert(realMessage("c", 3000, DENSE));
      store.upsert(realMessage("a", 1000, DENSE));

      expect(ids(store.messages("t:1"))).toEqual(["a", "c"]);
      expect(store.find("b")).toBeUndefined();
      expect(store.weight).toBe(maxWeight);
      expect(audit(store)).toEqual([]);
    });

    it("evicts from other threads when the upserted message is alone in the heaviest", () => {
      const big = realMessage("big", 9000, DENSE.repeat(3), {
        threadId: "t:big",
      });
      const maxWeight = estimateMessageWeight(big) + lightWeight;
      const store = new MessageStore<unknown>({ maxWeight });
      store.upsert(realMessage("a0", 1, LIGHT, { threadId: "t:a" }));
      store.upsert(realMessage("a1", 2, LIGHT, { threadId: "t:a" }));
      store.upsert(realMessage("b0", 3, LIGHT, { threadId: "t:b" }));
      store.upsert(big);

      expect(store.find("big")).toBe(big);
      expect(store.size).toBe(2);
      expect(store.find("a0")).toBeUndefined();
      expect(store.weight).toBeLessThanOrEqual(maxWeight);
      expect(audit(store)).toEqual([]);
    });

    it("evicts when a replacement makes a message heavier", () => {
      const maxWeight = denseWeight + lightWeight;
      const store = new MessageStore<unknown>({ maxWeight });
      store.upsert(realMessage("a", 1000, LIGHT));
      store.upsert(realMessage("b", 2000, LIGHT));
      store.upsert(realMessage("c", 3000, LIGHT));
      const edited = realMessage("c", 3000, DENSE);
      store.upsert(edited);

      expect(ids(store.messages("t:1"))).toEqual(["b", "c"]);
      expect(store.find("c")).toBe(edited);
      expect(store.weight).toBe(denseWeight + lightWeight);
      expect(audit(store)).toEqual([]);
    });

    it("ranks a thread by its current weight after replacements", () => {
      const maxWeight = 2 * denseWeight + 3 * lightWeight;
      const store = new MessageStore<unknown>({ maxWeight });
      store.upsert(realMessage("a0", 1, LIGHT, { threadId: "t:a" }));
      for (let edit = 0; edit < 3; edit++) {
        store.upsert(realMessage("a1", 2, DENSE, { threadId: "t:a" }));
      }
      store.upsert(realMessage("a1", 2, LIGHT, { threadId: "t:a" }));
      store.upsert(realMessage("b0", 3, DENSE, { threadId: "t:b" }));
      store.upsert(realMessage("b1", 4, DENSE, { threadId: "t:b" }));
      store.upsert(realMessage("c0", 5, LIGHT, { threadId: "t:c" }));
      store.upsert(realMessage("c1", 6, LIGHT, { threadId: "t:c" }));

      expect(ids(store.messages("t:a"))).toEqual(["a0", "a1"]);
      expect(ids(store.messages("t:b"))).toEqual(["b1"]);
      expect(ids(store.messages("t:c"))).toEqual(["c0", "c1"]);
    });

    it("ranks a thread by its current weight after deletes", () => {
      const maxWeight = 3 * denseWeight + 2 * lightWeight;
      const store = new MessageStore<unknown>({ maxWeight });
      store.upsert(realMessage("a0", 1, LIGHT, { threadId: "t:a" }));
      for (const id of ["a1", "a2", "a3"]) {
        store.upsert(realMessage(id, 2, DENSE, { threadId: "t:a" }));
      }
      for (const id of ["a1", "a2", "a3"]) {
        store.delete(id);
      }
      store.upsert(realMessage("b0", 3, DENSE, { threadId: "t:b" }));
      store.upsert(realMessage("b1", 4, DENSE, { threadId: "t:b" }));
      store.upsert(realMessage("c0", 5, DENSE, { threadId: "t:c" }));
      store.upsert(realMessage("c1", 6, LIGHT, { threadId: "t:c" }));
      store.upsert(realMessage("d0", 7, LIGHT, { threadId: "t:d" }));

      expect(ids(store.messages("t:a"))).toEqual(["a0"]);
      expect(ids(store.messages("t:b"))).toEqual(["b1"]);
      expect(ids(store.messages("t:c"))).toEqual(["c0", "c1"]);
      expect(ids(store.messages("t:d"))).toEqual(["d0"]);
    });

    it("does not store a message heavier than the whole budget and evicts nothing", () => {
      const maxWeight = 3 * lightWeight;
      const store = new MessageStore<unknown>({ maxWeight });
      store.upsert(realMessage("huge", 1000, DENSE));
      expect(store.find("huge")).toBeUndefined();
      expect(store.size).toBe(0);
      expect(store.weight).toBe(0);
      expect(store.threadCount).toBe(0);

      const a = realMessage("a", 1000, LIGHT);
      const b = realMessage("b", 2000, LIGHT, { threadId: "t:2" });
      store.upsert(a);
      store.upsert(b);
      store.upsert(realMessage("huge", 3000, DENSE));
      store.upsert(realMessage("huge", 500, DENSE, { threadId: "t:3" }));

      expect(store.find("huge")).toBeUndefined();
      expect(store.find("a")).toBe(a);
      expect(store.find("b")).toBe(b);
      expect(ids(store.messages("t:1"))).toEqual(["a"]);
      expect(ids(store.messages("t:2"))).toEqual(["b"]);
      expect([...store.threadIds()]).toEqual(["t:1", "t:2"]);
      expect(store.size).toBe(2);
      expect(store.weight).toBe(2 * lightWeight);
      expect(audit(store)).toEqual([]);

      store.upsert(realMessage("c", 4000, LIGHT));
      expect(ids(store.messages("t:1"))).toEqual(["a", "c"]);
      expect(store.weight).toBe(maxWeight);
    });

    it("removes the stored copy when its replacement is heavier than the whole budget", () => {
      const maxWeight = 3 * lightWeight;
      const store = new MessageStore<unknown>({ maxWeight });
      const a = realMessage("a", 1000, LIGHT);
      const other = realMessage("edited", 1500, LIGHT, { threadId: "t:2" });
      store.upsert(a);
      store.upsert(realMessage("edited", 2000, LIGHT));
      store.upsert(other);
      expect(store.size).toBe(3);

      store.upsert(realMessage("edited", 2000, DENSE));

      expect(ids(store.messages("t:1"))).toEqual(["a"]);
      expect(store.find("a")).toBe(a);
      expect(store.find("edited")).toBe(other);
      expect(ids(store.messages("t:2"))).toEqual(["edited"]);
      expect(store.size).toBe(2);
      expect(store.weight).toBe(2 * lightWeight);
      expect(audit(store)).toEqual([]);

      store.upsert(realMessage("solo", 1000, LIGHT, { threadId: "t:3" }));
      store.upsert(realMessage("solo", 1000, DENSE, { threadId: "t:3" }));
      expect(store.find("solo")).toBeUndefined();
      expect([...store.threadIds()]).toEqual(["t:1", "t:2"]);
      expect(store.weight).toBe(2 * lightWeight);
      expect(audit(store)).toEqual([]);
    });

    it("stays within budget when the upserted message was trimmed on arrival", () => {
      const maxWeight = 2 * denseWeight;
      const store = new MessageStore<unknown>({
        maxMessagesPerThread: 2,
        maxWeight,
      });
      store.upsert(realMessage("b", 2000, DENSE));
      store.upsert(realMessage("c", 3000, DENSE));
      store.upsert(realMessage("a", 1000, DENSE.repeat(4)));
      expect(ids(store.messages("t:1"))).toEqual(["b", "c"]);
      expect(store.weight).toBe(maxWeight);
      expect(audit(store)).toEqual([]);
    });
  });

  it("stays consistent and within both limits over a seeded sequence", () => {
    const random = createRandom(7_031_977);
    const bodies = [LIGHT, "plain prose ".repeat(20), DENSE, DENSE.repeat(3)];
    // Parsed once: the sequence runs thousands of steps and the store only
    // reads the tree, so every message of a body can share it.
    const templates = bodies.map((body) => realMessage("x", 0, body));
    const maxWeight = 12 * estimateMessageWeight(templates[2]);
    const maxMessagesPerThread = 5;
    const store = new MessageStore<unknown>({
      maxMessagesPerThread,
      maxWeight,
    });
    let evictedFromOtherThreads = 0;
    let trimmed = 0;
    let deleted = 0;
    let replaced = 0;

    for (let step = 0; step < 3000; step++) {
      const id = `m${random(60)}`;
      if (random(6) === 0) {
        if (store.delete(id)) {
          deleted++;
        }
        expect(store.find(id)).toBeUndefined();
      } else {
        const threadId = `t:${random(4)}`;
        const time = random(50) * 1000;
        const template = templates[random(4)];
        const item = new Message<unknown>({
          ...template,
          id,
          threadId,
          metadata: { ...template.metadata, dateSent: new Date(time) },
        });
        const threadBefore = store.messages(threadId);
        const isReplace = threadBefore.some((existing) => existing.id === id);
        const wasFull = threadBefore.length === maxMessagesPerThread;
        const others = store.size - threadBefore.length;
        store.upsert(item);
        if (isReplace) {
          replaced++;
        } else if (wasFull) {
          trimmed++;
        }
        if (store.size - store.messages(threadId).length < others) {
          evictedFromOtherThreads++;
        }
      }

      expect(store.weight).toBeLessThanOrEqual(maxWeight);
      for (const [, items] of store.threads()) {
        expect(items.length).toBeLessThanOrEqual(maxMessagesPerThread);
      }
      expect(audit(store)).toEqual([]);
    }

    expect(deleted).toBeGreaterThan(50);
    expect(replaced).toBeGreaterThan(50);
    expect(trimmed).toBeGreaterThan(20);
    expect(evictedFromOtherThreads).toBeGreaterThan(50);
  }, 30_000);
});
