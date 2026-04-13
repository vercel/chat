import { describe, expect, it } from "vitest";
import { TwitterFormatConverter } from "./markdown";

describe("TwitterFormatConverter", () => {
  const converter = new TwitterFormatConverter();

  describe("toAst", () => {
    it("should parse plain text", () => {
      const ast = converter.toAst("Hello world");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    });

    it("should parse markdown bold", () => {
      const ast = converter.toAst("This is **bold** text");
      expect(ast.type).toBe("root");
    });

    it("should parse markdown links", () => {
      const ast = converter.toAst("Check [this](https://example.com)");
      expect(ast.type).toBe("root");
    });

    it("should handle empty text", () => {
      const ast = converter.toAst("");
      expect(ast.type).toBe("root");
    });

    it("should handle @mentions in text", () => {
      const ast = converter.toAst("Hello @user123 how are you?");
      expect(ast.type).toBe("root");
    });
  });

  describe("fromAst", () => {
    it("should convert AST back to text", () => {
      const ast = converter.toAst("Hello world");
      const result = converter.fromAst(ast);
      expect(result).toBe("Hello world");
    });

    it("should convert bold text", () => {
      const ast = converter.toAst("This is **bold** text");
      const result = converter.fromAst(ast);
      expect(result).toContain("bold");
    });
  });

  describe("renderPostable", () => {
    it("should render string messages directly", () => {
      const result = converter.renderPostable("Hello world");
      expect(result).toBe("Hello world");
    });

    it("should render raw messages", () => {
      const result = converter.renderPostable({ raw: "raw content" });
      expect(result).toBe("raw content");
    });

    it("should render markdown messages", () => {
      const result = converter.renderPostable({ markdown: "**bold**" });
      expect(result).toContain("bold");
    });
  });
});
