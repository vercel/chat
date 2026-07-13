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
  | SlackChartElement
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
  /** Accessible table caption for the data table block */
  caption?: string;
  headers: string[];
  /** Rows per page (1-100; Slack defaults to 5) */
  pageSize?: number;
  rows: string[][];
  type: "table";
}

export interface SlackChartSegment {
  /** Legend label (max 20 characters) */
  label: string;
  /** Segment value; must be greater than 0 */
  value: number;
}

export interface SlackChartDataPoint {
  /** Category label; must match an entry in the chart's `categories` */
  label: string;
  /** Y-axis value (negative values are permitted) */
  value: number;
}

export interface SlackChartSeries {
  /** One data point per category */
  data: SlackChartDataPoint[];
  /** Legend label; unique within the chart (max 20 characters) */
  name: string;
}

export interface SlackPieChartDefinition {
  /** Pie segments (1-12) */
  segments: SlackChartSegment[];
  type: "pie";
}

export interface SlackSeriesChartDefinition {
  /** X-axis category labels in display order (max 20 characters each) */
  categories: string[];
  /** Data series (1-12); each series needs one point per category */
  series: SlackChartSeries[];
  type: "area" | "bar" | "line";
  /** X-axis title (max 50 characters) */
  xLabel?: string;
  /** Y-axis title (max 50 characters) */
  yLabel?: string;
}

export type SlackChartDefinition =
  | SlackPieChartDefinition
  | SlackSeriesChartDefinition;

export interface SlackChartElement {
  chart: SlackChartDefinition;
  /** Chart title (max 50 characters) */
  title: string;
  type: "chart";
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
