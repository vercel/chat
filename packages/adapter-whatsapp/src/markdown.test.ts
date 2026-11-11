import { type Root, stringifyMarkdown } from "chat";
import { describe, expect, it, vi } from "vitest";
import { WhatsAppFormatConverter } from "./markdown";

vi.mock("chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("chat")>();
  return { ...actual, stringifyMarkdown: vi.fn(actual.stringifyMarkdown) };
});

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

    it("preserves code starting immediately after the opening fence", () => {
      // From sample-messages.md: WhatsApp puts the first code line right
      // after the ```, which CommonMark would read as an info string.
      const ast = converter.toAst(
        "Here you go:\n```first line\nsecond line```"
      );
      expect(ast.children[0]).toMatchObject({ type: "paragraph" });
      expect(ast.children[1]).toMatchObject({
        type: "code",
        lang: null,
        value: "first line\nsecond line",
      });
    });

    it("does not rewrite bold or strikethrough inside fenced code", () => {
      const ast = converter.toAst("```int *a = *b; ~x~```");
      expect(ast.children[0]).toMatchObject({
        type: "code",
        value: "int *a = *b; ~x~",
      });
    });

    it("keeps an unpaired ``` as literal text", () => {
      const ast = converter.toAst("use ``` to fence *code*");
      expect(ast.children).toHaveLength(1);
      expect(ast.children[0]).toMatchObject({ type: "paragraph" });
    });

    it("separates a fence from surrounding text on the same line", () => {
      const ast = converter.toAst("before ```code``` after");
      const types = ast.children.map((child) => child.type);
      expect(types).toEqual(["paragraph", "code", "paragraph"]);
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
      expect(result).toBe("a * b and c ~ d");
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
    it.each([
      ["(~80 % easy)", "(~80 % easy)"],
      ["~45 min, Pace ~6:29/km", "~45 min, Pace ~6:29/km"],
      [
        String.raw`C:\Users\Luis and foo_bar`,
        String.raw`C:\Users\Luis and foo_bar`,
      ],
      [
        String.raw`A backslash before a tilde: \\\~80`,
        String.raw`A backslash before a tilde: \~80`,
      ],
      [String.raw`Literal \*\*stars\*\*`, String.raw`Literal \*\*stars\*\*`],
      [String.raw`\_init\_ and \~gone\~`, String.raw`\_init\_ and \~gone\~`],
      ["foo_bar_baz", "foo_bar_baz"],
      [String.raw`a \* b and c \~ d`, "a * b and c ~ d"],
      ["*un*believable", "_un_believable"],
      ["line one  \nline two", "line one\nline two"],
      [String.raw`\> not a quote`, String.raw`\> not a quote`],
      [String.raw`1\. not a list`, String.raw`1\. not a list`],
      [String.raw`\- not a bullet`, String.raw`\- not a bullet`],
      [String.raw`\* not a bullet`, String.raw`\* not a bullet`],
      ["soft break\n\\> not a quote", "soft break\n\\> not a quote"],
      ["`~80 **literal** ~~literal~~`", "`~80 **literal** ~~literal~~`"],
      [
        "```\n~80 **literal** ~~literal~~ C:\\Users\\Luis\n```",
        "```\n~80 **literal** ~~literal~~ C:\\Users\\Luis\n```",
      ],
      [
        "- **Monday** — Rest\n- _Tuesday_ — ~~Tempo~~",
        "- *Monday* — Rest\n- _Tuesday_ — ~Tempo~",
      ],
      ["**bold _italic_ ~~strike~~**", "*bold _italic_ ~strike~*"],
      ["_use snake_case here_", "_use snake_case here_"],
      ["**2 * 3 = 6**", "*2 * 3 = 6*"],
      ["~~rate ~5 per day~~", "~rate ~5 per day~"],
      ["_a_b_c_", "_a_b_c_"],
      [String.raw`**\*b**`, String.raw`*\*b*`],
      [String.raw`_\_x_`, String.raw`_\_x_`],
      [String.raw`~~y\~~~`, String.raw`~y\~~`],
      [String.raw`**see \_this\_ too**`, String.raw`*see \_this\_ too*`],
    ])("preserves literal text and formatting in %s", (markdown, expected) => {
      expect(converter.renderPostable({ markdown })).toBe(expected);
    });

    it("renders emphasis without character references", () => {
      const ast: Root = {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", value: "x" },
              {
                type: "emphasis",
                children: [{ type: "text", value: " spaced " }],
              },
              { type: "text", value: "y" },
            ],
          },
        ],
      };
      expect(converter.renderPostable({ ast })).not.toContain("&#x");
      expect(
        converter.renderPostable({ markdown: "*un*believable" })
      ).not.toContain("&#x");
    });

    it("renders deeply nested formatting without exponential lookahead", async () => {
      let markdown = "end";
      let expected = "end";
      for (let depth = 0; depth < 23; depth++) {
        const marker = depth % 2 === 0 ? "*" : "~";
        markdown = `text ${marker}${marker}${markdown} end${marker}${marker}`;
        expected = `text ${marker}${expected} end${marker}`;
      }

      const actual = await vi.importActual<typeof import("chat")>("chat");
      let textNodes = 0;
      actual.walkAst(actual.parseMarkdown(markdown), (node) => {
        if (node.type === "text") {
          textNodes++;
        }
        return node;
      });
      let textCalls = 0;
      vi.mocked(stringifyMarkdown).mockImplementationOnce((ast, options) => {
        const text = options?.handlers?.text;
        if (!text) {
          throw new Error("Expected a text handler");
        }
        return actual.stringifyMarkdown(ast, {
          ...options,
          handlers: {
            ...options.handlers,
            text: (...args) => {
              textCalls++;
              return text(...args);
            },
          },
        });
      });

      expect(converter.renderPostable({ markdown })).toBe(expected);
      // Each text node is serialized once, plus at most one sibling peek.
      expect(textCalls).toBeLessThanOrEqual(2 * textNodes);
    });

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

describe("parseIncoming budget", () => {
  const converter = new WhatsAppFormatConverter();
  const markers = "_a".repeat(2100);
  const unparsed = (value: string) => ({
    text: value,
    formatted: {
      type: "root",
      children: [{ type: "paragraph", children: [{ type: "text", value }] }],
    },
  });

  it("counts text after a fence closed inline", () => {
    const input = `\`\`\`\ncode\`\`\`\n${markers}`;
    const toAst = vi.spyOn(converter, "toAst");
    try {
      expect(converter.parseIncoming(input)).toEqual(unparsed(input));
      expect(toAst).not.toHaveBeenCalled();
    } finally {
      toAst.mockRestore();
    }
  });

  it("skips text inside a fence closed inline", () => {
    const input = `\`\`\`\n${markers}\`\`\``;
    const { formatted } = converter.parseIncoming(input);
    expect(formatted).toEqual(converter.toAst(input));
    expect(formatted.children).toEqual([
      expect.objectContaining({ type: "code", value: markers }),
    ]);
  });
});
