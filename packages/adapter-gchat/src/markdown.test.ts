import { describe, expect, it } from "vitest";
import { GoogleChatFormatConverter } from "./markdown";

describe("GoogleChatFormatConverter", () => {
  const converter = new GoogleChatFormatConverter();

  describe("fromAst (AST -> Google Chat format)", () => {
    it("should convert bold (**text** -> *text*)", () => {
      const ast = converter.toAst("**bold text**");
      const result = converter.fromAst(ast);
      expect(result).toContain("*bold text*");
    });

    it("should convert italic", () => {
      const ast = converter.toAst("_italic text_");
      const result = converter.fromAst(ast);
      expect(result).toContain("_italic text_");
    });

    it("should convert strikethrough (~~text~~ -> ~text~)", () => {
      const ast = converter.toAst("~~strikethrough~~");
      const result = converter.fromAst(ast);
      expect(result).toContain("~strikethrough~");
    });

    it("should preserve inline code", () => {
      const ast = converter.toAst("Use `const x = 1`");
      const result = converter.fromAst(ast);
      expect(result).toContain("`const x = 1`");
    });

    it("should handle code blocks", () => {
      const input = "```\nconst x = 1;\n```";
      const ast = converter.toAst(input);
      const output = converter.fromAst(ast);
      expect(output).toContain("```");
      expect(output).toContain("const x = 1;");
    });

    it("should output URL directly when link text matches URL", () => {
      const ast = converter.toAst("[https://example.com](https://example.com)");
      const result = converter.fromAst(ast);
      expect(result).toContain("https://example.com");
    });

    it("should output 'text (url)' when link text differs", () => {
      const ast = converter.toAst("[click here](https://example.com)");
      const result = converter.fromAst(ast);
      expect(result).toContain("click here (https://example.com)");
    });

    it("should handle blockquotes", () => {
      const ast = converter.toAst("> quoted text");
      const result = converter.fromAst(ast);
      expect(result).toContain("> quoted text");
    });

    it("should handle unordered lists with bullet points", () => {
      const ast = converter.toAst("- item 1\n- item 2");
      const result = converter.fromAst(ast);
      expect(result).toContain("item 1");
      expect(result).toContain("item 2");
    });

    it("should handle ordered lists", () => {
      const ast = converter.toAst("1. first\n2. second");
      const result = converter.fromAst(ast);
      expect(result).toContain("1.");
      expect(result).toContain("2.");
    });

    it("should handle line breaks", () => {
      const ast = converter.toAst("line1  \nline2");
      const result = converter.fromAst(ast);
      expect(result).toContain("line1");
      expect(result).toContain("line2");
    });

    it("should handle thematic breaks", () => {
      const ast = converter.toAst("text\n\n---\n\nmore");
      const result = converter.fromAst(ast);
      expect(result).toContain("---");
    });
  });

  describe("toAst (Google Chat format -> AST)", () => {
    it("should parse Google Chat bold (*text*) to AST", () => {
      const ast = converter.toAst("*bold*");
      expect(ast).toBeDefined();
      expect(ast.type).toBe("root");
    });

    it("should parse Google Chat strikethrough (~text~) to AST", () => {
      const ast = converter.toAst("~struck~");
      expect(ast).toBeDefined();
      expect(ast.type).toBe("root");
    });

    it("should parse code blocks", () => {
      const ast = converter.toAst("```\ncode\n```");
      expect(ast.type).toBe("root");
    });
  });

  describe("extractPlainText", () => {
    it("should remove formatting markers", () => {
      const result = converter.extractPlainText("*bold* _italic_ ~struck~");
      expect(result).toContain("bold");
      expect(result).toContain("italic");
      expect(result).toContain("struck");
    });

    it("should handle empty string", () => {
      expect(converter.extractPlainText("")).toBe("");
    });

    it("should handle plain text", () => {
      expect(converter.extractPlainText("Hello world")).toBe("Hello world");
    });

    it("should handle inline code", () => {
      const result = converter.extractPlainText("Use `const x = 1`");
      expect(result).toContain("const x = 1");
    });
  });

  describe("renderPostable", () => {
    it("should render a plain string", () => {
      const result = converter.renderPostable("Hello world");
      expect(result).toBe("Hello world");
    });

    it("should render a raw message", () => {
      const result = converter.renderPostable({ raw: "raw text" });
      expect(result).toBe("raw text");
    });

    it("should render a markdown message", () => {
      const result = converter.renderPostable({
        markdown: "**bold** text",
      });
      expect(result).toContain("bold");
    });

    it("should render an AST message", () => {
      const ast = converter.toAst("**bold**");
      const result = converter.renderPostable({ ast });
      expect(result).toContain("bold");
    });
  });
});
