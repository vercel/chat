import { describe, expect, it } from "vitest";
import { layoutFallbackCard } from "../../tests/src/layout-fallback.fixture";
import { cardToInstagram, cardToInstagramText } from "./cards";

describe("portable section layout fallbacks", () => {
  it.each([
    "columns",
    "carousel",
  ] as const)("preserves %s content and supported callbacks", (layout) => {
    const output = cardToInstagram(layoutFallbackCard(layout));
    expect(output).toEqual(cardToInstagram(layoutFallbackCard()));
    const payload = JSON.stringify(output);
    expect(payload).toContain("approve");
    expect(payload).toContain("v1");
    expect(payload).toContain("https://example.com/docs");
    const text = cardToInstagramText(layoutFallbackCard(layout));
    expect(text).toEqual(cardToInstagramText(layoutFallbackCard()));
    expect(text).toContain("First column");
    expect(text).toContain("Second column");
    expect(text.indexOf("First column")).toBeLessThan(
      text.indexOf("Second column")
    );
  });

  it.each([
    "columns",
    "carousel",
  ] as const)("keeps existing %s input fallbacks", (layout) => {
    expect(cardToInstagram(layoutFallbackCard(layout, true))).toEqual(
      cardToInstagram(layoutFallbackCard(undefined, true))
    );
  });
});
