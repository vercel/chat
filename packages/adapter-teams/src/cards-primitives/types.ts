export type TeamsButtonStyle = "danger" | "default" | "primary";
export type TeamsCardWidth = "default" | "full";
export type TeamsTableAlignment = "center" | "left" | "right";
export type TeamsTableGridStyle =
  | "accent"
  | "attention"
  | "default"
  | "emphasis"
  | "good"
  | "warning";
export type TeamsTableVerticalAlignment = "bottom" | "center" | "top";
export type TeamsTextStyle = "bold" | "muted" | "plain";

export interface TeamsCardElement {
  children: TeamsCardChild[];
  imageUrl?: string;
  subtitle?: string;
  title?: string;
  type: "card";
  /** Width hint; "full" renders a full-width Adaptive Card in Teams */
  width?: TeamsCardWidth;
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
  /** Hover text rendered as the Adaptive Card action tooltip */
  tooltip?: string;
  type: "button";
  value?: string;
}

export interface TeamsLinkButtonElement {
  label: string;
  style?: TeamsButtonStyle;
  /** Hover text rendered as the Adaptive Card action tooltip */
  tooltip?: string;
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
  /** Horizontal alignment of cell content, one entry per column */
  align?: TeamsTableAlignment[];
  /** Draw grid lines between cells (default true) */
  gridLines?: boolean;
  /** Style of the grid lines between cells */
  gridStyle?: TeamsTableGridStyle;
  headers: string[];
  rows: string[][];
  type: "table";
  /** Vertical alignment of cell content */
  verticalAlign?: TeamsTableVerticalAlignment;
  /** Relative column widths, one positive integer weight per column (default 1 each) */
  widths?: number[];
}

export interface TeamsAdaptiveCard {
  $schema: string;
  actions?: unknown[];
  body: unknown[];
  msteams?: { width: "full" };
  type: "AdaptiveCard";
  version: "1.5";
}
