/**
 * Convert CardElement to WhatsApp interactive messages or text fallback.
 *
 * WhatsApp supports two types of interactive messages:
 * - Reply buttons: up to 3 buttons (title max 20 chars)
 * - List messages: up to 10 rows across sections (title max 24 chars)
 *
 * Cards that exceed these limits fall back to formatted text messages.
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-messages
 */

import type {
  ActionsElement,
  ButtonElement,
  CardChild,
  CardElement,
  FieldsElement,
  TextElement,
} from "chat";
import type { WhatsAppInteractiveMessage } from "./types";

const CALLBACK_DATA_PREFIX = "chat:";

interface WhatsAppCardActionPayload {
  a: string;
  v?: string;
}

/** Maximum number of reply buttons WhatsApp allows */
const MAX_REPLY_BUTTONS = 3;

/** Maximum character length for a button title */
const MAX_BUTTON_TITLE_LENGTH = 20;

/** Maximum character length for the body text */
const MAX_BODY_LENGTH = 1024;

/**
 * Result of converting a CardElement. Either an interactive message
 * (when buttons fit WhatsApp constraints) or a text fallback.
 */
export type WhatsAppCardResult =
  | { interactive: WhatsAppInteractiveMessage; type: "interactive" }
  | { text: string; type: "text" };

/**
 * Encode an action ID and optional value into a callback data string.
 * Format: "chat:{json}" where json is { a: actionId, v?: value }
 */
export function encodeWhatsAppCallbackData(
  actionId: string,
  value?: string
): string {
  const payload: WhatsAppCardActionPayload = { a: actionId };
  if (typeof value === "string") {
    payload.v = value;
  }
  return `${CALLBACK_DATA_PREFIX}${JSON.stringify(payload)}`;
}

/**
 * Decode callback data from a WhatsApp interactive reply.
 * Returns the actionId and optional value.
 */
export function decodeWhatsAppCallbackData(data?: string): {
  actionId: string;
  value: string | undefined;
} {
  if (!data) {
    return { actionId: "whatsapp_callback", value: undefined };
  }

  if (!data.startsWith(CALLBACK_DATA_PREFIX)) {
    return { actionId: data, value: data };
  }

  try {
    const decoded = JSON.parse(
      data.slice(CALLBACK_DATA_PREFIX.length)
    ) as WhatsAppCardActionPayload;

    if (typeof decoded.a === "string" && decoded.a) {
      return {
        actionId: decoded.a,
        value: typeof decoded.v === "string" ? decoded.v : undefined,
      };
    }
  } catch {
    // Fall back to passthrough behavior below.
  }

  return { actionId: data, value: data };
}

/**
 * Convert a CardElement to a WhatsApp message payload.
 *
 * If the card has action buttons that fit WhatsApp's constraints
 * (max 3 buttons, titles max 20 chars), produces an interactive
 * button message. Otherwise, produces a text fallback.
 */
export function cardToWhatsApp(card: CardElement): WhatsAppCardResult {
  const actions = findActions(card.children);
  const actionButtons = actions ? extractReplyButtons(actions) : null;

  // If we have valid buttons, produce an interactive message
  if (actionButtons && actionButtons.length > 0) {
    const bodyText = buildBodyText(card);

    return {
      type: "interactive",
      interactive: {
        type: "button",
        ...(card.title
          ? { header: { type: "text", text: truncate(card.title, 60) } }
          : {}),
        body: {
          text: truncate(
            bodyText || "Please choose an option",
            MAX_BODY_LENGTH
          ),
        },
        action: {
          buttons: actionButtons.map((btn) => ({
            type: "reply" as const,
            reply: {
              id: encodeWhatsAppCallbackData(btn.id, btn.value),
              title: truncate(btn.label, MAX_BUTTON_TITLE_LENGTH),
            },
          })),
        },
      },
    };
  }

  // Fallback to text
  return {
    type: "text",
    text: cardToWhatsAppText(card),
  };
}

/**
 * Convert a CardElement to WhatsApp-formatted text.
 *
 * Used as fallback when interactive messages can't represent the card.
 * Uses WhatsApp markdown: *bold*, _italic_, ~strikethrough~.
 */
export function cardToWhatsAppText(card: CardElement): string {
  const lines: string[] = [];

  if (card.title) {
    lines.push(`*${escapeWhatsApp(card.title)}*`);
  }

  if (card.subtitle) {
    lines.push(escapeWhatsApp(card.subtitle));
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
 * Generate plain text fallback from a card (no formatting).
 */
export function cardToPlainText(card: CardElement): string {
  const parts: string[] = [];

  if (card.title) {
    parts.push(card.title);
  }

  if (card.subtitle) {
    parts.push(card.subtitle);
  }

  for (const child of card.children) {
    const text = childToPlainText(child);
    if (text) {
      parts.push(text);
    }
  }

  return parts.join("\n");
}

// =============================================================================
// Private helpers
// =============================================================================

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

    default:
      return [];
  }
}

function renderText(text: TextElement): string[] {
  switch (text.style) {
    case "bold":
      return [`*${escapeWhatsApp(text.content)}*`];
    case "muted":
      return [`_${escapeWhatsApp(text.content)}_`];
    default:
      return [escapeWhatsApp(text.content)];
  }
}

function renderFields(fields: FieldsElement): string[] {
  return fields.children.map(
    (field) =>
      `*${escapeWhatsApp(field.label)}:* ${escapeWhatsApp(field.value)}`
  );
}

function renderActions(actions: ActionsElement): string[] {
  const buttonTexts = actions.children.map((button) => {
    if (button.type === "link-button") {
      return `${escapeWhatsApp(button.label)}: ${button.url}`;
    }
    return `[${escapeWhatsApp(button.label)}]`;
  });

  return [buttonTexts.join(" | ")];
}

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
    default:
      return null;
  }
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
 * Extract reply buttons from an ActionsElement, only if they fit
 * WhatsApp constraints (max 3 buttons, each with an ID).
 */
function extractReplyButtons(actions: ActionsElement): ButtonElement[] | null {
  const buttons: ButtonElement[] = [];

  for (const child of actions.children) {
    if (child.type === "button" && child.id) {
      buttons.push(child);
    }
    // Link buttons can't be WhatsApp reply buttons — skip them
  }

  if (buttons.length === 0 || buttons.length > MAX_REPLY_BUTTONS) {
    return null;
  }

  return buttons;
}

/**
 * Build body text from card content (excluding actions).
 */
function buildBodyText(card: CardElement): string {
  const parts: string[] = [];

  if (card.subtitle) {
    parts.push(card.subtitle);
  }

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
 * Escape WhatsApp formatting characters.
 */
function escapeWhatsApp(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/~/g, "\\~")
    .replace(/`/g, "\\`");
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
