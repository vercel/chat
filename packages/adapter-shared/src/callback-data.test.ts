import { describe, expect, it } from "vitest";
import {
  decodeCallbackData,
  encodeCallbackData,
  isChatCallbackData,
} from "./callback-data";

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
});

describe("decodeCallbackData", () => {
  it("round-trips encoded data", () => {
    expect(
      decodeCallbackData(encodeCallbackData("approve", "42"), "fallback")
    ).toEqual({ actionId: "approve", value: "42" });
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

  it("drops a non-string value", () => {
    expect(decodeCallbackData('chat:{"a":"go","v":1}', "fallback")).toEqual({
      actionId: "go",
      value: undefined,
    });
  });
});
