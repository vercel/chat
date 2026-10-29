import { parseMarkdown, toPlainText } from "chat";
import { describe, expect, it } from "vitest";
import { TeamsFormatConverter } from "./markdown";

describe("TeamsFormatConverter", () => {
  const converter = new TeamsFormatConverter();

  describe("fromAst (AST -> Teams format)", () => {
    it("should convert bold", () => {
      const ast = converter.toAst("**bold text**");
      const result = converter.fromAst(ast);
      expect(result).toContain("**bold text**");
    });

    it("should convert italic", () => {
      const ast = converter.toAst("_italic text_");
      const result = converter.fromAst(ast);
      expect(result).toContain("_italic text_");
    });

    it("should convert strikethrough", () => {
      const ast = converter.toAst("~~strikethrough~~");
      const result = converter.fromAst(ast);
      expect(result).toContain("~~strikethrough~~");
    });

    it("should preserve inline code", () => {
      const ast = converter.toAst("Use `const x = 1`");
      const result = converter.fromAst(ast);
      expect(result).toContain("`const x = 1`");
    });

    it("should handle code blocks", () => {
      const input = "```js\nconst x = 1;\n```";
      const ast = converter.toAst(input);
      const output = converter.fromAst(ast);
      expect(output).toContain("```");
      expect(output).toContain("const x = 1;");
    });

    it("should convert links to markdown format", () => {
      const ast = converter.toAst("[link text](https://example.com)");
      const result = converter.fromAst(ast);
      expect(result).toContain("[link text](https://example.com)");
    });

    it("should handle blockquotes", () => {
      const ast = converter.toAst("> quoted text");
      const result = converter.fromAst(ast);
      expect(result).toContain("> quoted text");
    });

    it("should handle unordered lists", () => {
      const ast = converter.toAst("- item 1\n- item 2");
      const result = converter.fromAst(ast);
      expect(result).toContain("- item 1");
      expect(result).toContain("- item 2");
    });

    it("should handle ordered lists", () => {
      const ast = converter.toAst("1. first\n2. second");
      const result = converter.fromAst(ast);
      expect(result).toContain("1.");
      expect(result).toContain("2.");
    });

    it("should indent nested unordered lists", () => {
      const result = converter.fromMarkdown(
        "- parent\n  - child 1\n  - child 2"
      );
      expect(result).toBe("- parent\n  - child 1\n  - child 2");
    });

    it("should indent nested ordered lists", () => {
      const result = converter.fromMarkdown(
        "1. first\n   1. sub-first\n   2. sub-second\n2. second"
      );
      expect(result).toContain("1. first");
      expect(result).toContain("  1. sub-first");
      expect(result).toContain("  2. sub-second");
      expect(result).toContain("2. second");
    });

    it("should handle deeply nested lists", () => {
      const result = converter.fromMarkdown(
        "- level 1\n  - level 2\n    - level 3"
      );
      expect(result).toContain("- level 1");
      expect(result).toContain("  - level 2");
      expect(result).toContain("    - level 3");
    });

    it("should keep sibling items at the same indent level", () => {
      const result = converter.fromMarkdown("- item 1\n- item 2\n- item 3");
      expect(result).toBe("- item 1\n- item 2\n- item 3");
    });

    it("should handle mixed ordered and unordered nesting", () => {
      const result = converter.fromMarkdown(
        "1. first\n   - sub a\n   - sub b\n2. second"
      );
      expect(result).toContain("1. first");
      expect(result).toContain("  - sub a");
      expect(result).toContain("  - sub b");
      expect(result).toContain("2. second");
    });

    it("should preserve @mentions as text", () => {
      const ast = converter.toAst("Hello @someone");
      const result = converter.fromAst(ast);
      expect(result).toBe("Hello @someone");
    });

    it("should not turn email addresses into mentions", () => {
      const result = converter.renderPostable({
        raw: "email user@example.com",
      });
      expect(result).toContain("user@example.com");
      expect(result).not.toContain("<at>example</at>");
    });

    it("should not mangle an @handle inside a url", () => {
      const result = converter.renderPostable({
        raw: "see https://github.com/@vercel",
      });
      expect(result).toContain("https://github.com/@vercel");
      expect(result).not.toContain("<at>vercel</at>");
    });

    it("should handle thematic breaks", () => {
      const ast = converter.toAst("text\n\n---\n\nmore");
      const result = converter.fromAst(ast);
      expect(result).toContain("---");
    });
  });

  describe("toAst (Teams HTML -> AST)", () => {
    it("should convert <at> mentions to @mentions", () => {
      const text = converter.extractPlainText("<at>John</at> said hi");
      expect(text).toContain("@John");
    });

    it("should convert <b> tags to bold", () => {
      const ast = converter.toAst("<b>bold</b>");
      expect(ast.type).toBe("root");
      const result = converter.fromAst(ast);
      expect(result).toContain("**bold**");
    });

    it("should convert <strong> tags to bold", () => {
      const ast = converter.toAst("<strong>bold</strong>");
      const result = converter.fromAst(ast);
      expect(result).toContain("**bold**");
    });

    it("should convert <i> tags to italic", () => {
      const ast = converter.toAst("<i>italic</i>");
      const result = converter.fromAst(ast);
      expect(result).toContain("_italic_");
    });

    it("should convert <em> tags to italic", () => {
      const ast = converter.toAst("<em>italic</em>");
      const result = converter.fromAst(ast);
      expect(result).toContain("_italic_");
    });

    it("should convert <s> tags to strikethrough", () => {
      const ast = converter.toAst("<s>struck</s>");
      const result = converter.fromAst(ast);
      expect(result).toContain("~~struck~~");
    });

    it("should convert <a> tags to links", () => {
      const ast = converter.toAst('<a href="https://example.com">link</a>');
      const result = converter.fromAst(ast);
      expect(result).toContain("[link](https://example.com)");
    });

    it("should convert <code> tags to inline code", () => {
      const ast = converter.toAst("<code>const x</code>");
      const result = converter.fromAst(ast);
      expect(result).toContain("`const x`");
    });

    it("should convert <pre> tags to code blocks", () => {
      const ast = converter.toAst("<pre>const x = 1;</pre>");
      const result = converter.fromAst(ast);
      expect(result).toContain("```");
      expect(result).toContain("const x = 1;");
    });

    it("should strip remaining HTML tags", () => {
      const text = converter.extractPlainText("<div><span>hello</span></div>");
      expect(text).toBe("hello");
    });

    it("should decode HTML entities", () => {
      const text = converter.extractPlainText(
        "&lt;b&gt;not bold&lt;/b&gt; &amp; &quot;quoted&quot;"
      );
      expect(text).toContain("<b>");
      expect(text).toContain("&");
      expect(text).toContain('"quoted"');
    });
  });

  describe("renderPostable", () => {
    it("should preserve @mentions in plain strings", () => {
      const result = converter.renderPostable("Hello @user");
      expect(result).toBe("Hello @user");
    });

    it("should preserve @mentions in raw messages", () => {
      const result = converter.renderPostable({ raw: "Hello @user" });
      expect(result).toBe("Hello @user");
    });

    it.each([
      "Hi @Alex Smith, meet @someone",
      "[user@example.com](mailto:user@example.com) and [@someone](https://example.com/@someone)",
      "Use `@someone` or **@Alex Smith**",
      "```text\n@Alex Smith\n```",
    ])("preserves names and formatting in %j", (text) => {
      for (const message of [
        text,
        { raw: text },
        { markdown: text },
        { ast: converter.toAst(text) },
      ]) {
        expect(converter.renderPostable(message)).toBe(text);
      }
    });

    it("preserves explicit mention markup in raw text", () => {
      const text = "Hi <at>Alex Smith</at>";
      expect(converter.renderPostable(text)).toBe(text);
      expect(converter.renderPostable({ raw: text })).toBe(text);
    });

    it("decodes incoming full-name mentions without recreating markup", () => {
      const ast = converter.toAst("Hi <at>Alex Smith</at>");
      expect(converter.fromAst(ast)).toBe("Hi @Alex Smith");
    });

    it("should render markdown messages", () => {
      const result = converter.renderPostable({
        markdown: "Hello **world**",
      });
      expect(result).toContain("**world**");
    });

    it("should render AST messages", () => {
      const ast = converter.toAst("Hello **world**");
      const result = converter.renderPostable({ ast });
      expect(result).toContain("**world**");
    });

    it("should handle empty message", () => {
      const result = converter.renderPostable("");
      expect(result).toBe("");
    });
  });

  describe("extractPlainText", () => {
    it("should remove bold markers", () => {
      expect(converter.extractPlainText("Hello **world**!")).toBe(
        "Hello world!"
      );
    });

    it("should remove italic markers", () => {
      expect(converter.extractPlainText("Hello _world_!")).toBe("Hello world!");
    });

    it("should handle empty string", () => {
      expect(converter.extractPlainText("")).toBe("");
    });

    it("should handle plain text", () => {
      expect(converter.extractPlainText("Hello world")).toBe("Hello world");
    });

    it("should handle inline code", () => {
      const result = converter.extractPlainText("Use `const x = 1`");
      expect(result).toContain("const x = 1");
    });
  });

  describe("table rendering", () => {
    it("should render markdown tables as GFM tables", () => {
      const result = converter.fromMarkdown(
        "| Name | Age |\n|------|-----|\n| Alice | 30 |"
      );
      expect(result).toContain("| Name | Age |");
      expect(result).toContain("| --- | --- |");
      expect(result).toContain("| Alice | 30 |");
    });

    it("should render tables with pipe syntax", () => {
      const result = converter.fromMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
      expect(result).toContain("|");
      expect(result).not.toContain("```");
    });
  });

  describe("HTML conversion", () => {
    it.each([
      ["<at>John</at> said hi", "@John said hi"],
      ["<b>bold</b>", "**bold**"],
      ["<strong>bold</strong>", "**bold**"],
      ["<i>italic</i>", "_italic_"],
      ["<em>italic</em>", "_italic_"],
      ["<s>struck</s>", "~~struck~~"],
      ['<a href="https://example.com">link</a>', "[link](https://example.com)"],
      ["<code>const x</code>", "`const x`"],
      ["<pre>const x = 1;</pre>", "```\nconst x = 1;\n```"],
      ["<div><span>hello</span></div>", "hello"],
      ["Hi <at>Alex Smith</at>", "Hi @Alex Smith"],
      ["<at>Chat SDK Demo</at> test", "@Chat SDK Demo test"],
      [
        '<p><span itemtype="http://schema.skype.com/Mention" itemscope="" itemid="0">Chat SDK Demo</span>&nbsp;AI What is love?</p>',
        "Chat SDK Demo&nbsp;AI What is love?",
      ],
      [
        '<p><span itemtype="http://schema.skype.com/Mention" itemscope="" itemid="0">Chat SDK Demo</span>&nbsp;test</p>',
        "Chat SDK Demo&nbsp;test",
      ],
      ["<p>test</p>", "test"],
      ["<p>Who are you?</p>", "Who are you?"],
      [
        '<a href="https://example.com/docs?a=1&amp;b=2" title="Docs" target="_blank" rel="noreferrer noopener">the docs</a>',
        "[the docs](https://example.com/docs?a=1&b=2)",
      ],
      [
        '<p>See <a href="https://a.example">A</a> and <a class="x" href="https://b.example">B</a>.</p>',
        "See [A](https://a.example) and [B](https://b.example).",
      ],
      [
        '<A HREF="https://example.com/UPPER">Upper</A>',
        "[Upper](https://example.com/UPPER)",
      ],
      [
        '<a\nhref="https://example.com/newline">wrapped</a>',
        "[wrapped](https://example.com/newline)",
      ],
      [
        '<a data-href="https://first.example" href="https://second.example">two hrefs</a>',
        "[two hrefs](https://second.example)",
      ],
      [
        '<at>Bot</at> please check <a href="https://github.com/vercel/chat/pull/1">PR #1</a> &amp; <b>merge</b>',
        "@Bot please check [PR #1](https://github.com/vercel/chat/pull/1) & **merge**",
      ],
      [
        `${"<a b".repeat(500)} href="https://example.com">t</a>`,
        "[t](https://example.com)",
      ],
      ["a <<b>> c", "a > c"],
      ["&amp;lt;b&amp;gt;", "&lt;b&gt;"],
    ])("should convert %j to %j", (html, markdown) => {
      expect(converter.toAst(html)).toEqual(parseMarkdown(markdown));
    });
  });

  describe("plain text for skipped messages", () => {
    class SkipAllConverter extends TeamsFormatConverter {
      protected override maxIncomingParseLength = 0;
    }
    const skipping = new SkipAllConverter();

    it.each([
      "<at>John</at> said hi",
      "<b>bold</b> and <i>italic</i>",
      '<p>See <a href="https://a.example">A</a> and <a class="x" href="https://b.example">B</a>.</p>',
      '<p><span itemtype="http://schema.skype.com/Mention" itemscope="" itemid="0">Chat SDK Demo</span>&nbsp;test</p>',
      "<pre>const x = 1;</pre>",
      "Tom &amp; Jerry &lt;x&gt; &quot;q&quot; &#39;s&#39;",
    ])("should match the parsed plain text for %j", (html) => {
      expect(skipping.parseIncoming(html).text).toBe(
        toPlainText(converter.toAst(html))
      );
    });

    it.each([
      ["<at>Bot</at> hi", "@Bot hi"],
      ["Tom &amp; Jerry &lt;3", "Tom & Jerry <3"],
      ["a&nbsp;b", "a\u00a0b"],
      ["&amp;lt;b&amp;gt;", "&lt;b&gt;"],
      ["<p>a</p><p>b</p>", "a\nb"],
      ["<p>a</p>\n<p>b</p>", "a\n\nb"],
      ["line<br>break<br/>again", "line\nbreak\nagain"],
      ["<ul><li>one</li><li>two</li></ul>", "one\ntwo"],
      ["<div>x</div>\n\n\n<div>y</div>", "x\n\ny"],
      ["keep **markdown** as typed", "keep **markdown** as typed"],
      ["a < b > c", "a  c"],
    ])("should render %j as %j", (html, plain) => {
      const result = skipping.parseIncoming(html);
      expect(result.text).toBe(plain);
      expect(result.formatted).toEqual({
        type: "root",
        children: [
          { type: "paragraph", children: [{ type: "text", value: plain }] },
        ],
      });
    });
  });
});
