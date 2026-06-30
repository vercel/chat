import { describe, expect, it } from "vitest";
import {
  cardToTwilioRcs,
  cardToTwilioText,
  decodeTwilioCallbackData,
  encodeTwilioCallbackData,
} from "./cards";

describe("cardToTwilioText", () => {
  it("renders cards as plain SMS fallback text", () => {
    const card = {
      children: [
        {
          children: [
            { content: "Approve production deploy?", type: "text" as const },
            {
              children: [
                {
                  label: "version",
                  type: "field" as const,
                  value: "1.2.3",
                },
              ],
              type: "fields" as const,
            },
          ],
          type: "section" as const,
        },
        {
          children: [
            { id: "approve", label: "Approve", type: "button" as const },
          ],
          type: "actions" as const,
        },
      ],
      title: "Deploy",
      type: "card" as const,
    };

    expect(cardToTwilioText(card)).toContain("Deploy");
    expect(cardToTwilioText(card)).toContain("Approve production deploy?");
    expect(cardToTwilioText(card)).toContain("version: 1.2.3");
    expect(cardToTwilioText(card)).not.toContain("[Approve]");
  });
});

describe("encodeTwilioCallbackData / decodeTwilioCallbackData", () => {
  it("round-trips actionId and value", () => {
    const encoded = encodeTwilioCallbackData("approve", "yes");
    const decoded = decodeTwilioCallbackData(encoded);

    expect(decoded.actionId).toBe("approve");
    expect(decoded.value).toBe("yes");
  });

  it("round-trips actionId without value", () => {
    const encoded = encodeTwilioCallbackData("cancel");
    const decoded = decodeTwilioCallbackData(encoded);

    expect(decoded.actionId).toBe("cancel");
    expect(decoded.value).toBeUndefined();
  });

  it("passes through non-prefixed data as both fields", () => {
    const decoded = decodeTwilioCallbackData("legacy_button_id");
    expect(decoded.actionId).toBe("legacy_button_id");
    expect(decoded.value).toBe("legacy_button_id");
  });

  it("handles undefined data", () => {
    const decoded = decodeTwilioCallbackData(undefined);
    expect(decoded.actionId).toBe("twilio_callback");
    expect(decoded.value).toBeUndefined();
  });

  it("handles malformed JSON after prefix", () => {
    const decoded = decodeTwilioCallbackData("chat:{invalid");
    expect(decoded.actionId).toBe("chat:{invalid");
    expect(decoded.value).toBe("chat:{invalid");
  });
});

describe("cardToTwilioRcs", () => {
  it("builds quick-reply content for cards with buttons", () => {
    const card = {
      children: [
        {
          children: [
            { id: "yes", label: "Yes", type: "button" as const },
            { id: "no", label: "No", type: "button" as const },
          ],
          type: "actions" as const,
        },
      ],
      title: "Confirm?",
      type: "card" as const,
    };

    const result = cardToTwilioRcs(card);
    expect(result.type).toBe("content");
    if (result.type === "content") {
      expect(result.contentBody.types["twilio/card"]).toBeDefined();
      expect(result.contentBody.types["twilio/text"]).toBeDefined();
      const cardType = result.contentBody.types["twilio/card"] as {
        actions: Array<{ id: string; title: string }>;
      };
      expect(cardType.actions).toHaveLength(2);
      expect(cardType.actions[0].title).toBe("Yes");
    }
  });

  it("builds call-to-action content for link buttons", () => {
    const card = {
      children: [
        {
          children: [
            {
              label: "Open Docs",
              type: "link-button" as const,
              url: "https://example.com",
            },
          ],
          type: "actions" as const,
        },
      ],
      title: "Documentation",
      type: "card" as const,
    };

    const result = cardToTwilioRcs(card);
    expect(result.type).toBe("content");
    if (result.type === "content") {
      expect(result.contentBody.types["twilio/call-to-action"]).toBeDefined();
    }
  });

  it("falls back to text for cards without actions", () => {
    const card = {
      children: [{ content: "Just text", type: "text" as const }],
      title: "Info",
      type: "card" as const,
    };

    const result = cardToTwilioRcs(card);
    expect(result.type).toBe("text");
  });

  it("includes SMS fallback in content types", () => {
    const card = {
      children: [
        {
          children: [{ id: "ok", label: "OK", type: "button" as const }],
          type: "actions" as const,
        },
      ],
      subtitle: "Click OK to proceed",
      title: "Prompt",
      type: "card" as const,
    };

    const result = cardToTwilioRcs(card);
    if (result.type === "content") {
      const sms = result.contentBody.types["twilio/text"] as { body: string };
      expect(sms.body).toBeTruthy();
    }
  });

  it("handles card with image and buttons as card content", () => {
    const card = {
      children: [
        {
          children: [{ id: "buy", label: "Buy Now", type: "button" as const }],
          type: "actions" as const,
        },
      ],
      imageUrl: "https://example.com/product.jpg",
      title: "Product",
      type: "card" as const,
    };

    const result = cardToTwilioRcs(card);
    expect(result.type).toBe("content");
    if (result.type === "content") {
      const cardType = result.contentBody.types["twilio/card"] as {
        media: string[];
      };
      expect(cardType.media).toContain("https://example.com/product.jpg");
    }
  });

  it("limits quick-reply buttons to 11", () => {
    const buttons = Array.from({ length: 15 }, (_, i) => ({
      id: `btn${i}`,
      label: `Button ${i}`,
      type: "button" as const,
    }));

    const card = {
      children: [{ children: buttons, type: "actions" as const }],
      title: "Many buttons",
      type: "card" as const,
    };

    const result = cardToTwilioRcs(card);
    if (result.type === "content") {
      const cardType = result.contentBody.types["twilio/card"] as {
        actions: unknown[];
      };
      expect(cardType.actions.length).toBeLessThanOrEqual(11);
    }
  });
});
