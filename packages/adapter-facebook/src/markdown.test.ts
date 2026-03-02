import { describe, expect, it } from "vitest";
import { FacebookFormatConverter } from "./markdown";

const converter = new FacebookFormatConverter();

describe("FacebookFormatConverter", () => {
  describe("toAst", () => {
    it("parses plain text", () => {
      const ast = converter.toAst("Hello world");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    });

    it("parses markdown bold", () => {
      const ast = converter.toAst("**bold**");
      expect(ast.type).toBe("root");
    });

    it("handles empty text", () => {
      const ast = converter.toAst("");
      expect(ast.type).toBe("root");
    });
  });

  describe("fromAst", () => {
    it("roundtrips plain text", () => {
      const text = "Hello world";
      const ast = converter.toAst(text);
      const result = converter.fromAst(ast);
      expect(result).toBe(text);
    });

    it("roundtrips markdown formatting", () => {
      const text = "**bold** and *italic*";
      const ast = converter.toAst(text);
      const result = converter.fromAst(ast);
      expect(result).toContain("bold");
      expect(result).toContain("italic");
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
      expect(result).toContain("bold");
    });
  });

  describe("extractPlainText", () => {
    it("extracts plain text from markdown", () => {
      const result = converter.extractPlainText("**bold** text");
      expect(result).toContain("bold");
      expect(result).toContain("text");
    });
  });
});
