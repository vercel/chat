/**
 * Slack modal (view) converter.
 * Converts ModalElement to Slack Block Kit view format.
 */

import type {
  DateInputElement,
  ExternalSelectElement,
  ModalChild,
  ModalElement,
  NumberInputElement,
  RadioSelectElement,
  SelectElement,
  SelectOptionElement,
  TextInputElement,
} from "chat";
import {
  convertFieldsToBlock,
  convertTextToBlock,
  type SlackBlock,
} from "./cards";

export interface SlackView {
  blocks: SlackBlock[];
  callback_id: string;
  close?: { type: "plain_text"; text: string };
  notify_on_close?: boolean;
  private_metadata?: string;
  submit?: { type: "plain_text"; text: string };
  title: { type: "plain_text"; text: string };
  type: "modal";
}

export interface SlackModalResponse {
  errors?: Record<string, string>;
  response_action?: "errors" | "update" | "push" | "clear";
  view?: SlackView;
}

export interface SlackOptionObject {
  description?: { type: "plain_text"; text: string };
  text: { type: "plain_text"; text: string };
  value: string;
}

// ============================================================================
// Private metadata encoding
// ============================================================================

export interface ModalMetadata {
  contextId?: string;
  privateMetadata?: string;
}

/**
 * Encode contextId and user privateMetadata into a single string
 * for Slack's private_metadata field.
 */
export function encodeModalMetadata(meta: ModalMetadata): string | undefined {
  if (!(meta.contextId || meta.privateMetadata)) {
    return undefined;
  }
  return JSON.stringify({ c: meta.contextId, m: meta.privateMetadata });
}

/**
 * Decode Slack's private_metadata back into contextId and user privateMetadata.
 * Falls back to treating the raw string as a plain contextId for backward compat.
 */
export function decodeModalMetadata(raw?: string): ModalMetadata {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      ("c" in parsed || "m" in parsed)
    ) {
      return {
        contextId: parsed.c || undefined,
        privateMetadata: parsed.m || undefined,
      };
    }
  } catch {
    // Not JSON — treat as legacy plain contextId
  }
  return { contextId: raw };
}

// ============================================================================
// Modal view conversion
// ============================================================================

export function modalToSlackView(
  modal: ModalElement,
  contextId?: string
): SlackView {
  return {
    type: "modal",
    callback_id: modal.callbackId,
    title: { type: "plain_text", text: modal.title.slice(0, 24) },
    submit: modal.submitLabel
      ? { type: "plain_text", text: modal.submitLabel }
      : { type: "plain_text", text: "Submit" },
    close: modal.closeLabel
      ? { type: "plain_text", text: modal.closeLabel }
      : { type: "plain_text", text: "Cancel" },
    notify_on_close: modal.notifyOnClose,
    private_metadata: contextId,
    blocks: modal.children.map(modalChildToBlock),
  };
}

function modalChildToBlock(child: ModalChild): SlackBlock {
  switch (child.type) {
    case "text_input":
      return textInputToBlock(child);
    case "date_input":
      return dateInputToBlock(child);
    case "number_input":
      return numberInputToBlock(child);
    case "select":
      return selectToBlock(child);
    case "external_select":
      return externalSelectToBlock(child);
    case "radio_select":
      return radioSelectToBlock(child);
    case "text":
      return convertTextToBlock(child);
    case "fields":
      return convertFieldsToBlock(child);
    default:
      throw new Error(
        `Unknown modal child type: ${(child as { type: string }).type}`
      );
  }
}

export function selectOptionToSlackOption(
  option: SelectOptionElement
): SlackOptionObject {
  return {
    text: { type: "plain_text", text: option.label },
    value: option.value,
    ...(option.description
      ? { description: { type: "plain_text", text: option.description } }
      : {}),
  };
}

function textInputToBlock(input: TextInputElement): SlackBlock {
  const element: Record<string, unknown> = {
    type: "plain_text_input",
    action_id: input.id,
    multiline: input.multiline ?? false,
  };

  if (input.placeholder) {
    element.placeholder = { type: "plain_text", text: input.placeholder };
  }
  if (input.initialValue) {
    element.initial_value = input.initialValue;
  }
  if (input.maxLength) {
    element.max_length = input.maxLength;
  }

  return {
    type: "input",
    block_id: input.id,
    optional: input.optional ?? false,
    label: { type: "plain_text", text: input.label },
    element,
  };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Slack rejects a `datepicker` whose `initial_date` is not a real `YYYY-MM-DD` date, and it fails the
 * WHOLE `views.open` with `invalid_arguments` rather than degrading the one field — so a modal built from
 * user- or template-supplied dates never opens at all. Adaptive Cards is lenient with a bad `Input.Date`
 * value, so forwarding it verbatim would make the same modal work on Teams and die on Slack. Drop it with
 * a warning instead, matching how `filterModalChildren` handles unsupported children.
 */
function toInitialDate(value: string | undefined): string | undefined {
  if (!value) {
    return;
  }
  // `Date` rolls impossible dates over (2026-02-31 becomes Mar 3), so round-trip rather than trust a parse.
  const parsed = ISO_DATE_RE.test(value)
    ? new Date(`${value}T00:00:00Z`)
    : null;
  if (
    !parsed ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    console.warn(
      `[chat] DateInput "${value}" is not a YYYY-MM-DD date — ignoring initialValue`
    );
    return;
  }
  return value;
}

function dateInputToBlock(input: DateInputElement): SlackBlock {
  const element: Record<string, unknown> = {
    type: "datepicker",
    action_id: input.id,
  };

  if (input.placeholder) {
    element.placeholder = { type: "plain_text", text: input.placeholder };
  }
  const initialDate = toInitialDate(input.initialValue);
  if (initialDate) {
    element.initial_date = initialDate;
  }

  return {
    type: "input",
    block_id: input.id,
    optional: input.optional ?? false,
    label: { type: "plain_text", text: input.label },
    element,
  };
}

function numberInputToBlock(input: NumberInputElement): SlackBlock {
  // Slack's number_input requires is_decimal_allowed, and takes its numeric
  // bounds/initial value as strings.
  const element: Record<string, unknown> = {
    type: "number_input",
    action_id: input.id,
    is_decimal_allowed: input.decimal ?? false,
  };

  if (input.placeholder) {
    element.placeholder = { type: "plain_text", text: input.placeholder };
  }
  if (input.initialValue !== undefined) {
    element.initial_value = String(input.initialValue);
  }
  if (input.min !== undefined) {
    element.min_value = String(input.min);
  }
  if (input.max !== undefined) {
    element.max_value = String(input.max);
  }

  return {
    type: "input",
    block_id: input.id,
    optional: input.optional ?? false,
    label: { type: "plain_text", text: input.label },
    element,
  };
}

function selectToBlock(select: SelectElement): SlackBlock {
  const options = select.options.map(selectOptionToSlackOption);

  const element: Record<string, unknown> = {
    type: "static_select",
    action_id: select.id,
    options,
  };

  if (select.placeholder) {
    element.placeholder = { type: "plain_text", text: select.placeholder };
  }

  if (select.initialOption) {
    const initialOpt = options.find(
      (o) => (o as { value: string }).value === select.initialOption
    );
    if (initialOpt) {
      element.initial_option = initialOpt;
    }
  }

  return {
    type: "input",
    block_id: select.id,
    optional: select.optional ?? false,
    label: { type: "plain_text", text: select.label },
    element,
  };
}

function externalSelectToBlock(select: ExternalSelectElement): SlackBlock {
  const element: Record<string, unknown> = {
    type: "external_select",
    action_id: select.id,
  };

  if (select.placeholder) {
    element.placeholder = { type: "plain_text", text: select.placeholder };
  }

  if (select.minQueryLength !== undefined) {
    element.min_query_length = select.minQueryLength;
  }

  if (select.initialOption) {
    element.initial_option = selectOptionToSlackOption(select.initialOption);
  }

  return {
    type: "input",
    block_id: select.id,
    optional: select.optional ?? false,
    label: { type: "plain_text", text: select.label },
    element,
  };
}

function radioSelectToBlock(radioSelect: RadioSelectElement): SlackBlock {
  const limitedOptions = radioSelect.options.slice(0, 10);
  const options = limitedOptions.map((opt) => {
    const option: Record<string, unknown> = {
      text: { type: "mrkdwn" as const, text: opt.label },
      value: opt.value,
    };
    if (opt.description) {
      option.description = { type: "mrkdwn", text: opt.description };
    }
    return option;
  });

  const element: Record<string, unknown> = {
    type: "radio_buttons",
    action_id: radioSelect.id,
    options,
  };
  if (radioSelect.initialOption) {
    const initialOpt = options.find(
      (o) => (o as { value: string }).value === radioSelect.initialOption
    );
    if (initialOpt) {
      element.initial_option = initialOpt;
    }
  }
  return {
    type: "input",
    block_id: radioSelect.id,
    optional: radioSelect.optional ?? false,
    label: { type: "plain_text", text: radioSelect.label },
    element,
  };
}
