import type { CardChild, CardElement, Root } from "chat";
import {
  Actions,
  Button,
  Card,
  Image as CardImage,
  CardLink,
  CardText,
  Divider,
  Field,
  Fields,
  LinkButton,
  Section,
  Table,
} from "chat";
import { describe, expect, it } from "vitest";
import {
  astToHtml,
  cardToHtml,
  cardToPlainText,
  escapeAttr,
  escapeHtml,
  markdownToHtml,
} from "./render";

const TEXT_ALIGN_CENTER = /style="text-align:center/;
const TEXT_ALIGN_RIGHT = /style="text-align:right/;

describe("escapeHtml", () => {
  it("escapes the standard HTML character set", () => {
    expect(escapeHtml(`<script>alert("x" & 'y')</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;"
    );
  });
});

describe("escapeAttr", () => {
  it("strips control characters", () => {
    expect(escapeAttr("https://example.com\u0007/path")).toBe(
      "https://example.com/path"
    );
  });
});

describe("markdownToHtml", () => {
  it("renders headings, bold, italic, and links", () => {
    const html = markdownToHtml(
      "# Hello\n\n**bold** and *italic* and [link](https://example.com)"
    );
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain('<a href="https://example.com">link</a>');
  });

  it("renders ordered and unordered lists", () => {
    const html = markdownToHtml("- one\n- two\n\n1. first\n2. second");
    expect(html).toContain("<ul>");
    expect(html).toContain("one");
    expect(html).toContain("two");
    expect(html).toContain("<ol>");
    expect(html).toContain("first");
    expect(html).toContain("second");
  });

  it("renders code blocks with language class", () => {
    const html = markdownToHtml("```ts\nconst x = 1;\n```");
    expect(html).toContain('<code class="language-ts">');
    expect(html).toContain("const x = 1;");
  });

  it("renders inline code", () => {
    const html = markdownToHtml("Use `foo` here.");
    expect(html).toContain("<code>foo</code>");
  });

  it("renders thematic breaks", () => {
    const html = markdownToHtml("a\n\n---\n\nb");
    expect(html).toContain("<hr />");
  });

  it("renders GFM tables", () => {
    const html = markdownToHtml(
      "| H1 | H2 |\n| --- | --- |\n| a | b |\n| c | d |"
    );
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("<td");
    expect(html).toContain("a");
    expect(html).toContain("d");
  });

  it("escapes HTML in markdown text content", () => {
    const html = markdownToHtml("Hello <script>x</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("astToHtml", () => {
  it("delegates to markdownToHtml result for trivial input", () => {
    expect(astToHtml({ type: "root", children: [] })).toBe("");
  });
});

describe("cardToHtml", () => {
  it("renders title, subtitle, and text", () => {
    const card = Card({
      title: "Order #1234",
      subtitle: "Submitted today",
      children: [CardText("Total: $50.00")],
    });
    const html = cardToHtml(card);
    expect(html).toContain("Order #1234");
    expect(html).toContain("Submitted today");
    expect(html).toContain("Total: $50.00");
  });

  it("escapes title and subtitle", () => {
    const card = Card({
      title: "<script>",
      subtitle: '"x"',
      children: [],
    });
    const html = cardToHtml(card);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;x&quot;");
  });

  it("renders a callback button as an anchor with actionId + value query params", () => {
    const card = Card({
      title: "Approve?",
      children: [
        Actions([
          Button({
            id: "approve",
            label: "Approve",
            style: "primary",
            value: "order-1",
            callbackUrl: "https://bot.example.com/cb",
          }),
        ]),
      ],
    });
    const html = cardToHtml(card);
    expect(html).toContain('<a href="https://bot.example.com/cb');
    expect(html).toContain("actionId=approve");
    expect(html).toContain("value=order-1");
    expect(html).toContain("Approve");
  });

  it("renders a button without a callbackUrl as a disabled span", () => {
    const card = Card({
      children: [
        Actions([Button({ id: "noop", label: "Noop", style: "default" })]),
      ],
    });
    const html = cardToHtml(card);
    expect(html).toContain("<span");
    expect(html).toContain("Noop");
    expect(html).toContain("opacity:0.5");
  });

  it("renders link buttons as anchors", () => {
    const card = Card({
      children: [
        Actions([LinkButton({ url: "https://example.com", label: "Open" })]),
      ],
    });
    const html = cardToHtml(card);
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain("Open");
  });

  it("renders fields, images, dividers, sections, and tables", () => {
    const card = Card({
      imageUrl: "https://example.com/header.png",
      children: [
        Section([
          CardText("Section text"),
          Fields([
            Field({ label: "Status", value: "Open" }),
            Field({ label: "Owner", value: "Alice" }),
          ]),
        ]),
        Divider(),
        CardImage({ url: "https://example.com/inline.png", alt: "Inline" }),
        Table({
          headers: ["A", "B"],
          rows: [
            ["1", "2"],
            ["3", "4"],
          ],
        }),
      ],
    });
    const html = cardToHtml(card);
    expect(html).toContain('src="https://example.com/header.png"');
    expect(html).toContain("Section text");
    expect(html).toContain("Status");
    expect(html).toContain("Open");
    expect(html).toContain("<hr");
    expect(html).toContain('alt="Inline"');
    expect(html).toContain("<table");
  });
});

describe("cardToPlainText", () => {
  it("includes title, subtitle, and text content", () => {
    const card = Card({
      title: "Hello",
      subtitle: "Sub",
      children: [CardText("Body text")],
    });
    const text = cardToPlainText(card);
    expect(text).toContain("Hello");
    expect(text).toContain("Sub");
    expect(text).toContain("Body text");
  });

  it("includes link button URLs", () => {
    const card = Card({
      title: "Hi",
      children: [
        Actions([LinkButton({ url: "https://x.example", label: "Open" })]),
      ],
    });
    const text = cardToPlainText(card);
    expect(text).toContain("Open: https://x.example");
  });

  it("includes callbackUrl button URLs with query params", () => {
    const card = Card({
      title: "Hi",
      children: [
        Actions([
          Button({
            id: "yes",
            label: "Yes",
            value: "v",
            callbackUrl: "https://bot.example.com/cb",
          }),
        ]),
      ],
    });
    const text = cardToPlainText(card);
    expect(text).toContain("Yes: https://bot.example.com/cb");
    expect(text).toContain("actionId=yes");
    expect(text).toContain("value=v");
  });

  it("omits action buttons that lack any URL", () => {
    const card = Card({
      title: "Hi",
      children: [Actions([Button({ id: "x", label: "X" })])],
    });
    const text = cardToPlainText(card);
    expect(text).not.toContain("X");
    expect(text).toContain("Hi");
  });

  it("traverses section children", () => {
    const card = Card({
      title: "Hi",
      children: [Section([CardText("inner-text"), Divider()])],
    });
    const text = cardToPlainText(card);
    expect(text).toContain("inner-text");
  });
});

// =============================================================================
// Edge cases: AST nodes and CardChild variants not exercised by the
// happy-path tests above. Some are constructed manually because the
// markdown parser does not produce them, or because the AdapterPostable
// builders don't expose the relevant config.
// =============================================================================

describe("markdownToHtml additional AST node coverage", () => {
  it("renders blockquotes", () => {
    expect(markdownToHtml("> quoted")).toContain("<blockquote>");
  });

  it("renders strikethrough (GFM delete) nodes", () => {
    expect(markdownToHtml("~~strike~~")).toContain("<del>strike</del>");
  });

  it("renders inline images", () => {
    const html = markdownToHtml("![alt text](https://example.com/img.png)");
    expect(html).toContain('<img src="https://example.com/img.png"');
    expect(html).toContain('alt="alt text"');
  });

  it("renders hard line breaks as <br />", () => {
    // Two trailing spaces before a newline produce an mdast `break` node.
    const html = markdownToHtml("foo  \nbar");
    expect(html).toContain("<br />");
  });

  it("renders GFM tables with alignment", () => {
    const html = markdownToHtml("| H1 | H2 |\n| :---: | ---: |\n| a | b |");
    expect(html).toMatch(TEXT_ALIGN_CENTER);
    expect(html).toMatch(TEXT_ALIGN_RIGHT);
  });
});

describe("astToHtml edge cases (manually constructed AST)", () => {
  it("falls through to children traversal for unknown node types", () => {
    // mdast won't normally produce a node like this from markdown, but
    // the default branch should still recurse through children.
    const ast: Root = {
      type: "root",
      children: [
        {
          // Cast through unknown so TS allows a fabricated node type.
          type: "totally-unknown",
          children: [{ type: "text", value: "fallback-text" }],
        } as unknown as Root["children"][number],
      ],
    };
    expect(astToHtml(ast)).toContain("fallback-text");
  });

  it("renders an empty string for tables with no rows", () => {
    const ast: Root = {
      type: "root",
      children: [
        {
          type: "table",
          align: [],
          children: [],
        } as unknown as Root["children"][number],
      ],
    };
    expect(astToHtml(ast)).toBe("");
  });

  it("renders headings without a depth as <h1>", () => {
    const ast: Root = {
      type: "root",
      children: [
        {
          type: "heading",
          children: [{ type: "text", value: "no-depth" }],
        } as unknown as Root["children"][number],
      ],
    };
    expect(astToHtml(ast)).toContain("<h1>no-depth</h1>");
  });

  it("renders fenced code blocks without a language", () => {
    expect(markdownToHtml("```\nplain code\n```")).toContain(
      "<pre><code>plain code</code></pre>"
    );
  });

  it("renders ordered lists with a non-default start attribute", () => {
    const html = markdownToHtml("3. third\n4. fourth");
    expect(html).toContain('<ol start="3">');
  });

  it("renders links and images with empty url/alt fallbacks", () => {
    const ast: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              // url omitted
              type: "link",
              children: [{ type: "text", value: "label" }],
            } as unknown as Root["children"][number],
            // image with no url and no alt
            {
              type: "image",
            } as unknown as Root["children"][number],
          ],
        },
      ],
    };
    const html = astToHtml(ast);
    expect(html).toContain('<a href="">label</a>');
    expect(html).toContain('<img src="" alt="" />');
  });

  it("renders tables that contain only a header row", () => {
    const ast: Root = {
      type: "root",
      children: [
        {
          type: "table",
          align: [],
          children: [
            {
              type: "tableRow",
              children: [
                {
                  type: "tableCell",
                  children: [{ type: "text", value: "only-header" }],
                },
              ],
            },
          ],
        } as unknown as Root["children"][number],
      ],
    };
    const html = astToHtml(ast);
    expect(html).toContain("<thead>");
    expect(html).toContain("only-header");
    expect(html).not.toContain("<tbody>");
  });

  it("renders tables that omit the `align` field", () => {
    const ast: Root = {
      type: "root",
      children: [
        {
          type: "table",
          // align intentionally omitted to exercise the `?? []` fallback
          children: [
            {
              type: "tableRow",
              children: [
                {
                  type: "tableCell",
                  children: [{ type: "text", value: "no-align" }],
                },
              ],
            },
          ],
        } as unknown as Root["children"][number],
      ],
    };
    expect(astToHtml(ast)).toContain("no-align");
  });
});

describe("cardToHtml minor element variants", () => {
  it("renders an image element without alt", () => {
    const card: CardElement = {
      type: "card",
      title: "x",
      children: [
        {
          type: "image",
          url: "https://example.com/pic.png",
        } as CardChild,
      ],
    };
    expect(cardToHtml(card)).toContain('alt=""');
  });

  it("renders a button without a `value` query param when value is undefined", () => {
    const card: CardElement = {
      type: "card",
      title: "x",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "button",
              id: "approve",
              label: "Approve",
              // no `value`
              callbackUrl: "https://bot/cb",
            },
          ],
        },
      ],
    };
    const html = cardToHtml(card);
    expect(html).toContain("actionId=approve");
    expect(html).not.toContain("value=");
  });

  it("falls back to the default button style when style is unrecognized", () => {
    const card: CardElement = {
      type: "card",
      title: "x",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "button",
              id: "x",
              label: "X",
              // intentionally a style that BUTTON_STYLE_TO_CSS doesn't list
              style: "totally-made-up" as unknown as "primary",
              callbackUrl: "https://bot/cb",
            },
            {
              type: "link-button",
              url: "https://example.com",
              label: "Open",
              style: "totally-made-up" as unknown as "primary",
            },
          ],
        },
      ],
    };
    const html = cardToHtml(card);
    // Neither bogus style maps; the inline style attribute should be empty
    // (i.e., the anchor tag still renders without the BUTTON_STYLE_TO_CSS
    // attributes baked in).
    expect(html).toContain('style=""');
    expect(html).toContain("Open");
    expect(html).toContain("X");
  });
});

describe("cardToPlainText minor variants", () => {
  it("returns body content for cards without a title", () => {
    const card = Card({
      children: [CardText("body only")],
    });
    expect(cardToPlainText(card)).toContain("body only");
  });

  it("omits the value query param from callback button URLs when value is undefined", () => {
    const card: CardElement = {
      type: "card",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "button",
              id: "yes",
              label: "Yes",
              callbackUrl: "https://bot/cb",
              // no `value`
            },
          ],
        },
      ],
    };
    const text = cardToPlainText(card);
    expect(text).toContain("actionId=yes");
    expect(text).not.toContain("value=");
  });
});

describe("cardToHtml additional CardChild coverage", () => {
  it("renders bold and muted text styles", () => {
    // `CardText("...")` doesn't accept a style — build the element directly.
    const boldChild: CardChild = {
      type: "text",
      content: "bold-text",
      style: "bold",
    };
    const mutedChild: CardChild = {
      type: "text",
      content: "muted-text",
      style: "muted",
    };
    const card: CardElement = {
      type: "card",
      title: "x",
      children: [boldChild, mutedChild],
    };
    const html = cardToHtml(card);
    expect(html).toContain("font-weight:600");
    expect(html).toContain("color:#6b7280");
    expect(html).toContain("bold-text");
    expect(html).toContain("muted-text");
  });

  it("renders inline CardLink children", () => {
    const card = Card({
      title: "Hi",
      children: [CardLink({ label: "Read more", url: "https://example.com" })],
    });
    const html = cardToHtml(card);
    expect(html).toContain('<a href="https://example.com">Read more</a>');
  });

  it("renders nothing for unknown card child types (default branch)", () => {
    const unknownChild = {
      type: "totally-unknown",
    } as unknown as CardChild;
    const card: CardElement = {
      type: "card",
      title: "x",
      children: [unknownChild],
    };
    const html = cardToHtml(card);
    // The card frame still renders; the unknown child contributes nothing.
    expect(html).toContain("x");
    expect(html).toContain("max-width:600px");
  });

  it("renders no Actions block when all children are non-button/link-button", () => {
    // Build an Actions element whose children are filtered out entirely;
    // both the inner default branch and the outer empty-buttons guard
    // need to be exercised.
    const actionsChild = {
      type: "actions",
      children: [
        {
          type: "select",
          id: "s",
          options: [],
        } as unknown as never,
      ],
    } as unknown as CardChild;
    const card: CardElement = {
      type: "card",
      title: "x",
      children: [actionsChild],
    };
    const html = cardToHtml(card);
    // Should NOT contain the `<div style="margin:16px 0">` actions wrapper.
    expect(html).not.toContain("margin:16px 0");
  });
});
