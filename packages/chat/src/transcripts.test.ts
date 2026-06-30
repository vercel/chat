import { describe, expect, it } from "vitest";
import { UserHistoryApiImpl } from "./history/user";
import type { MockStateAdapter } from "./mock-adapter";
import { createMockState, createTestMessage } from "./mock-adapter";
import { TranscriptsApiImpl } from "./transcripts";

describe("TranscriptsApiImpl (deprecated alias)", () => {
  it("re-exports UserHistoryApiImpl under the legacy name", () => {
    expect(TranscriptsApiImpl).toBe(UserHistoryApiImpl);
  });

  it("behaves identically to UserHistoryApiImpl at runtime", async () => {
    const state: MockStateAdapter = createMockState();
    const api = new TranscriptsApiImpl(state, {});
    const msg = createTestMessage("m1", "hello");
    msg.userKey = "u1";

    const thread = {
      adapter: { name: "slack" },
      id: "slack:C123:1234.5678",
    } as const;

    const stored = await api.append(thread, msg);
    expect(stored?.text).toBe("hello");

    const list = await api.list({ userKey: "u1" });
    expect(list).toHaveLength(1);
    expect(list[0]?.text).toBe("hello");
  });
});
