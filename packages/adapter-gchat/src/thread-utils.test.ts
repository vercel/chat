import { threadIdContract } from "@chat-adapter/tests";
import { describe, expect, it } from "vitest";
import {
  decodeThreadId,
  encodeSpaceEventThreadId,
  encodeThreadId,
  type GoogleChatThreadId,
  isDMSpace,
  isDMThread,
  parseMessageName,
} from "./thread-utils";

const INVALID_MESSAGE_ID_REGEX = /Invalid Google Chat message id/;

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

describe("parseMessageName", () => {
  it("parses a server-assigned message name", () => {
    expect(
      parseMessageName("spaces/AAQAJ9CXYcg/messages/FGEOaAwNIcs.FGEOaAwNIcs")
    ).toEqual({
      spaceName: "spaces/AAQAJ9CXYcg",
      messageId: "FGEOaAwNIcs.FGEOaAwNIcs",
    });
  });

  it("parses a client-assigned message name", () => {
    expect(parseMessageName("spaces/ABC_1-2/messages/client-my_id-3")).toEqual({
      spaceName: "spaces/ABC_1-2",
      messageId: "client-my_id-3",
    });
  });

  it.each([
    "spaces/ABC/messages/../../OTHER/messages/x",
    "spaces/ABC/messages/./x",
    "spaces/ABC/messages/x/",
    "spaces/ABC/messages/",
    "spaces/ABC/messages/x?y=1",
    "spaces/ABC/messages/x#y",
    "spaces/ABC/messages/%2e%2e",
    "spaces/ABC/messages/a..b",
    "spaces//messages/x",
    "spaces/ABC/threads/x",
    "/spaces/ABC/messages/x",
    "https://chat.googleapis.com/v1/spaces/ABC/messages/x",
    "x",
    "",
  ])("rejects %j", (name) => {
    expect(() => parseMessageName(name)).toThrow(INVALID_MESSAGE_ID_REGEX);
  });
});

describe("isDMSpace", () => {
  it.each([
    ["legacy type DM", { type: "DM" }],
    ["spaceType DIRECT_MESSAGE", { spaceType: "DIRECT_MESSAGE" }],
    ["singleUserBotDm", { singleUserBotDm: true }],
  ])("should be true for %s", (_label, space) => {
    expect(isDMSpace(space)).toBe(true);
  });

  it.each([
    ["a room", { type: "ROOM", spaceType: "SPACE" }],
    ["a group chat", { type: "ROOM", spaceType: "GROUP_CHAT" }],
    ["singleUserBotDm false", { singleUserBotDm: false }],
    ["null fields", { type: null, spaceType: null, singleUserBotDm: null }],
    ["a space with only a name", { name: "spaces/ABC123" }],
    ["null", null],
    ["undefined", undefined],
  ])("should be false for %s", (_label, space) => {
    expect(isDMSpace(space)).toBe(false);
  });
});

describe("encodeSpaceEventThreadId", () => {
  it("should drop the thread and message for a DM", () => {
    expect(
      encodeSpaceEventThreadId({
        spaceName: "spaces/DM123",
        isDM: true,
        threadName: "spaces/DM123/threads/t1",
        messageName: "spaces/DM123/messages/m1",
      })
    ).toBe("gchat:spaces/DM123:dm");
  });

  it("should prefer the thread name outside a DM", () => {
    expect(
      encodeSpaceEventThreadId({
        spaceName: "spaces/ABC123",
        isDM: false,
        threadName: "spaces/ABC123/threads/xyz",
        messageName: "spaces/ABC123/messages/m1",
      })
    ).toBe("gchat:spaces/ABC123:c3BhY2VzL0FCQzEyMy90aHJlYWRzL3h5eg");
  });

  it("should fall back to the message name when there is no thread", () => {
    expect(
      encodeSpaceEventThreadId({
        spaceName: "spaces/ABC123",
        isDM: false,
        threadName: null,
        messageName: "spaces/ABC123/messages/m1",
      })
    ).toBe(
      `gchat:spaces/ABC123:${Buffer.from("spaces/ABC123/messages/m1").toString("base64url")}`
    );
  });

  it("should encode a space-only ID when there is no thread or message", () => {
    expect(
      encodeSpaceEventThreadId({ spaceName: "spaces/ABC123", isDM: false })
    ).toBe("gchat:spaces/ABC123");
  });
});
