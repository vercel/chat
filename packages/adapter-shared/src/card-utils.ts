/**
 * Shared card conversion utilities for adapters.
 *
 * These utilities reduce duplication across adapter implementations
 * for card-to-platform-format conversions.
 */

import type { ButtonElement, CardChild, CardElement } from "chat";
import { convertEmojiPlaceholders } from "chat";

/**
 * Supported platform names for adapter utilities.
 */
export type PlatformName = "slack" | "gchat" | "teams" | "discord";

/**
 * Button style mappings per platform.
 *
 * Maps our standard button styles ("primary", "danger") to
 * platform-specific values.
 */
export const BUTTON_STYLE_MAPPINGS: Record<
  PlatformName,
  Record<string, string>
> = {
  slack: { primary: "primary", danger: "danger" },
  gchat: { primary: "primary", danger: "danger" }, // Colors handled via buttonColor
  teams: { primary: "positive", danger: "destructive" },
  discord: { primary: "primary", danger: "danger" },
};

/**
 * Create a platform-specific emoji converter function.
 *
 * Returns a function that converts emoji placeholders (e.g., `{{emoji:wave}}`)
 * to the platform's native format.
 *
 * @example
 * ```typescript
 * const convertEmoji = createEmojiConverter("slack");
 * convertEmoji("{{emoji:wave}} Hello"); // ":wave: Hello"
 * ```
 */
export function createEmojiConverter(
  platform: PlatformName
): (text: string) => string {
  return (text: string) => convertEmojiPlaceholders(text, platform);
}

/**
 * Map a button style to the platform-specific value.
 *
 * @example
 * ```typescript
 * mapButtonStyle("primary", "teams"); // "positive"
 * mapButtonStyle("danger", "slack");  // "danger"
 * mapButtonStyle(undefined, "teams"); // undefined
 * ```
 */
export function mapButtonStyle(
  style: ButtonElement["style"],
  platform: PlatformName
): string | undefined {
  if (!style) {
    return undefined;
  }
  return BUTTON_STYLE_MAPPINGS[platform][style];
}

/**
 * Options for fallback text generation.
 */
export interface FallbackTextOptions {
  /** Bold format string (default: "*" for mrkdwn, "**" for markdown) */
  boldFormat?: "*" | "**";
  /** Line break between sections (default: "\n") */
  lineBreak?: "\n" | "\n\n";
  /** Platform for emoji conversion (optional) */
  platform?: PlatformName;
}

/**
 * Generate fallback plain text from a card element.
 *
 * Used when the platform can't render rich cards or for notification previews.
 * Consolidates duplicate implementations from individual adapters.
 *
 * @example
 * ```typescript
 * // Slack-style (mrkdwn)
 * cardToFallbackText(card, { boldFormat: "*", platform: "slack" });
 *
 * // Teams-style (markdown with double line breaks)
 * cardToFallbackText(card, { boldFormat: "**", lineBreak: "\n\n", platform: "teams" });
 * ```
 */
export function cardToFallbackText(
  card: CardElement,
  options: FallbackTextOptions = {}
): string {
  const { boldFormat = "*", lineBreak = "\n", platform } = options;

  const convertText = platform
    ? createEmojiConverter(platform)
    : (t: string) => t;

  const parts: string[] = [];

  if (card.title) {
    parts.push(`${boldFormat}${convertText(card.title)}${boldFormat}`);
  }

  if (card.subtitle) {
    parts.push(convertText(card.subtitle));
  }

  for (const child of card.children) {
    const text = childToFallbackText(child, convertText);
    if (text) {
      parts.push(text);
    }
  }

  return parts.join(lineBreak);
}

/**
 * Convert a card child element to fallback text.
 * Internal helper for cardToFallbackText.
 */
function childToFallbackText(
  child: CardChild,
  convertText: (t: string) => string
): string | null {
  switch (child.type) {
    case "text":
      return convertText(child.content);
    case "link":
      return `${convertText(child.label)} (${child.url})`;
    case "fields":
      return child.children
        .map((f) => `${convertText(f.label)}: ${convertText(f.value)}`)
        .join("\n");
    case "actions":
      // Actions are interactive-only — exclude from fallback text.
      // Fallback text is used for notifications and screen readers where buttons aren't actionable.
      // See: https://docs.slack.dev/reference/methods/chat.postMessage
      return null;
    case "section":
      return child.children
        .map((c) => childToFallbackText(c, convertText))
        .filter(Boolean)
        .join("\n");
    case "divider":
      return "---";
    default:
      return null;
  }
}
