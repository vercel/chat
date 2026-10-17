/**
 * The `TextInput` element, shared by cards and modals.
 *
 * It lives in its own leaf module — importing nothing from `cards.ts` or
 * `modals.ts` — because both of them need the builder at runtime. Defining it
 * in `modals.ts` and importing the value from `cards.ts` bundles the whole
 * modal builder into the `chat/workflow` chunk, which uses none of it.
 */

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
