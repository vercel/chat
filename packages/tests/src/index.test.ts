import { describe, expect, it, vi } from "vitest";
import {
  createMockAdapter,
  createMockChatInstance,
  createMockLogger,
  createMockState,
  createTestMessage,
} from "./factories";
import { matchers } from "./matchers";

expect.extend(matchers);

const HELLO_WORLD = /world/;
const CHANNEL = /channel/;

describe("createMockState", () => {
  it("supports get/set/delete round-trip via the cache", async () => {
    const state = createMockState();
    await state.set("k", { v: 1 });
    expect(state.cache.get("k")).toEqual({ v: 1 });
    expect(await state.get("k")).toEqual({ v: 1 });
    await state.delete("k");
    expect(await state.get("k")).toBeNull();
  });

  it("tracks subscriptions", async () => {
    const state = createMockState();
    await state.subscribe("slack:C1:t1");
    expect(await state.isSubscribed("slack:C1:t1")).toBe(true);
    await state.unsubscribe("slack:C1:t1");
    expect(await state.isSubscribed("slack:C1:t1")).toBe(false);
  });

  it("isolates state between separate instances", async () => {
    const a = createMockState();
    const b = createMockState();
    await a.set("k", "from-a");
    expect(await b.get("k")).toBeNull();
  });

  it("acquires a lock once and rejects re-acquisition", async () => {
    const state = createMockState();
    const lock = await state.acquireLock("slack:C1:t1", 1000);
    expect(lock).not.toBeNull();
    expect(await state.acquireLock("slack:C1:t1", 1000)).toBeNull();
  });

  it("setIfNotExists is atomic-style", async () => {
    const state = createMockState();
    expect(await state.setIfNotExists("k", 1)).toBe(true);
    expect(await state.setIfNotExists("k", 2)).toBe(false);
    expect(await state.get("k")).toBe(1);
  });

  it("appendToList trims to maxLength", async () => {
    const state = createMockState();
    await state.appendToList("k", "a", { maxLength: 2 });
    await state.appendToList("k", "b", { maxLength: 2 });
    await state.appendToList("k", "c", { maxLength: 2 });
    expect(await state.getList("k")).toEqual(["b", "c"]);
  });

  it("enqueue/dequeue is FIFO", async () => {
    const state = createMockState();
    await state.enqueue("t1", { id: "1" } as never, 10);
    await state.enqueue("t1", { id: "2" } as never, 10);
    expect(await state.queueDepth("t1")).toBe(2);
    const first = await state.dequeue("t1");
    expect((first as { id: string } | null)?.id).toBe("1");
    expect(await state.queueDepth("t1")).toBe(1);
  });
});

describe("createMockAdapter", () => {
  it("returns mocked methods with sensible defaults", async () => {
    const adapter = createMockAdapter("slack");
    expect(adapter.name).toBe("slack");
    expect(adapter.userName).toBe("slack-bot");
    const result = await adapter.postMessage("slack:C1:t1", "hello");
    expect(result).toEqual({ id: "msg-1", threadId: undefined, raw: {} });
  });

  it("encodes and decodes thread IDs symmetrically", () => {
    const adapter = createMockAdapter("slack");
    const id = adapter.encodeThreadId({ channel: "C1", thread: "t1" });
    expect(id).toBe("slack:C1:t1");
    expect(adapter.decodeThreadId(id)).toEqual({ channel: "C1", thread: "t1" });
  });

  it("applies overrides on top of defaults", async () => {
    const customPost = vi.fn().mockResolvedValue({
      id: "custom",
      threadId: undefined,
      raw: { custom: true },
    });
    const adapter = createMockAdapter("slack", { postMessage: customPost });
    const result = await adapter.postMessage("slack:C1:t1", "hi");
    expect(result.id).toBe("custom");
    expect(customPost).toHaveBeenCalledTimes(1);
  });
});

describe("createMockChatInstance", () => {
  it("uses the supplied state", () => {
    const state = createMockState();
    const chat = createMockChatInstance({ state });
    expect(chat.getState()).toBe(state);
  });

  it("defaults the user name and supports override", () => {
    expect(createMockChatInstance().getUserName()).toBe("test-bot");
    expect(createMockChatInstance({ userName: "alice" }).getUserName()).toBe(
      "alice"
    );
  });
});

describe("createMockLogger", () => {
  it("produces an isolated logger per call", () => {
    const a = createMockLogger();
    const b = createMockLogger();
    a.info("hello");
    expect(a.info).toHaveBeenCalledTimes(1);
    expect(b.info).not.toHaveBeenCalled();
  });
});

describe("createTestMessage", () => {
  it("parses text into formatted AST", () => {
    const message = createTestMessage("m1", "hello **world**");
    expect(message.text).toBe("hello **world**");
    expect(message.formatted).toBeDefined();
    expect(message.id).toBe("m1");
  });
});

describe("matcher: toHavePosted", () => {
  it("passes when adapter posted to the given thread", async () => {
    const adapter = createMockAdapter("slack");
    await adapter.postMessage("slack:C1:t1", "hello");
    expect(adapter).toHavePosted("slack:C1:t1");
  });

  it("matches plain string messages against text patterns", async () => {
    const adapter = createMockAdapter("slack");
    await adapter.postMessage("slack:C1:t1", "hello world");
    expect(adapter).toHavePosted("slack:C1:t1", HELLO_WORLD);
    expect(adapter).toHavePosted("slack:C1:t1", "hello world");
    expect(adapter).not.toHavePosted("slack:C1:t1", "goodbye");
  });

  it("matches PostableMarkdown.markdown against text patterns", async () => {
    const adapter = createMockAdapter("slack");
    await adapter.postMessage("slack:C1:t1", { markdown: "hello **world**" });
    expect(adapter).toHavePosted("slack:C1:t1", HELLO_WORLD);
    expect(adapter).toHavePosted("slack:C1:t1", "hello **world**");
  });

  it("matches PostableRaw.raw and PostableCard.fallbackText", async () => {
    const adapter = createMockAdapter("slack");
    await adapter.postMessage("slack:C1:raw", { raw: "hello world" });
    await adapter.postMessage("slack:C1:card", {
      card: {} as never,
      fallbackText: "hello world",
    });
    expect(adapter).toHavePosted("slack:C1:raw", HELLO_WORLD);
    expect(adapter).toHavePosted("slack:C1:card", HELLO_WORLD);
  });

  it("fails when posting went to a different thread", async () => {
    const adapter = createMockAdapter("slack");
    await adapter.postMessage("slack:C1:other", "hi");
    expect(adapter).not.toHavePosted("slack:C1:t1");
  });
});

describe("matcher: toHaveDispatched", () => {
  it("passes when the named handler was called", () => {
    const chat = createMockChatInstance();
    chat.processMessage({} as never, "slack:C1:t1", {} as never);
    expect(chat).toHaveDispatched("processMessage");
  });

  it("fails when the handler was not called", () => {
    const chat = createMockChatInstance();
    expect(chat).not.toHaveDispatched("processReaction");
  });
});

describe("matcher: toBeSubscribedTo", () => {
  it("passes after subscribe and fails after unsubscribe", async () => {
    const state = createMockState();
    await state.subscribe("slack:C1:t1");
    await expect(state).toBeSubscribedTo("slack:C1:t1");
    await state.unsubscribe("slack:C1:t1");
    await expect(state).not.toBeSubscribedTo("slack:C1:t1");
  });
});

describe("matcher: toHaveEdited", () => {
  it("passes when edit hit the right thread and message", async () => {
    const adapter = createMockAdapter("slack");
    await adapter.editMessage("slack:C1:t1", "msg-1", "updated");
    expect(adapter).toHaveEdited("slack:C1:t1", "msg-1");
    expect(adapter).toHaveEdited("slack:C1:t1", "msg-1", "updated");
    expect(adapter).not.toHaveEdited("slack:C1:t1", "msg-2");
    expect(adapter).not.toHaveEdited("slack:C1:t1", "msg-1", "different");
  });

  it("matches PostableMarkdown.markdown for edits", async () => {
    const adapter = createMockAdapter("slack");
    await adapter.editMessage("slack:C1:t1", "msg-1", {
      markdown: "edited **world**",
    });
    expect(adapter).toHaveEdited("slack:C1:t1", "msg-1", HELLO_WORLD);
  });
});

describe("matcher: toHaveDeleted", () => {
  it("passes when delete hit the right thread and message", async () => {
    const adapter = createMockAdapter("slack");
    await adapter.deleteMessage("slack:C1:t1", "msg-1");
    expect(adapter).toHaveDeleted("slack:C1:t1", "msg-1");
    expect(adapter).not.toHaveDeleted("slack:C1:t1", "msg-2");
    expect(adapter).not.toHaveDeleted("slack:C1:other", "msg-1");
  });
});

describe("matcher: toHaveReactedWith", () => {
  it("matches plain string emoji", async () => {
    const adapter = createMockAdapter("slack");
    await adapter.addReaction("slack:C1:t1", "msg-1", "thumbsup");
    expect(adapter).toHaveReactedWith("slack:C1:t1", "msg-1", "thumbsup");
    expect(adapter).not.toHaveReactedWith("slack:C1:t1", "msg-1", "other");
  });

  it("matches EmojiValue.name", async () => {
    const adapter = createMockAdapter("slack");
    const emojiValue = {
      name: "thumbs_up",
      toString: () => ":thumbs_up:",
      toJSON: () => "thumbs_up",
    };
    await adapter.addReaction("slack:C1:t1", "msg-1", emojiValue);
    expect(adapter).toHaveReactedWith("slack:C1:t1", "msg-1", "thumbs_up");
  });

  it("scopes to the named thread + message", async () => {
    const adapter = createMockAdapter("slack");
    await adapter.addReaction("slack:C1:other", "msg-1", "thumbsup");
    expect(adapter).not.toHaveReactedWith("slack:C1:t1", "msg-1", "thumbsup");
  });
});

describe("matcher: toHaveStartedTyping", () => {
  it("passes when typing started on the given thread", async () => {
    const adapter = createMockAdapter("slack");
    await adapter.startTyping("slack:C1:t1");
    expect(adapter).toHaveStartedTyping("slack:C1:t1");
    expect(adapter).not.toHaveStartedTyping("slack:C1:other");
  });
});

describe("matcher: toHavePostedToChannel", () => {
  it("passes when adapter posted to the given channel", async () => {
    const adapter = createMockAdapter("slack");
    if (!adapter.postChannelMessage) {
      throw new Error("mock adapter must define postChannelMessage");
    }
    await adapter.postChannelMessage("slack:C1", "channel hello");
    expect(adapter).toHavePostedToChannel("slack:C1");
    expect(adapter).toHavePostedToChannel("slack:C1", CHANNEL);
    expect(adapter).not.toHavePostedToChannel("slack:C2");
  });
});
