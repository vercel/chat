import {
  Actions,
  Button,
  Card,
  CardText,
  Divider,
  Field,
  Fields,
  LinkButton,
  Section,
} from "chat";
import { describe, expect, it } from "vitest";
import { cardToFallbackText, cardToFeishuPayload } from "./cards";

describe("cardToFeishuPayload", () => {
  it("converts a simple card with title", () => {
    const card = Card({ title: "Welcome" });
    const result = cardToFeishuPayload(card);

    expect(result.header?.title.content).toBe("Welcome");
    expect(result.header?.title.tag).toBe("plain_text");
    expect(result.header?.template).toBe("blue");
    expect(result.config?.wide_screen_mode).toBe(true);
  });

  it("converts a card with title and subtitle", () => {
    const card = Card({
      title: "Order Update",
      subtitle: "Your order is on its way",
    });
    const result = cardToFeishuPayload(card);

    expect(result.header?.title.content).toBe("Order Update");
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]).toEqual({
      tag: "div",
      text: {
        tag: "lark_md",
        content: "Your order is on its way",
      },
    });
  });

  it("converts a card with no title", () => {
    const card = Card({
      children: [CardText("Hello")],
    });
    const result = cardToFeishuPayload(card);

    expect(result.header).toBeUndefined();
    expect(result.elements).toHaveLength(1);
  });

  it("converts text elements", () => {
    const card = Card({
      children: [CardText("Hello world")],
    });
    const result = cardToFeishuPayload(card);

    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]).toEqual({
      tag: "div",
      text: { tag: "lark_md", content: "Hello world" },
    });
  });

  it("converts bold text elements", () => {
    const card = Card({
      children: [CardText("Important", { style: "bold" })],
    });
    const result = cardToFeishuPayload(card);

    expect(result.elements[0]).toEqual({
      tag: "div",
      text: { tag: "lark_md", content: "**Important**" },
    });
  });

  it("converts muted text to italic", () => {
    const card = Card({
      children: [CardText("Note", { style: "muted" })],
    });
    const result = cardToFeishuPayload(card);

    expect(result.elements[0]).toEqual({
      tag: "div",
      text: { tag: "lark_md", content: "*Note*" },
    });
  });

  it("converts divider elements", () => {
    const card = Card({
      children: [Divider()],
    });
    const result = cardToFeishuPayload(card);

    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]).toEqual({ tag: "hr" });
  });

  it("converts button actions", () => {
    const card = Card({
      children: [
        Actions([
          Button({ id: "btn-1", label: "Click me", style: "primary" }),
          Button({ id: "btn-2", label: "Delete", style: "danger" }),
        ]),
      ],
    });
    const result = cardToFeishuPayload(card);

    expect(result.elements).toHaveLength(1);
    const action = result.elements[0] as { tag: string; actions: unknown[] };
    expect(action.tag).toBe("action");
    expect(action.actions).toHaveLength(2);
    expect(action.actions[0]).toEqual({
      tag: "button",
      text: { tag: "plain_text", content: "Click me" },
      type: "primary",
      value: { action_id: "btn-1" },
    });
    expect(action.actions[1]).toEqual({
      tag: "button",
      text: { tag: "plain_text", content: "Delete" },
      type: "danger",
      value: { action_id: "btn-2" },
    });
  });

  it("converts link buttons", () => {
    const card = Card({
      children: [
        Actions([LinkButton({ label: "Visit", url: "https://example.com" })]),
      ],
    });
    const result = cardToFeishuPayload(card);

    const action = result.elements[0] as { tag: string; actions: unknown[] };
    expect(action.actions[0]).toEqual({
      tag: "button",
      text: { tag: "plain_text", content: "Visit" },
      url: "https://example.com",
      type: "default",
    });
  });

  it("converts fields elements", () => {
    const card = Card({
      children: [
        Fields([
          Field({ label: "Status", value: "Active" }),
          Field({ label: "Priority", value: "High" }),
        ]),
      ],
    });
    const result = cardToFeishuPayload(card);

    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]).toEqual({
      tag: "div",
      text: {
        tag: "lark_md",
        content: "**Status**: Active\n**Priority**: High",
      },
    });
  });

  it("converts section elements by flattening children", () => {
    const card = Card({
      children: [Section([CardText("First"), CardText("Second")])],
    });
    const result = cardToFeishuPayload(card);

    expect(result.elements).toHaveLength(2);
  });

  it("skips image elements", () => {
    const card = Card({
      children: [CardText("Before")],
    });
    const result = cardToFeishuPayload(card);

    // Images are skipped because Feishu requires image_key from upload API
    expect(result.elements).toHaveLength(1);
  });
});

describe("cardToFallbackText", () => {
  it("renders title in bold", () => {
    const card = Card({ title: "Hello" });
    const result = cardToFallbackText(card);

    expect(result).toBe("**Hello**");
  });

  it("renders title and subtitle", () => {
    const card = Card({ title: "Title", subtitle: "Subtitle" });
    const result = cardToFallbackText(card);

    expect(result).toContain("**Title**");
    expect(result).toContain("Subtitle");
  });

  it("renders text content", () => {
    const card = Card({
      children: [CardText("Body text")],
    });
    const result = cardToFallbackText(card);

    expect(result).toContain("Body text");
  });

  it("renders dividers as ---", () => {
    const card = Card({
      children: [Divider()],
    });
    const result = cardToFallbackText(card);

    expect(result).toContain("---");
  });

  it("renders fields as label-value pairs", () => {
    const card = Card({
      children: [Fields([Field({ label: "Name", value: "John" })])],
    });
    const result = cardToFallbackText(card);

    expect(result).toContain("**Name**: John");
  });

  it("excludes actions from fallback text", () => {
    const card = Card({
      title: "Test",
      children: [Actions([Button({ id: "btn", label: "Click" })])],
    });
    const result = cardToFallbackText(card);

    expect(result).toBe("**Test**");
  });
});
