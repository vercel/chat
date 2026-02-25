import {
  Actions,
  Button,
  Card,
  CardLink,
  CardText,
  Divider,
  Field,
  Fields,
  Image,
  LinkButton,
  Section,
} from "chat";
import { describe, expect, it } from "vitest";
import { cardToAdaptiveCard, cardToFallbackText } from "./cards";

describe("cardToAdaptiveCard", () => {
  it("creates a valid adaptive card structure", () => {
    const card = Card({ title: "Test" });
    const adaptive = cardToAdaptiveCard(card);

    expect(adaptive.type).toBe("AdaptiveCard");
    expect(adaptive.$schema).toBe(
      "http://adaptivecards.io/schemas/adaptive-card.json"
    );
    expect(adaptive.version).toBe("1.4");
    expect(adaptive.body).toBeInstanceOf(Array);
  });

  it("converts a card with title", () => {
    const card = Card({ title: "Welcome Message" });
    const adaptive = cardToAdaptiveCard(card);

    expect(adaptive.body).toHaveLength(1);
    expect(adaptive.body[0]).toEqual({
      type: "TextBlock",
      text: "Welcome Message",
      weight: "bolder",
      size: "large",
      wrap: true,
    });
  });

  it("converts a card with title and subtitle", () => {
    const card = Card({
      title: "Order Update",
      subtitle: "Your package is on its way",
    });
    const adaptive = cardToAdaptiveCard(card);

    expect(adaptive.body).toHaveLength(2);
    expect(adaptive.body[1]).toEqual({
      type: "TextBlock",
      text: "Your package is on its way",
      isSubtle: true,
      wrap: true,
    });
  });

  it("converts a card with header image", () => {
    const card = Card({
      title: "Product",
      imageUrl: "https://example.com/product.png",
    });
    const adaptive = cardToAdaptiveCard(card);

    expect(adaptive.body).toHaveLength(2);
    expect(adaptive.body[1]).toEqual({
      type: "Image",
      url: "https://example.com/product.png",
      size: "stretch",
    });
  });

  it("converts text elements", () => {
    const card = Card({
      children: [
        CardText("Regular text"),
        CardText("Bold text", { style: "bold" }),
        CardText("Muted text", { style: "muted" }),
      ],
    });
    const adaptive = cardToAdaptiveCard(card);

    expect(adaptive.body).toHaveLength(3);

    expect(adaptive.body[0]).toEqual({
      type: "TextBlock",
      text: "Regular text",
      wrap: true,
    });

    expect(adaptive.body[1]).toEqual({
      type: "TextBlock",
      text: "Bold text",
      wrap: true,
      weight: "bolder",
    });

    expect(adaptive.body[2]).toEqual({
      type: "TextBlock",
      text: "Muted text",
      wrap: true,
      isSubtle: true,
    });
  });

  it("converts image elements", () => {
    const card = Card({
      children: [
        Image({ url: "https://example.com/img.png", alt: "My image" }),
      ],
    });
    const adaptive = cardToAdaptiveCard(card);

    expect(adaptive.body).toHaveLength(1);
    expect(adaptive.body[0]).toEqual({
      type: "Image",
      url: "https://example.com/img.png",
      altText: "My image",
      size: "auto",
    });
  });

  it("converts divider elements", () => {
    const card = Card({
      children: [Divider()],
    });
    const adaptive = cardToAdaptiveCard(card);

    expect(adaptive.body).toHaveLength(1);
    expect(adaptive.body[0]).toEqual({
      type: "Container",
      separator: true,
      items: [],
    });
  });

  it("converts actions with buttons to card-level actions", () => {
    const card = Card({
      children: [
        Actions([
          Button({ id: "approve", label: "Approve", style: "primary" }),
          Button({
            id: "reject",
            label: "Reject",
            style: "danger",
            value: "data-123",
          }),
          Button({ id: "skip", label: "Skip" }),
        ]),
      ],
    });
    const adaptive = cardToAdaptiveCard(card);

    // Actions should be at the card level, not in body
    expect(adaptive.body).toHaveLength(0);
    expect(adaptive.actions).toHaveLength(3);

    expect(adaptive.actions?.[0]).toEqual({
      type: "Action.Submit",
      title: "Approve",
      data: { actionId: "approve", value: undefined },
      style: "positive",
    });

    expect(adaptive.actions?.[1]).toEqual({
      type: "Action.Submit",
      title: "Reject",
      data: { actionId: "reject", value: "data-123" },
      style: "destructive",
    });

    expect(adaptive.actions?.[2]).toEqual({
      type: "Action.Submit",
      title: "Skip",
      data: { actionId: "skip", value: undefined },
    });
  });

  it("converts link buttons to Action.OpenUrl", () => {
    const card = Card({
      children: [
        Actions([
          LinkButton({
            url: "https://example.com/docs",
            label: "View Docs",
            style: "primary",
          }),
        ]),
      ],
    });
    const adaptive = cardToAdaptiveCard(card);

    expect(adaptive.actions).toHaveLength(1);
    expect(adaptive.actions?.[0]).toEqual({
      type: "Action.OpenUrl",
      title: "View Docs",
      url: "https://example.com/docs",
      style: "positive",
    });
  });

  it("converts fields to FactSet", () => {
    const card = Card({
      children: [
        Fields([
          Field({ label: "Status", value: "Active" }),
          Field({ label: "Priority", value: "High" }),
        ]),
      ],
    });
    const adaptive = cardToAdaptiveCard(card);

    expect(adaptive.body).toHaveLength(1);
    expect(adaptive.body[0]).toEqual({
      type: "FactSet",
      facts: [
        { title: "Status", value: "Active" },
        { title: "Priority", value: "High" },
      ],
    });
  });

  it("wraps section children in a Container", () => {
    const card = Card({
      children: [Section([CardText("Inside section")])],
    });
    const adaptive = cardToAdaptiveCard(card);

    expect(adaptive.body).toHaveLength(1);
    expect(adaptive.body[0].type).toBe("Container");
    expect(adaptive.body[0].items).toHaveLength(1);
  });

  it("converts a complete card", () => {
    const card = Card({
      title: "Order #1234",
      subtitle: "Status update",
      children: [
        CardText("Your order has been shipped!"),
        Fields([
          Field({ label: "Tracking", value: "ABC123" }),
          Field({ label: "ETA", value: "Dec 25" }),
        ]),
        Actions([
          Button({ id: "track", label: "Track Package", style: "primary" }),
        ]),
      ],
    });
    const adaptive = cardToAdaptiveCard(card);

    // Title, subtitle, text, fields in body
    expect(adaptive.body).toHaveLength(4);
    expect(adaptive.body[0].type).toBe("TextBlock"); // title
    expect(adaptive.body[1].type).toBe("TextBlock"); // subtitle
    expect(adaptive.body[2].type).toBe("TextBlock"); // text
    expect(adaptive.body[3].type).toBe("FactSet"); // fields

    // Actions at card level
    expect(adaptive.actions).toHaveLength(1);
    expect(adaptive.actions?.[0].title).toBe("Track Package");
  });
});

describe("cardToFallbackText", () => {
  it("generates fallback text for a card", () => {
    const card = Card({
      title: "Order Update",
      subtitle: "Status changed",
      children: [
        CardText("Your order is ready"),
        Fields([
          Field({ label: "Order ID", value: "#1234" }),
          Field({ label: "Status", value: "Ready" }),
        ]),
        Actions([
          Button({ id: "pickup", label: "Schedule Pickup" }),
          Button({ id: "delay", label: "Delay" }),
        ]),
      ],
    });

    const text = cardToFallbackText(card);

    expect(text).toContain("**Order Update**");
    expect(text).toContain("Status changed");
    expect(text).toContain("Your order is ready");
    expect(text).toContain("Order ID: #1234");
    expect(text).toContain("Status: Ready");
    // Actions excluded from fallback — interactive elements aren't meaningful in notifications
    expect(text).not.toContain("[Schedule Pickup]");
    expect(text).not.toContain("[Delay]");
  });

  it("handles card with only title", () => {
    const card = Card({ title: "Simple Card" });
    const text = cardToFallbackText(card);
    expect(text).toBe("**Simple Card**");
  });
});

describe("cardToAdaptiveCard with CardLink", () => {
  it("converts CardLink to a TextBlock with markdown link", () => {
    const card = Card({
      children: [CardLink({ url: "https://example.com", label: "Click here" })],
    });

    const adaptive = cardToAdaptiveCard(card);

    expect(adaptive.body).toHaveLength(1);
    expect(adaptive.body[0]).toEqual({
      type: "TextBlock",
      text: "[Click here](https://example.com)",
      wrap: true,
    });
  });
});
