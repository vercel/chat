import { describe, expect, it } from "vitest";
import { GitHubFormatConverter } from "./markdown";

describe("GitHubFormatConverter", () => {
  const converter = new GitHubFormatConverter();

  describe("toAst", () => {
    it("should parse plain text", () => {
      const ast = converter.toAst("Hello world");
      expect(ast.type).toBe("root");
      expect(ast.children).toHaveLength(1);
    });

    it("should parse bold text", () => {
      const ast = converter.toAst("**bold text**");
      expect(ast.type).toBe("root");
      // The AST should contain a strong node
      const paragraph = ast.children[0];
      expect(paragraph.type).toBe("paragraph");
    });

    it("should parse @mentions", () => {
      const _ast = converter.toAst("Hey @username, check this out");
      const text = converter.extractPlainText("Hey @username, check this out");
      expect(text).toContain("@username");
    });

    it("should parse code blocks", () => {
      const ast = converter.toAst("```javascript\nconsole.log('hello');\n```");
      expect(ast.type).toBe("root");
    });

    it("should parse links", () => {
      const ast = converter.toAst("[link text](https://example.com)");
      expect(ast.type).toBe("root");
    });

    it("should parse strikethrough", () => {
      const ast = converter.toAst("~~deleted~~");
      expect(ast.type).toBe("root");
    });
  });

  describe("fromAst", () => {
    it("should render plain text", () => {
      const ast = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [{ type: "text" as const, value: "Hello world" }],
          },
        ],
      };
      const result = converter.fromAst(ast);
      expect(result).toBe("Hello world");
    });

    it("should render bold text", () => {
      const ast = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [
              {
                type: "strong" as const,
                children: [{ type: "text" as const, value: "bold" }],
              },
            ],
          },
        ],
      };
      const result = converter.fromAst(ast);
      expect(result).toBe("**bold**");
    });

    it("should render italic text", () => {
      const ast = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [
              {
                type: "emphasis" as const,
                children: [{ type: "text" as const, value: "italic" }],
              },
            ],
          },
        ],
      };
      const result = converter.fromAst(ast);
      expect(result).toBe("*italic*");
    });
  });

  describe("extractPlainText", () => {
    it("should extract text from markdown", () => {
      const result = converter.extractPlainText("**bold** and _italic_");
      expect(result).toBe("bold and italic");
    });

    it("should preserve @mentions", () => {
      const result = converter.extractPlainText("Hey @user, **thanks**!");
      expect(result).toContain("@user");
      expect(result).toContain("thanks");
    });

    it("should extract text from code blocks", () => {
      const result = converter.extractPlainText("```\ncode\n```");
      expect(result).toContain("code");
    });
  });

  describe("renderPostable", () => {
    it("should render string directly", () => {
      const result = converter.renderPostable("Hello world");
      expect(result).toBe("Hello world");
    });

    it("should render raw message", () => {
      const result = converter.renderPostable({ raw: "Raw content" });
      expect(result).toBe("Raw content");
    });

    it("should render markdown message", () => {
      const result = converter.renderPostable({ markdown: "**bold**" });
      expect(result).toBe("**bold**");
    });

    it("should render ast message", () => {
      const ast = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [{ type: "text" as const, value: "AST content" }],
          },
        ],
      };
      const result = converter.renderPostable({ ast });
      expect(result).toBe("AST content");
    });
  });

  describe("roundtrip", () => {
    it("should roundtrip simple text", () => {
      const original = "Hello world";
      const ast = converter.toAst(original);
      const result = converter.fromAst(ast);
      expect(result.trim()).toBe(original);
    });

    it("should roundtrip markdown with formatting", () => {
      const original = "**bold** and *italic*";
      const ast = converter.toAst(original);
      const result = converter.fromAst(ast);
      // Note: remark may normalize to different italic syntax
      expect(result).toContain("bold");
      expect(result).toContain("italic");
    });
  });
});
