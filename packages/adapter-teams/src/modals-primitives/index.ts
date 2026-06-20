import { convertTeamsEmojiPlaceholders } from "../format";
import type {
  TeamsDialogSubmitValues,
  TeamsFieldsModalElement,
  TeamsModalChild,
  TeamsModalElement,
  TeamsModalRadioSelectElement,
  TeamsModalResponse,
  TeamsModalSelectElement,
  TeamsModalTextElement,
  TeamsModalTextInputElement,
  TeamsTaskModuleResponse,
} from "./types";

export type * from "./types";

const ADAPTIVE_CARD_CONTENT_TYPE = "application/vnd.microsoft.card.adaptive";

export function modalToAdaptiveCard(
  modal: TeamsModalElement,
  options: { callbackId?: string; contextId?: string } = {}
): unknown {
  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    actions: [
      {
        data: {
          __callbackId: options.callbackId ?? modal.callbackId,
          ...(options.contextId ? { __contextId: options.contextId } : {}),
        },
        style: "positive",
        title: modal.submitLabel ?? "Submit",
        type: "Action.Submit",
      },
    ],
    body: modal.children.flatMap(modalChildToAdaptiveElements),
    type: "AdaptiveCard",
    version: "1.4",
  };
}

export function parseTeamsDialogSubmitValues(
  data: Record<string, unknown> | undefined
): TeamsDialogSubmitValues {
  if (!data) {
    return { callbackId: undefined, contextId: undefined, values: {} };
  }

  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "__callbackId" || key === "__contextId" || key === "msteams") {
      continue;
    }
    if (typeof value === "string") {
      values[key] = value;
    }
  }

  return {
    callbackId:
      typeof data.__callbackId === "string" ? data.__callbackId : undefined,
    contextId:
      typeof data.__contextId === "string" ? data.__contextId : undefined,
    values,
  };
}

export function toTeamsTaskModuleResponse(
  response: TeamsModalResponse | undefined,
  options: { contextId?: string } = {}
): TeamsTaskModuleResponse | undefined {
  if (!response || response.action === "close") {
    return undefined;
  }

  if (response.action === "errors") {
    return continueResponse("Validation Error", {
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      body: [
        {
          text: "Please fix the following errors:",
          type: "TextBlock",
          weight: "Bolder",
          wrap: true,
        },
        ...Object.entries(response.errors).map(([field, message]) => ({
          color: "Attention",
          text: `**${field}**: ${message}`,
          type: "TextBlock",
          wrap: true,
        })),
      ],
      type: "AdaptiveCard",
      version: "1.4",
    });
  }

  return continueResponse(
    response.modal.title,
    modalToAdaptiveCard(response.modal, { contextId: options.contextId })
  );
}

function modalChildToAdaptiveElements(child: TeamsModalChild): unknown[] {
  switch (child.type) {
    case "text":
      return [textBlock(child)];
    case "fields":
      return [fieldsBlock(child)];
    case "text_input":
      return [textInput(child)];
    case "select":
      return [choiceSet(child, "compact")];
    case "radio_select":
      return [choiceSet(child, "expanded")];
    default:
      return [];
  }
}

function textBlock(element: TeamsModalTextElement): unknown {
  return {
    ...(element.style === "bold" ? { weight: "Bolder" } : {}),
    ...(element.style === "muted" ? { isSubtle: true } : {}),
    text: convertTeamsEmojiPlaceholders(element.content),
    type: "TextBlock",
    wrap: true,
  };
}

function fieldsBlock(element: TeamsFieldsModalElement): unknown {
  return {
    facts: element.children.map((field) => ({
      title: field.label,
      value: field.value,
    })),
    type: "FactSet",
  };
}

function textInput(input: TeamsModalTextInputElement): unknown {
  return {
    id: input.id,
    isMultiline: input.multiline ?? false,
    isRequired: !(input.optional ?? false),
    label: input.label,
    ...(input.maxLength ? { maxLength: input.maxLength } : {}),
    ...(input.placeholder ? { placeholder: input.placeholder } : {}),
    ...(input.initialValue ? { value: input.initialValue } : {}),
    type: "Input.Text",
  };
}

function choiceSet(
  select: TeamsModalRadioSelectElement | TeamsModalSelectElement,
  style: "compact" | "expanded"
): unknown {
  return {
    choices: select.options.map((option) => ({
      title: option.label,
      value: option.value,
    })),
    id: select.id,
    isRequired: !(select.optional ?? false),
    label: select.label,
    ...(select.placeholder ? { placeholder: select.placeholder } : {}),
    style,
    ...(select.initialOption ? { value: select.initialOption } : {}),
    type: "Input.ChoiceSet",
  };
}

function continueResponse(
  title: string,
  card: unknown
): TeamsTaskModuleResponse {
  return {
    task: {
      type: "continue",
      value: {
        card: {
          content: card,
          contentType: ADAPTIVE_CARD_CONTENT_TYPE,
        },
        title,
      },
    },
  };
}
