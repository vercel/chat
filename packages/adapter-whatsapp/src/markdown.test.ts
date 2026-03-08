import { describe, expect, it } from "vitest";
import { WhatsAppFormatConverter } from "./markdown";

describe("WhatsAppFormatConverter", () => {
  const converter = new WhatsAppFormatConverter();

  describe("toAst", () => {
    it("should parse plain text", () => {
      const ast = converter.toAst("Hello world");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    });

    it("should parse WhatsApp bold (*text*) as standard bold", () => {
      const ast = converter.toAst("*bold text*");
      expect(ast.type).toBe("root");
    });

    it("should parse italic (_text_)", () => {
      const ast = converter.toAst("_italic text_");
      expect(ast.type).toBe("root");
    });

    it("should parse WhatsApp strikethrough (~text~) as standard", () => {
      const ast = converter.toAst("~strikethrough~");
      expect(ast.type).toBe("root");
    });

    it("should not merge bold spans across newlines", () => {
      const ast = converter.toAst("*bold1*\nsome text\n*bold2*");
      const result = converter.fromAst(ast);
      // Each bold span should remain separate, not merge into one
      expect(result).toContain("*bold1*");
      expect(result).toContain("*bold2*");
    });

    it("should parse code blocks", () => {
      const ast = converter.toAst("```\ncode\n```");
      expect(ast.type).toBe("root");
    });

    it("should parse lists", () => {
      const ast = converter.toAst("- item 1\n- item 2\n- item 3");
      expect(ast.type).toBe("root");
    });
  });

  describe("fromAst", () => {
    it("should stringify a simple AST", () => {
      const ast = converter.toAst("Hello world");
      const result = converter.fromAst(ast);
      expect(result).toContain("Hello world");
    });

    it("should convert standard bold to WhatsApp bold", () => {
      // Create AST from standard markdown with double asterisks
      const ast = converter.toAst("**bold text**");
      const result = converter.fromAst(ast);
      // Should output WhatsApp-style single asterisk bold
      expect(result).toContain("*bold text*");
      expect(result).not.toContain("**bold text**");
    });

    it("should convert standard strikethrough to WhatsApp style", () => {
      const ast = converter.toAst("~~strikethrough~~");
      const result = converter.fromAst(ast);
      expect(result).toContain("~strikethrough~");
      expect(result).not.toContain("~~strikethrough~~");
    });

    it("should preserve escaped asterisks and tildes as literals", () => {
      const ast = converter.toAst("a \\* b and c \\~ d");
      const result = converter.fromAst(ast);
      expect(result).toContain("\\*");
      expect(result).toContain("\\~");
    });

    it("should convert standard italic to WhatsApp underscore italic", () => {
      // Standard markdown _italic_ renders as emphasis in the AST.
      // WhatsApp uses *text* for bold, so emphasis must become _text_.
      const result = converter.renderPostable({ markdown: "_italic text_" });
      expect(result).toContain("_italic text_");
      expect(result).not.toContain("*italic text*");
    });

    it("should handle bold and italic together", () => {
      const result = converter.renderPostable({
        markdown: "**bold** and _italic_",
      });
      expect(result).toContain("*bold*");
      expect(result).toContain("_italic_");
    });

    it("should convert headings to bold text", () => {
      const ast = converter.toAst("# Main heading");
      const result = converter.fromAst(ast);
      expect(result).toContain("*Main heading*");
      expect(result).not.toContain("#");
    });

    it("should flatten bold inside headings to avoid triple asterisks", () => {
      const result = converter.renderPostable({
        markdown: "## **Choose React if:**",
      });
      expect(result).toContain("*Choose React if:*");
      expect(result).not.toContain("***");
    });

    it("should handle headings with mixed text and bold", () => {
      const result = converter.renderPostable({
        markdown: "# The Honest Answer: **It Depends!** 🤷‍♂️",
      });
      expect(result).toContain("*The Honest Answer: It Depends! 🤷‍♂️*");
      expect(result).not.toContain("**");
    });

    it("should convert thematic breaks to text separator", () => {
      const ast = converter.toAst("above\n\n---\n\nbelow");
      const result = converter.fromAst(ast);
      expect(result).toContain("━━━");
      expect(result).toContain("above");
      expect(result).toContain("below");
    });

    it("should convert tables to code blocks", () => {
      const ast = converter.toAst("| A | B |\n| --- | --- |\n| 1 | 2 |");
      const result = converter.fromAst(ast);
      // Should be in a code block, not raw pipe syntax
      expect(result).toContain("```");
    });
  });

  describe("renderPostable", () => {
    it("should render a plain string", () => {
      const result = converter.renderPostable("Hello world");
      expect(result).toBe("Hello world");
    });

    it("should render a raw message", () => {
      const result = converter.renderPostable({ raw: "raw content" });
      expect(result).toBe("raw content");
    });

    it("should render a markdown message", () => {
      const result = converter.renderPostable({
        markdown: "**bold** text",
      });
      expect(result).toContain("bold");
    });

    it("should render an AST message", () => {
      const ast = converter.toAst("Hello from AST");
      const result = converter.renderPostable({ ast });
      expect(result).toContain("Hello from AST");
    });

    it("should correctly convert a complex AI-style markdown response", () => {
      const markdown = [
        "# The Answer: **It Depends!**",
        "",
        "There's no universal *better* choice.",
        "",
        "## **Choose React if:**",
        "- Building **large-scale** apps",
        "- Need the biggest *ecosystem*",
        "- **Examples:** Facebook, Netflix",
        "",
        "## **Choose Vue if:**",
        "- Want *faster* learning curve",
        "- Prefer ~~complex~~ cleaner templates",
        "",
        "---",
        "",
        "## Real Talk:",
        "**All three are excellent.** Learn *React* first!",
      ].join("\n");

      const result = converter.renderPostable({ markdown });

      expect(result).toBe(`*The Answer: It Depends!*

There's no universal _better_ choice.

*Choose React if:*

- Building *large-scale* apps
- Need the biggest _ecosystem_
- *Examples:* Facebook, Netflix

*Choose Vue if:*

- Want _faster_ learning curve
- Prefer ~complex~ cleaner templates

━━━

*Real Talk:*

*All three are excellent.* Learn _React_ first!`);
    });
  });
});
