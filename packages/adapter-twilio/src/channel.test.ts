import { describe, expect, it } from "vitest";
import { parseChannelMetadata } from "./channel";

describe("parseChannelMetadata", () => {
  it("parses a plain object", () => {
    expect(parseChannelMetadata('{"type":"rcs"}')).toEqual({ type: "rcs" });
  });

  it("rejects arrays", () => {
    expect(parseChannelMetadata('["rcs"]')).toBeUndefined();
  });

  it("rejects null and invalid JSON", () => {
    expect(parseChannelMetadata("null")).toBeUndefined();
    expect(parseChannelMetadata("not-json")).toBeUndefined();
    expect(parseChannelMetadata(undefined)).toBeUndefined();
  });
});
