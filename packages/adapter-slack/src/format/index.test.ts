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
      "Hey @jane in #general, see [this](https://example.com) and **bold** ~~done~~"
    );
  });

  it("normalizes bare Slack links to Markdown URLs", () => {
    expect(slackMrkdwnToMarkdown("See <https://example.com>")).toBe(
      "See https://example.com"
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
