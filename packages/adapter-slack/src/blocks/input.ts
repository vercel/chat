import { LIMITS } from "./limits";
import type { SlackBlock, SlackButtonStyle } from "./types";

export const SLACK_INPUT_ACTION_PREFIX = "input:";
export const SLACK_FREEFORM_ACTION_PREFIX = "input-freeform:";
export const SLACK_FREEFORM_CALLBACK_ID = "input-freeform-submit";
export const SLACK_FREEFORM_BLOCK_ID = "input-freeform-block";
export const SLACK_FREEFORM_ACTION_ID = "input-freeform-text";
const BUTTON_ACTION_PATTERN = /^(?<requestId>.+):button:\d+$/u;

export interface SlackInputOption {
  description?: string;
  id: string;
  label: string;
  style?: SlackButtonStyle;
}

export interface SlackInputRequest {
  allowFreeform?: boolean;
  display?: "buttons" | "radio" | "select";
  options?: readonly SlackInputOption[];
  prompt: string;
  requestId: string;
}

export interface SlackInputAction {
  actionId: string;
  selectedOptionValue?: string;
  value?: string;
}

export interface SlackInputResponse {
  optionId?: string;
  requestId: string;
}

export interface SlackFreeformViewOptions {
  metadata: unknown;
  prompt?: string;
  title?: string;
}

export function inputRequestToSlackBlocks(
  request: SlackInputRequest
): SlackBlock[] {
  const prompt = {
    text: {
      text: truncate(request.prompt, LIMITS.sectionText),
      type: "mrkdwn",
    },
    type: "section",
  };
  const options = request.options ?? [];
  if (options.length === 0) {
    return [
      prompt,
      {
        elements: [freeformButton(request.requestId)],
        type: "actions",
      },
    ];
  }
  const extras = request.allowFreeform
    ? [freeformButton(request.requestId)]
    : [];
  if (request.display === "radio") {
    return [
      prompt,
      {
        elements: [radioElement(request), ...extras],
        type: "actions",
      },
    ];
  }
  if (request.display === "select") {
    return [
      prompt,
      {
        elements: [selectElement(request), ...extras],
        type: "actions",
      },
    ];
  }
  const limit =
    extras.length > 0 ? LIMITS.actionsElements - 1 : LIMITS.actionsElements;
  return [
    prompt,
    {
      elements: options
        .slice(0, limit)
        .map((option, index) => buttonElement(request.requestId, option, index))
        .concat(extras),
      type: "actions",
    },
  ];
}

export function parseSlackInputResponse(
  action: SlackInputAction
): SlackInputResponse | null {
  if (!action.actionId.startsWith(SLACK_INPUT_ACTION_PREFIX)) {
    return null;
  }
  const id = action.actionId.slice(SLACK_INPUT_ACTION_PREFIX.length);
  if (action.selectedOptionValue !== undefined) {
    return id ? { optionId: action.selectedOptionValue, requestId: id } : null;
  }
  const match = BUTTON_ACTION_PATTERN.exec(id);
  const requestId = match?.groups?.requestId;
  if (requestId && action.value !== undefined) {
    return { optionId: action.value, requestId };
  }
  return null;
}

export function buildSlackFreeformView(
  options: SlackFreeformViewOptions
): Record<string, unknown> {
  const title = truncate(options.title ?? options.prompt ?? "Your answer", 24);
  const blocks: unknown[] = [];
  if (options.prompt) {
    blocks.push({
      text: {
        text: truncate(options.prompt, LIMITS.sectionText),
        type: "mrkdwn",
      },
      type: "section",
    });
  }
  blocks.push({
    block_id: SLACK_FREEFORM_BLOCK_ID,
    element: {
      action_id: SLACK_FREEFORM_ACTION_ID,
      multiline: true,
      type: "plain_text_input",
    },
    label: { text: "Answer", type: "plain_text" },
    type: "input",
  });
  return {
    blocks,
    callback_id: SLACK_FREEFORM_CALLBACK_ID,
    close: { text: "Cancel", type: "plain_text" },
    private_metadata:
      typeof options.metadata === "string"
        ? options.metadata
        : JSON.stringify(options.metadata),
    submit: { text: "Submit", type: "plain_text" },
    title: { text: title, type: "plain_text" },
    type: "modal",
  };
}

export function parseSlackFreeformValue(
  values: readonly {
    actionId: string;
    blockId: string;
    value?: string;
  }[]
): string | undefined {
  return values.find(
    (value) =>
      value.blockId === SLACK_FREEFORM_BLOCK_ID &&
      value.actionId === SLACK_FREEFORM_ACTION_ID
  )?.value;
}

export function answeredSlackInputBlocks(input: {
  answer: string;
  promptBlock?: unknown;
  userId?: string;
}): SlackBlock[] {
  const blocks: SlackBlock[] = [];
  if (input.promptBlock && typeof input.promptBlock === "object") {
    blocks.push(input.promptBlock as SlackBlock);
  }
  blocks.push({
    text: { text: `:white_check_mark: *${input.answer}*`, type: "mrkdwn" },
    type: "section",
  });
  if (input.userId) {
    blocks.push({
      elements: [{ text: `Answered by <@${input.userId}>`, type: "mrkdwn" }],
      type: "context",
    });
  }
  return blocks;
}

function freeformButton(requestId: string): Record<string, unknown> {
  return {
    action_id: `${SLACK_FREEFORM_ACTION_PREFIX}${requestId}`,
    style: "primary",
    text: { text: "Type your answer", type: "plain_text" },
    type: "button",
    value: requestId,
  };
}

function buttonElement(
  requestId: string,
  option: SlackInputOption,
  index: number
): Record<string, unknown> {
  return compact({
    action_id: `${SLACK_INPUT_ACTION_PREFIX}${requestId}:button:${index}`,
    style:
      option.style === "primary" || option.style === "danger"
        ? option.style
        : undefined,
    text: {
      text: truncate(option.label, LIMITS.buttonText),
      type: "plain_text",
    },
    type: "button",
    value: truncate(option.id, LIMITS.buttonValue),
  });
}

function selectElement(request: SlackInputRequest): Record<string, unknown> {
  const options = (request.options ?? []).map((option) => ({
    text: {
      text: truncate(option.label, LIMITS.optionText),
      type: "plain_text",
    },
    value: truncate(option.id, LIMITS.optionValue),
  }));
  return {
    action_id: `${SLACK_INPUT_ACTION_PREFIX}${request.requestId}`,
    options: options.slice(0, LIMITS.options),
    placeholder: { text: "Choose an option", type: "plain_text" },
    type: "static_select",
  };
}

function radioElement(request: SlackInputRequest): Record<string, unknown> {
  const options = (request.options ?? []).map((option) => ({
    text: {
      text: truncate(option.label, LIMITS.optionText),
      type: "plain_text",
    },
    value: truncate(option.id, LIMITS.optionValue),
  }));
  if (options.length > LIMITS.radioOptions) {
    return selectElement(request);
  }
  return {
    action_id: `${SLACK_INPUT_ACTION_PREFIX}${request.requestId}`,
    options,
    type: "radio_buttons",
  };
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      output[key] = item;
    }
  }
  return output as T;
}
