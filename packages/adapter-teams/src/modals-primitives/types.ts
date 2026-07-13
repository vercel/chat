import type { TeamsFieldElement } from "../cards-primitives";

export interface TeamsModalElement {
  callbackId: string;
  children: TeamsModalChild[];
  submitLabel?: string;
  title: string;
  type: "modal";
}

export type TeamsModalChild =
  | TeamsFieldsModalElement
  | TeamsModalTextElement
  | TeamsModalTextInputElement
  | TeamsModalSelectElement
  | TeamsModalRadioSelectElement;

export interface TeamsModalTextElement {
  content: string;
  style?: "bold" | "muted" | "plain";
  type: "text";
}

export interface TeamsFieldsModalElement {
  children: TeamsFieldElement[];
  type: "fields";
}

export interface TeamsModalSelectOption {
  label: string;
  value: string;
}

export interface TeamsModalTextInputElement {
  id: string;
  initialValue?: string;
  label: string;
  maxLength?: number;
  multiline?: boolean;
  optional?: boolean;
  placeholder?: string;
  type: "text_input";
}

export interface TeamsModalSelectElement {
  id: string;
  initialOption?: string;
  label: string;
  optional?: boolean;
  options: TeamsModalSelectOption[];
  placeholder?: string;
  type: "select";
}

export interface TeamsModalRadioSelectElement
  extends Omit<TeamsModalSelectElement, "type"> {
  type: "radio_select";
}

export interface TeamsTaskModuleResponse {
  task: {
    type: "continue";
    value: {
      card: {
        content: unknown;
        contentType: "application/vnd.microsoft.card.adaptive";
      };
      title: string;
    };
  };
}

export type TeamsModalResponse =
  | { action: "close" }
  | { action: "errors"; errors: Record<string, string> }
  | { action: "push" | "update"; modal: TeamsModalElement };

export interface TeamsDialogSubmitValues {
  callbackId: string | undefined;
  contextId: string | undefined;
  values: Record<string, string>;
}
