import { describe, expect, it } from "vitest";
import { TwitchFormatConverter, toSingleLine } from "./markdown";

const converter = new TwitchFormatConverter();

describe("TwitchFormatConverter", () => {
  it("parses chat text as plain text, not markdown", () => {
    const ast = converter.toAst("*waves* Kappa **not bold** #hype");
    expect(converter.extractPlainText("*waves* Kappa **not bold** #hype")).toBe(
      "*waves* Kappa **not bold** #hype"
    );
    expect(ast.children).toHaveLength(1);
    expect(JSON.stringify(ast)).not.toContain("emphasis");
  });

  it("promotes URLs to link nodes", () => {
    const ast = converter.toAst("clip: https://clips.twitch.tv/abc nice");
    const paragraph = ast.children[0];
    expect(paragraph?.type).toBe("paragraph");
    const children =
      paragraph && "children" in paragraph ? paragraph.children : [];
    expect(children.map((child) => child.type)).toEqual([
      "text",
      "link",
      "text",
    ]);
  });

  it("returns an empty root for empty text", () => {
    expect(converter.toAst("").children).toHaveLength(0);
  });

  it("flattens markdown to one line of plain text", () => {
    expect(
      converter.fromMarkdown(
        "# Title\n\n**bold** and _italic_ and `code`\n\n1. first\n2. second"
      )
    ).toBe("Title bold and italic and code 1. first 2. second");
  });

  it("renders links with their URL", () => {
    expect(converter.fromMarkdown("[docs](https://chat-sdk.dev)")).toBe(
      "docs (https://chat-sdk.dev)"
    );
    expect(converter.fromMarkdown("https://chat-sdk.dev")).toBe(
      "https://chat-sdk.dev"
    );
  });

  it("drops thematic breaks and code fences", () => {
    expect(converter.fromMarkdown("a\n\n---\n\n```\nconst x = 1;\n```")).toBe(
      "a const x = 1;"
    );
  });
});

describe("TwitchFormatConverter block quotes", () => {
  it("separates quoted paragraphs with a space", () => {
    expect(converter.fromMarkdown("> First.\n>\n> Second.")).toBe(
      "First. Second."
    );
  });

  it("separates a quoted list from the text before it", () => {
    expect(converter.fromMarkdown("> Intro:\n>\n> - one\n> - two")).toBe(
      "Intro: • one • two"
    );
  });

  it("keeps a quote apart from the text around it", () => {
    expect(converter.fromMarkdown("Before\n\n> a\n>\n> b\n\nAfter")).toBe(
      "Before a b After"
    );
  });

  it("flattens nested quotes and quoted code blocks", () => {
    expect(
      converter.fromMarkdown("> Outer.\n>\n> > Inner.\n>\n> ```\n> a\n> ```")
    ).toBe("Outer. Inner. a");
  });

  it("keeps a single paragraph quote as is", () => {
    expect(converter.fromMarkdown("> Just one.")).toBe("Just one.");
  });

  it("drops empty quotes and quote children that render to nothing", () => {
    expect(converter.fromMarkdown(">")).toBe("");
    expect(
      converter.fromMarkdown("> [a]: https://chat-sdk.dev\n>\n> Text.")
    ).toBe("Text.");
  });
});

describe("TwitchFormatConverter tables", () => {
  it("flattens markdown tables to header: value pairs on one line", () => {
    expect(
      converter.fromMarkdown(
        "| Game | Votes |\n| --- | --- |\n| Celeste | 42 |\n| Hades | 17 |"
      )
    ).toBe("Game: Celeste, Votes: 42 · Game: Hades, Votes: 17");
  });

  it("flattens inline formatting and links inside table cells", () => {
    expect(
      converter.fromMarkdown(
        "| Name | Link |\n| --- | --- |\n| **Clip** | [watch](https://clips.twitch.tv/abc) |"
      )
    ).toBe("Name: Clip, Link: watch (https://clips.twitch.tv/abc)");
  });

  it("skips empty table cells", () => {
    expect(
      converter.fromMarkdown(
        "| Game | Notes |\n| --- | --- |\n| Celeste |  |\n| Hades | fun |"
      )
    ).toBe("Game: Celeste · Game: Hades, Notes: fun");
  });
});

describe("toSingleLine", () => {
  it("collapses line breaks and surrounding whitespace", () => {
    expect(toSingleLine("  one \n\n  two\nthree  ")).toBe("one two three");
  });
});
