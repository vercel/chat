import { describe, expect, it } from "vitest";
import { WhatsAppFormatConverter } from "./markdown";

describe("WhatsAppFormatConverter", () => {
  const converter = new WhatsAppFormatConverter();

  describe("toAst", () => {
    it("parses plain text", () => {
      const ast = converter.toAst("Hello world");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    });

    it("parses WhatsApp bold format", () => {
      const text = "This is *bold* text";
      const ast = converter.toAst(text);
      expect(ast.type).toBe("root");
    });

    it("parses WhatsApp italic format", () => {
      const text = "This is _italic_ text";
      const ast = converter.toAst(text);
      expect(ast.type).toBe("root");
    });

    it("parses WhatsApp strikethrough format", () => {
      const text = "This is ~strikethrough~ text";
      const ast = converter.toAst(text);
      expect(ast.type).toBe("root");
    });
  });

  describe("fromAst", () => {
    it("renders bold as *text*", () => {
      const ast = converter.toAst("This is **bold** text");
      const result = converter.fromAst(ast);
      expect(result).toContain("*bold*");
    });

    it("renders italic as _text_", () => {
      const ast = converter.toAst("This is _italic_ text");
      const result = converter.fromAst(ast);
      expect(result).toContain("_italic_");
    });

    it("renders strikethrough as ~text~", () => {
      const ast = converter.toAst("This is ~~strikethrough~~ text");
      const result = converter.fromAst(ast);
      expect(result).toContain("~strikethrough~");
    });

    it("renders links as plain text with URL", () => {
      const ast = converter.toAst("[Click here](https://example.com)");
      const result = converter.fromAst(ast);
      expect(result).toContain("https://example.com");
    });

    it("renders unordered lists with bullets", () => {
      const ast = converter.toAst("- Item 1\n- Item 2");
      const result = converter.fromAst(ast);
      expect(result).toContain("•");
      expect(result).toContain("Item 1");
      expect(result).toContain("Item 2");
    });

    it("renders ordered lists with numbers", () => {
      const ast = converter.toAst("1. First\n2. Second");
      const result = converter.fromAst(ast);
      expect(result).toContain("1.");
      expect(result).toContain("2.");
    });
  });

  describe("renderPostable", () => {
    it("handles string input", () => {
      const result = converter.renderPostable("Hello");
      expect(result).toBe("Hello");
    });

    it("handles raw input", () => {
      const result = converter.renderPostable({ raw: "*bold*" });
      expect(result).toBe("*bold*");
    });

    it("handles markdown input", () => {
      const result = converter.renderPostable({ markdown: "**bold**" });
      expect(result).toContain("*bold*");
    });

    it("handles ast input", () => {
      const ast = converter.toAst("Hello world");
      const result = converter.renderPostable({ ast });
      expect(result).toContain("Hello");
      expect(result).toContain("world");
    });
  });

  describe("extractPlainText", () => {
    it("extracts plain text from WhatsApp formatted text", () => {
      const text = "Hello *bold* and _italic_ text";
      const result = converter.extractPlainText(text);
      expect(result).toContain("Hello");
      expect(result).toContain("bold");
      expect(result).toContain("italic");
    });
  });
});
