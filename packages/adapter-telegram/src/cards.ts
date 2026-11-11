import {
  decodeCallbackData,
  encodeCallbackData,
  ValidationError,
} from "@chat-adapter/shared";
import type { ActionsElement, CardChild, CardElement } from "chat";
import { convertEmojiPlaceholders } from "chat";
import type {
  TelegramInlineKeyboardButton,
  TelegramInlineKeyboardMarkup,
} from "./types";

const TELEGRAM_CALLBACK_DATA_LIMIT_BYTES = 64;
// Telegram keeps the first 8 buttons of an inline keyboard row and silently
// drops the rest, so longer rows are wrapped.
const TELEGRAM_MAX_BUTTONS_PER_ROW = 8;

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

/**
 * Split buttons into the fewest rows that fit Telegram's per-row limit,
 * keeping row widths within one button of each other (11 → 6 + 5).
 */
function wrapInlineKeyboardRow(
  buttons: TelegramInlineKeyboardButton[]
): TelegramInlineKeyboardButton[][] {
  const rows: TelegramInlineKeyboardButton[][] = [];
  const rowCount = Math.ceil(buttons.length / TELEGRAM_MAX_BUTTONS_PER_ROW);
  let start = 0;

  for (let remaining = rowCount; remaining > 0; remaining--) {
    const size = Math.ceil((buttons.length - start) / remaining);
    rows.push(buttons.slice(start, start + size));
    start += size;
  }

  return rows;
}

function collectInlineKeyboardRows(
  children: CardChild[],
  rows: TelegramInlineKeyboardButton[][]
): void {
  for (const child of children) {
    if (child.type === "actions") {
      rows.push(...wrapInlineKeyboardRow(toInlineKeyboardRow(child)));
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
  const callbackData = encodeCallbackData(actionId, value);
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
  return decodeCallbackData(data, "telegram_callback");
}
