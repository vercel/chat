import { cardToFallbackText as sharedCardToFallbackText } from "@chat-adapter/shared";
import type { CardElement } from "chat";

export function cardToTwilioText(card: CardElement): string {
  return sharedCardToFallbackText(card).replace(/\*/g, "");
}
