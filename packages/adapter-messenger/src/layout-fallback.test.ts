import { describe, expect, it } from "vitest";
import { layoutFallbackCard } from "../../tests/src/layout-fallback.fixture";
import { cardToMessenger, cardToMessengerText } from "./cards";

describe("portable section layout fallbacks", () => {
  it.each([
    "columns",
    "carousel",
  ] as const)("preserves %s content and supported callbacks", (layout) => {
    const output = cardToMessenger(layoutFallbackCard(layout));
    expect(output).toEqual(cardToMessenger(layoutFallbackCard()));
    const payload = JSON.stringify(output);
    expect(payload).toContain("approve");
    expect(payload).toContain("v1");
    expect(payload).toContain("https://example.com/docs");
    const text = cardToMessengerText(layoutFallbackCard(layout));
    expect(text).toEqual(cardToMessengerText(layoutFallbackCard()));
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
    expect(cardToMessenger(layoutFallbackCard(layout, true))).toEqual(
      cardToMessenger(layoutFallbackCard(undefined, true))
    );
  });
});
