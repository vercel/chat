import { describe, expect, it } from "vitest";
import { ChatworkFormatConverter } from "./markdown";

describe("ChatworkFormatConverter", () => {
  const converter = new ChatworkFormatConverter();

  describe("fromAst (AST -> Chatwork format)", () => {
    it("should pass through plain text", () => {
      const ast = converter.toAst("Hello world");
      const result = converter.fromAst(ast);
      expect(result).toContain("Hello world");
    });

    it("should convert bold to emphasis markers", () => {
      const ast = converter.toAst("**bold text**");
      const result = converter.fromAst(ast);
      expect(result).toContain("*bold text*");
    });

    it("should convert italic", () => {
      const ast = converter.toAst("*italic text*");
      const result = converter.fromAst(ast);
      expect(result).toContain("_italic text_");
    });

    it("should convert strikethrough", () => {
      const ast = converter.toAst("~~strikethrough~~");
      const result = converter.fromAst(ast);
      expect(result).toContain("~strikethrough~");
    });

    it("should convert code blocks to [code] tags", () => {
      const input = "```js\nconst x = 1;\n```";
      const ast = converter.toAst(input);
      const output = converter.fromAst(ast);
      expect(output).toContain("[code]");
      expect(output).toContain("[/code]");
      expect(output).toContain("const x = 1;");
    });

    it("should preserve inline code", () => {
      const ast = converter.toAst("Use `const x = 1`");
      const result = converter.fromAst(ast);
      expect(result).toContain("`const x = 1`");
    });

    it("should convert links", () => {
      const ast = converter.toAst("[link text](https://example.com)");
      const result = converter.fromAst(ast);
      expect(result).toContain("link text");
      expect(result).toContain("https://example.com");
    });

    it("should auto-link bare URLs", () => {
      const ast = converter.toAst("[https://example.com](https://example.com)");
      const result = converter.fromAst(ast);
      expect(result).toContain("https://example.com");
    });

    it("should convert blockquotes to [info] tags", () => {
      const ast = converter.toAst("> quoted text");
      const result = converter.fromAst(ast);
      expect(result).toContain("[info]");
      expect(result).toContain("[/info]");
      expect(result).toContain("quoted text");
    });

    it("should convert thematic break to [hr]", () => {
      const ast = converter.toAst("text\n\n---\n\nmore text");
      const result = converter.fromAst(ast);
      expect(result).toContain("[hr]");
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
  });

  describe("toAst (Chatwork format -> AST)", () => {
    it("should parse plain text", () => {
      const ast = converter.toAst("Hello world");
      expect(ast).toBeDefined();
      expect(ast.type).toBe("root");
    });

    it("should convert [To:xxx] to @mention", () => {
      const text = converter.extractPlainText("[To:12345] Hello");
      expect(text).toContain("@12345");
      expect(text).toContain("Hello");
    });

    it("should convert [code] blocks", () => {
      const ast = converter.toAst("[code]const x = 1;[/code]");
      expect(ast).toBeDefined();
      const text = converter.extractPlainText("[code]const x = 1;[/code]");
      expect(text).toContain("const x = 1;");
    });

    it("should convert [info] blocks to blockquote", () => {
      const ast = converter.toAst("[info]Important message[/info]");
      expect(ast).toBeDefined();
      const text = converter.extractPlainText("[info]Important message[/info]");
      expect(text).toContain("Important message");
    });

    it("should convert [info][title]...[/title]...[/info] blocks", () => {
      const input =
        "[info][title]Title Here[/title]Body content[/info]";
      const text = converter.extractPlainText(input);
      expect(text).toContain("Title Here");
      expect(text).toContain("Body content");
    });

    it("should convert [hr] to thematic break", () => {
      const ast = converter.toAst("above\n[hr]\nbelow");
      expect(ast).toBeDefined();
    });

    it("should strip [rp] reply markers", () => {
      const text = converter.extractPlainText(
        "[rp aid=12345 to=67890-111] Reply text"
      );
      expect(text).toContain("Reply text");
      expect(text).not.toContain("[rp");
    });

    it("should strip [piconname] tags", () => {
      const text = converter.extractPlainText(
        "[piconname:12345]UserName\nMessage text"
      );
      expect(text).toContain("Message text");
    });

    it("should handle [qt] quote blocks", () => {
      const text = converter.extractPlainText(
        "[qt][qtmeta aid=12345 time=1234567890]Quoted text[/qt]"
      );
      expect(text).toContain("Quoted text");
    });
  });

  describe("extractPlainText", () => {
    it("should remove formatting from bold", () => {
      expect(converter.extractPlainText("**bold**")).toBe("bold");
    });

    it("should remove formatting from italic", () => {
      expect(converter.extractPlainText("*italic*")).toBe("italic");
    });

    it("should handle empty string", () => {
      expect(converter.extractPlainText("")).toBe("");
    });

    it("should handle plain text", () => {
      expect(converter.extractPlainText("Hello world")).toBe("Hello world");
    });
  });

  describe("renderPostable", () => {
    it("should render a plain string", () => {
      const result = converter.renderPostable("Hello world");
      expect(result).toBe("Hello world");
    });

    it("should render a raw message", () => {
      const result = converter.renderPostable({ raw: "[info]test[/info]" });
      expect(result).toBe("[info]test[/info]");
    });

    it("should render a markdown message", () => {
      const result = converter.renderPostable({
        markdown: "**bold** text",
      });
      expect(result).toContain("*bold*");
      expect(result).toContain("text");
    });

    it("should handle empty message", () => {
      const result = converter.renderPostable("");
      expect(result).toBe("");
    });

    it("should render AST message", () => {
      const ast = converter.toAst("Hello **world**");
      const result = converter.renderPostable({ ast });
      expect(result).toContain("world");
    });
  });
});
