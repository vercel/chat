import {
  link,
  paragraph,
  parseMarkdown,
  type Root,
  root,
  stringifyMarkdown,
  text,
} from "chat";
import { describe, expect, it } from "vitest";
import { literalTextHandlers, unwrapBareLinks } from "./literal-text";

function render(ast: Root): string {
  return stringifyMarkdown(unwrapBareLinks(ast), {
    handlers: literalTextHandlers,
  }).trim();
}

describe("literalTextHandlers", () => {
  it.each([
    ["Use snake_case_name", "Use snake_case_name"],
    ["Price: 3 * 4 = 12", "Price: 3 * 4 = 12"],
    ["#1 priority", "#1 priority"],
    [String.raw`\*not bold\*`, "*not bold*"],
    ["line one  \nline two", "line one\nline two"],
  ])("writes the literal text in %s as written", (markdown, expected) => {
    expect(render(parseMarkdown(markdown))).toBe(expected);
  });
});

describe("unwrapBareLinks", () => {
  it.each([
    [
      "Track it at https://example.com/track",
      "Track it at https://example.com/track",
    ],
    ["https://example.com/_private_/x", "https://example.com/_private_/x"],
    ["Email help@example.com", "Email help@example.com"],
    ["Go to www.example.com", "Go to www.example.com"],
    ["Go to WWW.example.com", "Go to WWW.example.com"],
    ["Go to Www.Example.com", "Go to Www.Example.com"],
  ])("unwraps the bare address in %s", (markdown, expected) => {
    expect(render(parseMarkdown(markdown))).toBe(expected);
  });

  it("keeps links with their own label as links", () => {
    const markdown =
      "[the docs](https://example.com/docs) or [example.com](http://example.com)";
    expect(render(parseMarkdown(markdown))).toBe(markdown);

    const ast = root([
      paragraph([
        link("https://example.com", [
          text("https://example.com"),
          text(" docs"),
        ]),
      ]),
    ]);
    expect(render(ast)).toBe("[https://example.com docs](https://example.com)");
  });

  it.each([
    "[**https://example.com**](https://example.com)",
    "[`https://example.com`](https://example.com)",
  ])("keeps %s as a link because its only child isn't text", (markdown) => {
    expect(render(parseMarkdown(markdown))).toBe(markdown);
  });

  it("doesn't change the AST it's given", () => {
    const ast = root([
      paragraph([link("https://example.com", [text("https://example.com")])]),
    ]);
    const before = structuredClone(ast);

    const result = unwrapBareLinks(ast);

    expect(ast).toEqual(before);
    expect(result).toEqual(root([paragraph([text("https://example.com")])]));
  });
});
