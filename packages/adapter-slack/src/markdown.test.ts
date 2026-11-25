import { toPlainText } from "chat";
import { describe, expect, it, vi } from "vitest";
import { SlackFormatConverter } from "./markdown";

describe("SlackFormatConverter", () => {
  const converter = new SlackFormatConverter();

  describe("incoming fallback", () => {
    const OVER_BUDGET = "*".repeat(2049);
    const text = (value: string) => ({ type: "text", value });
    const link = (url: string, label: string) => ({
      type: "link",
      url,
      children: [text(label)],
    });
    const tree = (...children: unknown[]) => ({
      type: "root",
      children: [{ type: "paragraph", children }],
    });

    it.each([
      OVER_BUDGET,
      "]".repeat(129),
      "a".repeat(16_385),
      "<".repeat(20_000),
      "<unfinished\n".repeat(2000),
    ])("keeps explicit links without parsing over-budget input %#", (prefix) => {
      const parsing = new SlackFormatConverter();
      const parse = vi.spyOn(parsing, "toAst");
      const result = parsing.parseIncoming(
        `${prefix} *x* <https://example.com/a?a=1&amp;b=2|領収書> *y*`
      );
      expect(parse).not.toHaveBeenCalled();
      expect(result.text).toBe(`${prefix} *x* 領収書 *y*`);
      expect(result.formatted).toEqual(
        tree(
          text(`${prefix} *x* `),
          link("https://example.com/a?a=1&b=2", "領収書"),
          text(" *y*")
        )
      );
      expect(toPlainText(result.formatted)).toBe(result.text);
    });

    it("parses up to the emphasis limit and falls back one marker past it", () => {
      const parsing = new SlackFormatConverter();
      const parse = vi.spyOn(parsing, "toAst");
      const atLimit = `${"*".repeat(2048)} <https://example.com|receipt>`;
      parsing.parseIncoming(atLimit);
      expect(parse).toHaveBeenCalledOnce();
      expect(parse).toHaveBeenCalledWith(atLimit);

      parse.mockClear();
      const result = parsing.parseIncoming(`*${atLimit}`);
      expect(parse).not.toHaveBeenCalled();
      expect(result.text).toBe(`${OVER_BUDGET} receipt`);
      expect(result.formatted).toEqual(
        tree(text(`${OVER_BUDGET} `), link("https://example.com", "receipt"))
      );
    });

    it("keeps links when parsing overflows the stack", () => {
      const parsing = new SlackFormatConverter();
      const parse = vi.spyOn(parsing, "toAst").mockImplementation(() => {
        throw new RangeError("stack");
      });
      const result = parsing.parseIncoming("*x* <https://example.com|receipt>");
      expect(parse).toHaveBeenCalledOnce();
      expect(result.text).toBe("*x* receipt");
      expect(result.formatted).toEqual(
        tree(text("*x* "), link("https://example.com", "receipt"))
      );
    });

    it("renders labels, mentions, and entities and keeps unknown tokens as typed", () => {
      const result = converter.parseIncoming(
        `${OVER_BUDGET} *x* <@U_FAKE|sam> <#C_FAKE|team> <!here> &amp; <https://example.com|A &amp; B> <mailto:test@example.com> <tel:+15550000000|call> <javascript:alert(1)|bad> &lt;https://example.com&gt;`
      );
      expect(result.text).toBe(
        `${OVER_BUDGET} *x* @sam #team (C_FAKE) @here & A & B test@example.com call <javascript:alert(1)|bad> <https://example.com>`
      );
      expect(result.formatted).toEqual(
        tree(
          text(`${OVER_BUDGET} *x* @sam #team (C_FAKE) @here & `),
          link("https://example.com", "A & B"),
          text(" "),
          link("mailto:test@example.com", "test@example.com"),
          text(" "),
          link("tel:+15550000000", "call"),
          text(" <javascript:alert(1)|bad> <https://example.com>")
        )
      );
      expect(toPlainText(result.formatted)).toBe(result.text);
    });

    it("keeps links in parts when the combined message exceeds the budget", () => {
      const part = "*x* <https://example.com|receipt>";
      const parse = converter.incomingPartsParser([OVER_BUDGET, part]);
      expect(parse(part)).toEqual(
        tree(text("*x* "), link("https://example.com", "receipt"))
      );
      expect(parse(" ")).toEqual({ type: "root", children: [] });

      const [paragraph] = converter.incomingPartsParser([part])(part).children;
      expect(paragraph).toMatchObject({
        type: "paragraph",
        children: [
          { type: "strong", children: [text("x")] },
          text(" "),
          {
            type: "link",
            url: "https://example.com",
            children: [text("receipt")],
          },
        ],
      });
    });

    it("decodes entities within each text and link segment", () => {
      const result = converter.parseIncoming(
        `${OVER_BUDGET} *x* &am<https://example.com|p;> &amp;<https://example.com/b|lt;> *y*`
      );
      expect(result.text).toBe(`${OVER_BUDGET} *x* &amp; &lt; *y*`);
      expect(result.formatted).toEqual(
        tree(
          text(`${OVER_BUDGET} *x* &am`),
          link("https://example.com", "p;"),
          text(" &"),
          link("https://example.com/b", "lt;"),
          text(" *y*")
        )
      );
      expect(toPlainText(result.formatted)).toBe(result.text);
    });

    it("links a reversed link token to its URL with the label as text", () => {
      const result = converter.parseIncoming(
        `${OVER_BUDGET} *x* <docs &amp; more|https://example.com/a?a=1&amp;b=2> <|https://example.com> *y*`
      );
      expect(result.text).toBe(
        `${OVER_BUDGET} *x* docs & more <|https://example.com> *y*`
      );
      expect(result.formatted).toEqual(
        tree(
          text(`${OVER_BUDGET} *x* `),
          link("https://example.com/a?a=1&b=2", "docs & more"),
          text(" <|https://example.com> *y*")
        )
      );
      expect(toPlainText(result.formatted)).toBe(result.text);
    });

    it.each([
      [
        "<https://example.com/a>",
        "https://example.com/a",
        "https://example.com/a",
      ],
      ["<https://example.com/a|b|c>", "https://example.com/a", "b|c"],
      ["<mailto:a@example.com>", "mailto:a@example.com", "a@example.com"],
      ["<mailto:a@example.com|b|c>", "mailto:a@example.com", "b|c"],
      ["<tel:+15550100>", "tel:+15550100", "+15550100"],
      ["<docs|https://example.com/a>", "https://example.com/a", "docs"],
    ])("links %s as the parser does", (token, url, label) => {
      const parsed = converter.parseIncoming(token);
      expect(parsed.text).toBe(label);
      expect(parsed.formatted).toMatchObject(
        tree({ type: "link", url, children: [text(label)] })
      );

      const result = converter.parseIncoming(`${OVER_BUDGET} *x* ${token} *y*`);
      expect(result.text).toBe(`${OVER_BUDGET} *x* ${label} *y*`);
      expect(result.formatted).toEqual(
        tree(text(`${OVER_BUDGET} *x* `), link(url, label), text(" *y*"))
      );
      expect(toPlainText(result.formatted)).toBe(result.text);
    });

    it.each([
      ["<mailto:>", "mailto:"],
      ["<tel:>", "tel:"],
      ["<https://>", "https://"],
      ["<https://|x>", "https://|x"],
      ["<mailto:|x>", "mailto:|x"],
      ["<https://example.com|>", "https://example.com|"],
      ["<mailto:a@example.com|>", "mailto:a@example.com|"],
      ["<http://a b>", "http://a b"],
      ["<http://a b|c>", "[c](http://a b)"],
      ["<mailto:a b|c>", "[c](mailto:a b)"],
      ["<mailto:a b>", "[a b](mailto:a b)"],
      ["<docs|https://a b>", "[docs](https://a b)"],
      ["<mailto:|a b>", "<mailto:|a b>"],
      ["<|https://example.com>", "<|https://example.com>"],
    ])("renders %s as the parser's text without a link", (token, rendered) => {
      expect(converter.parseIncoming(token).text).toBe(rendered);

      const result = converter.parseIncoming(`${OVER_BUDGET} *x* ${token} *y*`);
      expect(result.text).toBe(`${OVER_BUDGET} *x* ${rendered} *y*`);
      expect(result.formatted).toEqual(
        tree(text(`${OVER_BUDGET} *x* ${rendered} *y*`))
      );
      expect(toPlainText(result.formatted)).toBe(result.text);
    });

    it.each([
      ["<!subteam^S_FAKE|>"],
      ["<@U_FAKE|>"],
      ["<#C_FAKE|>"],
      ["<docs|https://example.com|more>"],
      ["<https://example.com|a\rb>"],
      ["<https://example.com|a\nb>"],
    ])("keeps %j as typed", (token) => {
      const result = converter.parseIncoming(`${OVER_BUDGET} *x* ${token} *y*`);
      expect(result).toEqual({
        text: `${OVER_BUDGET} *x* ${token} *y*`,
        formatted: tree(text(`${OVER_BUDGET} *x* ${token} *y*`)),
      });
    });

    it("renders a special mention with an empty label as the parser does", () => {
      expect(converter.parseIncoming("<!here|>").text).toBe("@here");
      expect(
        converter.parseIncoming(`${OVER_BUDGET} *x* <!here|> *y*`)
      ).toEqual({
        text: `${OVER_BUDGET} *x* @here *y*`,
        formatted: tree(text(`${OVER_BUDGET} *x* @here *y*`)),
      });
    });

    it("renders a link token with a tab in its destination as text", () => {
      const result = converter.parseIncoming(
        `${OVER_BUDGET} *x* <http://a\tb|c> *y*`
      );
      expect(result).toEqual({
        text: `${OVER_BUDGET} *x* [c](http://a\tb) *y*`,
        formatted: tree(text(`${OVER_BUDGET} *x* [c](http://a\tb) *y*`)),
      });
    });

    it("returns one empty text node for empty text", () => {
      class AlwaysOver extends SlackFormatConverter {
        protected override exceedsIncomingBudget(): boolean {
          return true;
        }
      }
      expect(new AlwaysOver().parseIncoming("")).toEqual({
        text: "",
        formatted: tree(text("")),
      });
    });

    describe("incomingFallbackText override", () => {
      const input = `${OVER_BUDGET} *x* <@U_FAKE|sam> &amp; <https://example.com/secret|secret receipt>`;
      const rendered = `${OVER_BUDGET} *x* @sam & secret receipt`;

      it("uses the overridden text and drops link nodes", () => {
        const received: string[] = [];
        class Redacting extends SlackFormatConverter {
          protected override incomingFallbackText(mrkdwn: string): string {
            const fallback = super.incomingFallbackText(mrkdwn);
            received.push(fallback);
            return fallback.replaceAll("secret", "[redacted]");
          }
        }
        const redacted = `${OVER_BUDGET} *x* @sam & [redacted] receipt`;
        const redacting = new Redacting();

        expect(redacting.parseIncoming(input)).toEqual({
          text: redacted,
          formatted: tree(text(redacted)),
        });
        expect(redacting.incomingPartsParser([input])(input)).toEqual(
          tree(text(redacted))
        );
        expect(received).toEqual([rendered, rendered]);
      });

      it("drops link nodes when the override leaves the text unchanged", () => {
        const calls: string[] = [];
        class RedactingSource extends SlackFormatConverter {
          protected override incomingFallbackText(mrkdwn: string): string {
            calls.push(mrkdwn);
            return super.incomingFallbackText(
              mrkdwn.replaceAll("/secret", "/redacted")
            );
          }
        }
        const source = `${OVER_BUDGET} *x* <https://example.com/secret|receipt>`;
        const visible = `${OVER_BUDGET} *x* receipt`;
        expect(converter.parseIncoming(source)).toEqual({
          text: visible,
          formatted: tree(
            text(`${OVER_BUDGET} *x* `),
            link("https://example.com/secret", "receipt")
          ),
        });

        const redacting = new RedactingSource();
        expect(redacting.parseIncoming(source)).toEqual({
          text: visible,
          formatted: tree(text(visible)),
        });
        expect(redacting.incomingPartsParser([source])(source)).toEqual(
          tree(text(visible))
        );
        expect(calls).toEqual([source, source]);
      });
    });
  });

  describe("toMarkdown (mrkdwn -> markdown)", () => {
    it.each([
      "cost is 2 * 3 seats and 4 * 5 licenses",
      "run `rm -rf *` then 5 * 3",
      "keep `*star* ~strike~` literal",
    ])("preserves literal content in %s", (text) => {
      expect(toPlainText(converter.toAst(text))).toBe(text.replaceAll("`", ""));
    });

    it("retains bold around literal inline code", () => {
      const ast = converter.toAst("*before `*code*` after*");

      expect(ast.children[0]).toMatchObject({
        type: "paragraph",
        children: [
          {
            type: "strong",
            children: [
              { type: "text", value: "before " },
              { type: "inlineCode", value: "*code*" },
              { type: "text", value: " after" },
            ],
          },
        ],
      });
    });

    it.each([
      ["mailto:a*b*c@example.com", "email"],
      ["mailto:a~b~c@example.com", "email"],
      ["mailto:user@example.com", "https://example.com"],
      ["tel:+15551234567", "https://example.com"],
      ["mailto:user@example.com", "support ] desk"],
      ["mailto:user@example.com?subject=(help)", "support"],
    ])("preserves link destination %s and label %s", (url, label) => {
      const ast = converter.toAst(`<${url}|${label}>`);

      expect(ast.children[0]).toMatchObject({
        type: "paragraph",
        children: [
          { type: "link", url, children: [{ type: "text", value: label }] },
        ],
      });
      expect(toPlainText(ast)).toBe(label);
    });

    it("preserves code starting immediately after the opening fence", () => {
      const ast = converter.toAst("```first line\nsecond line\n```");

      expect(ast.children[0]).toMatchObject({
        type: "code",
        lang: null,
        meta: null,
        value: "first line\nsecond line",
      });
      expect(toPlainText(ast)).toBe("first line\nsecond line");
    });

    it("parses a code block pasted into a message", () => {
      // From sample-messages.md: a fence with a first line, mid-message.
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

    it("does not swallow text after an unpaired fence", () => {
      const ast = converter.toAst("use ``` to fence code, *see*?");

      expect(ast.children).toHaveLength(1);
      expect(ast.children[0]).toMatchObject({ type: "paragraph" });
      expect(toPlainText(ast)).toBe("use ``` to fence code, see?");
    });

    it("keeps a quoted fence inside the blockquote", () => {
      const ast = converter.toAst("&gt; a ```c``` b");

      expect(ast.children).toHaveLength(1);
      expect(ast.children[0]).toMatchObject({ type: "blockquote" });
      expect(toPlainText(ast)).toBe("a c b");
    });

    it("keeps trailing text after a code block as a paragraph", () => {
      const ast = converter.toAst("```x``` &gt; note");

      expect(ast.children[0]).toMatchObject({ type: "code", value: "x" });
      expect(ast.children[1]).toMatchObject({ type: "paragraph" });
      expect(toPlainText(ast)).toBe("x\n\n> note");
    });

    it("keeps code content verbatim inside the fence", () => {
      const ast = converter.toAst("```int *a = *b;```");

      expect(ast.children[0]).toMatchObject({
        type: "code",
        value: "int *a = *b;",
      });
    });

    it("should convert bold", () => {
      expect(converter.toMarkdown("Hello *world*!")).toContain("**world**");
    });

    it("should convert strikethrough", () => {
      expect(converter.toMarkdown("Hello ~world~!")).toContain("~~world~~");
    });

    it("should convert links with text", () => {
      const result = converter.toMarkdown("Check <https://example.com|this>");
      expect(result).toContain("[this](https://example.com)");
    });

    it("should convert bare links", () => {
      const result = converter.toMarkdown("Visit <https://example.com>");
      expect(result).toContain("https://example.com");
    });

    it("should convert user mentions", () => {
      const result = converter.toMarkdown("Hey <@U123|john>!");
      expect(result).toContain("@john");
    });

    it("should convert channel mentions", () => {
      const result = converter.toMarkdown("Join <#C123|general>");
      expect(result).toContain("#general");
    });

    it("should convert bare channel ID mentions", () => {
      const result = converter.toMarkdown("Join <#C123>");
      expect(result).toContain("#C123");
    });
  });

  describe("toSlackPayload", () => {
    it("routes plain strings to text (preserves literal markdown chars)", () => {
      expect(converter.toSlackPayload("Use *foo* literally")).toEqual({
        text: "Use *foo* literally",
      });
    });

    it("routes raw strings to text", () => {
      expect(converter.toSlackPayload({ raw: "*already mrkdwn*" })).toEqual({
        text: "*already mrkdwn*",
      });
    });

    it("routes markdown to markdown_text", () => {
      expect(
        converter.toSlackPayload({ markdown: "## Heading\n\n- a\n- b" })
      ).toEqual({ markdown_text: "## Heading\n\n- a\n- b" });
    });

    it("routes ast to markdown_text via stringifyMarkdown", () => {
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
      const result = converter.toSlackPayload({ ast });
      expect(result).toHaveProperty("markdown_text");
      expect((result as { markdown_text: string }).markdown_text).toContain(
        "**bold**"
      );
    });

    it("preserves tables when rendering ast to markdown_text", () => {
      const ast = {
        type: "root" as const,
        children: [
          {
            type: "table" as const,
            align: [null, null] as Array<"left" | "right" | "center" | null>,
            children: [
              {
                type: "tableRow" as const,
                children: [
                  {
                    type: "tableCell" as const,
                    children: [{ type: "text" as const, value: "A" }],
                  },
                  {
                    type: "tableCell" as const,
                    children: [{ type: "text" as const, value: "B" }],
                  },
                ],
              },
              {
                type: "tableRow" as const,
                children: [
                  {
                    type: "tableCell" as const,
                    children: [{ type: "text" as const, value: "1" }],
                  },
                  {
                    type: "tableCell" as const,
                    children: [{ type: "text" as const, value: "2" }],
                  },
                ],
              },
            ],
          },
        ],
      };
      const result = converter.toSlackPayload({ ast });
      expect(result).toHaveProperty("markdown_text");
      const text = (result as { markdown_text: string }).markdown_text;
      expect(text).toContain("| A | B |");
      expect(text).toContain("| 1 | 2 |");
    });
  });

  describe("toResponseUrlText", () => {
    it("renders markdown to Slack mrkdwn text", () => {
      expect(
        converter.toResponseUrlText({
          markdown: "**Bold** and [link](https://example.com)",
        })
      ).toBe("*Bold* and <https://example.com|link>");
    });

    it("renders markdown tables as ASCII code blocks", () => {
      expect(
        converter.toResponseUrlText({
          markdown: "| A | B |\n|---|---|\n| 1 | 2 |",
        })
      ).toContain("```\n");
    });

    it("prefixes a lazy continuation line in a quote", () => {
      expect(
        converter.toResponseUrlText({ markdown: "> line one\nline two" })
      ).toBe("> line one\n> line two");
    });

    it("skips a quote child that renders to nothing", () => {
      expect(
        converter.toResponseUrlText({
          markdown: "> [foo]: https://example.com\n>\n> first\n>\n> second",
        })
      ).toBe("> first\n>\n> second");
    });

    it("does not end a quote with a blank quoted line", () => {
      expect(
        converter.toResponseUrlText({
          markdown: "> text\n>\n> [foo]: https://example.com",
        })
      ).toBe("> text");
    });

    it("quotes every line of a multi-line paragraph", () => {
      expect(
        converter.toResponseUrlText({ markdown: "> line one\n> line two" })
      ).toBe("> line one\n> line two");
    });

    it("quotes every paragraph of a multi-paragraph blockquote", () => {
      expect(
        converter.toResponseUrlText({
          markdown: "> first paragraph\n>\n> second paragraph",
        })
      ).toBe("> first paragraph\n>\n> second paragraph");
    });

    it("quotes every list item inside a blockquote", () => {
      expect(converter.toResponseUrlText({ markdown: "> - a\n> - b" })).toBe(
        "> • a\n> • b"
      );
    });

    it("prefixes nested blockquotes and code blocks on every line", () => {
      expect(
        converter.toResponseUrlText({
          markdown: [
            "> outer",
            ">",
            "> > inner one",
            "> >",
            "> > inner two",
            ">",
            "> ```",
            "> line one",
            "> line two",
            "> ```",
          ].join("\n"),
        })
      ).toBe(
        [
          "> outer",
          ">",
          "> > inner one",
          "> >",
          "> > inner two",
          ">",
          "> ```",
          "> line one",
          "> line two",
          "> ```",
        ].join("\n")
      );
    });

    it("treats a carriage return as a line break inside a quote", () => {
      expect(
        converter.toResponseUrlText({
          markdown: "> ```\r> first\r>\r> second\r> ```",
        })
      ).toBe("> ```\n> first\n>\n> second\n> ```");
    });
  });

  describe("mentions", () => {
    it("does not double-wrap existing <@U123> mentions in plain strings", () => {
      expect(converter.toSlackPayload("Hey <@U12345>. Please select")).toEqual({
        text: "Hey <@U12345>. Please select",
      });
    });

    it("does not double-wrap existing mentions in markdown", () => {
      expect(
        converter.toSlackPayload({ markdown: "Hey <@U12345>. Please select" })
      ).toEqual({ markdown_text: "Hey <@U12345>. Please select" });
    });

    it("rewrites bare @mentions in plain strings", () => {
      expect(converter.toSlackPayload("Hey @george. Please select")).toEqual({
        text: "Hey <@george>. Please select",
      });
    });

    it("rewrites bare @mentions in markdown", () => {
      expect(
        converter.toSlackPayload({ markdown: "Hey @george. Please select" })
      ).toEqual({ markdown_text: "Hey <@george>. Please select" });
    });

    it("does not mangle email addresses in plain strings", () => {
      expect(
        converter.toSlackPayload("Contact user@example.com for help")
      ).toEqual({ text: "Contact user@example.com for help" });
    });

    it("does not mangle mailto links", () => {
      expect(
        converter.toSlackPayload("Email <mailto:user@example.com>")
      ).toEqual({ text: "Email <mailto:user@example.com>" });
    });

    it("converts mentions adjacent to non-word punctuation", () => {
      expect(converter.toSlackPayload("(cc @george, @anne)")).toEqual({
        text: "(cc <@george>, <@anne>)",
      });
    });

    it("does not mangle @handles inside URL paths in plain strings", () => {
      expect(
        converter.toSlackPayload("See https://hackmd.io/@jkyang/B1W69XA-fe")
      ).toEqual({ text: "See https://hackmd.io/@jkyang/B1W69XA-fe" });
    });

    it("does not mangle @handles inside URL paths in markdown", () => {
      expect(
        converter.toSlackPayload({
          markdown: "See https://mastodon.social/@user for updates",
        })
      ).toEqual({
        markdown_text: "See https://mastodon.social/@user for updates",
      });
    });

    it("does not mangle @handles inside URL query strings", () => {
      expect(
        converter.toSlackPayload("Profile https://example.com/p?user=@george")
      ).toEqual({ text: "Profile https://example.com/p?user=@george" });
    });

    it("does not mangle @handles inside URL fragments", () => {
      expect(
        converter.toSlackPayload("Jump https://example.com/docs#@george")
      ).toEqual({ text: "Jump https://example.com/docs#@george" });
    });

    it("does not mangle @handles inside Slack links", () => {
      expect(
        converter.toSlackPayload(
          "See <https://example.com/p?user=@george|George's profile>"
        )
      ).toEqual({
        text: "See <https://example.com/p?user=@george|George's profile>",
      });
    });

    it("does not mangle @handles inside Markdown links", () => {
      expect(
        converter.toSlackPayload({
          markdown: "See [profile](https://example.com/p?user=@george)",
        })
      ).toEqual({
        markdown_text: "See [profile](https://example.com/p?user=@george)",
      });
    });

    it("does not link @handles inside inline code", () => {
      expect(
        converter.toSlackPayload("Use `@vercel/postgres` and ping @george")
      ).toEqual({
        text: "Use `@vercel/postgres` and ping <@george>",
      });
    });

    it("does not link @handles inside fenced code", () => {
      expect(
        converter.toSlackPayload({
          markdown:
            "Install:\n```\nnpm install @vercel/postgres\n```\ncc @george",
        })
      ).toEqual({
        markdown_text:
          "Install:\n```\nnpm install @vercel/postgres\n```\ncc <@george>",
      });
    });

    it("does not mangle @handles inside schemeless host paths", () => {
      expect(converter.toSlackPayload("See hackmd.io/@jkyang/abc")).toEqual({
        text: "See hackmd.io/@jkyang/abc",
      });
    });

    it("rewrites slash-separated mentions", () => {
      expect(converter.toSlackPayload("cc @george/@anne")).toEqual({
        text: "cc <@george>/<@anne>",
      });
    });

    it("rewrites mentions after schemeless host punctuation", () => {
      expect(converter.toSlackPayload("See example.com,@george")).toEqual({
        text: "See example.com,<@george>",
      });
    });

    it("still rewrites a real mention that follows a URL", () => {
      expect(
        converter.toSlackPayload("See https://hackmd.io/@jkyang/abc cc @george")
      ).toEqual({
        text: "See https://hackmd.io/@jkyang/abc cc <@george>",
      });
    });

    it("preserves schemeless URL handles in response URL markdown", () => {
      expect(
        converter.toResponseUrlText({
          markdown: "See hackmd.io/@jkyang/abc cc @george",
        })
      ).toBe("See hackmd.io/@jkyang/abc cc <@george>");
    });

    it("handles malformed angle text without rescanning it", () => {
      const prefix = "<".repeat(20_000);
      expect(
        converter.toSlackPayload(
          `${prefix} https://example.com/@jkyang cc @george`
        )
      ).toEqual({
        text: `${prefix} https://example.com/@jkyang cc <@george>`,
      });
    });
  });

  describe("toPlainText", () => {
    it("should remove bold markers", () => {
      expect(converter.toPlainText("Hello *world*!")).toBe("Hello world!");
    });

    it("should remove italic markers", () => {
      expect(converter.toPlainText("Hello _world_!")).toBe("Hello world!");
    });

    it("should extract link text", () => {
      expect(converter.toPlainText("Check <https://example.com|this>")).toBe(
        "Check this"
      );
    });

    it("should format user mentions", () => {
      const result = converter.toPlainText("Hey <@U123>!");
      expect(result).toContain("@U123");
    });

    it("should handle complex messages", () => {
      const input =
        "*Bold* and _italic_ with <https://x.com|link> and <@U123|user>";
      const result = converter.toPlainText(input);
      expect(result).toContain("Bold");
      expect(result).toContain("italic");
      expect(result).toContain("link");
      expect(result).toContain("user");
      expect(result).not.toContain("*");
      expect(result).not.toContain("<");
    });
  });
});
