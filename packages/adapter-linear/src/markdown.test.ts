import { describe, expect, it } from "vitest";
import { LinearFormatConverter } from "./markdown";

describe("LinearFormatConverter", () => {
  const converter = new LinearFormatConverter();

  describe("toAst", () => {
    it("should parse plain text", () => {
      const ast = converter.toAst("Hello world");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    });

    it("should parse markdown with bold", () => {
      const ast = converter.toAst("**bold text**");
      expect(ast.type).toBe("root");
    });

    it("should parse markdown with italic", () => {
      const ast = converter.toAst("_italic text_");
      expect(ast.type).toBe("root");
    });

    it("should parse markdown with links", () => {
      const ast = converter.toAst("[Link](https://example.com)");
      expect(ast.type).toBe("root");
    });

    it("should parse markdown with code blocks", () => {
      const ast = converter.toAst("```\ncode\n```");
      expect(ast.type).toBe("root");
    });

    it("should parse markdown with lists", () => {
      const ast = converter.toAst("- item 1\n- item 2\n- item 3");
      expect(ast.type).toBe("root");
    });
  });

  describe("fromAst", () => {
    it("should stringify a simple AST", () => {
      const ast = converter.toAst("Hello world");
      const result = converter.fromAst(ast);
      expect(result).toContain("Hello world");
    });

    it("should round-trip bold text", () => {
      const ast = converter.toAst("**bold text**");
      const result = converter.fromAst(ast);
      expect(result).toContain("**bold text**");
    });

    it("should round-trip links", () => {
      const ast = converter.toAst("[Link](https://example.com)");
      const result = converter.fromAst(ast);
      expect(result).toContain("[Link](https://example.com)");
    });
  });

  describe("renderPostable", () => {
    it("should render a plain string", () => {
      const result = converter.renderPostable("Hello world");
      expect(result).toBe("Hello world");
    });

    it("should render a raw message", () => {
      const result = converter.renderPostable({ raw: "raw content" });
      expect(result).toBe("raw content");
    });

    it("should render a markdown message", () => {
      const result = converter.renderPostable({
        markdown: "**bold** text",
      });
      expect(result).toContain("bold");
    });

    it("should render an AST message", () => {
      const ast = converter.toAst("Hello from AST");
      const result = converter.renderPostable({ ast });
      expect(result).toContain("Hello from AST");
    });
  });
});
