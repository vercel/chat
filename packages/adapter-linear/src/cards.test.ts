import type { CardElement } from "chat";
import { describe, expect, it } from "vitest";
import { cardToLinearMarkdown, cardToPlainText } from "./cards";

describe("cardToLinearMarkdown", () => {
  it("should render a simple card with title", () => {
    const card: CardElement = {
      type: "card",
      title: "Hello World",
      children: [],
    };
    const result = cardToLinearMarkdown(card);
    expect(result).toBe("**Hello World**");
  });

  it("should render card with title and subtitle", () => {
    const card: CardElement = {
      type: "card",
      title: "Order #1234",
      subtitle: "Status update",
      children: [],
    };
    const result = cardToLinearMarkdown(card);
    expect(result).toBe("**Order #1234**\nStatus update");
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
    const result = cardToLinearMarkdown(card);
    expect(result).toBe("**Notification**\n\nYour order has been shipped!");
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
    const result = cardToLinearMarkdown(card);
    expect(result).toContain("**Order ID:** 12345");
    expect(result).toContain("**Status:** Shipped");
  });

  it("should render card with link buttons", () => {
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
    const result = cardToLinearMarkdown(card);
    expect(result).toContain("[Track Order](https://example.com/track)");
    expect(result).toContain("[Get Help](https://example.com/help)");
  });

  it("should render card with action buttons as bold text", () => {
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
    const result = cardToLinearMarkdown(card);
    expect(result).toContain("**[Approve]**");
    expect(result).toContain("**[Reject]**");
  });

  it("should render card with image", () => {
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
    const result = cardToLinearMarkdown(card);
    expect(result).toContain("![Example image](https://example.com/image.png)");
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
    const result = cardToLinearMarkdown(card);
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
    const result = cardToLinearMarkdown(card);
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
    const result = cardToLinearMarkdown(card);
    expect(result).toContain("Normal text");
    expect(result).toContain("**Bold text**");
    expect(result).toContain("_Muted text_");
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
