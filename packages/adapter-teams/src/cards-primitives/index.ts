import { convertTeamsEmojiPlaceholders } from "../format";
import type {
  TeamsActionsElement,
  TeamsAdaptiveCard,
  TeamsButtonElement,
  TeamsCardChild,
  TeamsCardElement,
  TeamsFieldsElement,
  TeamsImageElement,
  TeamsLinkButtonElement,
  TeamsLinkElement,
  TeamsRadioSelectElement,
  TeamsSectionElement,
  TeamsSelectElement,
  TeamsTableAlignment,
  TeamsTableElement,
  TeamsTableVerticalAlignment,
  TeamsTextElement,
} from "./types";

export * from "./input";
export type * from "./types";

export function cardToAdaptiveCard(card: TeamsCardElement): TeamsAdaptiveCard {
  const body: unknown[] = [];
  const actions: unknown[] = [];

  if (card.title) {
    body.push(textBlock(card.title, { size: "Large", weight: "Bolder" }));
  }
  if (card.subtitle) {
    body.push(textBlock(card.subtitle, { isSubtle: true }));
  }
  if (card.imageUrl) {
    body.push({
      size: "Stretch",
      type: "Image",
      url: card.imageUrl,
    });
  }

  for (const child of card.children) {
    const converted = convertChild(child);
    body.push(...converted.body);
    actions.push(...converted.actions);
  }

  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    ...(actions.length > 0 ? { actions } : {}),
    body,
    ...(card.width === "full" ? { msteams: { width: "full" as const } } : {}),
    type: "AdaptiveCard",
    version: "1.5",
  };
}

export function cardToTeamsFallbackText(card: TeamsCardElement): string {
  const parts = [
    card.title,
    card.subtitle,
    ...card.children.map(cardChildToFallbackText),
  ].filter(Boolean);
  return parts.join("\n\n");
}

interface ConvertedChild {
  actions: unknown[];
  body: unknown[];
}

function convertChild(child: TeamsCardChild): ConvertedChild {
  switch (child.type) {
    case "text":
      return { actions: [], body: [convertText(child)] };
    case "image":
      return { actions: [], body: [convertImage(child)] };
    case "divider":
      return { actions: [], body: [{ separator: true, type: "Container" }] };
    case "actions":
      return convertActions(child);
    case "section":
      return convertSection(child);
    case "fields":
      return { actions: [], body: [convertFields(child)] };
    case "link":
      return { actions: [], body: [convertLink(child)] };
    case "table": {
      const table = convertTable(child);
      return { actions: [], body: table === null ? [] : [table] };
    }
    default:
      return { actions: [], body: [] };
  }
}

function convertText(element: TeamsTextElement): unknown {
  return textBlock(element.content, {
    ...(element.style === "bold" ? { weight: "Bolder" } : {}),
    ...(element.style === "muted" ? { isSubtle: true } : {}),
  });
}

function convertImage(element: TeamsImageElement): unknown {
  return {
    ...(element.alt ? { altText: element.alt } : {}),
    size: "Auto",
    type: "Image",
    url: element.url,
  };
}

function convertActions(element: TeamsActionsElement): ConvertedChild {
  const body: unknown[] = [];
  const actions: unknown[] = [];
  let hasSubmitAction = false;

  for (const child of element.children) {
    switch (child.type) {
      case "button":
        hasSubmitAction = true;
        actions.push(convertButton(child));
        break;
      case "link-button":
        actions.push(convertLinkButton(child));
        break;
      case "select":
        body.push(convertSelect(child, "compact"));
        break;
      case "radio_select":
        body.push(convertSelect(child, "expanded"));
        break;
      default:
        break;
    }
  }

  if (body.length > 0 && !hasSubmitAction) {
    actions.push({
      data: { actionId: "__auto_submit" },
      title: "Submit",
      type: "Action.Submit",
    });
  }

  return { actions, body };
}

function convertButton(button: TeamsButtonElement): unknown {
  return {
    data: { actionId: button.id, value: button.value },
    ...(button.style === "danger" ? { style: "destructive" } : {}),
    ...(button.style === "primary" ? { style: "positive" } : {}),
    title: button.label,
    ...(button.tooltip
      ? { tooltip: convertTeamsEmojiPlaceholders(button.tooltip) }
      : {}),
    type: "Action.Submit",
  };
}

function convertLinkButton(button: TeamsLinkButtonElement): unknown {
  return {
    ...(button.style === "primary" ? { style: "positive" } : {}),
    title: button.label,
    ...(button.tooltip
      ? { tooltip: convertTeamsEmojiPlaceholders(button.tooltip) }
      : {}),
    type: "Action.OpenUrl",
    url: button.url,
  };
}

function convertSelect(
  select: TeamsRadioSelectElement | TeamsSelectElement,
  style: "compact" | "expanded"
): unknown {
  return {
    choices: select.options.map((option) => ({
      title: option.label,
      value: option.value,
    })),
    id: select.id,
    isRequired: !(select.optional ?? false),
    label: select.label,
    ...(select.placeholder ? { placeholder: select.placeholder } : {}),
    style,
    type: "Input.ChoiceSet",
  };
}

function convertSection(section: TeamsSectionElement): ConvertedChild {
  const body: unknown[] = [];
  const actions: unknown[] = [];
  for (const child of section.children) {
    const converted = convertChild(child);
    body.push(...converted.body);
    actions.push(...converted.actions);
  }
  return { actions, body: [{ items: body, type: "Container" }] };
}

function convertFields(fields: TeamsFieldsElement): unknown {
  return {
    facts: fields.children.map((field) => ({
      title: field.label,
      value: field.value,
    })),
    type: "FactSet",
  };
}

function convertLink(link: TeamsLinkElement): unknown {
  return textBlock(`[${link.label}](${link.url})`);
}

const TABLE_HORIZONTAL_ALIGNMENT: Record<
  TeamsTableAlignment,
  "Center" | "Left" | "Right"
> = {
  center: "Center",
  left: "Left",
  right: "Right",
};

const TABLE_VERTICAL_ALIGNMENT: Record<
  TeamsTableVerticalAlignment,
  "Bottom" | "Center" | "Top"
> = {
  bottom: "Bottom",
  center: "Center",
  top: "Top",
};

// Adaptive Cards treats a column width as a relative weight only when it is a
// positive integer; Teams desktop and mobile disagree on anything else, so an
// invalid weight falls back to the default instead of reaching the wire.
function columnWeight(width: number | undefined): number {
  return width !== undefined && Number.isInteger(width) && width > 0
    ? width
    : 1;
}

function convertTable(table: TeamsTableElement): unknown {
  // The column count follows the widest row so a short row is padded with
  // empty cells instead of shifting the grid.
  const columnCount = Math.max(
    table.headers.length,
    ...table.rows.map((row) => row.length)
  );
  // No columns means nothing to draw, as the empty ASCII fallback says.
  if (columnCount === 0) {
    return null;
  }
  const toRow = (cells: string[], options: Record<string, unknown> = {}) => ({
    cells: Array.from({ length: columnCount }, (_, index) => ({
      items: [textBlock(cells[index] ?? "", options)],
      type: "TableCell",
    })),
    type: "TableRow",
  });
  const hasHeader = table.headers.length > 0;
  const rows = table.rows.map((row) => toRow(row));
  if (hasHeader) {
    rows.unshift(toRow(table.headers, { weight: "Bolder" }));
  }

  return {
    columns: Array.from({ length: columnCount }, (_, index) => {
      const align = table.align?.[index];
      return {
        ...(align
          ? {
              horizontalCellContentAlignment: TABLE_HORIZONTAL_ALIGNMENT[align],
            }
          : {}),
        width: columnWeight(table.widths?.[index]),
      };
    }),
    // The Adaptive Cards schema spells this `firstRowAsHeader`, but the Teams
    // renderers and @microsoft/teams.cards read the plural and ignore the
    // singular.
    firstRowAsHeaders: hasHeader,
    ...(table.gridStyle ? { gridStyle: table.gridStyle } : {}),
    rows,
    showGridLines: table.gridLines ?? true,
    type: "Table",
    ...(table.verticalAlign
      ? {
          verticalCellContentAlignment:
            TABLE_VERTICAL_ALIGNMENT[table.verticalAlign],
        }
      : {}),
  };
}

function textBlock(
  text: string,
  options: Record<string, unknown> = {}
): unknown {
  return {
    text: convertTeamsEmojiPlaceholders(text),
    type: "TextBlock",
    wrap: true,
    ...options,
  };
}

function cardChildToFallbackText(child: TeamsCardChild): string {
  switch (child.type) {
    case "text":
      return child.content;
    case "image":
      return child.alt ?? child.url;
    case "divider":
      return "---";
    case "actions":
      return child.children
        .map((action) => ("label" in action ? action.label : ""))
        .filter(Boolean)
        .join(" ");
    case "section":
      return child.children
        .map(cardChildToFallbackText)
        .filter(Boolean)
        .join("\n");
    case "fields":
      return child.children
        .map((field) => `${field.label}: ${field.value}`)
        .join("\n");
    case "link":
      return `${child.label}: ${child.url}`;
    case "table":
      return [
        child.headers.join(" | "),
        ...child.rows.map((row) => row.join(" | ")),
      ].join("\n");
    default:
      return "";
  }
}
