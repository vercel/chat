import { describe, expect, it } from "vitest";
import { getUserNameFromProfileUrl } from "./utils";

describe("getUserNameFromProfileUrl", () => {
  it("extracts the profile name for any workspace slug", () => {
    expect(
      getUserNameFromProfileUrl(
        "https://linear.app/acme-workspace/profiles/Bob"
      )
    ).toBe("Bob");
  });

  it("ignores trailing slash, query, and hash", () => {
    expect(
      getUserNameFromProfileUrl(
        "https://linear.app/acme-workspace/profiles/bob-bob/?foo=bar#details"
      )
    ).toBe("bob-bob");
  });

  it("falls back to the original string when the URL does not contain a profile path", () => {
    expect(
      getUserNameFromProfileUrl(
        "https://linear.app/acme-workspace/issues/ABC-1"
      )
    ).toBe("");
  });
});
