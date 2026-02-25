/**
 * Shared utility functions for chat adapters.
 *
 * These utilities are used across all adapter implementations (Slack, Teams, GChat)
 * to reduce code duplication and ensure consistent behavior.
 */

import type { AdapterPostableMessage, CardElement, FileUpload } from "chat";
import { isCardElement } from "chat";

/**
 * Extract CardElement from an AdapterPostableMessage if present.
 *
 * Handles two cases:
 * 1. The message IS a CardElement (type: "card")
 * 2. The message is a PostableCard with a `card` property
 *
 * @param message - The message to extract the card from
 * @returns The CardElement if found, null otherwise
 *
 * @example
 * ```typescript
 * // Case 1: Direct CardElement
 * const card = Card({ title: "Test" });
 * extractCard(card); // returns the card
 *
 * // Case 2: PostableCard wrapper
 * const message = { card, fallbackText: "..." };
 * extractCard(message); // returns the card
 *
 * // Case 3: Non-card message
 * extractCard("Hello"); // returns null
 * extractCard({ markdown: "**bold**" }); // returns null
 * ```
 */
export function extractCard(
  message: AdapterPostableMessage
): CardElement | null {
  if (isCardElement(message)) {
    return message;
  }
  if (typeof message === "object" && message !== null && "card" in message) {
    return message.card;
  }
  return null;
}

/**
 * Extract FileUpload array from an AdapterPostableMessage if present.
 *
 * Files can be attached to PostableRaw, PostableMarkdown, PostableAst,
 * or PostableCard messages via the `files` property.
 *
 * @param message - The message to extract files from
 * @returns Array of FileUpload objects, or empty array if none
 *
 * @example
 * ```typescript
 * // With files
 * const message = {
 *   markdown: "**Text**",
 *   files: [{ data: Buffer.from("..."), filename: "doc.pdf" }]
 * };
 * extractFiles(message); // returns the files array
 *
 * // Without files
 * extractFiles("Hello"); // returns []
 * extractFiles({ raw: "text" }); // returns []
 * ```
 */
export function extractFiles(message: AdapterPostableMessage): FileUpload[] {
  if (typeof message === "object" && message !== null && "files" in message) {
    return (message as { files?: FileUpload[] }).files ?? [];
  }
  return [];
}
