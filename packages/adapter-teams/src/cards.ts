/**
 * Teams Adaptive Card converter for cross-platform cards.
 *
 * Converts CardElement to Microsoft Adaptive Cards format.
 * @see https://adaptivecards.io/
 */

import {
  createEmojiConverter,
  mapButtonStyle,
  cardToFallbackText as sharedCardToFallbackText,
} from "@chat-adapter/shared";
import type {
  ActionArray,
  ActionStyle,
  CardElementArray,
  ChoiceSetInputOptions,
} from "@microsoft/teams.cards";
import {
  AdaptiveCard,
  Image as AdaptiveImage,
  Choice,
  ChoiceSetInput,
  Column,
  ColumnSet,
  Container,
  Fact,
  FactSet,
  OpenUrlAction,
  SubmitAction,
  TextBlock,
} from "@microsoft/teams.cards";
import type {
  ActionsElement,
  ButtonElement,
  CardChild,
  CardElement,
  DividerElement,
  FieldsElement,
  ImageElement,
  LinkButtonElement,
  RadioSelectElement,
  SectionElement,
  SelectElement,
  TableElement,
  TextElement,
} from "chat";
import { cardChildToFallbackText } from "chat";

/**
 * Convert emoji placeholders in text to Teams format.
 */
const convertEmoji = createEmojiConverter("teams");

const ADAPTIVE_CARD_SCHEMA =
  "http://adaptivecards.io/schemas/adaptive-card.json";
const ADAPTIVE_CARD_VERSION = "1.4" as const;

/**
 * Sentinel action ID for auto-injected submit buttons.
 * Used when a card has select/radio_select inputs but no submit button.
 */
export const AUTO_SUBMIT_ACTION_ID = "__auto_submit";

/**
 * Convert a CardElement to a Teams Adaptive Card.
 */
export function cardToAdaptiveCard(card: CardElement): AdaptiveCard {
  const body: CardElementArray = [];
  const actions: ActionArray = [];

  // Add title as TextBlock
  if (card.title) {
    body.push(
      new TextBlock(convertEmoji(card.title), {
        weight: "Bolder",
        size: "Large",
        wrap: true,
      })
    );
  }

  // Add subtitle as TextBlock
  if (card.subtitle) {
    body.push(
      new TextBlock(convertEmoji(card.subtitle), {
        isSubtle: true,
        wrap: true,
      })
    );
  }

  // Add header image if present
  if (card.imageUrl) {
    body.push(new AdaptiveImage(card.imageUrl, { size: "Stretch" }));
  }

  // Convert children
  for (const child of card.children) {
    const result = convertChildToAdaptive(child);
    body.push(...result.elements);
    actions.push(...result.actions);
  }

  const adaptiveCard = new AdaptiveCard(...body).withOptions({
    $schema: ADAPTIVE_CARD_SCHEMA,
    version: ADAPTIVE_CARD_VERSION,
  });

  if (actions.length > 0) {
    adaptiveCard.withActions(...actions);
  }

  return adaptiveCard;
}

interface ConvertResult {
  actions: ActionArray;
  elements: CardElementArray;
}

/**
 * Convert a card child element to Adaptive Card elements.
 */
function convertChildToAdaptive(child: CardChild): ConvertResult {
  switch (child.type) {
    case "text":
      return { elements: [convertTextToElement(child)], actions: [] };
    case "image":
      return { elements: [convertImageToElement(child)], actions: [] };
    case "divider":
      return { elements: [convertDividerToElement(child)], actions: [] };
    case "actions":
      return convertActionsToElements(child);
    case "section":
      return convertSectionToElements(child);
    case "fields":
      return { elements: [convertFieldsToElement(child)], actions: [] };
    case "link":
      return {
        elements: [
          new TextBlock(`[${convertEmoji(child.label)}](${child.url})`, {
            wrap: true,
          }),
        ],
        actions: [],
      };
    case "table":
      return { elements: [convertTableToElement(child)], actions: [] };
    default: {
      const text = cardChildToFallbackText(child);
      if (text) {
        return {
          elements: [new TextBlock(text, { wrap: true })],
          actions: [],
        };
      }
      return { elements: [], actions: [] };
    }
  }
}

function convertTextToElement(element: TextElement): TextBlock {
  const options: { wrap: boolean; weight?: "Bolder"; isSubtle?: boolean } = {
    wrap: true,
  };

  if (element.style === "bold") {
    options.weight = "Bolder";
  } else if (element.style === "muted") {
    options.isSubtle = true;
  }

  return new TextBlock(convertEmoji(element.content), options);
}

function convertImageToElement(element: ImageElement): AdaptiveImage {
  return new AdaptiveImage(element.url, {
    altText: element.alt || "Image",
    size: "Auto",
  });
}

function convertDividerToElement(_element: DividerElement): Container {
  // Adaptive Cards don't have a native divider, use a separator container
  return new Container().withSeparator(true);
}

function convertActionsToElements(element: ActionsElement): ConvertResult {
  const actions: ActionArray = [];
  const elements: CardElementArray = [];
  let hasButtons = false;
  let hasInputs = false;

  for (const child of element.children) {
    switch (child.type) {
      case "button":
        hasButtons = true;
        actions.push(convertButtonToAction(child));
        break;
      case "link-button":
        actions.push(convertLinkButtonToAction(child));
        break;
      case "select":
        hasInputs = true;
        elements.push(convertSelectToElement(child));
        break;
      case "radio_select":
        hasInputs = true;
        elements.push(convertRadioSelectToElement(child));
        break;
      default:
        break;
    }
  }

  // Auto-inject a submit button when there are inputs but no buttons.
  // Teams inputs don't auto-submit like Slack — they need an Action.Submit.
  if (hasInputs && !hasButtons) {
    actions.push(
      new SubmitAction({
        title: "Submit",
        data: { actionId: AUTO_SUBMIT_ACTION_ID },
      })
    );
  }

  return { elements, actions };
}

function convertSelectToElement(select: SelectElement): ChoiceSetInput {
  const choices = select.options.map(
    (opt) => new Choice({ title: convertEmoji(opt.label), value: opt.value })
  );

  const options: ChoiceSetInputOptions = {
    id: select.id,
    label: convertEmoji(select.label),
    style: "compact",
    isRequired: !(select.optional ?? false),
    placeholder: select.placeholder,
    value: select.initialOption,
  };

  return new ChoiceSetInput(...choices).withOptions(options);
}

function convertRadioSelectToElement(
  radioSelect: RadioSelectElement
): ChoiceSetInput {
  const choices = radioSelect.options.map(
    (opt) => new Choice({ title: convertEmoji(opt.label), value: opt.value })
  );

  const options: ChoiceSetInputOptions = {
    id: radioSelect.id,
    label: convertEmoji(radioSelect.label),
    style: "expanded",
    isRequired: !(radioSelect.optional ?? false),
    value: radioSelect.initialOption,
  };

  return new ChoiceSetInput(...choices).withOptions(options);
}

function convertButtonToAction(button: ButtonElement): SubmitAction {
  const data: Record<string, unknown> = {
    actionId: button.id,
    value: button.value,
  };

  // Add task/fetch hint for dialog-opening buttons
  if (button.actionType === "modal") {
    data.msteams = { type: "task/fetch" };
  }

  const options: {
    title: string;
    data: Record<string, unknown>;
    style?: ActionStyle;
  } = {
    title: convertEmoji(button.label),
    data,
  };

  const style = mapButtonStyle(button.style, "teams") as
    | ActionStyle
    | undefined;
  if (style) {
    options.style = style;
  }

  return new SubmitAction(options);
}

function convertLinkButtonToAction(button: LinkButtonElement): OpenUrlAction {
  const options: { title: string; style?: ActionStyle } = {
    title: convertEmoji(button.label),
  };

  const style = mapButtonStyle(button.style, "teams") as
    | ActionStyle
    | undefined;
  if (style) {
    options.style = style;
  }

  return new OpenUrlAction(button.url, options);
}

function convertSectionToElements(element: SectionElement): ConvertResult {
  const elements: CardElementArray = [];
  const actions: ActionArray = [];

  // Wrap section in a container
  const containerItems: CardElementArray = [];

  for (const child of element.children) {
    const result = convertChildToAdaptive(child);
    containerItems.push(...result.elements);
    actions.push(...result.actions);
  }

  if (containerItems.length > 0) {
    elements.push(new Container(...containerItems));
  }

  return { elements, actions };
}

function convertTableToElement(element: TableElement): Container {
  // Adaptive Cards Table element
  const headerColumns = element.headers.map((header) =>
    new Column(
      new TextBlock(convertEmoji(header), { weight: "Bolder", wrap: true })
    ).withOptions({ width: "stretch" })
  );

  const headerRow = new ColumnSet().withColumns(...headerColumns);

  const dataRows = element.rows.map((row) => {
    const cols = row.map((cell) =>
      new Column(new TextBlock(convertEmoji(cell), { wrap: true })).withOptions(
        { width: "stretch" }
      )
    );
    return new ColumnSet().withColumns(...cols);
  });

  return new Container(headerRow, ...dataRows);
}

function convertFieldsToElement(element: FieldsElement): FactSet {
  // Use FactSet for key-value pairs
  const facts = element.children.map(
    (field) => new Fact(convertEmoji(field.label), convertEmoji(field.value))
  );

  return new FactSet(...facts);
}

/**
 * Generate fallback text from a card element.
 * Used when adaptive cards aren't supported.
 */
export function cardToFallbackText(card: CardElement): string {
  return sharedCardToFallbackText(card, {
    boldFormat: "**",
    lineBreak: "\n\n",
    platform: "teams",
  });
}
