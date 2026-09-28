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

  it("keeps reply buttons when a card mixes in link buttons", () => {
    const card = {
      children: [
        {
          children: [
            { id: "approve", label: "Approve", type: "button" as const },
            { id: "reject", label: "Reject", type: "button" as const },
            {
              label: "View diff",
              type: "link-button" as const,
              url: "https://example.com/diff",
            },
          ],
          type: "actions" as const,
        },
      ],
      title: "Deploy v1.2.3",
      type: "card" as const,
    };

    const result = cardToTwilioRcs(card);
    expect(result.type).toBe("content");
    if (result.type === "content") {
      const cardType = result.contentBody.types["twilio/card"] as {
        actions: Array<{ title: string; type: string; url?: string }>;
      };
      expect(cardType.actions.map((a) => a.type)).toEqual([
        "quick_reply",
        "quick_reply",
        "URL",
      ]);
      expect(cardType.actions[2].url).toBe("https://example.com/diff");
    }
  });

  it("keeps overflow links in the body for call-to-action content", () => {
    const links = Array.from({ length: 3 }, (_, i) => ({
      label: `Link ${i}`,
      type: "link-button" as const,
      url: `https://example.com/${i}`,
    }));
    const card = {
      children: [{ children: links, type: "actions" as const }],
      title: "Links",
      type: "card" as const,
    };

    const result = cardToTwilioRcs(card);
    expect(result.type).toBe("content");
    if (result.type === "content") {
      const cta = result.contentBody.types["twilio/call-to-action"] as {
        actions: unknown[];
        body: string;
      };
      expect(cta.actions).toHaveLength(2);
      expect(cta.body).toContain("Link 2: https://example.com/2");
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
    expect(result).toMatchObject({
      type: "content",
      contentBody: {
        types: { "twilio/text": { body: "Prompt\nClick OK to proceed" } },
      },
    });
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

  it.each([
    { title: "Many buttons", contentType: "twilio/card" },
    { title: undefined, contentType: "twilio/quick-reply" },
  ])("keeps the first 11 buttons in $contentType", ({ title, contentType }) => {
    const buttons = Array.from({ length: 15 }, (_, i) => ({
      id: `btn${i}`,
      label: `Button ${i}`,
      type: "button" as const,
    }));

    const card = {
      children: [{ children: buttons, type: "actions" as const }],
      title,
      type: "card" as const,
    };

    const result = cardToTwilioRcs(card);
    expect(result).toMatchObject({
      type: "content",
      contentBody: {
        types: {
          [contentType]: {
            actions: Array.from({ length: 11 }, (_, i) => ({
              id: `chat:{"a":"btn${i}"}`,
              title: `Button ${i}`,
              type: "quick_reply",
            })),
          },
        },
      },
    });
  });
});
