/**
 * Tests for markdown parsing, AST building, and format conversion utilities.
 */

import type { Root } from "mdast";
import { describe, expect, it } from "vitest";
import {
  Actions,
  Button,
  Card,
  Text as CardText,
  Field,
  Fields,
} from "./cards";
import {
  BaseFormatConverter,
  blockquote,
  codeBlock,
  emphasis,
  inlineCode,
  link,
  markdownToPlainText,
  paragraph,
  parseMarkdown,
  root,
  strikethrough,
  stringifyMarkdown,
  strong,
  text,
  toPlainText,
  walkAst,
} from "./markdown";

// ============================================================================
// parseMarkdown Tests
// ============================================================================

describe("parseMarkdown", () => {
  it("parses plain text", () => {
    const ast = parseMarkdown("Hello, world!");
    expect(ast.type).toBe("root");
    expect(ast.children).toHaveLength(1);
    expect(ast.children[0].type).toBe("paragraph");
  });

  it("parses bold text", () => {
    const ast = parseMarkdown("**bold**");
    const para = ast.children[0] as { children: Array<{ type: string }> };
    expect(para.children[0].type).toBe("strong");
  });

  it("parses italic text", () => {
    const ast = parseMarkdown("_italic_");
    const para = ast.children[0] as { children: Array<{ type: string }> };
    expect(para.children[0].type).toBe("emphasis");
  });

  it("parses strikethrough (GFM)", () => {
    const ast = parseMarkdown("~~deleted~~");
    const para = ast.children[0] as { children: Array<{ type: string }> };
    expect(para.children[0].type).toBe("delete");
  });

  it("parses inline code", () => {
    const ast = parseMarkdown("`code`");
    const para = ast.children[0] as { children: Array<{ type: string }> };
    expect(para.children[0].type).toBe("inlineCode");
  });

  it("parses code blocks", () => {
    const ast = parseMarkdown("```javascript\nconst x = 1;\n```");
    expect(ast.children[0].type).toBe("code");
    const codeNode = ast.children[0] as { lang: string; value: string };
    expect(codeNode.lang).toBe("javascript");
    expect(codeNode.value).toBe("const x = 1;");
  });

  it("parses links", () => {
    const ast = parseMarkdown("[text](https://example.com)");
    const para = ast.children[0] as {
      children: Array<{ type: string; url?: string }>;
    };
    expect(para.children[0].type).toBe("link");
    expect(para.children[0].url).toBe("https://example.com");
  });

  it("parses blockquotes", () => {
    const ast = parseMarkdown("> quoted text");
    expect(ast.children[0].type).toBe("blockquote");
  });

  it("parses unordered lists", () => {
    const ast = parseMarkdown("- item 1\n- item 2");
    expect(ast.children[0].type).toBe("list");
    const list = ast.children[0] as { ordered: boolean };
    expect(list.ordered).toBe(false);
  });

  it("parses ordered lists", () => {
    const ast = parseMarkdown("1. first\n2. second");
    expect(ast.children[0].type).toBe("list");
    const list = ast.children[0] as { ordered: boolean };
    expect(list.ordered).toBe(true);
  });

  it("handles nested formatting", () => {
    const ast = parseMarkdown("**_bold italic_**");
    const para = ast.children[0] as {
      children: Array<{ type: string; children: Array<{ type: string }> }>;
    };
    expect(para.children[0].type).toBe("strong");
    expect(para.children[0].children[0].type).toBe("emphasis");
  });

  it("handles empty string", () => {
    const ast = parseMarkdown("");
    expect(ast.type).toBe("root");
    expect(ast.children).toHaveLength(0);
  });

  it("handles multiple paragraphs", () => {
    const ast = parseMarkdown("First paragraph.\n\nSecond paragraph.");
    expect(ast.children).toHaveLength(2);
    expect(ast.children[0].type).toBe("paragraph");
    expect(ast.children[1].type).toBe("paragraph");
  });
});

// ============================================================================
// stringifyMarkdown Tests
// ============================================================================

describe("stringifyMarkdown", () => {
  it("stringifies a simple AST", () => {
    const ast = root([paragraph([text("Hello")])]);
    const result = stringifyMarkdown(ast);
    expect(result.trim()).toBe("Hello");
  });

  it("stringifies bold text", () => {
    const ast = root([paragraph([strong([text("bold")])])]);
    const result = stringifyMarkdown(ast);
    expect(result.trim()).toBe("**bold**");
  });

  it("stringifies italic text", () => {
    const ast = root([paragraph([emphasis([text("italic")])])]);
    const result = stringifyMarkdown(ast);
    expect(result.trim()).toBe("*italic*");
  });

  it("stringifies inline code", () => {
    const ast = root([paragraph([inlineCode("code")])]);
    const result = stringifyMarkdown(ast);
    expect(result.trim()).toBe("`code`");
  });

  it("stringifies links", () => {
    const ast = root([
      paragraph([link("https://example.com", [text("link")])]),
    ]);
    const result = stringifyMarkdown(ast);
    expect(result.trim()).toBe("[link](https://example.com)");
  });

  it("round-trips markdown correctly", () => {
    const original = "**bold** and _italic_ and `code`";
    const ast = parseMarkdown(original);
    const result = stringifyMarkdown(ast);
    // Parse again to normalize
    const reparsed = parseMarkdown(result);
    expect(reparsed.children.length).toBe(ast.children.length);
  });
});

// ============================================================================
// toPlainText Tests
// ============================================================================

describe("toPlainText", () => {
  it("extracts plain text from AST", () => {
    const ast = parseMarkdown("**bold** and _italic_");
    const result = toPlainText(ast);
    expect(result).toBe("bold and italic");
  });

  it("extracts text from code blocks", () => {
    const ast = parseMarkdown("```\ncode block\n```");
    const result = toPlainText(ast);
    expect(result).toBe("code block");
  });

  it("extracts text from links", () => {
    const ast = parseMarkdown("[link text](https://example.com)");
    const result = toPlainText(ast);
    expect(result).toBe("link text");
  });

  it("handles empty AST", () => {
    const ast = root([]);
    const result = toPlainText(ast);
    expect(result).toBe("");
  });
});

// ============================================================================
// markdownToPlainText Tests
// ============================================================================

describe("markdownToPlainText", () => {
  it("converts markdown to plain text directly", () => {
    const result = markdownToPlainText("**bold** and _italic_");
    expect(result).toBe("bold and italic");
  });

  it("handles complex markdown", () => {
    const result = markdownToPlainText("# Heading\n\nParagraph with `code`.");
    expect(result).toContain("Heading");
    expect(result).toContain("Paragraph with code");
  });
});

// ============================================================================
// walkAst Tests
// ============================================================================

describe("walkAst", () => {
  it("visits all nodes", () => {
    const ast = parseMarkdown("**bold** and _italic_");
    const visited: string[] = [];

    walkAst(ast, (node) => {
      visited.push(node.type);
      return node;
    });

    expect(visited).toContain("paragraph");
    expect(visited).toContain("strong");
    expect(visited).toContain("emphasis");
    expect(visited).toContain("text");
  });

  it("allows filtering nodes by returning null", () => {
    const ast = parseMarkdown("**bold** and _italic_");

    const filtered = walkAst(ast, (node) => {
      // Remove all strong nodes
      if (node.type === "strong") {
        return null;
      }
      return node;
    });

    const plainText = toPlainText(filtered);
    expect(plainText).not.toContain("bold");
    expect(plainText).toContain("italic");
  });

  it("allows transforming nodes", () => {
    const ast = root([paragraph([text("hello")])]);

    const transformed = walkAst(ast, (node) => {
      if (node.type === "text") {
        return {
          ...node,
          value: (node as { value: string }).value.toUpperCase(),
        };
      }
      return node;
    });

    const result = toPlainText(transformed);
    expect(result).toBe("HELLO");
  });

  it("handles deeply nested structures", () => {
    const ast = parseMarkdown("> **_nested_ text**");
    const types: string[] = [];

    walkAst(ast, (node) => {
      types.push(node.type);
      return node;
    });

    expect(types).toContain("blockquote");
    expect(types).toContain("strong");
    expect(types).toContain("emphasis");
  });

  it("handles empty AST", () => {
    const ast = root([]);
    const visited: string[] = [];

    walkAst(ast, (node) => {
      visited.push(node.type);
      return node;
    });

    expect(visited).toHaveLength(0);
  });
});

// ============================================================================
// AST Builder Functions Tests
// ============================================================================

describe("AST builder functions", () => {
  describe("text", () => {
    it("creates a text node", () => {
      const node = text("hello");
      expect(node.type).toBe("text");
      expect(node.value).toBe("hello");
    });

    it("handles empty string", () => {
      const node = text("");
      expect(node.value).toBe("");
    });

    it("handles special characters", () => {
      const node = text('hello & world < > "');
      expect(node.value).toBe('hello & world < > "');
    });
  });

  describe("strong", () => {
    it("creates a strong node", () => {
      const node = strong([text("bold")]);
      expect(node.type).toBe("strong");
      expect(node.children).toHaveLength(1);
    });

    it("handles nested content", () => {
      const node = strong([emphasis([text("bold italic")])]);
      expect(node.children[0].type).toBe("emphasis");
    });
  });

  describe("emphasis", () => {
    it("creates an emphasis node", () => {
      const node = emphasis([text("italic")]);
      expect(node.type).toBe("emphasis");
      expect(node.children).toHaveLength(1);
    });
  });

  describe("strikethrough", () => {
    it("creates a delete node", () => {
      const node = strikethrough([text("deleted")]);
      expect(node.type).toBe("delete");
      expect(node.children).toHaveLength(1);
    });
  });

  describe("inlineCode", () => {
    it("creates an inline code node", () => {
      const node = inlineCode("const x = 1");
      expect(node.type).toBe("inlineCode");
      expect(node.value).toBe("const x = 1");
    });
  });

  describe("codeBlock", () => {
    it("creates a code block node", () => {
      const node = codeBlock("function() {}", "javascript");
      expect(node.type).toBe("code");
      expect(node.value).toBe("function() {}");
      expect(node.lang).toBe("javascript");
    });

    it("handles missing language", () => {
      const node = codeBlock("plain code");
      expect(node.lang).toBeUndefined();
    });
  });

  describe("link", () => {
    it("creates a link node", () => {
      const node = link("https://example.com", [text("Example")]);
      expect(node.type).toBe("link");
      expect(node.url).toBe("https://example.com");
      expect(node.children).toHaveLength(1);
    });

    it("handles title", () => {
      const node = link("https://example.com", [text("Example")], "Title");
      expect(node.title).toBe("Title");
    });
  });

  describe("blockquote", () => {
    it("creates a blockquote node", () => {
      const node = blockquote([paragraph([text("quoted")])]);
      expect(node.type).toBe("blockquote");
      expect(node.children).toHaveLength(1);
    });
  });

  describe("paragraph", () => {
    it("creates a paragraph node", () => {
      const node = paragraph([text("content")]);
      expect(node.type).toBe("paragraph");
      expect(node.children).toHaveLength(1);
    });
  });

  describe("root", () => {
    it("creates a root node", () => {
      const node = root([paragraph([text("content")])]);
      expect(node.type).toBe("root");
      expect(node.children).toHaveLength(1);
    });

    it("handles empty children", () => {
      const node = root([]);
      expect(node.children).toHaveLength(0);
    });
  });
});

// ============================================================================
// BaseFormatConverter Tests
// ============================================================================

describe("BaseFormatConverter", () => {
  // Create a simple test implementation
  class TestConverter extends BaseFormatConverter {
    fromAst(ast: Root): string {
      return toPlainText(ast);
    }

    toAst(text: string): Root {
      return parseMarkdown(text);
    }
  }

  const converter = new TestConverter();

  describe("extractPlainText", () => {
    it("extracts plain text from platform format", () => {
      const result = converter.extractPlainText("**bold** text");
      expect(result).toBe("bold text");
    });
  });

  describe("fromMarkdown", () => {
    it("converts markdown to platform format", () => {
      const result = converter.fromMarkdown("**bold**");
      expect(result).toBe("bold");
    });
  });

  describe("toMarkdown", () => {
    it("converts platform format to markdown", () => {
      const result = converter.toMarkdown("plain text");
      expect(result.trim()).toBe("plain text");
    });
  });

  describe("renderPostable", () => {
    it("handles string input", () => {
      const result = converter.renderPostable("plain string");
      expect(result).toBe("plain string");
    });

    it("handles raw message", () => {
      const result = converter.renderPostable({ raw: "raw text" });
      expect(result).toBe("raw text");
    });

    it("handles markdown message", () => {
      const result = converter.renderPostable({ markdown: "**bold**" });
      expect(result).toBe("bold");
    });

    it("handles AST message", () => {
      const ast = root([paragraph([text("from ast")])]);
      const result = converter.renderPostable({ ast });
      expect(result).toBe("from ast");
    });

    it("handles card with fallback text", () => {
      const card = Card({ title: "Title", children: [CardText("Content")] });
      const result = converter.renderPostable({
        card,
        fallbackText: "Custom fallback",
      });
      expect(result).toBe("Custom fallback");
    });

    it("generates fallback text from card", () => {
      const card = Card({
        title: "Order Status",
        subtitle: "Your order details",
        children: [CardText("Processing your order...")],
      });
      const result = converter.renderPostable({ card });
      expect(result).toContain("Order Status");
      expect(result).toContain("Your order details");
      expect(result).toContain("Processing your order...");
    });

    it("handles card with actions", () => {
      const card = Card({
        title: "Confirm",
        children: [
          Actions([
            Button({ id: "yes", label: "Yes" }),
            Button({ id: "no", label: "No" }),
          ]),
        ],
      });
      const result = converter.renderPostable({ card });
      expect(result).toContain("Confirm");
      // Actions excluded from fallback — interactive elements aren't meaningful in notifications
      expect(result).not.toContain("[Yes]");
      expect(result).not.toContain("[No]");
    });

    it("handles card with fields", () => {
      const card = Card({
        children: [
          Fields([
            Field({ label: "Name", value: "John" }),
            Field({ label: "Email", value: "john@example.com" }),
          ]),
        ],
      });
      const result = converter.renderPostable({ card });
      expect(result).toContain("**Name**: John");
      expect(result).toContain("**Email**: john@example.com");
    });

    it("handles direct CardElement", () => {
      const card = Card({ title: "Direct Card" });
      const result = converter.renderPostable(card);
      expect(result).toContain("Direct Card");
    });

    it("throws on invalid input", () => {
      // @ts-expect-error Testing invalid input
      expect(() => converter.renderPostable({ invalid: true })).toThrow();
    });
  });
});
