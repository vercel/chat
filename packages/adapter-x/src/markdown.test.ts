/**
 * Tests for the X format converter: toAst, fromAst, and renderPostable.
 */

import { parseMarkdown } from "chat";
import { describe, expect, it } from "vitest";
import { XFormatConverter } from "./markdown";

const converter = new XFormatConverter();

// ============================================================================
// toAst Tests
// ============================================================================

describe("XFormatConverter.toAst", () => {
  it("parses plain text", () => {
    const ast = converter.toAst("Hello world");
    const text = converter.fromAst(ast);
    expect(text).toContain("Hello world");
  });

  it("preserves @mentions as text", () => {
    const ast = converter.toAst("Hello @user123");
    const text = converter.fromAst(ast);
    expect(text).toContain("@user123");
  });

  it("preserves #hashtags as text", () => {
    const ast = converter.toAst("Check out #TypeScript");
    const text = converter.fromAst(ast);
    expect(text).toContain("#TypeScript");
  });

  it("handles multiline text", () => {
    const ast = converter.toAst("Line 1\n\nLine 2");
    const text = converter.fromAst(ast);
    expect(text).toContain("Line 1");
    expect(text).toContain("Line 2");
  });

  it("handles URLs in text", () => {
    const ast = converter.toAst("Check out https://example.com for more info");
    expect(ast.type).toBe("root");
    expect(ast.children.length).toBeGreaterThan(0);
  });

  it("returns a root node", () => {
    const ast = converter.toAst("test");
    expect(ast.type).toBe("root");
  });
});

// ============================================================================
// fromAst Tests
// ============================================================================

describe("XFormatConverter.fromAst", () => {
  it("strips bold formatting", () => {
    const ast = parseMarkdown("**bold text**");
    const text = converter.fromAst(ast);
    expect(text).toContain("bold text");
    // Bold markers should be stripped for X
    expect(text).not.toContain("**");
  });

  it("strips italic formatting", () => {
    const ast = parseMarkdown("*italic text*");
    const text = converter.fromAst(ast);
    expect(text).toContain("italic text");
  });

  it("strips strikethrough formatting", () => {
    const ast = parseMarkdown("~~deleted~~");
    const text = converter.fromAst(ast);
    expect(text).toContain("deleted");
    expect(text).not.toContain("~~");
  });

  it("renders links as plain URLs", () => {
    const ast = parseMarkdown("[Click here](https://example.com)");
    const text = converter.fromAst(ast);
    expect(text).toContain("https://example.com");
  });

  it("preserves inline code", () => {
    const ast = parseMarkdown("Use `const x = 1`");
    const text = converter.fromAst(ast);
    expect(text).toContain("`const x = 1`");
  });

  it("preserves code blocks", () => {
    const ast = parseMarkdown("```\nconst x = 1;\n```");
    const text = converter.fromAst(ast);
    expect(text).toContain("const x = 1;");
  });

  it("renders blockquotes with > prefix", () => {
    const ast = parseMarkdown("> quoted text");
    const text = converter.fromAst(ast);
    expect(text).toContain("> quoted text");
  });

  it("renders unordered lists", () => {
    const ast = parseMarkdown("- item 1\n- item 2");
    const text = converter.fromAst(ast);
    expect(text).toContain("item 1");
    expect(text).toContain("item 2");
  });

  it("renders ordered lists", () => {
    const ast = parseMarkdown("1. first\n2. second");
    const text = converter.fromAst(ast);
    expect(text).toContain("first");
    expect(text).toContain("second");
  });

  it("handles plain text passthrough", () => {
    const ast = parseMarkdown("just plain text");
    const text = converter.fromAst(ast);
    expect(text).toContain("just plain text");
  });
});

// ============================================================================
// renderPostable Tests
// ============================================================================

describe("XFormatConverter.renderPostable", () => {
  it("renders string messages directly", () => {
    const result = converter.renderPostable("Hello world");
    expect(result).toBe("Hello world");
  });

  it("renders raw messages", () => {
    const result = converter.renderPostable({ raw: "Raw text" });
    expect(result).toBe("Raw text");
  });

  it("renders markdown messages via AST conversion", () => {
    const result = converter.renderPostable({ markdown: "**bold** text" });
    expect(result).toContain("bold");
    expect(result).toContain("text");
  });

  it("renders AST messages via fromAst", () => {
    const ast = parseMarkdown("Hello from AST");
    const result = converter.renderPostable({ ast });
    expect(result).toContain("Hello from AST");
  });

  it("truncates text longer than 280 characters", () => {
    const longText = "a".repeat(300);
    const result = converter.renderPostable(longText);
    expect(result.length).toBe(280);
    expect(result.endsWith("…")).toBe(true);
  });

  it("does not truncate text at exactly 280 characters", () => {
    const text = "b".repeat(280);
    const result = converter.renderPostable(text);
    expect(result.length).toBe(280);
    expect(result).toBe(text);
  });

  it("does not truncate text shorter than 280 characters", () => {
    const text = "c".repeat(100);
    const result = converter.renderPostable(text);
    expect(result).toBe(text);
  });

  it("returns empty string for unknown message type", () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing edge case
    const result = converter.renderPostable({} as any);
    expect(result).toBe("");
  });
});
