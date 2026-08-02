import { describe, expect, it } from "vitest";
import { InstagramFormatConverter } from "./markdown";

const converter = new InstagramFormatConverter();

describe("InstagramFormatConverter", () => {
  it("round-trips text and markdown through mdast", () => {
    const ast = converter.toAst("**Available** today");
    expect(ast.type).toBe("root");
    expect(converter.fromAst(ast)).toBe("Available today");
  });

  it("renders supported postable shapes", () => {
    expect(converter.renderPostable("hello")).toBe("hello");
    expect(converter.renderPostable({ raw: "raw" })).toBe("raw");
    expect(converter.renderPostable({ markdown: "**bold**" })).toBe("bold");
    expect(
      converter.renderPostable({ ast: converter.toAst("from ast") })
    ).toContain("from ast");
  });

  it("extracts plain text", () => {
    expect(converter.extractPlainText("**bold** text")).toContain("bold text");
  });
});
