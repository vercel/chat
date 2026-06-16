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

  it("converts every modal child type with options and styles", () => {
    expect(
      modalToAdaptiveCard(
        {
          callbackId: "cb",
          children: [
            { content: "Muted", style: "muted", type: "text" },
            { children: [{ label: "Owner", value: "Ada" }], type: "fields" },
            {
              id: "summary",
              initialValue: "init",
              label: "Summary",
              maxLength: 200,
              multiline: true,
              placeholder: "Describe",
              type: "text_input",
            },
            {
              id: "env",
              initialOption: "prod",
              label: "Env",
              optional: true,
              options: [{ label: "Prod", value: "prod" }],
              placeholder: "Pick",
              type: "select",
            },
            {
              id: "strategy",
              label: "Strategy",
              options: [{ label: "BG", value: "bg" }],
              type: "radio_select",
            },
          ],
          submitLabel: "Go",
          title: "All",
          type: "modal",
        },
        {}
      )
    ).toMatchObject({
      actions: [
        expect.objectContaining({ data: { __callbackId: "cb" }, title: "Go" }),
      ],
      body: expect.arrayContaining([
        expect.objectContaining({ isSubtle: true, text: "Muted" }),
        expect.objectContaining({ type: "FactSet" }),
        expect.objectContaining({
          id: "summary",
          isMultiline: true,
          isRequired: true,
          maxLength: 200,
          placeholder: "Describe",
          type: "Input.Text",
          value: "init",
        }),
        expect.objectContaining({
          id: "env",
          isRequired: false,
          placeholder: "Pick",
          style: "compact",
          type: "Input.ChoiceSet",
          value: "prod",
        }),
        expect.objectContaining({
          id: "strategy",
          isRequired: true,
          style: "expanded",
          type: "Input.ChoiceSet",
        }),
      ]),
    });
  });

  it("prefers the callbackId option over the modal callbackId", () => {
    expect(
      modalToAdaptiveCard(modal, { callbackId: "override" })
    ).toMatchObject({
      actions: [
        expect.objectContaining({ data: { __callbackId: "override" } }),
      ],
    });
  });

  it("returns empty submit values when data is missing", () => {
    expect(parseTeamsDialogSubmitValues(undefined)).toEqual({
      callbackId: undefined,
      contextId: undefined,
      values: {},
    });
  });

  it("ignores non-string submit values", () => {
    expect(parseTeamsDialogSubmitValues({ count: 5, note: "ok" })).toEqual({
      callbackId: undefined,
      contextId: undefined,
      values: { note: "ok" },
    });
  });

  it("creates continue responses for push actions", () => {
    expect(toTeamsTaskModuleResponse({ action: "push", modal })).toMatchObject({
      task: { type: "continue", value: { title: "Deploy" } },
    });
  });

  it("returns undefined when there is no response", () => {
    expect(toTeamsTaskModuleResponse(undefined)).toBeUndefined();
  });
});
