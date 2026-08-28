import { describe, expect, it } from "vitest";
import { normalizeCodeFences } from "./code-fences";

describe("normalizeCodeFences", () => {
  it("puts fences on their own lines so the first code line survives", () => {
    expect(normalizeCodeFences("```first line\nsecond line```")).toBe(
      "```\nfirst line\nsecond line\n```"
    );
  });

  it("separates fences from surrounding text", () => {
    expect(normalizeCodeFences("before ```code``` after")).toBe(
      "before \n```\ncode\n```\n after"
    );
  });

  it("returns text without fences unchanged", () => {
    expect(normalizeCodeFences("plain text")).toBe("plain text");
  });

  it("keeps an unpaired ``` as literal text", () => {
    expect(normalizeCodeFences("use ``` to fence code")).toBe(
      "use ``` to fence code"
    );
  });

  it("keeps a ``` inside an inline code span as literal text", () => {
    expect(normalizeCodeFences("`use ``` here`")).toBe("`use ``` here`");
  });

  it("keeps a ``` on a blockquote line as literal text", () => {
    expect(normalizeCodeFences("> a ```c``` b")).toBe("> a ```c``` b");
  });

  it("escapes trailing text that would become a block construct", () => {
    expect(normalizeCodeFences("```x``` > note")).toBe(
      "```\nx\n```\n \\> note"
    );
    expect(normalizeCodeFences("```x``` # heading")).toBe(
      "```\nx\n```\n \\# heading"
    );
    expect(normalizeCodeFences("```x``` - item")).toBe(
      "```\nx\n```\n \\- item"
    );
    expect(normalizeCodeFences("```x``` 1. item")).toBe(
      "```\nx\n```\n 1\\. item"
    );
    expect(normalizeCodeFences("```a``` ``` b")).toBe("```\na\n```\n \\``` b");
  });

  it("collapses trailing indentation that would become indented code", () => {
    expect(normalizeCodeFences("see ```x```\tresult is 5")).toBe(
      "see \n```\nx\n```\n result is 5"
    );
    expect(normalizeCodeFences("see ```x```     result is 5")).toBe(
      "see \n```\nx\n```\n result is 5"
    );
  });

  it("applies convertText to text segments only", () => {
    expect(
      normalizeCodeFences("*a* ```*b*``` *c*", {
        convertText: (text) => text.replace(/\*/g, "**"),
      })
    ).toBe("**a** \n```\n*b*\n```\n **c**");
  });

  it("applies convertText on the fenceless fast path", () => {
    expect(
      normalizeCodeFences("*a*", {
        convertText: (text) => text.replace(/\*/g, "**"),
      })
    ).toBe("**a**");
  });

  it("applies convertCode to fence content", () => {
    expect(
      normalizeCodeFences("```<@U1>```", {
        convertCode: (code) => code.replace("<@U1>", "@jane"),
      })
    ).toBe("```\n@jane\n```");
  });
});
