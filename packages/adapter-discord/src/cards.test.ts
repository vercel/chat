import {
  Actions,
  Button,
  Card,
  CardText,
  Divider,
  Field,
  Fields,
  Image,
  LinkButton,
  Section,
} from "chat";
import { ButtonStyle } from "discord-api-types/v10";
import { describe, expect, it } from "vitest";
import { cardToDiscordPayload, cardToFallbackText } from "./cards";

describe("cardToDiscordPayload", () => {
  it("converts a simple card with title", () => {
    const card = Card({ title: "Welcome" });
    const { embeds, components } = cardToDiscordPayload(card);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].title).toBe("Welcome");
    expect(components).toHaveLength(0);
  });

  it("converts a card with title and subtitle", () => {
    const card = Card({
      title: "Order Update",
      subtitle: "Your order is on its way",
    });
    const { embeds } = cardToDiscordPayload(card);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].title).toBe("Order Update");
    expect(embeds[0].description).toContain("Your order is on its way");
  });

  it("converts a card with header image", () => {
    const card = Card({
      title: "Product",
      imageUrl: "https://example.com/product.png",
    });
    const { embeds } = cardToDiscordPayload(card);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].image).toEqual({
      url: "https://example.com/product.png",
    });
  });

  it("sets default color to Discord blurple", () => {
    const card = Card({ title: "Test" });
    const { embeds } = cardToDiscordPayload(card);

    expect(embeds[0].color).toBe(0x5865f2);
  });

  it("converts text elements", () => {
    const card = Card({
      children: [
        CardText("Regular text"),
        CardText("Bold text", { style: "bold" }),
        CardText("Muted text", { style: "muted" }),
      ],
    });
    const { embeds } = cardToDiscordPayload(card);

    expect(embeds[0].description).toContain("Regular text");
    expect(embeds[0].description).toContain("**Bold text**");
    expect(embeds[0].description).toContain("*Muted text*");
  });

  it("converts image elements (in children)", () => {
    const card = Card({
      children: [
        Image({ url: "https://example.com/img.png", alt: "My image" }),
      ],
    });
    const { embeds } = cardToDiscordPayload(card);

    // Images in children are noted but the main image is set at card level
    expect(embeds).toHaveLength(1);
  });

  it("converts divider elements to horizontal line markers", () => {
    const card = Card({
      children: [CardText("Before"), Divider(), CardText("After")],
    });
    const { embeds } = cardToDiscordPayload(card);

    expect(embeds[0].description).toContain("Before");
    expect(embeds[0].description).toContain("───────────");
    expect(embeds[0].description).toContain("After");
  });

  it("converts actions with buttons", () => {
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
    const { components } = cardToDiscordPayload(card);

    expect(components).toHaveLength(1);
    expect(components[0].type).toBe(1); // Action Row

    const buttons = components[0].components;
    expect(buttons).toHaveLength(3);

    expect(buttons[0]).toEqual({
      type: 2,
      style: ButtonStyle.Primary,
      label: "Approve",
      custom_id: "approve",
    });

    expect(buttons[1]).toEqual({
      type: 2,
      style: ButtonStyle.Danger,
      label: "Reject",
      custom_id: "reject",
    });

    expect(buttons[2]).toEqual({
      type: 2,
      style: ButtonStyle.Secondary,
      label: "Skip",
      custom_id: "skip",
    });
  });

  it("converts link buttons using Link style", () => {
    const card = Card({
      children: [
        Actions([
          LinkButton({
            url: "https://example.com/docs",
            label: "View Docs",
          }),
        ]),
      ],
    });
    const { components } = cardToDiscordPayload(card);

    expect(components).toHaveLength(1);
    expect(components[0].type).toBe(1); // Action Row

    const buttons = components[0].components;
    expect(buttons).toHaveLength(1);

    expect(buttons[0]).toEqual({
      type: 2,
      style: ButtonStyle.Link,
      label: "View Docs",
      url: "https://example.com/docs",
    });
  });

  it("converts fields to embed fields", () => {
    const card = Card({
      children: [
        Fields([
          Field({ label: "Status", value: "Active" }),
          Field({ label: "Priority", value: "High" }),
        ]),
      ],
    });
    const { embeds } = cardToDiscordPayload(card);

    expect(embeds[0].fields).toHaveLength(2);
    expect(embeds[0].fields?.[0]).toEqual({
      name: "Status",
      value: "Active",
      inline: true,
    });
    expect(embeds[0].fields?.[1]).toEqual({
      name: "Priority",
      value: "High",
      inline: true,
    });
  });

  it("flattens section children", () => {
    const card = Card({
      children: [Section([CardText("Inside section"), Divider()])],
    });
    const { embeds } = cardToDiscordPayload(card);

    expect(embeds[0].description).toContain("Inside section");
    expect(embeds[0].description).toContain("───────────");
  });

  it("converts a complete card", () => {
    const card = Card({
      title: "Order #1234",
      subtitle: "Status update",
      children: [
        CardText("Your order has been shipped!"),
        Divider(),
        Fields([
          Field({ label: "Tracking", value: "ABC123" }),
          Field({ label: "ETA", value: "Dec 25" }),
        ]),
        Actions([
          Button({ id: "track", label: "Track Package", style: "primary" }),
        ]),
      ],
    });
    const { embeds, components } = cardToDiscordPayload(card);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].title).toBe("Order #1234");
    expect(embeds[0].description).toContain("Status update");
    expect(embeds[0].description).toContain("Your order has been shipped!");
    expect(embeds[0].description).toContain("───────────");
    expect(embeds[0].fields).toHaveLength(2);
    expect(components).toHaveLength(1);
    expect(components[0].components).toHaveLength(1);
  });

  it("handles card with no title or subtitle", () => {
    const card = Card({
      children: [CardText("Just content")],
    });
    const { embeds } = cardToDiscordPayload(card);

    expect(embeds[0].title).toBeUndefined();
    expect(embeds[0].description).toBe("Just content");
  });

  it("combines title subtitle and content", () => {
    const card = Card({
      title: "Title",
      subtitle: "Subtitle",
      children: [CardText("Content")],
    });
    const { embeds } = cardToDiscordPayload(card);

    expect(embeds[0].title).toBe("Title");
    expect(embeds[0].description).toContain("Subtitle");
    expect(embeds[0].description).toContain("Content");
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
    expect(text).toContain("**Order ID**: #1234");
    expect(text).toContain("**Status**: Ready");
    // Actions excluded from fallback — interactive elements aren't meaningful in notifications
    expect(text).not.toContain("[Schedule Pickup]");
    expect(text).not.toContain("[Delay]");
  });

  it("handles card with only title", () => {
    const card = Card({ title: "Simple Card" });
    const text = cardToFallbackText(card);
    expect(text).toBe("**Simple Card**");
  });

  it("handles card with subtitle only", () => {
    const card = Card({ subtitle: "Just a subtitle" });
    const text = cardToFallbackText(card);
    expect(text).toBe("Just a subtitle");
  });

  it("handles divider elements", () => {
    const card = Card({
      children: [CardText("Before"), Divider(), CardText("After")],
    });
    const text = cardToFallbackText(card);
    expect(text).toContain("Before");
    expect(text).toContain("---");
    expect(text).toContain("After");
  });

  it("handles section elements", () => {
    const card = Card({
      children: [Section([CardText("Section content")])],
    });
    const text = cardToFallbackText(card);
    expect(text).toContain("Section content");
  });

  it("handles empty card", () => {
    const card = Card({});
    const text = cardToFallbackText(card);
    expect(text).toBe("");
  });

  it("handles card with multiple fields", () => {
    const card = Card({
      children: [
        Fields([
          Field({ label: "A", value: "1" }),
          Field({ label: "B", value: "2" }),
          Field({ label: "C", value: "3" }),
        ]),
      ],
    });
    const text = cardToFallbackText(card);
    expect(text).toContain("**A**: 1");
    expect(text).toContain("**B**: 2");
    expect(text).toContain("**C**: 3");
  });
});
