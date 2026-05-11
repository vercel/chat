import type { Root } from "chat";
import { describe, expect, it } from "vitest";
import { EmailFormatConverter } from "./markdown";

const converter = new EmailFormatConverter();
const EMPHASIS_GLYPH = /[*_]italic[*_]/;

describe("EmailFormatConverter#toAst", () => {
  it("parses a plain paragraph into a Root AST", () => {
    const ast = converter.toAst("Hello world");
    expect(ast.type).toBe("root");
    expect(ast.children).toHaveLength(1);
    const para = ast.children[0] as { type: string };
    expect(para.type).toBe("paragraph");
  });

  it("preserves inline formatting nodes", () => {
    const ast = converter.toAst("**bold** and *italic* and [link](https://x)");
    const para = ast.children[0] as { children: Array<{ type: string }> };
    const types = para.children.map((c) => c.type);
    expect(types).toContain("strong");
    expect(types).toContain("emphasis");
    expect(types).toContain("link");
  });

  it("parses lists, headings, and code blocks", () => {
    const ast = converter.toAst(
      "# Title\n\n- one\n- two\n\n```ts\nconst x = 1;\n```"
    );
    const types = ast.children.map((c) => (c as { type: string }).type);
    expect(types).toEqual(["heading", "list", "code"]);
  });

  it("returns a root with no children for empty input", () => {
    const ast = converter.toAst("");
    expect(ast.type).toBe("root");
    expect(ast.children).toEqual([]);
  });

  it("does not throw on email artefacts like quoted reply chevrons", () => {
    // Email replies commonly include `> quoted line` and `--` signature
    // separators; remark parses chevrons as blockquotes and that's fine.
    const ast = converter.toAst(
      "Reply text\n\n> Previous message\n> from sender\n\n-- \nSent from Foo"
    );
    expect(ast.children.length).toBeGreaterThan(0);
    const types = ast.children.map((c) => (c as { type: string }).type);
    expect(types).toContain("blockquote");
  });
});

describe("EmailFormatConverter#fromAst", () => {
  it("renders a Root AST back to markdown", () => {
    const ast: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "Hello" }],
        },
      ],
    };
    const md = converter.fromAst(ast);
    expect(md.trim()).toBe("Hello");
  });

  it("preserves bold and emphasis", () => {
    const ast = converter.toAst("**bold** and *italic*");
    const md = converter.fromAst(ast);
    // remark may pick `*` or `_` for emphasis; assert the bold and the
    // word content survive rather than the exact glyph.
    expect(md).toContain("**bold**");
    expect(md).toMatch(EMPHASIS_GLYPH);
  });

  it("returns an empty string for an empty root", () => {
    expect(converter.fromAst({ type: "root", children: [] }).trim()).toBe("");
  });
});

describe("EmailFormatConverter round-trip", () => {
  it("preserves headings, lists, and links across parse + stringify", () => {
    const input = "# Title\n\n- one\n- two\n\n[link](https://x.example)";
    const ast = converter.toAst(input);
    const out = converter.fromAst(ast);
    expect(out).toContain("# Title");
    expect(out).toContain("one");
    expect(out).toContain("two");
    expect(out).toContain("[link](https://x.example)");
  });
});

describe("EmailFormatConverter#fromMarkdown (inherited)", () => {
  it("round-trips a markdown string back to canonical markdown", () => {
    const out = converter.fromMarkdown("hello **world**");
    expect(out).toContain("hello");
    expect(out).toContain("**world**");
  });
});

describe("EmailFormatConverter#toMarkdown (inherited)", () => {
  it("parses platform text and re-stringifies it as markdown", () => {
    const out = converter.toMarkdown("just text");
    expect(out.trim()).toBe("just text");
  });
});

describe("EmailFormatConverter#extractPlainText (inherited)", () => {
  it("strips markdown formatting", () => {
    expect(converter.extractPlainText("**bold** _italic_ text")).toBe(
      "bold italic text"
    );
  });

  it("returns text from links without the URL", () => {
    expect(
      converter.extractPlainText("Visit [our site](https://example.com)!")
    ).toBe("Visit our site!");
  });

  it("returns empty string for empty input", () => {
    expect(converter.extractPlainText("")).toBe("");
  });
});

describe("EmailFormatConverter#renderPostable (inherited)", () => {
  it("passes strings through verbatim", () => {
    expect(converter.renderPostable("Hello")).toBe("Hello");
  });

  it("returns raw bodies untouched", () => {
    expect(converter.renderPostable({ raw: "<not markdown>" })).toBe(
      "<not markdown>"
    );
  });

  it("converts markdown bodies through the converter", () => {
    const out = converter.renderPostable({ markdown: "**bold**" });
    expect(out).toContain("**bold**");
  });

  it("renders an ast body via fromAst", () => {
    const ast: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "from-ast" }],
        },
      ],
    };
    expect(converter.renderPostable({ ast }).trim()).toBe("from-ast");
  });

  it("falls back to card text for card postables", () => {
    const card = {
      type: "card" as const,
      title: "Hello",
      children: [{ type: "text" as const, content: "Body" }],
    };
    const out = converter.renderPostable({ card });
    expect(out).toContain("Hello");
    expect(out).toContain("Body");
  });

  it("uses the provided fallbackText when set on a card postable", () => {
    const card = {
      type: "card" as const,
      title: "Hello",
      children: [],
    };
    expect(
      converter.renderPostable({ card, fallbackText: "PLAIN FALLBACK" })
    ).toBe("PLAIN FALLBACK");
  });
});
