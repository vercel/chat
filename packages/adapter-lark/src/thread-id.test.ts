import { ValidationError } from "@chat-adapter/shared";
import { describe, expect, it } from "vitest";
import {
  channelIdFromThreadId,
  decodeThreadId,
  deriveRootId,
  encodeThreadId,
} from "./thread-id";

describe("encodeThreadId", () => {
  it("produces lark:{chatId}:{rootId} format", () => {
    expect(encodeThreadId({ chatId: "oc_abc", rootId: "om_xyz" })).toBe(
      "lark:oc_abc:om_xyz"
    );
  });

  it("encodes empty rootId as openDM placeholder", () => {
    expect(encodeThreadId({ chatId: "ou_user123", rootId: "" })).toBe(
      "lark:ou_user123:"
    );
  });
});

describe("decodeThreadId", () => {
  it("round-trips encodeThreadId output", () => {
    const original = { chatId: "oc_abc", rootId: "om_xyz" };
    expect(decodeThreadId(encodeThreadId(original))).toEqual(original);
  });

  it("decodes openDM placeholder with empty rootId", () => {
    expect(decodeThreadId("lark:ou_user123:")).toEqual({
      chatId: "ou_user123",
      rootId: "",
    });
  });

  it("throws ValidationError on missing prefix", () => {
    expect(() => decodeThreadId("slack:oc_abc:om_xyz")).toThrow(
      ValidationError
    );
  });

  it("throws ValidationError on malformed string with no colons", () => {
    expect(() => decodeThreadId("lark")).toThrow(ValidationError);
  });

  it("throws ValidationError on empty chatId", () => {
    expect(() => decodeThreadId("lark::om_xyz")).toThrow(ValidationError);
  });
});

describe("deriveRootId", () => {
  it("prefers rootId over messageId", () => {
    expect(deriveRootId({ rootId: "om_root", messageId: "om_msg" })).toBe(
      "om_root"
    );
  });

  it("falls back to messageId when rootId is absent", () => {
    expect(deriveRootId({ messageId: "om_msg" })).toBe("om_msg");
  });

  it("ignores thread_id — it's a topic container, not a message id", () => {
    // `omt_*` is a topic container ID, not usable as a message ID. The
    // send API requires `om_*`; including `omt_*` breaks replyTo.
    expect(
      deriveRootId({
        threadId: "omt_topic",
        rootId: "om_root",
        messageId: "om_msg",
      })
    ).toBe("om_root");
    expect(deriveRootId({ threadId: "omt_topic", messageId: "om_msg" })).toBe(
      "om_msg"
    );
  });
});

describe("channelIdFromThreadId", () => {
  it("returns the chatId portion", () => {
    expect(channelIdFromThreadId("lark:oc_group1:om_msg")).toBe("oc_group1");
  });
});
