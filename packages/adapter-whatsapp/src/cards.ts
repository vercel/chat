import { cardToFallbackText } from "@chat-adapter/shared";
import type {
  ActionsElement,
  ButtonElement,
  CardChild,
  CardElement,
} from "chat";
import { convertEmojiPlaceholders } from "chat";
import type {
  WhatsAppInteractiveButton,
  WhatsAppInteractiveListRow,
  WhatsAppInteractiveListSection,
  WhatsAppInteractiveMessage,
} from "./types";

const WHATSAPP_BUTTON_TITLE_LIMIT = 20;
const WHATSAPP_LIST_TITLE_LIMIT = 24;
const WHATSAPP_LIST_DESCRIPTION_LIMIT = 72;
const WHATSAPP_MAX_BUTTONS = 3;

const CALLBACK_DATA_PREFIX = "chat:";

interface WhatsAppCardActionPayload {
  a: string;
  v?: string;
}

function convertLabel(label: string): string {
  return convertEmojiPlaceholders(label, "gchat");
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit - 1)}\u2026`;
}

interface CollectedAction {
  id: string;
  label: string;
  type: "button";
  value?: string;
}

function collectActions(children: CardChild[]): CollectedAction[] {
  const actions: CollectedAction[] = [];

  for (const child of children) {
    if (child.type === "actions") {
      for (const action of (child as ActionsElement).children) {
        if (action.type === "button") {
          const button = action as ButtonElement;
          actions.push({
            type: "button",
            id: button.id,
            label: convertLabel(button.label),
            value: button.value,
          });
        }
        // link-buttons are not supported in WhatsApp interactive messages
      }
      continue;
    }

    if (child.type === "section") {
      actions.push(...collectActions(child.children));
    }
  }

  return actions;
}

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

export function cardToWhatsAppInteractive(
  card: CardElement,
  to: string
): WhatsAppInteractiveMessage | undefined {
  const actions = collectActions(card.children);
  if (actions.length === 0) {
    return undefined;
  }

  const bodyText = cardToFallbackText(card) || card.title || "Select an option";
  const header = card.title
    ? { type: "text" as const, text: card.title }
    : undefined;

  if (actions.length <= WHATSAPP_MAX_BUTTONS) {
    const buttons: WhatsAppInteractiveButton[] = actions.map((action) => ({
      type: "reply" as const,
      reply: {
        id: encodeWhatsAppCallbackData(action.id, action.value),
        title: truncate(action.label, WHATSAPP_BUTTON_TITLE_LIMIT),
      },
    }));

    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        header,
        body: { text: bodyText },
        action: { buttons },
      },
    };
  }

  const rows: WhatsAppInteractiveListRow[] = actions.map((action) => ({
    id: encodeWhatsAppCallbackData(action.id, action.value),
    title: truncate(action.label, WHATSAPP_LIST_TITLE_LIMIT),
    description: action.value
      ? truncate(action.value, WHATSAPP_LIST_DESCRIPTION_LIMIT)
      : undefined,
  }));

  const sections: WhatsAppInteractiveListSection[] = [{ rows }];

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header,
      body: { text: bodyText },
      action: {
        button: "Options",
        sections,
      },
    },
  };
}
