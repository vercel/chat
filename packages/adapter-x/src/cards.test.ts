import type { CardElement } from "chat";
import { describe, expect, it } from "vitest";
import { cardToXText } from "./cards";

describe("cardToXText", () => {
  it("renders title, subtitle, and text children", () => {
    const card: CardElement = {
      children: [{ content: "Body text", type: "text" }],
      subtitle: "Subtitle",
      title: "Title",
      type: "card",
    };
    expect(cardToXText(card)).toBe("Title\nSubtitle\nBody text");
  });

  it("renders fields as label: value lines", () => {
    const card: CardElement = {
      children: [
        {
          children: [
            { label: "Status", type: "field", value: "Open" },
            { label: "Priority", type: "field", value: "High" },
          ],
          type: "fields",
        },
      ],
      type: "card",
    };
    expect(cardToXText(card)).toBe("Status: Open\nPriority: High");
  });

  it("renders link buttons and drops callback buttons", () => {
    const card: CardElement = {
      children: [
        {
          children: [
            { id: "approve", label: "Approve", type: "button" },
            {
              label: "View docs",
              type: "link-button",
              url: "https://chat-sdk.dev",
            },
          ],
          type: "actions",
        },
      ],
      type: "card",
    };
    expect(cardToXText(card)).toBe("View docs: https://chat-sdk.dev");
  });

  it("omits actions entirely when only callback buttons exist", () => {
    const card: CardElement = {
      children: [
        {
          children: [{ id: "approve", label: "Approve", type: "button" }],
          type: "actions",
        },
      ],
      title: "Deploy",
      type: "card",
    };
    expect(cardToXText(card)).toBe("Deploy");
  });

  it("renders dividers, links, and images", () => {
    const card: CardElement = {
      children: [
        { type: "divider" },
        { label: "Docs", type: "link", url: "https://chat-sdk.dev" },
        { alt: "logo", type: "image", url: "https://example.com/logo.png" },
      ],
      type: "card",
    };
    expect(cardToXText(card)).toBe(
      "---\nDocs: https://chat-sdk.dev\nhttps://example.com/logo.png"
    );
  });

  it("renders sections recursively", () => {
    const card: CardElement = {
      children: [
        {
          children: [
            { content: "Inner", type: "text" },
            { label: "K", type: "link", url: "https://example.com" },
          ],
          type: "section",
        },
      ],
      type: "card",
    };
    expect(cardToXText(card)).toBe("Inner\nK: https://example.com");
  });

  it("renders tables as ascii", () => {
    const card: CardElement = {
      children: [
        {
          headers: ["Name", "Count"],
          rows: [["a", "1"]],
          type: "table",
        },
      ],
      type: "card",
    };
    const output = cardToXText(card);
    expect(output).toContain("Name");
    expect(output).toContain("a");
  });
});
