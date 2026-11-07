import type { CardElement, SectionLayout } from "chat";

export function layoutFallbackCard(
  layout?: SectionLayout,
  withInputs = false
): CardElement {
  return {
    type: "card",
    children: [
      {
        type: "section",
        ...(layout ? { layout } : {}),
        children: [
          {
            type: "section",
            children: [
              { type: "text", content: "First column" },
              {
                type: "section",
                children: [
                  { type: "text", content: "First details" },
                  {
                    type: "actions",
                    children: [
                      {
                        type: "button",
                        id: "approve",
                        label: "Approve",
                        value: "v1",
                      },
                      {
                        type: "link-button",
                        label: "Docs",
                        url: "https://example.com/docs",
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: "section",
            children: [
              { type: "text", content: "Second column" },
              {
                type: "link",
                label: "Details",
                url: "https://example.com/details",
              },
              ...(withInputs
                ? [
                    {
                      type: "actions" as const,
                      children: [
                        {
                          type: "select" as const,
                          id: "priority",
                          label: "Priority",
                          options: [
                            { label: "High", value: "high" },
                            { label: "Low", value: "low" },
                          ],
                          initialOption: "low",
                        },
                        {
                          type: "radio_select" as const,
                          id: "region",
                          label: "Region",
                          options: [{ label: "US", value: "us" }],
                          initialOption: "us",
                        },
                      ],
                    },
                  ]
                : []),
            ],
          },
        ],
      },
    ],
  };
}
