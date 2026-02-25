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
} from "chat";
import { describe, expect, it } from "vitest";
import { cardToBlockKit, cardToFallbackText } from "./cards";

describe("cardToBlockKit", () => {
  it("converts a simple card with title", () => {
    const card = Card({ title: "Welcome" });
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: "header",
      text: {
        type: "plain_text",
        text: "Welcome",
        emoji: true,
      },
    });
  });

  it("converts a card with title and subtitle", () => {
    const card = Card({
      title: "Order Update",
      subtitle: "Your order is on its way",
    });
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("header");
    expect(blocks[1]).toEqual({
      type: "context",
      elements: [{ type: "mrkdwn", text: "Your order is on its way" }],
    });
  });

  it("converts a card with header image", () => {
    const card = Card({
      title: "Product",
      imageUrl: "https://example.com/product.png",
    });
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toEqual({
      type: "image",
      image_url: "https://example.com/product.png",
      alt_text: "Product",
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
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(3);

    // Regular text
    expect(blocks[0]).toEqual({
      type: "section",
      text: { type: "mrkdwn", text: "Regular text" },
    });

    // Bold text
    expect(blocks[1]).toEqual({
      type: "section",
      text: { type: "mrkdwn", text: "*Bold text*" },
    });

    // Muted text (uses context block)
    expect(blocks[2]).toEqual({
      type: "context",
      elements: [{ type: "mrkdwn", text: "Muted text" }],
    });
  });

  it("converts image elements", () => {
    const card = Card({
      children: [
        Image({ url: "https://example.com/img.png", alt: "My image" }),
      ],
    });
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: "image",
      image_url: "https://example.com/img.png",
      alt_text: "My image",
    });
  });

  it("converts divider elements", () => {
    const card = Card({
      children: [Divider()],
    });
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: "divider" });
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
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("actions");

    const elements = blocks[0].elements as Array<{
      type: string;
      text: { type: string; text: string; emoji: boolean };
      action_id: string;
      value?: string;
      style?: string;
    }>;
    expect(elements).toHaveLength(3);

    expect(elements[0]).toEqual({
      type: "button",
      text: { type: "plain_text", text: "Approve", emoji: true },
      action_id: "approve",
      style: "primary",
    });

    expect(elements[1]).toEqual({
      type: "button",
      text: { type: "plain_text", text: "Reject", emoji: true },
      action_id: "reject",
      value: "data-123",
      style: "danger",
    });

    expect(elements[2]).toEqual({
      type: "button",
      text: { type: "plain_text", text: "Skip", emoji: true },
      action_id: "skip",
    });
  });

  it("converts link buttons with url property", () => {
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
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("actions");

    const elements = blocks[0].elements as Array<{
      type: string;
      text: { type: string; text: string; emoji: boolean };
      action_id: string;
      url: string;
      style?: string;
    }>;
    expect(elements).toHaveLength(1);

    expect(elements[0].type).toBe("button");
    expect(elements[0].text).toEqual({
      type: "plain_text",
      text: "View Docs",
      emoji: true,
    });
    expect(elements[0].url).toBe("https://example.com/docs");
    expect(elements[0].style).toBe("primary");
  });

  it("converts fields", () => {
    const card = Card({
      children: [
        Fields([
          Field({ label: "Status", value: "Active" }),
          Field({ label: "Priority", value: "High" }),
        ]),
      ],
    });
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("section");
    expect(blocks[0].fields).toEqual([
      { type: "mrkdwn", text: "*Status*\nActive" },
      { type: "mrkdwn", text: "*Priority*\nHigh" },
    ]);
  });

  it("flattens section children", () => {
    const card = Card({
      children: [Section([CardText("Inside section"), Divider()])],
    });
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("section");
    expect(blocks[1].type).toBe("divider");
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
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(6);
    expect(blocks[0].type).toBe("header");
    expect(blocks[1].type).toBe("context");
    expect(blocks[2].type).toBe("section");
    expect(blocks[3].type).toBe("divider");
    expect(blocks[4].type).toBe("section");
    expect(blocks[5].type).toBe("actions");
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

describe("cardToBlockKit with select elements", () => {
  it("converts actions with select element", () => {
    const card = Card({
      children: [
        Actions([
          Select({
            id: "priority",
            label: "Priority",
            placeholder: "Select priority",
            options: [
              SelectOption({ label: "High", value: "high" }),
              SelectOption({ label: "Medium", value: "medium" }),
              SelectOption({ label: "Low", value: "low" }),
            ],
            initialOption: "medium",
          }),
        ]),
      ],
    });
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("actions");

    const elements = blocks[0].elements as Array<{
      type: string;
      action_id: string;
      placeholder?: { type: string; text: string };
      options: Array<{ text: { type: string; text: string }; value: string }>;
      initial_option?: { text: { type: string; text: string }; value: string };
    }>;
    expect(elements).toHaveLength(1);

    expect(elements[0].type).toBe("static_select");
    expect(elements[0].action_id).toBe("priority");
    expect(elements[0].placeholder).toEqual({
      type: "plain_text",
      text: "Select priority",
    });
    expect(elements[0].options).toHaveLength(3);
    expect(elements[0].options[0]).toEqual({
      text: { type: "plain_text", text: "High" },
      value: "high",
    });
    expect(elements[0].initial_option).toEqual({
      text: { type: "plain_text", text: "Medium" },
      value: "medium",
    });
  });

  it("converts actions with mixed buttons and selects", () => {
    const card = Card({
      children: [
        Actions([
          Select({
            id: "status",
            label: "Status",
            options: [
              SelectOption({ label: "Open", value: "open" }),
              SelectOption({ label: "Closed", value: "closed" }),
            ],
          }),
          Button({ id: "submit", label: "Submit", style: "primary" }),
        ]),
      ],
    });
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(1);
    const elements = blocks[0].elements as Array<{
      type: string;
      action_id: string;
    }>;
    expect(elements).toHaveLength(2);
    expect(elements[0].type).toBe("static_select");
    expect(elements[0].action_id).toBe("status");
    expect(elements[1].type).toBe("button");
    expect(elements[1].action_id).toBe("submit");
  });

  it("converts select without placeholder or initial option", () => {
    const card = Card({
      children: [
        Actions([
          Select({
            id: "category",
            label: "Category",
            options: [
              SelectOption({ label: "Bug", value: "bug" }),
              SelectOption({ label: "Feature", value: "feature" }),
            ],
          }),
        ]),
      ],
    });
    const blocks = cardToBlockKit(card);

    const elements = blocks[0].elements as Array<{
      type: string;
      action_id: string;
      placeholder?: unknown;
      initial_option?: unknown;
    }>;
    expect(elements[0].type).toBe("static_select");
    expect(elements[0].placeholder).toBeUndefined();
    expect(elements[0].initial_option).toBeUndefined();
  });
});

describe("cardToBlockKit with radio select elements", () => {
  it("converts actions with radio select element", () => {
    const card = Card({
      children: [
        Actions([
          RadioSelect({
            id: "plan",
            label: "Choose Plan",
            options: [
              SelectOption({ label: "Basic", value: "basic" }),
              SelectOption({ label: "Pro", value: "pro" }),
              SelectOption({ label: "Enterprise", value: "enterprise" }),
            ],
          }),
        ]),
      ],
    });
    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("actions");

    const elements = blocks[0].elements as Array<{
      type: string;
      action_id: string;
      options: Array<{ text: { type: string; text: string }; value: string }>;
    }>;
    expect(elements).toHaveLength(1);
    expect(elements[0].type).toBe("radio_buttons");
    expect(elements[0].action_id).toBe("plan");
    expect(elements[0].options).toHaveLength(3);
  });

  it("uses mrkdwn type for radio select labels", () => {
    const card = Card({
      children: [
        Actions([
          RadioSelect({
            id: "option",
            label: "Choose",
            options: [SelectOption({ label: "Option A", value: "a" })],
          }),
        ]),
      ],
    });
    const blocks = cardToBlockKit(card);

    const elements = blocks[0].elements as Array<{
      options: Array<{ text: { type: string; text: string } }>;
    }>;
    expect(elements[0].options[0].text.type).toBe("mrkdwn");
    expect(elements[0].options[0].text.text).toBe("Option A");
  });

  it("limits radio select options to 10", () => {
    const options = Array.from({ length: 15 }, (_, i) =>
      SelectOption({ label: `Option ${i + 1}`, value: `opt${i + 1}` })
    );
    const card = Card({
      children: [
        Actions([
          RadioSelect({
            id: "many_options",
            label: "Many Options",
            options,
          }),
        ]),
      ],
    });
    const blocks = cardToBlockKit(card);

    const elements = blocks[0].elements as Array<{
      options: unknown[];
    }>;
    expect(elements[0].options).toHaveLength(10);
  });
});

describe("cardToBlockKit with select option descriptions", () => {
  it("includes description in select options with plain_text type", () => {
    const card = Card({
      children: [
        Actions([
          Select({
            id: "plan",
            label: "Plan",
            options: [
              SelectOption({
                label: "Basic",
                value: "basic",
                description: "For individuals",
              }),
              SelectOption({
                label: "Pro",
                value: "pro",
                description: "For teams",
              }),
            ],
          }),
        ]),
      ],
    });
    const blocks = cardToBlockKit(card);

    const elements = blocks[0].elements as Array<{
      options: Array<{
        text: { type: string; text: string };
        value: string;
        description?: { type: string; text: string };
      }>;
    }>;
    expect(elements[0].options[0].description).toEqual({
      type: "plain_text",
      text: "For individuals",
    });
    expect(elements[0].options[1].description).toEqual({
      type: "plain_text",
      text: "For teams",
    });
  });

  it("includes description in radio select options with mrkdwn type", () => {
    const card = Card({
      children: [
        Actions([
          RadioSelect({
            id: "plan",
            label: "Plan",
            options: [
              SelectOption({
                label: "Basic",
                value: "basic",
                description: "For *individuals*",
              }),
              SelectOption({
                label: "Pro",
                value: "pro",
                description: "For _teams_",
              }),
            ],
          }),
        ]),
      ],
    });
    const blocks = cardToBlockKit(card);

    const elements = blocks[0].elements as Array<{
      options: Array<{
        text: { type: string; text: string };
        value: string;
        description?: { type: string; text: string };
      }>;
    }>;
    expect(elements[0].options[0].description).toEqual({
      type: "mrkdwn",
      text: "For *individuals*",
    });
    expect(elements[0].options[1].description).toEqual({
      type: "mrkdwn",
      text: "For _teams_",
    });
  });

  it("omits description when not provided", () => {
    const card = Card({
      children: [
        Actions([
          Select({
            id: "category",
            label: "Category",
            options: [
              SelectOption({ label: "Bug", value: "bug" }),
              SelectOption({ label: "Feature", value: "feature" }),
            ],
          }),
        ]),
      ],
    });
    const blocks = cardToBlockKit(card);

    const elements = blocks[0].elements as Array<{
      options: Array<{
        description?: unknown;
      }>;
    }>;
    expect(elements[0].options[0].description).toBeUndefined();
    expect(elements[0].options[1].description).toBeUndefined();
  });
});

describe("markdown bold to Slack mrkdwn conversion", () => {
  it("converts **bold** to *bold* in CardText content", () => {
    const card = Card({
      children: [CardText("The **domain** is example.com")],
    });
    const blocks = cardToBlockKit(card);

    expect(blocks[0]).toEqual({
      type: "section",
      text: { type: "mrkdwn", text: "The *domain* is example.com" },
    });
  });

  it("converts multiple **bold** segments in one CardText", () => {
    const card = Card({
      children: [
        CardText("**Project**: my-app, **Status**: active, **Branch**: main"),
      ],
    });
    const blocks = cardToBlockKit(card);

    expect(blocks[0].text.text).toBe(
      "*Project*: my-app, *Status*: active, *Branch*: main"
    );
  });

  it("converts **bold** across multiple lines", () => {
    const card = Card({
      children: [
        CardText(
          "**Domain**: example.com\n**Project**: my-app\n**Status**: deployed"
        ),
      ],
    });
    const blocks = cardToBlockKit(card);

    expect(blocks[0].text.text).toBe(
      "*Domain*: example.com\n*Project*: my-app\n*Status*: deployed"
    );
  });

  it("preserves existing single *asterisk* formatting", () => {
    const card = Card({
      children: [CardText("Already *bold* in Slack format")],
    });
    const blocks = cardToBlockKit(card);

    expect(blocks[0].text.text).toBe("Already *bold* in Slack format");
  });

  it("handles text with no markdown formatting", () => {
    const card = Card({
      children: [CardText("Plain text with no formatting")],
    });
    const blocks = cardToBlockKit(card);

    expect(blocks[0].text.text).toBe("Plain text with no formatting");
  });

  it("converts **bold** in muted style CardText", () => {
    const card = Card({
      children: [CardText("Info about **thing**", { style: "muted" })],
    });
    const blocks = cardToBlockKit(card);

    expect(blocks[0]).toEqual({
      type: "context",
      elements: [{ type: "mrkdwn", text: "Info about *thing*" }],
    });
  });

  it("converts **bold** in field values", () => {
    const card = Card({
      children: [Fields([Field({ label: "Status", value: "**Active**" })])],
    });
    const blocks = cardToBlockKit(card);

    expect(blocks[0].fields[0].text).toContain("*Active*");
    expect(blocks[0].fields[0].text).not.toContain("**Active**");
  });

  it("does not convert empty double asterisks", () => {
    const card = Card({
      children: [CardText("text **** more")],
    });
    const blocks = cardToBlockKit(card);

    // **** has nothing between them, regex requires .+ so no conversion
    expect(blocks[0].text.text).toBe("text **** more");
  });

  it("handles **bold** at start and end of content", () => {
    const card = Card({
      children: [CardText("**Start** and **end**")],
    });
    const blocks = cardToBlockKit(card);

    expect(blocks[0].text.text).toBe("*Start* and *end*");
  });
});

describe("cardToBlockKit with CardLink", () => {
  it("converts CardLink to a mrkdwn section block with Slack link syntax", () => {
    const card = Card({
      children: [CardLink({ url: "https://example.com", label: "Click here" })],
    });

    const blocks = cardToBlockKit(card);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "<https://example.com|Click here>",
      },
    });
  });

  it("converts CardLink alongside other children", () => {
    const card = Card({
      title: "Test",
      children: [
        CardText("Hello"),
        CardLink({ url: "https://example.com", label: "Link" }),
      ],
    });

    const blocks = cardToBlockKit(card);

    // header + text section + link section
    expect(blocks).toHaveLength(3);
    expect(blocks[2]).toEqual({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "<https://example.com|Link>",
      },
    });
  });
});
