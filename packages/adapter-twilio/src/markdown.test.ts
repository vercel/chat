import { link, paragraph, parseMarkdown, root, text } from "chat";
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

  it.each([
    ["Use snake_case_name", "Use snake_case_name"],
    ["Price: 3 * 4 = 12", "Price: 3 * 4 = 12"],
    ["#1 priority", "#1 priority"],
    ["(~80 % easy)", "(~80 % easy)"],
    [String.raw`\*not bold\*`, "*not bold*"],
    ["line one  \nline two", "line one\nline two"],
  ])("sends literal text in %s as written", (markdown, expected) => {
    expect(converter.renderPostable({ markdown })).toBe(expected);
  });

  it.each([
    [
      "Track it at https://example.com/track",
      "Track it at https://example.com/track",
    ],
    ["https://example.com/_private_/x", "https://example.com/_private_/x"],
    ["Email help@example.com", "Email help@example.com"],
    ["Go to www.example.com", "Go to www.example.com"],
  ])("sends the bare address in %s as written", (markdown, expected) => {
    expect(converter.renderPostable({ markdown })).toBe(expected);
  });

  it("keeps links with their own label as Markdown links", () => {
    const markdown =
      "[the docs](https://example.com/docs) or [example.com](http://example.com)";
    expect(converter.renderPostable({ markdown })).toBe(markdown);

    const ast = root([
      paragraph([
        link("https://example.com", [
          text("https://example.com"),
          text(" docs"),
        ]),
      ]),
    ]);
    expect(converter.fromAst(ast)).toBe(
      "[https://example.com docs](https://example.com)"
    );
  });
});
