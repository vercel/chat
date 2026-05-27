import { parseMarkdown } from "chat";
import { describe, expect, it } from "vitest";
import { TwilioFormatConverter } from "./markdown";

describe("TwilioFormatConverter", () => {
  const converter = new TwilioFormatConverter();

  it("keeps raw strings plain", () => {
    expect(converter.renderPostable("hello")).toBe("hello");
  });

  it("converts markdown to Twilio text", () => {
    expect(converter.renderPostable({ markdown: "**hello**" })).toBe(
      "**hello**"
    );
  });

  it("renders tables as ascii blocks", () => {
    const text = converter.fromAst(
      parseMarkdown("| name | age |\n| --- | --- |\n| Ada | 36 |")
    );

    expect(text).toContain("name | age");
    expect(text).not.toContain("| --- |");
  });
});
