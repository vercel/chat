import { stringifyMarkdown, toPlainText } from "chat";
import { describe, expect, it } from "vitest";
import type { SlackEvent, SlackMessageBlock } from "./event";
import { SlackFormatConverter } from "./markdown";
import { richTextBody } from "./rich-text";

const converter = new SlackFormatConverter();

type Style = SlackMessageBlock["style"];

const text = (value: string, style?: Style): SlackMessageBlock => ({
  type: "text",
  text: value,
  ...(style ? { style } : {}),
});
const section = (...elements: SlackMessageBlock[]): SlackMessageBlock => ({
  type: "rich_text_section",
  elements,
});
const list = (
  items: SlackMessageBlock[],
  options: { indent?: number; offset?: number; style?: string } = {}
): SlackMessageBlock =>
  // Slack sends a list's `style` as a string, which the inline style type
  // does not describe.
  ({
    type: "rich_text_list",
    style: options.style ?? "bullet",
    indent: options.indent ?? 0,
    ...(options.offset === undefined ? {} : { offset: options.offset }),
    elements: items,
  }) as unknown as SlackMessageBlock;
const event = (
  elements: SlackMessageBlock[],
  overrides: Partial<SlackEvent> = {}
): SlackEvent => ({
  type: "message",
  text: "fallback",
  blocks: [{ type: "rich_text", elements }],
  ...overrides,
});

/** The body as mrkdwn, and as markdown after the adapter's format converter. */
function render(value: SlackEvent): { markdown: string; mrkdwn: string } {
  const mrkdwn = richTextBody(value);
  if (mrkdwn === undefined) {
    throw new Error("expected a rich text body");
  }
  return { mrkdwn, markdown: stringifyMarkdown(converter.toAst(mrkdwn)) };
}

/** Render one list item made of `elements`. */
function item(...elements: SlackMessageBlock[]) {
  return render(event([list([section(...elements)])]));
}

describe("richTextBody", () => {
  describe("when it applies", () => {
    it("returns undefined without a list, so event.text stays the body", () => {
      expect(richTextBody(event([section(text("plain"))]))).toBeUndefined();
      expect(richTextBody({ type: "message", text: "no blocks" })).toBe(
        undefined
      );
    });

    it("returns undefined when a non-rich-text block carries content", () => {
      expect(
        richTextBody({
          type: "message",
          text: "fallback",
          blocks: [
            { type: "section", fields: [{ type: "mrkdwn", text: "app text" }] },
            { type: "rich_text", elements: [list([section(text("item"))])] },
          ],
        })
      ).toBeUndefined();
    });

    it.each([
      "rich_text_section",
      "rich_text_quote",
      "rich_text_preformatted",
    ])("falls back for unsupported leaves in %s", (type) => {
      const unsupported: SlackMessageBlock = {
        type: "message_mention",
        channel_id: "C123ABC456",
        message_ts: "1720710212.123456",
      };
      expect(
        richTextBody(
          event([
            list([section(text("item"))]),
            { type, elements: [unsupported] },
          ])
        )
      ).toBeUndefined();
    });

    it("falls back for unsupported leaves nested in a list", () => {
      expect(
        richTextBody(
          event([list([section({ type: "future_inline", text: "unhandled" })])])
        )
      ).toBeUndefined();
    });

    it("ignores table blocks, which keep their own handling", () => {
      const body = richTextBody({
        type: "message",
        text: "fallback",
        blocks: [
          { type: "rich_text", elements: [list([section(text("item"))])] },
          { type: "table", rows: [[{ type: "raw_text", text: "cell" }]] },
        ],
      });
      expect(body).toBe("- item");
    });
  });

  describe("lists", () => {
    it("nests a list under the content column of its parent item", () => {
      const { mrkdwn, markdown } = render(
        event([
          list([section(text("one"))], { style: "ordered", offset: 9 }),
          list([section(text("nested"))], { indent: 1 }),
          list([section(text("deeper"))], { indent: 2 }),
        ])
      );
      // "10. " is four columns wide, so the child starts at column 4.
      expect(mrkdwn).toBe("10. one\n    - nested\n      - deeper");
      expect(markdown).toBe("10. one\n    * nested\n      * deeper\n");
    });

    it("continues an ordered list after a nested list", () => {
      const { markdown } = render(
        event([
          list([section(text("first"))], { style: "ordered" }),
          list([section(text("child"))], { indent: 1 }),
          list([section(text("second"))], { style: "ordered", offset: 1 }),
        ])
      );
      expect(markdown).toBe("1. first\n   * child\n2. second\n");
    });

    it("clamps an indent deeper than any open parent", () => {
      expect(
        render(event([list([section(text("a"))], { indent: 3 })])).mrkdwn
      ).toBe("- a");
    });

    it("indents the continuation lines of a multi-line item", () => {
      const { markdown } = item(text("line one\nline two"));
      expect(markdown).toBe("* line one\n  line two\n");
    });

    it("separates lists from surrounding text with a blank line", () => {
      const { markdown } = render(
        event([
          section(text("Steps:\n")),
          list([section(text("one"))]),
          section(text("after")),
        ])
      );
      expect(markdown).toBe("Steps:\n\n* one\n\nafter\n");
    });
  });

  describe("literal list content", () => {
    it.each([
      "---",
      "***",
      "___",
      "===",
      "[x] done",
      "[ ] pending",
      "# heading",
      "> quote",
      "<b>",
      "- flag",
      "+ flag",
      "* flag",
      "1. first",
      "1) first",
      "```",
      "~~~",
      "*literal* _literal_ ~literal~ `literal`",
      "\\*literal*",
    ])("keeps %j literal on first and continuation lines", (literal) => {
      for (const value of [literal, `before\n${literal}`]) {
        const root = converter.toAst(item(text(value)).mrkdwn);
        expect(root.children).toMatchObject([
          {
            type: "list",
            ordered: false,
            children: [
              {
                type: "listItem",
                checked: null,
                children: [
                  { type: "paragraph", children: [{ type: "text", value }] },
                ],
              },
            ],
          },
        ]);
        expect(toPlainText(root)).toBe(value);
      }
    });

    it.each([
      "    # heading",
      "\t# heading",
    ])("keeps leading whitespace literal in %j", (literal) => {
      for (const value of [literal, `before\n${literal}`]) {
        const root = converter.toAst(item(text(value)).mrkdwn);
        expect(root.children).toMatchObject([
          {
            type: "list",
            children: [
              {
                type: "listItem",
                children: [
                  { type: "paragraph", children: [{ type: "text", value }] },
                ],
              },
            ],
          },
        ]);
        expect(toPlainText(root)).toBe(value);
      }
    });

    it("preserves indentation in text surrounding a list", () => {
      const root = converter.toAst(
        render(
          event([section(text("    # heading")), list([section(text("item"))])])
        ).mrkdwn
      );
      expect(root.children).toMatchObject([
        {
          type: "paragraph",
          children: [{ type: "text", value: "    # heading" }],
        },
        {
          type: "list",
          children: [
            {
              type: "listItem",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", value: "item" }],
                },
              ],
            },
          ],
        },
      ]);
      expect(toPlainText(root)).toBe("    # heading\n\nitem");
    });

    it("does not turn an indented continuation paragraph into code", () => {
      const root = converter.toAst(
        item(text("before\n\n    # heading")).mrkdwn
      );
      expect(root.children).toMatchObject([
        {
          type: "list",
          children: [
            {
              type: "listItem",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", value: "before" }],
                },
                {
                  type: "paragraph",
                  children: [{ type: "text", value: "    # heading" }],
                },
              ],
            },
          ],
        },
      ]);
      expect(toPlainText(root)).toBe("before\n    # heading");
    });

    it("protects syntax assembled from separate text elements", () => {
      const root = converter.toAst(
        item(text("-"), text("-"), text("-")).mrkdwn
      );
      expect(root.children).toMatchObject([
        {
          type: "list",
          children: [
            {
              type: "listItem",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", value: "---" }],
                },
              ],
            },
          ],
        },
      ]);
    });

    it("preserves real formatting around literal syntax", () => {
      const literal = "# *literal* [x] &lt;";
      const root = converter.toAst(item(text(literal, { bold: true })).mrkdwn);
      expect(root.children).toMatchObject([
        {
          type: "list",
          children: [
            {
              type: "listItem",
              children: [
                {
                  type: "paragraph",
                  children: [
                    {
                      type: "strong",
                      children: [{ type: "text", value: literal }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]);
      expect(toPlainText(root)).toBe(literal);
    });

    it.each([
      "*abc*",
      "<b>",
    ])("keeps %j literal when conflicting marks drop inline code", (literal) => {
      const root = converter.toAst(
        item(
          text(literal, { bold: true, code: true }),
          text("x", { italic: true })
        ).mrkdwn
      );
      expect(root.children).toMatchObject([
        {
          type: "list",
          children: [
            {
              type: "listItem",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", value: `${literal}x` }],
                },
              ],
            },
          ],
        },
      ]);
      expect(toPlainText(root)).toBe(`${literal}x`);
    });

    it("does not entity-encode punctuation inside inline code", () => {
      const literal = "--- [x] # > &lt; *literal*";
      const root = converter.toAst(item(text(literal, { code: true })).mrkdwn);
      expect(root.children).toMatchObject([
        {
          type: "list",
          children: [
            {
              type: "listItem",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "inlineCode", value: literal }],
                },
              ],
            },
          ],
        },
      ]);
      expect(toPlainText(root)).toBe(literal);
    });
  });

  describe("inline styles", () => {
    it("nests a style that starts inside another at a space", () => {
      const { mrkdwn, markdown } = item(
        text("make ", { bold: true }),
        text("this", { bold: true, italic: true }),
        text(" work", { bold: true })
      );
      expect(mrkdwn).toBe("- *make _this_ work*");
      expect(markdown).toBe("* **make *this* work**\n");
    });

    it("keeps the shared style when another changes mid-word", () => {
      const { mrkdwn, markdown } = item(
        text("foo", { bold: true }),
        text("bar", { bold: true, italic: true })
      );
      expect(mrkdwn).toBe("- *foobar*");
      expect(markdown).toBe("* **foobar**\n");
    });

    it("drops a style that mrkdwn cannot open mid-word but keeps the text", () => {
      const { markdown } = item(
        text("un"),
        text("bold", { bold: true }),
        text("ed")
      );
      expect(markdown).toBe("* unbolded\n");
    });

    it("closes a style before punctuation", () => {
      const { markdown } = item(text("Note", { bold: true }), text(": read"));
      expect(markdown).toBe("* **Note**: read\n");
    });

    it("keeps whitespace outside markers", () => {
      const { mrkdwn } = item(
        text("a "),
        text(" spaced ", { italic: true }),
        text("b")
      );
      expect(mrkdwn).toBe("- a  _spaced_ b");
    });

    it("closes and reopens markers around a line break", () => {
      const { markdown } = render(
        event([
          section(text("x")),
          list([section(text("a\nb", { bold: true }))]),
        ])
      );
      expect(markdown).toBe("x\n\n* **a**\n  **b**\n");
    });

    it("renders strike and code, with code innermost", () => {
      const { mrkdwn, markdown } = item(
        text("old", { strike: true }),
        text(" "),
        text("run", { bold: true, code: true })
      );
      expect(mrkdwn).toBe("- ~old~ *`run`*");
      expect(markdown).toBe("* ~~old~~ **`run`**\n");
    });

    it("preserves literal control characters and entity spellings", () => {
      const literal = "a <b> & c &lt; &#35;";
      const root = converter.toAst(item(text(literal)).mrkdwn);
      expect(root.children).toMatchObject([
        {
          type: "list",
          children: [
            {
              type: "listItem",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", value: literal }],
                },
              ],
            },
          ],
        },
      ]);
      expect(toPlainText(root)).toBe(literal);
    });
  });

  describe("mentions and links", () => {
    it("keeps special mentions literal inside inline code", () => {
      const { mrkdwn, markdown } = item(
        { type: "broadcast", range: "here", style: { code: true } },
        text(" and "),
        { type: "broadcast", range: "channel" }
      );
      expect(mrkdwn).toBe("- `<!here>` and <!channel>");
      expect(markdown).toBe("* `<!here>` and @channel\n");
    });

    it("applies styles to links", () => {
      const { markdown } = item(text("see "), {
        type: "link",
        url: "https://example.com",
        text: "docs",
        style: { bold: true },
      });
      expect(markdown).toBe("* see **[docs](https://example.com)**\n");
    });

    it("escapes a link label so a > cannot end the token", () => {
      const { markdown } = item({
        type: "link",
        url: "https://example.com",
        text: "a|b > c",
      });
      expect(markdown).toBe("* [a|b > c](https://example.com)\n");
    });

    it("copies user group and channel labels from event.text", () => {
      const body = richTextBody(
        event(
          [
            list([
              section(
                { type: "usergroup", usergroup_id: "S0123" },
                text(" in "),
                { type: "channel", channel_id: "C0456" },
                text(" cc "),
                { type: "user", user_id: "U0789" }
              ),
            ]),
          ],
          { text: "• <!subteam^S0123|@devs> in <#C0456|general> cc <@U0789>" }
        )
      );
      expect(body).toBe(
        "- <!subteam^S0123|@devs> in <#C0456|general> cc <@U0789>"
      );
    });
  });

  describe("rich text block boundaries", () => {
    it("keeps following text out of preceding lists and quotes", () => {
      const value = event([], {
        blocks: [
          { type: "rich_text", elements: [list([section(text("item"))])] },
          {
            type: "rich_text",
            elements: [{ type: "rich_text_quote", elements: [text("quoted")] }],
          },
          { type: "rich_text", elements: [section(text("after"))] },
        ],
      });
      const root = converter.toAst(render(value).mrkdwn);
      expect(root.children).toMatchObject([
        {
          type: "list",
          children: [
            {
              type: "listItem",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", value: "item" }],
                },
              ],
            },
          ],
        },
        {
          type: "blockquote",
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", value: "quoted" }],
            },
          ],
        },
        { type: "paragraph", children: [{ type: "text", value: "after" }] },
      ]);
      expect(toPlainText(root)).toBe("item\n\nquoted\n\nafter");
    });
  });

  describe("quotes and code blocks", () => {
    it("renders quotes and preformatted text as their own blocks", () => {
      const value = event([
        { type: "rich_text_quote", elements: [text("quoted\nlines")] },
        list([section(text("item"))]),
        { type: "rich_text_preformatted", elements: [text("a <b> *c*")] },
        section(text("after")),
      ]);
      const root = converter.toAst(richTextBody(value) ?? "");
      expect(root.children.map((node) => node.type)).toEqual([
        "blockquote",
        "list",
        "code",
        "paragraph",
      ]);
      expect(root.children[2]).toMatchObject({ value: "a <b> *c*" });
    });

    it("trims long runs of trailing newlines in linear time", () => {
      // A preformatted element renders in one pass, so the only work that
      // grows with the input is the newline trimming over the whole body.
      const newlines = "\n".repeat(200_000);
      const value = event([
        list([section(text("a"))]),
        {
          type: "rich_text_preformatted",
          elements: [text(`${newlines}x`)],
        },
      ]);
      const started = performance.now();
      const body = richTextBody(value) ?? "";
      // The quadratic regex this replaces took tens of seconds here.
      expect(performance.now() - started).toBeLessThan(5000);
      expect(body).toBe(`- a\n\n\`\`\`\n${newlines}x\n\`\`\``);
    });
  });
});
