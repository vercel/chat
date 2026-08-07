/**
 * Convert CardElement to WhatsApp interactive messages or text fallback.
 *
 * WhatsApp supports interactive messages including:
 * - Reply buttons: up to 3 buttons (title max 20 chars)
 * - List messages: up to 10 rows across sections (title max 24 chars)
 * - CTA URL: a single link button mapped to interactive.type "cta_url"
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
  LinkButtonElement,
  TextElement,
} from "chat";
import type { WhatsAppInteractiveMessage } from "./types";

const CALLBACK_DATA_PREFIX = "chat:";

/** cta_url URLs must be web links — Meta rejects other schemes. */
const HTTP_URL_REGEX = /^https?:\/\//i;

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

/** Maximum character length for a text header */
const MAX_HEADER_LENGTH = 60;

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

  // Passthrough for legacy or externally-generated button IDs that don't
  // use the chat: prefix — treat the raw string as both actionId and value.
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
    // Malformed JSON after prefix — fall back to passthrough.
  }

  // Same passthrough as non-prefixed data: treat raw string as both fields.
  return { actionId: data, value: data };
}

/** Options for {@link cardToWhatsApp}. */
export interface CardToWhatsAppOptions {
  /**
   * Allow promoting a lone LinkButton to a native cta_url message.
   * Disabled when media accompanies the card, where the text fallback
   * doubles as the media caption and an extra interactive send would
   * change the delivery shape. Defaults to true.
   */
  allowCtaUrl?: boolean;
}

/**
 * Convert a CardElement to a WhatsApp message payload.
 *
 * If the card has action buttons that fit WhatsApp's constraints
 * (max 3 buttons, titles max 20 chars), produces an interactive
 * button message. A card whose only interactive element is a single
 * LinkButton with an http(s) URL — and whose content the interactive
 * body can carry without loss — becomes a native cta_url message.
 * Otherwise, produces a text fallback.
 */
export function cardToWhatsApp(
  card: CardElement,
  options?: CardToWhatsAppOptions
): WhatsAppCardResult {
  const actions = findActions(card.children);
  const actionButtons = actions ? extractReplyButtons(actions) : null;

  if (actionButtons) {
    // Link buttons can't be WhatsApp reply buttons and cta_url can't mix
    // with them — keep their URLs reachable by appending them to the body.
    const bodyText = [buildBodyText(card), ...cardLinkButtonLines(card)]
      .filter(Boolean)
      .join("\n");

    return {
      type: "interactive",
      interactive: {
        type: "button",
        ...buildInteractiveEnvelope(
          card,
          bodyText || "Please choose an option"
        ),
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

  if (options?.allowCtaUrl !== false) {
    const ctaLink = findPromotableCtaLink(card);
    if (ctaLink) {
      return {
        type: "interactive",
        interactive: {
          type: "cta_url",
          ...buildInteractiveEnvelope(card, buildBodyText(card) || "Open link"),
          action: {
            name: "cta_url",
            parameters: {
              display_text: truncate(ctaLink.label, MAX_BUTTON_TITLE_LENGTH),
              url: ctaLink.url,
            },
          },
        },
      };
    }
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
 * Render "Label: url" lines for every LinkButton in a card, including
 * those nested inside sections. Caption/fallback text excludes action
 * elements, so these lines keep link URLs reachable.
 */
export function cardLinkButtonLines(card: CardElement): string[] {
  return collectLinkButtons(card.children).map(
    (link) => `${link.label}: ${link.url}`
  );
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

  if (buttons.length === 0) {
    return null;
  }

  // WhatsApp allows max 3 reply buttons — take the first 3
  return buttons.slice(0, MAX_REPLY_BUTTONS);
}

/**
 * Build the header/body envelope shared by all interactive messages.
 */
function buildInteractiveEnvelope(
  card: CardElement,
  bodyText: string
): {
  body: { text: string };
  header?: { text: string; type: "text" };
} {
  return {
    ...(card.title
      ? {
          header: {
            type: "text" as const,
            text: truncate(card.title, MAX_HEADER_LENGTH),
          },
        }
      : {}),
    body: {
      text: truncate(bodyText, MAX_BODY_LENGTH),
    },
  };
}

/**
 * Find a LinkButton that can be promoted to a native cta_url message.
 *
 * Meta CTA URL messages support exactly one URL button and cannot mix
 * with reply buttons, selects, or radio selects, so promotion requires
 * the card's only interactive element (across every actions row) to be
 * a single LinkButton. The URL must be http(s) and the label non-empty,
 * or the Cloud API rejects the send with a 400 — anything else keeps
 * the always-deliverable text fallback.
 */
function findPromotableCtaLink(card: CardElement): LinkButtonElement | null {
  if (card.imageUrl) {
    return null;
  }

  const interactiveChildren = collectActions(card.children).flatMap(
    (actions) => actions.children
  );
  if (interactiveChildren.length !== 1) {
    return null;
  }

  const candidate = interactiveChildren[0];
  if (candidate.type !== "link-button") {
    return null;
  }

  if (!(HTTP_URL_REGEX.test(candidate.url) && candidate.label.trim())) {
    return null;
  }

  if (!childrenFitCtaBody(card.children)) {
    return null;
  }

  return candidate;
}

/**
 * Whether buildBodyText can carry every child without loss. Images,
 * tables, charts, and inline links would be silently dropped from an
 * interactive body, so cards containing them keep the text fallback.
 */
function childrenFitCtaBody(children: CardChild[]): boolean {
  return children.every((child) => {
    switch (child.type) {
      case "actions":
      case "divider":
      case "fields":
      case "text":
        return true;
      case "section":
        return childrenFitCtaBody(child.children);
      default:
        return false;
    }
  });
}

/**
 * Collect every ActionsElement in a list of card children, including
 * those nested inside sections.
 */
function collectActions(children: CardChild[]): ActionsElement[] {
  const found: ActionsElement[] = [];
  for (const child of children) {
    if (child.type === "actions") {
      found.push(child);
    } else if (child.type === "section") {
      found.push(...collectActions(child.children));
    }
  }
  return found;
}

/**
 * Collect every LinkButton across all actions rows in a card.
 */
function collectLinkButtons(children: CardChild[]): LinkButtonElement[] {
  return collectActions(children).flatMap((actions) =>
    actions.children.filter(
      (child): child is LinkButtonElement => child.type === "link-button"
    )
  );
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
