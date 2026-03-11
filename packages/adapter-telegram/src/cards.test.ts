import { ValidationError } from "@chat-adapter/shared";
import { describe, expect, it } from "vitest";
import {
  cardToTelegramInlineKeyboard,
  decodeTelegramCallbackData,
  emptyTelegramInlineKeyboard,
  encodeTelegramCallbackData,
} from "./cards";

describe("cardToTelegramInlineKeyboard", () => {
  it("returns undefined when card has no actions", () => {
    const keyboard = cardToTelegramInlineKeyboard({
      type: "card",
      title: "No actions",
      children: [{ type: "text", content: "hi" }],
    });

    expect(keyboard).toBeUndefined();
  });

  it("converts multiple actions blocks into multiple keyboard rows", () => {
    const keyboard = cardToTelegramInlineKeyboard({
      type: "card",
      children: [
        {
          type: "actions",
          children: [
            { type: "button", id: "a", label: "A" },
            { type: "button", id: "b", label: "B" },
          ],
        },
        {
          type: "section",
          children: [
            {
              type: "actions",
              children: [
                {
                  type: "link-button",
                  label: "Docs",
                  url: "https://chat-sdk.dev",
                },
              ],
            },
          ],
        },
      ],
    });

    expect(keyboard).toEqual({
      inline_keyboard: [
        [
          { text: "A", callback_data: encodeTelegramCallbackData("a") },
          { text: "B", callback_data: encodeTelegramCallbackData("b") },
        ],
        [{ text: "Docs", url: "https://chat-sdk.dev" }],
      ],
    });
  });

  it("ignores unsupported action controls", () => {
    const keyboard = cardToTelegramInlineKeyboard({
      type: "card",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "select",
              id: "priority",
              label: "Priority",
              options: [{ label: "High", value: "high" }],
            },
          ],
        },
      ],
    } as never);

    expect(keyboard).toBeUndefined();
  });
});

describe("callback payload encoding", () => {
  it("encodes and decodes callback payload with value", () => {
    const encoded = encodeTelegramCallbackData("approve", "request-123");
    const decoded = decodeTelegramCallbackData(encoded);

    expect(decoded).toEqual({
      actionId: "approve",
      value: "request-123",
    });
  });

  it("decodes empty callback payload with telegram_callback fallback", () => {
    const decoded = decodeTelegramCallbackData(undefined);
    expect(decoded).toEqual({
      actionId: "telegram_callback",
      value: undefined,
    });
  });

  it("falls back to raw payload for malformed encoded data", () => {
    const decoded = decodeTelegramCallbackData("chat:{not-json");
    expect(decoded).toEqual({
      actionId: "chat:{not-json",
      value: "chat:{not-json",
    });
  });

  it("falls back to raw payload for non-encoded callbacks", () => {
    const decoded = decodeTelegramCallbackData("legacy_action");
    expect(decoded).toEqual({
      actionId: "legacy_action",
      value: "legacy_action",
    });
  });

  it("throws when callback payload exceeds Telegram limit", () => {
    const veryLong = "x".repeat(200);
    expect(() => encodeTelegramCallbackData(veryLong)).toThrow(ValidationError);
  });
});

describe("emptyTelegramInlineKeyboard", () => {
  it("returns an empty keyboard", () => {
    expect(emptyTelegramInlineKeyboard()).toEqual({
      inline_keyboard: [],
    });
  });
});
