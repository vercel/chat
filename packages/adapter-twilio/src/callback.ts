// Callback-data codec for buttons rendered by this adapter. Lives outside
// cards.ts and imports only the dependency-free `callback-data` subpath of
// @chat-adapter/shared, so the runtime-light webhook subpath can use it
// without pulling in the chat package.
import {
  decodeCallbackData,
  encodeCallbackData,
  isChatCallbackData,
} from "@chat-adapter/shared/callback-data";

export function isTwilioChatCallback(data: string): boolean {
  return isChatCallbackData(data);
}

export function encodeTwilioCallbackData(
  actionId: string,
  value?: string
): string {
  return encodeCallbackData(actionId, value);
}

export function decodeTwilioCallbackData(data?: string): {
  actionId: string;
  value: string | undefined;
} {
  return decodeCallbackData(data, "twilio_callback");
}
