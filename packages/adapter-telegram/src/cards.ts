/**
 * Telegram inline keyboard converter for cross-platform cards.
 *
 * Converts CardElement to Telegram message text + inline keyboard markup.
 * Telegram doesn't have rich cards like Slack Block Kit, so we render
 * card content as formatted text with inline keyboard buttons for actions.
 *
 * @see https://core.telegram.org/bots/api#inlinekeyboardmarkup
 */

import { cardToFallbackText as sharedCardToFallbackText } from "@chat-adapter/shared";
import type {
  ActionsElement,
  ButtonElement,
  CardChild,
  CardElement,
  LinkButtonElement,
} from "chat";
import type { InlineKeyboardButton, InlineKeyboardMarkup } from "grammy/types";
import { escapeMarkdownV2 } from "./markdown";

/** Result of converting a card to Telegram format */
export interface TelegramCardResult {
  /** Inline keyboard markup for buttons */
  reply_markup?: InlineKeyboardMarkup;
  /** Formatted text content */
  text: string;
}

/**
 * Convert a CardElement to Telegram format (text + inline keyboard).
 */
export function cardToTelegram(card: CardElement): TelegramCardResult {
  const textParts: string[] = [];
  const keyboardRows: InlineKeyboardButton[][] = [];

  if (card.title) {
    textParts.push(`*${escapeMarkdownV2(card.title)}*`);
  }

  if (card.subtitle) {
    textParts.push(escapeMarkdownV2(card.subtitle));
  }

  for (const child of card.children) {
    const { text, buttons } = convertChild(child);
    if (text) {
      textParts.push(text);
    }
    if (buttons.length > 0) {
      keyboardRows.push(buttons);
    }
  }

  const result: TelegramCardResult = {
    text: textParts.join("\n\n"),
  };

  if (keyboardRows.length > 0) {
    result.reply_markup = {
      inline_keyboard: keyboardRows,
    };
  }

  return result;
}

function convertChild(child: CardChild): {
  text: string;
  buttons: InlineKeyboardButton[];
} {
  switch (child.type) {
    case "text":
      return { text: escapeMarkdownV2(child.content), buttons: [] };
    case "fields":
      return {
        text: child.children
          .map(
            (f) =>
              `*${escapeMarkdownV2(f.label)}*: ${escapeMarkdownV2(f.value)}`
          )
          .join("\n"),
        buttons: [],
      };
    case "actions":
      return { text: "", buttons: convertActions(child) };
    case "section":
      return convertSection(child);
    case "divider":
      return { text: escapeMarkdownV2("---"), buttons: [] };
    case "image":
      return {
        text: child.alt
          ? `[${escapeMarkdownV2(child.alt)}](${escapeMarkdownV2(child.url)})`
          : escapeMarkdownV2(child.url),
        buttons: [],
      };
    default:
      return { text: "", buttons: [] };
  }
}

function convertActions(element: ActionsElement): InlineKeyboardButton[] {
  return element.children.map((child) => {
    if (child.type === "link-button") {
      return convertLinkButton(child);
    }
    return convertButton(child as ButtonElement);
  });
}

function convertButton(button: ButtonElement): InlineKeyboardButton {
  return {
    text: button.label,
    callback_data: button.value ? `${button.id}:${button.value}` : button.id,
  };
}

function convertLinkButton(button: LinkButtonElement): InlineKeyboardButton {
  return {
    text: button.label,
    url: button.url,
  };
}

function convertSection(child: CardChild & { type: "section" }): {
  text: string;
  buttons: InlineKeyboardButton[];
} {
  const textParts: string[] = [];
  const allButtons: InlineKeyboardButton[] = [];

  for (const sectionChild of child.children) {
    const { text, buttons } = convertChild(sectionChild);
    if (text) {
      textParts.push(text);
    }
    allButtons.push(...buttons);
  }

  return { text: textParts.join("\n"), buttons: allButtons };
}

/**
 * Generate fallback text from a card element.
 * Used when inline keyboards aren't supported or for notifications.
 */
export function cardToFallbackText(card: CardElement): string {
  return sharedCardToFallbackText(card, {
    boldFormat: "*",
    lineBreak: "\n",
  });
}
