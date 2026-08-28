import { describe, expect, it } from "vitest";
import {
  createSlackMrkdwn,
  createSlackPlainText,
  escapeSlackText,
  formatSlackChannel,
  formatSlackDate,
  formatSlackLink,
  formatSlackSpecialMention,
  formatSlackUser,
  formatSlackUserGroup,
  linkBareSlackMentions,
  markdownBoldToSlackMrkdwn,
  slackMrkdwnToMarkdown,
  unescapeSlackText,
} from "./index";

describe("Slack format primitives", () => {
  it("escapes Slack mrkdwn control characters", () => {
    expect(escapeSlackText("a & <b>")).toBe("a &amp; &lt;b&gt;");
  });

  it("unescapes Slack mrkdwn control characters", () => {
    expect(unescapeSlackText("a &amp; &lt;b&gt;")).toBe("a & <b>");
  });

  it("creates plain_text objects", () => {
    expect(createSlackPlainText("hello", { emoji: true })).toEqual({
      emoji: true,
      text: "hello",
      type: "plain_text",
    });
  });

  it("rejects invalid text object lengths", () => {
    expect(() => createSlackPlainText("")).toThrow(TypeError);
    expect(() => createSlackMrkdwn("x".repeat(3001))).toThrow(TypeError);
  });

  it("creates mrkdwn objects", () => {
    expect(createSlackMrkdwn("*hello*", { verbatim: true })).toEqual({
      text: "*hello*",
      type: "mrkdwn",
      verbatim: true,
    });
  });

  it("formats Slack user mentions", () => {
    expect(formatSlackUser("U123")).toBe("<@U123>");
  });

  it("formats Slack channel mentions", () => {
    expect(formatSlackChannel("C123")).toBe("<#C123>");
  });

  it("formats Slack user group mentions", () => {
    expect(formatSlackUserGroup("S123")).toBe("<!subteam^S123>");
  });

  it("formats Slack special mentions", () => {
    expect(formatSlackSpecialMention("here")).toBe("<!here>");
  });

  it("formats Slack links", () => {
    expect(formatSlackLink("https://example.com?a=1&b=2")).toBe(
      "<https://example.com?a=1&b=2>"
    );
    expect(formatSlackLink("https://example.com", "read <this>")).toBe(
      "<https://example.com|read &lt;this&gt;>"
    );
  });

  it("rejects unsafe Slack link control characters", () => {
    expect(() => formatSlackLink("https://example.com|bad")).toThrow(TypeError);
  });

  it("formats Slack dates", () => {
    expect(formatSlackDate(1_710_000_000, "{date_short}", "Mar 9")).toBe(
      "<!date^1710000000^{date_short}|Mar 9>"
    );
    expect(
      formatSlackDate(new Date("2024-03-09T16:00:00.000Z"), "{time}", "4pm", {
        link: "https://example.com",
      })
    ).toBe("<!date^1710000000^{time}^https://example.com|4pm>");
  });

  it("normalizes Slack mrkdwn to Markdown", () => {
    expect(
      slackMrkdwnToMarkdown(
        "Hey <@U123|jane> in <#C123|general>, see <https://example.com|this> and *bold* ~done~"
      )
    ).toBe(
      "Hey @jane in #general (C123), see [this](https://example.com) and **bold** ~~done~~"
    );
  });

  it("normalizes Slack code fences for CommonMark parsing", () => {
    expect(slackMrkdwnToMarkdown("```first line\nsecond line\n```")).toBe(
      "```\nfirst line\nsecond line\n```"
    );
  });

  it("puts Slack code fences on separate lines from surrounding text", () => {
    expect(slackMrkdwnToMarkdown("before ```code``` after")).toBe(
      "before \n```\ncode\n```\n after"
    );
  });

  it("keeps an unpaired ``` as literal text", () => {
    expect(slackMrkdwnToMarkdown("use ``` to fence code, *see*?")).toBe(
      "use ``` to fence code, **see**?"
    );
  });

  it("keeps a ``` inside an inline code span as literal text", () => {
    expect(slackMrkdwnToMarkdown("`use ``` here`")).toBe("`use ``` here`");
  });

  it("keeps a ``` on a blockquote line as literal text", () => {
    expect(slackMrkdwnToMarkdown("&gt; a ```c``` b")).toBe("> a ```c``` b");
  });

  it("keeps a ``` inside a link token as part of the label", () => {
    expect(slackMrkdwnToMarkdown("<https://x.com|```code```>")).toBe(
      "[```code```](https://x.com)"
    );
  });

  it("does not rewrite emphasis inside fenced code", () => {
    expect(slackMrkdwnToMarkdown("```int *a = *b;```")).toBe(
      "```\nint *a = *b;\n```"
    );
    expect(slackMrkdwnToMarkdown("```keep ~x~ raw```")).toBe(
      "```\nkeep ~x~ raw\n```"
    );
  });

  it("still resolves mention tokens inside fenced code", () => {
    expect(slackMrkdwnToMarkdown("```ping <@U123|jane>```")).toBe(
      "```\nping @jane\n```"
    );
  });

  it("escapes trailing text that would become a block construct", () => {
    expect(slackMrkdwnToMarkdown("```x``` &gt; note")).toBe(
      "```\nx\n```\n \\> note"
    );
    expect(slackMrkdwnToMarkdown("```x``` # heading")).toBe(
      "```\nx\n```\n \\# heading"
    );
    expect(slackMrkdwnToMarkdown("```x``` - item")).toBe(
      "```\nx\n```\n \\- item"
    );
    expect(slackMrkdwnToMarkdown("```x``` 1. item")).toBe(
      "```\nx\n```\n 1\\. item"
    );
  });

  it("collapses trailing indentation that would become indented code", () => {
    expect(slackMrkdwnToMarkdown("see ```x```\tresult is 5")).toBe(
      "see \n```\nx\n```\n result is 5"
    );
    expect(slackMrkdwnToMarkdown("see ```x```     result is 5")).toBe(
      "see \n```\nx\n```\n result is 5"
    );
  });

  it("preserves the channel ID for labeled channel tokens", () => {
    expect(slackMrkdwnToMarkdown("Post in <#C042BLND6R6|general>")).toBe(
      "Post in #general (C042BLND6R6)"
    );
    expect(slackMrkdwnToMarkdown("Post in <#C042BLND6R6>")).toBe(
      "Post in #C042BLND6R6"
    );
  });

  it("normalizes bare Slack links to Markdown URLs", () => {
    expect(slackMrkdwnToMarkdown("See <https://example.com>")).toBe(
      "See https://example.com"
    );
  });

  it("normalizes inverted Slack link tokens before Markdown conversion", () => {
    expect(
      slackMrkdwnToMarkdown(
        "See <docs|https://example.com> and <https://a.com|A>"
      )
    ).toBe("See [docs](https://example.com) and [A](https://a.com)");
  });

  it("does not invert links whose display label is itself a URL", () => {
    expect(slackMrkdwnToMarkdown("See <https://a.com|https://b.com>")).toBe(
      "See [https://b.com](https://a.com)"
    );
  });

  it("converts basic Markdown bold to Slack mrkdwn bold", () => {
    expect(markdownBoldToSlackMrkdwn("The **domain** is example.com")).toBe(
      "The *domain* is example.com"
    );
  });

  it("links bare mention-like tokens without touching emails", () => {
    expect(linkBareSlackMentions("(cc @U123, @U456)")).toBe(
      "(cc <@U123>, <@U456>)"
    );
    expect(linkBareSlackMentions("@george")).toBe("@george");
    expect(linkBareSlackMentions("user@example.com")).toBe("user@example.com");
  });
});
