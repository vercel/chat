import { describe, expect, it } from "vitest";
import { layoutFallbackCard } from "../../tests/src/layout-fallback.fixture";
import { WebFormatConverter } from "./format-converter";

describe("portable section layout fallbacks", () => {
  it.each([
    "columns",
    "carousel",
  ] as const)("preserves %s content through the Web text boundary", (layout) => {
    const converter = new WebFormatConverter();
    const output = converter.renderPostable(layoutFallbackCard(layout, true));
    expect(output).toEqual(
      converter.renderPostable(layoutFallbackCard(undefined, true))
    );
    expect(output).toContain("First column");
    expect(output).toContain("Second column");
    expect(output.indexOf("First column")).toBeLessThan(
      output.indexOf("Second column")
    );
  });
});
