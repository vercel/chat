/**
 * Tests for shared card utility functions.
 */
import { Actions, Button, Card, CardText, Divider, Field, Fields } from "chat";
import { describe, expect, it } from "vitest";
import {
  BUTTON_STYLE_MAPPINGS,
  cardToFallbackText,
  createEmojiConverter,
  mapButtonStyle,
} from "./card-utils";

describe("createEmojiConverter", () => {
  it("creates a Slack emoji converter", () => {
    const convert = createEmojiConverter("slack");
    // Uses {{emoji:name}} format
    expect(convert("{{emoji:wave}} Hello")).toBe(":wave: Hello");
    expect(convert("{{emoji:fire}}")).toBe(":fire:");
  });

  it("creates a Teams emoji converter", () => {
    const convert = createEmojiConverter("teams");
    // Teams uses Unicode emoji
    const result = convert("{{emoji:wave}} Hello");
    expect(result).toContain("Hello");
    expect(result).not.toContain("{{emoji:");
  });

  it("creates a GChat emoji converter", () => {
    const convert = createEmojiConverter("gchat");
    // GChat uses Unicode emoji
    const result = convert("{{emoji:wave}} Hello");
    expect(result).toContain("Hello");
    expect(result).not.toContain("{{emoji:");
  });

  it("returns text unchanged when no emoji placeholders", () => {
    const convert = createEmojiConverter("slack");
    expect(convert("Hello world")).toBe("Hello world");
  });
});

describe("mapButtonStyle", () => {
  describe("Slack", () => {
    it("maps primary to primary", () => {
      expect(mapButtonStyle("primary", "slack")).toBe("primary");
    });

    it("maps danger to danger", () => {
      expect(mapButtonStyle("danger", "slack")).toBe("danger");
    });

    it("returns undefined for undefined style", () => {
      expect(mapButtonStyle(undefined, "slack")).toBeUndefined();
    });
  });

  describe("Teams", () => {
    it("maps primary to positive", () => {
      expect(mapButtonStyle("primary", "teams")).toBe("positive");
    });

    it("maps danger to destructive", () => {
      expect(mapButtonStyle("danger", "teams")).toBe("destructive");
    });

    it("returns undefined for undefined style", () => {
      expect(mapButtonStyle(undefined, "teams")).toBeUndefined();
    });
  });

  describe("GChat", () => {
    it("maps primary to primary", () => {
      expect(mapButtonStyle("primary", "gchat")).toBe("primary");
    });

    it("maps danger to danger", () => {
      expect(mapButtonStyle("danger", "gchat")).toBe("danger");
    });
  });
});

describe("BUTTON_STYLE_MAPPINGS", () => {
  it("has mappings for all platforms", () => {
    expect(BUTTON_STYLE_MAPPINGS.slack).toBeDefined();
    expect(BUTTON_STYLE_MAPPINGS.teams).toBeDefined();
    expect(BUTTON_STYLE_MAPPINGS.gchat).toBeDefined();
  });

  it("has primary and danger for each platform", () => {
    for (const platform of ["slack", "teams", "gchat"] as const) {
      expect(BUTTON_STYLE_MAPPINGS[platform].primary).toBeDefined();
      expect(BUTTON_STYLE_MAPPINGS[platform].danger).toBeDefined();
    }
  });
});

describe("cardToFallbackText", () => {
  it("formats title with bold", () => {
    const card = Card({ title: "Test Title" });
    expect(cardToFallbackText(card)).toBe("*Test Title*");
  });

  it("formats title and subtitle", () => {
    const card = Card({ title: "Title", subtitle: "Subtitle" });
    expect(cardToFallbackText(card)).toBe("*Title*\nSubtitle");
  });

  it("uses double asterisks for markdown bold format", () => {
    const card = Card({ title: "Title" });
    expect(cardToFallbackText(card, { boldFormat: "**" })).toBe("**Title**");
  });

  it("uses double line breaks when specified", () => {
    const card = Card({
      title: "Title",
      subtitle: "Subtitle",
    });
    expect(cardToFallbackText(card, { lineBreak: "\n\n" })).toBe(
      "*Title*\n\nSubtitle"
    );
  });

  it("formats text children", () => {
    const card = Card({
      title: "Card",
      children: [CardText("Some content")],
    });
    expect(cardToFallbackText(card)).toBe("*Card*\nSome content");
  });

  it("formats fields", () => {
    // Fields takes an array directly, not an options object
    const card = Card({
      children: [
        Fields([
          Field({ label: "Name", value: "John" }),
          Field({ label: "Age", value: "30" }),
        ]),
      ],
    });
    expect(cardToFallbackText(card)).toBe("Name: John\nAge: 30");
  });

  it("formats fields as label-value pairs", () => {
    const card = Card({
      children: [Fields([Field({ label: "Key", value: "Value" })])],
    });
    expect(cardToFallbackText(card, { boldFormat: "**" })).toBe("Key: Value");
  });

  it("excludes actions from fallback text", () => {
    // Fallback text powers notifications + screen readers — actions are interactive-only
    // and have no meaning there. See: https://docs.slack.dev/reference/methods/chat.postMessage
    const card = Card({
      children: [
        Actions([
          Button({ id: "ok", label: "OK" }),
          Button({ id: "cancel", label: "Cancel" }),
        ]),
      ],
    });
    expect(cardToFallbackText(card)).toBe("");
  });

  it("formats dividers as horizontal rules", () => {
    const card = Card({
      title: "Title",
      children: [Divider(), CardText("After divider")],
    });
    expect(cardToFallbackText(card)).toBe("*Title*\n---\nAfter divider");
  });

  it("converts emoji placeholders when platform specified", () => {
    const card = Card({
      title: "{{emoji:wave}} Welcome",
      children: [CardText("{{emoji:fire}} Hot stuff")],
    });
    const result = cardToFallbackText(card, { platform: "slack" });
    expect(result).toBe("*:wave: Welcome*\n:fire: Hot stuff");
  });

  it("leaves emoji placeholders when no platform specified", () => {
    const card = Card({
      title: "{{emoji:wave}} Welcome",
    });
    const result = cardToFallbackText(card);
    expect(result).toBe("*{{emoji:wave}} Welcome*");
  });

  it("handles complex card with all elements", () => {
    const card = Card({
      title: "Order #123",
      subtitle: "Your order is confirmed",
      children: [
        CardText("Thank you for your purchase!"),
        Divider(),
        Fields([
          Field({ label: "Status", value: "Processing" }),
          Field({ label: "Total", value: "$99.99" }),
        ]),
        Actions([
          Button({ id: "view", label: "View Order", style: "primary" }),
          Button({ id: "cancel", label: "Cancel", style: "danger" }),
        ]),
      ],
    });

    const result = cardToFallbackText(card, {
      boldFormat: "**",
      lineBreak: "\n\n",
    });

    expect(result).toContain("**Order #123**");
    expect(result).toContain("Your order is confirmed");
    expect(result).toContain("Thank you for your purchase!");
    expect(result).toContain("---");
    expect(result).toContain("Status: Processing");
    expect(result).toContain("Total: $99.99");
    // Actions excluded from fallback — interactive elements aren't meaningful in notifications
    expect(result).not.toContain("[View Order]");
    expect(result).not.toContain("[Cancel]");
  });

  it("handles empty card", () => {
    const card = Card({});
    expect(cardToFallbackText(card)).toBe("");
  });

  it("handles card with only children", () => {
    const card = Card({
      children: [CardText("Just text")],
    });
    expect(cardToFallbackText(card)).toBe("Just text");
  });
});
