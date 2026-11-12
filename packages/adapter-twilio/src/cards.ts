import {
  findCardActions,
  cardToFallbackText as sharedCardToFallbackText,
  truncateWithEllipsis,
} from "@chat-adapter/shared";
import type {
  ActionsElement,
  ButtonElement,
  CardChild,
  CardElement,
  LinkButtonElement,
} from "chat";
import { encodeTwilioCallbackData } from "./callback";

const MAX_QUICK_REPLY_BUTTONS = 11;
const MAX_BUTTON_TITLE_LENGTH = 25;
const MAX_CARD_TITLE_LENGTH = 200;
const MAX_CTA_BUTTONS = 2;

export const TWILIO_EMPTY_CARD_FALLBACK = "Message from bot";

export type TwilioRcsContentResult =
  | { contentBody: TwilioContentBody; type: "content" }
  | { text: string; type: "text" };

export interface TwilioContentBody {
  friendly_name?: string;
  language: string;
  types: Record<string, unknown>;
  variables?: Record<string, string>;
}

export {
  decodeTwilioCallbackData,
  encodeTwilioCallbackData,
} from "./callback";

export function cardToTwilioText(card: CardElement): string {
  return sharedCardToFallbackText(card).replace(/\*/g, "");
}

export function cardToTwilioRcs(card: CardElement): TwilioRcsContentResult {
  const actions = findCardActions(card.children);
  if (!actions) {
    return { text: cardToTwilioText(card), type: "text" };
  }

  const replyButtons = extractReplyButtons(actions);
  const linkButtons = extractLinkButtons(actions);

  if (replyButtons.length > 0) {
    // twilio/quick-reply carries only quick replies, so cards that mix in
    // link buttons render as twilio/card, which supports URL actions too.
    if (card.imageUrl || card.title || linkButtons.length > 0) {
      return buildCardContent(card, replyButtons, linkButtons);
    }
    return buildQuickReplyContent(card, replyButtons);
  }

  if (linkButtons.length > 0) {
    return buildCtaContent(card, linkButtons);
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
    title: truncateWithEllipsis(btn.label, MAX_BUTTON_TITLE_LENGTH),
    type: "quick_reply" as const,
  }));

  return {
    type: "content",
    contentBody: {
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
  buttons: ButtonElement[],
  links: LinkButtonElement[]
): TwilioRcsContentResult {
  const actions = [
    ...buttons.map((btn) => ({
      id: encodeTwilioCallbackData(btn.id, btn.value),
      title: truncateWithEllipsis(btn.label, MAX_BUTTON_TITLE_LENGTH),
      type: "quick_reply" as const,
    })),
    ...links.map((link) => ({
      title: truncateWithEllipsis(link.label, MAX_BUTTON_TITLE_LENGTH),
      type: "URL" as const,
      url: link.url,
    })),
  ].slice(0, MAX_QUICK_REPLY_BUTTONS);

  const cardType: Record<string, unknown> = {
    title: truncateWithEllipsis(card.title ?? "Menu", MAX_CARD_TITLE_LENGTH),
    body: buildBodyText(card) || card.subtitle || " ",
    actions,
  };

  if (card.imageUrl) {
    cardType.media = [card.imageUrl];
  }

  return {
    type: "content",
    contentBody: {
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
  const shown = links.slice(0, MAX_CTA_BUTTONS);
  const overflow = links.slice(MAX_CTA_BUTTONS);
  const bodyText = [
    buildBodyText(card) || card.title || "See link",
    // Call-to-action templates cap the tappable links, so extra links
    // survive as plain URLs in the body instead of being dropped.
    ...overflow.map((link) => `${link.label}: ${link.url}`),
  ].join("\n");
  const actions = shown.map((link) => ({
    title: truncateWithEllipsis(link.label, MAX_BUTTON_TITLE_LENGTH),
    type: "URL" as const,
    url: link.url,
  }));

  return {
    type: "content",
    contentBody: {
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
  return cardToTwilioText(card) || TWILIO_EMPTY_CARD_FALLBACK;
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
