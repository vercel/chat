import { parseMarkdown } from "chat";
import { describe, expect, it } from "vitest";
import { TwilioFormatConverter } from "./markdown";

const converter = new TwilioFormatConverter();

describe("TwilioFormatConverter", () => {
  describe("toAst / fromAst roundtrip", () => {
    it("roundtrips plain text", () => {
      const text = "Hello, world!";
      const ast = converter.toAst(text);
      const result = converter.fromAst(ast);
      expect(result).toBe(text);
    });

    it("roundtrips markdown with formatting", () => {
      const text = "**bold** and *italic*";
      const ast = converter.toAst(text);
      const result = converter.fromAst(ast);
      expect(result).toBe(text);
    });
  });

  describe("table conversion", () => {
    it("converts tables to ASCII code blocks", () => {
      const markdown = "| A | B |\n| --- | --- |\n| 1 | 2 |";
      const ast = parseMarkdown(markdown);
      const result = converter.fromAst(ast);
      expect(result).toContain("```");
      expect(result).toContain("A");
      expect(result).toContain("B");
    });
  });

  describe("renderPostable", () => {
    it("renders string messages", () => {
      expect(converter.renderPostable("hello")).toBe("hello");
    });

    it("renders raw messages", () => {
      expect(converter.renderPostable({ raw: "raw text" })).toBe("raw text");
    });

    it("renders markdown messages", () => {
      const result = converter.renderPostable({ markdown: "**bold**" });
      expect(result).toBe("**bold**");
    });

    it("renders ast messages", () => {
      const ast = parseMarkdown("hello world");
      const result = converter.renderPostable({ ast });
      expect(result).toBe("hello world");
    });
  });
});
