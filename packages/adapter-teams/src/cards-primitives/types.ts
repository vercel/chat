export type TeamsButtonStyle = "danger" | "default" | "primary";
export type TeamsTextStyle = "bold" | "muted" | "plain";

export interface TeamsCardElement {
  children: TeamsCardChild[];
  imageUrl?: string;
  subtitle?: string;
  title?: string;
  type: "card";
}

export type TeamsCardChild =
  | TeamsActionsElement
  | TeamsDividerElement
  | TeamsFieldsElement
  | TeamsImageElement
  | TeamsLinkElement
  | TeamsSectionElement
  | TeamsTableElement
  | TeamsTextElement;

export interface TeamsTextElement {
  content: string;
  style?: TeamsTextStyle;
  type: "text";
}

export interface TeamsImageElement {
  alt?: string;
  type: "image";
  url: string;
}

export interface TeamsDividerElement {
  type: "divider";
}

export interface TeamsActionsElement {
  children: (
    | TeamsButtonElement
    | TeamsLinkButtonElement
    | TeamsRadioSelectElement
    | TeamsSelectElement
  )[];
  type: "actions";
}

export interface TeamsButtonElement {
  id: string;
  label: string;
  style?: TeamsButtonStyle;
  type: "button";
  value?: string;
}

export interface TeamsLinkButtonElement {
  label: string;
  style?: TeamsButtonStyle;
  type: "link-button";
  url: string;
}

export interface TeamsSelectOptionElement {
  label: string;
  value: string;
}

export interface TeamsSelectElement {
  id: string;
  label: string;
  optional?: boolean;
  options: TeamsSelectOptionElement[];
  placeholder?: string;
  type: "select";
}

export interface TeamsRadioSelectElement
  extends Omit<TeamsSelectElement, "type"> {
  type: "radio_select";
}

export interface TeamsSectionElement {
  children: TeamsCardChild[];
  type: "section";
}

export interface TeamsFieldsElement {
  children: TeamsFieldElement[];
  type: "fields";
}

export interface TeamsFieldElement {
  label: string;
  value: string;
}

export interface TeamsLinkElement {
  label: string;
  type: "link";
  url: string;
}

export interface TeamsTableElement {
  headers: string[];
  rows: string[][];
  type: "table";
}

export interface TeamsAdaptiveCard {
  $schema: string;
  actions?: unknown[];
  body: unknown[];
  type: "AdaptiveCard";
  version: "1.4";
}
