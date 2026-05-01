import { describe, expect, it } from "vitest";
import { SlackFormatConverter } from "./markdown";

describe("SlackFormatConverter", () => {
  const converter = new SlackFormatConverter();

  describe("toMarkdown (mrkdwn -> markdown)", () => {
    it("should convert bold", () => {
      expect(converter.toMarkdown("Hello *world*!")).toContain("**world**");
    });

    it("should convert strikethrough", () => {
      expect(converter.toMarkdown("Hello ~world~!")).toContain("~~world~~");
    });

    it("should convert links with text", () => {
      const result = converter.toMarkdown("Check <https://example.com|this>");
      expect(result).toContain("[this](https://example.com)");
    });

    it("should convert bare links", () => {
      const result = converter.toMarkdown("Visit <https://example.com>");
      expect(result).toContain("https://example.com");
    });

    it("should convert user mentions", () => {
      const result = converter.toMarkdown("Hey <@U123|john>!");
      expect(result).toContain("@john");
    });

    it("should convert channel mentions", () => {
      const result = converter.toMarkdown("Join <#C123|general>");
      expect(result).toContain("#general");
    });

    it("should convert bare channel ID mentions", () => {
      const result = converter.toMarkdown("Join <#C123>");
      expect(result).toContain("#C123");
    });
  });

  describe("toSlackPayload", () => {
    it("routes plain strings to text (preserves literal markdown chars)", () => {
      expect(converter.toSlackPayload("Use *foo* literally")).toEqual({
        text: "Use *foo* literally",
      });
    });

    it("routes raw strings to text", () => {
      expect(converter.toSlackPayload({ raw: "*already mrkdwn*" })).toEqual({
        text: "*already mrkdwn*",
      });
    });

    it("routes markdown to markdown_text", () => {
      expect(
        converter.toSlackPayload({ markdown: "## Heading\n\n- a\n- b" })
      ).toEqual({ markdown_text: "## Heading\n\n- a\n- b" });
    });

    it("routes ast to markdown_text via stringifyMarkdown", () => {
      const ast = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [
              {
                type: "strong" as const,
                children: [{ type: "text" as const, value: "bold" }],
              },
            ],
          },
        ],
      };
      const result = converter.toSlackPayload({ ast });
      expect(result).toHaveProperty("markdown_text");
      expect((result as { markdown_text: string }).markdown_text).toContain(
        "**bold**"
      );
    });

    it("preserves tables when rendering ast to markdown_text", () => {
      const ast = {
        type: "root" as const,
        children: [
          {
            type: "table" as const,
            align: [null, null] as Array<"left" | "right" | "center" | null>,
            children: [
              {
                type: "tableRow" as const,
                children: [
                  {
                    type: "tableCell" as const,
                    children: [{ type: "text" as const, value: "A" }],
                  },
                  {
                    type: "tableCell" as const,
                    children: [{ type: "text" as const, value: "B" }],
                  },
                ],
              },
              {
                type: "tableRow" as const,
                children: [
                  {
                    type: "tableCell" as const,
                    children: [{ type: "text" as const, value: "1" }],
                  },
                  {
                    type: "tableCell" as const,
                    children: [{ type: "text" as const, value: "2" }],
                  },
                ],
              },
            ],
          },
        ],
      };
      const result = converter.toSlackPayload({ ast });
      expect(result).toHaveProperty("markdown_text");
      const text = (result as { markdown_text: string }).markdown_text;
      expect(text).toContain("| A | B |");
      expect(text).toContain("| 1 | 2 |");
    });
  });

  describe("mentions", () => {
    it("does not double-wrap existing <@U123> mentions in plain strings", () => {
      expect(converter.toSlackPayload("Hey <@U12345>. Please select")).toEqual({
        text: "Hey <@U12345>. Please select",
      });
    });

    it("does not double-wrap existing mentions in markdown", () => {
      expect(
        converter.toSlackPayload({ markdown: "Hey <@U12345>. Please select" })
      ).toEqual({ markdown_text: "Hey <@U12345>. Please select" });
    });

    it("rewrites bare @mentions in plain strings", () => {
      expect(converter.toSlackPayload("Hey @george. Please select")).toEqual({
        text: "Hey <@george>. Please select",
      });
    });

    it("rewrites bare @mentions in markdown", () => {
      expect(
        converter.toSlackPayload({ markdown: "Hey @george. Please select" })
      ).toEqual({ markdown_text: "Hey <@george>. Please select" });
    });

    it("does not mangle email addresses in plain strings", () => {
      expect(
        converter.toSlackPayload("Contact user@example.com for help")
      ).toEqual({ text: "Contact user@example.com for help" });
    });

    it("does not mangle mailto links", () => {
      expect(
        converter.toSlackPayload("Email <mailto:user@example.com>")
      ).toEqual({ text: "Email <mailto:user@example.com>" });
    });

    it("converts mentions adjacent to non-word punctuation", () => {
      expect(converter.toSlackPayload("(cc @george, @anne)")).toEqual({
        text: "(cc <@george>, <@anne>)",
      });
    });
  });

  describe("toPlainText", () => {
    it("should remove bold markers", () => {
      expect(converter.toPlainText("Hello *world*!")).toBe("Hello world!");
    });

    it("should remove italic markers", () => {
      expect(converter.toPlainText("Hello _world_!")).toBe("Hello world!");
    });

    it("should extract link text", () => {
      expect(converter.toPlainText("Check <https://example.com|this>")).toBe(
        "Check this"
      );
    });

    it("should format user mentions", () => {
      const result = converter.toPlainText("Hey <@U123>!");
      expect(result).toContain("@U123");
    });

    it("should handle complex messages", () => {
      const input =
        "*Bold* and _italic_ with <https://x.com|link> and <@U123|user>";
      const result = converter.toPlainText(input);
      expect(result).toContain("Bold");
      expect(result).toContain("italic");
      expect(result).toContain("link");
      expect(result).toContain("user");
      expect(result).not.toContain("*");
      expect(result).not.toContain("<");
    });
  });
});
