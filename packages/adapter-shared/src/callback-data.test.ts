import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  decodeCallbackData,
  encodeCallbackData,
  isChatCallbackData,
} from "./callback-data";

const IMPORT_STATEMENT_PATTERN = /^\s*import\b/m;
const EXPORT_FROM_PATTERN =
  /^\s*export\s+(?:type\s+)?(?:\*|\{[^}]*\})[^;\n]*\bfrom\b/m;
const MODULE_LOADER_CALL_PATTERN = /\b(?:require|import)\s*\(/;

describe("callback-data module", () => {
  it("has no imports, re-exports, or module loader calls", async () => {
    const source = await readFile(
      new URL("./callback-data.ts", import.meta.url),
      "utf8"
    );
    expect(source).toContain("export function encodeCallbackData");
    expect(source).not.toMatch(IMPORT_STATEMENT_PATTERN);
    expect(source).not.toMatch(EXPORT_FROM_PATTERN);
    expect(source).not.toMatch(MODULE_LOADER_CALL_PATTERN);
  });
});

describe("isChatCallbackData", () => {
  it("detects the chat: prefix", () => {
    expect(isChatCallbackData(encodeCallbackData("go"))).toBe(true);
    expect(isChatCallbackData("LEGACY")).toBe(false);
  });
});

describe("encodeCallbackData", () => {
  it("encodes an action ID", () => {
    expect(encodeCallbackData("approve")).toBe('chat:{"a":"approve"}');
  });

  it("encodes an action ID with a value", () => {
    expect(encodeCallbackData("approve", "42")).toBe(
      'chat:{"a":"approve","v":"42"}'
    );
  });

  it("keeps an empty string value", () => {
    expect(encodeCallbackData("approve", "")).toBe(
      'chat:{"a":"approve","v":""}'
    );
  });
});

describe("decodeCallbackData", () => {
  it("round-trips encoded data", () => {
    expect(
      decodeCallbackData(encodeCallbackData("approve", "42"), "fallback")
    ).toEqual({ actionId: "approve", value: "42" });
  });

  it("round-trips an empty string value", () => {
    expect(
      decodeCallbackData(encodeCallbackData("approve", ""), "fallback")
    ).toEqual({ actionId: "approve", value: "" });
  });

  it("returns the fallback action ID for missing data", () => {
    expect(decodeCallbackData(undefined, "fallback")).toEqual({
      actionId: "fallback",
      value: undefined,
    });
    expect(decodeCallbackData("", "fallback")).toEqual({
      actionId: "fallback",
      value: undefined,
    });
  });

  it("passes through data without the prefix", () => {
    expect(decodeCallbackData("LEGACY_PAYLOAD", "fallback")).toEqual({
      actionId: "LEGACY_PAYLOAD",
      value: "LEGACY_PAYLOAD",
    });
  });

  it("passes through malformed JSON after the prefix", () => {
    expect(decodeCallbackData("chat:{nope", "fallback")).toEqual({
      actionId: "chat:{nope",
      value: "chat:{nope",
    });
  });

  it("passes through JSON without an action ID", () => {
    expect(decodeCallbackData('chat:{"v":"1"}', "fallback")).toEqual({
      actionId: 'chat:{"v":"1"}',
      value: 'chat:{"v":"1"}',
    });
  });

  it.each([
    'chat:{"a":"","v":"1"}',
    'chat:{"a":7,"v":"1"}',
  ])("passes through %j", (data) => {
    expect(decodeCallbackData(data, "fallback")).toEqual({
      actionId: data,
      value: data,
    });
  });

  it("drops a non-string value", () => {
    expect(decodeCallbackData('chat:{"a":"go","v":1}', "fallback")).toEqual({
      actionId: "go",
      value: undefined,
    });
  });
});
