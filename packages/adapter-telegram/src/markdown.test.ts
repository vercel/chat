import { describe, expect, it } from "vitest";
import { TelegramFormatConverter } from "./markdown";

const TABLE_PIPE_PATTERN = /\|.*Name.*\|/;

describe("TelegramFormatConverter", () => {
  const converter = new TelegramFormatConverter();

  describe("fromAst (AST -> MarkdownV2 string)", () => {
    it("should convert a plain text paragraph", () => {
      const ast = converter.toAst("Hello world");
      const result = converter.fromAst(ast);
      expect(result).toBe("Hello world");
    });

    it("should escape reserved characters in plain text", () => {
      const ast = converter.toAst("Hello (world). Path: src/foo.ts!");
      const result = converter.fromAst(ast);
      expect(result).toBe("Hello \\(world\\)\\. Path: src/foo\\.ts\\!");
    });

    it("should escape dashes at the start of a sentence", () => {
      const ast = converter.toAst("- first\n- second");
      const result = converter.fromAst(ast);
      expect(result).toContain("\\- first");
      expect(result).toContain("\\- second");
    });

    it("should convert bold using MarkdownV2 single asterisks", () => {
      const ast = converter.toAst("**bold text**");
      const result = converter.fromAst(ast);
      expect(result).toBe("*bold text*");
    });

    it("should convert italic using MarkdownV2 underscores", () => {
      const ast = converter.toAst("*italic text*");
      const result = converter.fromAst(ast);
      expect(result).toBe("_italic text_");
    });

    it("should convert strikethrough using a single tilde", () => {
      const ast = converter.toAst("~~strikethrough~~");
      const result = converter.fromAst(ast);
      expect(result).toBe("~strikethrough~");
    });

    it("should convert links and escape reserved URL chars", () => {
      const ast = converter.toAst("[link text](https://example.com/a(b))");
      const result = converter.fromAst(ast);
      expect(result).toBe("[link text](https://example.com/a(b\\))");
    });

    it("should preserve and escape inline code", () => {
      const ast = converter.toAst("Use `const x = 1`");
      const result = converter.fromAst(ast);
      expect(result).toContain("`const x = 1`");
    });

    it("should escape backticks and backslashes inside inline code", () => {
      const ast = converter.toAst("Run `echo \\`hi\\``");
      const result = converter.fromAst(ast);
      expect(result).toContain("\\`");
    });

    it("should handle fenced code blocks", () => {
      const input = "```js\nconst x = 1;\n```";
      const ast = converter.toAst(input);
      const output = converter.fromAst(ast);
      expect(output).toContain("```js");
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

    it("should render headings as bold", () => {
      const ast = converter.toAst("# Title");
      const result = converter.fromAst(ast);
      expect(result).toBe("*Title*");
    });

    it("should handle blockquotes with line prefixes", () => {
      const ast = converter.toAst("> quoted line");
      const result = converter.fromAst(ast);
      expect(result).toBe(">quoted line");
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
    it("should escape reserved chars in plain strings", () => {
      const result = converter.renderPostable("Hello (world).");
      expect(result).toBe("Hello \\(world\\)\\.");
    });

    it("should return an empty string unchanged", () => {
      const result = converter.renderPostable("");
      expect(result).toBe("");
    });

    it("should render a raw message directly without escaping", () => {
      const result = converter.renderPostable({ raw: "raw (content)." });
      expect(result).toBe("raw (content).");
    });

    it("should render a markdown message", () => {
      const result = converter.renderPostable({ markdown: "**bold** text" });
      expect(result).toContain("*bold*");
    });

    it("should render an AST message", () => {
      const ast = converter.toAst("Hello from AST");
      const result = converter.renderPostable({ ast });
      expect(result).toBe("Hello from AST");
    });

    it("should render markdown with bold and italic", () => {
      const result = converter.renderPostable({
        markdown: "**bold** and *italic*",
      });
      expect(result).toContain("*bold*");
      expect(result).toContain("_italic_");
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

  describe("MarkdownV2 escape coverage", () => {
    it("should escape every reserved character in regular text", () => {
      // `[` and `]` are consumed by the markdown parser as link syntax, so
      // they never reach the text converter unescaped. The remaining 18
      // reserved characters must all be escaped.
      const reserved = "_*()~`>#+-=|{}.!";
      const ast = converter.toAst(`word ${reserved} word`);
      const result = converter.fromAst(ast);
      for (const char of reserved) {
        expect(result).toContain(`\\${char}`);
      }
    });
  });
});
