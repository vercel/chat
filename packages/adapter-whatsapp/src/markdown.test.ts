import { describe, expect, it } from "vitest";
import { WhatsAppFormatConverter } from "./markdown";

describe("WhatsAppFormatConverter", () => {
  const converter = new WhatsAppFormatConverter();

  describe("toAst", () => {
    it("should parse plain text", () => {
      const ast = converter.toAst("Hello world");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    });

    it("should parse WhatsApp bold (*text*) as standard bold", () => {
      const ast = converter.toAst("*bold text*");
      expect(ast.type).toBe("root");
    });

    it("should parse italic (_text_)", () => {
      const ast = converter.toAst("_italic text_");
      expect(ast.type).toBe("root");
    });

    it("should parse WhatsApp strikethrough (~text~) as standard", () => {
      const ast = converter.toAst("~strikethrough~");
      expect(ast.type).toBe("root");
    });

    it("should not merge bold spans across newlines", () => {
      const ast = converter.toAst("*bold1*\nsome text\n*bold2*");
      const result = converter.fromAst(ast);
      // Each bold span should remain separate, not merge into one
      expect(result).toContain("*bold1*");
      expect(result).toContain("*bold2*");
    });

    it("should parse code blocks", () => {
      const ast = converter.toAst("```\ncode\n```");
      expect(ast.type).toBe("root");
    });

    it("should parse lists", () => {
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

    it("should convert standard bold to WhatsApp bold", () => {
      // Create AST from standard markdown with double asterisks
      const ast = converter.toAst("**bold text**");
      const result = converter.fromAst(ast);
      // Should output WhatsApp-style single asterisk bold
      expect(result).toContain("*bold text*");
      expect(result).not.toContain("**bold text**");
    });

    it("should convert standard strikethrough to WhatsApp style", () => {
      const ast = converter.toAst("~~strikethrough~~");
      const result = converter.fromAst(ast);
      expect(result).toContain("~strikethrough~");
      expect(result).not.toContain("~~strikethrough~~");
    });

    it("should preserve escaped asterisks and tildes as literals", () => {
      const ast = converter.toAst("a \\* b and c \\~ d");
      const result = converter.fromAst(ast);
      expect(result).toContain("\\*");
      expect(result).toContain("\\~");
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
