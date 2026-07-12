import { describe, expect, it } from "vitest";
import {
  answeredSlackInputBlocks,
  buildSlackFreeformView,
  cardToBlockKit,
  cardToFallbackText,
  cardToSlackBlocks,
  cardToSlackFallbackText,
  convertSlackEmojiPlaceholders,
  inputRequestToSlackBlocks,
  parseSlackFreeformValue,
  parseSlackInputResponse,
  type SlackCardElement,
} from "./index";

function card(children: SlackCardElement["children"] = []): SlackCardElement {
  return {
    children,
    type: "card",
  };
}

describe("Slack Block Kit primitives", () => {
  it("converts card headers and context", () => {
    expect(
      cardToSlackBlocks({
        children: [],
        imageUrl: "https://example.com/image.png",
        subtitle: "Status changed",
        title: "Order",
        type: "card",
      })
    ).toEqual([
      {
        text: { emoji: true, text: "Order", type: "plain_text" },
        type: "header",
      },
      {
        elements: [{ text: "Status changed", type: "mrkdwn" }],
        type: "context",
      },
      {
        alt_text: "Order",
        image_url: "https://example.com/image.png",
        type: "image",
      },
    ]);
  });

  it("truncates header text to Slack's header block limit", () => {
    const title = "a".repeat(200);

    expect(cardToSlackBlocks({ children: [], title, type: "card" })[0]).toEqual(
      {
        text: { emoji: true, text: "a".repeat(150), type: "plain_text" },
        type: "header",
      }
    );
  });

  it("truncates image URLs to Slack's image block limit", () => {
    const longUrl = `https://example.com/${"a".repeat(4000)}`;
    const topBlocks = cardToSlackBlocks({
      children: [],
      imageUrl: longUrl,
      title: "{{emoji:frame}}",
      type: "card",
    });

    expect(topBlocks[0]).toEqual({
      text: { emoji: true, text: ":frame:", type: "plain_text" },
      type: "header",
    });
    expect(topBlocks[1]).toEqual({
      alt_text: ":frame:",
      image_url: `https://example.com/${"a".repeat(2980)}`,
      type: "image",
    });
    expect(
      cardToSlackBlocks({
        children: [{ type: "image", url: longUrl }],
        type: "card",
      })[0]
    ).toEqual({
      alt_text: "Image",
      image_url: `https://example.com/${"a".repeat(2980)}`,
      type: "image",
    });
  });

  it("converts text and links", () => {
    expect(
      cardToSlackBlocks(
        card([
          { content: "plain", type: "text" },
          { content: "bold", style: "bold", type: "text" },
          { content: "muted", style: "muted", type: "text" },
          { label: "Docs", type: "link", url: "https://example.com" },
        ])
      )
    ).toEqual([
      { text: { text: "plain", type: "mrkdwn" }, type: "section" },
      { text: { text: "*bold*", type: "mrkdwn" }, type: "section" },
      { elements: [{ text: "muted", type: "mrkdwn" }], type: "context" },
      {
        text: { text: "<https://example.com|Docs>", type: "mrkdwn" },
        type: "section",
      },
    ]);
  });

  it("converts actions", () => {
    const blocks = cardToSlackBlocks(
      card([
        {
          children: [
            {
              id: "approve",
              label: "Approve",
              style: "primary",
              type: "button",
            },
            {
              id: "agent_slack_auth_signin",
              label: "Docs",
              style: "default",
              type: "link-button",
              url: "https://example.com/docs",
            },
            {
              id: "status",
              label: "Status",
              options: [
                { label: "Open", value: "open" },
                { label: "Closed", value: "closed" },
              ],
              placeholder: "Choose",
              type: "select",
            },
            {
              id: "plan",
              label: "Plan",
              options: [
                { description: "For teams", label: "Pro", value: "pro" },
              ],
              type: "radio_select",
            },
          ],
          type: "actions",
        },
      ])
    );

    expect(blocks[0]).toMatchObject({
      elements: [
        {
          action_id: "approve",
          style: "primary",
          text: { emoji: true, text: "Approve", type: "plain_text" },
          type: "button",
        },
        {
          action_id: "agent_slack_auth_signin",
          text: { emoji: true, text: "Docs", type: "plain_text" },
          type: "button",
          url: "https://example.com/docs",
        },
        {
          action_id: "status",
          options: [
            { text: { text: "Open", type: "plain_text" }, value: "open" },
            { text: { text: "Closed", type: "plain_text" }, value: "closed" },
          ],
          placeholder: { emoji: true, text: "Choose", type: "plain_text" },
          type: "static_select",
        },
        {
          action_id: "plan",
          options: [
            {
              description: { text: "For teams", type: "mrkdwn" },
              text: { text: "Pro", type: "mrkdwn" },
              value: "pro",
            },
          ],
          type: "radio_buttons",
        },
      ],
      type: "actions",
    });
  });

  it("limits action elements and select options to Slack limits", () => {
    const blocks = cardToSlackBlocks(
      card([
        {
          children: Array.from({ length: 30 }, (_, index) => ({
            id: `b${index}`,
            label: `Button ${index}`,
            type: "button" as const,
          })),
          type: "actions",
        },
        {
          children: [
            {
              id: "select",
              label: "Select",
              options: Array.from({ length: 120 }, (_, index) => ({
                label: `Option ${index}`,
                value: `value-${index}`,
              })),
              type: "select",
            },
          ],
          type: "actions",
        },
      ])
    );

    expect((blocks[0].elements as unknown[]).length).toBe(25);
    expect(
      (blocks[1].elements as Array<{ options: unknown[] }>)[0].options.length
    ).toBe(100);
  });

  it("truncates option values to Slack's option object limit", () => {
    const [block] = cardToSlackBlocks(
      card([
        {
          children: [
            {
              id: "select",
              label: "Select",
              options: [{ label: "Option", value: "v".repeat(200) }],
              type: "select",
            },
          ],
          type: "actions",
        },
      ])
    );

    expect(
      (block.elements as Array<{ options: Array<{ value: string }> }>)[0]
        .options[0].value
    ).toBe("v".repeat(150));
  });

  it("matches truncated initial options for select elements", () => {
    const longValue = "v".repeat(200);
    const [block] = cardToSlackBlocks(
      card([
        {
          children: [
            {
              id: "select",
              initialOption: longValue,
              label: "Select",
              options: [{ label: "Option", value: longValue }],
              type: "select",
            },
            {
              id: "radio",
              initialOption: longValue,
              label: "Radio",
              options: [{ label: "Option", value: longValue }],
              type: "radio_select",
            },
          ],
          type: "actions",
        },
      ])
    );

    expect(
      (
        block.elements as Array<{
          initial_option: { value: string };
        }>
      )[0].initial_option.value
    ).toBe("v".repeat(150));
    expect(
      (
        block.elements as Array<{
          initial_option: { value: string };
        }>
      )[1].initial_option.value
    ).toBe("v".repeat(150));
  });

  it("omits initial options when no initial value is provided", () => {
    const [block] = cardToSlackBlocks(
      card([
        {
          children: [
            {
              id: "select",
              label: "Select",
              options: [{ label: "Option", value: "" }],
              type: "select",
            },
          ],
          type: "actions",
        },
      ])
    );

    expect(
      (block.elements as Array<{ initial_option?: unknown }>)[0].initial_option
    ).toBeUndefined();
  });

  it("converts fields and tables", () => {
    const blocks = cardToSlackBlocks(
      card([
        {
          children: [
            { label: "Name", type: "field", value: "Ada" },
            { label: "Role", type: "field", value: "Engineer" },
          ],
          type: "fields",
        },
        {
          align: ["left", "right"],
          headers: ["Name", "Score"],
          rows: [["Ada", "10"]],
          type: "table",
        },
      ])
    );

    expect(blocks[0]).toEqual({
      fields: [
        { text: "*Name*\nAda", type: "mrkdwn" },
        { text: "*Role*\nEngineer", type: "mrkdwn" },
      ],
      type: "section",
    });
    expect(blocks[1]).toEqual({
      caption: "Table",
      rows: [
        [
          { text: "Name", type: "raw_text" },
          { text: "Score", type: "raw_text" },
        ],
        [
          { text: "Ada", type: "raw_text" },
          { text: "10", type: "raw_text" },
        ],
      ],
      type: "data_table",
    });
  });

  it("passes table caption and clamped page_size through", () => {
    const blocks = cardToSlackBlocks(
      card([
        {
          caption: "Scores",
          headers: ["Name"],
          pageSize: 0,
          rows: [["Ada"]],
          type: "table",
        },
      ])
    );

    expect(blocks[0]).toEqual({
      caption: "Scores",
      page_size: 1,
      rows: [
        [{ text: "Name", type: "raw_text" }],
        [{ text: "Ada", type: "raw_text" }],
      ],
      type: "data_table",
    });
  });

  it("renders header-only tables as a plain table block", () => {
    const blocks = cardToSlackBlocks(
      card([
        {
          align: ["left"],
          headers: ["Name"],
          rows: [],
          type: "table",
        },
      ])
    );

    expect(blocks[0]).toEqual({
      column_settings: [{ align: "left" }],
      rows: [[{ text: "Name", type: "raw_text" }]],
      type: "table",
    });
  });

  it("falls back to ASCII when combined table cells exceed the character limit", () => {
    const bigCell = "x".repeat(10_001);
    const blocks = cardToSlackBlocks(
      card([{ headers: ["A"], rows: [[bigCell]], type: "table" }])
    );

    expect(blocks[0].type).toBe("section");
    const text = (blocks[0] as { text: { text: string } }).text.text;
    expect(text.length).toBeLessThanOrEqual(3000);
    // Closing code fence survives truncation
    expect(text.endsWith("\n```")).toBe(true);
  });

  it("converts pie charts to data_visualization blocks", () => {
    const blocks = cardToSlackBlocks(
      card([
        {
          chart: {
            segments: [
              { label: "Kit Kat", value: 45 },
              { label: "Twix", value: 28 },
            ],
            type: "pie",
          },
          title: "Candy Bars",
          type: "chart",
        },
      ])
    );

    expect(blocks[0]).toEqual({
      chart: {
        segments: [
          { label: "Kit Kat", value: 45 },
          { label: "Twix", value: 28 },
        ],
        type: "pie",
      },
      title: "Candy Bars",
      type: "data_visualization",
    });
  });

  it("converts series charts with axis config and normalized point order", () => {
    const blocks = cardToSlackBlocks(
      card([
        {
          chart: {
            categories: ["Mon", "Tue"],
            series: [
              {
                data: [
                  { label: "Tue", value: 60 },
                  { label: "Mon", value: 50 },
                ],
                name: "Mobile",
              },
            ],
            type: "line",
            xLabel: "Day",
            yLabel: "Users",
          },
          title: "DAU",
          type: "chart",
        },
      ])
    );

    expect(blocks[0]).toEqual({
      chart: {
        axis_config: {
          categories: ["Mon", "Tue"],
          x_label: "Day",
          y_label: "Users",
        },
        series: [
          {
            data: [
              { label: "Mon", value: 50 },
              { label: "Tue", value: 60 },
            ],
            name: "Mobile",
          },
        ],
        type: "line",
      },
      title: "DAU",
      type: "data_visualization",
    });
  });

  it("falls back to a text section for invalid charts", () => {
    const blocks = cardToSlackBlocks(
      card([
        {
          chart: {
            segments: [{ label: "Zero", value: 0 }],
            type: "pie",
          },
          title: "Bad Pie",
          type: "chart",
        },
      ])
    );

    expect(blocks[0].type).toBe("section");
    expect((blocks[0] as { text: { text: string } }).text.text).toContain(
      "Bad Pie"
    );
  });

  it("falls back to a text section from the third chart in one message", () => {
    const pie = (title: string) => ({
      chart: {
        segments: [{ label: "A", value: 1 }],
        type: "pie" as const,
      },
      title,
      type: "chart" as const,
    });
    const blocks = cardToSlackBlocks(
      card([pie("One"), pie("Two"), pie("Three")])
    );

    expect(blocks.map((b) => b.type)).toEqual([
      "data_visualization",
      "data_visualization",
      "section",
    ]);
  });

  it("includes chart data in Slack fallback text", () => {
    const text = cardToSlackFallbackText(
      card([
        {
          chart: {
            segments: [{ label: "Kit Kat", value: 45 }],
            type: "pie",
          },
          title: "Candy Bars",
          type: "chart",
        },
      ])
    );

    expect(text).toContain("Candy Bars");
    expect(text).toContain("Kit Kat");
  });

  it("falls back to ASCII tables after one native table", () => {
    const table = {
      headers: ["A", "B"],
      rows: [["1", "2"]],
      type: "table" as const,
    };

    expect(cardToSlackBlocks(card([table, table]))[1]).toEqual({
      text: { text: "```\nA | B\n1 | 2\n```", type: "mrkdwn" },
      type: "section",
    });
  });

  it("generates Slack fallback text", () => {
    expect(
      cardToSlackFallbackText({
        children: [
          { content: "Hello", type: "text" },
          {
            children: [{ label: "Status", type: "field", value: "Ready" }],
            type: "fields",
          },
          {
            children: [{ id: "ok", label: "OK", type: "button" }],
            type: "actions",
          },
        ],
        subtitle: "Sub",
        title: "Title",
        type: "card",
      })
    ).toBe("*Title*\nSub\nHello\nStatus: Ready");
  });

  it("keeps compatibility aliases", () => {
    const input = card([{ content: "hello", type: "text" }]);

    expect(cardToBlockKit(input)).toEqual(cardToSlackBlocks(input));
    expect(cardToFallbackText(input)).toBe(cardToSlackFallbackText(input));
  });

  it("supports custom emoji conversion", () => {
    const input = card([{ content: "{{emoji:thumbs_up}}", type: "text" }]);

    expect(cardToSlackBlocks(input)[0]).toEqual({
      text: { text: ":thumbs_up:", type: "mrkdwn" },
      type: "section",
    });
    expect(cardToSlackBlocks(input, { convertEmoji: () => ":+1:" })[0]).toEqual(
      {
        text: { text: ":+1:", type: "mrkdwn" },
        type: "section",
      }
    );
    expect(convertSlackEmojiPlaceholders("hi {{emoji:wave}}")).toBe(
      "hi :wave:"
    );
  });

  it("renders input requests as Slack buttons", () => {
    expect(
      inputRequestToSlackBlocks({
        options: [
          { id: "approve", label: "Approve", style: "primary" },
          { id: "deny", label: "Deny", style: "danger" },
        ],
        prompt: "Approve deploy?",
        requestId: "req-1",
      })
    ).toEqual([
      {
        text: { text: "Approve deploy?", type: "mrkdwn" },
        type: "section",
      },
      {
        elements: [
          {
            action_id: "input:req-1:button:0",
            style: "primary",
            text: { text: "Approve", type: "plain_text" },
            type: "button",
            value: "approve",
          },
          {
            action_id: "input:req-1:button:1",
            style: "danger",
            text: { text: "Deny", type: "plain_text" },
            type: "button",
            value: "deny",
          },
        ],
        type: "actions",
      },
    ]);
  });

  it("renders input requests as selects", () => {
    expect(
      inputRequestToSlackBlocks({
        display: "select",
        options: [{ id: "one", label: "One" }],
        prompt: "Pick one",
        requestId: "req-1",
      })[1]
    ).toEqual({
      elements: [
        {
          action_id: "input:req-1",
          options: [
            {
              text: { text: "One", type: "plain_text" },
              value: "one",
            },
          ],
          placeholder: { text: "Choose an option", type: "plain_text" },
          type: "static_select",
        },
      ],
      type: "actions",
    });
  });

  it("renders input requests as radios", () => {
    expect(
      inputRequestToSlackBlocks({
        display: "radio",
        options: [{ id: "one", label: "One" }],
        prompt: "Pick one",
        requestId: "req-1",
      })[1]
    ).toEqual({
      elements: [
        {
          action_id: "input:req-1",
          options: [
            {
              text: { text: "One", type: "plain_text" },
              value: "one",
            },
          ],
          type: "radio_buttons",
        },
      ],
      type: "actions",
    });
  });

  it("renders freeform alongside options when allowed", () => {
    expect(
      inputRequestToSlackBlocks({
        allowFreeform: true,
        options: [{ id: "approve", label: "Approve" }],
        prompt: "Approve deploy?",
        requestId: "req-1",
      })[1]
    ).toEqual({
      elements: [
        {
          action_id: "input:req-1:button:0",
          text: { text: "Approve", type: "plain_text" },
          type: "button",
          value: "approve",
        },
        {
          action_id: "input-freeform:req-1",
          style: "primary",
          text: { text: "Type your answer", type: "plain_text" },
          type: "button",
          value: "req-1",
        },
      ],
      type: "actions",
    });
  });

  it("renders and reads freeform input modals", () => {
    const view = buildSlackFreeformView({
      metadata: { requestId: "req-1" },
      prompt: "Tell me why",
    });

    expect(view).toMatchObject({
      callback_id: "input-freeform-submit",
      private_metadata: '{"requestId":"req-1"}',
      title: { text: "Tell me why", type: "plain_text" },
      type: "modal",
    });
    expect(
      parseSlackFreeformValue([
        {
          actionId: "input-freeform-text",
          blockId: "input-freeform-block",
          value: "because",
        },
      ])
    ).toBe("because");
  });

  it("parses input actions and answered blocks", () => {
    expect(
      parseSlackInputResponse({
        actionId: "input:req-1:button:0",
        value: "approve",
      })
    ).toEqual({ optionId: "approve", requestId: "req-1" });
    expect(
      parseSlackInputResponse({
        actionId: "input:req-2",
        selectedOptionValue: "later",
      })
    ).toEqual({ optionId: "later", requestId: "req-2" });
    expect(
      answeredSlackInputBlocks({
        answer: "Approve",
        userId: "U123",
      })
    ).toEqual([
      {
        text: { text: ":white_check_mark: *Approve*", type: "mrkdwn" },
        type: "section",
      },
      {
        elements: [{ text: "Answered by <@U123>", type: "mrkdwn" }],
        type: "context",
      },
    ]);
  });
});
