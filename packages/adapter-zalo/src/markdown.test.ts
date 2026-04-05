import { describe, expect, it } from "vitest";
import { ZaloFormatConverter } from "./markdown";

const ASTERISK_ITALIC_PATTERN = /\*italic\*/;
const HEADING_PREFIX_PATTERN = /^#/;
const PIPE_TABLE_NAME_PATTERN = /\|.*Name.*\|/;
const UNDERSCORE_ITALIC_PATTERN = /_italic_/;

describe("ZaloFormatConverter", () => {
  const converter = new ZaloFormatConverter();

  // -------------------------------------------------------------------------
  // fromAst (AST -> plain text)
  // -------------------------------------------------------------------------

  describe("fromAst (AST -> plain text)", () => {
    it("plain text paragraph", () => {
      const result = converter.fromAst(converter.toAst("Hello world"));
      expect(result).toContain("Hello world");
    });

    it("strips bold markers", () => {
      const result = converter.fromAst(converter.toAst("**bold text**"));
      expect(result).toContain("bold text");
      expect(result).not.toContain("**");
    });

    it("strips italic underscore markers", () => {
      const result = converter.fromAst(converter.toAst("_italic text_"));
      expect(result).toContain("italic text");
      expect(result).not.toContain("_italic");
    });

    it("strips asterisk italic markers", () => {
      const result = converter.fromAst(converter.toAst("*italic*"));
      expect(result).toContain("italic");
      expect(result).not.toMatch(ASTERISK_ITALIC_PATTERN);
    });

    it("strips strikethrough markers", () => {
      const result = converter.fromAst(converter.toAst("~~strike~~"));
      expect(result).toContain("strike");
      expect(result).not.toContain("~~");
    });

    it("keeps link text (links preserved as markdown)", () => {
      const result = converter.fromAst(
        converter.toAst("[link text](https://example.com)")
      );
      expect(result).toContain("link text");
    });

    it("preserves inline code text", () => {
      const result = converter.fromAst(converter.toAst("Use `const x = 1`"));
      expect(result).toContain("const x = 1");
    });

    it("preserves code block content", () => {
      const result = converter.fromAst(
        converter.toAst("```js\nconst x = 1;\n```")
      );
      expect(result).toContain("const x = 1;");
    });

    it("converts heading to plain paragraph", () => {
      const result = converter.fromAst(converter.toAst("# Heading text"));
      expect(result).toContain("Heading text");
      expect(result).not.toMatch(HEADING_PREFIX_PATTERN);
    });

    it("unwraps bold inside heading", () => {
      // "## **Bold heading**" → heading child is `strong` → branch that extracts children
      const result = converter.fromAst(converter.toAst("## **Bold heading**"));
      expect(result).toContain("Bold heading");
      expect(result).not.toContain("**");
    });

    it("converts thematic break to ---", () => {
      const result = converter.fromAst(converter.toAst("---"));
      expect(result).toContain("---");
    });

    it("converts table to ASCII code block", () => {
      const table = "| Name | Age |\n|------|-----|\n| Alice | 30 |";
      const result = converter.fromAst(converter.toAst(table));
      expect(result).toContain("```");
      expect(result).toContain("Name");
      expect(result).toContain("Alice");
      expect(result).not.toMatch(PIPE_TABLE_NAME_PATTERN);
    });
  });

  // -------------------------------------------------------------------------
  // toAst (plain text -> AST)
  // -------------------------------------------------------------------------

  describe("toAst (plain text -> AST)", () => {
    it("parses plain text", () => {
      const ast = converter.toAst("Hello world");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    });

    it("parses text with markdown", () => {
      const ast = converter.toAst("**bold**");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    });

    it("parses inline code", () => {
      const ast = converter.toAst("`code`");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // renderPostable
  // -------------------------------------------------------------------------

  describe("renderPostable", () => {
    it("plain string returned as-is", () => {
      expect(converter.renderPostable("Hello world")).toBe("Hello world");
    });

    it("empty string unchanged", () => {
      expect(converter.renderPostable("")).toBe("");
    });

    it("raw message returned as-is", () => {
      expect(converter.renderPostable({ raw: "raw content" })).toBe(
        "raw content"
      );
    });

    it("markdown message stripped of formatting", () => {
      const result = converter.renderPostable({ markdown: "**bold** text" });
      expect(result).toContain("bold");
      expect(result).not.toContain("**");
    });

    it("ast message rendered as plain text", () => {
      const result = converter.renderPostable({
        ast: converter.toAst("Hello from AST"),
      });
      expect(result).toContain("Hello from AST");
    });

    it("markdown with bold and italic stripped", () => {
      const result = converter.renderPostable({
        markdown: "**bold** and _italic_",
      });
      expect(result).toContain("bold");
      expect(result).toContain("italic");
      expect(result).not.toContain("**");
      expect(result).not.toMatch(UNDERSCORE_ITALIC_PATTERN);
    });

    it("table rendered as ASCII code block", () => {
      const result = converter.renderPostable({
        markdown: "| A | B |\n| --- | --- |\n| 1 | 2 |",
      });
      expect(result).toContain("```");
      expect(result).toContain("A");
    });

    it("card message with fallback text uses base fallback", () => {
      // Hits the super.renderPostable() path for unhandled message shapes
      const result = converter.renderPostable({
        card: { title: "Hello", sections: [] },
        fallbackText: "fallback plain text",
      } as unknown as Parameters<typeof converter.renderPostable>[0]);
      expect(result).toContain("fallback");
    });
  });

  // -------------------------------------------------------------------------
  // stripFormatting (exercised via renderPostable)
  // -------------------------------------------------------------------------

  describe("stripFormatting (plain text output)", () => {
    it("strips **bold**", () => {
      expect(converter.renderPostable({ markdown: "Hello **world**!" })).toBe(
        "Hello world!"
      );
    });

    it("strips *italic*", () => {
      expect(converter.renderPostable({ markdown: "Hello *world*!" })).toBe(
        "Hello world!"
      );
    });

    it("strips _italic_", () => {
      expect(converter.renderPostable({ markdown: "Hello _world_!" })).toBe(
        "Hello world!"
      );
    });

    it("strips ~~strike~~", () => {
      expect(converter.renderPostable({ markdown: "Hello ~~world~~!" })).toBe(
        "Hello world!"
      );
    });

    it("strips all formatting in combination", () => {
      const result = converter.renderPostable({
        markdown: "**Bold** and _italic_ and ~~strike~~",
      });
      expect(result).not.toContain("**");
      expect(result).not.toMatch(UNDERSCORE_ITALIC_PATTERN);
      expect(result).not.toContain("~~");
      expect(result).toContain("Bold");
      expect(result).toContain("italic");
      expect(result).toContain("strike");
    });
  });

  // -------------------------------------------------------------------------
  // roundtrip
  // -------------------------------------------------------------------------

  describe("roundtrip", () => {
    it("plain text preserved", () => {
      const input = "Hello world";
      const result = converter.fromAst(converter.toAst(input));
      expect(result).toContain("Hello world");
    });

    it("bold stripped on roundtrip", () => {
      const input = "**bold text**";
      const result = converter.fromAst(converter.toAst(input));
      expect(result).not.toContain("**");
      expect(result).toContain("bold text");
    });

    it("link text preserved (links kept as markdown)", () => {
      const input = "[click here](https://example.com)";
      const result = converter.fromAst(converter.toAst(input));
      expect(result).toContain("click here");
    });

    it("code block content preserved", () => {
      const input = "```\nconst x = 1;\n```";
      const result = converter.fromAst(converter.toAst(input));
      expect(result).toContain("const x = 1;");
    });

    it("table converted to ASCII on roundtrip", () => {
      const input = "| Col1 | Col2 |\n|------|------|\n| A | B |";
      const result = converter.fromAst(converter.toAst(input));
      expect(result).toContain("```");
      expect(result).toContain("Col1");
      expect(result).toContain("A");
    });
  });
});
