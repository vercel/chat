/**
 * Card elements for cross-platform rich messaging.
 *
 * Provides a builder API for creating rich cards that automatically
 * convert to platform-specific formats:
 * - Slack: Block Kit
 * - Teams: Adaptive Cards
 * - Google Chat: Card v2
 *
 * Supports both function-call and JSX syntax:
 *
 * @example Function API
 * ```ts
 * import { Card, Text, Actions, Button } from "chat";
 *
 * await thread.post(
 *   Card({
 *     title: "Order #1234",
 *     children: [
 *       Text("Total: $50.00"),
 *       Actions([
 *         Button({ id: "approve", label: "Approve", style: "primary" }),
 *         Button({ id: "reject", label: "Reject", style: "danger" }),
 *       ]),
 *     ],
 *   })
 * );
 * ```
 *
 * @example JSX API (requires jsxImportSource: "chat" in tsconfig)
 * ```tsx
 * /** @jsxImportSource chat *\/
 * import { Card, Text, Actions, Button } from "chat";
 *
 * await thread.post(
 *   <Card title="Order #1234">
 *     <Text>Total: $50.00</Text>
 *     <Actions>
 *       <Button id="approve" style="primary">Approve</Button>
 *       <Button id="reject" style="danger">Reject</Button>
 *     </Actions>
 *   </Card>
 * );
 * ```
 */

import { chartElementToFallbackText, tableElementToAscii } from "./markdown";
import type { RadioSelectElement, SelectElement } from "./modals";

// ============================================================================
// Card Element Types
// ============================================================================

/** Button style options */
export type ButtonStyle = "primary" | "danger" | "default";

/** Text style options */
export type TextStyle = "plain" | "bold" | "muted";

/** Button element for interactive actions */
export interface ButtonElement {
  /** Whether this button triggers a regular action or opens a modal dialog. Default: "action" */
  actionType?: "action" | "modal";
  /** URL to POST action data to when this button is clicked */
  callbackUrl?: string;
  /** If true, the button is displayed in an inactive state and doesn't respond to user actions */
  disabled?: boolean;
  /** Unique action ID for callback routing */
  id: string;
  /** Button label text */
  label: string;
  /** Visual style */
  style?: ButtonStyle;
  type: "button";
  /** Optional payload value sent with action callback */
  value?: string;
}

/** Link button element that opens a URL */
export interface LinkButtonElement {
  /** Optional action identifier emitted by platforms that report link clicks */
  id?: string;
  /** Button label text */
  label: string;
  /** Visual style */
  style?: ButtonStyle;
  type: "link-button";
  /** URL to open when clicked */
  url: string;
}

/** Text content element */
export interface TextElement {
  /** Text content (supports markdown in some platforms) */
  content: string;
  /** Text style */
  style?: TextStyle;
  type: "text";
}

/** Image element */
export interface ImageElement {
  /** Alt text for accessibility */
  alt?: string;
  type: "image";
  /** Image URL */
  url: string;
}

/** Visual divider/separator */
export interface DividerElement {
  type: "divider";
}

/** Container for action buttons and selects */
export interface ActionsElement {
  /** Button, link button, select, and radio select elements */
  children: (
    | ButtonElement
    | LinkButtonElement
    | SelectElement
    | RadioSelectElement
  )[];
  type: "actions";
}

/** Section container for grouping elements */
export interface SectionElement {
  /** Section children */
  children: CardChild[];
  type: "section";
}

/** Inline hyperlink element */
export interface LinkElement {
  /** Link label text */
  label: string;
  type: "link";
  /** URL to link to */
  url: string;
}

/** Field for key-value display */
export interface FieldElement {
  /** Field label */
  label: string;
  type: "field";
  /** Field value */
  value: string;
}

/** Fields container for multi-column layout */
export interface FieldsElement {
  /** Field elements */
  children: FieldElement[];
  type: "fields";
}

/** Column alignment for table elements */
export type TableAlignment = "left" | "center" | "right";

/** Table element for structured data display */
export interface TableElement {
  /** Column alignment */
  align?: TableAlignment[];
  /** Accessible table caption (used by platforms with native table support) */
  caption?: string;
  /** Column header labels */
  headers: string[];
  /** Rows per page on platforms that paginate tables (Slack: 1-100, default 5) */
  pageSize?: number;
  /** Data rows (each row is an array of cell strings) */
  rows: string[][];
  type: "table";
}

/** Chart segment for pie charts */
export interface ChartSegment {
  /** Legend label (Slack: max 20 characters) */
  label: string;
  /** Segment value; must be greater than 0. Rendered as a percentage of the total. */
  value: number;
}

/** A single data point within a chart series */
export interface ChartDataPoint {
  /** Category label; must match an entry in the chart's `categories` */
  label: string;
  /** Y-axis value (negative values are permitted) */
  value: number;
}

/** A named data series for bar, area, and line charts */
export interface ChartSeries {
  /** One data point per category */
  data: ChartDataPoint[];
  /** Legend label; must be unique within the chart (Slack: max 20 characters) */
  name: string;
}

/** Pie chart definition */
export interface PieChartDefinition {
  /** Pie segments (Slack: 1-12) */
  segments: ChartSegment[];
  type: "pie";
}

/** Bar, area, or line chart definition */
export interface SeriesChartDefinition {
  /** X-axis category labels in display order (Slack: max 20 characters each) */
  categories: string[];
  /** Data series (Slack: 1-12); each series needs one point per category */
  series: ChartSeries[];
  type: "area" | "bar" | "line";
  /** X-axis title (Slack: max 50 characters) */
  xLabel?: string;
  /** Y-axis title (Slack: max 50 characters) */
  yLabel?: string;
}

/** Chart definition, discriminated by chart type */
export type ChartDefinition = PieChartDefinition | SeriesChartDefinition;

/** Chart element for data visualization */
export interface ChartElement {
  /** Chart definition */
  chart: ChartDefinition;
  /** Chart title (Slack: max 50 characters) */
  title: string;
  type: "chart";
}

/** Union of all card child element types */
export type CardChild =
  | TextElement
  | ImageElement
  | DividerElement
  | ActionsElement
  | SectionElement
  | FieldsElement
  | LinkElement
  | TableElement
  | ChartElement;

/** Union of all element types (including nested children) */
type AnyCardElement =
  | CardChild
  | CardElement
  | ButtonElement
  | LinkButtonElement
  | LinkElement
  | FieldElement
  | SelectElement
  | RadioSelectElement;

/** Root card element */
export interface CardElement {
  /** Card content */
  children: CardChild[];
  /** Header image URL */
  imageUrl?: string;
  /** Card subtitle */
  subtitle?: string;
  /** Card title */
  title?: string;
  type: "card";
}

/** Type guard for CardElement */
export function isCardElement(value: unknown): value is CardElement {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as CardElement).type === "card"
  );
}

// ============================================================================
// Builder Functions
// ============================================================================

/** Options for Card */
export interface CardOptions {
  children?: CardChild[];
  imageUrl?: string;
  subtitle?: string;
  title?: string;
}

/**
 * Create a Card element.
 *
 * @example
 * ```ts
 * Card({
 *   title: "Welcome",
 *   children: [Text("Hello!")],
 * })
 * ```
 */
export function Card(options: CardOptions = {}): CardElement {
  return {
    type: "card",
    title: options.title,
    subtitle: options.subtitle,
    imageUrl: options.imageUrl,
    children: options.children ?? [],
  };
}

/**
 * Create a Text element.
 *
 * @example
 * ```ts
 * Text("Hello, world!")
 * Text("Important", { style: "bold" })
 * ```
 */
export function Text(
  content: string,
  options: { style?: TextStyle } = {}
): TextElement {
  return {
    type: "text",
    content,
    style: options.style,
  };
}

/**
 * Alias for Text that avoids conflicts with DOM's global Text constructor.
 * Use this when importing in environments where `Text` would conflict.
 *
 * @example
 * ```ts
 * import { CardText } from "chat";
 * CardText("Hello, world!")
 * ```
 */
export const CardText = Text;

/**
 * Create an Image element.
 *
 * @example
 * ```ts
 * Image({ url: "https://example.com/image.png", alt: "Description" })
 * ```
 */
export function Image(options: { url: string; alt?: string }): ImageElement {
  return {
    type: "image",
    url: options.url,
    alt: options.alt,
  };
}

/**
 * Create a Divider element.
 *
 * @example
 * ```ts
 * Divider()
 * ```
 */
export function Divider(): DividerElement {
  return { type: "divider" };
}

/**
 * Create a Section container.
 *
 * @example
 * ```ts
 * Section([
 *   Text("Grouped content"),
 *   Image({ url: "..." }),
 * ])
 * ```
 */
export function Section(children: CardChild[]): SectionElement {
  return {
    type: "section",
    children,
  };
}

/**
 * Create an Actions container for buttons and selects.
 *
 * @example
 * ```ts
 * Actions([
 *   Button({ id: "ok", label: "OK" }),
 *   Button({ id: "cancel", label: "Cancel" }),
 *   LinkButton({ url: "https://example.com", label: "Learn More" }),
 *   Select({ id: "priority", label: "Priority", options: [...] }),
 *   RadioSelect({ id: "status", label: "Status", options: [...] }),
 * ])
 * ```
 */
export function Actions(
  children: (
    | ButtonElement
    | LinkButtonElement
    | SelectElement
    | RadioSelectElement
  )[]
): ActionsElement {
  return {
    type: "actions",
    children,
  };
}

/** Options for Button */
export interface ButtonOptions {
  /** Whether this button triggers a regular action or opens a modal dialog. Default: "action" */
  actionType?: "action" | "modal";
  /** URL to POST action data to when this button is clicked */
  callbackUrl?: string;
  /** If true, the button is displayed in an inactive state and doesn't respond to user actions */
  disabled?: boolean;
  /** Unique action ID for callback routing */
  id: string;
  /** Button label text */
  label: string;
  /** Visual style */
  style?: ButtonStyle;
  /** Optional payload value sent with action callback */
  value?: string;
}

/**
 * Create a Button element.
 *
 * @example
 * ```ts
 * Button({ id: "submit", label: "Submit", style: "primary" })
 * Button({ id: "delete", label: "Delete", style: "danger", value: "item-123" })
 * ```
 */
export function Button(options: ButtonOptions): ButtonElement {
  return {
    type: "button",
    id: options.id,
    label: options.label,
    style: options.style,
    value: options.value,
    disabled: options.disabled,
    actionType: options.actionType,
    callbackUrl: options.callbackUrl,
  };
}

/** Options for LinkButton */
export interface LinkButtonOptions {
  /** Optional action identifier emitted by platforms that report link clicks */
  id?: string;
  /** Button label text */
  label: string;
  /** Visual style */
  style?: ButtonStyle;
  /** URL to open when clicked */
  url: string;
}

/**
 * Create a LinkButton element that opens a URL when clicked.
 *
 * @example
 * ```ts
 * LinkButton({ url: "https://example.com", label: "View Docs" })
 * LinkButton({ url: "https://example.com", label: "Learn More", style: "primary" })
 * ```
 */
export function LinkButton(options: LinkButtonOptions): LinkButtonElement {
  return {
    type: "link-button",
    id: options.id,
    url: options.url,
    label: options.label,
    style: options.style,
  };
}

/**
 * Create a Field element for key-value display.
 *
 * @example
 * ```ts
 * Field({ label: "Status", value: "Active" })
 * ```
 */
export function Field(options: { label: string; value: string }): FieldElement {
  return {
    type: "field",
    label: options.label,
    value: options.value,
  };
}

/**
 * Create a Fields container for multi-column layout.
 *
 * @example
 * ```ts
 * Fields([
 *   Field({ label: "Name", value: "John" }),
 *   Field({ label: "Email", value: "john@example.com" }),
 * ])
 * ```
 */
export function Fields(children: FieldElement[]): FieldsElement {
  return {
    type: "fields",
    children,
  };
}

/** Options for Table */
export interface TableOptions {
  /** Column alignment */
  align?: TableAlignment[];
  /** Accessible table caption (used by platforms with native table support) */
  caption?: string;
  /** Column header labels */
  headers: string[];
  /** Rows per page on platforms that paginate tables (Slack: 1-100, default 5) */
  pageSize?: number;
  /** Data rows */
  rows: string[][];
}

/**
 * Create a Table element for structured data display.
 *
 * @example
 * ```ts
 * Table({
 *   headers: ["Name", "Age", "Role"],
 *   rows: [
 *     ["Alice", "30", "Engineer"],
 *     ["Bob", "25", "Designer"],
 *   ],
 * })
 * ```
 */
export function Table(options: TableOptions): TableElement {
  return {
    type: "table",
    headers: options.headers,
    rows: options.rows,
    align: options.align,
    caption: options.caption,
    pageSize: options.pageSize,
  };
}

/** Options for Chart */
export interface ChartOptions {
  /** Chart definition (pie segments, or bar/area/line series with categories) */
  chart: ChartDefinition;
  /** Chart title (Slack: max 50 characters) */
  title: string;
}

/**
 * Create a Chart element for data visualization.
 *
 * @example Pie chart
 * ```ts
 * Chart({
 *   title: "My Favorite Candy Bars",
 *   chart: {
 *     type: "pie",
 *     segments: [
 *       { label: "Kit Kat", value: 45 },
 *       { label: "Twix", value: 28 },
 *     ],
 *   },
 * })
 * ```
 *
 * @example Line chart
 * ```ts
 * Chart({
 *   title: "Weekly Sales",
 *   chart: {
 *     type: "line",
 *     categories: ["Week 1", "Week 2"],
 *     xLabel: "Week",
 *     yLabel: "Sales",
 *     series: [
 *       {
 *         name: "Scranton",
 *         data: [
 *           { label: "Week 1", value: 120 },
 *           { label: "Week 2", value: 135 },
 *         ],
 *       },
 *     ],
 *   },
 * })
 * ```
 */
export function Chart(options: ChartOptions): ChartElement {
  return {
    type: "chart",
    title: options.title,
    chart: options.chart,
  };
}

/**
 * Create a CardLink element for inline hyperlinks.
 *
 * @example
 * ```ts
 * CardLink({ url: "https://example.com", label: "Visit Site" })
 * ```
 */
export function CardLink(options: { url: string; label: string }): LinkElement {
  return {
    type: "link",
    url: options.url,
    label: options.label,
  };
}

// ============================================================================
// React Element Support
// ============================================================================

/** React element shape (minimal typing to avoid React dependency) */
interface ReactElement {
  $$typeof: symbol;
  props: Record<string, unknown>;
  type: unknown;
}

/**
 * Check if a value is a React element.
 */
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

/**
 * Map of component functions to their names for React element conversion.
 */
const componentMap = new Map<unknown, string>([
  [Card, "Card"],
  [Text, "Text"],
  [Image, "Image"],
  [Divider, "Divider"],
  [Section, "Section"],
  [Actions, "Actions"],
  [Button, "Button"],
  [LinkButton, "LinkButton"],
  [CardLink, "CardLink"],
  [Field, "Field"],
  [Fields, "Fields"],
  [Table, "Table"],
  [Chart, "Chart"],
]);

/**
 * Convert a React element tree to a CardElement tree.
 * This allows using React's JSX with our card components.
 *
 * @example
 * ```tsx
 * import React from "react";
 * import { Card, Text, fromReactElement } from "chat";
 *
 * const element = (
 *   <Card title="Hello">
 *     <Text>World</Text>
 *   </Card>
 * );
 *
 * const card = fromReactElement(element);
 * await thread.post(card);
 * ```
 */
export function fromReactElement(element: unknown): AnyCardElement | null {
  if (!isReactElement(element)) {
    // Already a card element or primitive
    if (isCardElement(element)) {
      return element;
    }
    if (typeof element === "object" && element !== null && "type" in element) {
      return element as CardChild;
    }
    return null;
  }

  const { type, props } = element;
  const componentName = componentMap.get(type);

  if (!componentName) {
    // Check if it's an HTML element (string type like "div", "a", "span")
    if (typeof type === "string") {
      throw new Error(
        `HTML element <${type}> is not supported in card elements. ` +
          "Use Card, Text, Section, Actions, Button, Fields, Field, Image, or Divider components instead."
      );
    }

    // Unknown custom component - try to extract children
    if (props.children) {
      return convertChildren(props.children)[0] ?? null;
    }
    return null;
  }

  // Convert children recursively
  const convertedChildren = props.children
    ? convertChildren(props.children)
    : [];

  // Helper to filter for CardChild elements
  const isCardChild = (el: AnyCardElement): el is CardChild =>
    el.type !== "card" &&
    el.type !== "button" &&
    el.type !== "link-button" &&
    el.type !== "field" &&
    el.type !== "select" &&
    el.type !== "radio_select";

  // Call the appropriate builder function based on component type
  switch (componentName) {
    case "Card":
      return Card({
        title: props.title as string | undefined,
        subtitle: props.subtitle as string | undefined,
        imageUrl: props.imageUrl as string | undefined,
        children: convertedChildren.filter(isCardChild),
      });

    case "Text": {
      // JSX: <Text style="bold">content</Text>
      const content = extractTextContent(props.children);
      return Text(content, { style: props.style as TextStyle | undefined });
    }

    case "Image":
      return Image({
        url: props.url as string,
        alt: props.alt as string | undefined,
      });

    case "Divider":
      return Divider();

    case "Section":
      return Section(convertedChildren.filter(isCardChild));

    case "Actions":
      return Actions(
        convertedChildren.filter(
          (
            c
          ): c is
            | ButtonElement
            | LinkButtonElement
            | SelectElement
            | RadioSelectElement =>
            c.type === "button" ||
            c.type === "link-button" ||
            c.type === "select" ||
            c.type === "radio_select"
        )
      );

    case "Button": {
      // JSX: <Button id="x" style="primary" actionType="modal">Label</Button>
      const label = extractTextContent(props.children);
      return Button({
        id: props.id as string,
        label: (props.label as string | undefined) ?? label,
        style: props.style as ButtonStyle | undefined,
        value: props.value as string | undefined,
        actionType: props.actionType as "action" | "modal" | undefined,
        disabled: props.disabled as boolean | undefined,
      });
    }

    case "LinkButton": {
      // JSX: <LinkButton url="https://..." style="primary">Label</LinkButton>
      const label = extractTextContent(props.children);
      return LinkButton({
        url: props.url as string,
        label: (props.label as string | undefined) ?? label,
        style: props.style as ButtonStyle | undefined,
      });
    }

    case "CardLink": {
      const label = extractTextContent(props.children);
      return CardLink({
        url: props.url as string,
        label: (props.label as string | undefined) ?? label,
      });
    }

    case "Field":
      return Field({
        label: props.label as string,
        value: props.value as string,
      });

    case "Fields":
      return Fields(
        convertedChildren.filter((c): c is FieldElement => c.type === "field")
      );

    case "Table":
      return Table({
        headers: props.headers as string[],
        rows: props.rows as string[][],
        align: props.align as TableAlignment[] | undefined,
        caption: props.caption as string | undefined,
        pageSize: props.pageSize as number | undefined,
      });

    case "Chart":
      return Chart({
        title: props.title as string,
        chart: props.chart as ChartDefinition,
      });

    default:
      return null;
  }
}

/**
 * Convert React children to card elements.
 */
function convertChildren(children: unknown): AnyCardElement[] {
  if (children == null) {
    return [];
  }

  if (Array.isArray(children)) {
    return children.flatMap(convertChildren);
  }

  const converted = fromReactElement(children);
  if (converted && typeof converted === "object" && "type" in converted) {
    // If it's a card, extract its children
    if (converted.type === "card") {
      return (converted as CardElement).children;
    }
    return [converted];
  }

  return [];
}

/**
 * Extract text content from React children.
 */
function extractTextContent(children: unknown): string {
  if (typeof children === "string") {
    return children;
  }
  if (typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(extractTextContent).join("");
  }
  return "";
}

// ============================================================================
// Fallback Text Generation
// ============================================================================

/**
 * Generate plain text fallback from a CardElement.
 * Used for platforms/clients that can't render rich cards,
 * and for the SentMessage.text property.
 */
export function cardToFallbackText(card: CardElement): string {
  const parts: string[] = [];

  if (card.title) {
    parts.push(`**${card.title}**`);
  }

  if (card.subtitle) {
    parts.push(card.subtitle);
  }

  for (const child of card.children) {
    const text = cardChildToFallbackText(child);
    if (text) {
      parts.push(text);
    }
  }

  return parts.join("\n");
}

/**
 * Generate fallback text from a card child element.
 * Exported so adapter card converters can call it for unknown types.
 */
export function cardChildToFallbackText(child: CardChild): string | null {
  switch (child.type) {
    case "text":
      return child.content;
    case "link":
      return `${child.label} (${child.url})`;
    case "fields":
      return child.children.map((f) => `${f.label}: ${f.value}`).join("\n");
    case "actions":
      // Actions are interactive-only — exclude from fallback text.
      // See: https://docs.slack.dev/reference/methods/chat.postMessage
      return null;
    case "table":
      return tableElementToAscii(child.headers, child.rows);
    case "chart":
      return chartElementToFallbackText(child);
    case "section":
      return child.children
        .map((c) => cardChildToFallbackText(c))
        .filter(Boolean)
        .join("\n");
    default:
      return null;
  }
}
