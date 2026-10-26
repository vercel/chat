import { stringifyMarkdown } from "chat";
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
      const { mrkdwn } = render(
        event([
          section(text("Steps:\n")),
          list([section(text("one"))]),
          section(text("after")),
        ])
      );
      expect(mrkdwn).toBe("Steps:\n\n- one\n\nafter");
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

    it("entity-escapes text the way Slack escapes event.text", () => {
      expect(item(text("a <b> & c")).mrkdwn).toBe("- a &lt;b&gt; &amp; c");
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
      expect(performance.now() - started).toBeLessThan(1000);
      expect(body.startsWith("- a\n\n```\n\n")).toBe(true);
      expect(body.endsWith("\nx\n```")).toBe(true);
    });
  });
});
