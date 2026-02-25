import { describe, expect, it } from "vitest";
import { decodeThreadId, encodeThreadId, isDMThread } from "./thread-utils";

describe("Thread ID Encoding/Decoding", () => {
  describe("encodeThreadId", () => {
    it("should encode chat ID only", () => {
      const id = encodeThreadId({ chatId: "oc_abc123" });
      expect(id).toBe("feishu:oc_abc123");
    });

    it("should encode chat ID with root ID", () => {
      const id = encodeThreadId({
        chatId: "oc_abc123",
        rootId: "om_msg456",
      });
      expect(id).toBe("feishu:oc_abc123:om_msg456");
    });

    it("should add :dm suffix for DM threads", () => {
      const id = encodeThreadId({ chatId: "oc_dm123", isDM: true });
      expect(id).toBe("feishu:oc_dm123:dm");
    });

    it("should add :dm suffix with root ID", () => {
      const id = encodeThreadId({
        chatId: "oc_dm123",
        rootId: "om_msg789",
        isDM: true,
      });
      expect(id).toBe("feishu:oc_dm123:om_msg789:dm");
    });
  });

  describe("decodeThreadId", () => {
    it("should decode chat-only thread ID", () => {
      const result = decodeThreadId("feishu:oc_abc123");
      expect(result.chatId).toBe("oc_abc123");
      expect(result.rootId).toBeUndefined();
      expect(result.isDM).toBe(false);
    });

    it("should decode thread ID with root ID", () => {
      const result = decodeThreadId("feishu:oc_abc123:om_msg456");
      expect(result.chatId).toBe("oc_abc123");
      expect(result.rootId).toBe("om_msg456");
      expect(result.isDM).toBe(false);
    });

    it("should decode DM thread ID", () => {
      const result = decodeThreadId("feishu:oc_dm123:dm");
      expect(result.chatId).toBe("oc_dm123");
      expect(result.rootId).toBeUndefined();
      expect(result.isDM).toBe(true);
    });

    it("should decode DM thread ID with root ID", () => {
      const result = decodeThreadId("feishu:oc_dm123:om_msg789:dm");
      expect(result.chatId).toBe("oc_dm123");
      expect(result.rootId).toBe("om_msg789");
      expect(result.isDM).toBe(true);
    });

    it("should throw on invalid format", () => {
      expect(() => decodeThreadId("invalid")).toThrow(
        "Invalid Feishu thread ID"
      );
    });

    it("should throw on wrong prefix", () => {
      expect(() => decodeThreadId("slack:C123:1234")).toThrow(
        "Invalid Feishu thread ID"
      );
    });
  });

  describe("round-trip", () => {
    it("should round-trip chat-only", () => {
      const original = { chatId: "oc_abc" };
      const decoded = decodeThreadId(encodeThreadId(original));
      expect(decoded.chatId).toBe(original.chatId);
      expect(decoded.rootId).toBeUndefined();
    });

    it("should round-trip with root ID", () => {
      const original = { chatId: "oc_abc", rootId: "om_xyz" };
      const decoded = decodeThreadId(encodeThreadId(original));
      expect(decoded.chatId).toBe(original.chatId);
      expect(decoded.rootId).toBe(original.rootId);
    });

    it("should round-trip DM", () => {
      const original = { chatId: "oc_dm1", isDM: true };
      const decoded = decodeThreadId(encodeThreadId(original));
      expect(decoded.chatId).toBe(original.chatId);
      expect(decoded.isDM).toBe(true);
    });

    it("should round-trip DM with root ID", () => {
      const original = { chatId: "oc_dm1", rootId: "om_r1", isDM: true };
      const decoded = decodeThreadId(encodeThreadId(original));
      expect(decoded.chatId).toBe(original.chatId);
      expect(decoded.rootId).toBe(original.rootId);
      expect(decoded.isDM).toBe(true);
    });
  });

  describe("isDMThread", () => {
    it("should return true for DM thread IDs", () => {
      expect(isDMThread("feishu:oc_dm123:dm")).toBe(true);
    });

    it("should return true for DM thread IDs with root ID", () => {
      expect(isDMThread("feishu:oc_dm123:om_msg789:dm")).toBe(true);
    });

    it("should return false for non-DM thread IDs", () => {
      expect(isDMThread("feishu:oc_abc123")).toBe(false);
    });

    it("should return false for non-DM thread IDs with root ID", () => {
      expect(isDMThread("feishu:oc_abc123:om_msg456")).toBe(false);
    });
  });
});
