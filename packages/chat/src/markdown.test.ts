/**
 * Tests for markdown parsing, AST building, and format conversion utilities.
 */

import type { Content, Root } from "mdast";
import { describe, expect, it, vi } from "vitest";
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
  DEFAULT_MAX_INCOMING_PARSE_LENGTH,
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
import { TextInput } from "./modals";

const BOT_MENTION_WITH_WHITESPACE_REGEX = /@test-bot\s+hi there/;
const LIST_ITEMS_WITH_WHITESPACE_REGEX = /one\s+two/;

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

  it("preserves soft line breaks as whitespace", () => {
    const ast = parseMarkdown("@test-bot\nhi there");
    const result = toPlainText(ast);
    expect(result).toMatch(BOT_MENTION_WITH_WHITESPACE_REGEX);
  });

  it("preserves paragraph boundaries as whitespace", () => {
    const ast = parseMarkdown("@test-bot\n\nhi there");
    const result = toPlainText(ast);
    expect(result).toMatch(BOT_MENTION_WITH_WHITESPACE_REGEX);
  });

  it("separates list items with whitespace", () => {
    const ast = parseMarkdown("- one\n- two");
    const result = toPlainText(ast);
    expect(result).toMatch(LIST_ITEMS_WITH_WHITESPACE_REGEX);
  });

  it("separates table cells and rows with structural whitespace", () => {
    const ast = parseMarkdown(
      "| Name | Role |\n| --- | --- |\n| **Ada** Lovelace | Engineer |"
    );
    const result = toPlainText(ast);
    expect(result).toBe("Name\tRole\nAda Lovelace\tEngineer");
  });

  it("keeps empty table cells so columns stay aligned", () => {
    const ast = parseMarkdown(
      "| Name | Middle | Units |\n| --- | --- | --- |\n| Samsung |  | 3 |"
    );
    const result = toPlainText(ast);
    expect(result).toBe("Name\tMiddle\tUnits\nSamsung\t\t3");
  });

  it("drops table rows with no content", () => {
    const ast = parseMarkdown("|  |  |\n| --- | --- |\n| Samsung | 3 |");
    const result = toPlainText(ast);
    expect(result).toBe("Samsung\t3");
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

  it("preserves whitespace after a newline-separated mention", () => {
    const result = markdownToPlainText("@test-bot\nhi there");
    expect(result).toMatch(BOT_MENTION_WITH_WHITESPACE_REGEX);
  });

  it("preserves whitespace after a paragraph-separated mention", () => {
    const result = markdownToPlainText("@test-bot\n\nhi there");
    expect(result).toMatch(BOT_MENTION_WITH_WHITESPACE_REGEX);
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

  describe("parseIncoming", { timeout: 20_000 }, () => {
    const unparsed = (input: string) => ({
      text: input,
      formatted: root([paragraph([text(input)])]),
    });

    const parsed = (input: string) => {
      const formatted = parseMarkdown(input);
      return { text: toPlainText(formatted), formatted };
    };

    // Recursive, so only call it on shallow trees.
    const maxDepth = (node: Root | Content): number => {
      if (!("children" in node) || node.children.length === 0) {
        return 0;
      }
      let deepest = 0;
      for (const child of node.children) {
        deepest = Math.max(deepest, maxDepth(child as Content));
      }
      return deepest + 1;
    };

    const countNodes = (node: Root | Content, type: string): number => {
      let count = node.type === type ? 1 : 0;
      if ("children" in node) {
        for (const child of node.children) {
          count += countNodes(child as Content, type);
        }
      }
      return count;
    };

    const countMarkers = (value: string): number => {
      let count = 0;
      for (const char of value) {
        if (char === "*" || char === "_" || char === "~") {
          count++;
        }
      }
      return count;
    };

    const parseWithSpy = (input: string, parsing = new TestConverter()) => {
      const toAst = vi.spyOn(parsing, "toAst");
      const result = parsing.parseIncoming(input);
      return { result, toAstCalls: toAst.mock.calls.length };
    };
    const parsedOnce = (input: string) => ({
      result: parsed(input),
      toAstCalls: 1,
    });
    const skipped = (input: string) => ({
      result: unparsed(input),
      toAstCalls: 0,
    });

    // Emphasis nested inline, so its depth is levels + 2 with no container
    // markers.
    const nestedEmphasis = (levels: number): string =>
      `${"*a ".repeat(levels)}${"a* ".repeat(levels)}`;

    // Lists nested by indentation, one marker per line.
    const staircase = (levels: number): string =>
      Array.from({ length: levels }, (_, i) => `${"  ".repeat(i)}- a`).join(
        "\n"
      );

    // Each line holds 8 emphasis markers, so 256 lines hold exactly 2,048.
    const emphasisLine = "*a* _b_ ~~c~~\n";
    const maxMarkersInput = emphasisLine.repeat(256);

    it("matches extractPlainText and toAst for markdown input", () => {
      const input =
        "# Title\n\n**bold** and _italic_ with `code`\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |";
      const result = converter.parseIncoming(input);
      expect(result.text).toBe(
        "Title\n\nbold and italic with code\n\none\ntwo\n\na\tb\n1\t2"
      );
      expect(result.text).toBe(converter.extractPlainText(input));
      expect(result).toEqual(parsed(input));
      expect(result).not.toEqual(unparsed(input));
    });

    it("parses input once", () => {
      const parsing = new TestConverter();
      const toAst = vi.spyOn(parsing, "toAst");
      const result = parsing.parseIncoming("**bold** text");
      expect(result.text).toBe("bold text");
      expect(result.formatted).toMatchObject(
        root([paragraph([strong([text("bold")]), text(" text")])])
      );
      expect(result).toEqual(parsed("**bold** text"));
      expect(result).not.toEqual(unparsed("**bold** text"));
      expect(toAst).toHaveBeenCalledTimes(1);
    });

    describe("length limit", () => {
      it("defaults to 16,384 characters", () => {
        expect(DEFAULT_MAX_INCOMING_PARSE_LENGTH).toBe(16_384);
      });

      it("parses input at the limit", () => {
        const parsing = new TestConverter();
        const toAst = vi.spyOn(parsing, "toAst");
        const input = `**bold**${"a".repeat(DEFAULT_MAX_INCOMING_PARSE_LENGTH - 8)}`;
        const result = parsing.parseIncoming(input);
        expect(result.text).toBe(
          `bold${"a".repeat(DEFAULT_MAX_INCOMING_PARSE_LENGTH - 8)}`
        );
        expect(result).toEqual(parsed(input));
        expect(result).not.toEqual(unparsed(input));
        expect(toAst).toHaveBeenCalledTimes(1);
      });

      it("keeps input over the limit as a single text node", () => {
        const parsing = new TestConverter();
        const toAst = vi.spyOn(parsing, "toAst");
        const input = `**bold**${"a".repeat(DEFAULT_MAX_INCOMING_PARSE_LENGTH - 7)}`;
        const result = parsing.parseIncoming(input);
        expect(result).toEqual({
          text: input,
          formatted: {
            type: "root",
            children: [
              { type: "paragraph", children: [{ type: "text", value: input }] },
            ],
          },
        });
        expect(toAst).not.toHaveBeenCalled();
      });

      it("respects a lower subclass limit", () => {
        class SmallLimitConverter extends TestConverter {
          protected override maxIncomingParseLength = 5;
        }
        const parsing = new SmallLimitConverter();
        const toAst = vi.spyOn(parsing, "toAst");
        const result = parsing.parseIncoming("**bold**");
        expect(result).toEqual(unparsed("**bold**"));
        expect(toAst).not.toHaveBeenCalled();
      });

      it("respects a higher subclass limit", () => {
        class LargeLimitConverter extends TestConverter {
          protected override maxIncomingParseLength = 20_000;
        }
        const input = `**bold**${"a".repeat(DEFAULT_MAX_INCOMING_PARSE_LENGTH)}`;
        const result = new LargeLimitConverter().parseIncoming(input);
        expect(result).toEqual(parsed(input));
        expect(result).not.toEqual(unparsed(input));
      });
    });

    describe("emphasis marker limit", () => {
      it("parses input with exactly 2,048 markers", () => {
        expect(countMarkers(maxMarkersInput)).toBe(2048);
        const result = converter.parseIncoming(maxMarkersInput);
        expect(result).toEqual(parsed(maxMarkersInput));
        expect(result).not.toEqual(unparsed(maxMarkersInput));
        expect(countNodes(result.formatted, "emphasis")).toBe(512);
        expect(countNodes(result.formatted, "delete")).toBe(256);
      });

      it.each([
        "*",
        "_",
        "~",
      ])("keeps input with 2,049 markers as a single text node when the extra marker is %s", (marker) => {
        const parsing = new TestConverter();
        const toAst = vi.spyOn(parsing, "toAst");
        const input = `${maxMarkersInput}x${marker}`;
        expect(countMarkers(input)).toBe(2049);
        expect(parsing.parseIncoming(input)).toEqual(unparsed(input));
        expect(toAst).not.toHaveBeenCalled();
      });

      it("parses unmatched markers up to the limit", () => {
        const input = "*a".repeat(2048);
        const result = converter.parseIncoming(input);
        expect(result).toEqual(parsed(input));
        expect(result).not.toEqual(unparsed(input));
        expect(countNodes(result.formatted, "emphasis")).toBeGreaterThan(0);
      });

      it("keeps unmatched markers over the limit as a single text node", () => {
        const input = `${"*a".repeat(2048)}*`;
        expect(converter.parseIncoming(input)).toEqual(unparsed(input));
      });

      it("does not count other punctuation", () => {
        const input = `${maxMarkersInput}\n${"-+=^|#!?.,;:'\"()".repeat(400)}`;
        expect(input.length).toBeLessThanOrEqual(
          DEFAULT_MAX_INCOMING_PARSE_LENGTH
        );
        expect(countMarkers(input)).toBe(2048);
        const result = converter.parseIncoming(input);
        expect(result).toEqual(parsed(input));
        expect(result).not.toEqual(unparsed(input));
        expect(countNodes(result.formatted, "emphasis")).toBe(512);
      });

      it("parses a long realistic message", () => {
        const section =
          "Hey team, here is the **update** for _today_: see [the doc](https://example.com/doc) and `config.ts`.\n\n- item one with ~~old~~ text\n- item two\n\n> quoted line\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```\n\n";
        const input = section.repeat(60);
        expect(input.length).toBeLessThanOrEqual(
          DEFAULT_MAX_INCOMING_PARSE_LENGTH
        );
        expect(countMarkers(input)).toBeLessThanOrEqual(2048);
        const result = converter.parseIncoming(input);
        expect(result).toEqual(parsed(input));
        expect(result).not.toEqual(unparsed(input));
        expect(countNodes(result.formatted, "table")).toBe(60);
        expect(countNodes(result.formatted, "link")).toBe(60);
      });

      it("respects a lower subclass limit", () => {
        class FewMarkersConverter extends TestConverter {
          protected override maxIncomingEmphasisMarkers = 3;
        }
        const parsing = new FewMarkersConverter();
        const result = parsing.parseIncoming("*a*");
        expect(result).toEqual(parsed("*a*"));
        expect(result).not.toEqual(unparsed("*a*"));
        expect(parsing.parseIncoming("**a**")).toEqual(unparsed("**a**"));
      });

      it("respects a higher subclass limit", () => {
        class ManyMarkersConverter extends TestConverter {
          protected override maxIncomingEmphasisMarkers = 10_000;
        }
        const input = `${maxMarkersInput}x*`;
        const result = new ManyMarkersConverter().parseIncoming(input);
        expect(result).toEqual(parsed(input));
        expect(result).not.toEqual(unparsed(input));
      });
    });

    describe("closing bracket limit", () => {
      it("parses input with exactly 128 closing brackets", () => {
        const input = `# Brackets\n\n${"a]".repeat(128)}`;
        const result = converter.parseIncoming(input);
        expect(result).toEqual(parsed(input));
        expect(result).not.toEqual(unparsed(input));
        expect(countNodes(result.formatted, "heading")).toBe(1);
      });

      it("keeps input with 129 closing brackets as a single text node", () => {
        const parsing = new TestConverter();
        const toAst = vi.spyOn(parsing, "toAst");
        const input = `# Brackets\n\n${"a]".repeat(129)}`;
        expect(parsing.parseIncoming(input)).toEqual(unparsed(input));
        expect(toAst).not.toHaveBeenCalled();
      });

      it("does not count opening brackets", () => {
        const input = `# Brackets\n\n${"[".repeat(8192)}`;
        const result = converter.parseIncoming(input);
        expect(result).toEqual(parsed(input));
        expect(result).not.toEqual(unparsed(input));
      });

      it("counts brackets that close links", () => {
        const atLimit = "[a](b) ".repeat(128);
        const result = converter.parseIncoming(atLimit);
        expect(result).toEqual(parsed(atLimit));
        expect(countNodes(result.formatted, "link")).toBe(128);
        const overLimit = "[a](b) ".repeat(129);
        expect(converter.parseIncoming(overLimit)).toEqual(unparsed(overLimit));
      });

      it("respects a lower subclass limit", () => {
        class FewBracketsConverter extends TestConverter {
          protected override maxIncomingClosingBrackets = 1;
        }
        const parsing = new FewBracketsConverter();
        const link1 = "[a](https://example.com)";
        const link2 = `${link1} [b](https://example.com)`;
        const result = parsing.parseIncoming(link1);
        expect(result).toEqual(parsed(link1));
        expect(result).not.toEqual(unparsed(link1));
        expect(parsing.parseIncoming(link2)).toEqual(unparsed(link2));
      });

      it("respects a higher subclass limit", () => {
        class ManyBracketsConverter extends TestConverter {
          protected override maxIncomingClosingBrackets = 10_000;
        }
        const input = `# Brackets\n\n${"a]".repeat(200)}`;
        const result = new ManyBracketsConverter().parseIncoming(input);
        expect(result).toEqual(parsed(input));
        expect(result).not.toEqual(unparsed(input));
      });
    });

    describe("angle bracket limit", () => {
      it("parses input with exactly 512 angle brackets", () => {
        const input = `# Angles\n\n${"1 < 2 ".repeat(512)}`;
        const result = parseWithSpy(input);
        expect(result).toEqual(parsedOnce(input));
        expect(result.result).not.toEqual(unparsed(input));
      });

      it("keeps input with 513 angle brackets as a single text node", () => {
        const input = `# Angles\n\n${"1 < 2 ".repeat(513)}`;
        expect(parseWithSpy(input)).toEqual(skipped(input));
      });

      it("does not count closing angle brackets", () => {
        const input = `# Angles\n\n${"2 > 1 ".repeat(2000)}`;
        const result = parseWithSpy(input);
        expect(result).toEqual(parsedOnce(input));
        expect(result.result).not.toEqual(unparsed(input));
      });

      it("respects a lower subclass limit", () => {
        class FewAnglesConverter extends TestConverter {
          protected override maxIncomingAngleBrackets = 1;
        }
        const result = parseWithSpy("**a** <b>", new FewAnglesConverter());
        expect(result).toEqual(parsedOnce("**a** <b>"));
        expect(parseWithSpy("**a** <b> <c>", new FewAnglesConverter())).toEqual(
          skipped("**a** <b> <c>")
        );
      });

      it("respects a higher subclass limit", () => {
        class ManyAnglesConverter extends TestConverter {
          protected override maxIncomingAngleBrackets = 10_000;
        }
        const input = `# Angles\n\n${"1 < 2 ".repeat(513)}`;
        const result = parseWithSpy(input, new ManyAnglesConverter());
        expect(result).toEqual(parsedOnce(input));
        expect(result.result).not.toEqual(unparsed(input));
      });
    });

    describe("www autolink limit", () => {
      const wwwWord = (count: number, prefixes = ["www."]): string => {
        let word = "";
        for (let i = 0; i < count; i++) {
          word += `${prefixes[i % prefixes.length]}a`;
        }
        return word;
      };

      it("parses a word with exactly 8 www. occurrences", () => {
        const input = `**see** ${wwwWord(8)} now`;
        const result = parseWithSpy(input);
        expect(result).toEqual(parsedOnce(input));
        expect(result.result).not.toEqual(unparsed(input));
      });

      it.each([
        ["lowercase", ["www."]],
        ["uppercase", ["WWW."]],
        ["mixed case", ["www.", "WWW.", "wWw."]],
      ])("keeps a word with 9 %s www. occurrences as a single text node", (_name, prefixes) => {
        const input = `**see** ${wwwWord(9, prefixes)} now`;
        expect(parseWithSpy(input)).toEqual(skipped(input));
      });

      it("parses many www. links separated by whitespace", () => {
        const input = "see www.example.com and ".repeat(70);
        const result = parseWithSpy(input);
        expect(result).toEqual(parsedOnce(input));
        expect(countNodes(result.result.formatted, "link")).toBe(70);
      });

      it("limits each word, not the line", () => {
        const atLimit = `${wwwWord(8)} `.repeat(20);
        const result = parseWithSpy(atLimit);
        expect(result).toEqual(parsedOnce(atLimit));
        expect(result.result).not.toEqual(unparsed(atLimit));
        const overLimit = `${atLimit}${wwwWord(9)}`;
        expect(parseWithSpy(overLimit)).toEqual(skipped(overLimit));
      });

      it("splits words on tabs as well as spaces", () => {
        const input = `**see** ${wwwWord(8)}\t${wwwWord(8)}`;
        const result = parseWithSpy(input);
        expect(result).toEqual(parsedOnce(input));
        expect(result.result).not.toEqual(unparsed(input));
      });

      it("respects a lower subclass limit", () => {
        class FewLinksConverter extends TestConverter {
          protected override maxIncomingWwwAutolinks = 1;
        }
        const separate = "see www.a.com and www.b.com";
        const result = parseWithSpy(separate, new FewLinksConverter());
        expect(result).toEqual(parsedOnce(separate));
        expect(result.result).not.toEqual(unparsed(separate));
        const joined = "see www.a.com/www.b.com";
        expect(parseWithSpy(joined, new FewLinksConverter())).toEqual(
          skipped(joined)
        );
      });

      it("respects a higher subclass limit", () => {
        class ManyLinksConverter extends TestConverter {
          protected override maxIncomingWwwAutolinks = 100;
        }
        const input = `**see** ${wwwWord(9)} now`;
        const result = parseWithSpy(input, new ManyLinksConverter());
        expect(result).toEqual(parsedOnce(input));
        expect(result.result).not.toEqual(unparsed(input));
      });
    });

    describe("container marker limit", () => {
      const mixedMarkers = (count: number): string => {
        const markers = ["> ", "- ", "1. ", "1) "];
        let line = "";
        for (let i = 0; i < count; i++) {
          line += markers[i % markers.length];
        }
        return `${line}a`;
      };

      it.each([
        [">", (n: number) => `${">".repeat(n)}a`],
        ["> ", (n: number) => `${"> ".repeat(n)}a`],
        ["- ", (n: number) => `${"- ".repeat(n)}a`],
        ["+ ", (n: number) => `${"+ ".repeat(n)}a`],
        ["* ", (n: number) => `${"* ".repeat(n)}a`],
        ["1. ", (n: number) => `${"1. ".repeat(n)}a`],
        ["1) ", (n: number) => `${"1) ".repeat(n)}a`],
        ["123456789. ", (n: number) => `${"123456789. ".repeat(n)}a`],
        ["tab-separated -", (n: number) => `${"-\t".repeat(n)}a`],
        ["mixed > - 1. 1)", mixedMarkers],
      ])("parses a line with 32 %s markers and skips parsing one with 33", (_name, line) => {
        const atLimit = line(32);
        const result = parseWithSpy(atLimit);
        expect(result).toEqual(parsedOnce(atLimit));
        expect(result.result).not.toEqual(unparsed(atLimit));
        const overLimit = line(33);
        expect(parseWithSpy(overLimit)).toEqual(skipped(overLimit));
      });

      it("counts markers on every line", () => {
        const input = `**intro**\n\n${">".repeat(10)}a\n${">".repeat(33)}a`;
        expect(parseWithSpy(input)).toEqual(skipped(input));
      });

      it.each([
        ["- without a following space", "-a"],
        ["a 10-digit ordered list number", "1000000000. a"],
        ["an 11-digit ordered list number", "10000000000. a"],
        ["an ordered list number without a following space", "1.x"],
        ["a number with another delimiter", "1: a"],
        ["a number without a delimiter", "1 a"],
        ["a delimiter without a number", ". a"],
        ["text", "a"],
      ])("does not count %s", (_name, tail) => {
        const input = `${">".repeat(32)}${tail}`;
        const result = parseWithSpy(input);
        expect(result).toEqual(parsedOnce(input));
        expect(result.result).not.toEqual(unparsed(input));
      });

      it("counts a 9-digit ordered list number, an empty item, and a trailing marker", () => {
        for (const tail of ["123456789. a", "1.", "-"]) {
          const input = `${">".repeat(32)}${tail}`;
          expect(parseWithSpy(input)).toEqual(skipped(input));
        }
      });

      it("ignores markers after other text on the line", () => {
        for (const input of [
          `**a** ${">".repeat(200)}`,
          `**a** ${"- ".repeat(200)}`,
          `**a** ${"1. ".repeat(200)}`,
        ]) {
          const result = converter.parseIncoming(input);
          expect(result).toEqual(parsed(input));
          expect(result).not.toEqual(unparsed(input));
        }
      });

      it("limits markers per line, not in total", () => {
        for (const input of [
          `${">".repeat(32)}a\n`.repeat(5),
          `${"- ".repeat(32)}a\n`.repeat(5),
        ]) {
          const result = converter.parseIncoming(input);
          expect(result).toEqual(parsed(input));
          expect(result).not.toEqual(unparsed(input));
        }
      });

      it("counts each - of a thematic break, so a long one is kept as text", () => {
        const atLimit = "- ".repeat(32);
        const result = converter.parseIncoming(atLimit);
        expect(result).toEqual(parsed(atLimit));
        expect(result.formatted.children).toMatchObject([
          { type: "thematicBreak" },
        ]);
        for (const overLimit of ["- ".repeat(33), "- ".repeat(200)]) {
          expect(parseWithSpy(overLimit)).toEqual(skipped(overLimit));
        }
      });

      it("parses ordinary thematic breaks", () => {
        for (const input of ["a\n\n---\n\nb", "a\n\n- - -\n\nb"]) {
          const result = converter.parseIncoming(input);
          expect(result).toEqual(parsed(input));
          expect(countNodes(result.formatted, "thematicBreak")).toBe(1);
        }
      });

      it("counts a footnote definition label as a marker", () => {
        const atLimit = `[^a]: ${"- ".repeat(31)}a`;
        const result = parseWithSpy(atLimit);
        expect(result).toEqual(parsedOnce(atLimit));
        expect(result.result).not.toEqual(unparsed(atLimit));
        const overLimit = `[^a]: ${"- ".repeat(32)}a`;
        expect(parseWithSpy(overLimit)).toEqual(skipped(overLimit));
      });

      it("does not count a footnote reference without a colon", () => {
        const input = `[^a] ${"- ".repeat(40)}a`;
        const result = parseWithSpy(input);
        expect(result).toEqual(parsedOnce(input));
        expect(result.result).not.toEqual(unparsed(input));
      });

      it.each([
        ["spaces", " ".repeat(64), " ".repeat(66)],
        ["tabs", "\t".repeat(16), `${"\t".repeat(16)}  `],
        ["a space then a tab", " \t".repeat(16), `${" \t".repeat(16)}  `],
      ])("counts every two columns of leading %s as a marker", (_name, atLimit, overLimit) => {
        const parsedInput = `para\n\n${atLimit}a`;
        const result = parseWithSpy(parsedInput);
        expect(result).toEqual(parsedOnce(parsedInput));
        expect(result.result).not.toEqual(unparsed(parsedInput));
        const skippedInput = `para\n\n${overLimit}a`;
        expect(parseWithSpy(skippedInput)).toEqual(skipped(skippedInput));
      });

      it("ignores lines that hold only whitespace", () => {
        for (const blank of [" ".repeat(200), "\t".repeat(100)]) {
          const input = `**a**\n${blank}\nb`;
          const result = parseWithSpy(input);
          expect(result).toEqual(parsedOnce(input));
          expect(result.result).not.toEqual(unparsed(input));
        }
      });

      it("adds leading indentation to the markers on a line", () => {
        const atLimit = `para\n\n${" ".repeat(20)}${"- ".repeat(22)}a`;
        const result = parseWithSpy(atLimit);
        expect(result).toEqual(parsedOnce(atLimit));
        expect(result.result).not.toEqual(unparsed(atLimit));
        const overLimit = `para\n\n${" ".repeat(20)}${"- ".repeat(23)}a`;
        expect(parseWithSpy(overLimit)).toEqual(skipped(overLimit));
      });

      it("counts markers on lines ending in CRLF", () => {
        const input = `a\r\n${"- ".repeat(33)}a`;
        expect(parseWithSpy(input)).toEqual(skipped(input));
      });

      it("counts markers on lines ending in a bare CR", () => {
        // micromark treats a bare \r as a line ending.
        const input = `a\r${"- ".repeat(33)}a`;
        expect(parseWithSpy(input)).toEqual(skipped(input));
        const middle = `a\r${"- ".repeat(33)}a\rb`;
        expect(parseWithSpy(middle)).toEqual(skipped(middle));
      });

      it("parses bare CR separated lines that are each under the limit", () => {
        const input = `${"- ".repeat(32)}a\r`.repeat(10);
        const result = parseWithSpy(input);
        expect(result).toEqual(parsedOnce(input));
        expect(result.result).not.toEqual(unparsed(input));
      });

      it("respects a lower subclass limit", () => {
        class FewMarkersConverter extends TestConverter {
          protected override maxIncomingContainerMarkers = 2;
        }
        const result = parseWithSpy("> > a", new FewMarkersConverter());
        expect(result).toEqual(parsedOnce("> > a"));
        expect(result.result).not.toEqual(unparsed("> > a"));
        expect(parseWithSpy("> > > a", new FewMarkersConverter())).toEqual(
          skipped("> > > a")
        );
      });

      it("respects a higher subclass limit", () => {
        class ManyMarkersConverter extends TestConverter {
          protected override maxIncomingContainerMarkers = 200;
        }
        const input = `${">".repeat(100)}a`;
        expect(parseWithSpy(input)).toEqual(skipped(input));
        const result = parseWithSpy(input, new ManyMarkersConverter());
        expect(result).toEqual(parsedOnce(input));
        expect(result.result).not.toEqual(unparsed(input));
      });

      it("is independent of the AST depth limit", () => {
        class DeepConverter extends TestConverter {
          protected override maxIncomingAstDepth = 1000;
        }
        const input = `${">".repeat(33)}a`;
        expect(parseWithSpy(input, new DeepConverter())).toEqual(
          skipped(input)
        );
      });
    });

    describe("fenced code blocks", () => {
      const overBrackets = "a]".repeat(129);

      it("does not count closing brackets inside a JSON fence", () => {
        const json = "[1]\n".repeat(521);
        const input = `**data**\n\n\`\`\`json\n${json}\`\`\`\n`;
        const result = parseWithSpy(input);
        expect(result).toEqual(parsedOnce(input));
        expect(result.result.formatted.children).toMatchObject([
          { type: "paragraph" },
          { type: "code", lang: "json", value: json.slice(0, -1) },
        ]);
        const unfenced = `**data**\n\n${json}`;
        expect(parseWithSpy(unfenced)).toEqual(skipped(unfenced));
      });

      it("does not count emphasis markers inside a Python fence", () => {
        const python = "__init__ = 1\n".repeat(1100);
        const input = `**code**\n\n\`\`\`python\n${python}\`\`\`\n`;
        const result = parseWithSpy(input);
        expect(result).toEqual(parsedOnce(input));
        expect(countNodes(result.result.formatted, "code")).toBe(1);
        const unfenced = `**code**\n\n${python}`;
        expect(parseWithSpy(unfenced)).toEqual(skipped(unfenced));
      });

      it("counts text after a closed fence", () => {
        const over = `\`\`\`\nx\n\`\`\`\n${overBrackets}`;
        expect(parseWithSpy(over)).toEqual(skipped(over));
        const under = `\`\`\`\nx\n\`\`\`\n${"a]".repeat(128)}`;
        const result = parseWithSpy(under);
        expect(result).toEqual(parsedOnce(under));
        expect(result.result).not.toEqual(unparsed(under));
      });

      it.each([
        ["a shorter closer", `\`\`\`\`\nx\n\`\`\`\n${overBrackets}`],
        [
          "a closer indented 4 spaces",
          `\`\`\`\nx\n    \`\`\`\n${overBrackets}`,
        ],
        [
          "a tilde closer for a backtick fence",
          `\`\`\`\nx\n~~~\n${overBrackets}`,
        ],
        [
          "a backtick closer for a tilde fence",
          `~~~\nx\n\`\`\`\n${overBrackets}`,
        ],
        [
          "a closer with an info string",
          `\`\`\`\nx\n\`\`\`js\n${overBrackets}`,
        ],
        ["no closer", `\`\`\`\n${overBrackets}`],
        [
          "a tilde fence with a backtick in its info",
          `~~~ a\`b\n${overBrackets}`,
        ],
      ])("keeps skipping after %s", (_name, input) => {
        const result = parseWithSpy(input);
        expect(result).toEqual(parsedOnce(input));
        expect(countNodes(result.result.formatted, "code")).toBe(1);
      });

      it.each([
        ["a closer indented 3 spaces", `\`\`\`\nx\n   \`\`\`\n${overBrackets}`],
        ["a longer closer", `\`\`\`\nx\n\`\`\`\`\n${overBrackets}`],
        [
          "a closer with trailing whitespace",
          `\`\`\`\nx\n\`\`\` \t\n${overBrackets}`,
        ],
        [
          "a backtick fence with a backtick in its info",
          `\`\`\`a\`b\n${overBrackets}`,
        ],
        ["an indented opener", `  \`\`\`\n${overBrackets}`],
        ["an opener inside a list item", `- a\n  \`\`\`\n${overBrackets}`],
      ])("counts text after %s", (_name, input) => {
        expect(parseWithSpy(input)).toEqual(skipped(input));
      });

      it("handles fences with bare CR line endings", () => {
        const inside = `\`\`\`\r${overBrackets}\r\`\`\`\rb`;
        const result = parseWithSpy(inside);
        expect(result).toEqual(parsedOnce(inside));
        expect(countNodes(result.result.formatted, "code")).toBe(1);
        const after = `\`\`\`\rx\r\`\`\`\r${overBrackets}`;
        expect(parseWithSpy(after)).toEqual(skipped(after));
      });

      it.each([
        ["an indented opener", "  ```\nx\n  ```"],
        ["an indented tilde opener", "   ~~~\nx\n   ~~~"],
        ["a closer indented 2 spaces", "```\nx\n  ```"],
      ])("counts fenced content when the text contains %s anywhere", (_name, elsewhere) => {
        const fenced = `\`\`\`\n${overBrackets}\n\`\`\`\n`;
        const control = `${fenced}\nlater`;
        const result = parseWithSpy(control);
        expect(result).toEqual(parsedOnce(control));
        expect(countNodes(result.result.formatted, "code")).toBe(1);
        for (const input of [
          `${fenced}\n${elsewhere}\n`,
          `${elsewhere}\n\n${fenced}`,
        ]) {
          expect(parseWithSpy(input)).toEqual(skipped(input));
        }
      });

      it("counts fenced content when the text may start an HTML block", () => {
        const input = `<div>\n\n\`\`\`\n${overBrackets}\n\`\`\`\n`;
        expect(parseWithSpy(input)).toEqual(skipped(input));
      });

      describe("never skips text that is parsed as markdown", () => {
        class BudgetConverter extends TestConverter {
          exceedsBudget(platformText: string): boolean {
            return this.exceedsIncomingBudget(platformText);
          }
        }
        const budget = new BudgetConverter();
        const attack = "*a".repeat(2100);
        const columnZeroFences = ["```", "~~~", "````", "```js", "~~~ a`b"];
        // The empty entry puts the attack straight after the context, where a
        // fence the context leaves open or closed decides how it parses.
        const fences = [...columnZeroFences, " ```", "   ~~~", ""];

        const attackInCode = (node: Root | Content): boolean => {
          if (node.type === "code") {
            return node.value.includes(attack);
          }
          return (
            "children" in node &&
            node.children.some((child) => attackInCode(child as Content))
          );
        };

        it("skips the attack inside a fence with no other context", () => {
          for (const fence of columnZeroFences) {
            expect(budget.exceedsBudget(`${fence}\n${attack}`)).toBe(false);
          }
        });

        it.each([
          "",
          "para\n",
          "- item\n",
          "> quote\n",
          "[^x]: note\n",
          "    indented\n",
          "| a |\n| - |\n| b |\n",
          "Title\n===\n",
          "1. one\n",
          "<div>\n",
          "  - nested\n    more\n",
          "> - a\n> ",
          "- a\n\n  ",
          "- a\n  ",
          "* * *\n",
          "[x]: /url\n",
          "<!-- c -->\n",
          "  ```\n```\n",
          "```\n  ```\n",
        ])("after %j", (context) => {
          for (const fence of fences) {
            const input = `${context}${fence}\n${attack}`;
            if (!budget.exceedsBudget(input)) {
              expect({
                fence,
                inCode: attackInCode(parseMarkdown(input)),
              }).toEqual({
                fence,
                inCode: true,
              });
            }
          }
        });

        it.each([
          ["a backtick fence indented 2 spaces", "  ```\n```\n"],
          ["a backtick fence indented 3 spaces", "   ```\n```\n"],
          ["a tilde fence indented 1 space", " ~~~\n~~~\n"],
        ])("counts text after %s closed by a fence at column 0", (_name, context) => {
          const input = `${context}${attack}`;
          expect(attackInCode(parseMarkdown(input))).toBe(false);
          expect(budget.exceedsBudget(input)).toBe(true);
        });
      });
    });

    describe("stack overflow while parsing", () => {
      it("keeps input that overflows the parser as a single text node", () => {
        // Higher limits let the input past the pre-scan and the depth check.
        class ManyMarkersConverter extends TestConverter {
          protected override maxIncomingAstDepth = 100_000;
          protected override maxIncomingContainerMarkers = 100_000;
        }
        const parsing = new ManyMarkersConverter();
        const toAst = vi.spyOn(parsing, "toAst");
        const input = ">".repeat(8000);
        expect(() => parseMarkdown(input)).toThrow(RangeError);
        expect(parsing.parseIncoming(input)).toEqual(unparsed(input));
        expect(toAst).toHaveBeenCalledTimes(1);
      });

      it("keeps 6,000 nested blockquote markers as a single text node", () => {
        const input = ">".repeat(6000);
        let result: { formatted: Root; text: string } | undefined;
        expect(() => {
          result = converter.parseIncoming(input);
        }).not.toThrow();
        expect(result).toEqual(unparsed(input));
      });

      it("falls back when toAst throws a RangeError", () => {
        class OverflowConverter extends TestConverter {
          override toAst(): Root {
            throw new RangeError("Maximum call stack size exceeded");
          }
        }
        expect(new OverflowConverter().parseIncoming("**bold**")).toEqual(
          unparsed("**bold**")
        );
      });

      it("propagates other errors from toAst", () => {
        class BrokenConverter extends TestConverter {
          override toAst(): Root {
            throw new TypeError("broken parser");
          }
        }
        expect(() => new BrokenConverter().parseIncoming("**bold**")).toThrow(
          new TypeError("broken parser")
        );
      });
    });

    describe("AST depth limit", () => {
      // A higher marker limit lets single-line nesting past the pre-scan, so
      // these reach the depth check.
      class ManyMarkersConverter extends TestConverter {
        protected override maxIncomingContainerMarkers = 1000;
      }

      it.each([
        ["blockquotes", (n: number) => `${">".repeat(n)}a`, 126, 128, 127, 129],
        ["lists", (n: number) => `${"- ".repeat(n)}a`, 63, 128, 64, 130],
        ["lists nested by indentation", staircase, 63, 128, 64, 130],
      ])("parses %s at depth 128 and rejects them after parsing beyond it", (_name, build, atLevels, atDepth, overLevels, overDepth) => {
        const atLimit = build(atLevels);
        expect(maxDepth(parseMarkdown(atLimit))).toBe(atDepth);
        const result = parseWithSpy(atLimit, new ManyMarkersConverter());
        expect(result).toEqual({ result: parsed(atLimit), toAstCalls: 1 });
        expect(result.result).not.toEqual(unparsed(atLimit));

        const overLimit = build(overLevels);
        expect(maxDepth(parseMarkdown(overLimit))).toBe(overDepth);
        expect(parseWithSpy(overLimit, new ManyMarkersConverter())).toEqual({
          result: unparsed(overLimit),
          toAstCalls: 1,
        });
      });

      it("checks the depth of nested emphasis with default limits", () => {
        const atLimit = nestedEmphasis(126);
        expect(maxDepth(parseMarkdown(atLimit))).toBe(128);
        const result = parseWithSpy(atLimit);
        expect(result).toEqual(parsedOnce(atLimit));
        expect(result.result).not.toEqual(unparsed(atLimit));

        const overLimit = nestedEmphasis(127);
        expect(maxDepth(parseMarkdown(overLimit))).toBe(129);
        expect(parseWithSpy(overLimit)).toEqual({
          result: unparsed(overLimit),
          toAstCalls: 1,
        });
      });

      it("keeps input with thousands of nested markers as a single text node", () => {
        const input = ">".repeat(3000);
        expect(converter.parseIncoming(input)).toEqual(unparsed(input));
      });

      it("respects a lower subclass limit", () => {
        class ShallowConverter extends TestConverter {
          protected override maxIncomingAstDepth = 3;
        }
        expect(maxDepth(parseMarkdown("> a"))).toBe(3);
        const result = new ShallowConverter().parseIncoming("> a");
        expect(result).toEqual(parsed("> a"));
        expect(result).not.toEqual(unparsed("> a"));
        expect(parseWithSpy(">> a", new ShallowConverter())).toEqual({
          result: unparsed(">> a"),
          toAstCalls: 1,
        });
      });

      it("respects a higher subclass limit", () => {
        class DeepConverter extends TestConverter {
          protected override maxIncomingAstDepth = 1000;
        }
        const input = nestedEmphasis(200);
        expect(maxDepth(parseMarkdown(input))).toBe(202);
        expect(converter.parseIncoming(input)).toEqual(unparsed(input));
        const result = new DeepConverter().parseIncoming(input);
        expect(result).toEqual(parsed(input));
        expect(result).not.toEqual(unparsed(input));
      });
    });

    describe("subclass hooks", () => {
      class PrefixedFallbackConverter extends TestConverter {
        readonly fallbackCalls: string[] = [];

        protected override incomingFallbackText(platformText: string): string {
          this.fallbackCalls.push(platformText);
          return `unparsed: ${platformText}`;
        }
      }

      class ManyMarkersPrefixedFallbackConverter extends PrefixedFallbackConverter {
        protected override maxIncomingAstDepth = 100_000;
        protected override maxIncomingContainerMarkers = 100_000;
      }

      it.each([
        [
          "length",
          `**bold**${"a".repeat(DEFAULT_MAX_INCOMING_PARSE_LENGTH)}`,
          PrefixedFallbackConverter,
          0,
        ],
        [
          "emphasis markers",
          `${maxMarkersInput}x*`,
          PrefixedFallbackConverter,
          0,
        ],
        ["closing brackets", "a]".repeat(513), PrefixedFallbackConverter, 0],
        [
          "container markers",
          `${">".repeat(33)}a`,
          PrefixedFallbackConverter,
          0,
        ],
        [
          "stack overflow",
          ">".repeat(8000),
          ManyMarkersPrefixedFallbackConverter,
          1,
        ],
        ["AST depth", nestedEmphasis(127), PrefixedFallbackConverter, 1],
      ])("uses incomingFallbackText for the %s fallback", (_name, input, Converter, toAstCalls) => {
        const parsing = new Converter();
        const toAst = vi.spyOn(parsing, "toAst");
        const expected = `unparsed: ${input}`;
        expect(parsing.parseIncoming(input)).toEqual({
          text: expected,
          formatted: root([paragraph([text(expected)])]),
        });
        expect(parsing.fallbackCalls).toEqual([input]);
        expect(toAst).toHaveBeenCalledTimes(toAstCalls);
      });

      it("does not call incomingFallbackText when parsing succeeds", () => {
        const parsing = new PrefixedFallbackConverter();
        const result = parsing.parseIncoming("**bold** text");
        expect(result).toEqual(parsed("**bold** text"));
        expect(parsing.fallbackCalls).toEqual([]);
      });

      it("falls back without parsing when exceedsIncomingBudget returns true", () => {
        class NoBudgetConverter extends TestConverter {
          protected override exceedsIncomingBudget(): boolean {
            return true;
          }
        }
        const parsing = new NoBudgetConverter();
        const toAst = vi.spyOn(parsing, "toAst");
        expect(parsing.parseIncoming("**bold**")).toEqual(unparsed("**bold**"));
        expect(toAst).not.toHaveBeenCalled();
      });

      it("parses over-budget input when exceedsIncomingBudget returns false", () => {
        class UnlimitedConverter extends TestConverter {
          protected override exceedsIncomingBudget(): boolean {
            return false;
          }
        }
        const input = `${maxMarkersInput}x*`;
        const result = new UnlimitedConverter().parseIncoming(input);
        expect(result).toEqual(parsed(input));
        expect(result).not.toEqual(unparsed(input));
      });
    });

    describe("adversarial input", () => {
      const pipeTable = `| a | b |\n| - | - |\n${"| 1 | 2 |\n".repeat(1636)}`;

      it.each([
        ["unmatched *", "*a".repeat(8192)],
        ["unmatched ~", "~a".repeat(8192)],
        ["6,000 nested >", ">".repeat(6000)],
        ["3,000 nested >", ">".repeat(3000)],
        ["16K pipe table", pipeTable],
      ])("returns a serializable AST for %s", (_name, input) => {
        const result = converter.parseIncoming(input);
        expect(() => JSON.stringify(result.formatted)).not.toThrow();
        expect(() => stringifyMarkdown(result.formatted)).not.toThrow();
      });

      it("parses a 16K pipe table", () => {
        expect(pipeTable.length).toBeLessThanOrEqual(
          DEFAULT_MAX_INCOMING_PARSE_LENGTH
        );
        const result = converter.parseIncoming(pipeTable);
        expect(result).toEqual(parsed(pipeTable));
        expect(result).not.toEqual(unparsed(pipeTable));
        expect(countNodes(result.formatted, "tableRow")).toBe(1637);
      });
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

    it("falls back to a text input's label", () => {
      // Adapters that inherit this converter (github, instagram, linear,
      // messenger, web) have no card-input rendering, so the label is the only
      // thing that tells the reader what the card was asking for.
      const card = Card({
        title: "Deploy?",
        children: [TextInput({ id: "notes", label: "Notes" })],
      });
      const result = converter.renderPostable({ card });
      expect(result).toBe("**Deploy?**\nNotes");
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
