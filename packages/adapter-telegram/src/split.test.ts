import { parseMarkdown, type Root, stringifyMarkdown } from "chat";
import { describe, expect, it } from "vitest";
import { TelegramFormatConverter } from "./markdown";
import { splitMarkdownAst, splitText } from "./split";

const converter = new TelegramFormatConverter();

function fitsRendered(limit: number): (root: Root) => boolean {
  return (root) => converter.fromAst(root).length <= limit;
}

describe("splitText", () => {
  it("returns one part when the text fits", () => {
    expect(splitText("short", (value) => value.length <= 10)).toEqual([
      "short",
    ]);
  });

  it("breaks at paragraph, then line, then word boundaries", () => {
    const fits = (value: string) => value.length <= 12;

    expect(splitText("aaaa bbbb\n\ncccc", fits)).toEqual(["aaaa bbbb", "cccc"]);
    expect(splitText("aaaa bbbb\ncccc", fits)).toEqual(["aaaa bbbb", "cccc"]);
    expect(splitText("aaaa bbbb cccc", fits)).toEqual(["aaaa bbbb", "cccc"]);
  });

  it("hard-breaks text without a usable boundary", () => {
    expect(splitText("a".repeat(25), (value) => value.length <= 10)).toEqual([
      "a".repeat(10),
      "a".repeat(10),
      "a".repeat(5),
    ]);
  });

  it("does not split a surrogate pair", () => {
    const parts = splitText("aa😀😀", (value) => value.length <= 3);
    expect(parts).toEqual(["aa", "😀", "😀"]);
  });
});

describe("splitMarkdownAst", () => {
  it("returns the root unchanged when it fits", () => {
    const root = parseMarkdown("hello");
    expect(splitMarkdownAst(root, fitsRendered(100))).toEqual([root]);
  });

  it("packs top-level blocks into parts without losing content", () => {
    const markdown = Array.from(
      { length: 40 },
      (_, index) => `## Section ${index + 1}\n\n- value_${index}.`
    ).join("\n\n");

    const parts = splitMarkdownAst(parseMarkdown(markdown), fitsRendered(200));

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(converter.fromAst(part).length).toBeLessThanOrEqual(200);
    }
    expect(
      parts.map((part) => stringifyMarkdown(part).trim()).join("\n\n")
    ).toBe(stringifyMarkdown(parseMarkdown(markdown)).trim());
  });

  it("reopens formatting when a long bold run is split", () => {
    const words = Array.from({ length: 60 }, (_, index) => `word${index}`);
    const parts = splitMarkdownAst(
      parseMarkdown(`**${words.join(" ")}**`),
      fitsRendered(100)
    );

    expect(parts.length).toBeGreaterThan(1);
    const rendered = parts.map((part) => converter.fromAst(part));
    for (const text of rendered) {
      expect(text.length).toBeLessThanOrEqual(100);
      expect(text.startsWith("*")).toBe(true);
      expect(text.endsWith("*")).toBe(true);
    }
    expect(rendered.map((text) => text.slice(1, -1)).join(" ")).toBe(
      words.join(" ")
    );
  });

  it("splits a long code block into complete code blocks at line breaks", () => {
    const lines = Array.from({ length: 50 }, (_, index) => `line ${index}`);
    const parts = splitMarkdownAst(
      parseMarkdown(`\`\`\`ts\n${lines.join("\n")}\n\`\`\``),
      fitsRendered(120)
    );

    expect(parts.length).toBeGreaterThan(1);
    const values: string[] = [];
    for (const part of parts) {
      const [code] = part.children;
      expect(code?.type).toBe("code");
      if (code?.type === "code") {
        expect(code.lang).toBe("ts");
        values.push(code.value);
      }
      expect(converter.fromAst(part).length).toBeLessThanOrEqual(120);
    }
    expect(values.join("\n")).toBe(lines.join("\n"));
  });

  it("continues ordered list numbering across parts", () => {
    const markdown = Array.from(
      { length: 30 },
      (_, index) => `${index + 1}. item number ${index + 1}`
    ).join("\n");

    const parts = splitMarkdownAst(parseMarkdown(markdown), fitsRendered(150));

    expect(parts.length).toBeGreaterThan(1);
    const lines = parts.flatMap((part) => converter.fromAst(part).split("\n"));
    expect(lines).toEqual(
      Array.from(
        { length: 30 },
        (_, index) => `${index + 1}\\. item number ${index + 1}`
      )
    );
  });
});
