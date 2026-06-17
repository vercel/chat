import { describe, expect, it } from "vitest";
import {
  cardToAdaptiveCard,
  cardToTeamsFallbackText,
  inputRequestToTeamsAdaptiveCard,
  parseTeamsInputResponse,
} from "./index";

describe("Teams card primitives", () => {
  it("converts plain card objects to Adaptive Cards", () => {
    const card = cardToAdaptiveCard({
      children: [
        { content: "Deploy :white_check_mark:", type: "text" },
        {
          children: [
            {
              id: "approve",
              label: "Approve",
              style: "primary",
              type: "button",
            },
            { label: "Logs", type: "link-button", url: "https://example.com" },
          ],
          type: "actions",
        },
      ],
      title: "Release",
      type: "card",
    });

    expect(card).toMatchObject({
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      actions: [
        {
          data: { actionId: "approve" },
          style: "positive",
          title: "Approve",
          type: "Action.Submit",
        },
        {
          title: "Logs",
          type: "Action.OpenUrl",
          url: "https://example.com",
        },
      ],
      body: [
        { text: "Release", type: "TextBlock", weight: "Bolder" },
        { text: "Deploy ✅", type: "TextBlock" },
      ],
      type: "AdaptiveCard",
      version: "1.4",
    });
  });

  it("renders fallback text", () => {
    expect(
      cardToTeamsFallbackText({
        children: [{ content: "Body", type: "text" }],
        title: "Title",
        type: "card",
      })
    ).toBe("Title\n\nBody");
  });

  it("builds and parses input request cards", () => {
    const card = inputRequestToTeamsAdaptiveCard({
      options: [{ id: "approve", label: "Approve" }],
      prompt: "Approve?",
      requestId: "deploy",
    });

    expect(card.actions).toMatchObject([
      {
        data: { actionId: "input:deploy", value: "approve" },
        title: "Approve",
      },
    ]);
    expect(
      parseTeamsInputResponse({
        actionId: "input:deploy",
        value: "approve",
      })
    ).toEqual({ optionId: "approve", requestId: "deploy", value: "approve" });
  });

  it.each([
    "radio",
    "select",
  ] as const)("parses %s input values submitted under the action id", (display) => {
    const card = inputRequestToTeamsAdaptiveCard({
      display,
      options: [{ id: "approve", label: "Approve" }],
      prompt: "Approve?",
      requestId: "deploy",
    });

    expect(card.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "input:deploy",
          style: display === "radio" ? "expanded" : "compact",
          type: "Input.ChoiceSet",
        }),
      ])
    );
    expect(
      parseTeamsInputResponse({
        actionId: "input:deploy",
        value: { "input:deploy": "approve" },
      })
    ).toEqual({
      optionId: "approve",
      requestId: "deploy",
      value: "approve",
    });
  });

  it("parses freeform text submitted under the freeform input id", () => {
    const card = inputRequestToTeamsAdaptiveCard({
      allowFreeform: true,
      options: [{ id: "approve", label: "Approve" }],
      prompt: "Approve or explain?",
      requestId: "deploy",
    });

    expect(card.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "input-freeform",
          type: "Input.Text",
        }),
      ])
    );
    expect(
      parseTeamsInputResponse({
        actionId: "input:deploy",
        value: { "input-freeform": "Needs more testing" },
      })
    ).toEqual({ requestId: "deploy", value: "Needs more testing" });
  });

  it("converts every child type, style, and header element", () => {
    const card = cardToAdaptiveCard({
      children: [
        { content: "Bold", style: "bold", type: "text" },
        { content: "Muted", style: "muted", type: "text" },
        { alt: "Logo", type: "image", url: "https://example.com/logo.png" },
        { type: "divider" },
        {
          children: [
            { id: "deny", label: "Deny", style: "danger", type: "button" },
            {
              label: "Docs",
              style: "primary",
              type: "link-button",
              url: "https://example.com",
            },
          ],
          type: "actions",
        },
        {
          children: [
            {
              id: "env",
              label: "Environment",
              optional: true,
              options: [{ label: "Prod", value: "prod" }],
              placeholder: "Pick one",
              type: "select",
            },
            {
              id: "strategy",
              label: "Strategy",
              options: [{ label: "Blue/Green", value: "bg" }],
              type: "radio_select",
            },
          ],
          type: "actions",
        },
        { children: [{ label: "Owner", value: "Ada" }], type: "fields" },
        { label: "Runbook", type: "link", url: "https://example.com/runbook" },
        { headers: ["Name", "Status"], rows: [["api", "ok"]], type: "table" },
        { children: [{ content: "Nested", type: "text" }], type: "section" },
      ],
      imageUrl: "https://example.com/banner.png",
      subtitle: "Subtitle",
      title: "Everything",
      type: "card",
    });

    expect(card.body[0]).toMatchObject({
      text: "Everything",
      weight: "Bolder",
    });
    expect(card.body[1]).toMatchObject({ isSubtle: true, text: "Subtitle" });
    expect(card.body[2]).toMatchObject({
      size: "Stretch",
      type: "Image",
      url: "https://example.com/banner.png",
    });

    expect(card.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          style: "destructive",
          title: "Deny",
          type: "Action.Submit",
        }),
        expect.objectContaining({
          style: "positive",
          title: "Docs",
          type: "Action.OpenUrl",
          url: "https://example.com",
        }),
        expect.objectContaining({
          data: { actionId: "__auto_submit" },
          title: "Submit",
        }),
      ])
    );

    expect(card.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          altText: "Logo",
          size: "Auto",
          type: "Image",
        }),
        expect.objectContaining({ separator: true, type: "Container" }),
        expect.objectContaining({
          id: "env",
          isRequired: false,
          placeholder: "Pick one",
          style: "compact",
          type: "Input.ChoiceSet",
        }),
        expect.objectContaining({
          id: "strategy",
          isRequired: true,
          style: "expanded",
          type: "Input.ChoiceSet",
        }),
        expect.objectContaining({ type: "FactSet" }),
      ])
    );
  });

  it("renders fallback text for every child type", () => {
    const text = cardToTeamsFallbackText({
      children: [
        { content: "Body", type: "text" },
        { alt: "Logo", type: "image", url: "https://example.com/logo.png" },
        { type: "image", url: "https://example.com/raw.png" },
        { type: "divider" },
        {
          children: [
            { id: "ok", label: "Approve", type: "button" },
            { label: "Docs", type: "link-button", url: "https://example.com" },
          ],
          type: "actions",
        },
        { children: [{ label: "Owner", value: "Ada" }], type: "fields" },
        { label: "Runbook", type: "link", url: "https://example.com/r" },
        { headers: ["A", "B"], rows: [["1", "2"]], type: "table" },
        { children: [{ content: "Nested", type: "text" }], type: "section" },
      ],
      subtitle: "Sub",
      title: "Title",
      type: "card",
    });

    expect(text).toContain("Title");
    expect(text).toContain("Sub");
    expect(text).toContain("Body");
    expect(text).toContain("Logo");
    expect(text).toContain("https://example.com/raw.png");
    expect(text).toContain("---");
    expect(text).toContain("Approve");
    expect(text).toContain("Owner: Ada");
    expect(text).toContain("Runbook: https://example.com/r");
    expect(text).toContain("A | B");
    expect(text).toContain("1 | 2");
    expect(text).toContain("Nested");
  });

  it("returns parse failures for unknown action ids", () => {
    expect(parseTeamsInputResponse({ actionId: "other:deploy" })).toBeNull();
    expect(parseTeamsInputResponse({})).toBeNull();
  });
});
