import { describe, expect, it } from "vitest";
import {
  Actions,
  Button,
  Card,
  CardLink,
  Divider,
  Field,
  Fields,
  Image,
  isCardElement,
  LinkButton,
  Section,
  Text,
} from "./cards";
import { RadioSelect, Select, SelectOption } from "./modals";

describe("Card Builder Functions", () => {
  describe("Card", () => {
    it("creates a card with title", () => {
      const card = Card({ title: "My Card" });
      expect(card.type).toBe("card");
      expect(card.title).toBe("My Card");
      expect(card.children).toEqual([]);
    });

    it("creates a card with all options", () => {
      const card = Card({
        title: "Order #1234",
        subtitle: "Processing",
        imageUrl: "https://example.com/image.png",
        children: [Text("Hello")],
      });
      expect(card.title).toBe("Order #1234");
      expect(card.subtitle).toBe("Processing");
      expect(card.imageUrl).toBe("https://example.com/image.png");
      expect(card.children).toHaveLength(1);
    });

    it("creates an empty card", () => {
      const card = Card();
      expect(card.type).toBe("card");
      expect(card.children).toEqual([]);
    });
  });

  describe("Text", () => {
    it("creates a text element", () => {
      const text = Text("Hello, world!");
      expect(text.type).toBe("text");
      expect(text.content).toBe("Hello, world!");
      expect(text.style).toBeUndefined();
    });

    it("creates a bold text element", () => {
      const text = Text("Important", { style: "bold" });
      expect(text.content).toBe("Important");
      expect(text.style).toBe("bold");
    });

    it("creates a muted text element", () => {
      const text = Text("Subtle note", { style: "muted" });
      expect(text.style).toBe("muted");
    });
  });

  describe("Image", () => {
    it("creates an image element", () => {
      const img = Image({ url: "https://example.com/img.png" });
      expect(img.type).toBe("image");
      expect(img.url).toBe("https://example.com/img.png");
      expect(img.alt).toBeUndefined();
    });

    it("creates an image with alt text", () => {
      const img = Image({
        url: "https://example.com/img.png",
        alt: "A beautiful sunset",
      });
      expect(img.alt).toBe("A beautiful sunset");
    });
  });

  describe("Divider", () => {
    it("creates a divider element", () => {
      const div = Divider();
      expect(div.type).toBe("divider");
    });
  });

  describe("Button", () => {
    it("creates a button element", () => {
      const btn = Button({ id: "submit", label: "Submit" });
      expect(btn.type).toBe("button");
      expect(btn.id).toBe("submit");
      expect(btn.label).toBe("Submit");
      expect(btn.style).toBeUndefined();
      expect(btn.value).toBeUndefined();
    });

    it("creates a primary button", () => {
      const btn = Button({ id: "ok", label: "OK", style: "primary" });
      expect(btn.style).toBe("primary");
    });

    it("creates a danger button with value", () => {
      const btn = Button({
        id: "delete",
        label: "Delete",
        style: "danger",
        value: "item-123",
      });
      expect(btn.style).toBe("danger");
      expect(btn.value).toBe("item-123");
    });
  });

  describe("LinkButton", () => {
    it("creates a link button element", () => {
      const btn = LinkButton({
        url: "https://example.com",
        label: "Visit Site",
      });
      expect(btn.type).toBe("link-button");
      expect(btn.url).toBe("https://example.com");
      expect(btn.label).toBe("Visit Site");
      expect(btn.style).toBeUndefined();
    });

    it("creates a styled link button", () => {
      const btn = LinkButton({
        url: "https://docs.example.com",
        label: "View Docs",
        style: "primary",
      });
      expect(btn.style).toBe("primary");
    });
  });

  describe("CardLink", () => {
    it("creates a link element", () => {
      const link = CardLink({
        url: "https://example.com",
        label: "Visit Site",
      });
      expect(link.type).toBe("link");
      expect(link.url).toBe("https://example.com");
      expect(link.label).toBe("Visit Site");
    });
  });

  describe("Actions", () => {
    it("creates an actions container", () => {
      const actions = Actions([
        Button({ id: "ok", label: "OK" }),
        Button({ id: "cancel", label: "Cancel" }),
      ]);
      expect(actions.type).toBe("actions");
      expect(actions.children).toHaveLength(2);
      expect(actions.children[0].label).toBe("OK");
      expect(actions.children[1].label).toBe("Cancel");
    });

    it("creates actions with mixed button types", () => {
      const actions = Actions([
        Button({ id: "submit", label: "Submit", style: "primary" }),
        LinkButton({ url: "https://example.com/help", label: "Help" }),
      ]);
      expect(actions.children).toHaveLength(2);
      expect(actions.children[0].type).toBe("button");
      expect(actions.children[1].type).toBe("link-button");
    });

    it("creates empty actions", () => {
      const actions = Actions([]);
      expect(actions.children).toEqual([]);
    });
  });

  describe("Section", () => {
    it("creates a section container", () => {
      const section = Section([Text("Content"), Divider()]);
      expect(section.type).toBe("section");
      expect(section.children).toHaveLength(2);
    });
  });

  describe("Field", () => {
    it("creates a field element", () => {
      const field = Field({ label: "Status", value: "Active" });
      expect(field.type).toBe("field");
      expect(field.label).toBe("Status");
      expect(field.value).toBe("Active");
    });
  });

  describe("Fields", () => {
    it("creates a fields container", () => {
      const fields = Fields([
        Field({ label: "Name", value: "John" }),
        Field({ label: "Email", value: "john@example.com" }),
      ]);
      expect(fields.type).toBe("fields");
      expect(fields.children).toHaveLength(2);
    });
  });

  describe("isCardElement", () => {
    it("returns true for CardElement", () => {
      const card = Card({ title: "Test" });
      expect(isCardElement(card)).toBe(true);
    });

    it("returns false for non-card objects", () => {
      expect(isCardElement({ type: "text", content: "hello" })).toBe(false);
      expect(isCardElement({ type: "button", id: "x", label: "X" })).toBe(
        false
      );
      expect(isCardElement("string")).toBe(false);
      expect(isCardElement(null)).toBe(false);
      expect(isCardElement(undefined)).toBe(false);
      expect(isCardElement(123)).toBe(false);
      expect(isCardElement({})).toBe(false);
    });
  });
});

describe("Card Composition", () => {
  it("creates a complete card with all element types", () => {
    const card = Card({
      title: "Order #1234",
      subtitle: "Processing your order",
      imageUrl: "https://example.com/order.png",
      children: [
        Text("Thank you for your order!"),
        CardLink({
          url: "https://example.com/order/1234",
          label: "View order details",
        }),
        Divider(),
        Fields([
          Field({ label: "Order ID", value: "#1234" }),
          Field({ label: "Total", value: "$99.99" }),
        ]),
        Section([
          Text("Items:", { style: "bold" }),
          Text("2x Widget, 1x Gadget", { style: "muted" }),
        ]),
        Divider(),
        Actions([
          Button({ id: "track", label: "Track Order", style: "primary" }),
          Button({
            id: "cancel",
            label: "Cancel Order",
            style: "danger",
            value: "order-1234",
          }),
        ]),
      ],
    });

    expect(card.type).toBe("card");
    expect(card.title).toBe("Order #1234");
    expect(card.children).toHaveLength(7);

    // Verify structure
    expect(card.children[0].type).toBe("text");
    expect(card.children[1].type).toBe("link");
    expect(card.children[2].type).toBe("divider");
    expect(card.children[3].type).toBe("fields");
    expect(card.children[4].type).toBe("section");
    expect(card.children[5].type).toBe("divider");
    expect(card.children[6].type).toBe("actions");

    // Verify nested content
    const fields = card.children[3];
    if (fields.type === "fields") {
      expect(fields.children).toHaveLength(2);
    }

    const actions = card.children[6];
    if (actions.type === "actions") {
      expect(actions.children).toHaveLength(2);
      const firstBtn = actions.children[0];
      const secondBtn = actions.children[1];
      if (firstBtn.type === "button") {
        expect(firstBtn.id).toBe("track");
      }
      if (secondBtn.type === "button") {
        expect(secondBtn.value).toBe("order-1234");
      }
    }
  });
});

describe("Select and RadioSelect Builder Validation", () => {
  describe("Select", () => {
    it("throws when options array is empty", () => {
      expect(() =>
        Select({
          id: "test",
          label: "Test",
          options: [],
        })
      ).toThrow("Select requires at least one option");
    });

    it("creates select with valid options", () => {
      const select = Select({
        id: "test",
        label: "Test",
        options: [SelectOption({ label: "A", value: "a" })],
      });
      expect(select.type).toBe("select");
      expect(select.options).toHaveLength(1);
    });
  });

  describe("RadioSelect", () => {
    it("throws when options array is empty", () => {
      expect(() =>
        RadioSelect({
          id: "test",
          label: "Test",
          options: [],
        })
      ).toThrow("RadioSelect requires at least one option");
    });

    it("creates radio select with valid options", () => {
      const radioSelect = RadioSelect({
        id: "test",
        label: "Test",
        options: [SelectOption({ label: "A", value: "a" })],
      });
      expect(radioSelect.type).toBe("radio_select");
      expect(radioSelect.options).toHaveLength(1);
    });
  });
});

// JSX tests moved to jsx-react.test.tsx and jsx-runtime.test.tsx
