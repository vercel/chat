import type { CardElement } from "chat";
import { describe, expect, it } from "vitest";
import {
  cardToInstagram,
  cardToInstagramText,
  decodeInstagramCallbackData,
  encodeInstagramCallbackData,
} from "./cards";

describe("Instagram cards", () => {
  it("maps Button actions to quick replies", () => {
    const card: CardElement = {
      type: "card",
      title: "Choose",
      children: [
        { type: "text", content: "Is this helpful?" },
        {
          type: "actions",
          children: [
            { type: "button", id: "answer", label: "Yes", value: "yes" },
            { type: "button", id: "answer", label: "No", value: "no" },
          ],
        },
      ],
    };
    const result = cardToInstagram(card);
    expect(result.type).toBe("quick_replies");
    if (result.type === "quick_replies") {
      expect(result.quickReplies).toEqual([
        {
          content_type: "text",
          title: "Yes",
          payload: 'chat:{"a":"answer","v":"yes"}',
        },
        {
          content_type: "text",
          title: "No",
          payload: 'chat:{"a":"answer","v":"no"}',
        },
      ]);
      expect(result.text).toContain("Is this helpful?");
    }
  });

  it("maps link actions to a generic template", () => {
    const card: CardElement = {
      type: "card",
      title: "Your order",
      subtitle: "Ready to ship",
      imageUrl: "https://cdn.example.com/product.jpg",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "link-button",
              label: "Track",
              url: "https://example.com/track",
            },
          ],
        },
      ],
    };
    const result = cardToInstagram(card);
    expect(result.type).toBe("template");
    if (result.type === "template") {
      expect(result.payload).toMatchObject({
        template_type: "generic",
        elements: [
          {
            title: "Your order",
            image_url: "https://cdn.example.com/product.jpg",
            buttons: [
              {
                type: "web_url",
                title: "Track",
                url: "https://example.com/track",
              },
            ],
          },
        ],
      });
    }
  });

  it("falls back to readable text without actions", () => {
    const card: CardElement = {
      type: "card",
      title: "Order details",
      children: [
        {
          type: "fields",
          children: [
            { type: "field", label: "Status", value: "Shipped" },
            { type: "field", label: "Carrier", value: "Correo Argentino" },
          ],
        },
      ],
    };
    expect(cardToInstagramText(card)).toContain("Status: Shipped");
    expect(cardToInstagram(card).type).toBe("text");
  });

  it("round-trips callback payloads and passes through external payloads", () => {
    const encoded = encodeInstagramCallbackData("order", "123");
    expect(decodeInstagramCallbackData(encoded)).toEqual({
      actionId: "order",
      value: "123",
    });
    expect(decodeInstagramCallbackData("GET_STARTED")).toEqual({
      actionId: "GET_STARTED",
      value: "GET_STARTED",
    });
    expect(decodeInstagramCallbackData("chat:{broken")).toEqual({
      actionId: "chat:{broken",
      value: "chat:{broken",
    });
  });
});
