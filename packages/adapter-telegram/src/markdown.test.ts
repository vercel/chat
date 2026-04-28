import { describe, expect, it } from "vitest";
import {
  endsWithOrphanBackslash,
  escapeMarkdownV2,
  findUnescapedPositions,
  TelegramFormatConverter,
  truncateForTelegram,
} from "./markdown";

const TABLE_PIPE_PATTERN = /\|.*Name.*\|/;
const TRAILING_TRIPLE_BACKTICK_PATTERN = /```\s*$/;
const BASH_CODE_BLOCK_PATTERN = /```bash\n([\s\S]*?)\n```/;
const ESCAPED_ELLIPSIS_PATTERN = /\\\.\\\.\\\.$/;

// All 20 MarkdownV2 special characters per the Telegram Bot API spec.
// Each must be escaped with a backslash when appearing in normal text.
// https://core.telegram.org/bots/api#markdownv2-style
const MARKDOWNV2_SPECIAL_CHARS = [
  "_",
  "*",
  "[",
  "]",
  "(",
  ")",
  "~",
  "`",
  ">",
  "#",
  "+",
  "-",
  "=",
  "|",
  "{",
  "}",
  ".",
  "!",
  "\\",
];

describe("escapeMarkdownV2", () => {
  for (const char of MARKDOWNV2_SPECIAL_CHARS) {
    it(`escapes the special character ${JSON.stringify(char)}`, () => {
      expect(escapeMarkdownV2(`a${char}b`)).toBe(`a\\${char}b`);
    });
  }

  it("leaves non-special ASCII untouched", () => {
    expect(escapeMarkdownV2("Hello world 123")).toBe("Hello world 123");
  });

  it("leaves unicode characters untouched", () => {
    expect(escapeMarkdownV2("café — €50")).toBe("café — €50");
  });

  it("escapes multiple special characters in one string", () => {
    expect(escapeMarkdownV2("a.b!c(d)")).toBe("a\\.b\\!c\\(d\\)");
  });

  it("handles empty input", () => {
    expect(escapeMarkdownV2("")).toBe("");
  });
});

describe("TelegramFormatConverter", () => {
  const converter = new TelegramFormatConverter();

  describe("fromAst — inline formatting", () => {
    it("passes plain text through unchanged", () => {
      expect(converter.fromAst(converter.toAst("Hello world"))).toBe(
        "Hello world"
      );
    });

    it("renders bold with single asterisks", () => {
      expect(converter.fromAst(converter.toAst("**bold text**"))).toBe(
        "*bold text*"
      );
    });

    it("renders italic with underscores", () => {
      expect(converter.fromAst(converter.toAst("*italic text*"))).toBe(
        "_italic text_"
      );
    });

    it("renders strikethrough with single tilde", () => {
      expect(converter.fromAst(converter.toAst("~~strikethrough~~"))).toBe(
        "~strikethrough~"
      );
    });

    it("escapes special chars inside bold", () => {
      expect(converter.fromAst(converter.toAst("**Note: important!**"))).toBe(
        "*Note: important\\!*"
      );
    });

    it("escapes special chars inside italic", () => {
      expect(converter.fromAst(converter.toAst("*price: $50.*"))).toBe(
        "_price: $50\\._"
      );
    });

    it("preserves inline code content verbatim", () => {
      expect(converter.fromAst(converter.toAst("Use `const x = 1`"))).toContain(
        "`const x = 1`"
      );
    });

    it("escapes only backtick and backslash inside inline code", () => {
      expect(
        converter
          .fromAst(converter.toAst("Use `foo.bar!` here"))
          .includes("`foo.bar!`")
      ).toBe(true);
    });
  });

  describe("fromAst — code blocks", () => {
    it("wraps code blocks with triple backticks and language", () => {
      const output = converter.fromAst(
        converter.toAst("```js\nconst x = 1;\n```")
      );
      expect(output).toContain("```js");
      expect(output).toContain("const x = 1;");
      expect(output).toMatch(TRAILING_TRIPLE_BACKTICK_PATTERN);
    });

    it("escapes only backtick and backslash inside fenced code", () => {
      const output = converter.fromAst(
        converter.toAst("```\nfoo.bar! + (test) = [ok]\n```")
      );
      // Normal-text special chars must NOT be escaped inside code blocks.
      expect(output).toContain("foo.bar! + (test) = [ok]");
    });

    it("escapes a backslash inside fenced code", () => {
      const output = converter.fromAst(
        converter.toAst("```\npath\\\\to\\\\file\n```")
      );
      expect(output).toContain("\\\\");
    });
  });

  describe("fromAst — links and images", () => {
    it("renders inline links", () => {
      expect(
        converter.fromAst(converter.toAst("[click](https://example.com)"))
      ).toBe("[click](https://example.com)");
    });

    it("escapes only ) and \\ inside the URL", () => {
      const input = "[label](https://example.com/path)";
      expect(converter.fromAst(converter.toAst(input))).toBe(
        "[label](https://example.com/path)"
      );
    });

    it("escapes special chars inside link label text", () => {
      const output = converter.fromAst(
        converter.toAst("[hello!](https://example.com)")
      );
      expect(output).toBe("[hello\\!](https://example.com)");
    });

    it("renders an image as a link to the source", () => {
      const output = converter.fromAst(
        converter.toAst("![alt text](https://example.com/pic.png)")
      );
      expect(output).toContain("alt text");
      expect(output).toContain("https://example.com/pic.png");
    });
  });

  describe("fromAst — block structures", () => {
    it("renders headings as bold (all levels)", () => {
      for (const level of [1, 2, 3, 4, 5, 6]) {
        const hashes = "#".repeat(level);
        const output = converter.fromAst(converter.toAst(`${hashes} Title`));
        expect(output).toBe("*Title*");
      }
    });

    it("renders unordered lists with escaped dashes", () => {
      const output = converter.fromAst(converter.toAst("- one\n- two"));
      expect(output).toContain("\\- one");
      expect(output).toContain("\\- two");
    });

    it("renders ordered lists with escaped periods", () => {
      const output = converter.fromAst(converter.toAst("1. first\n2. second"));
      expect(output).toContain("1\\. first");
      expect(output).toContain("2\\. second");
    });

    it("renders blockquotes with > prefix per line", () => {
      expect(converter.fromAst(converter.toAst("> quoted text"))).toContain(
        ">quoted text"
      );
    });

    it("renders thematic break as escaped em-dashes", () => {
      expect(converter.fromAst(converter.toAst("---"))).toBe("———");
    });

    it("converts tables to ASCII code blocks and drops pipe syntax", () => {
      const output = converter.fromAst(
        converter.toAst("| Name | Age |\n|------|-----|\n| Alice | 30 |")
      );
      expect(output).toContain("```");
      expect(output).toContain("Name");
      expect(output).toContain("Alice");
      expect(output).not.toMatch(TABLE_PIPE_PATTERN);
    });
  });

  describe("fromAst — nested formatting", () => {
    it("renders bold containing italic", () => {
      // Markdown: **bold _italic_** → MarkdownV2: *bold _italic_*
      const ast = converter.toAst("**bold _italic_**");
      const output = converter.fromAst(ast);
      expect(output).toContain("*");
      expect(output).toContain("_italic_");
    });

    it("renders link containing inline code", () => {
      const output = converter.fromAst(
        converter.toAst("[`code` link](https://example.com)")
      );
      expect(output).toContain("`code`");
      expect(output).toContain("https://example.com");
    });

    it("renders list containing bold", () => {
      const output = converter.fromAst(
        converter.toAst("- **important** one\n- plain two")
      );
      expect(output).toContain("*important*");
      expect(output).toContain("plain two");
    });
  });

  describe("fromAst — edge cases", () => {
    it("handles empty input", () => {
      expect(converter.fromAst(converter.toAst(""))).toBe("");
    });

    it("handles whitespace-only input", () => {
      expect(converter.fromAst(converter.toAst("   "))).toBe("");
    });

    it("trims trailing whitespace", () => {
      const output = converter.fromAst(converter.toAst("Hello\n\n"));
      expect(output.endsWith("\n")).toBe(false);
    });

    it("escapes HTML input literally rather than interpreting it", () => {
      // Telegram MarkdownV2 has no HTML support; raw HTML must not crash.
      const output = converter.fromAst(converter.toAst("<b>hi</b>"));
      expect(output).not.toContain("<b>");
    });
  });

  describe("fromAst — MarkdownV2 validity invariant (corpus)", () => {
    // A realistic LLM-generated response exercising every node type the SDK
    // can produce. The output must be valid MarkdownV2: every special char
    // must either be escaped (\X) or live inside a code block / link URL.
    const LLM_CORPUS = [
      "# Trip Summary: Morocco",
      "",
      "Here's your **personalized** 7-day itinerary. Price: $2,450 per person (all-inclusive)!",
      "",
      "## Day 1 — Arrival in Marrakech",
      "",
      "- Airport pickup at 14:30",
      "- Check-in at *Riad El Fenn* (4-star)",
      "- Welcome dinner: [La Mamounia](https://www.mamounia.com/restaurants)",
      "",
      "> Tip: bring cash — not every souk accepts cards.",
      "",
      "## Day 2 — Atlas Mountains",
      "",
      "1. 08:00 breakfast",
      "2. 09:00 departure (2h drive)",
      "3. Hike to Toubkal base camp",
      "",
      "Pack: `sunscreen`, `hiking boots`, *layers* (temperatures drop ~10°C).",
      "",
      "```bash",
      "# Exchange rate check",
      "curl 'https://api.rates.io/MAD' | jq '.rate'",
      "```",
      "",
      "| Day | Activity | Cost |",
      "|-----|----------|------|",
      "| 1 | Arrival | $200 |",
      "| 2 | Atlas | $350 |",
      "",
      "---",
      "",
      "~~Previous version priced at $2,800~~. New total: **$2,450**.",
    ].join("\n");

    it("produces non-empty output covering every structural element", () => {
      const output = converter.fromAst(converter.toAst(LLM_CORPUS));
      // Sanity — structural elements all present in some form.
      expect(output).toContain("*Trip Summary");
      expect(output).toContain("\\- Airport pickup");
      expect(output).toContain("1\\. 08:00 breakfast");
      expect(output).toContain("_Riad El Fenn_");
      expect(output).toContain(
        "[La Mamounia](https://www.mamounia.com/restaurants)"
      );
      expect(output).toContain(">Tip:");
      expect(output).toContain("```");
      expect(output).toContain("~Previous version");
      expect(output).toContain("———");
    });

    it("escapes every in-text MarkdownV2 special character outside code and link URLs", () => {
      const output = converter.fromAst(converter.toAst(LLM_CORPUS));

      // Strip code blocks and link URLs — inside those, different rules apply.
      const withoutCodeBlocks = output.replace(/```[\s\S]*?```/g, "");
      const withoutInlineCode = withoutCodeBlocks.replace(/`[^`]*`/g, "");
      const withoutLinkUrls = withoutInlineCode.replace(/\]\([^)]*\)/g, "]()");

      // For each special char other than the ones that carry markdown
      // structure (* _ ~ [ ] ( ) > ` # whose positions we control), any
      // occurrence in plain text must be preceded by a backslash.
      const TEXT_ONLY_SPECIAL_CHARS = ["+", "=", "{", "}", ".", "!", "|"];
      for (const char of TEXT_ONLY_SPECIAL_CHARS) {
        const pattern = new RegExp(`(?<!\\\\)\\${char}`, "g");
        const matches = withoutLinkUrls.match(pattern);
        expect(
          matches,
          `Found unescaped ${char} in: ${JSON.stringify(withoutLinkUrls)}`
        ).toBeNull();
      }
    });

    it("preserves code block contents verbatim (no over-escaping)", () => {
      const output = converter.fromAst(converter.toAst(LLM_CORPUS));
      const codeBlockMatch = BASH_CODE_BLOCK_PATTERN.exec(output);
      expect(codeBlockMatch).not.toBeNull();
      const codeContent = codeBlockMatch?.[1] ?? "";
      // These symbols must appear literally — MarkdownV2 only escapes ` and \ here.
      expect(codeContent).toContain("'");
      expect(codeContent).toContain("|");
      expect(codeContent).toContain(".");
    });
  });

  describe("renderPostable", () => {
    it("returns a plain string as-is", () => {
      expect(converter.renderPostable("Hello world")).toBe("Hello world");
    });

    it("returns an empty string unchanged", () => {
      expect(converter.renderPostable("")).toBe("");
    });

    it("returns a raw message directly", () => {
      expect(converter.renderPostable({ raw: "raw content" })).toBe(
        "raw content"
      );
    });

    it("renders a markdown message as MarkdownV2", () => {
      const result = converter.renderPostable({
        markdown: "**bold** and *italic*",
      });
      expect(result).toContain("*bold*");
      expect(result).toContain("_italic_");
    });

    it("renders an AST message", () => {
      const ast = converter.toAst("Hello from AST");
      expect(converter.renderPostable({ ast })).toContain("Hello from AST");
    });

    it("renders a markdown table as a code block", () => {
      const result = converter.renderPostable({
        markdown: "| A | B |\n| --- | --- |\n| 1 | 2 |",
      });
      expect(result).toContain("```");
      expect(result).toContain("A");
    });
  });

  describe("toAst", () => {
    it("parses plain text", () => {
      const ast = converter.toAst("Hello world");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    });

    it("parses bold", () => {
      const ast = converter.toAst("**bold**");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    });

    it("parses italic", () => {
      const ast = converter.toAst("*italic*");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    });

    it("parses inline code", () => {
      const ast = converter.toAst("`code`");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    });
  });

  describe("extractPlainText", () => {
    it("strips bold markers", () => {
      expect(converter.extractPlainText("Hello **world**!")).toBe(
        "Hello world!"
      );
    });

    it("strips italic markers", () => {
      expect(converter.extractPlainText("Hello *world*!")).toBe("Hello world!");
    });

    it("strips strikethrough markers", () => {
      expect(converter.extractPlainText("Hello ~~world~~!")).toBe(
        "Hello world!"
      );
    });

    it("extracts link text", () => {
      expect(
        converter.extractPlainText("Check [this](https://example.com)")
      ).toBe("Check this");
    });

    it("preserves inline code content", () => {
      expect(converter.extractPlainText("Use `const x = 1`")).toContain(
        "const x = 1"
      );
    });

    it("preserves code block content", () => {
      expect(converter.extractPlainText("```js\nconst x = 1;\n```")).toContain(
        "const x = 1;"
      );
    });

    it("returns plain text unchanged", () => {
      expect(converter.extractPlainText("Hello world")).toBe("Hello world");
    });

    it("returns empty string unchanged", () => {
      expect(converter.extractPlainText("")).toBe("");
    });

    it("strips all formatting from complex input", () => {
      const result = converter.extractPlainText(
        "**Bold** and *italic* with [link](https://x.com)"
      );
      expect(result).toContain("Bold");
      expect(result).toContain("italic");
      expect(result).toContain("link");
      expect(result).not.toContain("**");
      expect(result).not.toContain("](");
    });
  });
});

describe("truncateForTelegram", () => {
  it("returns text unchanged when under limit", () => {
    expect(truncateForTelegram("hello", 100, "plain")).toBe("hello");
  });

  it("truncates plain text with literal ellipsis", () => {
    const result = truncateForTelegram("a".repeat(200), 100, "plain");
    expect(result.length).toBe(100);
    expect(result.endsWith("...")).toBe(true);
  });

  it("truncates MarkdownV2 with escaped ellipsis", () => {
    const result = truncateForTelegram("a".repeat(200), 100, "MarkdownV2");
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result.endsWith("\\.\\.\\.")).toBe(true);
  });

  it("strips orphan backslash before ellipsis", () => {
    const input = `${"a".repeat(90)}\\${"b".repeat(50)}`;
    const result = truncateForTelegram(input, 100, "MarkdownV2");
    const beforeEllipsis = result.replace(ESCAPED_ELLIPSIS_PATTERN, "");
    expect(endsWithOrphanBackslash(beforeEllipsis)).toBe(false);
    expect(result.endsWith("\\.\\.\\.")).toBe(true);
  });

  it("strips unclosed bold before ellipsis", () => {
    const input = `${"a".repeat(80)}*${"b".repeat(100)}`;
    const result = truncateForTelegram(input, 100, "MarkdownV2");
    const beforeEllipsis = result.replace(ESCAPED_ELLIPSIS_PATTERN, "");
    const stars = [...beforeEllipsis].filter((c) => c === "*").length;
    expect(stars % 2).toBe(0);
  });

  it("handles input that is all special chars", () => {
    const input = ".".repeat(200);
    const rendered = escapeMarkdownV2(input);
    const result = truncateForTelegram(rendered, 100, "MarkdownV2");
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result.endsWith("\\.\\.\\.")).toBe(true);
  });
});

describe("findUnescapedPositions", () => {
  it("finds unescaped markers", () => {
    expect(findUnescapedPositions("*a*", "*")).toEqual([0, 2]);
  });

  it("ignores escaped markers", () => {
    expect(findUnescapedPositions("\\*a*", "*")).toEqual([3]);
  });

  it("handles double backslash (escaped backslash) before marker", () => {
    expect(findUnescapedPositions("\\\\*", "*")).toEqual([2]);
  });

  it("returns empty for no markers", () => {
    expect(findUnescapedPositions("hello", "*")).toEqual([]);
  });
});

describe("endsWithOrphanBackslash", () => {
  it("returns true for single trailing backslash", () => {
    expect(endsWithOrphanBackslash("abc\\")).toBe(true);
  });

  it("returns false for double trailing backslash", () => {
    expect(endsWithOrphanBackslash("abc\\\\")).toBe(false);
  });

  it("returns true for triple trailing backslash", () => {
    expect(endsWithOrphanBackslash("abc\\\\\\")).toBe(true);
  });

  it("returns false for no trailing backslash", () => {
    expect(endsWithOrphanBackslash("abc")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(endsWithOrphanBackslash("")).toBe(false);
  });
});
