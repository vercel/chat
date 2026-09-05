import type { ITable, ITextBlock } from "@microsoft/teams.cards";
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
  RadioSelect,
  Section,
  Select,
  SelectOption,
  Table,
  type TableOptions,
} from "chat";
import { describe, expect, it } from "vitest";
import { cardToAdaptiveCard, cardToFallbackText } from "./cards";
import { cardToAdaptiveCard as primitivesCardToAdaptiveCard } from "./cards-primitives";

describe("cardToAdaptiveCard", () => {
  it("creates a valid adaptive card structure", () => {
    const card = Card({ title: "Test" });
    const adaptive = cardToAdaptiveCard(card);

    expect(adaptive.type).toBe("AdaptiveCard");
    expect(adaptive.$schema).toBe(
      "http://adaptivecards.io/schemas/adaptive-card.json"
    );
    expect(adaptive.version).toBe("1.5");
    expect(adaptive.body).toBeInstanceOf(Array);
  });

  it("converts a card with title", () => {
    const card = Card({ title: "Welcome Message" });
    const adaptive = cardToAdaptiveCard(card);

    expect(adaptive.body).toHaveLength(1);
    expect(adaptive.body[0]).toMatchObject({
      type: "TextBlock",
      text: "Welcome Message",
      weight: "Bolder",
      size: "Large",
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
    expect(adaptive.body[1]).toMatchObject({
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
    expect(adaptive.body[1]).toMatchObject({
      type: "Image",
      url: "https://example.com/product.png",
      size: "Stretch",
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

    expect(adaptive.body[0]).toMatchObject({
      type: "TextBlock",
      text: "Regular text",
      wrap: true,
    });

    expect(adaptive.body[1]).toMatchObject({
      type: "TextBlock",
      text: "Bold text",
      wrap: true,
      weight: "Bolder",
    });

    expect(adaptive.body[2]).toMatchObject({
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
    expect(adaptive.body[0]).toMatchObject({
      type: "Image",
      url: "https://example.com/img.png",
      altText: "My image",
      size: "Auto",
    });
  });

  it("converts divider elements", () => {
    const card = Card({
      children: [Divider()],
    });
    const adaptive = cardToAdaptiveCard(card);

    expect(adaptive.body).toHaveLength(1);
    expect(adaptive.body[0]).toMatchObject({
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

    expect(adaptive.actions?.[0]).toMatchObject({
      type: "Action.Submit",
      title: "Approve",
      data: { actionId: "approve", value: undefined },
      style: "positive",
    });

    expect(adaptive.actions?.[1]).toMatchObject({
      type: "Action.Submit",
      title: "Reject",
      data: { actionId: "reject", value: "data-123" },
      style: "destructive",
    });

    expect(adaptive.actions?.[2]).toMatchObject({
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
    expect(adaptive.actions?.[0]).toMatchObject({
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
    expect(adaptive.body[0]).toMatchObject({
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
    expect((adaptive.body[0] as { items: unknown[] }).items).toHaveLength(1);
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

describe("cardToAdaptiveCard with modal buttons", () => {
  it("adds msteams task/fetch hint for actionType modal", () => {
    const card = Card({
      children: [
        Actions([
          Button({ id: "open-dialog", label: "Open", actionType: "modal" }),
        ]),
      ],
    });
    const adaptive = cardToAdaptiveCard(card);

    expect(adaptive.actions).toHaveLength(1);
    expect(adaptive.actions?.[0]).toMatchObject({
      type: "Action.Submit",
      title: "Open",
      data: {
        actionId: "open-dialog",
        msteams: { type: "task/fetch" },
      },
    });
  });
});

describe("cardToAdaptiveCard with select and radio_select in Actions", () => {
  it("converts Select to compact ChoiceSetInput in body", () => {
    const card = Card({
      children: [
        Actions([
          Select({
            id: "color",
            label: "Pick a color",
            options: [
              SelectOption({ label: "Red", value: "red" }),
              SelectOption({ label: "Blue", value: "blue" }),
            ],
            placeholder: "Choose...",
          }),
        ]),
      ],
    });
    const adaptive = cardToAdaptiveCard(card);

    expect(adaptive.body).toHaveLength(1);
    expect(adaptive.body[0]).toMatchObject({
      type: "Input.ChoiceSet",
      id: "color",
      label: "Pick a color",
      style: "compact",
      isRequired: true,
      placeholder: "Choose...",
    });
    const choiceSet = adaptive.body[0] as {
      choices: { title: string; value: string }[];
    };
    expect(choiceSet.choices).toHaveLength(2);
    expect(choiceSet.choices[0]).toMatchObject({
      title: "Red",
      value: "red",
    });

    // Auto-injects submit button since there are no explicit buttons
    expect(adaptive.actions).toHaveLength(1);
    expect(adaptive.actions?.[0]).toMatchObject({
      type: "Action.Submit",
      title: "Submit",
      data: { actionId: "__auto_submit" },
    });
  });

  it("converts RadioSelect to expanded ChoiceSetInput in body", () => {
    const card = Card({
      children: [
        Actions([
          RadioSelect({
            id: "plan",
            label: "Choose Plan",
            options: [
              SelectOption({ label: "Free", value: "free" }),
              SelectOption({ label: "Pro", value: "pro" }),
            ],
          }),
        ]),
      ],
    });
    const adaptive = cardToAdaptiveCard(card);

    expect(adaptive.body).toHaveLength(1);
    expect(adaptive.body[0]).toMatchObject({
      type: "Input.ChoiceSet",
      id: "plan",
      label: "Choose Plan",
      style: "expanded",
      isRequired: true,
    });

    // Auto-injects submit button
    expect(adaptive.actions).toHaveLength(1);
    expect(adaptive.actions?.[0]).toMatchObject({
      type: "Action.Submit",
      data: { actionId: "__auto_submit" },
    });
  });

  it("does NOT auto-inject submit when buttons are present", () => {
    const card = Card({
      children: [
        Actions([
          Select({
            id: "color",
            label: "Color",
            options: [SelectOption({ label: "Red", value: "red" })],
          }),
          Button({ id: "submit", label: "Submit", style: "primary" }),
        ]),
      ],
    });
    const adaptive = cardToAdaptiveCard(card);

    // Select goes to body, button goes to actions
    expect(adaptive.body).toHaveLength(1);
    expect(adaptive.body[0]).toMatchObject({
      type: "Input.ChoiceSet",
      id: "color",
    });
    expect(adaptive.actions).toHaveLength(1);
    expect(adaptive.actions?.[0]).toMatchObject({
      type: "Action.Submit",
      title: "Submit",
    });
  });
});

describe("cardToAdaptiveCard with CardLink", () => {
  it("converts CardLink to a TextBlock with markdown link", () => {
    const card = Card({
      children: [CardLink({ url: "https://example.com", label: "Click here" })],
    });

    const adaptive = cardToAdaptiveCard(card);

    expect(adaptive.body).toHaveLength(1);
    expect(adaptive.body[0]).toMatchObject({
      type: "TextBlock",
      text: "[Click here](https://example.com)",
      wrap: true,
    });
  });
});

describe("cardToAdaptiveCard with Teams-specific hints", () => {
  it("sets msteams width when the card asks for full width", () => {
    const adaptive = cardToAdaptiveCard(Card({ title: "Wide", width: "full" }));

    expect(adaptive.msteams).toEqual({ width: "full" });
  });

  it("leaves msteams unset by default", () => {
    const adaptive = cardToAdaptiveCard(Card({ title: "Default" }));

    expect(adaptive.msteams).toBeUndefined();
  });

  it("forwards button tooltips to the actions", () => {
    const card = Card({
      children: [
        Actions([
          Button({
            id: "approve",
            label: "Approve",
            tooltip: "Approve the request",
          }),
          LinkButton({
            url: "https://example.com/docs",
            label: "View Docs",
            tooltip: "Opens the docs",
          }),
        ]),
      ],
    });
    const adaptive = cardToAdaptiveCard(card);

    expect(adaptive.actions?.[0]).toMatchObject({
      type: "Action.Submit",
      tooltip: "Approve the request",
    });
    expect(adaptive.actions?.[1]).toMatchObject({
      type: "Action.OpenUrl",
      tooltip: "Opens the docs",
    });
  });

  it("leaves tooltip unset when none is given", () => {
    const card = Card({
      children: [Actions([Button({ id: "ok", label: "OK" })])],
    });
    const adaptive = cardToAdaptiveCard(card);

    expect(adaptive.actions?.[0]?.tooltip).toBeUndefined();
  });
});

describe("cardToAdaptiveCard with Table", () => {
  const renderTable = (options: TableOptions): ITable =>
    cardToAdaptiveCard(Card({ children: [Table(options)] })).body[0] as ITable;

  const cellTexts = (table: ITable, rowIndex: number): string[] =>
    (table.rows?.[rowIndex].cells ?? []).map(
      (cell) => (cell.items[0] as ITextBlock).text
    );

  it("renders a native Table with grid lines and a bold header row by default", () => {
    const table = renderTable({
      headers: ["Name", "Score"],
      rows: [
        ["Alice", "98"],
        ["Bob", "87"],
      ],
    });

    expect(table).toMatchObject({
      type: "Table",
      showGridLines: true,
      firstRowAsHeaders: true,
    });
    expect(table.gridStyle).toBeUndefined();
    expect(table.horizontalCellContentAlignment).toBeUndefined();
    expect(table.verticalCellContentAlignment).toBeUndefined();
    expect(table.columns).toHaveLength(2);
    expect(table.rows).toHaveLength(3);
    expect(table.rows?.[0]).toMatchObject({
      type: "TableRow",
      cells: [
        {
          type: "TableCell",
          items: [
            { type: "TextBlock", text: "Name", weight: "Bolder", wrap: true },
          ],
        },
        {
          type: "TableCell",
          items: [
            { type: "TextBlock", text: "Score", weight: "Bolder", wrap: true },
          ],
        },
      ],
    });
    expect(table.rows?.[1]).toMatchObject({
      type: "TableRow",
      cells: [
        { items: [{ type: "TextBlock", text: "Alice", wrap: true }] },
        { items: [{ type: "TextBlock", text: "98", wrap: true }] },
      ],
    });
    expect(
      (table.rows?.[1].cells?.[0].items[0] as ITextBlock).weight
    ).toBeUndefined();
  });

  it("weights every column 1 unless widths says otherwise", () => {
    expect(renderTable({ headers: ["A", "B"], rows: [] }).columns).toEqual([
      { width: 1 },
      { width: 1 },
    ]);
    expect(
      renderTable({ headers: ["A", "B", "C"], rows: [], widths: [3, 1] })
        .columns
    ).toEqual([{ width: 3 }, { width: 1 }, { width: 1 }]);
  });

  it("falls back to weight 1 for a width that is not a positive integer", () => {
    expect(
      renderTable({
        headers: ["A", "B", "C", "D", "E"],
        rows: [],
        widths: [0, -1, 1.5, Number.NaN, 2],
      }).columns
    ).toEqual([
      { width: 1 },
      { width: 1 },
      { width: 1 },
      { width: 1 },
      { width: 2 },
    ]);
  });

  it("maps per-column align onto the column definitions", () => {
    const table = renderTable({
      headers: ["A", "B", "C"],
      rows: [["1", "2", "3"]],
      align: ["left", "center", "right"],
    });

    expect(
      table.columns?.map((column) => column.horizontalCellContentAlignment)
    ).toEqual(["Left", "Center", "Right"]);
    expect(table.horizontalCellContentAlignment).toBeUndefined();
  });

  it.each([
    ["top", "Top"],
    ["center", "Center"],
    ["bottom", "Bottom"],
  ] as const)("maps verticalAlign %s to %s", (verticalAlign, expected) => {
    expect(
      renderTable({ headers: ["A"], rows: [], verticalAlign })
        .verticalCellContentAlignment
    ).toBe(expected);
  });

  it("omits the header row and the header flag for a headerless table", () => {
    const table = renderTable({ headers: [], rows: [["Alice", "98"]] });

    expect(table.firstRowAsHeaders).toBe(false);
    expect(table.columns).toHaveLength(2);
    expect(table.rows).toHaveLength(1);
    expect(cellTexts(table, 0)).toEqual(["Alice", "98"]);
    expect(
      (table.rows?.[0].cells?.[0].items[0] as ITextBlock).weight
    ).toBeUndefined();
  });

  it("emits no element for a table with no columns", () => {
    const render = (rows: string[][]) =>
      cardToAdaptiveCard(Card({ children: [Table({ headers: [], rows })] }))
        .body;

    expect(render([])).toEqual([]);
    expect(render([[]])).toEqual([]);
  });

  it("turns grid lines off on request", () => {
    expect(
      renderTable({ headers: ["A"], rows: [], gridLines: false }).showGridLines
    ).toBe(false);
  });

  it("passes gridStyle through", () => {
    expect(
      renderTable({ headers: ["A"], rows: [], gridStyle: "emphasis" }).gridStyle
    ).toBe("emphasis");
  });

  it("pads a ragged row with empty cells", () => {
    const table = renderTable({
      headers: ["A", "B", "C"],
      rows: [["1"], ["1", "2", "3", "4"]],
    });

    expect(table.columns).toHaveLength(4);
    expect(cellTexts(table, 0)).toEqual(["A", "B", "C", ""]);
    expect(cellTexts(table, 1)).toEqual(["1", "", "", ""]);
    expect(cellTexts(table, 2)).toEqual(["1", "2", "3", "4"]);
  });

  it("converts emoji placeholders in headers and cells", () => {
    const table = renderTable({
      headers: ["Status {{emoji:check}}"],
      rows: [["Done {{emoji:check}}"]],
    });

    expect(cellTexts(table, 0)).toEqual(["Status ✅"]);
    expect(cellTexts(table, 1)).toEqual(["Done ✅"]);
  });

  it("keeps the ASCII fallback text", () => {
    const text = cardToFallbackText(
      Card({
        children: [
          Table({
            headers: ["Name", "Score"],
            rows: [["Alice", "98"]],
            widths: [3, 1],
            gridStyle: "emphasis",
          }),
        ],
      })
    );

    expect(text).toContain("Name  | Score\n------|------\nAlice | 98");
  });

  it("emits the same Table as the dependency-free cards subpath", () => {
    const options: TableOptions = {
      headers: ["Name", "Score"],
      rows: [["Alice", "98"], ["Bob"]],
      align: ["left", "right"],
      widths: [3, 1],
      gridStyle: "emphasis",
    };
    const primitives = primitivesCardToAdaptiveCard({
      children: [{ ...options, type: "table" }],
      type: "card",
    }).body[0] as Record<string, unknown>;

    expect(JSON.parse(JSON.stringify(renderTable(options)))).toMatchObject(
      primitives
    );
  });
});
