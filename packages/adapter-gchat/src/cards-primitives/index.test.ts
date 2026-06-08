import { describe, expect, it } from "vitest";
import {
  cardToGoogleChatCard,
  cardToGoogleChatFallbackText,
  GOOGLE_CHAT_FREEFORM_INPUT_ID,
  inputRequestToGoogleChatCard,
  parseGoogleChatInputResponse,
} from ".";

describe("Google Chat card primitives", () => {
  it("converts plain-object cards to Card v2", () => {
    const card = cardToGoogleChatCard(
      {
        children: [
          { text: "Hello", type: "text" },
          {
            children: [
              { actionId: "approve", label: "Approve", type: "button" },
              { label: "Docs", type: "button", url: "https://example.com" },
            ],
            type: "actions",
          },
        ],
        subtitle: "Subtitle",
        title: "Title",
      },
      { cardId: "card-1" }
    );

    expect(card).toMatchObject({
      card: {
        header: { subtitle: "Subtitle", title: "Title" },
        sections: [
          {
            widgets: [
              { textParagraph: { text: "Hello" } },
              {
                buttonList: {
                  buttons: [
                    {
                      onClick: {
                        action: {
                          function: "approve",
                          parameters: [{ key: "actionId", value: "approve" }],
                        },
                      },
                      text: "Approve",
                    },
                    {
                      onClick: { openLink: { url: "https://example.com" } },
                      text: "Docs",
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      cardId: "card-1",
    });
  });

  it("creates fallback text", () => {
    expect(
      cardToGoogleChatFallbackText({
        children: [{ text: "Body", type: "text" }],
        title: "Title",
      })
    ).toBe("Title\nBody");
  });

  it("uses defaultFunction as a handler name only when actionId is missing", () => {
    const card = cardToGoogleChatCard(
      {
        children: [
          {
            children: [
              { label: "Fallback", type: "button" },
              { actionId: "approve", label: "Approve", type: "button" },
            ],
            type: "actions",
          },
        ],
      },
      { defaultFunction: "handleCardAction" }
    );

    expect(
      card.card.sections[0]?.widgets[0]?.buttonList?.buttons.map(
        (button) => button.onClick.action?.function
      )
    ).toEqual(["handleCardAction", "approve"]);
  });

  it("builds and parses select input requests", () => {
    const card = inputRequestToGoogleChatCard({
      options: [{ label: "Yes", value: "yes" }],
      prompt: "Choose",
      requestId: "request-1",
    });

    expect(card.card.sections[0]?.widgets).toContainEqual(
      expect.objectContaining({
        selectionInput: expect.objectContaining({ name: "request-1" }),
      })
    );
    expect(
      parseGoogleChatInputResponse({
        commonEventObject: {
          formInputs: {
            "request-1": { stringInputs: { value: ["yes"] } },
          },
          invokedFunction: "request-1",
          parameters: { requestId: "request-1" },
        },
      })
    ).toEqual({ requestId: "request-1", value: "yes" });
  });

  it("parses freeform input requests", () => {
    expect(
      parseGoogleChatInputResponse({
        commonEventObject: {
          formInputs: {
            [GOOGLE_CHAT_FREEFORM_INPUT_ID]: {
              stringInputs: { value: ["typed value"] },
            },
          },
          invokedFunction: "request-1",
          parameters: { requestId: "request-1" },
        },
      })
    ).toEqual({ requestId: "request-1", value: "typed value" });
  });
});
