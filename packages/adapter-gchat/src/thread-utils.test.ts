import { describe, expect, it } from "vitest";
import { decodeThreadId, encodeThreadId, isDMThread } from "./thread-utils";

describe("Thread ID Encoding/Decoding", () => {
  describe("encodeThreadId", () => {
    it("should encode space name only", () => {
      const id = encodeThreadId({ spaceName: "spaces/ABC123" });
      expect(id).toBe("gchat:spaces/ABC123");
    });

    it("should encode space name with thread name", () => {
      const id = encodeThreadId({
        spaceName: "spaces/ABC123",
        threadName: "spaces/ABC123/threads/xyz",
      });
      expect(id.startsWith("gchat:spaces/ABC123:")).toBe(true);
      // Should contain base64url encoded thread name
      const parts = id.split(":");
      expect(parts.length).toBeGreaterThanOrEqual(3);
    });

    it("should add :dm suffix for DM threads", () => {
      const id = encodeThreadId({
        spaceName: "spaces/DM123",
        isDM: true,
      });
      expect(id).toBe("gchat:spaces/DM123:dm");
    });

    it("should add :dm suffix with thread name", () => {
      const id = encodeThreadId({
        spaceName: "spaces/DM123",
        threadName: "spaces/DM123/threads/t1",
        isDM: true,
      });
      expect(id.endsWith(":dm")).toBe(true);
    });
  });

  describe("decodeThreadId", () => {
    it("should decode space-only thread ID", () => {
      const result = decodeThreadId("gchat:spaces/ABC123");
      expect(result.spaceName).toBe("spaces/ABC123");
      expect(result.threadName).toBeUndefined();
      expect(result.isDM).toBe(false);
    });

    it("should decode DM thread ID", () => {
      const result = decodeThreadId("gchat:spaces/DM123:dm");
      expect(result.spaceName).toBe("spaces/DM123");
      expect(result.isDM).toBe(true);
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

  describe("round-trip", () => {
    it("should round-trip space-only", () => {
      const original = { spaceName: "spaces/ABC" };
      const encoded = encodeThreadId(original);
      const decoded = decodeThreadId(encoded);
      expect(decoded.spaceName).toBe(original.spaceName);
    });

    it("should round-trip with thread name", () => {
      const original = {
        spaceName: "spaces/ABC",
        threadName: "spaces/ABC/threads/xyz",
      };
      const encoded = encodeThreadId(original);
      const decoded = decodeThreadId(encoded);
      expect(decoded.spaceName).toBe(original.spaceName);
      expect(decoded.threadName).toBe(original.threadName);
    });

    it("should round-trip DM", () => {
      const original = { spaceName: "spaces/DM1", isDM: true };
      const encoded = encodeThreadId(original);
      const decoded = decodeThreadId(encoded);
      expect(decoded.spaceName).toBe(original.spaceName);
      expect(decoded.isDM).toBe(true);
    });
  });

  describe("isDMThread", () => {
    it("should return true for DM thread IDs", () => {
      expect(isDMThread("gchat:spaces/DM123:dm")).toBe(true);
    });

    it("should return false for non-DM thread IDs", () => {
      expect(isDMThread("gchat:spaces/ABC123")).toBe(false);
    });

    it("should return false for thread IDs with :dm in middle", () => {
      expect(isDMThread("gchat:dm:spaces/ABC")).toBe(false);
    });
  });
});
