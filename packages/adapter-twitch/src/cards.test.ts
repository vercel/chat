import { describe, expect, it } from "vitest";
import { cardToTwitchText } from "./cards";

describe("cardToTwitchText", () => {
  it("renders titles, text, fields, and link buttons", () => {
    expect(
      cardToTwitchText({
        children: [
          { content: "Pick a game", type: "text" },
          { type: "divider" },
          {
            children: [
              { label: "Game", type: "field", value: "Celeste" },
              { label: "Votes", type: "field", value: "42" },
            ],
            type: "fields",
          },
          {
            children: [
              { id: "vote", label: "Vote", type: "button" },
              {
                label: "Results",
                type: "link-button",
                url: "https://example.com/r",
              },
            ],
            type: "actions",
          },
          { label: "Rules", type: "link", url: "https://example.com/rules" },
          {
            alt: "banner",
            type: "image",
            url: "https://example.com/banner.png",
          },
        ],
        subtitle: "Community night",
        title: "Poll",
        type: "card",
      })
    ).toBe(
      [
        "Poll",
        "Community night",
        "Pick a game",
        "Game: Celeste",
        "Votes: 42",
        "Results: https://example.com/r",
        "Rules: https://example.com/rules",
        "https://example.com/banner.png",
      ].join(" · ")
    );
  });

  it("flattens sections and drops callback-only action rows", () => {
    expect(
      cardToTwitchText({
        children: [
          {
            children: [{ content: "Inside", type: "text" }],
            type: "section",
          },
          {
            children: [{ id: "a", label: "A", type: "button" }],
            type: "actions",
          },
        ],
        type: "card",
      })
    ).toBe("Inside");
  });
});
