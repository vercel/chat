import { describe, expect, it } from "vitest";
import {
  Actions,
  Button,
  Card,
  CardLink,
  Chart,
  cardChildToFallbackText,
  Divider,
  Field,
  Fields,
  Image,
  isCardElement,
  LinkButton,
  Section,
  Table,
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

  describe("Table", () => {
    it("creates a table with caption and pageSize", () => {
      const table = Table({
        headers: ["Name", "Score"],
        rows: [["Ada", "10"]],
        caption: "Scores",
        pageSize: 25,
      });
      expect(table.type).toBe("table");
      expect(table.caption).toBe("Scores");
      expect(table.pageSize).toBe(25);
    });

    it("leaves caption and pageSize undefined when omitted", () => {
      const table = Table({ headers: ["A"], rows: [["1"]] });
      expect(table.caption).toBeUndefined();
      expect(table.pageSize).toBeUndefined();
    });
  });

  describe("Chart", () => {
    it("creates a pie chart", () => {
      const chart = Chart({
        title: "Candy Bars",
        chart: {
          type: "pie",
          segments: [
            { label: "Kit Kat", value: 45 },
            { label: "Twix", value: 28 },
          ],
        },
      });
      expect(chart.type).toBe("chart");
      expect(chart.title).toBe("Candy Bars");
      expect(chart.chart.type).toBe("pie");
    });

    it("creates a line chart with series and categories", () => {
      const chart = Chart({
        title: "Weekly Sales",
        chart: {
          type: "line",
          categories: ["Week 1", "Week 2"],
          xLabel: "Week",
          yLabel: "Sales",
          series: [
            {
              name: "Scranton",
              data: [
                { label: "Week 1", value: 120 },
                { label: "Week 2", value: 135 },
              ],
            },
          ],
        },
      });
      expect(chart.chart).toEqual({
        type: "line",
        categories: ["Week 1", "Week 2"],
        xLabel: "Week",
        yLabel: "Sales",
        series: [
          {
            name: "Scranton",
            data: [
              { label: "Week 1", value: 120 },
              { label: "Week 2", value: 135 },
            ],
          },
        ],
      });
    });
  });

  describe("chart fallback text", () => {
    it("renders pie chart data as a labelled ASCII table", () => {
      const text = cardChildToFallbackText(
        Chart({
          title: "Candy Bars",
          chart: {
            type: "pie",
            segments: [
              { label: "Kit Kat", value: 45 },
              { label: "Twix", value: 28 },
            ],
          },
        })
      );
      expect(text).toContain("Candy Bars");
      expect(text).toContain("Kit Kat | 45");
      expect(text).toContain("Twix");
    });

    it("renders series chart data with one column per series", () => {
      const text = cardChildToFallbackText(
        Chart({
          title: "DAU",
          chart: {
            type: "area",
            categories: ["Mon", "Tue"],
            xLabel: "Day",
            series: [
              {
                name: "Web",
                data: [
                  { label: "Mon", value: 100 },
                  { label: "Tue", value: 110 },
                ],
              },
              {
                name: "Mobile",
                data: [
                  { label: "Tue", value: 60 },
                  { label: "Mon", value: 50 },
                ],
              },
            ],
          },
        })
      );
      expect(text).toContain("DAU");
      expect(text).toContain("Day");
      expect(text).toContain("Web");
      expect(text).toContain("Mobile");
      // Values align to categories even when point order differs
      expect(text).toContain("Mon | 100 | 50");
      expect(text).toContain("Tue | 110 | 60");
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
