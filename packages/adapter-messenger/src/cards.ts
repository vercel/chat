/**
 * Convert CardElement to Messenger templates or text fallback.
 *
 * Messenger supports two template types for buttons:
 * - Generic Template: title, subtitle, image, up to 3 buttons
 * - Button Template: text with up to 3 buttons (no image)
 *
 * Cards that exceed constraints fall back to formatted text messages.
 *
 * @see https://developers.facebook.com/docs/messenger-platform/send-messages/template/generic/
 * @see https://developers.facebook.com/docs/messenger-platform/send-messages/buttons/
 */

import type {
  ActionsElement,
  ButtonElement,
  CardChild,
  CardElement,
  FieldsElement,
  LinkButtonElement,
  TextElement,
} from "chat";
import type { MessengerButton, MessengerTemplatePayload } from "./types";

const CALLBACK_DATA_PREFIX = "chat:";

interface MessengerCardActionPayload {
  a: string;
  v?: string;
}

/** Maximum number of buttons Messenger allows per template */
const MAX_BUTTONS = 3;

/** Maximum character length for a button title */
const MAX_BUTTON_TITLE_LENGTH = 20;

/** Maximum character length for subtitle in Generic Template */
const MAX_SUBTITLE_LENGTH = 80;

/** Maximum character length for text in Button Template */
const MAX_BUTTON_TEMPLATE_TEXT_LENGTH = 640;

/** Maximum character length for title in Generic Template */
const MAX_TITLE_LENGTH = 80;

/**
 * Result of converting a CardElement. Either a template payload
 * (when buttons fit Messenger constraints) or a text fallback.
 */
export type MessengerCardResult =
  | { payload: MessengerTemplatePayload; type: "template" }
  | { text: string; type: "text" };

/**
 * Encode an action ID and optional value into a callback data string.
 * Format: "chat:{json}" where json is { a: actionId, v?: value }
 */
export function encodeMessengerCallbackData(
  actionId: string,
  value?: string
): string {
  const payload: MessengerCardActionPayload = { a: actionId };
  if (typeof value === "string") {
    payload.v = value;
  }
  return `${CALLBACK_DATA_PREFIX}${JSON.stringify(payload)}`;
}

/**
 * Decode callback data from a Messenger postback.
 * Returns the actionId and optional value.
 */
export function decodeMessengerCallbackData(data?: string): {
  actionId: string;
  value: string | undefined;
} {
  if (!data) {
    return { actionId: "messenger_callback", value: undefined };
  }

  // Passthrough for legacy or externally-generated payloads that don't
  // use the chat: prefix — treat the raw string as both actionId and value.
  if (!data.startsWith(CALLBACK_DATA_PREFIX)) {
    return { actionId: data, value: data };
  }

  try {
    const decoded = JSON.parse(
      data.slice(CALLBACK_DATA_PREFIX.length)
    ) as MessengerCardActionPayload;

    if (typeof decoded.a === "string" && decoded.a) {
      return {
        actionId: decoded.a,
        value: typeof decoded.v === "string" ? decoded.v : undefined,
      };
    }
  } catch {
    // Malformed JSON after prefix — fall back to passthrough.
  }

  // Same passthrough as non-prefixed data: treat raw string as both fields.
  return { actionId: data, value: data };
}

/**
 * Convert a CardElement to a Messenger message payload.
 *
 * If the card has action buttons that fit Messenger's constraints
 * (max 3 buttons, titles max 20 chars), produces a template message.
 * Otherwise, produces a text fallback.
 */
export function cardToMessenger(card: CardElement): MessengerCardResult {
  // Check for unsupported elements that force text fallback
  if (hasUnsupportedElements(card.children)) {
    return { type: "text", text: cardToMessengerText(card) };
  }

  const actions = findActions(card.children);
  const buttons = actions ? extractButtons(actions) : null;

  // If we have valid buttons within constraints
  if (buttons && buttons.length > 0 && buttons.length <= MAX_BUTTONS) {
    // Check if any button title exceeds the limit
    const allButtonsFit = buttons.every(
      (btn) => btn.title.length <= MAX_BUTTON_TITLE_LENGTH
    );

    if (allButtonsFit) {
      // Use Generic Template if card has title or image
      if (card.title || card.imageUrl) {
        return {
          type: "template",
          payload: buildGenericTemplate(card, buttons),
        };
      }

      // Use Button Template for text-only cards with buttons
      const bodyText = buildBodyText(card);
      if (bodyText) {
        return {
          type: "template",
          payload: buildButtonTemplate(bodyText, buttons),
        };
      }
    }
  }

  // Fallback to text
  return { type: "text", text: cardToMessengerText(card) };
}

/**
 * Convert a CardElement to Messenger-formatted plain text.
 *
 * Used as fallback when templates can't represent the card.
 * Messenger doesn't support markdown formatting in regular messages.
 */
export function cardToMessengerText(card: CardElement): string {
  const lines: string[] = [];

  if (card.title) {
    lines.push(card.title);
  }

  if (card.subtitle) {
    lines.push(card.subtitle);
  }

  if ((card.title || card.subtitle) && card.children.length > 0) {
    lines.push("");
  }

  if (card.imageUrl) {
    lines.push(card.imageUrl);
    lines.push("");
  }

  for (let i = 0; i < card.children.length; i++) {
    const child = card.children[i];
    const childLines = renderChild(child);

    if (childLines.length > 0) {
      lines.push(...childLines);

      if (i < card.children.length - 1) {
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

/**
 * Build a Generic Template payload.
 */
function buildGenericTemplate(
  card: CardElement,
  buttons: MessengerButton[]
): MessengerTemplatePayload {
  const bodyText = buildBodyText(card);
  const title = card.title || bodyText || "Menu";
  // Only add subtitle if it provides new information (not duplicating title)
  const subtitle = card.subtitle || (card.title && bodyText ? bodyText : null);

  return {
    template_type: "generic",
    elements: [
      {
        title: truncate(title, MAX_TITLE_LENGTH),
        ...(subtitle
          ? { subtitle: truncate(subtitle, MAX_SUBTITLE_LENGTH) }
          : {}),
        ...(card.imageUrl ? { image_url: card.imageUrl } : {}),
        buttons,
      },
    ],
  };
}

/**
 * Build a Button Template payload.
 */
function buildButtonTemplate(
  text: string,
  buttons: MessengerButton[]
): MessengerTemplatePayload {
  return {
    template_type: "button",
    text: truncate(text, MAX_BUTTON_TEMPLATE_TEXT_LENGTH),
    buttons,
  };
}

/**
 * Check if children contain elements that can't be represented in templates.
 */
function hasUnsupportedElements(children: CardChild[]): boolean {
  for (const child of children) {
    if (child.type === "table") {
      return true;
    }
    if (child.type === "section" && hasUnsupportedElements(child.children)) {
      return true;
    }
    if (child.type === "actions") {
      for (const action of child.children) {
        if (action.type === "select" || action.type === "radio_select") {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Find the first ActionsElement in a list of card children.
 */
function findActions(children: CardChild[]): ActionsElement | null {
  for (const child of children) {
    if (child.type === "actions") {
      return child;
    }
    if (child.type === "section") {
      const nested = findActions(child.children);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

/**
 * Extract Messenger buttons from an ActionsElement.
 * Converts SDK Button to postback and LinkButton to web_url.
 */
function extractButtons(actions: ActionsElement): MessengerButton[] | null {
  const buttons: MessengerButton[] = [];

  for (const child of actions.children) {
    if (child.type === "button" && child.id) {
      buttons.push(convertButton(child));
    } else if (child.type === "link-button") {
      buttons.push(convertLinkButton(child));
    }
  }

  if (buttons.length === 0) {
    return null;
  }

  // Messenger allows max 3 buttons — take the first 3
  return buttons.slice(0, MAX_BUTTONS);
}

/**
 * Convert an SDK Button to a Messenger postback button.
 */
function convertButton(button: ButtonElement): MessengerButton {
  return {
    type: "postback",
    title: truncate(button.label, MAX_BUTTON_TITLE_LENGTH),
    payload: encodeMessengerCallbackData(button.id, button.value),
  };
}

/**
 * Convert an SDK LinkButton to a Messenger web_url button.
 */
function convertLinkButton(button: LinkButtonElement): MessengerButton {
  return {
    type: "web_url",
    title: truncate(button.label, MAX_BUTTON_TITLE_LENGTH),
    url: button.url,
  };
}

/**
 * Build body text from card content (excluding actions).
 */
function buildBodyText(card: CardElement): string {
  const parts: string[] = [];

  for (const child of card.children) {
    if (child.type === "actions") {
      continue;
    }
    const text = childToPlainText(child);
    if (text) {
      parts.push(text);
    }
  }

  return parts.join("\n");
}

/**
 * Render a card child to text lines.
 */
function renderChild(child: CardChild): string[] {
  switch (child.type) {
    case "text":
      return renderText(child);

    case "fields":
      return renderFields(child);

    case "actions":
      return renderActions(child);

    case "section":
      return child.children.flatMap(renderChild);

    case "image":
      if (child.alt) {
        return [`${child.alt}: ${child.url}`];
      }
      return [child.url];

    case "divider":
      return ["---"];

    case "link":
      return [`${child.label}: ${child.url}`];

    case "table":
      return renderTable(child);

    default:
      return [];
  }
}

/**
 * Render text element.
 */
function renderText(text: TextElement): string[] {
  return [text.content];
}

/**
 * Render fields as "Label: Value" lines.
 */
function renderFields(fields: FieldsElement): string[] {
  return fields.children.map((field) => `${field.label}: ${field.value}`);
}

/**
 * Render actions as button labels for text fallback.
 */
function renderActions(actions: ActionsElement): string[] {
  const buttonTexts = actions.children.map((button) => {
    if (button.type === "link-button") {
      return `${button.label}: ${button.url}`;
    }
    // Buttons, selects, and radio selects all render as bracketed labels
    return `[${button.label}]`;
  });

  return [buttonTexts.join(" | ")];
}

/**
 * Render a table as ASCII text.
 */
function renderTable(table: CardChild): string[] {
  if (table.type !== "table") {
    return [];
  }

  const lines: string[] = [];

  // Header row
  if (table.headers.length > 0) {
    lines.push(table.headers.join(" | "));
    lines.push(table.headers.map(() => "---").join(" | "));
  }

  // Data rows
  for (const row of table.rows) {
    lines.push(row.join(" | "));
  }

  return lines;
}

/**
 * Convert a card child to plain text.
 */
function childToPlainText(child: CardChild): string | null {
  switch (child.type) {
    case "text":
      return child.content;
    case "fields":
      return child.children.map((f) => `${f.label}: ${f.value}`).join("\n");
    case "actions":
      return null;
    case "section":
      return child.children.map(childToPlainText).filter(Boolean).join("\n");
    case "link":
      return `${child.label}: ${child.url}`;
    default:
      return null;
  }
}

/**
 * Truncate text to a maximum length, adding ellipsis if needed.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}\u2026`;
}
