/**
 * Feishu Interactive Card converter for cross-platform cards.
 *
 * Converts CardElement to Feishu Interactive Card (Message Card) format.
 * @see https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-structure
 */

import {
  createEmojiConverter,
  cardToFallbackText as sharedCardToFallbackText,
} from "@chat-adapter/shared";
import type {
  ActionsElement,
  ButtonElement,
  CardChild,
  CardElement,
  FieldsElement,
  ImageElement,
  LinkButtonElement,
  SectionElement,
  TextElement,
} from "chat";

import type {
  FeishuCardAction,
  FeishuCardButton,
  FeishuCardElement,
  FeishuInteractiveCard,
} from "./types";

const convertEmoji = createEmojiConverter("feishu");

/**
 * Convert a CardElement to Feishu Interactive Card format.
 */
export function cardToFeishuCard(card: CardElement): FeishuInteractiveCard {
  const elements: FeishuCardElement[] = [];

  // Build header
  let header: FeishuInteractiveCard["header"];
  if (card.title) {
    header = {
      title: { tag: "plain_text", content: convertEmoji(card.title) },
    };
  }

  // Convert children
  for (const child of card.children) {
    const converted = convertChildToElements(child);
    elements.push(...converted);
  }

  // Feishu cards need at least one element
  if (elements.length === 0) {
    elements.push({ tag: "markdown", content: "" });
  }

  const feishuCard: FeishuInteractiveCard = {
    config: { wide_screen_mode: true },
    elements,
  };

  if (header) {
    feishuCard.header = header;
  }

  return feishuCard;
}

function convertChildToElements(child: CardChild): FeishuCardElement[] {
  switch (child.type) {
    case "text":
      return [convertText(child)];
    case "image":
      return [convertImage(child)];
    case "divider":
      return [{ tag: "hr" }];
    case "actions":
      return [convertActions(child)];
    case "section":
      return convertSection(child);
    case "fields":
      return [convertFields(child)];
    default:
      return [];
  }
}

function convertText(element: TextElement): FeishuCardElement {
  let content = convertEmoji(element.content);

  if (element.style === "bold") {
    content = `**${content}**`;
  }

  return { tag: "markdown", content };
}

function convertImage(element: ImageElement): FeishuCardElement {
  return {
    tag: "img",
    img_key: element.url,
    alt: { tag: "plain_text", content: element.alt || "Image" },
  };
}

function convertActions(element: ActionsElement): FeishuCardAction {
  const actions: FeishuCardButton[] = element.children
    .filter((child) => child.type === "button" || child.type === "link-button")
    .map((button) => {
      if (button.type === "link-button") {
        return convertLinkButton(button);
      }
      return convertButton(button);
    });

  return { tag: "action", actions };
}

function convertButton(button: ButtonElement): FeishuCardButton {
  const feishuButton: FeishuCardButton = {
    tag: "button",
    text: { tag: "plain_text", content: convertEmoji(button.label) },
    value: { actionId: button.id, value: button.value || "" },
  };

  if (button.style === "primary") {
    feishuButton.type = "primary";
  } else if (button.style === "danger") {
    feishuButton.type = "danger";
  }

  return feishuButton;
}

function convertLinkButton(button: LinkButtonElement): FeishuCardButton {
  const feishuButton: FeishuCardButton = {
    tag: "button",
    text: { tag: "plain_text", content: convertEmoji(button.label) },
    url: button.url,
  };

  if (button.style === "primary") {
    feishuButton.type = "primary";
  } else if (button.style === "danger") {
    feishuButton.type = "danger";
  }

  return feishuButton;
}

function convertSection(element: SectionElement): FeishuCardElement[] {
  const elements: FeishuCardElement[] = [];
  for (const child of element.children) {
    elements.push(...convertChildToElements(child));
  }
  return elements;
}

function convertFields(element: FieldsElement): FeishuCardElement {
  return {
    tag: "div",
    fields: element.children.map((field) => ({
      is_short: true,
      text: {
        tag: "lark_md" as const,
        content: `**${convertEmoji(field.label)}**\n${convertEmoji(field.value)}`,
      },
    })),
  };
}

/**
 * Generate fallback text from a card element.
 */
export function cardToFallbackText(card: CardElement): string {
  return sharedCardToFallbackText(card, {
    boldFormat: "**",
    lineBreak: "\n",
    platform: "feishu",
  });
}
