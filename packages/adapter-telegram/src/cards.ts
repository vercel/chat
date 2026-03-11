import { ValidationError } from "@chat-adapter/shared";
import type { ActionsElement, CardChild, CardElement } from "chat";
import { convertEmojiPlaceholders } from "chat";
import type {
  TelegramInlineKeyboardButton,
  TelegramInlineKeyboardMarkup,
} from "./types";

const CALLBACK_DATA_PREFIX = "chat:";
const TELEGRAM_CALLBACK_DATA_LIMIT_BYTES = 64;

interface TelegramCardActionPayload {
  a: string;
  v?: string;
}

function convertLabel(label: string): string {
  return convertEmojiPlaceholders(label, "gchat");
}

function toInlineKeyboardRow(
  actions: ActionsElement
): TelegramInlineKeyboardButton[] {
  const row: TelegramInlineKeyboardButton[] = [];

  for (const action of actions.children) {
    if (action.type === "button") {
      row.push({
        text: convertLabel(action.label),
        callback_data: encodeTelegramCallbackData(action.id, action.value),
      });
      continue;
    }

    if (action.type === "link-button") {
      row.push({
        text: convertLabel(action.label),
        url: action.url,
      });
    }
  }

  return row;
}

function collectInlineKeyboardRows(
  children: CardChild[],
  rows: TelegramInlineKeyboardButton[][]
): void {
  for (const child of children) {
    if (child.type === "actions") {
      const row = toInlineKeyboardRow(child);
      if (row.length > 0) {
        rows.push(row);
      }
      continue;
    }

    if (child.type === "section") {
      collectInlineKeyboardRows(child.children, rows);
    }
  }
}

export function cardToTelegramInlineKeyboard(
  card: CardElement
): TelegramInlineKeyboardMarkup | undefined {
  const rows: TelegramInlineKeyboardButton[][] = [];
  collectInlineKeyboardRows(card.children, rows);
  if (rows.length === 0) {
    return undefined;
  }

  return {
    inline_keyboard: rows,
  };
}

export function emptyTelegramInlineKeyboard(): TelegramInlineKeyboardMarkup {
  return { inline_keyboard: [] };
}

export function encodeTelegramCallbackData(
  actionId: string,
  value?: string
): string {
  const payload: TelegramCardActionPayload = { a: actionId };
  if (typeof value === "string") {
    payload.v = value;
  }

  const callbackData = `${CALLBACK_DATA_PREFIX}${JSON.stringify(payload)}`;
  if (
    Buffer.byteLength(callbackData, "utf8") > TELEGRAM_CALLBACK_DATA_LIMIT_BYTES
  ) {
    throw new ValidationError(
      "telegram",
      `Callback payload too large for Telegram (max ${TELEGRAM_CALLBACK_DATA_LIMIT_BYTES} bytes).`
    );
  }

  return callbackData;
}

export function decodeTelegramCallbackData(data?: string): {
  actionId: string;
  value: string | undefined;
} {
  if (!data) {
    return { actionId: "telegram_callback", value: undefined };
  }

  if (!data.startsWith(CALLBACK_DATA_PREFIX)) {
    return { actionId: data, value: data };
  }

  try {
    const decoded = JSON.parse(
      data.slice(CALLBACK_DATA_PREFIX.length)
    ) as TelegramCardActionPayload;

    if (typeof decoded.a === "string" && decoded.a) {
      return {
        actionId: decoded.a,
        value: typeof decoded.v === "string" ? decoded.v : undefined,
      };
    }
  } catch {
    // Fall back to legacy passthrough behavior below.
  }

  return { actionId: data, value: data };
}
