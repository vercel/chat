import { parseMarkdown } from "chat";
import { describe, expect, it } from "vitest";
import { XFormatConverter } from "./markdown";

const converter = new XFormatConverter();

describe("XFormatConverter", () => {
  describe("toAst", () => {
    it("parses plain text into paragraphs", () => {
      const ast = converter.toAst("first block\n\nsecond block");
      expect(ast.children).toHaveLength(2);
      expect(ast.children[0].type).toBe("paragraph");
      expect(ast.children[1].type).toBe("paragraph");
    });

    it("does not treat hashtags as headings", () => {
      const ast = converter.toAst("#launch day");
      expect(ast.children[0].type).toBe("paragraph");
      expect(converter.extractPlainText("#launch day")).toBe("#launch day");
    });

    it("does not treat asterisks as emphasis", () => {
      expect(converter.extractPlainText("2 * 3 * 4")).toBe("2 * 3 * 4");
    });

    it("promotes URLs to link nodes", () => {
      const ast = converter.toAst("see https://chat-sdk.dev for docs");
      const paragraph = ast.children[0];
      expect(paragraph.type).toBe("paragraph");
      if (paragraph.type !== "paragraph") {
        return;
      }
      expect(paragraph.children.map((child) => child.type)).toEqual([
        "text",
        "link",
        "text",
      ]);
      const link = paragraph.children[1];
      if (link.type === "link") {
        expect(link.url).toBe("https://chat-sdk.dev");
      }
    });

    it("preserves single newlines inside a block", () => {
      expect(converter.extractPlainText("line one\nline two")).toBe(
        "line one\nline two"
      );
    });
  });

  describe("fromAst", () => {
    it("strips bold and italic markers", () => {
      const ast = parseMarkdown("**bold** and *italic*");
      expect(converter.fromAst(ast)).toBe("bold and italic");
    });

    it("renders links as label (url)", () => {
      const ast = parseMarkdown("[docs](https://chat-sdk.dev)");
      expect(converter.fromAst(ast)).toBe("docs (https://chat-sdk.dev)");
    });

    it("renders bare links as the url only", () => {
      const ast = parseMarkdown("<https://chat-sdk.dev>");
      expect(converter.fromAst(ast)).toBe("https://chat-sdk.dev");
    });

    it("renders unordered lists with bullets", () => {
      const ast = parseMarkdown("- one\n- two");
      expect(converter.fromAst(ast)).toBe("• one\n• two");
    });

    it("renders ordered lists with numbers", () => {
      const ast = parseMarkdown("1. one\n2. two");
      expect(converter.fromAst(ast)).toBe("1. one\n2. two");
    });

    it("keeps code block content without fences", () => {
      const ast = parseMarkdown("```ts\nconst a = 1;\n```");
      expect(converter.fromAst(ast)).toBe("const a = 1;");
    });

    it("flattens headings to plain text", () => {
      const ast = parseMarkdown("# Title");
      expect(converter.fromAst(ast)).toBe("Title");
    });

    it("renders tables as ascii", () => {
      const ast = parseMarkdown("| a | b |\n| - | - |\n| 1 | 2 |");
      const output = converter.fromAst(ast);
      expect(output).toContain("a");
      expect(output).toContain("|");
      expect(output).toContain("1");
    });
  });

  describe("renderPostable", () => {
    it("passes strings through untouched", () => {
      expect(converter.renderPostable("raw *text*")).toBe("raw *text*");
    });

    it("flattens markdown input", () => {
      expect(converter.renderPostable({ markdown: "**hi** there" })).toBe(
        "hi there"
      );
    });
  });
});
