import { describe, expect, it } from "vitest";
import { layoutFallbackCard } from "../../tests/src/layout-fallback.fixture";
import { cardToTwilioRcs, cardToTwilioText } from "./cards";

describe("portable section layout fallbacks", () => {
  it.each([
    "columns",
    "carousel",
  ] as const)("preserves %s content and supported callbacks", (layout) => {
    const output = cardToTwilioRcs(layoutFallbackCard(layout));
    expect(output).toEqual(cardToTwilioRcs(layoutFallbackCard()));
    const payload = JSON.stringify(output);
    expect(payload).toContain("approve");
    expect(payload).toContain("v1");
    expect(payload).toContain("https://example.com/docs");
    const text = cardToTwilioText(layoutFallbackCard(layout));
    expect(text).toEqual(cardToTwilioText(layoutFallbackCard()));
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
    expect(cardToTwilioRcs(layoutFallbackCard(layout, true))).toEqual(
      cardToTwilioRcs(layoutFallbackCard(undefined, true))
    );
  });
});
