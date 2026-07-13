import { describe, expect, it } from "vitest";
import { NotionFormatConverter } from "./markdown";

const LIST_MARKER_LINE = /^[-*+]/m;

describe("NotionFormatConverter", () => {
  const converter = new NotionFormatConverter();

  it("normalizes headings to bold", () => {
    expect(converter.normalizeCommentMarkdown("# Title\n\nBody")).toContain(
      "**Title**"
    );
  });

  it("flattens fenced code to inline when short", () => {
    expect(converter.normalizeCommentMarkdown("```\nconst x = 1\n```")).toBe(
      "`const x = 1`"
    );
  });

  it("strips list markers", () => {
    const out = converter.normalizeCommentMarkdown("- one\n- two");
    expect(out).not.toMatch(LIST_MARKER_LINE);
    expect(out).toContain("one");
  });

  it("flattens table rows", () => {
    const out = converter.normalizeCommentMarkdown(
      "| A | B |\n|---|---|\n| 1 | 2 |"
    );
    expect(out).toContain("A");
    expect(out).not.toContain("|---|");
  });

  it("maps rich-text annotations to markdown", () => {
    const md = converter.richTextToMarkdown([
      {
        type: "text",
        plain_text: "bold",
        annotations: {
          bold: true,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: "default",
        },
        text: { content: "bold" },
      },
    ]);
    expect(md).toBe("**bold**");
  });
});
