import type { ActionsElement, CardChild, CardElement } from "chat";
import { tableElementToAscii } from "chat";

/**
 * Twitch chat is one line, so card parts are joined with a visible separator
 * instead of line breaks that would collapse into plain spaces.
 */
const PART_SEPARATOR = " · ";

/**
 * Render a card as plain text for Twitch chat.
 *
 * Twitch chat has no interactive card surface, so cards degrade to readable
 * text: parts are joined with ` · `, link buttons become `label: url`, and
 * callback buttons are dropped (there is no way to receive the click).
 */
export function cardToTwitchText(card: CardElement): string {
  const parts: string[] = [];

  if (card.title) {
    parts.push(card.title);
  }
  if (card.subtitle) {
    parts.push(card.subtitle);
  }

  for (const child of card.children) {
    const text = childToText(child);
    if (text) {
      parts.push(text);
    }
  }

  return parts.join(PART_SEPARATOR);
}

function childToText(child: CardChild): string | null {
  switch (child.type) {
    case "text":
      return child.content;
    case "image":
      return child.url;
    case "divider":
      return null;
    case "actions":
      return actionsToText(child);
    case "section": {
      const lines = child.children
        .map((sectionChild) => childToText(sectionChild))
        .filter(Boolean);
      return lines.length > 0 ? lines.join(PART_SEPARATOR) : null;
    }
    case "link":
      return child.label && child.label !== child.url
        ? `${child.label}: ${child.url}`
        : child.url;
    case "fields":
      return child.children
        .map((field) => `${field.label}: ${field.value}`)
        .join(PART_SEPARATOR);
    case "table":
      return tableElementToAscii(child.headers, child.rows);
    default:
      return null;
  }
}

function actionsToText(actions: ActionsElement): string | null {
  const lines: string[] = [];
  for (const element of actions.children) {
    if (element.type === "link-button") {
      lines.push(
        element.label && element.label !== element.url
          ? `${element.label}: ${element.url}`
          : element.url
      );
    }
  }
  return lines.length > 0 ? lines.join(PART_SEPARATOR) : null;
}
