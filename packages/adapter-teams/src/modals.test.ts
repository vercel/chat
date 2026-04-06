import {
  CardText,
  Field,
  Fields,
  Modal,
  RadioSelect,
  Select,
  SelectOption,
  TextInput,
} from "chat";
import type {
  ModalElement,
  ModalCloseResponse,
  ModalErrorsResponse,
  ModalPushResponse,
  ModalUpdateResponse,
} from "chat";
import { describe, expect, it, vi } from "vitest";
import {
  modalResponseToTaskModuleResponse,
  modalToAdaptiveCard,
  parseDialogSubmitValues,
} from "./modals";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeModal(overrides: Partial<ModalElement> = {}): ModalElement {
  return Modal({
    callbackId: "cb-1",
    title: "Test Modal",
    ...overrides,
    children: overrides.children ?? [],
  });
}

// ---------------------------------------------------------------------------
// modalToAdaptiveCard
// ---------------------------------------------------------------------------

describe("modalToAdaptiveCard", () => {
  it("produces a valid Adaptive Card structure", () => {
    const card = modalToAdaptiveCard(makeModal(), "ctx-1", "cb-1");

    expect(card.type).toBe("AdaptiveCard");
    expect(card.$schema).toBe(
      "http://adaptivecards.io/schemas/adaptive-card.json"
    );
    expect(card.version).toBe("1.4");
    expect(card.body).toBeInstanceOf(Array);
  });

  it("includes contextId and callbackId in submit action data", () => {
    const card = modalToAdaptiveCard(makeModal(), "ctx-1", "cb-1");

    expect(card.actions).toHaveLength(1);
    const action = card.actions[0] as { data: Record<string, unknown> };
    expect(action.data.__contextId).toBe("ctx-1");
    expect(action.data.__callbackId).toBe("cb-1");
  });

  it("uses custom submitLabel when provided", () => {
    const modal = makeModal({ submitLabel: "Send it" });
    const card = modalToAdaptiveCard(modal, "ctx-1", "cb-1");

    const action = card.actions[0] as { title: string };
    expect(action.title).toBe("Send it");
  });

  it("defaults submitLabel to 'Submit'", () => {
    const card = modalToAdaptiveCard(makeModal(), "ctx-1", "cb-1");

    const action = card.actions[0] as { title: string };
    expect(action.title).toBe("Submit");
  });
});

// ---------------------------------------------------------------------------
// Child element conversion (through modalToAdaptiveCard)
// ---------------------------------------------------------------------------

describe("modal child element conversion", () => {
  it("converts text_input to TextInput", () => {
    const modal = makeModal({
      children: [
        TextInput({
          id: "name",
          label: "Your Name",
          placeholder: "Enter name",
        }),
      ],
    });
    const card = modalToAdaptiveCard(modal, "ctx", "cb");

    expect(card.body).toHaveLength(1);
    expect(card.body[0]).toMatchObject({
      type: "Input.Text",
      id: "name",
      label: "Your Name",
      placeholder: "Enter name",
      isRequired: true,
      isMultiline: false,
    });
  });

  it("converts select to ChoiceSetInput with compact style", () => {
    const modal = makeModal({
      children: [
        Select({
          id: "color",
          label: "Favorite Color",
          options: [
            SelectOption({ label: "Red", value: "red" }),
            SelectOption({ label: "Blue", value: "blue" }),
          ],
        }),
      ],
    });
    const card = modalToAdaptiveCard(modal, "ctx", "cb");

    expect(card.body).toHaveLength(1);
    expect(card.body[0]).toMatchObject({
      type: "Input.ChoiceSet",
      id: "color",
      label: "Favorite Color",
      style: "compact",
      isRequired: true,
    });
    const choiceSet = card.body[0] as { choices: { title: string; value: string }[] };
    expect(choiceSet.choices).toHaveLength(2);
    expect(choiceSet.choices[0]).toMatchObject({ title: "Red", value: "red" });
  });

  it("converts radio_select to ChoiceSetInput with expanded style", () => {
    const modal = makeModal({
      children: [
        RadioSelect({
          id: "size",
          label: "Size",
          options: [
            SelectOption({ label: "Small", value: "sm" }),
            SelectOption({ label: "Large", value: "lg" }),
          ],
        }),
      ],
    });
    const card = modalToAdaptiveCard(modal, "ctx", "cb");

    expect(card.body).toHaveLength(1);
    expect(card.body[0]).toMatchObject({
      type: "Input.ChoiceSet",
      id: "size",
      label: "Size",
      style: "expanded",
      isRequired: true,
    });
  });

  it("converts text to TextBlock with style support", () => {
    const modal = makeModal({
      children: [
        CardText("Hello"),
        CardText("Bold text", { style: "bold" }),
        CardText("Muted text", { style: "muted" }),
      ],
    });
    const card = modalToAdaptiveCard(modal, "ctx", "cb");

    expect(card.body).toHaveLength(3);
    expect(card.body[0]).toMatchObject({
      type: "TextBlock",
      text: "Hello",
      wrap: true,
    });
    expect(card.body[1]).toMatchObject({
      type: "TextBlock",
      weight: "Bolder",
    });
    expect(card.body[2]).toMatchObject({
      type: "TextBlock",
      isSubtle: true,
    });
  });

  it("converts fields to FactSet", () => {
    const modal = makeModal({
      children: [
        Fields([
          Field({ label: "Name", value: "Alice" }),
          Field({ label: "Role", value: "Engineer" }),
        ]),
      ],
    });
    const card = modalToAdaptiveCard(modal, "ctx", "cb");

    expect(card.body).toHaveLength(1);
    expect(card.body[0]).toMatchObject({ type: "FactSet" });
    const factSet = card.body[0] as { facts: { title: string; value: string }[] };
    expect(factSet.facts).toHaveLength(2);
    expect(factSet.facts[0]).toMatchObject({ title: "Name", value: "Alice" });
  });
});

// ---------------------------------------------------------------------------
// parseDialogSubmitValues
// ---------------------------------------------------------------------------

describe("parseDialogSubmitValues", () => {
  it("extracts callbackId, contextId, and user values", () => {
    const result = parseDialogSubmitValues({
      __contextId: "ctx-1",
      __callbackId: "cb-1",
      msteams: { some: "data" },
      name: "Alice",
      color: "blue",
    });

    expect(result.contextId).toBe("ctx-1");
    expect(result.callbackId).toBe("cb-1");
    expect(result.values).toEqual({ name: "Alice", color: "blue" });
  });

  it("returns empty result for undefined data", () => {
    const result = parseDialogSubmitValues(undefined);

    expect(result.contextId).toBeUndefined();
    expect(result.callbackId).toBeUndefined();
    expect(result.values).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// modalResponseToTaskModuleResponse
// ---------------------------------------------------------------------------

describe("modalResponseToTaskModuleResponse", () => {
  it("returns undefined for undefined response", () => {
    expect(modalResponseToTaskModuleResponse(undefined)).toBeUndefined();
  });

  it("returns undefined for close action", () => {
    const response: ModalCloseResponse = { action: "close" };
    expect(modalResponseToTaskModuleResponse(response)).toBeUndefined();
  });

  it("returns continue response for update action", () => {
    const modal = makeModal({ title: "Updated" });
    const response: ModalUpdateResponse = { action: "update", modal };
    const result = modalResponseToTaskModuleResponse(response, undefined, "ctx-1");

    expect(result).toBeDefined();
    expect(result!.task).toMatchObject({
      type: "continue",
      value: {
        title: "Updated",
        card: {
          contentType: "application/vnd.microsoft.card.adaptive",
        },
      },
    });
  });

  it("falls back to continue and warns for push action", () => {
    const modal = makeModal({ title: "Pushed" });
    const response: ModalPushResponse = { action: "push", modal };
    const logger = { warn: vi.fn() };
    const result = modalResponseToTaskModuleResponse(response, logger, "ctx-1");

    expect(result).toBeDefined();
    expect(result!.task).toMatchObject({ type: "continue" });
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("does not support dialog stacking"),
      expect.any(Object)
    );
  });

  it("returns error card for errors action", () => {
    const response: ModalErrorsResponse = {
      action: "errors",
      errors: { name: "Required", email: "Invalid format" },
    };
    const result = modalResponseToTaskModuleResponse(response);

    expect(result).toBeDefined();
    expect(result!.task).toMatchObject({
      type: "continue",
      value: {
        title: "Validation Error",
        card: {
          contentType: "application/vnd.microsoft.card.adaptive",
        },
      },
    });

    const card = result!.task.value.card.content as { body: { text: string }[] };
    expect(card.body.length).toBeGreaterThanOrEqual(3);
    expect(card.body[0].text).toContain("Please fix");
  });
});
