import { describe, expect, it } from "vitest";
import { layoutFallbackCard } from "../../tests/src/layout-fallback.fixture";
import {
  cardToTelegramInlineKeyboard,
  decodeTelegramCallbackData,
} from "./cards";
import { TelegramFormatConverter } from "./markdown";

describe("portable section layout fallbacks", () => {
  it.each([
    "columns",
    "carousel",
  ] as const)("preserves %s text and keyboard routing", (layout) => {
    const card = layoutFallbackCard(layout);
    const keyboard = cardToTelegramInlineKeyboard(card);
    expect(keyboard).toEqual(
      cardToTelegramInlineKeyboard(layoutFallbackCard())
    );
    expect(keyboard?.inline_keyboard[0]?.[1]).toMatchObject({
      url: "https://example.com/docs",
    });
    expect(
      decodeTelegramCallbackData(
        keyboard?.inline_keyboard[0]?.[0]?.callback_data
      )
    ).toEqual({ actionId: "approve", value: "v1" });
    const converter = new TelegramFormatConverter();
    const text = converter.renderPostable(card);
    expect(text).toEqual(converter.renderPostable(layoutFallbackCard()));
    expect(text).toContain("First column");
    expect(text).toContain("Second column");
    expect(text.indexOf("First column")).toBeLessThan(
      text.indexOf("Second column")
    );
  });
});
