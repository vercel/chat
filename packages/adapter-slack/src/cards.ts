/**
 * Slack Block Kit converter for cross-platform cards.
 *
 * Converts CardElement to Slack Block Kit blocks.
 * @see https://api.slack.com/block-kit
 */

import {
  createEmojiConverter,
  mapButtonStyle,
  cardToFallbackText as sharedCardToFallbackText,
} from "@chat-adapter/shared";
import type {
  ActionsElement,
  ButtonElement,
  CardChild,
  CardElement,
  ChartElement,
  DividerElement,
  FieldsElement,
  ImageElement,
  LinkButtonElement,
  LinkElement,
  RadioSelectElement,
  SectionElement,
  SelectElement,
  TableElement,
  TextElement,
} from "chat";
import {
  cardChildToFallbackText,
  chartElementToFallbackText,
  tableElementToAscii,
} from "chat";
import { markdownBoldToSlackMrkdwn } from "./format";

/**
 * Convert emoji placeholders in text to Slack format.
 */
const convertEmoji = createEmojiConverter("slack");

// Slack Block Kit types (simplified)
export interface SlackBlock {
  block_id?: string;
  type: string;
  [key: string]: unknown;
}

interface SlackTextObject {
  emoji?: boolean;
  text: string;
  type: "plain_text" | "mrkdwn";
}

interface SlackButtonElement {
  action_id: string;
  style?: "primary" | "danger";
  text: SlackTextObject;
  type: "button";
  value?: string;
}

interface SlackLinkButtonElement {
  action_id: string;
  style?: "primary" | "danger";
  text: SlackTextObject;
  type: "button";
  url: string;
}

interface SlackOptionObject {
  description?: SlackTextObject;
  text: SlackTextObject;
  value: string;
}

interface SlackSelectElement {
  action_id: string;
  initial_option?: SlackOptionObject;
  options: SlackOptionObject[];
  placeholder?: SlackTextObject;
  type: "static_select";
}

interface SlackRadioSelectElement {
  action_id: string;
  initial_option?: SlackOptionObject;
  options: SlackOptionObject[];
  type: "radio_buttons";
}

/**
 * Convert a CardElement to Slack Block Kit blocks.
 */
export function cardToBlockKit(card: CardElement): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  // Add header if title is present
  if (card.title) {
    blocks.push({
      type: "header",
      text: {
        type: "plain_text",
        text: convertEmoji(card.title),
        emoji: true,
      },
    });
  }

  // Add subtitle as context if present
  if (card.subtitle) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: convertEmoji(card.subtitle),
        },
      ],
    });
  }

  // Add header image if present
  if (card.imageUrl) {
    blocks.push({
      type: "image",
      image_url: card.imageUrl,
      alt_text: card.title || "Card image",
    });
  }

  // Convert children — track native table/chart block usage (Slack allows
  // at most one table block and two data_visualization blocks per message)
  const state = { usedNativeTable: false, chartCount: 0 };
  for (const child of card.children) {
    const childBlocks = convertChildToBlocks(child, state);
    blocks.push(...childBlocks);
  }

  return blocks;
}

/** Per-message rendering state for Slack's native block usage limits. */
interface CardRenderState {
  chartCount: number;
  usedNativeTable: boolean;
}

/**
 * Convert a card child element to Slack blocks.
 */
function convertChildToBlocks(
  child: CardChild,
  state: CardRenderState
): SlackBlock[] {
  switch (child.type) {
    case "text":
      return [convertTextToBlock(child)];
    case "image":
      return [convertImageToBlock(child)];
    case "divider":
      return [convertDividerToBlock(child)];
    case "actions":
      return [convertActionsToBlock(child)];
    case "section":
      return convertSectionToBlocks(child, state);
    case "fields":
      return [convertFieldsToBlock(child)];
    case "link":
      return [convertLinkToBlock(child)];
    case "table":
      return convertTableToBlocks(child, state);
    case "chart":
      return [convertChartToBlock(child, state)];
    default: {
      const text = cardChildToFallbackText(child);
      if (text) {
        return [{ type: "section", text: { type: "mrkdwn", text } }];
      }
      return [];
    }
  }
}

export function convertTextToBlock(element: TextElement): SlackBlock {
  const text = markdownBoldToSlackMrkdwn(convertEmoji(element.content));
  let formattedText = text;

  // Apply style
  if (element.style === "bold") {
    formattedText = `*${text}*`;
  } else if (element.style === "muted") {
    // Slack doesn't have a muted style, use context block
    return {
      type: "context",
      elements: [{ type: "mrkdwn", text }],
    };
  }

  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: formattedText,
    },
  };
}

function convertLinkToBlock(element: LinkElement): SlackBlock {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `<${element.url}|${convertEmoji(element.label)}>`,
    },
  };
}

function convertImageToBlock(element: ImageElement): SlackBlock {
  return {
    type: "image",
    image_url: element.url,
    alt_text: element.alt || "Image",
  };
}

function convertDividerToBlock(_element: DividerElement): SlackBlock {
  return { type: "divider" };
}

type SlackActionElement =
  | SlackButtonElement
  | SlackLinkButtonElement
  | SlackSelectElement
  | SlackRadioSelectElement;

function convertActionsToBlock(element: ActionsElement): SlackBlock {
  const elements: SlackActionElement[] = element.children.map((child) => {
    if (child.type === "link-button") {
      return convertLinkButtonToElement(child);
    }
    if (child.type === "select") {
      return convertSelectToElement(child);
    }
    if (child.type === "radio_select") {
      return convertRadioSelectToElement(child);
    }
    return convertButtonToElement(child);
  });

  return {
    type: "actions",
    elements,
  };
}

function convertButtonToElement(button: ButtonElement): SlackButtonElement {
  const element: SlackButtonElement = {
    type: "button",
    text: {
      type: "plain_text",
      text: convertEmoji(button.label),
      emoji: true,
    },
    action_id: button.id,
  };

  if (button.value) {
    element.value = button.value;
  }

  const style = mapButtonStyle(button.style, "slack");
  if (style) {
    element.style = style as "primary" | "danger";
  }

  return element;
}

function convertLinkButtonToElement(
  button: LinkButtonElement
): SlackLinkButtonElement {
  const element: SlackLinkButtonElement = {
    type: "button",
    text: {
      type: "plain_text",
      text: convertEmoji(button.label),
      emoji: true,
    },
    action_id: button.id ?? `link-${button.url.slice(0, 200)}`,
    url: button.url,
  };

  const style = mapButtonStyle(button.style, "slack");
  if (style) {
    element.style = style as "primary" | "danger";
  }

  return element;
}

function convertSelectToElement(select: SelectElement): SlackSelectElement {
  const options: SlackOptionObject[] = select.options.map((opt) => {
    const option: SlackOptionObject = {
      text: { type: "plain_text" as const, text: convertEmoji(opt.label) },
      value: opt.value,
    };
    if (opt.description) {
      option.description = {
        type: "plain_text",
        text: convertEmoji(opt.description),
      };
    }
    return option;
  });
  const element: SlackSelectElement = {
    type: "static_select",
    action_id: select.id,
    options,
  };
  if (select.placeholder) {
    element.placeholder = {
      type: "plain_text",
      text: convertEmoji(select.placeholder),
    };
  }
  if (select.initialOption) {
    const initialOpt = options.find((o) => o.value === select.initialOption);
    if (initialOpt) {
      element.initial_option = initialOpt;
    }
  }
  return element;
}

function convertRadioSelectToElement(
  radioSelect: RadioSelectElement
): SlackRadioSelectElement {
  const limitedOptions = radioSelect.options.slice(0, 10);
  const options: SlackOptionObject[] = limitedOptions.map((opt) => {
    const option: SlackOptionObject = {
      text: { type: "mrkdwn" as const, text: convertEmoji(opt.label) },
      value: opt.value,
    };
    if (opt.description) {
      option.description = {
        type: "mrkdwn",
        text: convertEmoji(opt.description),
      };
    }
    return option;
  });

  const element: SlackRadioSelectElement = {
    type: "radio_buttons",
    action_id: radioSelect.id,
    options,
  };
  if (radioSelect.initialOption) {
    const initialOpt = options.find(
      (o) => o.value === radioSelect.initialOption
    );
    if (initialOpt) {
      element.initial_option = initialOpt;
    }
  }
  return element;
}

// Slack's section text object limit
const SECTION_TEXT_MAX_CHARS = 3000;

/**
 * Wrap ASCII fallback content in a fenced code block inside a section,
 * truncating the content so the section text stays within Slack's
 * 3,000-character limit while keeping the closing fence intact.
 */
function asciiFallbackBlock(content: string): SlackBlock {
  const fence = (body: string) => `\`\`\`\n${body}\n\`\`\``;
  const budget = SECTION_TEXT_MAX_CHARS - fence("").length;
  const text =
    content.length > budget
      ? fence(`${content.slice(0, budget - 1)}…`)
      : fence(content);
  return { type: "section", text: { type: "mrkdwn", text } };
}

const DATA_TABLE_MAX_ROWS = 100;
const DATA_TABLE_MAX_COLS = 20;
// A single table (all cells combined) can't exceed 10,000 characters
const DATA_TABLE_MAX_CHARS = 10_000;
const DATA_TABLE_MIN_PAGE_SIZE = 1;
const DATA_TABLE_MAX_PAGE_SIZE = 100;

/**
 * Convert a table element to Slack Block Kit blocks.
 * Uses the data table block (paginated + sortable) with first-row-as-headers
 * schema when the table has at least one data row.
 * Falls back to the plain table block for header-only tables, and to an
 * ASCII code block for tables exceeding Slack limits (100 data rows,
 * 20 columns, 10,000 characters) or when a native table block has already
 * been used in this message.
 * @see https://docs.slack.dev/reference/block-kit/blocks/data-table-block/
 */
function convertTableToBlocks(
  element: TableElement,
  state: CardRenderState
): SlackBlock[] {
  const cellCharCount = [element.headers, ...element.rows]
    .flat()
    .reduce((total, cell) => total + cell.length, 0);

  if (
    state.usedNativeTable ||
    element.rows.length > DATA_TABLE_MAX_ROWS ||
    element.headers.length > DATA_TABLE_MAX_COLS ||
    cellCharCount > DATA_TABLE_MAX_CHARS
  ) {
    // Fall back to ASCII table in a code block
    return [
      asciiFallbackBlock(tableElementToAscii(element.headers, element.rows)),
    ];
  }

  state.usedNativeTable = true;

  // First row is headers, subsequent rows are data
  const headerRow = element.headers.map((header) => ({
    type: "raw_text" as const,
    text: convertEmoji(header) || " ",
  }));

  const dataRows = element.rows.map((row) =>
    row.map((cell) => ({
      type: "raw_text" as const,
      text: convertEmoji(cell) || " ",
    }))
  );

  // The data table block requires a header row plus at least one data row
  if (dataRows.length === 0) {
    return [
      {
        type: "table",
        rows: [headerRow],
      },
    ];
  }

  const block: SlackBlock = {
    type: "data_table",
    caption: convertEmoji(element.caption || "Table"),
    rows: [headerRow, ...dataRows],
  };
  if (element.pageSize !== undefined) {
    block.page_size = Math.min(
      DATA_TABLE_MAX_PAGE_SIZE,
      Math.max(DATA_TABLE_MIN_PAGE_SIZE, Math.floor(element.pageSize))
    );
  }
  return [block];
}

const CHART_MAX_TITLE_CHARS = 50;
const CHART_MAX_LABEL_CHARS = 20;
const CHART_MAX_SEGMENTS = 12;
const CHART_MAX_SERIES = 12;
const CHART_MAX_DATA_POINTS = 20;
// Slack rejects messages with more than 2 data_visualization blocks
// (undocumented; enforced by the API as of July 2026)
const CHART_MAX_PER_MESSAGE = 2;

/**
 * Convert a chart element to a Slack data visualization block.
 * Falls back to the chart's data rendered as an ASCII table in a code block
 * when the chart violates Slack constraints (label lengths, series counts,
 * category/data-point mismatches, more than 2 charts per message), since
 * Slack rejects invalid charts outright rather than truncating them.
 * @see https://docs.slack.dev/reference/block-kit/blocks/data-visualization-block/
 */
function convertChartToBlock(
  element: ChartElement,
  state: CardRenderState
): SlackBlock {
  const block =
    state.chartCount < CHART_MAX_PER_MESSAGE
      ? chartToDataVisualization(element)
      : null;
  if (block) {
    state.chartCount += 1;
    return block;
  }
  return asciiFallbackBlock(chartElementToFallbackText(element));
}

/**
 * Build a data_visualization block, or return null if the chart violates
 * Slack constraints.
 */
function chartToDataVisualization(element: ChartElement): SlackBlock | null {
  const title = convertEmoji(element.title);
  if (title.length === 0 || title.length > CHART_MAX_TITLE_CHARS) {
    return null;
  }

  const { chart } = element;

  if (chart.type === "pie") {
    const validSegments =
      chart.segments.length >= 1 &&
      chart.segments.length <= CHART_MAX_SEGMENTS &&
      chart.segments.every(
        (segment) => isValidChartLabel(segment.label) && segment.value > 0
      );
    if (!validSegments) {
      return null;
    }
    return {
      type: "data_visualization",
      title,
      chart: {
        type: "pie",
        segments: chart.segments.map((segment) => ({
          label: segment.label,
          value: segment.value,
        })),
      },
    };
  }

  const { categories, series } = chart;
  const validShape =
    categories.length >= 1 &&
    categories.length <= CHART_MAX_DATA_POINTS &&
    categories.every((category) => isValidChartLabel(category)) &&
    new Set(categories).size === categories.length &&
    series.length >= 1 &&
    series.length <= CHART_MAX_SERIES &&
    series.every((s) => isValidChartLabel(s.name)) &&
    new Set(series.map((s) => s.name)).size === series.length &&
    (chart.xLabel === undefined ||
      chart.xLabel.length <= CHART_MAX_TITLE_CHARS) &&
    (chart.yLabel === undefined ||
      chart.yLabel.length <= CHART_MAX_TITLE_CHARS);
  if (!validShape) {
    return null;
  }

  // Each series needs exactly one data point per category; normalize
  // point order to the category order Slack expects.
  const normalizedSeries: { name: string; data: unknown[] }[] = [];
  for (const s of series) {
    if (s.data.length !== categories.length) {
      return null;
    }
    const byLabel = new Map(s.data.map((point) => [point.label, point]));
    const data: unknown[] = [];
    for (const category of categories) {
      const point = byLabel.get(category);
      if (!point) {
        return null;
      }
      data.push({ label: category, value: point.value });
    }
    normalizedSeries.push({ name: s.name, data });
  }

  const axisConfig: Record<string, unknown> = { categories };
  if (chart.xLabel !== undefined) {
    axisConfig.x_label = chart.xLabel;
  }
  if (chart.yLabel !== undefined) {
    axisConfig.y_label = chart.yLabel;
  }

  return {
    type: "data_visualization",
    title,
    chart: {
      type: chart.type,
      series: normalizedSeries,
      axis_config: axisConfig,
    },
  };
}

function isValidChartLabel(label: string): boolean {
  return label.length >= 1 && label.length <= CHART_MAX_LABEL_CHARS;
}

function convertSectionToBlocks(
  element: SectionElement,
  state: CardRenderState
): SlackBlock[] {
  // Flatten section children into blocks
  const blocks: SlackBlock[] = [];
  for (const child of element.children) {
    blocks.push(...convertChildToBlocks(child, state));
  }
  return blocks;
}

export function convertFieldsToBlock(element: FieldsElement): SlackBlock {
  const fields: SlackTextObject[] = [];

  for (const field of element.children) {
    // Add label and value as separate field items
    fields.push({
      type: "mrkdwn",
      text: `*${markdownBoldToSlackMrkdwn(convertEmoji(field.label))}*\n${markdownBoldToSlackMrkdwn(convertEmoji(field.value))}`,
    });
  }

  return {
    type: "section",
    fields,
  };
}

/**
 * Generate fallback text from a card element.
 * Used when blocks aren't supported or for notifications.
 */
export function cardToFallbackText(card: CardElement): string {
  return sharedCardToFallbackText(card, {
    boldFormat: "*",
    lineBreak: "\n",
    platform: "slack",
  });
}
