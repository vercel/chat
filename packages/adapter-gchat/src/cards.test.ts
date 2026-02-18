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
import { describe, expect, it } from "vitest";
import { cardToFallbackText, cardToGoogleCard } from "./cards";

describe("cardToGoogleCard", () => {
  it("creates a valid Google Chat card structure", () => {
    const card = Card({ title: "Test" });
    const gchatCard = cardToGoogleCard(card);

    expect(gchatCard.card).toBeDefined();
    expect(gchatCard.card.sections).toBeInstanceOf(Array);
  });

  it("accepts an optional cardId", () => {
    const card = Card({ title: "Test" });
    const gchatCard = cardToGoogleCard(card, "my-card-id");

    expect(gchatCard.cardId).toBe("my-card-id");
  });

  it("converts a card with title", () => {
    const card = Card({ title: "Welcome Message" });
    const gchatCard = cardToGoogleCard(card);

    expect(gchatCard.card.header).toEqual({
      title: "Welcome Message",
    });
  });

  it("converts a card with title and subtitle", () => {
    const card = Card({
      title: "Order Update",
      subtitle: "Your package is on its way",
    });
    const gchatCard = cardToGoogleCard(card);

    expect(gchatCard.card.header).toEqual({
      title: "Order Update",
      subtitle: "Your package is on its way",
    });
  });

  it("converts a card with header image", () => {
    const card = Card({
      title: "Product",
      imageUrl: "https://example.com/product.png",
    });
    const gchatCard = cardToGoogleCard(card);

    expect(gchatCard.card.header).toEqual({
      title: "Product",
      imageUrl: "https://example.com/product.png",
      imageType: "SQUARE",
    });
  });

  it("converts text elements to textParagraph widgets", () => {
    const card = Card({
      children: [
        CardText("Regular text"),
        CardText("Bold text", { style: "bold" }),
      ],
    });
    const gchatCard = cardToGoogleCard(card);

    expect(gchatCard.card.sections).toHaveLength(1);
    const widgets = gchatCard.card.sections[0].widgets;

    expect(widgets).toHaveLength(2);
    expect(widgets[0]).toEqual({
      textParagraph: { text: "Regular text" },
    });
    expect(widgets[1]).toEqual({
      textParagraph: { text: "*Bold text*" },
    });
  });

  it("converts image elements", () => {
    const card = Card({
      children: [
        Image({ url: "https://example.com/img.png", alt: "My image" }),
      ],
    });
    const gchatCard = cardToGoogleCard(card);

    const widgets = gchatCard.card.sections[0].widgets;
    expect(widgets).toHaveLength(1);
    expect(widgets[0]).toEqual({
      image: {
        imageUrl: "https://example.com/img.png",
        altText: "My image",
      },
    });
  });

  it("converts divider elements", () => {
    const card = Card({
      children: [Divider()],
    });
    const gchatCard = cardToGoogleCard(card);

    const widgets = gchatCard.card.sections[0].widgets;
    expect(widgets).toHaveLength(1);
    expect(widgets[0]).toEqual({ divider: {} });
  });

  it("converts actions with buttons to buttonList", () => {
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
    const gchatCard = cardToGoogleCard(card);

    const widgets = gchatCard.card.sections[0].widgets;
    expect(widgets).toHaveLength(1);

    const buttonList = widgets[0].buttonList;
    expect(buttonList).toBeDefined();
    expect(buttonList?.buttons).toHaveLength(3);

    // Without endpointUrl, function is the action ID (backward compatible)
    // actionId is always in parameters for HTTP endpoint compatibility
    expect(buttonList?.buttons[0]).toEqual({
      text: "Approve",
      onClick: {
        action: {
          function: "approve",
          parameters: [{ key: "actionId", value: "approve" }],
        },
      },
      color: { red: 0.2, green: 0.5, blue: 0.9 }, // primary blue
    });

    expect(buttonList?.buttons[1]).toEqual({
      text: "Reject",
      onClick: {
        action: {
          function: "reject",
          parameters: [
            { key: "actionId", value: "reject" },
            { key: "value", value: "data-123" },
          ],
        },
      },
      color: { red: 0.9, green: 0.2, blue: 0.2 }, // danger red
    });

    expect(buttonList?.buttons[2]).toEqual({
      text: "Skip",
      onClick: {
        action: {
          function: "skip",
          parameters: [{ key: "actionId", value: "skip" }],
        },
      },
    });
  });

  it("uses endpointUrl as function when provided", () => {
    const card = Card({
      children: [
        Actions([
          Button({ id: "approve", label: "Approve" }),
          Button({ id: "reject", label: "Reject", value: "data-123" }),
        ]),
      ],
    });
    const gchatCard = cardToGoogleCard(card, {
      endpointUrl: "https://example.com/api/webhooks/gchat",
    });

    const widgets = gchatCard.card.sections[0].widgets;
    const buttonList = widgets[0].buttonList;

    // With endpointUrl, function should be the URL, actionId in parameters
    expect(buttonList?.buttons[0]).toEqual({
      text: "Approve",
      onClick: {
        action: {
          function: "https://example.com/api/webhooks/gchat",
          parameters: [{ key: "actionId", value: "approve" }],
        },
      },
    });

    expect(buttonList?.buttons[1]).toEqual({
      text: "Reject",
      onClick: {
        action: {
          function: "https://example.com/api/webhooks/gchat",
          parameters: [
            { key: "actionId", value: "reject" },
            { key: "value", value: "data-123" },
          ],
        },
      },
    });
  });

  it("converts link buttons with openLink", () => {
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
    const gchatCard = cardToGoogleCard(card);

    const widgets = gchatCard.card.sections[0].widgets;
    expect(widgets).toHaveLength(1);

    const buttonList = widgets[0].buttonList;
    expect(buttonList).toBeDefined();
    expect(buttonList?.buttons).toHaveLength(1);

    expect(buttonList?.buttons[0]).toEqual({
      text: "View Docs",
      onClick: {
        openLink: {
          url: "https://example.com/docs",
        },
      },
      color: { red: 0.2, green: 0.5, blue: 0.9 }, // primary blue
    });
  });

  it("converts fields to decoratedText widgets", () => {
    const card = Card({
      children: [
        Fields([
          Field({ label: "Status", value: "Active" }),
          Field({ label: "Priority", value: "High" }),
        ]),
      ],
    });
    const gchatCard = cardToGoogleCard(card);

    const widgets = gchatCard.card.sections[0].widgets;
    expect(widgets).toHaveLength(2);

    expect(widgets[0]).toEqual({
      decoratedText: {
        topLabel: "Status",
        text: "Active",
      },
    });

    expect(widgets[1]).toEqual({
      decoratedText: {
        topLabel: "Priority",
        text: "High",
      },
    });
  });

  it("creates separate sections for Section children", () => {
    const card = Card({
      children: [
        CardText("Before section"),
        Section([CardText("Inside section")]),
        CardText("After section"),
      ],
    });
    const gchatCard = cardToGoogleCard(card);

    // Should have 3 sections: before, section contents, after
    expect(gchatCard.card.sections).toHaveLength(3);
    expect(gchatCard.card.sections[0].widgets[0].textParagraph?.text).toBe(
      "Before section",
    );
    expect(gchatCard.card.sections[1].widgets[0].textParagraph?.text).toBe(
      "Inside section",
    );
    expect(gchatCard.card.sections[2].widgets[0].textParagraph?.text).toBe(
      "After section",
    );
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
    const gchatCard = cardToGoogleCard(card);

    expect(gchatCard.card.header?.title).toBe("Order #1234");
    expect(gchatCard.card.header?.subtitle).toBe("Status update");

    // All children should be in one section
    expect(gchatCard.card.sections).toHaveLength(1);
    const widgets = gchatCard.card.sections[0].widgets;

    // text + 2 fields + buttonList = 4 widgets
    expect(widgets).toHaveLength(4);
    expect(widgets[0].textParagraph).toBeDefined();
    expect(widgets[1].decoratedText).toBeDefined();
    expect(widgets[2].decoratedText).toBeDefined();
    expect(widgets[3].buttonList).toBeDefined();
  });

  it("creates an empty section with placeholder for empty cards", () => {
    const card = Card({});
    const gchatCard = cardToGoogleCard(card);

    // GChat requires at least one section with at least one widget
    expect(gchatCard.card.sections).toHaveLength(1);
    expect(gchatCard.card.sections[0].widgets).toHaveLength(1);
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

    expect(text).toContain("*Order Update*");
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
    expect(text).toBe("*Simple Card*");
  });
});
