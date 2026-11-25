import { describe, expect, it } from "vitest";
import { layoutFallbackCard } from "../../tests/src/layout-fallback.fixture";
import { cardToWhatsApp, cardToWhatsAppText } from "./cards";

describe("portable section layout fallbacks", () => {
  it.each([
    "columns",
    "carousel",
  ] as const)("preserves %s content and supported callbacks", (layout) => {
    const output = cardToWhatsApp(layoutFallbackCard(layout));
    expect(output).toEqual(cardToWhatsApp(layoutFallbackCard()));
    const payload = JSON.stringify(output);
    expect(payload).toContain("approve");
    expect(payload).toContain("v1");
    expect(payload).toContain("https://example.com/docs");
    const text = cardToWhatsAppText(layoutFallbackCard(layout));
    expect(text).toEqual(cardToWhatsAppText(layoutFallbackCard()));
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
    expect(cardToWhatsApp(layoutFallbackCard(layout, true))).toEqual(
      cardToWhatsApp(layoutFallbackCard(undefined, true))
    );
  });
});
