import { describe, expect, it } from "vitest";
import { isPhoneNumber, SignalIdentityMap } from "./identity";

describe("isPhoneNumber", () => {
  it("accepts valid E.164 phone numbers", () => {
    expect(isPhoneNumber("+15551234567")).toBe(true);
    expect(isPhoneNumber("+491234567890")).toBe(true);
    expect(isPhoneNumber("+8612345678901")).toBe(true);
  });

  it("rejects invalid formats", () => {
    expect(isPhoneNumber("15551234567")).toBe(false);
    expect(isPhoneNumber("+0123456789")).toBe(false);
    expect(isPhoneNumber("+1")).toBe(false);
    expect(isPhoneNumber("")).toBe(false);
    expect(isPhoneNumber("uuid-string")).toBe(false);
    expect(isPhoneNumber("+abc")).toBe(false);
  });
});

describe("SignalIdentityMap", () => {
  describe("canonicalize", () => {
    it("returns the value itself when no aliases exist", () => {
      const map = new SignalIdentityMap();
      expect(map.canonicalize("+15551234567")).toBe("+15551234567");
    });

    it("returns empty string for empty input", () => {
      const map = new SignalIdentityMap();
      expect(map.canonicalize("")).toBe("");
    });

    it("trims whitespace", () => {
      const map = new SignalIdentityMap();
      expect(map.canonicalize("  +15551234567  ")).toBe("+15551234567");
    });

    it("resolves a UUID to a phone number after alias registration", () => {
      const map = new SignalIdentityMap();
      map.registerAliases("+15551234567", "uuid-abc-123");

      expect(map.canonicalize("uuid-abc-123")).toBe("+15551234567");
      expect(map.canonicalize("+15551234567")).toBe("+15551234567");
    });

    it("follows alias chains", () => {
      const map = new SignalIdentityMap();
      map.registerAliases("+15551234567", "uuid-1");
      map.registerAliases("+15551234567", "uuid-2");

      expect(map.canonicalize("uuid-1")).toBe("+15551234567");
      expect(map.canonicalize("uuid-2")).toBe("+15551234567");
    });

    it("detects cycles and returns the cycle entry point", () => {
      const map = new SignalIdentityMap();

      // Manually create a cycle scenario:
      // Register A -> B
      map.registerAliases("A", "B");
      // Register B -> A (creates cycle)
      map.registerAliases("B", "A");

      // Should not infinite loop — returns the value it lands on when cycle detected
      const result = map.canonicalize("A");
      expect(["A", "B"]).toContain(result);
    });

    it("handles self-referencing aliases", () => {
      const map = new SignalIdentityMap();
      map.registerAliases("+15551234567");

      expect(map.canonicalize("+15551234567")).toBe("+15551234567");
    });
  });

  describe("registerAliases", () => {
    it("returns undefined when no identifiers are provided", () => {
      const map = new SignalIdentityMap();
      expect(map.registerAliases()).toBeUndefined();
    });

    it("returns undefined when all identifiers are null or undefined", () => {
      const map = new SignalIdentityMap();
      expect(map.registerAliases(null, undefined, "")).toBeUndefined();
    });

    it("returns the canonical identifier", () => {
      const map = new SignalIdentityMap();
      const result = map.registerAliases("+15551234567", "uuid-abc");

      expect(result).toBe("+15551234567");
    });

    it("prefers phone numbers as canonical", () => {
      const map = new SignalIdentityMap();
      const result = map.registerAliases("uuid-abc", "+15551234567");

      expect(result).toBe("+15551234567");
    });

    it("uses the first identifier when no phone number is present", () => {
      const map = new SignalIdentityMap();
      const result = map.registerAliases("uuid-abc", "uuid-def");

      expect(result).toBe("uuid-abc");
    });

    it("updates aliases when phone number becomes available", () => {
      const map = new SignalIdentityMap();

      // First seen with UUID only
      map.registerAliases("uuid-abc");
      expect(map.canonicalize("uuid-abc")).toBe("uuid-abc");

      // Later seen with phone number
      map.registerAliases("+15551234567", "uuid-abc");
      expect(map.canonicalize("uuid-abc")).toBe("+15551234567");
    });

    it("skips null and undefined identifiers", () => {
      const map = new SignalIdentityMap();
      const result = map.registerAliases(
        null,
        "+15551234567",
        undefined,
        "uuid-abc"
      );

      expect(result).toBe("+15551234567");
      expect(map.canonicalize("uuid-abc")).toBe("+15551234567");
    });

    it("handles three-way alias registration", () => {
      const map = new SignalIdentityMap();
      map.registerAliases("+15551234567", "uuid-abc", "username.01");

      expect(map.canonicalize("uuid-abc")).toBe("+15551234567");
      expect(map.canonicalize("username.01")).toBe("+15551234567");
      expect(map.canonicalize("+15551234567")).toBe("+15551234567");
    });
  });
});
