import type { SlackAdapter } from "@chat-adapter/slack";
import type { TelegramAdapter } from "@chat-adapter/telegram";
import type { Adapter } from "chat";

declare const slack: SlackAdapter;
declare const telegram: TelegramAdapter;

// Assignability under exactOptionalPropertyTypes. A getter that returns
// `string | undefined` is not a `botUserId?: string` property.
export const slackAdapter: Adapter = slack;
export const telegramAdapter: Adapter = telegram;
