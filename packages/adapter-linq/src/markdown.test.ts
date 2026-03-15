import { parseMarkdown, stringifyMarkdown } from "chat";
import { describe, expect, it } from "vitest";
import { LinqFormatConverter } from "./markdown";

const converter = new LinqFormatConverter();
const horizontalRuleRegex = /^---$/m;

describe("LinqFormatConverter", () => {
  describe("fromAst", () => {
    it("strips bold formatting", () => {
      const ast = parseMarkdown("**bold text**");
      const result = converter.fromAst(ast);
      expect(result).toBe("bold text");
    });

    it("strips italic formatting", () => {
      const ast = parseMarkdown("*italic text*");
      const result = converter.fromAst(ast);
      expect(result).toBe("italic text");
    });

    it("strips strikethrough formatting", () => {
      const ast = parseMarkdown("~~deleted~~");
      const result = converter.fromAst(ast);
      expect(result).toBe("deleted");
    });

    it("converts links to text with URL", () => {
      const ast = parseMarkdown("[click here](https://example.com)");
      const result = converter.fromAst(ast);
      expect(result).toContain("click here");
      expect(result).toContain("https://example.com");
    });

    it("strips header formatting", () => {
      const ast = parseMarkdown("# Header\n\nContent");
      const result = converter.fromAst(ast);
      expect(result).toContain("Header");
      expect(result).not.toContain("#");
    });

    it("converts tables to ASCII", () => {
      const markdown = "| A | B |\n| --- | --- |\n| 1 | 2 |";
      const ast = parseMarkdown(markdown);
      const result = converter.fromAst(ast);
      expect(result).toContain("A");
      expect(result).toContain("B");
      expect(result).toContain("1");
      expect(result).toContain("2");
    });

    it("handles plain text passthrough", () => {
      const ast = parseMarkdown("Hello world");
      const result = converter.fromAst(ast);
      expect(result).toBe("Hello world");
    });

    it("strips nested bold+italic formatting", () => {
      const ast = parseMarkdown("**bold _italic_**");
      const result = converter.fromAst(ast);
      expect(result).toContain("bold");
      expect(result).toContain("italic");
      expect(result).not.toContain("**");
      expect(result).not.toContain("_");
    });

    it("strips fenced code blocks", () => {
      const ast = parseMarkdown("```js\nconst x = 1;\n```");
      const result = converter.fromAst(ast);
      expect(result).toContain("const x = 1;");
    });

    it("strips inline code", () => {
      const ast = parseMarkdown("Use `foo()` here");
      const result = converter.fromAst(ast);
      expect(result).toBe("Use foo() here");
    });

    it("handles unordered lists", () => {
      const ast = parseMarkdown("- item one\n- item two");
      const result = converter.fromAst(ast);
      expect(result).toContain("item one");
      expect(result).toContain("item two");
    });

    it("handles ordered lists", () => {
      const ast = parseMarkdown("1. first\n2. second");
      const result = converter.fromAst(ast);
      expect(result).toContain("first");
      expect(result).toContain("second");
    });

    it("handles blockquotes", () => {
      const ast = parseMarkdown("> quoted text");
      const result = converter.fromAst(ast);
      expect(result).toContain("quoted text");
    });

    it("strips image markdown to alt text", () => {
      const ast = parseMarkdown("![alt text](https://example.com/img.png)");
      const result = converter.fromAst(ast);
      expect(result).toContain("alt text");
      expect(result).not.toContain("![");
    });

    it("strips horizontal rules", () => {
      const ast = parseMarkdown("above\n\n---\n\nbelow");
      const result = converter.fromAst(ast);
      expect(result).toContain("above");
      expect(result).toContain("below");
      expect(result).not.toMatch(horizontalRuleRegex);
    });

    it("strips blockquote prefixes", () => {
      const ast = parseMarkdown("> line one\n> line two");
      const result = converter.fromAst(ast);
      expect(result).not.toContain(">");
      expect(result).toContain("line one");
      expect(result).toContain("line two");
    });
  });

  describe("toAst", () => {
    it("parses plain text", () => {
      const ast = converter.toAst("Hello world");
      const markdown = stringifyMarkdown(ast).trim();
      expect(markdown).toBe("Hello world");
    });

    it("parses markdown text", () => {
      const ast = converter.toAst("**bold** and *italic*");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    });
  });

  describe("renderPostable", () => {
    it("renders string messages", () => {
      expect(converter.renderPostable("Hello")).toBe("Hello");
    });

    it("renders raw messages", () => {
      expect(converter.renderPostable({ raw: "raw text" })).toBe("raw text");
    });

    it("renders markdown messages", () => {
      const result = converter.renderPostable({ markdown: "**bold**" });
      expect(result).toBe("bold");
    });

    it("renders AST messages", () => {
      const ast = parseMarkdown("plain text");
      const result = converter.renderPostable({ ast });
      expect(result).toBe("plain text");
    });
  });
});
