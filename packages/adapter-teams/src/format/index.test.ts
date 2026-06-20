import { describe, expect, it } from "vitest";
import {
  convertTeamsEmojiPlaceholders,
  escapeTeamsText,
  formatTeamsMention,
  markdownToTeamsHtml,
  teamsHtmlToMarkdown,
  teamsMentionToPlainText,
  unescapeTeamsText,
} from "./index";

describe("Teams format primitives", () => {
  it("escapes and unescapes Teams text", () => {
    const escaped = escapeTeamsText('<hello & "world">');
    expect(escaped).toBe("&lt;hello &amp; &quot;world&quot;&gt;");
    expect(unescapeTeamsText(escaped)).toBe('<hello & "world">');
  });

  it("formats and normalizes mentions", () => {
    expect(formatTeamsMention("Ada & Ben")).toBe("<at>Ada &amp; Ben</at>");
    expect(teamsMentionToPlainText("<at>Ada &amp; Ben</at> hi")).toBe(
      "@Ada & Ben hi"
    );
  });

  it("converts Teams HTML to Markdown-ish text", () => {
    expect(
      teamsHtmlToMarkdown(
        '<p>Hello <strong>world</strong><br><a href="https://example.com">link</a></p>'
      )
    ).toBe("Hello **world**\n[link](https://example.com)");
  });

  it("converts Markdown-ish text to Teams HTML", () => {
    expect(markdownToTeamsHtml("**Ship** [now](https://example.com)")).toBe(
      '<strong>Ship</strong> <a href="https://example.com">now</a>'
    );
    expect(markdownToTeamsHtml("[email](mailto:ada@example.com)")).toBe(
      '<a href="mailto:ada@example.com">email</a>'
    );
  });

  it("renders unsafe Markdown links as plain text", () => {
    expect(markdownToTeamsHtml("[bad](javascript:alert)")).toBe("bad");
    expect(markdownToTeamsHtml("[relative](/internal)")).toBe("relative");
  });

  it("converts common emoji placeholders", () => {
    expect(convertTeamsEmojiPlaceholders(":white_check_mark: done")).toBe(
      "✅ done"
    );
  });
});
