import { describe, expect, it } from "vitest";
import { FeishuFormatConverter } from "./markdown";

describe("FeishuFormatConverter", () => {
  const converter = new FeishuFormatConverter();

  describe("fromAst (AST -> Feishu markdown)", () => {
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

    it("should handle mixed formatting", () => {
      const input = "**Bold** and *italic* and [link](https://x.com)";
      const ast = converter.toAst(input);
      const output = converter.fromAst(ast);
      expect(output).toContain("**Bold**");
      expect(output).toContain("*italic*");
      expect(output).toContain("[link](https://x.com)");
    });

    it("should convert @mentions to Feishu format", () => {
      const ast = converter.toAst("Hello @someone");
      const result = converter.fromAst(ast);
      expect(result).toContain('<at user_id="someone">someone</at>');
    });
  });

  describe("toAst (Feishu markdown -> AST)", () => {
    it("should parse bold text into AST", () => {
      const ast = converter.toAst("Hello **world**!");
      expect(ast).toBeDefined();
      expect(ast.type).toBe("root");
    });

    it("should convert Feishu user mentions to standard @mentions", () => {
      const ast = converter.toAst(
        'Hello <at user_id="ou_xxx">Alice</at> how are you?'
      );
      const roundTripped = converter.fromAst(ast);
      // After toAst, the mention becomes @Alice, then fromAst converts it back
      expect(roundTripped).toContain("Alice");
    });

    it("should handle multiple Feishu mentions", () => {
      const ast = converter.toAst(
        '<at user_id="ou_1">Alice</at> and <at user_id="ou_2">Bob</at>'
      );
      const roundTripped = converter.fromAst(ast);
      expect(roundTripped).toContain("Alice");
      expect(roundTripped).toContain("Bob");
    });

    it("should parse standard markdown through toAst", () => {
      const ast = converter.toAst("**bold** and *italic*");
      expect(ast.type).toBe("root");
      expect(ast.children).toBeDefined();
      expect(ast.children.length).toBeGreaterThan(0);
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

    it("should handle empty string", () => {
      expect(converter.extractPlainText("")).toBe("");
    });

    it("should handle plain text", () => {
      expect(converter.extractPlainText("Hello world")).toBe("Hello world");
    });

    it("should handle complex messages", () => {
      const input = "**Bold** and *italic* with [link](https://x.com)";
      const result = converter.extractPlainText(input);
      expect(result).toContain("Bold");
      expect(result).toContain("italic");
      expect(result).toContain("link");
      expect(result).not.toContain("**");
    });
  });

  describe("renderPostable", () => {
    it("should render a plain string with mention conversion", () => {
      const result = converter.renderPostable("Hello @user");
      expect(result).toBe('Hello <at user_id="user">user</at>');
    });

    it("should render a raw message with mention conversion", () => {
      const result = converter.renderPostable({ raw: "Hello @user" });
      expect(result).toBe('Hello <at user_id="user">user</at>');
    });

    it("should render a markdown message", () => {
      const result = converter.renderPostable({
        markdown: "Hello **world** @user",
      });
      expect(result).toContain("**world**");
      expect(result).toContain('<at user_id="user">user</at>');
    });

    it("should handle empty message", () => {
      const result = converter.renderPostable("");
      expect(result).toBe("");
    });

    it("should render AST message", () => {
      const ast = converter.toAst("Hello **world**");
      const result = converter.renderPostable({ ast });
      expect(result).toContain("**world**");
    });
  });

  describe("blockquotes", () => {
    it("should handle blockquotes", () => {
      const ast = converter.toAst("> quoted text");
      const result = converter.fromAst(ast);
      expect(result).toContain("> quoted text");
    });
  });

  describe("lists", () => {
    it("should handle unordered lists", () => {
      const ast = converter.toAst("- item 1\n- item 2");
      const result = converter.fromAst(ast);
      expect(result).toContain("- item 1");
      expect(result).toContain("- item 2");
    });

    it("should handle ordered lists", () => {
      const ast = converter.toAst("1. item 1\n2. item 2");
      const result = converter.fromAst(ast);
      expect(result).toContain("1.");
      expect(result).toContain("2.");
    });
  });

  describe("thematic break", () => {
    it("should handle thematic break", () => {
      const ast = converter.toAst("text\n\n---\n\nmore text");
      const result = converter.fromAst(ast);
      expect(result).toContain("---");
    });
  });
});
