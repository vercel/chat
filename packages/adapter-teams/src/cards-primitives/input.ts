import type { TeamsAdaptiveCard, TeamsButtonStyle } from "./types";

export const TEAMS_INPUT_ACTION_PREFIX = "input:";
export const TEAMS_FREEFORM_ACTION_ID = "input-freeform";

export interface TeamsInputOption {
  description?: string;
  id: string;
  label: string;
  style?: TeamsButtonStyle;
}

export interface TeamsInputRequest {
  allowFreeform?: boolean;
  display?: "buttons" | "radio" | "select";
  options?: readonly TeamsInputOption[];
  prompt: string;
  requestId: string;
}

export interface TeamsInputAction {
  actionId?: string;
  value?: unknown;
}

export interface TeamsInputResponse {
  optionId?: string;
  requestId: string;
  value?: string;
}

export function inputRequestToTeamsAdaptiveCard(
  request: TeamsInputRequest
): TeamsAdaptiveCard {
  const body: unknown[] = [
    {
      text: request.prompt,
      type: "TextBlock",
      wrap: true,
    },
  ];
  const actions: unknown[] = [];
  const options = request.options ?? [];

  if (request.display === "select" || request.display === "radio") {
    body.push({
      choices: options.map((option) => ({
        title: option.label,
        value: option.id,
      })),
      id: `${TEAMS_INPUT_ACTION_PREFIX}${request.requestId}`,
      isMultiSelect: false,
      style: request.display === "radio" ? "expanded" : "compact",
      type: "Input.ChoiceSet",
    });
    actions.push({
      data: { actionId: `${TEAMS_INPUT_ACTION_PREFIX}${request.requestId}` },
      title: "Submit",
      type: "Action.Submit",
    });
  } else {
    for (const option of options) {
      actions.push({
        data: {
          actionId: `${TEAMS_INPUT_ACTION_PREFIX}${request.requestId}`,
          value: option.id,
        },
        title: option.label,
        type: "Action.Submit",
      });
    }
  }

  if (request.allowFreeform) {
    body.push({
      id: TEAMS_FREEFORM_ACTION_ID,
      isMultiline: true,
      placeholder: "Type your answer",
      type: "Input.Text",
    });
    actions.push({
      data: {
        actionId: `${TEAMS_INPUT_ACTION_PREFIX}${request.requestId}`,
        freeform: true,
      },
      title: "Submit answer",
      type: "Action.Submit",
    });
  }

  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    actions,
    body,
    type: "AdaptiveCard",
    version: "1.4",
  };
}

export function parseTeamsInputResponse(
  action: TeamsInputAction
): TeamsInputResponse | null {
  if (!action.actionId?.startsWith(TEAMS_INPUT_ACTION_PREFIX)) {
    return null;
  }
  const requestId = action.actionId.slice(TEAMS_INPUT_ACTION_PREFIX.length);
  const inputActionId = `${TEAMS_INPUT_ACTION_PREFIX}${requestId}`;
  const optionId =
    typeof action.value === "string"
      ? action.value
      : readStringValue(action.value, inputActionId);
  const freeformValue =
    typeof action.value === "string"
      ? undefined
      : readStringValue(action.value, TEAMS_FREEFORM_ACTION_ID);

  return {
    ...(optionId ? { optionId, value: optionId } : {}),
    ...(freeformValue ? { value: freeformValue } : {}),
    requestId,
  };
}

function readStringValue(value: unknown, key: string): string | undefined {
  if (!(value && typeof value === "object" && key in value)) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}
