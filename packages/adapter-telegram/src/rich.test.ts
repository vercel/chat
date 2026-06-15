import { parseMarkdown, toPlainText } from "chat";
import { describe, expect, it } from "vitest";
import {
  richMessageToMarkdown,
  richMessageToText,
  TELEGRAM_RICH_MESSAGE_LIMIT,
  truncateRichMarkdown,
} from "./rich";
import type { TelegramMessage, TelegramRichMessage } from "./types";

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
        "Read [the guide](<https://example.com>) and **continue**",
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

    expect(richMessageToText(message)).toBe("@chat_sdk #release");
    expect(toPlainText(parseMarkdown(richMessageToMarkdown(message)))).toBe(
      "@chat_sdk #release"
    );
  });

  it("escapes literal rich text without changing displayed content", () => {
    const message: TelegramRichMessage = {
      blocks: [
        {
          type: "paragraph",
          text: [
            {
              type: "code",
              text: " a ` b ",
            },
            {
              type: "code",
              text: "",
            },
            " ",
            {
              type: "url",
              text: "label ] x",
              url: "https://example.com/a_(b)",
            },
            "\n# literal\n- item\n~~plain~~",
          ],
        },
        {
          type: "pre",
          language: "type`script",
          text: "const fence = ```;",
        },
      ],
    };

    const markdown = richMessageToMarkdown(message);
    const formatted = parseMarkdown(markdown);

    expect(formatted.children[0]).toMatchObject({
      children: expect.arrayContaining([
        expect.objectContaining({
          type: "inlineCode",
          value: " a ` b ",
        }),
        expect.objectContaining({
          children: expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              value: "label ] x",
            }),
          ]),
          type: "link",
          url: "https://example.com/a_(b)",
        }),
        expect.objectContaining({
          type: "text",
          value: "\n# literal\n- item\n~~plain~~",
        }),
      ]),
      type: "paragraph",
    });
    expect(formatted.children[1]).toMatchObject({
      lang: "typescript",
      type: "code",
      value: "const fence = ```;",
    });
  });

  it("includes current Telegram video quality fields", () => {
    const message: TelegramMessage = {
      chat: {
        id: 1,
        type: "private",
      },
      date: 1,
      message_id: 1,
      video: {
        duration: 10,
        file_id: "video",
        file_unique_id: "video-unique",
        height: 720,
        qualities: [
          {
            codec: "h264",
            file_id: "video-h264",
            file_unique_id: "video-h264-unique",
            height: 720,
            width: 1280,
          },
        ],
        width: 1280,
      },
    };

    expect(message.video?.qualities?.[0]?.codec).toBe("h264");
  });

  it("normalizes rich formatting to plain text", () => {
    const message: TelegramRichMessage = {
      blocks: [
        {
          type: "paragraph",
          text: [
            {
              type: "underline",
              text: "underlined",
            },
            " ",
            {
              type: "subscript",
              text: "subscript",
            },
            " ",
            {
              type: "marked",
              text: "marked",
            },
          ],
        },
        {
          type: "table",
          cells: [
            [
              {
                align: "left",
                text: "Name",
                valign: "top",
              },
              {
                align: "left",
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
                align: "left",
                text: "Ready",
                valign: "top",
              },
            ],
          ],
        },
      ],
    };

    expect(richMessageToText(message)).toBe(
      "underlined subscript marked\n\nName\tStatus\nBuild\tReady"
    );
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
