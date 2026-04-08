import { parseMarkdown } from "chat";
import { describe, expect, it } from "vitest";
import { ZoomFormatConverter } from "./markdown.js";

const converter = new ZoomFormatConverter();

describe("ZoomFormatConverter.toAst() — FMT-01", () => {
  it("converts **bold** to strong node", () => {
    const ast = converter.toAst("**bold**");
    const para = ast.children[0] as import("mdast").Paragraph;
    expect(para.children[0].type).toBe("strong");
  });

  it("converts _italic_ to emphasis node", () => {
    const ast = converter.toAst("_italic_");
    const para = ast.children[0] as import("mdast").Paragraph;
    expect(para.children[0].type).toBe("emphasis");
  });

  it("converts `code` to inlineCode node", () => {
    const ast = converter.toAst("`code`");
    const para = ast.children[0] as import("mdast").Paragraph;
    expect(para.children[0].type).toBe("inlineCode");
  });

  it("converts ~strikethrough~ (single tilde) to delete node", () => {
    const ast = converter.toAst("~strikethrough~");
    const para = ast.children[0] as import("mdast").Paragraph;
    expect(para.children[0].type).toBe("delete");
  });

  it("converts __underline__ to custom underline node", () => {
    const ast = converter.toAst("__underline__");
    const para = ast.children[0] as import("mdast").Paragraph;
    expect(para.children[0].type).toBe("underline");
  });

  it("converts # heading to heading depth-1 node", () => {
    const ast = converter.toAst("# heading");
    expect(ast.children[0].type).toBe("heading");
    expect((ast.children[0] as import("mdast").Heading).depth).toBe(1);
  });

  it("converts * list item to list + listItem nodes", () => {
    const ast = converter.toAst("* list item");
    expect(ast.children[0].type).toBe("list");
  });
});

describe("ZoomFormatConverter.fromAst() — FMT-02", () => {
  it("converts strong node to **bold**", () => {
    const ast = parseMarkdown("**bold**");
    expect(converter.fromAst(ast)).toContain("**bold**");
  });

  it("converts emphasis node to _italic_", () => {
    const ast = parseMarkdown("_italic_");
    expect(converter.fromAst(ast)).toContain("_italic_");
  });

  it("converts inlineCode node to `code`", () => {
    const ast = parseMarkdown("`code`");
    expect(converter.fromAst(ast)).toContain("`code`");
  });

  it("converts delete node to ~strikethrough~ (single tilde)", () => {
    // Build AST with ~~strikethrough~~ (standard), expect Zoom output ~strikethrough~
    const ast = parseMarkdown("~~strikethrough~~");
    const output = converter.fromAst(ast);
    expect(output).toContain("~strikethrough~");
    expect(output).not.toContain("~~strikethrough~~");
  });

  it("converts custom underline node to __underline__", () => {
    // Build AST with underline node (from toAst of __underline__)
    const ast = converter.toAst("__underline__");
    expect(converter.fromAst(ast)).toContain("__underline__");
  });

  it("converts heading node to # heading", () => {
    const ast = parseMarkdown("# heading");
    expect(converter.fromAst(ast)).toContain("# heading");
  });

  it("converts list+listItem nodes to * list item", () => {
    const ast = parseMarkdown("* list item");
    expect(converter.fromAst(ast)).toContain("* list item");
  });
});

describe("ZoomFormatConverter round-trips — FMT-03", () => {
  it("__underline__ round-trips: toAst then fromAst produces __underline__", () => {
    const ast = converter.toAst("__underline__");
    expect(converter.fromAst(ast)).toContain("__underline__");
  });

  it("~strikethrough~ round-trips: toAst then fromAst produces ~strikethrough~", () => {
    const ast = converter.toAst("~strikethrough~");
    const output = converter.fromAst(ast);
    expect(output).toContain("~strikethrough~");
    expect(output).not.toContain("~~");
  });

  it("combined formatting: __underline__ and ~strikethrough~ in same string", () => {
    const ast = converter.toAst("__hello__ and ~world~");
    const output = converter.fromAst(ast);
    expect(output).toContain("__hello__");
    expect(output).toContain("~world~");
  });
});
