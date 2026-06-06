import { cardToFallbackText as sharedCardToFallbackText } from "@chat-adapter/shared";
import type {
  ActionsElement,
  ButtonElement,
  CardChild,
  CardElement,
  LinkButtonElement,
} from "chat";

const CALLBACK_DATA_PREFIX = "chat:";

interface TwilioCardActionPayload {
  a: string;
  v?: string;
}

const MAX_QUICK_REPLY_BUTTONS = 11;
const MAX_BUTTON_TITLE_LENGTH = 25;
const MAX_CTA_BUTTONS = 2;

export type TwilioRcsContentResult =
  | { contentBody: TwilioContentBody; type: "content" }
  | { text: string; type: "text" };

export interface TwilioContentBody {
  friendly_name: string;
  language: string;
  types: Record<string, unknown>;
  variables?: Record<string, string>;
}

export function encodeTwilioCallbackData(
  actionId: string,
  value?: string
): string {
  const payload: TwilioCardActionPayload = { a: actionId };
  if (typeof value === "string") {
    payload.v = value;
  }
  return `${CALLBACK_DATA_PREFIX}${JSON.stringify(payload)}`;
}

export function decodeTwilioCallbackData(data?: string): {
  actionId: string;
  value: string | undefined;
} {
  if (!data) {
    return { actionId: "twilio_callback", value: undefined };
  }

  if (!data.startsWith(CALLBACK_DATA_PREFIX)) {
    return { actionId: data, value: data };
  }

  try {
    const decoded = JSON.parse(
      data.slice(CALLBACK_DATA_PREFIX.length)
    ) as TwilioCardActionPayload;

    if (typeof decoded.a === "string" && decoded.a) {
      return {
        actionId: decoded.a,
        value: typeof decoded.v === "string" ? decoded.v : undefined,
      };
    }
  } catch {
    // Malformed JSON — fall back to passthrough.
  }

  return { actionId: data, value: data };
}

export function cardToTwilioText(card: CardElement): string {
  return sharedCardToFallbackText(card).replace(/\*/g, "");
}

export function cardToTwilioRcs(card: CardElement): TwilioRcsContentResult {
  const actions = findActions(card.children);
  if (!actions) {
    return { text: cardToTwilioText(card), type: "text" };
  }

  const linkButtons = extractLinkButtons(actions);
  if (linkButtons.length > 0 && linkButtons.length <= MAX_CTA_BUTTONS) {
    return buildCtaContent(card, linkButtons);
  }

  const replyButtons = extractReplyButtons(actions);
  if (replyButtons.length > 0) {
    if (card.imageUrl || card.title) {
      return buildCardContent(card, replyButtons);
    }
    return buildQuickReplyContent(card, replyButtons);
  }

  return { text: cardToTwilioText(card), type: "text" };
}

function buildQuickReplyContent(
  card: CardElement,
  buttons: ButtonElement[]
): TwilioRcsContentResult {
  const bodyText = buildBodyText(card) || card.title || "Choose an option";
  const items = buttons.slice(0, MAX_QUICK_REPLY_BUTTONS).map((btn) => ({
    id: encodeTwilioCallbackData(btn.id, btn.value),
    title: truncate(btn.label, MAX_BUTTON_TITLE_LENGTH),
    type: "quick_reply" as const,
  }));

  return {
    type: "content",
    contentBody: {
      friendly_name: `chat_qr_${Date.now()}`,
      language: "en",
      types: {
        "twilio/quick-reply": {
          body: bodyText,
          actions: items,
        },
        "twilio/text": {
          body: smsFallbackText(card),
        },
      },
    },
  };
}

function buildCardContent(
  card: CardElement,
  buttons: ButtonElement[]
): TwilioRcsContentResult {
  const actions = buttons.slice(0, MAX_QUICK_REPLY_BUTTONS).map((btn) => ({
    id: encodeTwilioCallbackData(btn.id, btn.value),
    title: truncate(btn.label, MAX_BUTTON_TITLE_LENGTH),
    type: "quick_reply" as const,
  }));

  const cardType: Record<string, unknown> = {
    title: truncate(card.title ?? "Menu", 200),
    body: buildBodyText(card) || card.subtitle || " ",
    actions,
  };

  if (card.imageUrl) {
    cardType.media = [card.imageUrl];
  }

  return {
    type: "content",
    contentBody: {
      friendly_name: `chat_card_${Date.now()}`,
      language: "en",
      types: {
        "twilio/card": cardType,
        "twilio/text": {
          body: smsFallbackText(card),
        },
      },
    },
  };
}

function buildCtaContent(
  card: CardElement,
  links: LinkButtonElement[]
): TwilioRcsContentResult {
  const bodyText = buildBodyText(card) || card.title || "See link";
  const actions = links.slice(0, MAX_CTA_BUTTONS).map((link) => ({
    title: truncate(link.label, MAX_BUTTON_TITLE_LENGTH),
    type: "URL" as const,
    url: link.url,
  }));

  return {
    type: "content",
    contentBody: {
      friendly_name: `chat_cta_${Date.now()}`,
      language: "en",
      types: {
        "twilio/call-to-action": {
          body: bodyText,
          actions,
        },
        "twilio/text": {
          body: smsFallbackText(card),
        },
      },
    },
  };
}

function smsFallbackText(card: CardElement): string {
  return cardToTwilioText(card) || "Message from bot";
}

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

function extractReplyButtons(actions: ActionsElement): ButtonElement[] {
  const buttons: ButtonElement[] = [];
  for (const child of actions.children) {
    if (child.type === "button" && child.id) {
      buttons.push(child);
    }
  }
  return buttons.slice(0, MAX_QUICK_REPLY_BUTTONS);
}

function extractLinkButtons(actions: ActionsElement): LinkButtonElement[] {
  const links: LinkButtonElement[] = [];
  for (const child of actions.children) {
    if (child.type === "link-button") {
      links.push(child);
    }
  }
  return links;
}

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

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}\u2026`;
}
