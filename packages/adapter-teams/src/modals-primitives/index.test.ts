import { describe, expect, it } from "vitest";
import {
  modalToAdaptiveCard,
  parseTeamsDialogSubmitValues,
  toTeamsTaskModuleResponse,
} from "./index";

const modal = {
  callbackId: "deploy-modal",
  children: [
    { content: "Deploy?", style: "bold", type: "text" },
    {
      id: "reason",
      label: "Reason",
      placeholder: "Why?",
      type: "text_input",
    },
  ],
  title: "Deploy",
  type: "modal",
} as const;

describe("Teams modal primitives", () => {
  it("converts modal objects to Adaptive Cards", () => {
    expect(modalToAdaptiveCard(modal, { contextId: "ctx" })).toMatchObject({
      actions: [
        {
          data: {
            __callbackId: "deploy-modal",
            __contextId: "ctx",
          },
          title: "Submit",
          type: "Action.Submit",
        },
      ],
      body: [
        { text: "Deploy?", type: "TextBlock", weight: "Bolder" },
        { id: "reason", label: "Reason", type: "Input.Text" },
      ],
      type: "AdaptiveCard",
    });
  });

  it("parses dialog submit values", () => {
    expect(
      parseTeamsDialogSubmitValues({
        __callbackId: "cb",
        __contextId: "ctx",
        msteams: {},
        reason: "approved",
      })
    ).toEqual({
      callbackId: "cb",
      contextId: "ctx",
      values: { reason: "approved" },
    });
  });

  it("creates task module responses", () => {
    expect(
      toTeamsTaskModuleResponse(
        { action: "update", modal },
        { contextId: "ctx" }
      )
    ).toMatchObject({
      task: {
        type: "continue",
        value: {
          card: { contentType: "application/vnd.microsoft.card.adaptive" },
          title: "Deploy",
        },
      },
    });
    expect(toTeamsTaskModuleResponse({ action: "close" })).toBeUndefined();
  });

  it("renders validation errors as a continue response", () => {
    expect(
      toTeamsTaskModuleResponse({
        action: "errors",
        errors: { reason: "Required" },
      })
    ).toMatchObject({
      task: {
        value: {
          card: {
            content: {
              body: expect.arrayContaining([
                expect.objectContaining({ text: "**reason**: Required" }),
              ]),
            },
          },
          title: "Validation Error",
        },
      },
    });
  });
});
