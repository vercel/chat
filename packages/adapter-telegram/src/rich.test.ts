import { describe, expect, it } from "vitest";
import {
  richMessageToMarkdown,
  richMessageToText,
  TELEGRAM_RICH_MESSAGE_LIMIT,
  truncateRichMarkdown,
} from "./rich";
import type { TelegramRichMessage } from "./types";

describe("Telegram rich messages", () => {
  it("normalizes structured rich blocks to markdown", () => {
    const message: TelegramRichMessage = {
      blocks: [
        {
          type: "heading",
          size: 2,
          text: "Summary",
        },
        {
          type: "paragraph",
          text: [
            "Read ",
            {
              type: "url",
              text: "the guide",
              url: "https://example.com",
            },
            " and ",
            {
              type: "bold",
              text: "continue",
            },
          ],
        },
        {
          type: "table",
          cells: [
            [
              {
                align: "left",
                is_header: true,
                text: "Name",
                valign: "top",
              },
              {
                align: "right",
                is_header: true,
                text: "Status",
                valign: "top",
              },
            ],
            [
              {
                align: "left",
                text: "Build",
                valign: "top",
              },
              {
                align: "right",
                text: "Ready",
                valign: "top",
              },
            ],
          ],
        },
      ],
    };

    expect(richMessageToMarkdown(message)).toBe(
      [
        "## Summary",
        "Read [the guide](https://example.com) and **continue**",
        "| Name | Status |\n| --- | --- |\n| Build | Ready |",
      ].join("\n\n")
    );
    expect(richMessageToText(message)).toContain("Read the guide and continue");
  });

  it("preserves displayed text for detected entities", () => {
    const message: TelegramRichMessage = {
      blocks: [
        {
          type: "paragraph",
          text: [
            {
              type: "mention",
              text: "@chat_sdk",
              username: "chat_sdk",
            },
            " ",
            {
              type: "hashtag",
              hashtag: "release",
              text: "#release",
            },
          ],
        },
      ],
    };

    expect(richMessageToMarkdown(message)).toBe("@chat_sdk #release");
  });

  it("truncates markdown at the rich message limit", () => {
    const markdown = truncateRichMarkdown(
      "a".repeat(TELEGRAM_RICH_MESSAGE_LIMIT + 100)
    );

    expect(Array.from(markdown).length).toBeLessThanOrEqual(
      TELEGRAM_RICH_MESSAGE_LIMIT
    );
    expect(markdown.endsWith("...")).toBe(true);
  });

  it("preserves a table-like trailing line when truncating", () => {
    const prefix = `${"a".repeat(TELEGRAM_RICH_MESSAGE_LIMIT - 12)}\n| tail |`;
    const markdown = `${prefix}${"b".repeat(100)}`;

    expect(truncateRichMarkdown(markdown)).toContain("| tail |");
  });
});
