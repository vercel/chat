import type { CardElement } from "chat";
import { describe, expect, it } from "vitest";
import { cardToXChat } from "./cards";

function card(overrides: Partial<CardElement>): CardElement {
  return { type: "card", children: [], ...overrides };
}

describe("cardToXChat", () => {
  it("renders title unwrapped and body text", () => {
    const result = cardToXChat(
      card({
        title: "Deploy ready",
        subtitle: "build 42",
        children: [{ type: "text", content: "All checks passed." }],
      })
    );

    expect(result.text).toBe("Deploy ready\nbuild 42\nAll checks passed.");
    expect(result.urlCard).toBeUndefined();
  });

  it("appends action link-buttons as label: url lines and uses the first as the preview card", () => {
    const result = cardToXChat(
      card({
        title: "Deploy ready",
        children: [
          { type: "text", content: "All checks passed." },
          {
            type: "actions",
            children: [
              {
                type: "link-button",
                label: "View logs",
                url: "https://ci.example.com/logs",
              },
              {
                type: "link-button",
                label: "Dashboard",
                url: "https://ci.example.com/dash",
              },
            ],
          },
        ],
      })
    );

    expect(result.text).toBe(
      [
        "Deploy ready",
        "All checks passed.",
        "View logs: https://ci.example.com/logs",
        "Dashboard: https://ci.example.com/dash",
      ].join("\n")
    );
    expect(result.urlCard).toEqual({
      url: "https://ci.example.com/logs",
      displayTitle: "Deploy ready",
      imageUrl: undefined,
    });
  });

  it("keeps inline links in the body without duplicating them as appended lines", () => {
    const result = cardToXChat(
      card({
        children: [
          { type: "link", label: "Docs", url: "https://docs.example.com" },
        ],
      })
    );

    // The shared fallback renders inline links as `label (url)` — no extra line.
    expect(result.text).toBe("Docs (https://docs.example.com)");
    // Without a card title, the link label titles the preview card.
    expect(result.urlCard).toEqual({
      url: "https://docs.example.com",
      displayTitle: "Docs",
      imageUrl: undefined,
    });
  });

  it("collects links nested inside sections", () => {
    const result = cardToXChat(
      card({
        children: [
          {
            type: "section",
            children: [
              { type: "link", label: "Docs", url: "https://docs.example.com" },
            ],
          },
        ],
      })
    );

    expect(result.text).toBe("Docs (https://docs.example.com)");
    expect(result.urlCard?.url).toBe("https://docs.example.com");
  });

  it("omits callback buttons entirely (no XChat representation)", () => {
    const result = cardToXChat(
      card({
        title: "Confirm",
        children: [
          {
            type: "actions",
            children: [
              { type: "button", id: "approve", label: "Approve" },
              { type: "button", id: "reject", label: "Reject" },
            ],
          },
        ],
      })
    );

    expect(result.text).toBe("Confirm");
    expect(result.urlCard).toBeUndefined();
  });

  it("uses the card imageUrl as the preview banner", () => {
    const result = cardToXChat(
      card({
        title: "Release notes",
        imageUrl: "https://cdn.example.com/banner.png",
        children: [
          { type: "link", label: "Read", url: "https://example.com/notes" },
        ],
      })
    );

    expect(result.urlCard?.imageUrl).toBe("https://cdn.example.com/banner.png");
  });

  it("falls back to the first image child for the preview banner", () => {
    const result = cardToXChat(
      card({
        children: [
          { type: "image", url: "https://cdn.example.com/chart.png" },
          { type: "link", label: "Report", url: "https://example.com/report" },
        ],
      })
    );

    expect(result.urlCard?.imageUrl).toBe("https://cdn.example.com/chart.png");
  });
});
