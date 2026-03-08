import { parseMarkdown } from "chat";
import { describe, expect, it } from "vitest";
import { TelnyxFormatConverter } from "./markdown";

describe("TelnyxFormatConverter", () => {
  const converter = new TelnyxFormatConverter();

  describe("fromAst", () => {
    it("converts plain text", () => {
      const ast = parseMarkdown("Hello world");
      expect(converter.fromAst(ast)).toBe("Hello world");
    });

    it("strips bold/italic formatting into plain text output", () => {
      const ast = parseMarkdown("**bold** and *italic*");
      const result = converter.fromAst(ast);
      expect(result).toContain("bold");
      expect(result).toContain("italic");
    });

    it("converts tables to ASCII", () => {
      const ast = parseMarkdown(
        "| Name | Value |\n| --- | --- |\n| a | 1 |\n| b | 2 |"
      );
      const result = converter.fromAst(ast);
      expect(result).toContain("Name");
      expect(result).toContain("Value");
    });
  });

  describe("toAst", () => {
    it("parses plain text to AST", () => {
      const ast = converter.toAst("Hello world");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    });
  });

  describe("renderPostable", () => {
    it("handles string messages", () => {
      expect(converter.renderPostable("hello")).toBe("hello");
    });

    it("handles raw messages", () => {
      expect(converter.renderPostable({ raw: "raw text" })).toBe("raw text");
    });

    it("handles markdown messages", () => {
      const result = converter.renderPostable({ markdown: "**bold**" });
      expect(result).toContain("bold");
    });

    it("handles AST messages", () => {
      const ast = parseMarkdown("test message");
      const result = converter.renderPostable({ ast });
      expect(result).toContain("test message");
    });
  });
});
