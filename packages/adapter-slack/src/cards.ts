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
  DividerElement,
  FieldsElement,
  ImageElement,
  LinkButtonElement,
  LinkElement,
  RadioSelectElement,
  SectionElement,
  SelectElement,
  TextElement,
} from "chat";

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

  // Convert children
  for (const child of card.children) {
    const childBlocks = convertChildToBlocks(child);
    blocks.push(...childBlocks);
  }

  return blocks;
}

/**
 * Convert a card child element to Slack blocks.
 */
function convertChildToBlocks(child: CardChild): SlackBlock[] {
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
      return convertSectionToBlocks(child);
    case "fields":
      return [convertFieldsToBlock(child)];
    case "link":
      return [convertLinkToBlock(child)];
    default:
      return [];
  }
}

/** Convert standard Markdown formatting to Slack mrkdwn */
function markdownToMrkdwn(text: string): string {
  // **bold** → *bold*
  return text.replace(/\*\*(.+?)\*\*/g, "*$1*");
}

export function convertTextToBlock(element: TextElement): SlackBlock {
  const text = markdownToMrkdwn(convertEmoji(element.content));
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
    action_id: `link-${button.url.slice(0, 200)}`,
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

function convertSectionToBlocks(element: SectionElement): SlackBlock[] {
  // Flatten section children into blocks
  const blocks: SlackBlock[] = [];
  for (const child of element.children) {
    blocks.push(...convertChildToBlocks(child));
  }
  return blocks;
}

export function convertFieldsToBlock(element: FieldsElement): SlackBlock {
  const fields: SlackTextObject[] = [];

  for (const field of element.children) {
    // Add label and value as separate field items
    fields.push({
      type: "mrkdwn",
      text: `*${markdownToMrkdwn(convertEmoji(field.label))}*\n${markdownToMrkdwn(convertEmoji(field.value))}`,
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
