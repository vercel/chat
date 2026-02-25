import { describe, expect, it } from "vitest";
import { DiscordFormatConverter } from "./markdown";

describe("DiscordFormatConverter", () => {
  const converter = new DiscordFormatConverter();

  describe("fromAst (AST -> Discord markdown)", () => {
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

    it("should convert @mentions to Discord format", () => {
      const ast = converter.toAst("Hello @someone");
      const result = converter.fromAst(ast);
      expect(result).toContain("<@someone>");
    });
  });

  describe("toAst (Discord markdown -> AST)", () => {
    it("should convert bold", () => {
      const ast = converter.toAst("Hello **world**!");
      expect(ast).toBeDefined();
      expect(ast.type).toBe("root");
    });

    it("should convert user mentions", () => {
      const text = converter.extractPlainText("Hello <@123456789>");
      expect(text).toBe("Hello @123456789");
    });

    it("should convert user mentions with nickname marker", () => {
      const text = converter.extractPlainText("Hello <@!123456789>");
      expect(text).toBe("Hello @123456789");
    });

    it("should convert channel mentions", () => {
      const text = converter.extractPlainText("Check <#987654321>");
      expect(text).toBe("Check #987654321");
    });

    it("should convert role mentions", () => {
      const text = converter.extractPlainText("Hey <@&111222333>");
      expect(text).toBe("Hey @&111222333");
    });

    it("should convert custom emoji", () => {
      const text = converter.extractPlainText("Nice <:thumbsup:123>");
      expect(text).toBe("Nice :thumbsup:");
    });

    it("should convert animated custom emoji", () => {
      const text = converter.extractPlainText("Cool <a:wave:456>");
      expect(text).toBe("Cool :wave:");
    });

    it("should handle spoiler tags", () => {
      const text = converter.extractPlainText("Secret ||hidden text||");
      expect(text).toContain("hidden text");
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

    it("should format user mentions", () => {
      const result = converter.extractPlainText("Hey <@U123>!");
      expect(result).toContain("@U123");
    });

    it("should handle complex messages", () => {
      const input =
        "**Bold** and *italic* with [link](https://x.com) and <@U123>";
      const result = converter.extractPlainText(input);
      expect(result).toContain("Bold");
      expect(result).toContain("italic");
      expect(result).toContain("link");
      expect(result).toContain("@U123");
      // Should not contain formatting characters (except @)
      expect(result).not.toContain("**");
      expect(result).not.toContain("<@");
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
  });

  describe("renderPostable", () => {
    it("should render a plain string with mention conversion", () => {
      const result = converter.renderPostable("Hello @user");
      expect(result).toBe("Hello <@user>");
    });

    it("should render a raw message with mention conversion", () => {
      const result = converter.renderPostable({ raw: "Hello @user" });
      expect(result).toBe("Hello <@user>");
    });

    it("should render a markdown message", () => {
      const result = converter.renderPostable({
        markdown: "Hello **world** @user",
      });
      expect(result).toContain("**world**");
      expect(result).toContain("<@user>");
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
