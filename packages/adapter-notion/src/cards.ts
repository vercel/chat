/**
 * Render Chat SDK cards as Notion comment markdown (inline subset).
 * Buttons with callbackUrl are unsupported — logged by the caller.
 */

import { cardToFallbackText } from "@chat-adapter/shared";
import type { CardElement } from "chat";

export function cardToNotionMarkdown(card: CardElement): string {
  return cardToFallbackText(card, {
    boldFormat: "**",
    lineBreak: "\n",
  });
}
