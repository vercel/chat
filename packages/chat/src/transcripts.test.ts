import { beforeEach, describe, expect, it } from "vitest";

import { parseMarkdown } from "./markdown";
import type { MockStateAdapter } from "./mock-adapter";
import { createMockState, createTestMessage } from "./mock-adapter";
import { TranscriptsApiImpl } from "./transcripts";
import type { Postable } from "./types";

const UUID_RE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;
const USER_KEY_REQUIRED_RE = /options\.userKey is required/;
const INVALID_DURATION_RE = /Invalid duration/;

function createTestThread(
  adapterName = "slack",
  threadId = "slack:C123:1234.5678"
): Postable {
  return {
    adapter: { name: adapterName },
    id: threadId,
  } as unknown as Postable;
}

describe("TranscriptsApiImpl", () => {
  let state: MockStateAdapter;
  let api: TranscriptsApiImpl;

  beforeEach(() => {
    state = createMockState();
    api = new TranscriptsApiImpl(state, {});
  });

  describe("append", () => {
    it("persists a Message under the resolved userKey", async () => {
      const thread = createTestThread();
      const msg = createTestMessage("m1", "Hello");
      msg.userKey = "user@example.com";

      const stored = await api.append(thread, msg);

      expect(stored).not.toBeNull();
      expect(stored?.userKey).toBe("user@example.com");
      expect(stored?.text).toBe("Hello");
      expect(stored?.role).toBe("user");
      expect(stored?.platform).toBe("slack");
      expect(stored?.threadId).toBe("slack:C123:1234.5678");
      expect(stored?.platformMessageId).toBe("m1");
      expect(stored?.id).toMatch(UUID_RE);
      expect(stored?.timestamp).toBeGreaterThan(0);

      expect(state.appendToList).toHaveBeenCalledWith(
        "transcripts:user:user@example.com",
        expect.objectContaining({ userKey: "user@example.com" }),
        { maxLength: 200, ttlMs: undefined }
      );
    });

    it("no-ops when Message has no userKey", async () => {
      const thread = createTestThread();
      const msg = createTestMessage("m1", "Hello");
      // userKey deliberately not set

      const stored = await api.append(thread, msg);

      expect(stored).toBeNull();
      expect(state.appendToList).not.toHaveBeenCalled();
    });

    it("requires options.userKey when appending an AppendInput", async () => {
      const thread = createTestThread();

      await expect(
        api.append(thread, { role: "assistant", text: "hi" })
      ).rejects.toThrow(USER_KEY_REQUIRED_RE);
    });

    it("appends an assistant message with explicit userKey", async () => {
      const thread = createTestThread();

      const stored = await api.append(
        thread,
        { role: "assistant", text: "Hello, Mike" },
        { userKey: "mike@acme.com" }
      );

      expect(stored?.role).toBe("assistant");
      expect(stored?.userKey).toBe("mike@acme.com");
      expect(stored?.text).toBe("Hello, Mike");
      expect(stored?.platformMessageId).toBeUndefined();
    });

    it("omits formatted by default", async () => {
      const thread = createTestThread();
      const msg = createTestMessage("m1", "Hello");
      msg.userKey = "u1";

      const stored = await api.append(thread, msg);

      expect(stored?.formatted).toBeUndefined();
    });

    it("includes formatted when storeFormatted is true", async () => {
      api = new TranscriptsApiImpl(state, { storeFormatted: true });
      const thread = createTestThread();
      const msg = createTestMessage("m1", "**bold**");
      msg.userKey = "u1";

      const stored = await api.append(thread, msg);

      expect(stored?.formatted).toBeDefined();
      expect(stored?.formatted?.type).toBe("root");

      const round = await api.list({ userKey: "u1" });
      expect(round[0]?.formatted).toEqual(stored?.formatted);
    });

    it("passes retention duration string through as ttlMs", async () => {
      api = new TranscriptsApiImpl(state, { retention: "7d" });
      const thread = createTestThread();
      const msg = createTestMessage("m1", "Hello");
      msg.userKey = "u1";

      await api.append(thread, msg);

      expect(state.appendToList).toHaveBeenCalledWith(
        "transcripts:user:u1",
        expect.anything(),
        { maxLength: 200, ttlMs: 7 * 24 * 60 * 60 * 1000 }
      );
    });

    it("passes numeric retention through unchanged", async () => {
      api = new TranscriptsApiImpl(state, {
        retention: 60_000,
        maxPerUser: 50,
      });
      const thread = createTestThread();
      const msg = createTestMessage("m1", "Hello");
      msg.userKey = "u1";

      await api.append(thread, msg);

      expect(state.appendToList).toHaveBeenCalledWith(
        "transcripts:user:u1",
        expect.anything(),
        { maxLength: 50, ttlMs: 60_000 }
      );
    });

    it("rejects malformed duration strings", () => {
      expect(
        () =>
          new TranscriptsApiImpl(state, {
            retention: "7days" as unknown as `${number}d`,
          })
      ).toThrow(INVALID_DURATION_RE);
    });
  });

  describe("list", () => {
    async function seed(userKey: string) {
      const thread = createTestThread();
      for (let i = 0; i < 5; i++) {
        const msg = createTestMessage(`m${i}`, `msg ${i}`);
        msg.userKey = userKey;
        await api.append(thread, msg);
      }
    }

    it("returns all messages in chronological order by default", async () => {
      await seed("u1");

      const list = await api.list({ userKey: "u1" });

      expect(list).toHaveLength(5);
      expect(list.map((m) => m.text)).toEqual([
        "msg 0",
        "msg 1",
        "msg 2",
        "msg 3",
        "msg 4",
      ]);
    });

    it("returns empty array when no messages exist", async () => {
      const list = await api.list({ userKey: "nobody" });
      expect(list).toEqual([]);
    });

    it("returns the newest N when limit is set, still chronological", async () => {
      await seed("u1");

      const list = await api.list({ userKey: "u1", limit: 2 });

      expect(list).toHaveLength(2);
      expect(list.map((m) => m.text)).toEqual(["msg 3", "msg 4"]);
    });

    it("filters by platform", async () => {
      const slackThread = createTestThread("slack");
      const discordThread = createTestThread("discord", "discord:C:T");
      const slackMsg = createTestMessage("s1", "from slack");
      slackMsg.userKey = "u1";
      const discordMsg = createTestMessage("d1", "from discord");
      discordMsg.userKey = "u1";

      await api.append(slackThread, slackMsg);
      await api.append(discordThread, discordMsg);

      const slackOnly = await api.list({
        userKey: "u1",
        platforms: ["slack"],
      });
      expect(slackOnly).toHaveLength(1);
      expect(slackOnly[0]?.platform).toBe("slack");
    });

    it("filters by threadId", async () => {
      const a = createTestThread("slack", "slack:C:A");
      const b = createTestThread("slack", "slack:C:B");
      const m1 = createTestMessage("m1", "thread A");
      m1.userKey = "u1";
      const m2 = createTestMessage("m2", "thread B");
      m2.userKey = "u1";

      await api.append(a, m1);
      await api.append(b, m2);

      const list = await api.list({ userKey: "u1", threadId: "slack:C:A" });
      expect(list).toHaveLength(1);
      expect(list[0]?.text).toBe("thread A");
    });

    it("filters by role", async () => {
      const thread = createTestThread();
      const userMsg = createTestMessage("m1", "user msg");
      userMsg.userKey = "u1";
      await api.append(thread, userMsg);
      await api.append(
        thread,
        { role: "assistant", text: "bot msg" },
        { userKey: "u1" }
      );

      const userOnly = await api.list({ userKey: "u1", roles: ["user"] });
      expect(userOnly).toHaveLength(1);
      expect(userOnly[0]?.role).toBe("user");

      const assistantOnly = await api.list({
        userKey: "u1",
        roles: ["assistant"],
      });
      expect(assistantOnly).toHaveLength(1);
      expect(assistantOnly[0]?.role).toBe("assistant");
    });
  });

  describe("count", () => {
    it("returns the total stored count for a userKey", async () => {
      const thread = createTestThread();
      for (let i = 0; i < 3; i++) {
        const msg = createTestMessage(`m${i}`, `msg ${i}`);
        msg.userKey = "u1";
        await api.append(thread, msg);
      }

      const total = await api.count({ userKey: "u1" });
      expect(total).toBe(3);
    });

    it("returns 0 for unknown userKey", async () => {
      expect(await api.count({ userKey: "nobody" })).toBe(0);
    });
  });

  describe("delete", () => {
    it("clears all stored entries for a userKey and reports the count", async () => {
      const thread = createTestThread();
      for (let i = 0; i < 4; i++) {
        const msg = createTestMessage(`m${i}`, `msg ${i}`);
        msg.userKey = "u1";
        await api.append(thread, msg);
      }

      const result = await api.delete({ userKey: "u1" });

      expect(result.deleted).toBe(4);
      expect(await api.count({ userKey: "u1" })).toBe(0);
      expect(await api.list({ userKey: "u1" })).toEqual([]);
    });

    it("returns deleted: 0 for unknown userKey", async () => {
      const result = await api.delete({ userKey: "nobody" });
      expect(result.deleted).toBe(0);
    });

    it("hides the tombstone from list/count after deletion", async () => {
      const thread = createTestThread();
      const msg = createTestMessage("m1", "before");
      msg.userKey = "u1";
      await api.append(thread, msg);
      await api.delete({ userKey: "u1" });

      // list and count both ignore the tombstone marker
      expect(await api.list({ userKey: "u1" })).toEqual([]);
      expect(await api.count({ userKey: "u1" })).toBe(0);
    });

    it("appends after delete behave as if the list were freshly empty", async () => {
      const thread = createTestThread();
      const before = createTestMessage("m1", "before");
      before.userKey = "u1";
      await api.append(thread, before);
      await api.delete({ userKey: "u1" });

      const after = createTestMessage("m2", "after");
      after.userKey = "u1";
      await api.append(thread, after);

      const list = await api.list({ userKey: "u1" });
      expect(list).toHaveLength(1);
      expect(list[0]?.text).toBe("after");
      expect(await api.count({ userKey: "u1" })).toBe(1);
    });

    it("does not double-count if delete is called twice", async () => {
      const thread = createTestThread();
      const msg = createTestMessage("m1", "hello");
      msg.userKey = "u1";
      await api.append(thread, msg);

      const first = await api.delete({ userKey: "u1" });
      const second = await api.delete({ userKey: "u1" });

      expect(first.deleted).toBe(1);
      expect(second.deleted).toBe(0);
    });

    it("preserves invariants when append/delete/append are interleaved without awaits", async () => {
      const thread = createTestThread();
      const before = createTestMessage("m0", "before");
      before.userKey = "u1";
      await api.append(thread, before);

      const post1 = createTestMessage("m1", "post1");
      post1.userKey = "u1";
      const post2 = createTestMessage("m2", "post2");
      post2.userKey = "u1";

      await Promise.all([
        api.append(thread, post1),
        api.delete({ userKey: "u1" }),
        api.append(thread, post2),
      ]);

      const list = await api.list({ userKey: "u1" });
      const count = await api.count({ userKey: "u1" });

      // count() and list() must agree — neither should leak the tombstone.
      expect(count).toBe(list.length);
      // Whatever survives is a real entry under the right userKey, and
      // never the pre-delete entry (which delete() must have evicted).
      for (const entry of list) {
        expect(entry.userKey).toBe("u1");
        expect(entry.text).not.toBe("before");
      }
      // Final size is bounded by the two post-delete appends.
      expect(count).toBeLessThanOrEqual(2);
    });
  });

  describe("maxPerUser eviction", () => {
    it("trims to maxPerUser via appendToList semantics", async () => {
      api = new TranscriptsApiImpl(state, { maxPerUser: 3 });
      const thread = createTestThread();

      for (let i = 0; i < 5; i++) {
        const msg = createTestMessage(`m${i}`, `msg ${i}`);
        msg.userKey = "u1";
        await api.append(thread, msg);
      }

      const list = await api.list({ userKey: "u1" });
      expect(list).toHaveLength(3);
      expect(list.map((m) => m.text)).toEqual(["msg 2", "msg 3", "msg 4"]);
    });
  });

  describe("formatted round-trip", () => {
    it("preserves mdast Root through state serialization", async () => {
      api = new TranscriptsApiImpl(state, { storeFormatted: true });
      const thread = createTestThread();
      const original = parseMarkdown("# Hello\n\n*world*");
      const msg = createTestMessage("m1", "Hello world");
      msg.userKey = "u1";
      msg.formatted = original;

      await api.append(thread, msg);
      const list = await api.list({ userKey: "u1" });

      expect(list[0]?.formatted).toEqual(original);
    });
  });
});
