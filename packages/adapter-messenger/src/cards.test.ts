import type { CardElement } from "chat";
import { describe, expect, it } from "vitest";
import {
  cardToMessenger,
  cardToMessengerText,
  decodeMessengerCallbackData,
  encodeMessengerCallbackData,
} from "./cards";

describe("cardToMessengerText", () => {
  it("should render a simple card with title", () => {
    const card: CardElement = {
      type: "card",
      title: "Hello World",
      children: [],
    };
    const result = cardToMessengerText(card);
    expect(result).toBe("Hello World");
  });

  it("should render card with title and subtitle", () => {
    const card: CardElement = {
      type: "card",
      title: "Order #1234",
      subtitle: "Status update",
      children: [],
    };
    const result = cardToMessengerText(card);
    expect(result).toBe("Order #1234\nStatus update");
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
    const result = cardToMessengerText(card);
    expect(result).toBe("Notification\n\nYour order has been shipped!");
  });

  it("should render card with fields", () => {
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
    const result = cardToMessengerText(card);
    expect(result).toContain("Order ID: 12345");
    expect(result).toContain("Status: Shipped");
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
    const result = cardToMessengerText(card);
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
    const result = cardToMessengerText(card);
    expect(result).toContain("[Approve]");
    expect(result).toContain("[Reject]");
  });

  it("should render card with inline image", () => {
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
    const result = cardToMessengerText(card);
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
    const result = cardToMessengerText(card);
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
    const result = cardToMessengerText(card);
    expect(result).toContain("Section content");
  });

  it("should render card with link element", () => {
    const card: CardElement = {
      type: "card",
      children: [
        {
          type: "link",
          url: "https://example.com",
          label: "Example Link",
        },
      ],
    };
    const result = cardToMessengerText(card);
    expect(result).toContain("Example Link: https://example.com");
  });

  it("should render card with table", () => {
    const card: CardElement = {
      type: "card",
      children: [
        {
          type: "table",
          headers: ["Name", "Age"],
          rows: [
            ["Alice", "30"],
            ["Bob", "25"],
          ],
        },
      ],
    };
    const result = cardToMessengerText(card);
    expect(result).toContain("Name | Age");
    expect(result).toContain("Alice | 30");
    expect(result).toContain("Bob | 25");
  });

  it("should render card imageUrl", () => {
    const card: CardElement = {
      type: "card",
      title: "Card with Header Image",
      imageUrl: "https://example.com/header.png",
      children: [],
    };
    const result = cardToMessengerText(card);
    expect(result).toContain("https://example.com/header.png");
  });
});

describe("cardToMessenger - Generic Template", () => {
  it("should produce generic template for card with title and buttons", () => {
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
    const result = cardToMessenger(card);
    expect(result.type).toBe("template");
    if (result.type === "template") {
      expect(result.payload.template_type).toBe("generic");
      if (result.payload.template_type === "generic") {
        expect(result.payload.elements).toHaveLength(1);
        expect(result.payload.elements[0].title).toBe("Choose an action");
        expect(result.payload.elements[0].buttons).toHaveLength(2);
        expect(result.payload.elements[0].buttons?.[0].type).toBe("postback");
        expect(result.payload.elements[0].buttons?.[0].title).toBe("Yes");
      }
    }
  });

  it("should produce generic template for card with imageUrl", () => {
    const card: CardElement = {
      type: "card",
      title: "Product",
      imageUrl: "https://example.com/product.jpg",
      children: [
        {
          type: "actions",
          children: [{ type: "button", id: "buy", label: "Buy Now" }],
        },
      ],
    };
    const result = cardToMessenger(card);
    expect(result.type).toBe("template");
    if (
      result.type === "template" &&
      result.payload.template_type === "generic"
    ) {
      expect(result.payload.elements[0].image_url).toBe(
        "https://example.com/product.jpg"
      );
    }
  });

  it("should include subtitle in generic template", () => {
    const card: CardElement = {
      type: "card",
      title: "Order #123",
      subtitle: "Your order is ready",
      children: [
        {
          type: "actions",
          children: [{ type: "button", id: "view", label: "View" }],
        },
      ],
    };
    const result = cardToMessenger(card);
    if (
      result.type === "template" &&
      result.payload.template_type === "generic"
    ) {
      expect(result.payload.elements[0].subtitle).toBe("Your order is ready");
    }
  });

  it("should support link buttons as web_url type", () => {
    const card: CardElement = {
      type: "card",
      title: "Resources",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "link-button",
              url: "https://example.com/docs",
              label: "View Docs",
            },
          ],
        },
      ],
    };
    const result = cardToMessenger(card);
    expect(result.type).toBe("template");
    if (
      result.type === "template" &&
      result.payload.template_type === "generic"
    ) {
      expect(result.payload.elements[0].buttons?.[0].type).toBe("web_url");
      expect(result.payload.elements[0].buttons?.[0].url).toBe(
        "https://example.com/docs"
      );
    }
  });

  it("should mix postback and web_url buttons", () => {
    const card: CardElement = {
      type: "card",
      title: "Options",
      children: [
        {
          type: "actions",
          children: [
            { type: "button", id: "action1", label: "Do Action" },
            {
              type: "link-button",
              url: "https://example.com",
              label: "Learn More",
            },
          ],
        },
      ],
    };
    const result = cardToMessenger(card);
    if (
      result.type === "template" &&
      result.payload.template_type === "generic"
    ) {
      expect(result.payload.elements[0].buttons).toHaveLength(2);
      expect(result.payload.elements[0].buttons?.[0].type).toBe("postback");
      expect(result.payload.elements[0].buttons?.[1].type).toBe("web_url");
    }
  });
});

describe("cardToMessenger - Button Template", () => {
  it("should produce button template for card without title/image but with text and buttons", () => {
    const card: CardElement = {
      type: "card",
      children: [
        { type: "text", content: "Please select an option:" },
        {
          type: "actions",
          children: [
            { type: "button", id: "opt1", label: "Option 1" },
            { type: "button", id: "opt2", label: "Option 2" },
          ],
        },
      ],
    };
    const result = cardToMessenger(card);
    expect(result.type).toBe("template");
    if (result.type === "template") {
      expect(result.payload.template_type).toBe("button");
      if (result.payload.template_type === "button") {
        expect(result.payload.text).toBe("Please select an option:");
        expect(result.payload.buttons).toHaveLength(2);
      }
    }
  });
});

describe("cardToMessenger - Constraints and Fallbacks", () => {
  it("should limit to 3 buttons max", () => {
    const card: CardElement = {
      type: "card",
      title: "Many buttons",
      children: [
        {
          type: "actions",
          children: [
            { type: "button", id: "btn1", label: "One" },
            { type: "button", id: "btn2", label: "Two" },
            { type: "button", id: "btn3", label: "Three" },
            { type: "button", id: "btn4", label: "Four" },
          ],
        },
      ],
    };
    const result = cardToMessenger(card);
    expect(result.type).toBe("template");
    if (
      result.type === "template" &&
      result.payload.template_type === "generic"
    ) {
      expect(result.payload.elements[0].buttons).toHaveLength(3);
    }
  });

  it("should truncate long button titles to 20 chars", () => {
    const card: CardElement = {
      type: "card",
      title: "Long titles",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "button",
              id: "btn_long",
              label: "This is a very long button title",
            },
          ],
        },
      ],
    };
    const result = cardToMessenger(card);
    expect(result.type).toBe("template");
    if (
      result.type === "template" &&
      result.payload.template_type === "generic"
    ) {
      const buttonTitle = result.payload.elements[0].buttons?.[0].title;
      expect(buttonTitle?.length).toBeLessThanOrEqual(20);
      expect(buttonTitle).toContain("…");
    }
  });

  it("should fall back to text for cards without buttons", () => {
    const card: CardElement = {
      type: "card",
      title: "Info only",
      children: [{ type: "text", content: "Just some info" }],
    };
    const result = cardToMessenger(card);
    expect(result.type).toBe("text");
  });

  it("should fall back to text for cards with only link buttons and no title", () => {
    const card: CardElement = {
      type: "card",
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
    const result = cardToMessenger(card);
    // Link buttons without body text can't create button template
    expect(result.type).toBe("text");
  });

  it("should fall back to text for cards with select elements", () => {
    const card: CardElement = {
      type: "card",
      title: "With select",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "select",
              id: "sel1",
              label: "Choose",
              options: [{ label: "A", value: "a" }],
            },
          ],
        },
      ],
    };
    const result = cardToMessenger(card);
    expect(result.type).toBe("text");
  });

  it("should fall back to text for cards with radio_select elements", () => {
    const card: CardElement = {
      type: "card",
      title: "With radio",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "radio_select",
              id: "radio1",
              label: "Pick one",
              options: [{ label: "X", value: "x" }],
            },
          ],
        },
      ],
    };
    const result = cardToMessenger(card);
    expect(result.type).toBe("text");
  });

  it("should fall back to text for cards with table elements", () => {
    const card: CardElement = {
      type: "card",
      title: "With table",
      children: [
        {
          type: "table",
          headers: ["Col1", "Col2"],
          rows: [["A", "B"]],
        },
        {
          type: "actions",
          children: [{ type: "button", id: "btn", label: "Click" }],
        },
      ],
    };
    const result = cardToMessenger(card);
    expect(result.type).toBe("text");
  });

  it("should truncate long subtitles to 80 chars", () => {
    const longSubtitle =
      "This is an extremely long subtitle that definitely exceeds the 80 character limit imposed by Messenger";
    const card: CardElement = {
      type: "card",
      title: "Test",
      subtitle: longSubtitle,
      children: [
        {
          type: "actions",
          children: [{ type: "button", id: "btn", label: "Click" }],
        },
      ],
    };
    const result = cardToMessenger(card);
    if (
      result.type === "template" &&
      result.payload.template_type === "generic"
    ) {
      const subtitle = result.payload.elements[0].subtitle;
      expect(subtitle?.length).toBeLessThanOrEqual(80);
      expect(subtitle).toContain("…");
    }
  });

  it("should handle nested actions in sections", () => {
    const card: CardElement = {
      type: "card",
      title: "Nested",
      children: [
        {
          type: "section",
          children: [
            {
              type: "actions",
              children: [{ type: "button", id: "nested", label: "Nested" }],
            },
          ],
        },
      ],
    };
    const result = cardToMessenger(card);
    expect(result.type).toBe("template");
    if (
      result.type === "template" &&
      result.payload.template_type === "generic"
    ) {
      expect(result.payload.elements[0].buttons).toHaveLength(1);
      expect(result.payload.elements[0].buttons?.[0].title).toBe("Nested");
    }
  });
});

describe("encodeMessengerCallbackData", () => {
  it("should encode actionId only", () => {
    const result = encodeMessengerCallbackData("my_action");
    expect(result).toBe('chat:{"a":"my_action"}');
  });

  it("should encode actionId and value", () => {
    const result = encodeMessengerCallbackData("my_action", "some_value");
    expect(result).toBe('chat:{"a":"my_action","v":"some_value"}');
  });

  it("should handle special characters in actionId", () => {
    const result = encodeMessengerCallbackData("action:with:colons");
    expect(result).toBe('chat:{"a":"action:with:colons"}');
  });
});

describe("decodeMessengerCallbackData", () => {
  it("should decode encoded callback data with value", () => {
    const encoded = encodeMessengerCallbackData("my_action", "some_value");
    const result = decodeMessengerCallbackData(encoded);
    expect(result.actionId).toBe("my_action");
    expect(result.value).toBe("some_value");
  });

  it("should decode actionId without value", () => {
    const encoded = encodeMessengerCallbackData("my_action");
    const result = decodeMessengerCallbackData(encoded);
    expect(result.actionId).toBe("my_action");
    expect(result.value).toBeUndefined();
  });

  it("should handle non-prefixed data as passthrough (legacy support)", () => {
    const result = decodeMessengerCallbackData("raw_payload");
    expect(result.actionId).toBe("raw_payload");
    expect(result.value).toBe("raw_payload");
  });

  it("should handle undefined data", () => {
    const result = decodeMessengerCallbackData(undefined);
    expect(result.actionId).toBe("messenger_callback");
    expect(result.value).toBeUndefined();
  });

  it("should handle malformed JSON after prefix", () => {
    const result = decodeMessengerCallbackData("chat:not-valid-json");
    expect(result.actionId).toBe("chat:not-valid-json");
    expect(result.value).toBe("chat:not-valid-json");
  });

  it("should handle empty string as missing data", () => {
    // Empty string is falsy, so it's treated as undefined
    const result = decodeMessengerCallbackData("");
    expect(result.actionId).toBe("messenger_callback");
    expect(result.value).toBeUndefined();
  });

  it("should roundtrip encode/decode", () => {
    const actionId = "test_action";
    const value = "test_value";
    const encoded = encodeMessengerCallbackData(actionId, value);
    const decoded = decodeMessengerCallbackData(encoded);
    expect(decoded.actionId).toBe(actionId);
    expect(decoded.value).toBe(value);
  });
});

describe("cardToMessenger - callback data encoding", () => {
  it("should encode button id and value in postback payload", () => {
    const card: CardElement = {
      type: "card",
      title: "Test",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "button",
              id: "action_id",
              label: "Click",
              value: "action_value",
            },
          ],
        },
      ],
    };
    const result = cardToMessenger(card);
    if (
      result.type === "template" &&
      result.payload.template_type === "generic"
    ) {
      const button = result.payload.elements[0].buttons?.[0];
      expect(button?.type).toBe("postback");
      expect(button?.payload).toBe(
        encodeMessengerCallbackData("action_id", "action_value")
      );
    }
  });

  it("should encode button id without value when value is undefined", () => {
    const card: CardElement = {
      type: "card",
      title: "Test",
      children: [
        {
          type: "actions",
          children: [{ type: "button", id: "just_id", label: "Click" }],
        },
      ],
    };
    const result = cardToMessenger(card);
    if (
      result.type === "template" &&
      result.payload.template_type === "generic"
    ) {
      const button = result.payload.elements[0].buttons?.[0];
      expect(button?.payload).toBe(encodeMessengerCallbackData("just_id"));
    }
  });
});
