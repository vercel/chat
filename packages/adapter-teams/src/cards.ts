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
  ActionsElement,
  ButtonElement,
  CardChild,
  CardElement,
  DividerElement,
  FieldsElement,
  ImageElement,
  LinkButtonElement,
  SectionElement,
  TextElement,
} from "chat";

/**
 * Convert emoji placeholders in text to Teams format.
 */
const convertEmoji = createEmojiConverter("teams");

// Adaptive Card types (simplified)
export interface AdaptiveCard {
  $schema: string;
  actions?: AdaptiveCardAction[];
  body: AdaptiveCardElement[];
  type: "AdaptiveCard";
  version: string;
}

export interface AdaptiveCardElement {
  type: string;
  [key: string]: unknown;
}

export interface AdaptiveCardAction {
  data?: Record<string, unknown>;
  style?: string;
  title: string;
  type: string;
  url?: string;
}

const ADAPTIVE_CARD_SCHEMA =
  "http://adaptivecards.io/schemas/adaptive-card.json";
const ADAPTIVE_CARD_VERSION = "1.4";

/**
 * Convert a CardElement to a Teams Adaptive Card.
 */
export function cardToAdaptiveCard(card: CardElement): AdaptiveCard {
  const body: AdaptiveCardElement[] = [];
  const actions: AdaptiveCardAction[] = [];

  // Add title as TextBlock
  if (card.title) {
    body.push({
      type: "TextBlock",
      text: convertEmoji(card.title),
      weight: "bolder",
      size: "large",
      wrap: true,
    });
  }

  // Add subtitle as TextBlock
  if (card.subtitle) {
    body.push({
      type: "TextBlock",
      text: convertEmoji(card.subtitle),
      isSubtle: true,
      wrap: true,
    });
  }

  // Add header image if present
  if (card.imageUrl) {
    body.push({
      type: "Image",
      url: card.imageUrl,
      size: "stretch",
    });
  }

  // Convert children
  for (const child of card.children) {
    const result = convertChildToAdaptive(child);
    body.push(...result.elements);
    actions.push(...result.actions);
  }

  const adaptiveCard: AdaptiveCard = {
    type: "AdaptiveCard",
    $schema: ADAPTIVE_CARD_SCHEMA,
    version: ADAPTIVE_CARD_VERSION,
    body,
  };

  if (actions.length > 0) {
    adaptiveCard.actions = actions;
  }

  return adaptiveCard;
}

interface ConvertResult {
  actions: AdaptiveCardAction[];
  elements: AdaptiveCardElement[];
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
          {
            type: "TextBlock",
            text: `[${convertEmoji(child.label)}](${child.url})`,
            wrap: true,
          },
        ],
        actions: [],
      };
    default:
      return { elements: [], actions: [] };
  }
}

function convertTextToElement(element: TextElement): AdaptiveCardElement {
  const textBlock: AdaptiveCardElement = {
    type: "TextBlock",
    text: convertEmoji(element.content),
    wrap: true,
  };

  if (element.style === "bold") {
    textBlock.weight = "bolder";
  } else if (element.style === "muted") {
    textBlock.isSubtle = true;
  }

  return textBlock;
}

function convertImageToElement(element: ImageElement): AdaptiveCardElement {
  return {
    type: "Image",
    url: element.url,
    altText: element.alt || "Image",
    size: "auto",
  };
}

function convertDividerToElement(
  _element: DividerElement
): AdaptiveCardElement {
  // Adaptive Cards don't have a native divider, use a separator container
  return {
    type: "Container",
    separator: true,
    items: [],
  };
}

function convertActionsToElements(element: ActionsElement): ConvertResult {
  // In Adaptive Cards, actions go at the card level, not inline
  const actions: AdaptiveCardAction[] = element.children
    .filter((child) => child.type === "button" || child.type === "link-button")
    .map((button) => {
      if (button.type === "link-button") {
        return convertLinkButtonToAction(button);
      }
      return convertButtonToAction(button);
    });

  return { elements: [], actions };
}

function convertButtonToAction(button: ButtonElement): AdaptiveCardAction {
  const action: AdaptiveCardAction = {
    type: "Action.Submit",
    title: convertEmoji(button.label),
    data: {
      actionId: button.id,
      value: button.value,
    },
  };

  const style = mapButtonStyle(button.style, "teams");
  if (style) {
    action.style = style;
  }

  return action;
}

function convertLinkButtonToAction(
  button: LinkButtonElement
): AdaptiveCardAction {
  const action: AdaptiveCardAction = {
    type: "Action.OpenUrl",
    title: convertEmoji(button.label),
    url: button.url,
  };

  const style = mapButtonStyle(button.style, "teams");
  if (style) {
    action.style = style;
  }

  return action;
}

function convertSectionToElements(element: SectionElement): ConvertResult {
  const elements: AdaptiveCardElement[] = [];
  const actions: AdaptiveCardAction[] = [];

  // Wrap section in a container
  const containerItems: AdaptiveCardElement[] = [];

  for (const child of element.children) {
    const result = convertChildToAdaptive(child);
    containerItems.push(...result.elements);
    actions.push(...result.actions);
  }

  if (containerItems.length > 0) {
    elements.push({
      type: "Container",
      items: containerItems,
    });
  }

  return { elements, actions };
}

function convertFieldsToElement(element: FieldsElement): AdaptiveCardElement {
  // Use FactSet for key-value pairs
  const facts = element.children.map((field) => ({
    title: convertEmoji(field.label),
    value: convertEmoji(field.value),
  }));

  return {
    type: "FactSet",
    facts,
  };
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
