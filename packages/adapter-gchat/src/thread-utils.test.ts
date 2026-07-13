import { threadIdContract } from "@chat-adapter/tests";
import { describe, expect, it } from "vitest";
import {
  decodeThreadId,
  encodeThreadId,
  type GoogleChatThreadId,
  isDMThread,
} from "./thread-utils";

threadIdContract<GoogleChatThreadId>({
  name: "gchat",
  encode: (d) => encodeThreadId(d),
  decode: (id) => decodeThreadId(id),
  cases: [
    {
      decoded: { spaceName: "spaces/ABC123", isDM: false },
      encoded: "gchat:spaces/ABC123",
    },
    {
      decoded: {
        spaceName: "spaces/ABC123",
        threadName: "spaces/ABC123/threads/xyz",
        isDM: false,
      },
      // base64url of the thread name segment
      encoded: "gchat:spaces/ABC123:c3BhY2VzL0FCQzEyMy90aHJlYWRzL3h5eg",
    },
    {
      decoded: { spaceName: "spaces/DM123", isDM: true },
      encoded: "gchat:spaces/DM123:dm",
    },
    {
      decoded: {
        spaceName: "spaces/DM123",
        threadName: "spaces/DM123/threads/t1",
        isDM: true,
      },
      encoded: "gchat:spaces/DM123:c3BhY2VzL0RNMTIzL3RocmVhZHMvdDE:dm",
    },
  ],
  isDM: {
    fn: (id) => isDMThread(id),
    dmThreadId: "gchat:spaces/DM123:dm",
    nonDmThreadId: "gchat:spaces/ABC123",
  },
});

describe("Thread ID Encoding/Decoding", () => {
  describe("decodeThreadId", () => {
    it("should decode a base64url-encoded thread name segment", () => {
      const threadName = "spaces/ABC123/threads/xyz";
      const segment = Buffer.from(threadName).toString("base64url");
      const result = decodeThreadId(`gchat:spaces/ABC123:${segment}`);
      expect(result.spaceName).toBe("spaces/ABC123");
      expect(result.threadName).toBe(threadName);
    });

    it("should throw on invalid format", () => {
      expect(() => decodeThreadId("invalid")).toThrow(
        "Invalid Google Chat thread ID"
      );
    });

    it("should throw on wrong prefix", () => {
      expect(() => decodeThreadId("slack:C123:1234")).toThrow(
        "Invalid Google Chat thread ID"
      );
    });
  });

  describe("isDMThread", () => {
    it("should return false for thread IDs with :dm in the middle", () => {
      expect(isDMThread("gchat:dm:spaces/ABC")).toBe(false);
    });
  });
});
