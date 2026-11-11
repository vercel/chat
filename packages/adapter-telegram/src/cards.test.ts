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
          { text: "A", callback_data: 'chat:{"a":"a"}' },
          { text: "B", callback_data: 'chat:{"a":"b"}' },
        ],
        [{ text: "Docs", url: "https://chat-sdk.dev" }],
      ],
    });
  });

  describe("wrapping long actions blocks", () => {
    const buttonIds = (count: number, prefix = "b") =>
      Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);

    const actionsOf = (ids: string[]) => ({
      type: "actions" as const,
      children: ids.map((id) => ({ type: "button" as const, id, label: id })),
    });

    const rowTexts = (
      card: Parameters<typeof cardToTelegramInlineKeyboard>[0]
    ) =>
      cardToTelegramInlineKeyboard(card)?.inline_keyboard.map((row) =>
        row.map((button) => button.text)
      );

    it.each([
      { count: 1, widths: [1] },
      { count: 7, widths: [7] },
      { count: 8, widths: [8] },
      { count: 9, widths: [5, 4] },
      { count: 11, widths: [6, 5] },
      { count: 15, widths: [8, 7] },
      { count: 16, widths: [8, 8] },
      { count: 17, widths: [6, 6, 5] },
      { count: 19, widths: [7, 6, 6] },
      { count: 24, widths: [8, 8, 8] },
      { count: 25, widths: [7, 6, 6, 6] },
    ])("lays out $count buttons as rows of $widths", ({ count, widths }) => {
      const ids = buttonIds(count);
      const rows = rowTexts({ type: "card", children: [actionsOf(ids)] });

      expect(rows?.map((row) => row.length)).toEqual(widths);
      expect(rows?.flat()).toEqual(ids);
    });

    it("keeps every button's payload and position when wrapping", () => {
      const keyboard = cardToTelegramInlineKeyboard({
        type: "card",
        children: [actionsOf(buttonIds(9))],
      });

      expect(keyboard).toEqual({
        inline_keyboard: [
          [
            { text: "b1", callback_data: 'chat:{"a":"b1"}' },
            { text: "b2", callback_data: 'chat:{"a":"b2"}' },
            { text: "b3", callback_data: 'chat:{"a":"b3"}' },
            { text: "b4", callback_data: 'chat:{"a":"b4"}' },
            { text: "b5", callback_data: 'chat:{"a":"b5"}' },
          ],
          [
            { text: "b6", callback_data: 'chat:{"a":"b6"}' },
            { text: "b7", callback_data: 'chat:{"a":"b7"}' },
            { text: "b8", callback_data: 'chat:{"a":"b8"}' },
            { text: "b9", callback_data: 'chat:{"a":"b9"}' },
          ],
        ],
      });
    });

    it("wraps a mixed button and link-button block in source order", () => {
      const keyboard = cardToTelegramInlineKeyboard({
        type: "card",
        children: [
          {
            type: "actions",
            children: buttonIds(10).map((id, i) =>
              i % 2 === 0
                ? { type: "button" as const, id, label: id }
                : {
                    type: "link-button" as const,
                    label: id,
                    url: `https://example.com/${id}`,
                  }
            ),
          },
        ],
      });

      expect(keyboard?.inline_keyboard).toEqual([
        [
          { text: "b1", callback_data: 'chat:{"a":"b1"}' },
          { text: "b2", url: "https://example.com/b2" },
          { text: "b3", callback_data: 'chat:{"a":"b3"}' },
          { text: "b4", url: "https://example.com/b4" },
          { text: "b5", callback_data: 'chat:{"a":"b5"}' },
        ],
        [
          { text: "b6", url: "https://example.com/b6" },
          { text: "b7", callback_data: 'chat:{"a":"b7"}' },
          { text: "b8", url: "https://example.com/b8" },
          { text: "b9", callback_data: 'chat:{"a":"b9"}' },
          { text: "b10", url: "https://example.com/b10" },
        ],
      ]);
    });

    it("wraps each actions block on its own, including nested ones", () => {
      const rows = rowTexts({
        type: "card",
        children: [
          actionsOf(buttonIds(3, "top")),
          {
            type: "section",
            children: [
              actionsOf(buttonIds(9, "nested")),
              actionsOf(buttonIds(2, "tail")),
            ],
          },
        ],
      });

      expect(rows).toEqual([
        ["top1", "top2", "top3"],
        ["nested1", "nested2", "nested3", "nested4", "nested5"],
        ["nested6", "nested7", "nested8", "nested9"],
        ["tail1", "tail2"],
      ]);
    });

    it("counts only rendered buttons toward the row limit", () => {
      const rows = rowTexts({
        type: "card",
        children: [
          {
            type: "actions",
            children: [
              ...actionsOf(buttonIds(8)).children,
              {
                type: "select",
                id: "priority",
                label: "Priority",
                options: [{ label: "High", value: "high" }],
              },
              {
                type: "radio_select",
                id: "plan",
                label: "Plan",
                options: [{ label: "Pro", value: "pro" }],
              },
            ],
          },
        ],
      });

      expect(rows).toEqual([["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"]]);
    });

    it("emits no row for an actions block without buttons", () => {
      const rows = rowTexts({
        type: "card",
        children: [actionsOf([]), actionsOf(["b1"])],
      });

      expect(rows).toEqual([["b1"]]);
    });
  });

  it("encodes a button value into its callback data", () => {
    const keyboard = cardToTelegramInlineKeyboard({
      type: "card",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "button",
              id: "approve",
              label: "Approve",
              value: "request-123",
            },
          ],
        },
      ],
    });

    expect(keyboard).toEqual({
      inline_keyboard: [
        [
          {
            text: "Approve",
            callback_data: 'chat:{"a":"approve","v":"request-123"}',
          },
        ],
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
    });

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
