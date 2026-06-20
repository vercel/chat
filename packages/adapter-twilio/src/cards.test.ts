import { describe, expect, it } from "vitest";
import { cardToTwilioText } from "./cards";

describe("cardToTwilioText", () => {
  it("renders cards as plain SMS fallback text", () => {
    const card = {
      children: [
        {
          children: [
            { content: "Approve production deploy?", type: "text" as const },
            {
              children: [
                {
                  label: "version",
                  type: "field" as const,
                  value: "1.2.3",
                },
              ],
              type: "fields" as const,
            },
          ],
          type: "section" as const,
        },
        {
          children: [
            { id: "approve", label: "Approve", type: "button" as const },
          ],
          type: "actions" as const,
        },
      ],
      title: "Deploy",
      type: "card" as const,
    };

    expect(cardToTwilioText(card)).toContain("Deploy");
    expect(cardToTwilioText(card)).toContain("Approve production deploy?");
    expect(cardToTwilioText(card)).toContain("version: 1.2.3");
    expect(cardToTwilioText(card)).not.toContain("[Approve]");
  });
});
