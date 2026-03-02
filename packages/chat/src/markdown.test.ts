/**
 * Tests for markdown parsing, AST building, and format conversion utilities.
 */

import type { Content, Root } from "mdast";
import { describe, expect, it } from "vitest";
import {
  Actions,
  Button,
  Card,
  Text as CardText,
  Divider,
  Field,
  Fields,
  Section,
  Table,
} from "./cards";
import {
  BaseFormatConverter,
  blockquote,
  codeBlock,
  emphasis,
  getNodeChildren,
  getNodeValue,
  inlineCode,
  isBlockquoteNode,
  isCodeNode,
  isDeleteNode,
  isEmphasisNode,
  isInlineCodeNode,
  isLinkNode,
  isListItemNode,
  isListNode,
  isParagraphNode,
  isStrongNode,
  isTableCellNode,
  isTableNode,
  isTableRowNode,
  isTextNode,
  link,
  markdownToPlainText,
  paragraph,
  parseMarkdown,
  root,
  strikethrough,
  stringifyMarkdown,
  strong,
  tableElementToAscii,
  tableToAscii,
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

    it("handles card with table element", () => {
      const card = Card({
        children: [
          Table({
            headers: ["Name", "Age"],
            rows: [
              ["Alice", "30"],
              ["Bob", "25"],
            ],
          }),
        ],
      });
      const result = converter.renderPostable({ card });
      expect(result).toContain("Name");
      expect(result).toContain("Age");
      expect(result).toContain("Alice");
      expect(result).toContain("30");
    });
  });

  describe("deprecated toPlainText method", () => {
    it("extracts plain text from platform format", () => {
      const result = converter.toPlainText("**bold** text");
      expect(result).toBe("bold text");
    });
  });

  describe("fromAstWithNodeConverter", () => {
    class NodeConverterTestConverter extends BaseFormatConverter {
      fromAst(ast: Root): string {
        return this.fromAstWithNodeConverter(ast, (node) => {
          if (node.type === "paragraph") {
            return `[para:${toPlainText({ type: "root", children: [node] })}]`;
          }
          return toPlainText({ type: "root", children: [node] });
        });
      }

      toAst(inputText: string): Root {
        return parseMarkdown(inputText);
      }
    }

    const nodeConverter = new NodeConverterTestConverter();

    it("joins multiple paragraphs with double newlines", () => {
      const ast = root([
        paragraph([text("First")]),
        paragraph([text("Second")]),
      ]);
      const result = nodeConverter.fromAst(ast);
      expect(result).toBe("[para:First]\n\n[para:Second]");
    });

    it("handles single paragraph", () => {
      const ast = root([paragraph([text("Only")])]);
      const result = nodeConverter.fromAst(ast);
      expect(result).toBe("[para:Only]");
    });

    it("handles empty AST", () => {
      const ast = root([]);
      const result = nodeConverter.fromAst(ast);
      expect(result).toBe("");
    });
  });

  describe("cardToFallbackText via renderPostable", () => {
    it("handles card with section children", () => {
      const card = Card({
        children: [
          Section([CardText("Section content"), CardText("More content")]),
        ],
      });
      const result = converter.renderPostable({ card });
      expect(result).toContain("Section content");
      expect(result).toContain("More content");
    });

    it("handles card with only title (no children)", () => {
      const card = Card({ title: "Title Only" });
      const result = converter.renderPostable({ card });
      expect(result).toBe("**Title Only**");
    });

    it("handles card with divider child (returns null for divider)", () => {
      const card = Card({
        title: "With Divider",
        children: [Divider()],
      });
      const result = converter.renderPostable({ card });
      // Divider falls to default case and returns null, so only title
      expect(result).toBe("**With Divider**");
    });

    it("handles card with mixed children including actions (excluded)", () => {
      const card = Card({
        title: "Mixed",
        children: [
          CardText("Visible text"),
          Actions([Button({ id: "ok", label: "OK" })]),
          Fields([Field({ label: "Key", value: "Val" })]),
        ],
      });
      const result = converter.renderPostable({ card });
      expect(result).toContain("Visible text");
      expect(result).not.toContain("OK");
      expect(result).toContain("**Key**: Val");
    });
  });

  describe("fromAstWithNodeConverter", () => {
    it("joins multiple paragraphs with double newlines", () => {
      const ast = root([
        paragraph([text("First")]),
        paragraph([text("Second")]),
        paragraph([text("Third")]),
      ]);
      const result = converter.fromAst(ast);
      // TestConverter uses toPlainText which concatenates
      expect(result).toContain("First");
      expect(result).toContain("Second");
      expect(result).toContain("Third");
    });
  });
});

// ============================================================================
// Table Parsing and Rendering Tests
// ============================================================================

describe("parseMarkdown (tables)", () => {
  it("parses GFM tables", () => {
    const ast = parseMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
    expect(ast.children[0].type).toBe("table");
  });

  it("parses table with multiple rows", () => {
    const md = "| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |";
    const ast = parseMarkdown(md);
    const table = ast.children[0] as import("mdast").Table;
    expect(table.type).toBe("table");
    expect(table.children).toHaveLength(3); // header + 2 data rows
  });
});

describe("table type guards", () => {
  it("isTableNode identifies table nodes", () => {
    const ast = parseMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
    const tableNode = ast.children[0] as import("mdast").Content;
    expect(isTableNode(tableNode)).toBe(true);
    expect(isTableNode({ type: "paragraph" } as import("mdast").Content)).toBe(
      false
    );
  });

  it("isTableRowNode identifies table row nodes", () => {
    const ast = parseMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
    const table = ast.children[0] as import("mdast").Table;
    const row = table.children[0] as import("mdast").Content;
    expect(isTableRowNode(row)).toBe(true);
  });

  it("isTableCellNode identifies table cell nodes", () => {
    const ast = parseMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
    const table = ast.children[0] as import("mdast").Table;
    const row = table.children[0];
    const cell = row.children[0] as import("mdast").Content;
    expect(isTableCellNode(cell)).toBe(true);
  });
});

describe("tableToAscii", () => {
  it("renders a simple table", () => {
    const ast = parseMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
    const table = ast.children[0] as import("mdast").Table;
    const result = tableToAscii(table);
    expect(result).toContain("A");
    expect(result).toContain("B");
    expect(result).toContain("1");
    expect(result).toContain("2");
    // Separator line with dashes
    expect(result).toContain("-|");
  });

  it("pads columns to equal width", () => {
    const md = "| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |";
    const ast = parseMarkdown(md);
    const table = ast.children[0] as import("mdast").Table;
    const result = tableToAscii(table);
    const lines = result.split("\n");
    // Header
    expect(lines[0]).toBe("Name  | Age");
    // Separator
    expect(lines[1]).toBe("------|----");
    // Data rows
    expect(lines[2]).toBe("Alice | 30");
    expect(lines[3]).toBe("Bob   | 25");
  });

  it("handles empty table", () => {
    const table: import("mdast").Table = {
      type: "table",
      children: [],
    };
    expect(tableToAscii(table)).toBe("");
  });
});

describe("tableElementToAscii", () => {
  it("renders headers and rows", () => {
    const result = tableElementToAscii(
      ["Name", "Age"],
      [
        ["Alice", "30"],
        ["Bob", "25"],
      ]
    );
    const lines = result.split("\n");
    expect(lines).toHaveLength(4); // header + separator + 2 data rows
    expect(lines[0]).toContain("Name");
    expect(lines[0]).toContain("Age");
    expect(lines[1]).toContain("---");
    expect(lines[2]).toContain("Alice");
    expect(lines[3]).toContain("Bob");
  });

  it("pads columns correctly", () => {
    const result = tableElementToAscii(
      ["Name", "Age", "Role"],
      [
        ["Alice", "30", "Engineer"],
        ["Bob", "25", "Designer"],
      ]
    );
    const lines = result.split("\n");
    expect(lines[0]).toBe("Name  | Age | Role");
    expect(lines[2]).toBe("Alice | 30  | Engineer");
    expect(lines[3]).toBe("Bob   | 25  | Designer");
  });
});

// ============================================================================
// Type Guard Tests
// ============================================================================

describe("Type guards", () => {
  describe("isTextNode", () => {
    it("returns true for text nodes", () => {
      const node: Content = { type: "text", value: "hello" };
      expect(isTextNode(node)).toBe(true);
    });

    it("returns false for non-text nodes", () => {
      const node: Content = { type: "paragraph", children: [] };
      expect(isTextNode(node)).toBe(false);
    });
  });

  describe("isParagraphNode", () => {
    it("returns true for paragraph nodes", () => {
      const node: Content = { type: "paragraph", children: [] };
      expect(isParagraphNode(node)).toBe(true);
    });

    it("returns false for non-paragraph nodes", () => {
      const node: Content = { type: "text", value: "hello" };
      expect(isParagraphNode(node)).toBe(false);
    });
  });

  describe("isStrongNode", () => {
    it("returns true for strong nodes", () => {
      const node: Content = {
        type: "strong",
        children: [{ type: "text", value: "bold" }],
      };
      expect(isStrongNode(node)).toBe(true);
    });

    it("returns false for non-strong nodes", () => {
      const node: Content = {
        type: "emphasis",
        children: [{ type: "text", value: "italic" }],
      };
      expect(isStrongNode(node)).toBe(false);
    });
  });

  describe("isEmphasisNode", () => {
    it("returns true for emphasis nodes", () => {
      const node: Content = {
        type: "emphasis",
        children: [{ type: "text", value: "italic" }],
      };
      expect(isEmphasisNode(node)).toBe(true);
    });

    it("returns false for non-emphasis nodes", () => {
      const node: Content = { type: "text", value: "hello" };
      expect(isEmphasisNode(node)).toBe(false);
    });
  });

  describe("isDeleteNode", () => {
    it("returns true for delete (strikethrough) nodes", () => {
      const node: Content = {
        type: "delete",
        children: [{ type: "text", value: "deleted" }],
      };
      expect(isDeleteNode(node)).toBe(true);
    });

    it("returns false for non-delete nodes", () => {
      const node: Content = { type: "text", value: "hello" };
      expect(isDeleteNode(node)).toBe(false);
    });
  });

  describe("isInlineCodeNode", () => {
    it("returns true for inline code nodes", () => {
      const node: Content = { type: "inlineCode", value: "code" };
      expect(isInlineCodeNode(node)).toBe(true);
    });

    it("returns false for non-inline-code nodes", () => {
      const node: Content = { type: "code", value: "block code" };
      expect(isInlineCodeNode(node)).toBe(false);
    });
  });

  describe("isCodeNode", () => {
    it("returns true for code block nodes", () => {
      const node: Content = { type: "code", value: "const x = 1" };
      expect(isCodeNode(node)).toBe(true);
    });

    it("returns false for inline code nodes", () => {
      const node: Content = { type: "inlineCode", value: "code" };
      expect(isCodeNode(node)).toBe(false);
    });
  });

  describe("isLinkNode", () => {
    it("returns true for link nodes", () => {
      const node: Content = {
        type: "link",
        url: "https://example.com",
        children: [{ type: "text", value: "link" }],
      };
      expect(isLinkNode(node)).toBe(true);
    });

    it("returns false for non-link nodes", () => {
      const node: Content = { type: "text", value: "hello" };
      expect(isLinkNode(node)).toBe(false);
    });
  });

  describe("isBlockquoteNode", () => {
    it("returns true for blockquote nodes", () => {
      const node: Content = {
        type: "blockquote",
        children: [
          { type: "paragraph", children: [{ type: "text", value: "quoted" }] },
        ],
      };
      expect(isBlockquoteNode(node)).toBe(true);
    });

    it("returns false for non-blockquote nodes", () => {
      const node: Content = { type: "text", value: "hello" };
      expect(isBlockquoteNode(node)).toBe(false);
    });
  });

  describe("isListNode", () => {
    it("returns true for list nodes", () => {
      const ast = parseMarkdown("- item 1\n- item 2");
      const listNode = ast.children[0] as Content;
      expect(isListNode(listNode)).toBe(true);
    });

    it("returns false for non-list nodes", () => {
      const node: Content = { type: "text", value: "hello" };
      expect(isListNode(node)).toBe(false);
    });
  });

  describe("isListItemNode", () => {
    it("returns true for list item nodes", () => {
      const ast = parseMarkdown("- item 1");
      const listNode = ast.children[0] as { children: Content[] };
      const listItemNode = listNode.children[0];
      expect(isListItemNode(listItemNode)).toBe(true);
    });

    it("returns false for non-list-item nodes", () => {
      const node: Content = { type: "text", value: "hello" };
      expect(isListItemNode(node)).toBe(false);
    });
  });
});

// ============================================================================
// Helper Function Tests
// ============================================================================

describe("getNodeChildren", () => {
  it("returns children for paragraph node", () => {
    const node = paragraph([text("hello"), text(" world")]);
    const children = getNodeChildren(node);
    expect(children).toHaveLength(2);
    expect((children[0] as { value: string }).value).toBe("hello");
  });

  it("returns children for strong node", () => {
    const node = strong([text("bold")]);
    const children = getNodeChildren(node);
    expect(children).toHaveLength(1);
  });

  it("returns empty array for text node (no children)", () => {
    const node = text("hello");
    const children = getNodeChildren(node);
    expect(children).toEqual([]);
  });

  it("returns empty array for inline code node (no children)", () => {
    const node = inlineCode("code");
    const children = getNodeChildren(node);
    expect(children).toEqual([]);
  });

  it("returns empty array for code block node (no children)", () => {
    const node = codeBlock("code", "js");
    const children = getNodeChildren(node);
    expect(children).toEqual([]);
  });

  it("returns children for blockquote node", () => {
    const node = blockquote([paragraph([text("quoted")])]);
    const children = getNodeChildren(node);
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe("paragraph");
  });

  it("returns children for emphasis node", () => {
    const node = emphasis([text("italic")]);
    const children = getNodeChildren(node);
    expect(children).toHaveLength(1);
  });

  it("returns children for link node", () => {
    const node = link("https://example.com", [text("link")]);
    const children = getNodeChildren(node);
    expect(children).toHaveLength(1);
  });
});

describe("getNodeValue", () => {
  it("returns value for text node", () => {
    const node = text("hello");
    expect(getNodeValue(node)).toBe("hello");
  });

  it("returns value for inline code node", () => {
    const node = inlineCode("const x = 1");
    expect(getNodeValue(node)).toBe("const x = 1");
  });

  it("returns value for code block node", () => {
    const node = codeBlock("function() {}");
    expect(getNodeValue(node)).toBe("function() {}");
  });

  it("returns empty string for paragraph node (no value)", () => {
    const node = paragraph([text("hello")]);
    expect(getNodeValue(node)).toBe("");
  });

  it("returns empty string for strong node (no value)", () => {
    const node = strong([text("bold")]);
    expect(getNodeValue(node)).toBe("");
  });

  it("returns empty string for emphasis node (no value)", () => {
    const node = emphasis([text("italic")]);
    expect(getNodeValue(node)).toBe("");
  });

  it("returns empty string for blockquote (no value)", () => {
    const node = blockquote([paragraph([text("quoted")])]);
    expect(getNodeValue(node)).toBe("");
  });

  it("returns value for text with empty string", () => {
    const node = text("");
    expect(getNodeValue(node)).toBe("");
  });
});

// ============================================================================
// Additional parseMarkdown edge cases
// ============================================================================

describe("parseMarkdown edge cases", () => {
  it("handles markdown with only whitespace", () => {
    const ast = parseMarkdown("   ");
    expect(ast.type).toBe("root");
    // Whitespace-only may produce empty or single-element AST
    expect(ast.children.length).toBeGreaterThanOrEqual(0);
  });

  it("handles markdown with special characters", () => {
    const ast = parseMarkdown('Hello <world> & "quotes"');
    expect(ast.type).toBe("root");
    const plainText = toPlainText(ast);
    expect(plainText).toContain("Hello");
  });

  it("handles very long markdown input", () => {
    const longText = "word ".repeat(1000);
    const ast = parseMarkdown(longText);
    expect(ast.type).toBe("root");
    expect(ast.children.length).toBeGreaterThan(0);
  });

  it("handles markdown with mixed heading levels", () => {
    const ast = parseMarkdown("# H1\n## H2\n### H3");
    expect(ast.children).toHaveLength(3);
    expect(ast.children[0].type).toBe("heading");
    expect(ast.children[1].type).toBe("heading");
    expect(ast.children[2].type).toBe("heading");
  });

  it("handles markdown with thematic break (hr)", () => {
    const ast = parseMarkdown("before\n\n---\n\nafter");
    expect(ast.children.length).toBeGreaterThanOrEqual(3);
    const types = ast.children.map((c) => c.type);
    expect(types).toContain("thematicBreak");
  });
});
