/**
 * Modal elements for form dialogs.
 */

import type { FieldsElement, TextElement } from "./cards";

// ============================================================================
// Modal Element Types
// ============================================================================

export const VALID_MODAL_CHILD_TYPES = [
  "text_input",
  "select",
  "radio_select",
  "text",
  "fields",
] as const;

export type ModalChild =
  | TextInputElement
  | SelectElement
  | RadioSelectElement
  | TextElement
  | FieldsElement;

export interface ModalElement {
  callbackId: string;
  children: ModalChild[];
  closeLabel?: string;
  notifyOnClose?: boolean;
  /** Arbitrary string passed through the modal lifecycle (e.g., JSON context). */
  privateMetadata?: string;
  submitLabel?: string;
  title: string;
  type: "modal";
}

export interface TextInputElement {
  id: string;
  initialValue?: string;
  label: string;
  maxLength?: number;
  multiline?: boolean;
  optional?: boolean;
  placeholder?: string;
  type: "text_input";
}

export interface SelectElement {
  id: string;
  initialOption?: string;
  label: string;
  optional?: boolean;
  options: SelectOptionElement[];
  placeholder?: string;
  type: "select";
}

export interface SelectOptionElement {
  description?: string;
  label: string;
  value: string;
}

export interface RadioSelectElement {
  id: string;
  initialOption?: string;
  label: string;
  optional?: boolean;
  options: SelectOptionElement[];
  type: "radio_select";
}

export function isModalElement(value: unknown): value is ModalElement {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as ModalElement).type === "modal"
  );
}

export function filterModalChildren(children: unknown[]): ModalChild[] {
  const validChildren = children.filter(
    (c): c is ModalChild =>
      typeof c === "object" &&
      c !== null &&
      "type" in c &&
      VALID_MODAL_CHILD_TYPES.includes(
        (c as { type: string }).type as (typeof VALID_MODAL_CHILD_TYPES)[number]
      )
  );
  if (validChildren.length < children.length) {
    console.warn(
      "[chat] Modal contains unsupported child elements that were ignored"
    );
  }
  return validChildren;
}

// ============================================================================
// Builder Functions
// ============================================================================

export interface ModalOptions {
  callbackId: string;
  children?: ModalChild[];
  closeLabel?: string;
  notifyOnClose?: boolean;
  /** Arbitrary string passed through the modal lifecycle (e.g., JSON context). */
  privateMetadata?: string;
  submitLabel?: string;
  title: string;
}

export function Modal(options: ModalOptions): ModalElement {
  return {
    type: "modal",
    callbackId: options.callbackId,
    title: options.title,
    submitLabel: options.submitLabel,
    closeLabel: options.closeLabel,
    notifyOnClose: options.notifyOnClose,
    privateMetadata: options.privateMetadata,
    children: options.children ?? [],
  };
}

export interface TextInputOptions {
  id: string;
  initialValue?: string;
  label: string;
  maxLength?: number;
  multiline?: boolean;
  optional?: boolean;
  placeholder?: string;
}

export function TextInput(options: TextInputOptions): TextInputElement {
  return {
    type: "text_input",
    id: options.id,
    label: options.label,
    placeholder: options.placeholder,
    initialValue: options.initialValue,
    multiline: options.multiline,
    optional: options.optional,
    maxLength: options.maxLength,
  };
}

export interface SelectOptions {
  id: string;
  initialOption?: string;
  label: string;
  optional?: boolean;
  options: SelectOptionElement[];
  placeholder?: string;
}

export function Select(options: SelectOptions): SelectElement {
  if (!options.options || options.options.length === 0) {
    throw new Error("Select requires at least one option");
  }
  return {
    type: "select",
    id: options.id,
    label: options.label,
    placeholder: options.placeholder,
    options: options.options,
    initialOption: options.initialOption,
    optional: options.optional,
  };
}

export function SelectOption(options: {
  label: string;
  value: string;
  description?: string;
}): SelectOptionElement {
  return {
    label: options.label,
    value: options.value,
    description: options.description,
  };
}

export interface RadioSelectOptions {
  id: string;
  initialOption?: string;
  label: string;
  optional?: boolean;
  options: SelectOptionElement[];
}

export function RadioSelect(options: RadioSelectOptions): RadioSelectElement {
  if (!options.options || options.options.length === 0) {
    throw new Error("RadioSelect requires at least one option");
  }
  return {
    type: "radio_select",
    id: options.id,
    label: options.label,
    options: options.options,
    initialOption: options.initialOption,
    optional: options.optional,
  };
}

// ============================================================================
// JSX Support
// ============================================================================

interface ReactElement {
  $$typeof: symbol;
  props: Record<string, unknown>;
  type: unknown;
}

function isReactElement(value: unknown): value is ReactElement {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const maybeElement = value as { $$typeof?: unknown };
  if (typeof maybeElement.$$typeof !== "symbol") {
    return false;
  }
  const symbolStr = maybeElement.$$typeof.toString();
  return (
    symbolStr.includes("react.element") ||
    symbolStr.includes("react.transitional.element")
  );
}

type AnyModalElement = ModalElement | ModalChild | SelectOptionElement;

const modalComponentMap = new Map<unknown, string>([
  [Modal, "Modal"],
  [TextInput, "TextInput"],
  [Select, "Select"],
  [RadioSelect, "RadioSelect"],
  [SelectOption, "SelectOption"],
]);

export function fromReactModalElement(
  element: unknown
): AnyModalElement | null {
  if (!isReactElement(element)) {
    if (isModalElement(element)) {
      return element;
    }
    if (typeof element === "object" && element !== null && "type" in element) {
      return element as ModalChild;
    }
    return null;
  }

  const { type, props } = element;
  const componentName = modalComponentMap.get(type);

  if (!componentName) {
    if (props.children) {
      return convertModalChildren(props.children)[0] ?? null;
    }
    return null;
  }

  const convertedChildren = props.children
    ? convertModalChildren(props.children)
    : [];

  switch (componentName) {
    case "Modal":
      return Modal({
        callbackId: props.callbackId as string,
        title: props.title as string,
        submitLabel: props.submitLabel as string | undefined,
        closeLabel: props.closeLabel as string | undefined,
        notifyOnClose: props.notifyOnClose as boolean | undefined,
        privateMetadata: props.privateMetadata as string | undefined,
        children: filterModalChildren(convertedChildren),
      });

    case "TextInput":
      return TextInput({
        id: props.id as string,
        label: props.label as string,
        placeholder: props.placeholder as string | undefined,
        initialValue: props.initialValue as string | undefined,
        multiline: props.multiline as boolean | undefined,
        optional: props.optional as boolean | undefined,
        maxLength: props.maxLength as number | undefined,
      });

    case "Select":
      return Select({
        id: props.id as string,
        label: props.label as string,
        placeholder: props.placeholder as string | undefined,
        options: convertedChildren.filter(
          (c): c is SelectOptionElement =>
            c !== null && "label" in c && "value" in c && !("type" in c)
        ),
        initialOption: props.initialOption as string | undefined,
        optional: props.optional as boolean | undefined,
      });

    case "RadioSelect":
      return RadioSelect({
        id: props.id as string,
        label: props.label as string,
        options: convertedChildren.filter(
          (c): c is SelectOptionElement =>
            c !== null && "label" in c && "value" in c && !("type" in c)
        ),
        initialOption: props.initialOption as string | undefined,
        optional: props.optional as boolean | undefined,
      });

    case "SelectOption":
      return SelectOption({
        label: props.label as string,
        value: props.value as string,
        description: props.description as string | undefined,
      });

    default:
      return null;
  }
}

function convertModalChildren(children: unknown): AnyModalElement[] {
  if (children == null) {
    return [];
  }

  if (Array.isArray(children)) {
    return children.flatMap(convertModalChildren);
  }

  const converted = fromReactModalElement(children);
  if (converted) {
    if (isModalElement(converted)) {
      return converted.children;
    }
    return [converted];
  }

  return [];
}
