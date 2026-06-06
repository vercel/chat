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
});
