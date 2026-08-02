import type {
  ActionsElement,
  ButtonElement,
  CardChild,
  CardElement,
  LinkButtonElement,
} from "chat";
import { cardChildToFallbackText, parseMarkdown, toPlainText } from "chat";
import type {
  InstagramButton,
  InstagramQuickReply,
  InstagramTemplatePayload,
} from "./types";

const CALLBACK_DATA_PREFIX = "chat:";
const MAX_TEMPLATE_BUTTONS = 3;
const MAX_QUICK_REPLIES = 13;
const MAX_BUTTON_TITLE_LENGTH = 20;
const MAX_QUICK_REPLY_TITLE_LENGTH = 20;
const MAX_TITLE_LENGTH = 80;
const MAX_SUBTITLE_LENGTH = 80;
const MAX_BUTTON_TEMPLATE_TEXT_LENGTH = 640;

interface InstagramCardActionPayload {
  a: string;
  v?: string;
}

export type InstagramCardResult =
  | {
      quickReplies: InstagramQuickReply[];
      text: string;
      type: "quick_replies";
    }
  | { payload: InstagramTemplatePayload; type: "template" }
  | { text: string; type: "text" };

export function encodeInstagramCallbackData(
  actionId: string,
  value?: string
): string {
  const payload: InstagramCardActionPayload = { a: actionId };
  if (typeof value === "string") {
    payload.v = value;
  }
  return `${CALLBACK_DATA_PREFIX}${JSON.stringify(payload)}`;
}

export function decodeInstagramCallbackData(data?: string): {
  actionId: string;
  value: string | undefined;
} {
  if (!data) {
    return { actionId: "instagram_callback", value: undefined };
  }
  if (!data.startsWith(CALLBACK_DATA_PREFIX)) {
    return { actionId: data, value: data };
  }
  try {
    const decoded = JSON.parse(
      data.slice(CALLBACK_DATA_PREFIX.length)
    ) as InstagramCardActionPayload;
    if (typeof decoded.a === "string" && decoded.a) {
      return {
        actionId: decoded.a,
        value: typeof decoded.v === "string" ? decoded.v : undefined,
      };
    }
  } catch {
    // Malformed callback data is passed through for third-party payloads.
  }
  return { actionId: data, value: data };
}

export function cardToInstagram(card: CardElement): InstagramCardResult {
  const text = cardToInstagramText(card);
  const actions = findActions(card.children);

  if (actions) {
    const quickReplies = extractQuickReplies(actions);
    if (
      quickReplies.length > 0 &&
      quickReplies.length === actions.children.length &&
      quickReplies.length <= MAX_QUICK_REPLIES
    ) {
      return {
        type: "quick_replies",
        text: text || "Choose an option",
        quickReplies,
      };
    }

    const buttons = extractTemplateButtons(actions);
    if (buttons.length > 0 && buttons.length <= MAX_TEMPLATE_BUTTONS) {
      if (card.title || card.imageUrl) {
        const title = card.title || text || "Message";
        return {
          type: "template",
          payload: {
            template_type: "generic",
            elements: [
              {
                title: truncate(title, MAX_TITLE_LENGTH),
                ...(card.subtitle
                  ? { subtitle: truncate(card.subtitle, MAX_SUBTITLE_LENGTH) }
                  : {}),
                ...(card.imageUrl ? { image_url: card.imageUrl } : {}),
                buttons,
              },
            ],
          },
        };
      }

      if (text) {
        return {
          type: "template",
          payload: {
            template_type: "button",
            text: truncate(text, MAX_BUTTON_TEMPLATE_TEXT_LENGTH),
            buttons,
          },
        };
      }
    }
  }

  return { type: "text", text };
}

export function cardToInstagramText(card: CardElement): string {
  const parts: string[] = [];
  if (card.title) {
    parts.push(markdownToPlainText(card.title));
  }
  if (card.subtitle) {
    parts.push(markdownToPlainText(card.subtitle));
  }
  for (const child of card.children) {
    const text = cardChildToFallbackText(child);
    if (text) {
      parts.push(markdownToPlainText(text));
    }
  }
  return parts.join("\n");
}

function markdownToPlainText(text: string): string {
  return toPlainText(parseMarkdown(text)).trim();
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

function extractQuickReplies(actions: ActionsElement): InstagramQuickReply[] {
  const replies: InstagramQuickReply[] = [];
  for (const action of actions.children) {
    if (action.type !== "button" || !action.id) {
      continue;
    }
    replies.push({
      content_type: "text",
      title: truncate(action.label, MAX_QUICK_REPLY_TITLE_LENGTH),
      payload: encodeInstagramCallbackData(action.id, action.value),
    });
  }
  return replies.slice(0, MAX_QUICK_REPLIES);
}

function extractTemplateButtons(actions: ActionsElement): InstagramButton[] {
  const buttons: InstagramButton[] = [];
  for (const action of actions.children) {
    if (action.type === "button" && action.id) {
      buttons.push(buttonToPostback(action));
    } else if (action.type === "link-button") {
      buttons.push(linkButtonToWebUrl(action));
    }
  }
  return buttons.slice(0, MAX_TEMPLATE_BUTTONS);
}

function buttonToPostback(button: ButtonElement): InstagramButton {
  return {
    type: "postback",
    title: truncate(button.label, MAX_BUTTON_TITLE_LENGTH),
    payload: encodeInstagramCallbackData(button.id, button.value),
  };
}

function linkButtonToWebUrl(button: LinkButtonElement): InstagramButton {
  return {
    type: "web_url",
    title: truncate(button.label, MAX_BUTTON_TITLE_LENGTH),
    url: button.url,
  };
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}
