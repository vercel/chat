import { beforeEach, describe, expect, it } from "vitest";
import type { SerializedMessage } from "./message";
import type { MockStateAdapter } from "./mock-adapter";
import { createMockState, createTestMessage } from "./mock-adapter";
import { ThreadHistoryCache } from "./thread-history";
import type { FormattedContent } from "./types";

const RICH =
  "**bold** and `code` with a [link](https://example.com)\n\n- one\n- two";
const POSITION_KEY = '"position"';

/** The tree as JSON would store it once every `position` is dropped. */
function expectedWithoutPositions(tree: FormattedContent): FormattedContent {
  return JSON.parse(
    JSON.stringify(tree, (key, value) =>
      key === "position" ? undefined : value
    )
  );
}

function nodeTypes(tree: unknown): string[] {
  const types: string[] = [];
  const pending: unknown[] = [tree];
  for (let node = pending.pop(); node; node = pending.pop()) {
    const { type, children } = node as { type: string; children?: unknown[] };
    types.push(type);
    pending.push(...(children ?? []));
  }
  return types;
}

describe("ThreadHistoryCache", () => {
  let state: MockStateAdapter;
  let cache: ThreadHistoryCache;

  beforeEach(() => {
    state = createMockState();
    cache = new ThreadHistoryCache(state);
  });

  it("should append and retrieve messages", async () => {
    const msg1 = createTestMessage("m1", "Hello");
    const msg2 = createTestMessage("m2", "World");

    await cache.append("thread-1", msg1);
    await cache.append("thread-1", msg2);

    const messages = await cache.getMessages("thread-1");
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe("m1");
    expect(messages[0].text).toBe("Hello");
    expect(messages[1].id).toBe("m2");
    expect(messages[1].text).toBe("World");
  });

  it("should use appendToList for atomic appends", async () => {
    const msg = createTestMessage("m1", "Hello");

    await cache.append("thread-1", msg);

    expect(state.appendToList).toHaveBeenCalledTimes(1);
    expect(state.appendToList).toHaveBeenCalledWith(
      "msg-history:thread-1",
      expect.objectContaining({ id: "m1" }),
      { maxLength: 100, ttlMs: 7 * 24 * 60 * 60 * 1000 }
    );
  });

  it("should trim to maxMessages, keeping newest", async () => {
    const smallCache = new ThreadHistoryCache(state, { maxMessages: 3 });

    for (let i = 1; i <= 5; i++) {
      await smallCache.append(
        "thread-1",
        createTestMessage(`m${i}`, `Msg ${i}`)
      );
    }

    const messages = await smallCache.getMessages("thread-1");
    expect(messages).toHaveLength(3);
    expect(messages[0].id).toBe("m3");
    expect(messages[1].id).toBe("m4");
    expect(messages[2].id).toBe("m5");
  });

  it("should strip raw fields on storage", async () => {
    const replyTo = createTestMessage("m0", "Original");
    replyTo.raw = { secret: "reply data" };
    const msg = createTestMessage("m1", "Hello", { replyTo });
    msg.raw = { secret: "data", nested: { deep: true } };

    await cache.append("thread-1", msg);

    // Check what was passed to appendToList
    const appendedValue = (
      state.appendToList as ReturnType<typeof import("vitest").vi.fn>
    ).mock.calls[0][1] as {
      replyTo?: { raw: unknown };
      raw: unknown;
    };
    expect(appendedValue.raw).toBeNull();
    expect(appendedValue.replyTo?.raw).toBeNull();
  });

  async function stored(threadId: string): Promise<SerializedMessage[]> {
    return await state.getList<SerializedMessage>(`msg-history:${threadId}`);
  }

  it("stores the formatted tree without parser positions and leaves the message's own tree intact", async () => {
    const replyTo = createTestMessage("m0", RICH);
    const msg = createTestMessage("m1", RICH, { replyTo });
    const before = structuredClone(msg.formatted);
    const replyBefore = structuredClone(replyTo.formatted);
    // The parser output must carry positions, or this test proves nothing.
    expect(JSON.stringify(before)).toContain(POSITION_KEY);

    await cache.append("thread-1", msg);

    const [entry] = await stored("thread-1");
    expect(JSON.stringify(entry.formatted)).not.toContain(POSITION_KEY);
    expect(entry.formatted).toEqual(expectedWithoutPositions(before));
    expect(JSON.stringify(entry.replyTo?.formatted)).not.toContain(
      POSITION_KEY
    );
    expect(entry.replyTo?.formatted).toEqual(
      expectedWithoutPositions(replyBefore)
    );

    // The mock state keeps references, so stripping in place would show here.
    expect(msg.formatted).toEqual(before);
    expect(replyTo.formatted).toEqual(replyBefore);

    const [read] = await cache.getMessages("thread-1");
    expect(read.formatted).toEqual(expectedWithoutPositions(before));
    expect(read.replyTo?.formatted).toEqual(
      expectedWithoutPositions(replyBefore)
    );
  });

  it("keeps node types and fields it does not know about", async () => {
    const formatted = {
      type: "root",
      children: [
        {
          type: "paragraph",
          position: { start: { line: 1 }, end: { line: 1 } },
          children: [
            {
              type: "mention",
              userId: "U1",
              data: { position: "kept: not a node position" },
              position: { start: { line: 1 }, end: { line: 1 } },
            },
            "not a node",
          ],
        },
      ],
    } as unknown as FormattedContent;

    await cache.append(
      "thread-1",
      createTestMessage("m1", "hi", { formatted })
    );

    const [entry] = await stored("thread-1");
    expect(entry.formatted).toEqual({
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "mention",
              userId: "U1",
              data: { position: "kept: not a node position" },
            },
            "not a node",
          ],
        },
      ],
    });
  });

  it("stores a tree nested thousands of levels deep", async () => {
    const depth = 50_000;
    const formatted = { type: "root", children: [] as unknown[] };
    let parent = formatted;
    for (let level = 0; level < depth; level++) {
      const child = {
        type: "blockquote",
        position: { start: { line: level }, end: { line: level } },
        children: [] as unknown[],
      };
      parent.children.push(child);
      parent = child;
    }

    await cache.append(
      "thread-1",
      createTestMessage("m1", "deep", {
        formatted: formatted as unknown as FormattedContent,
      })
    );

    const [entry] = await stored("thread-1");
    let levels = 0;
    let node = entry.formatted as unknown as {
      children: unknown[];
      position?: unknown;
    };
    while (node.children.length > 0) {
      node = node.children[0] as typeof node;
      expect(node.position).toBeUndefined();
      levels++;
    }
    expect(levels).toBe(depth);
  });

  it("stores a tree that contains itself without walking it forever", async () => {
    const paragraph = {
      type: "paragraph",
      position: { start: { line: 1 }, end: { line: 1 } },
      children: [] as unknown[],
    };
    const formatted = { type: "root", children: [paragraph, paragraph] };
    paragraph.children.push(formatted);

    await cache.append(
      "thread-1",
      createTestMessage("m1", "cyclic", {
        formatted: formatted as unknown as FormattedContent,
      })
    );

    const [entry] = await stored("thread-1");
    const root = entry.formatted as unknown as typeof formatted;
    const [first, second] = root.children;
    expect(root).not.toBe(formatted);
    expect(first).not.toBe(paragraph);
    expect(first).toBe(second);
    expect(first.position).toBeUndefined();
    expect(first.children[0]).toBe(root);
    expect(paragraph.position).toBeDefined();
  });

  it("stores a single text node per message when storeFormatted is false", async () => {
    const textOnly = new ThreadHistoryCache(state, { storeFormatted: false });
    const replyTo = createTestMessage("m0", RICH);
    const msg = createTestMessage("m1", RICH, { replyTo });
    const before = structuredClone(msg.formatted);

    await textOnly.append("text-only", msg);
    await cache.append("default", msg);

    const plain = {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", value: RICH }] },
      ],
    };
    const [entry] = await stored("text-only");
    expect(entry.formatted).toEqual(plain);
    expect(entry.replyTo?.formatted).toEqual(plain);
    expect(entry.text).toBe(RICH);
    expect(msg.formatted).toEqual(before);

    // The default keeps the structure of the same message.
    const [kept] = await stored("default");
    expect(nodeTypes(kept.formatted)).toEqual(
      expect.arrayContaining(["strong", "inlineCode", "link", "list"])
    );
  });

  it("reads back an entry stored with positions as it was stored", async () => {
    const serialized = createTestMessage("m1", RICH).toJSON();
    serialized.raw = null;
    expect(JSON.stringify(serialized.formatted)).toContain(POSITION_KEY);
    await state.appendToList("msg-history:thread-1", serialized);

    const [read] = await cache.getMessages("thread-1");
    expect(read.formatted).toEqual(serialized.formatted);
    expect(JSON.stringify(read.formatted)).toContain(POSITION_KEY);
  });

  it("should return empty array for unknown thread", async () => {
    const messages = await cache.getMessages("nonexistent");
    expect(messages).toHaveLength(0);
  });

  it("should support limit parameter in getMessages", async () => {
    for (let i = 1; i <= 10; i++) {
      await cache.append("thread-1", createTestMessage(`m${i}`, `Msg ${i}`));
    }

    const messages = await cache.getMessages("thread-1", 3);
    expect(messages).toHaveLength(3);
    // Should return the newest 3
    expect(messages[0].id).toBe("m8");
    expect(messages[1].id).toBe("m9");
    expect(messages[2].id).toBe("m10");
  });

  it("should keep threads isolated", async () => {
    await cache.append("thread-1", createTestMessage("m1", "Thread 1"));
    await cache.append("thread-2", createTestMessage("m2", "Thread 2"));

    const msgs1 = await cache.getMessages("thread-1");
    const msgs2 = await cache.getMessages("thread-2");

    expect(msgs1).toHaveLength(1);
    expect(msgs1[0].text).toBe("Thread 1");
    expect(msgs2).toHaveLength(1);
    expect(msgs2[0].text).toBe("Thread 2");
  });
});

describe("MessageHistoryCache (deprecated alias)", () => {
  it("re-exports ThreadHistoryCache under the old name", async () => {
    const { MessageHistoryCache } = await import("./message-history");
    expect(MessageHistoryCache).toBe(ThreadHistoryCache);

    const state = createMockState();
    const cache = new MessageHistoryCache(state);
    await cache.append("t-1", createTestMessage("m1", "hello"));
    const msgs = await cache.getMessages("t-1");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe("hello");
  });
});
