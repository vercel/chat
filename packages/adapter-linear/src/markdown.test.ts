import { describe, expect, it } from "vitest";
import { LinearFormatConverter } from "./markdown";

describe("LinearFormatConverter", () => {
  const converter = new LinearFormatConverter();

  describe("toAst", () => {
    it("preserves formatting, links, code, and lists in inbound markdown", () => {
      const ast = converter.toAst(
        "**bold** _italic_ [link](https://example.com)\n\n```ts\ncode\n```\n\n- ~~removed~~"
      );
      expect(ast).toMatchObject({
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "strong", children: [{ type: "text", value: "bold" }] },
              { type: "text", value: " " },
              {
                type: "emphasis",
                children: [{ type: "text", value: "italic" }],
              },
              { type: "text", value: " " },
              {
                type: "link",
                url: "https://example.com",
                children: [{ type: "text", value: "link" }],
              },
            ],
          },
          { type: "code", lang: "ts", value: "code" },
          {
            type: "list",
            ordered: false,
            children: [
              {
                type: "listItem",
                children: [
                  {
                    type: "paragraph",
                    children: [
                      {
                        type: "delete",
                        children: [{ type: "text", value: "removed" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
    });
  });

  describe("fromAst", () => {
    it("should stringify a simple AST", () => {
      const ast = converter.toAst("Hello world");
      const result = converter.fromAst(ast);
      expect(result).toContain("Hello world");
    });

    it("should round-trip bold text", () => {
      const ast = converter.toAst("**bold text**");
      const result = converter.fromAst(ast);
      expect(result).toContain("**bold text**");
    });

    it("should round-trip links", () => {
      const ast = converter.toAst("[Link](https://example.com)");
      const result = converter.fromAst(ast);
      expect(result).toContain("[Link](https://example.com)");
    });
  });

  describe("renderPostable", () => {
    it("should render a plain string", () => {
      const result = converter.renderPostable("Hello world");
      expect(result).toBe("Hello world");
    });

    it("should render a raw message", () => {
      const result = converter.renderPostable({ raw: "raw content" });
      expect(result).toBe("raw content");
    });

    it("should render a markdown message", () => {
      const result = converter.renderPostable({
        markdown: "**bold** text",
      });
      expect(result).toContain("bold");
    });

    it("should render an AST message", () => {
      const ast = converter.toAst("Hello from AST");
      const result = converter.renderPostable({ ast });
      expect(result).toContain("Hello from AST");
    });
  });
});
