/**
 * Tests for the Telegram card converter.
 */

import type { CardElement } from "chat";
import { describe, expect, it } from "vitest";
import { cardToFallbackText, cardToTelegram } from "./cards";

describe("cardToTelegram", () => {
  it("should convert card with title", () => {
    const card: CardElement = {
      type: "card",
      title: "My Card",
      children: [],
    };

    const result = cardToTelegram(card);
    expect(result.text).toContain("My Card");
  });

  it("should convert card with subtitle", () => {
    const card: CardElement = {
      type: "card",
      title: "Title",
      subtitle: "Subtitle text",
      children: [],
    };

    const result = cardToTelegram(card);
    expect(result.text).toContain("Subtitle text");
  });

  it("should convert text children", () => {
    const card: CardElement = {
      type: "card",
      children: [{ type: "text", content: "Hello world" }],
    };

    const result = cardToTelegram(card);
    expect(result.text).toContain("Hello world");
  });

  it("should convert fields children", () => {
    const card: CardElement = {
      type: "card",
      children: [
        {
          type: "fields",
          children: [
            { type: "field", label: "Name", value: "John" },
            { type: "field", label: "Age", value: "30" },
          ],
        },
      ],
    };

    const result = cardToTelegram(card);
    expect(result.text).toContain("Name");
    expect(result.text).toContain("John");
    expect(result.text).toContain("Age");
    expect(result.text).toContain("30");
  });

  it("should convert button actions to inline keyboard", () => {
    const card: CardElement = {
      type: "card",
      children: [
        {
          type: "actions",
          children: [
            { type: "button", id: "btn-1", label: "Click me", value: "val1" },
            {
              type: "button",
              id: "btn-2",
              label: "Delete",
              style: "danger",
            },
          ],
        },
      ],
    };

    const result = cardToTelegram(card);
    expect(result.reply_markup).toBeDefined();
    expect(result.reply_markup?.inline_keyboard).toHaveLength(1);
    expect(result.reply_markup?.inline_keyboard[0]).toHaveLength(2);
    expect(result.reply_markup?.inline_keyboard[0]?.[0]).toEqual({
      text: "Click me",
      callback_data: "btn-1:val1",
    });
    expect(result.reply_markup?.inline_keyboard[0]?.[1]).toEqual({
      text: "Delete",
      callback_data: "btn-2",
    });
  });

  it("should convert link buttons with URL", () => {
    const card: CardElement = {
      type: "card",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "link-button",
              label: "Visit",
              url: "https://example.com",
            },
          ],
        },
      ],
    };

    const result = cardToTelegram(card);
    expect(result.reply_markup?.inline_keyboard[0]?.[0]).toEqual({
      text: "Visit",
      url: "https://example.com",
    });
  });

  it("should not include reply_markup when no actions", () => {
    const card: CardElement = {
      type: "card",
      title: "No buttons",
      children: [{ type: "text", content: "Just text" }],
    };

    const result = cardToTelegram(card);
    expect(result.reply_markup).toBeUndefined();
  });

  it("should handle divider", () => {
    const card: CardElement = {
      type: "card",
      children: [
        { type: "text", content: "Before" },
        { type: "divider" },
        { type: "text", content: "After" },
      ],
    };

    const result = cardToTelegram(card);
    expect(result.text).toContain("Before");
    expect(result.text).toContain("After");
    expect(result.text).toContain("\\-\\-\\-");
  });
});

describe("cardToFallbackText", () => {
  it("should generate fallback text from card", () => {
    const card: CardElement = {
      type: "card",
      title: "Alert",
      children: [{ type: "text", content: "Something happened" }],
    };

    const result = cardToFallbackText(card);
    expect(result).toContain("Alert");
    expect(result).toContain("Something happened");
  });
});
