import { ValidationError } from "@chat-adapter/shared";
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
} from "chat";
import { ButtonStyle } from "discord-api-types/v10";
import { describe, expect, it } from "vitest";
import {
  cardToDiscordPayload,
  cardToFallbackText,
  decodeDiscordCustomId,
  encodeDiscordCustomId,
  validateComponentsV2,
} from "./cards";
import {
  DiscordComponentType,
  DiscordContentFormat,
  DiscordMessageFlag,
} from "./types";

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
    expect(components[0].type).toBe(DiscordComponentType.ActionRow);

    const buttons = components[0].components;
    expect(buttons).toHaveLength(3);

    expect(buttons[0]).toEqual({
      type: DiscordComponentType.Button,
      style: ButtonStyle.Primary,
      label: "Approve",
      custom_id: "approve",
    });

    expect(buttons[1]).toEqual({
      type: DiscordComponentType.Button,
      style: ButtonStyle.Danger,
      label: "Reject",
      custom_id: "reject\ndata-123",
    });

    expect(buttons[2]).toEqual({
      type: DiscordComponentType.Button,
      style: ButtonStyle.Secondary,
      label: "Skip",
      custom_id: "skip",
    });
  });

  it("sets disabled on button when specified", () => {
    const card = Card({
      children: [
        Actions([
          Button({
            id: "cancel",
            label: "Cancelled",
            style: "danger",
            disabled: true,
          }),
          Button({ id: "retry", label: "Retry" }),
        ]),
      ],
    });
    const { components } = cardToDiscordPayload(card);

    const buttons = components[0].components;
    expect(buttons).toHaveLength(2);

    expect(buttons[0]).toEqual({
      type: DiscordComponentType.Button,
      style: ButtonStyle.Danger,
      label: "Cancelled",
      custom_id: "cancel",
      disabled: true,
    });

    expect(buttons[1]).toEqual({
      type: DiscordComponentType.Button,
      style: ButtonStyle.Secondary,
      label: "Retry",
      custom_id: "retry",
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
    expect(components[0].type).toBe(DiscordComponentType.ActionRow);

    const buttons = components[0].components;
    expect(buttons).toHaveLength(1);

    expect(buttons[0]).toEqual({
      type: DiscordComponentType.Button,
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

describe("cardToDiscordPayload with Components v2", () => {
  it("converts all Chat SDK card components to Discord Components v2", () => {
    const card = Card({
      title: "User Profile",
      subtitle: "Account details",
      imageUrl: "https://example.com/header.png",
      children: [
        CardText("Regular text"),
        CardText("Bold text", { style: "bold" }),
        Fields([
          Field({ label: "Status", value: "Active" }),
          Field({ label: "Team", value: "Platform" }),
        ]),
        CardLink({ url: "https://example.com/profile", label: "View profile" }),
        Divider(),
        Section([
          CardText("Section content"),
          Image({
            url: "https://example.com/avatar.png",
            alt: "User avatar",
          }),
        ]),
        Table({
          headers: ["Name", "Role"],
          rows: [["Jane", "Engineer"]],
        }),
        Image({ url: "https://example.com/chart.png", alt: "Chart" }),
        Actions([
          Select({
            id: "priority",
            label: "Priority",
            placeholder: "Choose priority",
            optional: true,
            initialOption: "high",
            options: [
              SelectOption({
                label: "High",
                value: "high",
                description: "Urgent",
              }),
              SelectOption({ label: "Low", value: "low" }),
            ],
          }),
          RadioSelect({
            id: "status",
            label: "Status",
            initialOption: "open",
            options: [
              SelectOption({ label: "Open", value: "open" }),
              SelectOption({ label: "Closed", value: "closed" }),
            ],
          }),
          Button({ id: "edit", label: "Edit", style: "primary" }),
          LinkButton({ url: "https://example.com", label: "Open" }),
        ]),
      ],
    });

    const payload = cardToDiscordPayload(card, {
      contentFormat: DiscordContentFormat.ComponentsV2,
    });

    expect(payload.embeds).toEqual([]);
    expect(payload.flags).toBe(DiscordMessageFlag.IsComponentsV2);
    expect(payload.components).toHaveLength(1);

    const container = payload.components[0];
    expect(container).toMatchObject({
      type: DiscordComponentType.Container,
      accent_color: 0x5865f2,
    });
    if (!(container && container.type === DiscordComponentType.Container)) {
      throw new Error("Expected a Discord Components v2 container");
    }

    const containerChildren = container.components;
    expect(containerChildren).toEqual(
      expect.arrayContaining([
        { type: DiscordComponentType.TextDisplay, content: "# User Profile" },
        { type: DiscordComponentType.TextDisplay, content: "Account details" },
        {
          type: DiscordComponentType.MediaGallery,
          items: [{ media: { url: "https://example.com/header.png" } }],
        },
        { type: DiscordComponentType.TextDisplay, content: "Regular text" },
        { type: DiscordComponentType.TextDisplay, content: "**Bold text**" },
        {
          type: DiscordComponentType.TextDisplay,
          content: "**Status**\nActive\n\n**Team**\nPlatform",
        },
        {
          type: DiscordComponentType.TextDisplay,
          content: "[View profile](https://example.com/profile)",
        },
        { type: DiscordComponentType.Separator, divider: true, spacing: 1 },
      ])
    );

    const section = containerChildren.find(
      (child) => child.type === DiscordComponentType.Section
    );
    expect(section).toEqual({
      type: DiscordComponentType.Section,
      components: [
        { type: DiscordComponentType.TextDisplay, content: "Section content" },
      ],
      accessory: {
        type: DiscordComponentType.Thumbnail,
        media: { url: "https://example.com/avatar.png" },
        description: "User avatar",
      },
    });

    expect(
      containerChildren.some(
        (child) =>
          child.type === DiscordComponentType.TextDisplay &&
          child.content ===
            "| Name | Role |\n| --- | --- |\n| Jane | Engineer |"
      )
    ).toBe(true);

    expect(
      containerChildren.some(
        (child) =>
          child.type === DiscordComponentType.MediaGallery &&
          child.items[0]?.media.url === "https://example.com/chart.png" &&
          child.items[0]?.description === "Chart"
      )
    ).toBe(true);

    const selectRows = containerChildren.filter(
      (child) =>
        child.type === DiscordComponentType.ActionRow &&
        child.components.some(
          (item) => item.type === DiscordComponentType.StringSelect
        )
    );
    expect(selectRows).toHaveLength(2);
    expect(selectRows[0]).toEqual({
      type: DiscordComponentType.ActionRow,
      components: [
        {
          type: DiscordComponentType.StringSelect,
          custom_id: "priority",
          placeholder: "Choose priority",
          min_values: 0,
          max_values: 1,
          options: [
            {
              label: "High",
              value: "high",
              description: "Urgent",
              default: true,
            },
            { label: "Low", value: "low" },
          ],
        },
      ],
    });
    expect(selectRows[1]).toEqual({
      type: DiscordComponentType.ActionRow,
      components: [
        {
          type: DiscordComponentType.StringSelect,
          custom_id: "status",
          placeholder: "Status",
          max_values: 1,
          options: [
            { label: "Open", value: "open", default: true },
            { label: "Closed", value: "closed" },
          ],
        },
      ],
    });

    const buttonRow = containerChildren.find(
      (child) =>
        child.type === DiscordComponentType.ActionRow &&
        child.components.some(
          (item) => item.type === DiscordComponentType.Button
        )
    );
    expect(buttonRow).toEqual({
      type: DiscordComponentType.ActionRow,
      components: [
        {
          type: DiscordComponentType.Button,
          style: ButtonStyle.Primary,
          label: "Edit",
          custom_id: "edit",
        },
        {
          type: DiscordComponentType.Button,
          style: ButtonStyle.Link,
          label: "Open",
          url: "https://example.com",
        },
      ],
    });
  });
});

describe("cardToDiscordPayload Components v2 limits and section edges", () => {
  const asV2 = (card: ReturnType<typeof Card>) =>
    cardToDiscordPayload(card, {
      contentFormat: DiscordContentFormat.ComponentsV2,
    });

  it("allows a card at the 40 component limit", () => {
    const card = Card({
      children: Array.from({ length: 39 }, (_, i) => CardText(`line ${i}`)),
    });

    const container = asV2(card).components[0];
    if (!(container && container.type === DiscordComponentType.Container)) {
      throw new Error("Expected a Discord Components v2 container");
    }
    expect(container.components).toHaveLength(39);
  });

  it("throws when a card exceeds the 40 component limit", () => {
    const card = Card({
      children: Array.from({ length: 40 }, (_, i) => CardText(`line ${i}`)),
    });

    expect(() => asV2(card)).toThrow(ValidationError);
  });

  it("promotes a lone link button to a section accessory", () => {
    const card = Card({
      children: [
        Section([
          CardText("Details"),
          Actions([LinkButton({ url: "https://example.com", label: "Open" })]),
        ]),
      ],
    });

    const container = asV2(card).components[0];
    if (!(container && container.type === DiscordComponentType.Container)) {
      throw new Error("Expected a Discord Components v2 container");
    }
    const section = container.components.find(
      (child) => child.type === DiscordComponentType.Section
    );
    expect(section).toEqual({
      type: DiscordComponentType.Section,
      components: [
        { type: DiscordComponentType.TextDisplay, content: "Details" },
      ],
      accessory: {
        type: DiscordComponentType.Button,
        style: ButtonStyle.Link,
        label: "Open",
        url: "https://example.com",
      },
    });
  });

  it("keeps multi-button section actions as action rows instead of an accessory", () => {
    const card = Card({
      children: [
        Section([
          CardText("Choose"),
          Actions([
            Button({ id: "a", label: "A" }),
            Button({ id: "b", label: "B" }),
          ]),
        ]),
      ],
    });

    const container = asV2(card).components[0];
    if (!(container && container.type === DiscordComponentType.Container)) {
      throw new Error("Expected a Discord Components v2 container");
    }
    expect(
      container.components.some(
        (child) => child.type === DiscordComponentType.Section
      )
    ).toBe(false);
    const actionRow = container.components.find(
      (child) => child.type === DiscordComponentType.ActionRow
    );
    expect(actionRow).toEqual({
      type: DiscordComponentType.ActionRow,
      components: [
        {
          type: DiscordComponentType.Button,
          style: ButtonStyle.Secondary,
          label: "A",
          custom_id: "a",
        },
        {
          type: DiscordComponentType.Button,
          style: ButtonStyle.Secondary,
          label: "B",
          custom_id: "b",
        },
      ],
    });
  });

  it("renders a lone section select as its own action row", () => {
    const card = Card({
      children: [
        Section([
          CardText("Pick one"),
          Actions([
            Select({
              id: "priority",
              label: "Priority",
              options: [SelectOption({ label: "High", value: "high" })],
            }),
          ]),
        ]),
      ],
    });

    const container = asV2(card).components[0];
    if (!(container && container.type === DiscordComponentType.Container)) {
      throw new Error("Expected a Discord Components v2 container");
    }
    const selectRow = container.components.find(
      (child) =>
        child.type === DiscordComponentType.ActionRow &&
        child.components.some(
          (item) => item.type === DiscordComponentType.StringSelect
        )
    );
    expect(selectRow).toBeDefined();
  });

  it("allows a card at the 4000 character text limit", () => {
    const card = Card({ children: [CardText("x".repeat(4000))] });

    expect(() => asV2(card)).not.toThrow();
  });

  it("throws when a single text element exceeds the 4000 character limit", () => {
    const card = Card({ children: [CardText("x".repeat(4001))] });

    expect(() => asV2(card)).toThrow(ValidationError);
  });

  it("throws when combined text across elements exceeds 4000 characters", () => {
    const card = Card({
      children: [CardText("x".repeat(2001)), CardText("y".repeat(2001))],
    });

    expect(() => asV2(card)).toThrow(ValidationError);
  });
});

describe("validateComponentsV2", () => {
  it("passes an in-range component tree", () => {
    expect(() =>
      validateComponentsV2([
        {
          type: DiscordComponentType.Container,
          components: [
            { type: DiscordComponentType.TextDisplay, content: "hello" },
          ],
        },
      ])
    ).not.toThrow();
  });

  it("throws when file attachments push the tree past 40 components", () => {
    expect(() =>
      validateComponentsV2([
        {
          type: DiscordComponentType.Container,
          components: Array.from({ length: 40 }, () => ({
            type: DiscordComponentType.File,
            file: { url: "attachment://doc.pdf" },
          })),
        },
      ])
    ).toThrow(ValidationError);
  });

  it("throws when combined text display content exceeds 4000 characters", () => {
    expect(() =>
      validateComponentsV2([
        {
          type: DiscordComponentType.Container,
          components: [
            {
              type: DiscordComponentType.TextDisplay,
              content: "x".repeat(4001),
            },
          ],
        },
      ])
    ).toThrow(ValidationError);
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

describe("cardToDiscordPayload with CardLink", () => {
  it("appends markdown link to embed description", () => {
    const card = Card({
      children: [CardLink({ url: "https://example.com", label: "Click here" })],
    });

    const payload = cardToDiscordPayload(card);

    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds[0].description).toBe(
      "[Click here](https://example.com)"
    );
  });
});

describe("encodeDiscordCustomId / decodeDiscordCustomId", () => {
  it("encodes actionId only when no value", () => {
    expect(encodeDiscordCustomId("approve")).toBe("approve");
  });

  it("encodes actionId with value", () => {
    expect(encodeDiscordCustomId("approve", "order-123")).toBe(
      "approve\norder-123"
    );
  });

  it("skips encoding when empty value", () => {
    expect(encodeDiscordCustomId("approve", "")).toBe("approve");
  });

  it("throws when actionId is empty", () => {
    expect(() => encodeDiscordCustomId("")).toThrow(ValidationError);
  });

  it("throws when actionId exceeds 100 chars", () => {
    expect(() => encodeDiscordCustomId("x".repeat(101))).toThrow(
      ValidationError
    );
  });

  it("throws when encoded custom_id exceeds 100 chars", () => {
    const longValue = "x".repeat(100);
    expect(() => encodeDiscordCustomId("btn", longValue)).toThrow(
      ValidationError
    );
  });

  it("throws when a button value makes custom_id too long", () => {
    const card = Card({
      children: [
        Actions([
          Button({
            id: "x".repeat(90),
            label: "Approve",
            value: "__cb:1234567890abcdef",
          }),
        ]),
      ],
    });

    expect(() => cardToDiscordPayload(card)).toThrow(ValidationError);
  });

  it("decodes actionId only", () => {
    expect(decodeDiscordCustomId("approve")).toEqual({
      actionId: "approve",
      value: undefined,
    });
  });

  it("decodes actionId with value", () => {
    expect(decodeDiscordCustomId("approve\norder-123")).toEqual({
      actionId: "approve",
      value: "order-123",
    });
  });

  it("round-trips encode/decode", () => {
    const encoded = encodeDiscordCustomId("btn", "__cb:a1b2c3d4e5f6g7h8");
    const decoded = decodeDiscordCustomId(encoded);
    expect(decoded.actionId).toBe("btn");
    expect(decoded.value).toBe("__cb:a1b2c3d4e5f6g7h8");
  });

  it("preserves embedded delimiter chars in the value (decoder splits on first only)", () => {
    const decoded = decodeDiscordCustomId("btn\nfirst\nsecond");
    expect(decoded.actionId).toBe("btn");
    expect(decoded.value).toBe("first\nsecond");
  });

  it("treats explicitly null value as no value", () => {
    expect(encodeDiscordCustomId("approve", undefined)).toBe("approve");
  });

  it("encodes a custom_id at the 100 char boundary", () => {
    const actionId = "a".repeat(50);
    const value = "b".repeat(49);
    const encoded = encodeDiscordCustomId(actionId, value);
    expect(encoded).toHaveLength(100);
    expect(decodeDiscordCustomId(encoded)).toEqual({ actionId, value });
  });

  it("rejects a custom_id one char past the boundary", () => {
    const actionId = "a".repeat(50);
    const value = "b".repeat(50);
    expect(() => encodeDiscordCustomId(actionId, value)).toThrow(
      ValidationError
    );
  });

  it("renders cards with values into Discord button payloads", () => {
    const card = Card({
      children: [
        Actions([
          Button({ id: "approve", label: "Approve", value: "order-99" }),
          Button({ id: "deny", label: "Deny" }),
        ]),
      ],
    });

    const payload = cardToDiscordPayload(card);
    const buttons = (
      payload.components?.[0] as { components: { custom_id: string }[] }
    ).components;

    expect(buttons[0].custom_id).toBe("approve\norder-99");
    expect(buttons[1].custom_id).toBe("deny");
  });
});
