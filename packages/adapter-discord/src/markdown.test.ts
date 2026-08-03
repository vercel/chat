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

    it("should render a bare URL as a bare URL, not a masked link", () => {
      // Discord renders masked links `[text](url)` only in embeds, so wrapping
      // a bare URL as `[url](url)` shows up as literal text in a normal message.
      const ast = converter.toAst("https://example.com");
      const result = converter.fromAst(ast);
      expect(result).toContain("https://example.com");
      expect(result).not.toContain(
        "[https://example.com](https://example.com)"
      );
    });

    it("should preserve angle brackets on an autolink to suppress its embed", () => {
      const ast = converter.toAst("<https://example.com>");
      const result = converter.fromAst(ast);
      expect(result).toBe("<https://example.com>");
    });

    it("should preserve angle brackets in a masked link destination", () => {
      const ast = converter.toAst("[link text](<https://example.com>)");
      const result = converter.fromAst(ast);
      expect(result).toBe("[link text](<https://example.com>)");
    });

    it("should preserve a masked link whose label matches its URL", () => {
      const input = "[https://example.com](<https://example.com>)";
      expect(converter.fromAst(converter.toAst(input))).toBe(input);
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

    it("should not turn email addresses into mentions", () => {
      const ast = converter.toAst("Contact me at user@example.com");
      const result = converter.fromAst(ast);
      expect(result).toContain("user@example.com");
      expect(result).not.toContain("<@example>");
    });

    it("should still convert a bare mention that follows a period", () => {
      const ast = converter.toAst("read the docs.@everyone please");
      const result = converter.fromAst(ast);
      expect(result).toContain("<@everyone>");
    });

    it("should not mangle an @handle inside a url", () => {
      const result = converter.renderPostable({
        markdown: "see https://github.com/@vercel here",
      });
      expect(result).toContain("https://github.com/@vercel");
      expect(result).not.toContain("<@vercel>");
    });

    it("should not mangle a mention inside an inline code span", () => {
      const result = converter.renderPostable({ markdown: "run `ping @here`" });
      expect(result).toContain("`ping @here`");
      expect(result).not.toContain("<@here>");
    });
  });

  describe("renderPostable (mentions)", () => {
    it("should preserve a preview-suppressed link in markdown", () => {
      expect(
        converter.renderPostable({ markdown: "<https://example.com>" })
      ).toBe("<https://example.com>");
    });

    it("should preserve a preview-suppressed masked link in markdown", () => {
      expect(
        converter.renderPostable({
          markdown: "[link text](<https://example.com>)",
        })
      ).toBe("[link text](<https://example.com>)");
    });

    it("should convert a bare mention in raw text", () => {
      expect(converter.renderPostable({ raw: "hey @alice" })).toContain(
        "<@alice>"
      );
    });

    it("should not double-wrap an already-formatted mention in raw text", () => {
      const result = converter.renderPostable({ raw: "ping <@123> now" });
      expect(result).toContain("<@123>");
      expect(result).not.toContain("<<@123>>");
    });

    it("should leave email addresses in raw text untouched", () => {
      const result = converter.renderPostable({
        raw: "email support@vercel.com",
      });
      expect(result).toContain("support@vercel.com");
      expect(result).not.toContain("<@vercel>");
    });

    it("should not mangle an @handle inside a url in raw text", () => {
      const result = converter.renderPostable({
        raw: "see twitter.com/@jack",
      });
      expect(result).toContain("twitter.com/@jack");
      expect(result).not.toContain("<@jack>");
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

  describe("nested lists", () => {
    it("should indent nested unordered lists", () => {
      const result = converter.fromMarkdown(
        "- parent\n  - child 1\n  - child 2"
      );
      expect(result).toBe("- parent\n  - child 1\n  - child 2");
    });

    it("should indent nested ordered lists", () => {
      const result = converter.fromMarkdown(
        "1. first\n   1. sub-first\n   2. sub-second\n2. second"
      );
      expect(result).toContain("1. first");
      expect(result).toContain("  1. sub-first");
      expect(result).toContain("  2. sub-second");
      expect(result).toContain("2. second");
    });

    it("should handle deeply nested lists", () => {
      const result = converter.fromMarkdown(
        "- level 1\n  - level 2\n    - level 3"
      );
      expect(result).toContain("- level 1");
      expect(result).toContain("  - level 2");
      expect(result).toContain("    - level 3");
    });

    it("should keep sibling items at the same indent level", () => {
      const result = converter.fromMarkdown("- item 1\n- item 2\n- item 3");
      expect(result).toBe("- item 1\n- item 2\n- item 3");
    });

    it("should handle mixed ordered and unordered nesting", () => {
      const result = converter.fromMarkdown(
        "1. first\n   - sub a\n   - sub b\n2. second"
      );
      expect(result).toContain("1. first");
      expect(result).toContain("  - sub a");
      expect(result).toContain("  - sub b");
      expect(result).toContain("2. second");
    });
  });

  describe("thematic break", () => {
    it("should handle thematic break", () => {
      const ast = converter.toAst("text\n\n---\n\nmore text");
      const result = converter.fromAst(ast);
      expect(result).toContain("---");
    });
  });

  describe("table rendering", () => {
    it("should render markdown tables as code blocks", () => {
      const result = converter.fromMarkdown(
        "| Name | Age |\n|------|-----|\n| Alice | 30 |"
      );
      expect(result).toContain("```");
      expect(result).toContain("Name");
      expect(result).toContain("Alice");
    });
  });
});
