import { describe, expect, it } from "vitest";
import { TelegramFormatConverter } from "./markdown";

const TABLE_PIPE_PATTERN = /\|.*Name.*\|/;

describe("TelegramFormatConverter", () => {
  const converter = new TelegramFormatConverter();

  describe("fromAst (AST -> markdown string)", () => {
    it("should convert a plain text paragraph", () => {
      const ast = converter.toAst("Hello world");
      const result = converter.fromAst(ast);
      expect(result).toContain("Hello world");
    });

    it("should convert bold", () => {
      const ast = converter.toAst("**bold text**");
      const result = converter.fromAst(ast);
      expect(result).toContain("**bold text**");
    });

    it("should convert italic", () => {
      const ast = converter.toAst("*italic text*");
      const result = converter.fromAst(ast);
      expect(result).toContain("*italic text*");
    });

    it("should convert strikethrough", () => {
      const ast = converter.toAst("~~strikethrough~~");
      const result = converter.fromAst(ast);
      expect(result).toContain("~~strikethrough~~");
    });

    it("should convert links", () => {
      const ast = converter.toAst("[link text](https://example.com)");
      const result = converter.fromAst(ast);
      expect(result).toContain("[link text](https://example.com)");
    });

    it("should preserve inline code", () => {
      const ast = converter.toAst("Use `const x = 1`");
      const result = converter.fromAst(ast);
      expect(result).toContain("`const x = 1`");
    });

    it("should handle code blocks", () => {
      const input = "```js\nconst x = 1;\n```";
      const ast = converter.toAst(input);
      const output = converter.fromAst(ast);
      expect(output).toContain("```");
      expect(output).toContain("const x = 1;");
    });

    it("should convert tables to code blocks", () => {
      const ast = converter.toAst(
        "| Name | Age |\n|------|-----|\n| Alice | 30 |"
      );
      const result = converter.fromAst(ast);
      expect(result).toContain("```");
      expect(result).toContain("Name");
      expect(result).toContain("Alice");
      expect(result).not.toMatch(TABLE_PIPE_PATTERN);
    });
  });

  describe("toAst (markdown -> AST)", () => {
    it("should parse plain text", () => {
      const ast = converter.toAst("Hello world");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    });

    it("should parse bold", () => {
      const ast = converter.toAst("**bold**");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    });

    it("should parse italic", () => {
      const ast = converter.toAst("*italic*");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    });

    it("should parse inline code", () => {
      const ast = converter.toAst("`code`");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    });
  });

  describe("renderPostable", () => {
    it("should return a plain string as-is", () => {
      const result = converter.renderPostable("Hello world");
      expect(result).toBe("Hello world");
    });

    it("should return an empty string unchanged", () => {
      const result = converter.renderPostable("");
      expect(result).toBe("");
    });

    it("should render a raw message directly", () => {
      const result = converter.renderPostable({ raw: "raw content" });
      expect(result).toBe("raw content");
    });

    it("should render a markdown message", () => {
      const result = converter.renderPostable({ markdown: "**bold** text" });
      expect(result).toContain("bold");
    });

    it("should render an AST message", () => {
      const ast = converter.toAst("Hello from AST");
      const result = converter.renderPostable({ ast });
      expect(result).toContain("Hello from AST");
    });

    it("should render markdown with bold and italic", () => {
      const result = converter.renderPostable({
        markdown: "**bold** and *italic*",
      });
      expect(result).toContain("**bold**");
      expect(result).toContain("*italic*");
    });

    it("should render markdown table as code block", () => {
      const result = converter.renderPostable({
        markdown: "| A | B |\n| --- | --- |\n| 1 | 2 |",
      });
      expect(result).toContain("```");
      expect(result).toContain("A");
    });
  });

  describe("extractPlainText", () => {
    it("should remove bold markers", () => {
      expect(converter.extractPlainText("Hello **world**!")).toBe(
        "Hello world!"
      );
    });

    it("should remove italic markers", () => {
      expect(converter.extractPlainText("Hello *world*!")).toBe("Hello world!");
    });

    it("should remove strikethrough markers", () => {
      expect(converter.extractPlainText("Hello ~~world~~!")).toBe(
        "Hello world!"
      );
    });

    it("should extract link text", () => {
      expect(
        converter.extractPlainText("Check [this](https://example.com)")
      ).toBe("Check this");
    });

    it("should handle inline code", () => {
      const result = converter.extractPlainText("Use `const x = 1`");
      expect(result).toContain("const x = 1");
    });

    it("should handle code blocks", () => {
      const result = converter.extractPlainText("```js\nconst x = 1;\n```");
      expect(result).toContain("const x = 1;");
    });

    it("should handle plain text", () => {
      expect(converter.extractPlainText("Hello world")).toBe("Hello world");
    });

    it("should handle empty string", () => {
      expect(converter.extractPlainText("")).toBe("");
    });

    it("should strip all formatting from complex input", () => {
      const input = "**Bold** and *italic* with [link](https://x.com)";
      const result = converter.extractPlainText(input);
      expect(result).toContain("Bold");
      expect(result).toContain("italic");
      expect(result).toContain("link");
      expect(result).not.toContain("**");
      expect(result).not.toContain("](");
    });
  });

  describe("roundtrip", () => {
    it("should preserve plain text through toAst -> fromAst", () => {
      const input = "Hello world";
      const result = converter.fromAst(converter.toAst(input));
      expect(result).toContain("Hello world");
    });

    it("should preserve bold through toAst -> fromAst", () => {
      const input = "**bold text**";
      const result = converter.fromAst(converter.toAst(input));
      expect(result).toContain("**bold text**");
    });

    it("should preserve links through toAst -> fromAst", () => {
      const input = "[click here](https://example.com)";
      const result = converter.fromAst(converter.toAst(input));
      expect(result).toContain("[click here](https://example.com)");
    });

    it("should preserve code blocks through toAst -> fromAst", () => {
      const input = "```\nconst x = 1;\n```";
      const result = converter.fromAst(converter.toAst(input));
      expect(result).toContain("const x = 1;");
    });

    it("should convert table to code block on roundtrip", () => {
      const input = "| Col1 | Col2 |\n|------|------|\n| A | B |";
      const result = converter.fromAst(converter.toAst(input));
      expect(result).toContain("```");
      expect(result).toContain("Col1");
      expect(result).toContain("A");
    });
  });
});
