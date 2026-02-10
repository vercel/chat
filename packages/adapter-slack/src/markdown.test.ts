import { describe, expect, it } from "vitest";
import { SlackMarkdownConverter } from "./markdown";

describe("SlackMarkdownConverter", () => {
  const converter = new SlackMarkdownConverter();

  describe("fromMarkdown (markdown -> mrkdwn)", () => {
    it("should convert bold", () => {
      expect(converter.fromMarkdown("Hello **world**!")).toBe("Hello *world*!");
    });

    it("should convert italic", () => {
      expect(converter.fromMarkdown("Hello _world_!")).toBe("Hello _world_!");
    });

    it("should convert strikethrough", () => {
      expect(converter.fromMarkdown("Hello ~~world~~!")).toBe("Hello ~world~!");
    });

    it("should convert links", () => {
      expect(converter.fromMarkdown("Check [this](https://example.com)")).toBe(
        "Check <https://example.com|this>",
      );
    });

    it("should preserve inline code", () => {
      expect(converter.fromMarkdown("Use `const x = 1`")).toBe(
        "Use `const x = 1`",
      );
    });

    it("should handle code blocks", () => {
      const input = "```js\nconst x = 1;\n```";
      const output = converter.fromMarkdown(input);
      expect(output).toContain("```");
      expect(output).toContain("const x = 1;");
    });

    it("should handle mixed formatting", () => {
      const input = "**Bold** and _italic_ and [link](https://x.com)";
      const output = converter.fromMarkdown(input);
      expect(output).toContain("*Bold*");
      expect(output).toContain("_italic_");
      expect(output).toContain("<https://x.com|link>");
    });
  });

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
  });

  describe("mentions", () => {
    it("should not double-wrap mentions already in <@user> format", () => {
      // renderPostable with string containing existing Slack mention
      expect(converter.renderPostable("Hey <@U12345>. Please select")).toBe(
        "Hey <@U12345>. Please select",
      );
    });

    it("should not double-wrap mentions in markdown input", () => {
      expect(
        converter.renderPostable({ markdown: "Hey <@U12345>. Please select" }),
      ).toBe("Hey <@U12345>. Please select");
    });

    it("should still convert bare @mentions to Slack format", () => {
      expect(converter.renderPostable("Hey @george. Please select")).toBe(
        "Hey <@george>. Please select",
      );
    });

    it("should convert bare @mentions in markdown", () => {
      expect(
        converter.renderPostable({ markdown: "Hey @george. Please select" }),
      ).toBe("Hey <@george>. Please select");
    });

    it("should not double-wrap mentions via fromMarkdown", () => {
      expect(converter.fromMarkdown("Hey <@U12345>")).toBe("Hey <@U12345>");
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
        "Check this",
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
      // Should not contain formatting characters
      expect(result).not.toContain("*");
      expect(result).not.toContain("<");
    });
  });
});
