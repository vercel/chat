import { describe, expect, it } from "vitest";
import { TeamsFormatConverter } from "./markdown";

describe("TeamsFormatConverter", () => {
  const converter = new TeamsFormatConverter();

  describe("fromAst (AST -> Teams format)", () => {
    it("should convert bold", () => {
      const ast = converter.toAst("**bold text**");
      const result = converter.fromAst(ast);
      expect(result).toContain("**bold text**");
    });

    it("should convert italic", () => {
      const ast = converter.toAst("_italic text_");
      const result = converter.fromAst(ast);
      expect(result).toContain("_italic text_");
    });

    it("should convert strikethrough", () => {
      const ast = converter.toAst("~~strikethrough~~");
      const result = converter.fromAst(ast);
      expect(result).toContain("~~strikethrough~~");
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

    it("should convert links to markdown format", () => {
      const ast = converter.toAst("[link text](https://example.com)");
      const result = converter.fromAst(ast);
      expect(result).toContain("[link text](https://example.com)");
    });

    it("should handle blockquotes", () => {
      const ast = converter.toAst("> quoted text");
      const result = converter.fromAst(ast);
      expect(result).toContain("> quoted text");
    });

    it("should handle unordered lists", () => {
      const ast = converter.toAst("- item 1\n- item 2");
      const result = converter.fromAst(ast);
      expect(result).toContain("- item 1");
      expect(result).toContain("- item 2");
    });

    it("should handle ordered lists", () => {
      const ast = converter.toAst("1. first\n2. second");
      const result = converter.fromAst(ast);
      expect(result).toContain("1.");
      expect(result).toContain("2.");
    });

    it("should convert @mentions to <at>mention</at>", () => {
      const ast = converter.toAst("Hello @someone");
      const result = converter.fromAst(ast);
      expect(result).toContain("<at>someone</at>");
    });

    it("should handle thematic breaks", () => {
      const ast = converter.toAst("text\n\n---\n\nmore");
      const result = converter.fromAst(ast);
      expect(result).toContain("---");
    });
  });

  describe("toAst (Teams HTML -> AST)", () => {
    it("should convert <at> mentions to @mentions", () => {
      const text = converter.extractPlainText("<at>John</at> said hi");
      expect(text).toContain("@John");
    });

    it("should convert <b> tags to bold", () => {
      const ast = converter.toAst("<b>bold</b>");
      expect(ast.type).toBe("root");
      const result = converter.fromAst(ast);
      expect(result).toContain("**bold**");
    });

    it("should convert <strong> tags to bold", () => {
      const ast = converter.toAst("<strong>bold</strong>");
      const result = converter.fromAst(ast);
      expect(result).toContain("**bold**");
    });

    it("should convert <i> tags to italic", () => {
      const ast = converter.toAst("<i>italic</i>");
      const result = converter.fromAst(ast);
      expect(result).toContain("_italic_");
    });

    it("should convert <em> tags to italic", () => {
      const ast = converter.toAst("<em>italic</em>");
      const result = converter.fromAst(ast);
      expect(result).toContain("_italic_");
    });

    it("should convert <s> tags to strikethrough", () => {
      const ast = converter.toAst("<s>struck</s>");
      const result = converter.fromAst(ast);
      expect(result).toContain("~~struck~~");
    });

    it("should convert <a> tags to links", () => {
      const ast = converter.toAst('<a href="https://example.com">link</a>');
      const result = converter.fromAst(ast);
      expect(result).toContain("[link](https://example.com)");
    });

    it("should convert <code> tags to inline code", () => {
      const ast = converter.toAst("<code>const x</code>");
      const result = converter.fromAst(ast);
      expect(result).toContain("`const x`");
    });

    it("should convert <pre> tags to code blocks", () => {
      const ast = converter.toAst("<pre>const x = 1;</pre>");
      const result = converter.fromAst(ast);
      expect(result).toContain("```");
      expect(result).toContain("const x = 1;");
    });

    it("should strip remaining HTML tags", () => {
      const text = converter.extractPlainText("<div><span>hello</span></div>");
      expect(text).toBe("hello");
    });

    it("should decode HTML entities", () => {
      const text = converter.extractPlainText(
        "&lt;b&gt;not bold&lt;/b&gt; &amp; &quot;quoted&quot;"
      );
      expect(text).toContain("<b>");
      expect(text).toContain("&");
      expect(text).toContain('"quoted"');
    });
  });

  describe("renderPostable", () => {
    it("should convert @mentions in plain strings", () => {
      const result = converter.renderPostable("Hello @user");
      expect(result).toBe("Hello <at>user</at>");
    });

    it("should convert @mentions in raw messages", () => {
      const result = converter.renderPostable({ raw: "Hello @user" });
      expect(result).toBe("Hello <at>user</at>");
    });

    it("should render markdown messages", () => {
      const result = converter.renderPostable({
        markdown: "Hello **world**",
      });
      expect(result).toContain("**world**");
    });

    it("should render AST messages", () => {
      const ast = converter.toAst("Hello **world**");
      const result = converter.renderPostable({ ast });
      expect(result).toContain("**world**");
    });

    it("should handle empty message", () => {
      const result = converter.renderPostable("");
      expect(result).toBe("");
    });
  });

  describe("extractPlainText", () => {
    it("should remove bold markers", () => {
      expect(converter.extractPlainText("Hello **world**!")).toBe(
        "Hello world!"
      );
    });

    it("should remove italic markers", () => {
      expect(converter.extractPlainText("Hello _world_!")).toBe("Hello world!");
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
});
