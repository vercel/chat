import { describe, expect, it } from "vitest";
import {
  escapeGoogleChatText,
  formatGoogleChatLink,
  formatGoogleChatMention,
  googleChatToMarkdown,
  markdownToGoogleChat,
} from ".";

describe("Google Chat format primitives", () => {
  it("escapes text entities", () => {
    expect(escapeGoogleChatText("<hello & goodbye>")).toBe(
      "&lt;hello &amp; goodbye&gt;"
    );
  });

  it("formats links and mentions", () => {
    expect(formatGoogleChatLink("https://example.com", "Example")).toBe(
      "<https://example.com|Example>"
    );
    expect(formatGoogleChatMention("users/123")).toBe("<users/123>");
  });

  it("neutralizes unsafe links", () => {
    expect(formatGoogleChatLink("javascript:alert(1)", "bad")).toBe("bad");
    expect(markdownToGoogleChat("[bad](javascript:alert(1))")).toBe("bad");
  });

  it("converts markdown links with balanced and escaped URL parentheses", () => {
    expect(
      markdownToGoogleChat("[docs](https://example.com/path(foo)/bar)")
    ).toBe("<https://example.com/path(foo)/bar|docs>");
    expect(
      markdownToGoogleChat("[docs](https://example.com/path\\(foo\\)/bar)")
    ).toBe("<https://example.com/path(foo)/bar|docs>");
  });

  it("converts a markdown subset to Google Chat format", () => {
    expect(
      markdownToGoogleChat(
        "**bold** __also bold__ _italic_ ~~strike~~ [site](https://example.com)"
      )
    ).toBe("*bold* *also bold* _italic_ ~strike~ <https://example.com|site>");
  });

  it("converts Google Chat format to markdown", () => {
    expect(
      googleChatToMarkdown("*bold* ~strike~ <https://example.com|site>")
    ).toBe("**bold** ~~strike~~ [site](https://example.com)");
  });
});
