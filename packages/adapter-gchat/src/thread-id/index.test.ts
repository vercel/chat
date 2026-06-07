import { describe, expect, it } from "vitest";
import {
  decodeThreadId,
  encodeThreadId,
  GoogleChatThreadIdError,
  isDMThread,
} from ".";

describe("Google Chat thread-id primitives", () => {
  it("encodes and decodes threaded space IDs", () => {
    const threadId = encodeThreadId({
      spaceName: "spaces/AAAA",
      threadName: "spaces/AAAA/threads/thread-1",
    });

    expect(decodeThreadId(threadId)).toEqual({
      isDM: false,
      spaceName: "spaces/AAAA",
      threadName: "spaces/AAAA/threads/thread-1",
    });
  });

  it("preserves direct-message marker", () => {
    const threadId = encodeThreadId({
      isDM: true,
      spaceName: "spaces/DM",
    });

    expect(isDMThread(threadId)).toBe(true);
    expect(decodeThreadId(threadId)).toEqual({
      isDM: true,
      spaceName: "spaces/DM",
      threadName: undefined,
    });
  });

  it("throws a local error for invalid IDs", () => {
    expect(() => decodeThreadId("slack:C:T")).toThrow(GoogleChatThreadIdError);
  });
});
