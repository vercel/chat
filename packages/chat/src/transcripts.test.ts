import { describe, expect, it } from "vitest";
import { UserHistoryApiImpl } from "./history/user";
import { TranscriptsApiImpl } from "./transcripts";

describe("TranscriptsApiImpl (deprecated alias)", () => {
  it("re-exports UserHistoryApiImpl under the legacy name", () => {
    expect(TranscriptsApiImpl).toBe(UserHistoryApiImpl);
  });
});
