import { markdownBoldToSlackMrkdwn } from "../format";
import { SlackBlockError } from "./errors";
import { LIMITS } from "./limits";
import type {
  SlackActionsElement,
  SlackBlock,
  SlackBlocksOptions,
  SlackButtonElement,
  SlackButtonStyle,
  SlackCardChild,
  SlackCardElement,
  SlackChartElement,
  SlackFieldsElement,
  SlackImageElement,
  SlackLinkButtonElement,
  SlackLinkElement,
  SlackRadioSelectElement,
  SlackSelectElement,
  SlackSelectOptionElement,
  SlackTableElement,
  SlackTextElement,
  SlackTextObject,
} from "./types";

export { SlackBlockError } from "./errors";
export * from "./input";
export type {
  SlackActionsElement,
  SlackBlock,
  SlackBlocksOptions,
  SlackButtonElement,
  SlackButtonStyle,
  SlackCardChild,
  SlackCardElement,
  SlackChartDataPoint,
  SlackChartDefinition,
  SlackChartElement,
  SlackChartSegment,
  SlackChartSeries,
  SlackDividerElement,
  SlackFieldElement,
  SlackFieldsElement,
  SlackImageElement,
  SlackLinkButtonElement,
  SlackLinkElement,
  SlackPieChartDefinition,
  SlackRadioSelectElement,
  SlackSectionElement,
  SlackSelectElement,
  SlackSelectOptionElement,
  SlackSeriesChartDefinition,
  SlackTableAlignment,
  SlackTableElement,
  SlackTextElement,
  SlackTextObject,
  SlackTextStyle,
} from "./types";

const EMPTY_TEXT = " ";
const EMOJI_PATTERN = /\{\{emoji:([a-zA-Z0-9_+-]+)\}\}/g;

export function cardToSlackBlocks(
  card: SlackCardElement,
  options: SlackBlocksOptions = {}
): SlackBlock[] {
  const blocks: SlackBlock[] = [];
  const state = {
    chartCount: 0,
    convertEmoji: options.convertEmoji ?? convertSlackEmojiPlaceholders,
    maxBlocks: options.maxBlocks ?? LIMITS.blocks,
    usedTable: false,
  };

  if (card.title) {
    blocks.push({
      text: plainText(card.title, state.convertEmoji, LIMITS.headerText),
      type: "header",
    });
  }
  if (card.subtitle) {
    blocks.push({
      elements: [mrkdwn(card.subtitle, state.convertEmoji, LIMITS.textObject)],
      type: "context",
    });
  }
  if (card.imageUrl) {
    blocks.push({
      alt_text: truncateText(
        state.convertEmoji(card.title || "Card image"),
        LIMITS.imageAlt
      ),
      image_url: truncateText(card.imageUrl, LIMITS.imageUrl),
      type: "image",
    });
  }
  for (const child of card.children) {
    blocks.push(...cardChildToSlackBlocks(child, state));
  }
  return blocks.slice(0, state.maxBlocks);
}

export const cardToBlockKit = cardToSlackBlocks;

export function cardToSlackFallbackText(
  card: SlackCardElement,
  options: Pick<SlackBlocksOptions, "convertEmoji"> = {}
): string {
  const convertEmoji = options.convertEmoji ?? convertSlackEmojiPlaceholders;
  const lines: string[] = [];
  if (card.title) {
    lines.push(`*${convertEmoji(card.title)}*`);
  }
  if (card.subtitle) {
    lines.push(convertEmoji(card.subtitle));
  }
  for (const child of card.children) {
    const text = cardChildToFallbackText(child, convertEmoji);
    if (text) {
      lines.push(text);
    }
  }
  return lines.join("\n");
}

export const cardToFallbackText = cardToSlackFallbackText;

export function convertSlackEmojiPlaceholders(text: string): string {
  return text.replace(EMOJI_PATTERN, ":$1:");
}

function cardChildToSlackBlocks(
  child: SlackCardChild,
  state: {
    chartCount: number;
    convertEmoji: (text: string) => string;
    maxBlocks: number;
    usedTable: boolean;
  }
): SlackBlock[] {
  switch (child.type) {
    case "actions":
      return [actionsToBlock(child, state.convertEmoji)];
    case "chart":
      return [chartToBlock(child, state)];
    case "divider":
      return [{ type: "divider" }];
    case "fields":
      return [fieldsToBlock(child, state.convertEmoji)];
    case "image":
      return [imageToBlock(child, state.convertEmoji)];
    case "link":
      return [linkToBlock(child, state.convertEmoji)];
    case "section":
      return child.children.flatMap((nested) =>
        cardChildToSlackBlocks(nested, state)
      );
    case "table":
      return tableToBlocks(child, state);
    case "text":
      return [textToBlock(child, state.convertEmoji)];
    default:
      return assertNever(child);
  }
}

function textToBlock(
  element: SlackTextElement,
  convertEmoji: (text: string) => string
): SlackBlock {
  const text = markdownBoldToSlackMrkdwn(convertEmoji(element.content));
  if (element.style === "muted") {
    return {
      elements: [mrkdwn(text, (value) => value, LIMITS.textObject)],
      type: "context",
    };
  }
  return {
    text: mrkdwn(
      element.style === "bold" ? `*${text}*` : text,
      (value) => value,
      LIMITS.sectionText
    ),
    type: "section",
  };
}

function imageToBlock(
  element: SlackImageElement,
  convertEmoji: (text: string) => string
): SlackBlock {
  return {
    alt_text: truncateText(
      convertEmoji(element.alt || "Image"),
      LIMITS.imageAlt
    ),
    image_url: truncateText(element.url, LIMITS.imageUrl),
    type: "image",
  };
}

function linkToBlock(
  element: SlackLinkElement,
  convertEmoji: (text: string) => string
): SlackBlock {
  return {
    text: mrkdwn(
      `<${element.url}|${convertEmoji(element.label)}>`,
      (value) => value,
      LIMITS.sectionText
    ),
    type: "section",
  };
}

function actionsToBlock(
  element: SlackActionsElement,
  convertEmoji: (text: string) => string
): SlackBlock {
  return {
    elements: element.children
      .slice(0, LIMITS.actionsElements)
      .map((child) => actionToElement(child, convertEmoji)),
    type: "actions",
  };
}

function actionToElement(
  child:
    | SlackButtonElement
    | SlackLinkButtonElement
    | SlackRadioSelectElement
    | SlackSelectElement,
  convertEmoji: (text: string) => string
): Record<string, unknown> {
  switch (child.type) {
    case "button":
      return buttonToElement(child, convertEmoji);
    case "link-button":
      return linkButtonToElement(child, convertEmoji);
    case "radio_select":
      return radioSelectToElement(child, convertEmoji);
    case "select":
      return selectToElement(child, convertEmoji);
    default:
      return assertNever(child);
  }
}

function buttonToElement(
  button: SlackButtonElement,
  convertEmoji: (text: string) => string
): Record<string, unknown> {
  return compact({
    action_id: truncateText(button.id, LIMITS.actionId),
    style: mapButtonStyle(button.style),
    text: plainText(button.label, convertEmoji, LIMITS.buttonText),
    type: "button",
    value:
      button.value === undefined
        ? undefined
        : truncateText(button.value, LIMITS.buttonValue),
  });
}

function linkButtonToElement(
  button: SlackLinkButtonElement,
  convertEmoji: (text: string) => string
): Record<string, unknown> {
  return compact({
    action_id: truncateText(button.id ?? `link-${button.url}`, LIMITS.actionId),
    style: mapButtonStyle(button.style),
    text: plainText(button.label, convertEmoji, LIMITS.buttonText),
    type: "button",
    url: truncateText(button.url, LIMITS.buttonUrl),
  });
}

function selectToElement(
  select: SlackSelectElement,
  convertEmoji: (text: string) => string
): Record<string, unknown> {
  const options = select.options
    .slice(0, LIMITS.options)
    .map((option) => optionObject(option, convertEmoji, "plain_text"));
  return compact({
    action_id: truncateText(select.id, LIMITS.actionId),
    initial_option: findInitialOption(options, select.initialOption),
    options,
    placeholder: select.placeholder
      ? plainText(select.placeholder, convertEmoji, LIMITS.placeholder)
      : undefined,
    type: "static_select",
  });
}

function radioSelectToElement(
  select: SlackRadioSelectElement,
  convertEmoji: (text: string) => string
): Record<string, unknown> {
  const options = select.options
    .slice(0, LIMITS.radioOptions)
    .map((option) => optionObject(option, convertEmoji, "mrkdwn"));
  return compact({
    action_id: truncateText(select.id, LIMITS.actionId),
    initial_option: findInitialOption(options, select.initialOption),
    options,
    type: "radio_buttons",
  });
}

function findInitialOption(
  options: Record<string, unknown>[],
  initialOption: string | undefined
): Record<string, unknown> | undefined {
  if (initialOption === undefined) {
    return undefined;
  }
  const value = truncateText(initialOption, LIMITS.optionValue);
  return options.find((option) => option.value === value);
}

function optionObject(
  option: SlackSelectOptionElement,
  convertEmoji: (text: string) => string,
  textType: "mrkdwn" | "plain_text"
): Record<string, unknown> {
  return compact({
    description: option.description
      ? {
          text: truncateText(
            convertEmoji(option.description),
            LIMITS.optionDescription
          ),
          type: textType,
        }
      : undefined,
    text: {
      text: truncateText(convertEmoji(option.label), LIMITS.optionText),
      type: textType,
    },
    value: truncateText(option.value, LIMITS.optionValue),
  });
}

function fieldsToBlock(
  element: SlackFieldsElement,
  convertEmoji: (text: string) => string
): SlackBlock {
  return {
    fields: element.children
      .slice(0, LIMITS.fields)
      .map((field) =>
        mrkdwn(
          `*${markdownBoldToSlackMrkdwn(convertEmoji(field.label))}*\n${markdownBoldToSlackMrkdwn(convertEmoji(field.value))}`,
          (value) => value,
          LIMITS.fieldText
        )
      ),
    type: "section",
  };
}

function tableToBlocks(
  element: SlackTableElement,
  state: {
    convertEmoji: (text: string) => string;
    usedTable: boolean;
  }
): SlackBlock[] {
  const cellCharCount = [element.headers, ...element.rows]
    .flat()
    .reduce((total, cell) => total + cell.length, 0);
  if (
    state.usedTable ||
    element.rows.length + 1 > LIMITS.tableRows ||
    element.headers.length > LIMITS.tableColumns ||
    cellCharCount > LIMITS.tableChars
  ) {
    return [
      {
        text: fencedFallbackText(tableToAscii(element)),
        type: "section",
      },
    ];
  }
  state.usedTable = true;
  const rows = [
    element.headers.map((header) => rawText(header, state.convertEmoji)),
    ...element.rows.map((row) =>
      row.map((cell) => rawText(cell, state.convertEmoji))
    ),
  ];
  // The data table block requires a header row plus at least one data row;
  // fall back to the plain table block for header-only tables.
  if (element.rows.length === 0) {
    return [
      compact({
        column_settings: element.align
          ?.slice(0, LIMITS.tableColumns)
          .map((align) => (align ? { align } : null)),
        rows,
        type: "table",
      }),
    ];
  }
  return [
    compact({
      caption: state.convertEmoji(element.caption || "Table"),
      page_size:
        element.pageSize === undefined
          ? undefined
          : Math.min(
              LIMITS.tablePageSize,
              Math.max(1, Math.floor(element.pageSize))
            ),
      rows,
      type: "data_table",
    }),
  ];
}

function chartToBlock(
  element: SlackChartElement,
  state: {
    chartCount: number;
    convertEmoji: (text: string) => string;
  }
): SlackBlock {
  const block =
    state.chartCount < LIMITS.chartsPerMessage
      ? chartToDataVisualization(element, state.convertEmoji)
      : null;
  if (block) {
    state.chartCount += 1;
    return block;
  }
  // Slack rejects invalid charts (and >2 charts per message) outright
  // rather than truncating them, so render the underlying data as text.
  return {
    text: fencedFallbackText(chartToAscii(element)),
    type: "section",
  };
}

/**
 * Wrap ASCII fallback content in a fenced code block, truncating the content
 * so the section text stays within Slack's limit while keeping the closing
 * fence intact.
 */
function fencedFallbackText(content: string): SlackTextObject {
  const fence = (body: string) => `\`\`\`\n${body}\n\`\`\``;
  const budget = LIMITS.sectionText - fence("").length;
  const text =
    content.length > budget
      ? fence(`${content.slice(0, budget - 1)}…`)
      : fence(content);
  return { text, type: "mrkdwn" };
}

function chartToDataVisualization(
  element: SlackChartElement,
  convertEmoji: (text: string) => string
): SlackBlock | null {
  const title = convertEmoji(element.title);
  if (title.length === 0 || title.length > LIMITS.chartTitle) {
    return null;
  }

  const { chart } = element;

  if (chart.type === "pie") {
    const validSegments =
      chart.segments.length >= 1 &&
      chart.segments.length <= LIMITS.chartSegments &&
      chart.segments.every(
        (segment) => isValidChartLabel(segment.label) && segment.value > 0
      );
    if (!validSegments) {
      return null;
    }
    return {
      chart: {
        segments: chart.segments.map((segment) => ({
          label: segment.label,
          value: segment.value,
        })),
        type: "pie",
      },
      title,
      type: "data_visualization",
    };
  }

  const { categories, series } = chart;
  const validShape =
    categories.length >= 1 &&
    categories.length <= LIMITS.chartDataPoints &&
    categories.every((category) => isValidChartLabel(category)) &&
    new Set(categories).size === categories.length &&
    series.length >= 1 &&
    series.length <= LIMITS.chartSeries &&
    series.every((s) => isValidChartLabel(s.name)) &&
    new Set(series.map((s) => s.name)).size === series.length &&
    (chart.xLabel === undefined || chart.xLabel.length <= LIMITS.chartTitle) &&
    (chart.yLabel === undefined || chart.yLabel.length <= LIMITS.chartTitle);
  if (!validShape) {
    return null;
  }

  // Each series needs exactly one data point per category; normalize
  // point order to the category order Slack expects.
  const normalizedSeries: { data: unknown[]; name: string }[] = [];
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
    normalizedSeries.push({ data, name: s.name });
  }

  return {
    chart: {
      axis_config: compact({
        categories,
        x_label: chart.xLabel,
        y_label: chart.yLabel,
      }),
      series: normalizedSeries,
      type: chart.type,
    },
    title,
    type: "data_visualization",
  };
}

function isValidChartLabel(label: string): boolean {
  return label.length >= 1 && label.length <= LIMITS.chartLabel;
}

function chartToAscii(element: SlackChartElement): string {
  const { chart, title } = element;
  if (chart.type === "pie") {
    const table = tableToAscii({
      headers: ["Label", "Value"],
      rows: chart.segments.map((segment) => [
        segment.label,
        String(segment.value),
      ]),
      type: "table",
    });
    return `${title}\n${table}`;
  }
  const table = tableToAscii({
    headers: [chart.xLabel ?? "", ...chart.series.map((s) => s.name)],
    rows: chart.categories.map((category) => [
      category,
      ...chart.series.map((s) => {
        const point = s.data.find((p) => p.label === category);
        return point ? String(point.value) : "";
      }),
    ]),
    type: "table",
  });
  return `${title}\n${table}`;
}

function cardChildToFallbackText(
  child: SlackCardChild,
  convertEmoji: (text: string) => string
): string | undefined {
  switch (child.type) {
    case "actions":
      return undefined;
    case "chart":
      return chartToAscii(child);
    case "divider":
      return "---";
    case "fields":
      return child.children
        .map(
          (field) =>
            `${convertEmoji(field.label)}: ${convertEmoji(field.value)}`
        )
        .join("\n");
    case "image":
      return child.alt ? convertEmoji(child.alt) : undefined;
    case "link":
      return `${convertEmoji(child.label)} (${child.url})`;
    case "section":
      return child.children
        .map((nested) => cardChildToFallbackText(nested, convertEmoji))
        .filter((value): value is string => Boolean(value))
        .join("\n");
    case "table":
      return tableToAscii(child);
    case "text":
      return convertEmoji(child.content);
    default:
      return assertNever(child);
  }
}

function mrkdwn(
  text: string,
  convertEmoji: (text: string) => string,
  maxLength: number
): SlackTextObject {
  return {
    text: nonemptyText(truncateText(convertEmoji(text), maxLength)),
    type: "mrkdwn",
  };
}

function plainText(
  text: string,
  convertEmoji: (text: string) => string,
  maxLength: number
): SlackTextObject {
  return {
    emoji: true,
    text: nonemptyText(truncateText(convertEmoji(text), maxLength)),
    type: "plain_text",
  };
}

function rawText(
  text: string,
  convertEmoji: (text: string) => string
): Record<string, string> {
  return {
    text: nonemptyText(convertEmoji(text)),
    type: "raw_text",
  };
}

function mapButtonStyle(
  style: SlackButtonStyle | undefined
): "danger" | "primary" | undefined {
  return style === "danger" || style === "primary" ? style : undefined;
}

function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function nonemptyText(text: string): string {
  return text.length > 0 ? text : EMPTY_TEXT;
}

function assertNever(value: never): never {
  throw new SlackBlockError(`Unsupported Slack card element: ${String(value)}`);
}

function compact<T extends Record<string, unknown>>(value: T): T {
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      output[key] = item;
    }
  }
  return output as T;
}

function tableToAscii(table: SlackTableElement): string {
  const rows = [table.headers, ...table.rows];
  const widths = table.headers.map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0))
  );
  return rows
    .map((row) =>
      row
        .map((cell, column) => (cell ?? "").padEnd(widths[column] ?? 0))
        .join(" | ")
        .trimEnd()
    )
    .join("\n");
}
