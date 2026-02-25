/**
 * Tests for the Telegram format converter.
 */

import { parseMarkdown } from "chat";
import { describe, expect, it } from "vitest";
import { escapeMarkdownV2, TelegramFormatConverter } from "./markdown";

const converter = new TelegramFormatConverter();

describe("TelegramFormatConverter", () => {
  describe("escapeMarkdownV2", () => {
    it("should escape special characters", () => {
      expect(escapeMarkdownV2("Hello.World!")).toBe("Hello\\.World\\!");
      expect(escapeMarkdownV2("a_b*c~d")).toBe("a\\_b\\*c\\~d");
      expect(escapeMarkdownV2("test (1+2)")).toBe("test \\(1\\+2\\)");
    });

    it("should not escape regular text", () => {
      expect(escapeMarkdownV2("Hello world")).toBe("Hello world");
    });
  });

  describe("fromAst", () => {
    it("should convert plain text", () => {
      const ast = parseMarkdown("Hello world");
      const result = converter.fromAst(ast);
      expect(result).toBe("Hello world");
    });

    it("should convert bold text", () => {
      const ast = parseMarkdown("**bold text**");
      const result = converter.fromAst(ast);
      expect(result).toBe("*bold text*");
    });

    it("should convert italic text", () => {
      const ast = parseMarkdown("_italic text_");
      const result = converter.fromAst(ast);
      expect(result).toBe("_italic text_");
    });

    it("should convert strikethrough text", () => {
      const ast = parseMarkdown("~~deleted~~");
      const result = converter.fromAst(ast);
      expect(result).toBe("~deleted~");
    });

    it("should convert inline code", () => {
      const ast = parseMarkdown("`code`");
      const result = converter.fromAst(ast);
      expect(result).toBe("`code`");
    });

    it("should convert code blocks", () => {
      const ast = parseMarkdown("```js\nconsole.log('hi')\n```");
      const result = converter.fromAst(ast);
      expect(result).toContain("```js");
      expect(result).toContain("console.log('hi')");
    });

    it("should convert links", () => {
      const ast = parseMarkdown("[Click here](https://example.com)");
      const result = converter.fromAst(ast);
      expect(result).toBe("[Click here](https://example\\.com)");
    });

    it("should convert blockquotes", () => {
      const ast = parseMarkdown("> quoted text");
      const result = converter.fromAst(ast);
      expect(result).toContain(">quoted text");
    });

    it("should convert unordered lists", () => {
      const ast = parseMarkdown("- item 1\n- item 2");
      const result = converter.fromAst(ast);
      expect(result).toContain("item 1");
      expect(result).toContain("item 2");
    });

    it("should escape special characters in text", () => {
      const ast = parseMarkdown("Price: $10.99!");
      const result = converter.fromAst(ast);
      expect(result).toContain("\\.");
      expect(result).toContain("\\!");
    });
  });

  describe("toAst", () => {
    it("should parse plain text", () => {
      const ast = converter.toAst("Hello world");
      const paragraph = ast.children[0];
      expect(paragraph).toBeDefined();
      expect(paragraph?.type).toBe("paragraph");
    });

    it("should handle MarkdownV2 escaped characters", () => {
      const ast = converter.toAst("Hello\\.World\\!");
      const paragraph = ast.children[0];
      expect(paragraph).toBeDefined();
    });

    it("should parse bold text (MarkdownV2 format)", () => {
      const ast = converter.toAst("*bold text*");
      // After conversion *bold* -> **bold** in the parser
      const paragraph = ast.children[0];
      expect(paragraph).toBeDefined();
    });
  });

  describe("renderPostable", () => {
    it("should render plain string as-is", () => {
      const result = converter.renderPostable("Hello world");
      expect(result).toBe("Hello world");
    });

    it("should render raw message", () => {
      const result = converter.renderPostable({ raw: "raw text" });
      expect(result).toBe("raw text");
    });

    it("should render markdown message", () => {
      const result = converter.renderPostable({ markdown: "**bold**" });
      expect(result).toContain("*bold*");
    });

    it("should render AST message", () => {
      const ast = parseMarkdown("Hello");
      const result = converter.renderPostable({ ast });
      expect(result).toContain("Hello");
    });
  });

  describe("extractPlainText", () => {
    it("should extract plain text from formatted content", () => {
      const result = converter.extractPlainText("Hello world");
      expect(result).toBe("Hello world");
    });
  });
});
