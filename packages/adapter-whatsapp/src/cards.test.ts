import type { CardElement } from "chat";
import { describe, expect, it } from "vitest";
import {
  cardToPlainText,
  cardToWhatsApp,
  cardToWhatsAppText,
  decodeWhatsAppCallbackData,
  encodeWhatsAppCallbackData,
} from "./cards";

describe("cardToWhatsAppText", () => {
  it("should render a simple card with title", () => {
    const card: CardElement = {
      type: "card",
      title: "Hello World",
      children: [],
    };
    const result = cardToWhatsAppText(card);
    expect(result).toBe("*Hello World*");
  });

  it("should render card with title and subtitle", () => {
    const card: CardElement = {
      type: "card",
      title: "Order #1234",
      subtitle: "Status update",
      children: [],
    };
    const result = cardToWhatsAppText(card);
    expect(result).toBe("*Order #1234*\nStatus update");
  });

  it("should render card with text content", () => {
    const card: CardElement = {
      type: "card",
      title: "Notification",
      children: [
        {
          type: "text",
          content: "Your order has been shipped!",
        },
      ],
    };
    const result = cardToWhatsAppText(card);
    expect(result).toBe("*Notification*\n\nYour order has been shipped!");
  });

  it("should render card with fields using WhatsApp bold", () => {
    const card: CardElement = {
      type: "card",
      title: "Order Details",
      children: [
        {
          type: "fields",
          children: [
            { type: "field", label: "Order ID", value: "12345" },
            { type: "field", label: "Status", value: "Shipped" },
          ],
        },
      ],
    };
    const result = cardToWhatsAppText(card);
    expect(result).toContain("*Order ID:* 12345");
    expect(result).toContain("*Status:* Shipped");
  });

  it("should render card with link buttons as text with URLs", () => {
    const card: CardElement = {
      type: "card",
      title: "Actions",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "link-button",
              url: "https://example.com/track",
              label: "Track Order",
            },
            {
              type: "link-button",
              url: "https://example.com/help",
              label: "Get Help",
            },
          ],
        },
      ],
    };
    const result = cardToWhatsAppText(card);
    expect(result).toContain("Track Order: https://example.com/track");
    expect(result).toContain("Get Help: https://example.com/help");
  });

  it("should render card with action buttons as bracketed text", () => {
    const card: CardElement = {
      type: "card",
      title: "Approve?",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "button",
              id: "approve",
              label: "Approve",
              style: "primary",
            },
            {
              type: "button",
              id: "reject",
              label: "Reject",
              style: "danger",
            },
          ],
        },
      ],
    };
    const result = cardToWhatsAppText(card);
    expect(result).toContain("[Approve]");
    expect(result).toContain("[Reject]");
  });

  it("should render card with image URL", () => {
    const card: CardElement = {
      type: "card",
      title: "Image Card",
      children: [
        {
          type: "image",
          url: "https://example.com/image.png",
          alt: "Example image",
        },
      ],
    };
    const result = cardToWhatsAppText(card);
    expect(result).toContain("Example image: https://example.com/image.png");
  });

  it("should render card with divider", () => {
    const card: CardElement = {
      type: "card",
      children: [
        { type: "text", content: "Before" },
        { type: "divider" },
        { type: "text", content: "After" },
      ],
    };
    const result = cardToWhatsAppText(card);
    expect(result).toContain("---");
  });

  it("should render card with section", () => {
    const card: CardElement = {
      type: "card",
      children: [
        {
          type: "section",
          children: [{ type: "text", content: "Section content" }],
        },
      ],
    };
    const result = cardToWhatsAppText(card);
    expect(result).toContain("Section content");
  });

  it("should handle text with different styles", () => {
    const card: CardElement = {
      type: "card",
      children: [
        { type: "text", content: "Normal text" },
        { type: "text", content: "Bold text", style: "bold" },
        { type: "text", content: "Muted text", style: "muted" },
      ],
    };
    const result = cardToWhatsAppText(card);
    expect(result).toContain("Normal text");
    expect(result).toContain("*Bold text*");
    expect(result).toContain("_Muted text_");
  });
});

describe("cardToWhatsApp", () => {
  it("should produce interactive message for card with 1-3 buttons", () => {
    const card: CardElement = {
      type: "card",
      title: "Choose an action",
      children: [
        { type: "text", content: "What would you like to do?" },
        {
          type: "actions",
          children: [
            { type: "button", id: "btn_yes", label: "Yes" },
            { type: "button", id: "btn_no", label: "No" },
          ],
        },
      ],
    };
    const result = cardToWhatsApp(card);
    expect(result.type).toBe("interactive");
    if (result.type === "interactive") {
      expect(result.interactive.type).toBe("button");
      expect(result.interactive.header?.text).toBe("Choose an action");
      expect("buttons" in result.interactive.action).toBe(true);
      if ("buttons" in result.interactive.action) {
        expect(result.interactive.action.buttons).toHaveLength(2);
        expect(result.interactive.action.buttons[0].reply.id).toBe(
          encodeWhatsAppCallbackData("btn_yes", undefined)
        );
        expect(result.interactive.action.buttons[1].reply.id).toBe(
          encodeWhatsAppCallbackData("btn_no", undefined)
        );
      }
    }
  });

  it("should fall back to text for more than 3 buttons", () => {
    const card: CardElement = {
      type: "card",
      title: "Too many buttons",
      children: [
        {
          type: "actions",
          children: [
            { type: "button", id: "btn_1", label: "One" },
            { type: "button", id: "btn_2", label: "Two" },
            { type: "button", id: "btn_3", label: "Three" },
            { type: "button", id: "btn_4", label: "Four" },
          ],
        },
      ],
    };
    const result = cardToWhatsApp(card);
    expect(result.type).toBe("text");
  });

  it("should fall back to text for link-only buttons", () => {
    const card: CardElement = {
      type: "card",
      title: "Links only",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "link-button",
              url: "https://example.com",
              label: "Visit",
            },
          ],
        },
      ],
    };
    const result = cardToWhatsApp(card);
    expect(result.type).toBe("text");
  });

  it("should fall back to text for cards without actions", () => {
    const card: CardElement = {
      type: "card",
      title: "Info only",
      children: [{ type: "text", content: "Just some info" }],
    };
    const result = cardToWhatsApp(card);
    expect(result.type).toBe("text");
  });

  it("should truncate long button titles to 20 chars", () => {
    const card: CardElement = {
      type: "card",
      children: [
        { type: "text", content: "Choose" },
        {
          type: "actions",
          children: [
            {
              type: "button",
              id: "btn_long",
              label: "This is a very long button title that exceeds the limit",
            },
          ],
        },
      ],
    };
    const result = cardToWhatsApp(card);
    expect(result.type).toBe("interactive");
    if (
      result.type === "interactive" &&
      "buttons" in result.interactive.action
    ) {
      expect(
        result.interactive.action.buttons[0].reply.title.length
      ).toBeLessThanOrEqual(20);
    }
  });
});

describe("cardToPlainText", () => {
  it("should generate plain text from card", () => {
    const card: CardElement = {
      type: "card",
      title: "Hello",
      subtitle: "World",
      children: [
        { type: "text", content: "Some content" },
        {
          type: "fields",
          children: [{ type: "field", label: "Key", value: "Value" }],
        },
      ],
    };
    const result = cardToPlainText(card);
    expect(result).toContain("Hello");
    expect(result).toContain("World");
    expect(result).toContain("Some content");
    expect(result).toContain("Key: Value");
  });
});

describe("encodeWhatsAppCallbackData", () => {
  it("should encode actionId only", () => {
    const result = encodeWhatsAppCallbackData("my_action");
    expect(result).toBe('chat:{"a":"my_action"}');
  });

  it("should encode actionId and value", () => {
    const result = encodeWhatsAppCallbackData("my_action", "some_value");
    expect(result).toBe('chat:{"a":"my_action","v":"some_value"}');
  });
});

describe("decodeWhatsAppCallbackData", () => {
  it("should decode encoded callback data", () => {
    const encoded = encodeWhatsAppCallbackData("my_action", "some_value");
    const result = decodeWhatsAppCallbackData(encoded);
    expect(result.actionId).toBe("my_action");
    expect(result.value).toBe("some_value");
  });

  it("should decode actionId without value", () => {
    const encoded = encodeWhatsAppCallbackData("my_action");
    const result = decodeWhatsAppCallbackData(encoded);
    expect(result.actionId).toBe("my_action");
    expect(result.value).toBeUndefined();
  });

  it("should handle non-prefixed data as passthrough", () => {
    const result = decodeWhatsAppCallbackData("raw_id");
    expect(result.actionId).toBe("raw_id");
    expect(result.value).toBe("raw_id");
  });

  it("should handle undefined data", () => {
    const result = decodeWhatsAppCallbackData(undefined);
    expect(result.actionId).toBe("whatsapp_callback");
    expect(result.value).toBeUndefined();
  });

  it("should handle malformed JSON after prefix", () => {
    const result = decodeWhatsAppCallbackData("chat:not-json");
    expect(result.actionId).toBe("chat:not-json");
    expect(result.value).toBe("chat:not-json");
  });
});
