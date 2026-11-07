import { describe, expect, it } from "vitest";
import {
  cardToSlackBlocks,
  type SlackCardChild,
  type SlackCardElement,
} from "./index";

const text = (content: string): SlackCardChild => ({ type: "text", content });
const section = (children: SlackCardChild[]): SlackCardChild => ({
  type: "section",
  children,
});
const card = (children: SlackCardChild[]): SlackCardElement => ({
  type: "card",
  children,
});

describe("portable Slack layouts", () => {
  it("renders simple columns with stable-client fallbacks", () => {
    const output = cardToSlackBlocks(
      card([
        {
          type: "section",
          layout: "columns",
          children: [section([text("One")]), section([text("Two")])],
        },
      ])
    );
    expect(output).toEqual([
      {
        type: "layout",
        label: "Columns",
        rows: [
          {
            items: [
              {
                block: {
                  type: "section",
                  text: { type: "mrkdwn", text: "One" },
                },
              },
              {
                block: {
                  type: "section",
                  text: { type: "mrkdwn", text: "Two" },
                },
              },
            ],
          },
        ],
        fallback: [
          { type: "section", text: { type: "mrkdwn", text: "One" } },
          { type: "section", text: { type: "mrkdwn", text: "Two" } },
        ],
      },
    ]);
  });

  it("falls back when column wrappers exceed the native block budget", () => {
    const columns: SlackCardChild = {
      type: "section",
      layout: "columns",
      children: [section([text("One")]), section([text("Two")])],
    };
    const prefix = Array.from({ length: 48 }, () => text("Prefix"));
    const output = cardToSlackBlocks(card([...prefix, columns]));
    expect(output).toHaveLength(50);
    expect(output.some((block) => block.type === "layout")).toBe(false);
    expect(output.slice(-2)).toMatchObject([
      { text: { text: "One" } },
      { text: { text: "Two" } },
    ]);
  });

  it("keeps complex columns vertical instead of dropping content or controls", () => {
    const children: SlackCardChild[] = [
      section([
        text("Title"),
        {
          type: "actions",
          children: [
            {
              type: "button",
              id: "approve",
              label: "Approve",
              value: "project-1",
            },
          ],
        },
      ]),
      section([text("Other")]),
    ];
    expect(
      cardToSlackBlocks(
        card([{ type: "section", layout: "columns", children }])
      )
    ).toEqual(cardToSlackBlocks(card(children)));
    expect(JSON.stringify(cardToSlackBlocks(card(children)))).toContain(
      '"action_id":"approve"'
    );
  });

  it("renders eligible carousel cards and preserves action routing", () => {
    const output = cardToSlackBlocks(
      card([
        {
          type: "section",
          layout: "carousel",
          children: [
            section([
              { type: "text", content: "Project", style: "bold" },
              text("Ready to deploy"),
              {
                type: "actions",
                children: [
                  {
                    type: "button",
                    id: "deploy",
                    label: "Deploy",
                    value: "project-1",
                  },
                ],
              },
            ]),
          ],
        },
      ])
    );
    expect(output).toMatchObject([
      {
        type: "carousel",
        elements: [
          {
            type: "card",
            title: { text: "*Project*", type: "mrkdwn" },
            body: { text: "Ready to deploy", type: "mrkdwn" },
            actions: [
              { action_id: "deploy", value: "project-1", type: "button" },
            ],
          },
        ],
      },
    ]);
  });

  it("falls back for overlong or complex carousel cards", () => {
    for (const children of [
      [section([text("x".repeat(201))])],
      [section([text("One"), text("Two")])],
      Array.from({ length: 11 }, () => section([text("Item")])),
    ]) {
      expect(
        cardToSlackBlocks(
          card([{ type: "section", layout: "carousel", children }])
        )
      ).toEqual(cardToSlackBlocks(card(children)));
    }
  });
});
