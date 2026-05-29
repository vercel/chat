/**
 * Teams dialog (task module) converter.
 * Converts ModalElement to Adaptive Card JSON for Teams task modules,
 * and converts ModalResponse to TaskModuleResponse format.
 */

import { createEmojiConverter, mapButtonStyle } from "@chat-adapter/shared";
import type { TaskModuleResponse } from "@microsoft/teams.api";
import type {
  ActionStyle,
  CardElementArray,
  ChoiceSetInputOptions,
  TextInputOptions,
} from "@microsoft/teams.cards";
import {
  AdaptiveCard,
  Choice,
  ChoiceSetInput,
  Fact,
  FactSet,
  SubmitAction,
  TextBlock,
  TextInput,
} from "@microsoft/teams.cards";
import type {
  FieldsElement,
  ModalChild,
  ModalElement,
  ModalResponse,
  RadioSelectElement,
  SelectElement,
  TextElement,
  TextInputElement,
} from "chat";

const convertEmoji = createEmojiConverter("teams");

const ADAPTIVE_CARD_SCHEMA =
  "http://adaptivecards.io/schemas/adaptive-card.json";
const ADAPTIVE_CARD_VERSION = "1.4" as const;

// ============================================================================
// ModalElement -> Adaptive Card
// ============================================================================

/**
 * Convert a ModalElement to an Adaptive Card for use inside a Teams task module.
 *
 * @param modal - The modal element to convert
 * @param contextId - Context ID for server-side stored thread/message context
 * @param callbackId - Callback ID for routing the submit event
 */
export function modalToAdaptiveCard(
  modal: ModalElement,
  contextId: string,
  callbackId: string
): AdaptiveCard {
  const body: CardElementArray = [];

  for (const child of modal.children) {
    body.push(...modalChildToAdaptiveElements(child));
  }

  const submitData: Record<string, unknown> = {
    __contextId: contextId,
    __callbackId: callbackId,
  };

  const submitOptions: {
    title: string;
    data: Record<string, unknown>;
    style?: ActionStyle;
  } = {
    title: modal.submitLabel || "Submit",
    data: submitData,
  };

  const style = mapButtonStyle("primary", "teams") as ActionStyle | undefined;
  if (style) {
    submitOptions.style = style;
  }

  const submitAction = new SubmitAction(submitOptions);

  return new AdaptiveCard(...body)
    .withOptions({
      $schema: ADAPTIVE_CARD_SCHEMA,
      version: ADAPTIVE_CARD_VERSION,
    })
    .withActions(submitAction);
}

function modalChildToAdaptiveElements(child: ModalChild): CardElementArray {
  switch (child.type) {
    case "text_input":
      return [textInputToAdaptive(child)];
    case "select":
      return [selectToAdaptive(child)];
    case "external_select":
      throw new Error("ExternalSelect is only supported by the Slack adapter");
    case "radio_select":
      return [radioSelectToAdaptive(child)];
    case "text":
      return [textToAdaptive(child)];
    case "fields":
      return [fieldsToAdaptive(child)];
    default:
      return [];
  }
}

function textInputToAdaptive(input: TextInputElement): TextInput {
  const options: TextInputOptions = {
    id: input.id,
    label: convertEmoji(input.label),
    isMultiline: input.multiline ?? false,
    isRequired: !(input.optional ?? false),
    placeholder: input.placeholder,
    value: input.initialValue,
    maxLength: input.maxLength,
  };

  return new TextInput(options);
}

function selectToAdaptive(select: SelectElement): ChoiceSetInput {
  const choices = select.options.map(
    (opt) => new Choice({ title: convertEmoji(opt.label), value: opt.value })
  );

  const options: ChoiceSetInputOptions = {
    id: select.id,
    label: convertEmoji(select.label),
    style: "compact",
    isRequired: !(select.optional ?? false),
    placeholder: select.placeholder,
    value: select.initialOption,
  };

  return new ChoiceSetInput(...choices).withOptions(options);
}

function radioSelectToAdaptive(
  radioSelect: RadioSelectElement
): ChoiceSetInput {
  const choices = radioSelect.options.map(
    (opt) => new Choice({ title: convertEmoji(opt.label), value: opt.value })
  );

  const options: ChoiceSetInputOptions = {
    id: radioSelect.id,
    label: convertEmoji(radioSelect.label),
    style: "expanded",
    isRequired: !(radioSelect.optional ?? false),
    value: radioSelect.initialOption,
  };

  return new ChoiceSetInput(...choices).withOptions(options);
}

function textToAdaptive(text: TextElement): TextBlock {
  const options: { wrap: boolean; weight?: "Bolder"; isSubtle?: boolean } = {
    wrap: true,
  };

  if (text.style === "bold") {
    options.weight = "Bolder";
  } else if (text.style === "muted") {
    options.isSubtle = true;
  }

  return new TextBlock(convertEmoji(text.content), options);
}

function fieldsToAdaptive(fields: FieldsElement): FactSet {
  const facts = fields.children.map(
    (field) => new Fact(convertEmoji(field.label), convertEmoji(field.value))
  );

  return new FactSet(...facts);
}

// ============================================================================
// Dialog submit value parsing
// ============================================================================

export interface DialogSubmitValues {
  callbackId: string | undefined;
  contextId: string | undefined;
  values: Record<string, string>;
}

/**
 * Extract user input values from an Action.Submit data payload,
 * stripping out internal keys (__contextId, __callbackId, msteams).
 */
export function parseDialogSubmitValues(
  data: Record<string, unknown> | undefined
): DialogSubmitValues {
  if (!data) {
    return { contextId: undefined, callbackId: undefined, values: {} };
  }

  const contextId = data.__contextId as string | undefined;
  const callbackId = data.__callbackId as string | undefined;

  const values: Record<string, string> = {};
  for (const [key, val] of Object.entries(data)) {
    if (key === "__contextId" || key === "__callbackId" || key === "msteams") {
      continue;
    }
    if (typeof val === "string") {
      values[key] = val;
    }
  }

  return { contextId, callbackId, values };
}

// ============================================================================
// ModalResponse -> Teams task module response
// ============================================================================

function buildContinueResponse(
  modal: ModalElement,
  contextId?: string
): TaskModuleResponse {
  const card = modalToAdaptiveCard(modal, contextId || "", modal.callbackId);
  return {
    task: {
      type: "continue" as const,
      value: {
        title: modal.title,
        card: {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: card,
        },
      },
    },
  };
}

/**
 * Convert a ModalResponse from the handler into a Teams task module response.
 * Returns undefined to signal "close dialog" (empty HTTP body).
 *
 * @param response - The modal response from the submit handler
 * @param logger - Optional logger for warnings
 */
export function modalResponseToTaskModuleResponse(
  response: ModalResponse | undefined,
  logger?: { warn: (msg: string, meta?: Record<string, unknown>) => void },
  contextId?: string
): TaskModuleResponse | undefined {
  if (!response) {
    return undefined;
  }
  switch (response.action) {
    case "close":
      // undefined signals "close dialog" (empty HTTP body)
      return undefined;

    case "update":
      return buildContinueResponse(response.modal, contextId);

    case "push":
      // Teams has no dialog stacking — fall back to update with a warning
      logger?.warn(
        "Teams does not support dialog stacking (push). Falling back to update.",
        { callbackId: response.modal.callbackId }
      );
      return buildContinueResponse(response.modal, contextId);

    case "errors": {
      // Render a simple error card listing validation issues
      const errorBlocks = Object.entries(response.errors).map(
        ([field, msg]) =>
          new TextBlock(`**${field}**: ${msg}`, {
            wrap: true,
            color: "Attention",
          })
      );

      const errorCard = new AdaptiveCard(
        new TextBlock("Please fix the following errors:", {
          weight: "Bolder",
          wrap: true,
        }),
        ...errorBlocks
      ).withOptions({
        $schema: ADAPTIVE_CARD_SCHEMA,
        version: ADAPTIVE_CARD_VERSION,
      });

      return {
        task: {
          type: "continue" as const,
          value: {
            title: "Validation Error",
            card: {
              contentType: "application/vnd.microsoft.card.adaptive",
              content: errorCard,
            },
          },
        },
      };
    }

    default:
      return undefined;
  }
}
