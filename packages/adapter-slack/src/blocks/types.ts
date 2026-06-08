export type SlackButtonStyle = "danger" | "default" | "primary";
export type SlackTextStyle = "bold" | "muted" | "plain";
export type SlackTableAlignment = "center" | "left" | "right";

export interface SlackCardElement {
  children: SlackCardChild[];
  imageUrl?: string;
  subtitle?: string;
  title?: string;
  type: "card";
}

export type SlackCardChild =
  | SlackActionsElement
  | SlackDividerElement
  | SlackFieldsElement
  | SlackImageElement
  | SlackLinkElement
  | SlackSectionElement
  | SlackTableElement
  | SlackTextElement;

export interface SlackTextElement {
  content: string;
  style?: SlackTextStyle;
  type: "text";
}

export interface SlackImageElement {
  alt?: string;
  type: "image";
  url: string;
}

export interface SlackDividerElement {
  type: "divider";
}

export interface SlackActionsElement {
  children: (
    | SlackButtonElement
    | SlackLinkButtonElement
    | SlackRadioSelectElement
    | SlackSelectElement
  )[];
  type: "actions";
}

export interface SlackButtonElement {
  callbackUrl?: string;
  disabled?: boolean;
  id: string;
  label: string;
  style?: SlackButtonStyle;
  type: "button";
  value?: string;
}

export interface SlackLinkButtonElement {
  id?: string;
  label: string;
  style?: SlackButtonStyle;
  type: "link-button";
  url: string;
}

export interface SlackSelectOptionElement {
  description?: string;
  label: string;
  value: string;
}

export interface SlackSelectElement {
  id: string;
  initialOption?: string;
  label: string;
  options: SlackSelectOptionElement[];
  placeholder?: string;
  type: "select";
}

export interface SlackRadioSelectElement {
  id: string;
  initialOption?: string;
  label: string;
  options: SlackSelectOptionElement[];
  type: "radio_select";
}

export interface SlackSectionElement {
  children: SlackCardChild[];
  type: "section";
}

export interface SlackLinkElement {
  label: string;
  type: "link";
  url: string;
}

export interface SlackFieldElement {
  label: string;
  type: "field";
  value: string;
}

export interface SlackFieldsElement {
  children: SlackFieldElement[];
  type: "fields";
}

export interface SlackTableElement {
  align?: SlackTableAlignment[];
  headers: string[];
  rows: string[][];
  type: "table";
}

export interface SlackTextObject {
  emoji?: boolean;
  text: string;
  type: "mrkdwn" | "plain_text";
}

export interface SlackBlock {
  block_id?: string;
  type: string;
  [key: string]: unknown;
}

export interface SlackBlocksOptions {
  convertEmoji?: (text: string) => string;
  maxBlocks?: number;
}
