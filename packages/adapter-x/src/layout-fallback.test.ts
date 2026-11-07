import { describe, expect, it } from "vitest";
import { layoutFallbackCard } from "../../tests/src/layout-fallback.fixture";
import { cardToXText } from "./cards";

describe("portable section layout fallbacks", () => {
  it.each([
    "columns",
    "carousel",
  ] as const)("keeps %s content in source order", (layout) => {
    const output = cardToXText(layoutFallbackCard(layout));
    expect(output).toEqual(cardToXText(layoutFallbackCard()));
    expect(output).toContain("First column");
    expect(output).toContain("First details");
    expect(output).toContain("Second column");
    expect(output.indexOf("First column")).toBeLessThan(
      output.indexOf("First details")
    );
    expect(output.indexOf("First details")).toBeLessThan(
      output.indexOf("Second column")
    );
    expect(output).toContain("https://example.com/details");
  });

  it.each([
    "columns",
    "carousel",
  ] as const)("keeps existing %s input fallbacks", (layout) => {
    expect(cardToXText(layoutFallbackCard(layout, true))).toEqual(
      cardToXText(layoutFallbackCard(undefined, true))
    );
  });
});
