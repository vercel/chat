/**
 * Convert CardElement to GitHub-flavored markdown.
 *
 * Since GitHub doesn't support rich cards natively, we render cards
 * as formatted markdown with bold text, dividers, and links.
 */

import type {
  ActionsElement,
  CardChild,
  CardElement,
  FieldsElement,
  TextElement,
} from "chat";

/**
 * Convert a CardElement to GitHub-flavored markdown.
 *
 * Cards are rendered as clean markdown with:
 * - Bold title and subtitle
 * - Text content
 * - Fields as key-value pairs
 * - Buttons as markdown links (action buttons become bold text since GitHub has no interactivity)
 *
 * @example
 * ```typescript
 * const card = Card({
 *   title: "Order #1234",
 *   subtitle: "Status update",
 *   children: [
 *     Text("Your order has been shipped!"),
 *     Fields([
 *       Field({ label: "Tracking", value: "ABC123" }),
 *     ]),
 *     Actions([
 *       LinkButton({ url: "https://track.example.com", label: "Track Order" }),
 *     ]),
 *   ],
 * });
 *
 * // Output:
 * // **Order #1234**
 * // Status update
 * //
 * // Your order has been shipped!
 * //
 * // **Tracking:** ABC123
 * //
 * // [Track Order](https://track.example.com)
 * ```
 */
export function cardToGitHubMarkdown(card: CardElement): string {
  const lines: string[] = [];

  // Title (bold)
  if (card.title) {
    lines.push(`**${escapeMarkdown(card.title)}**`);
  }

  // Subtitle
  if (card.subtitle) {
    lines.push(escapeMarkdown(card.subtitle));
  }

  // Add spacing after header if there are children
  if ((card.title || card.subtitle) && card.children.length > 0) {
    lines.push("");
  }

  // Header image
  if (card.imageUrl) {
    lines.push(`![](${card.imageUrl})`);
    lines.push("");
  }

  // Children
  for (let i = 0; i < card.children.length; i++) {
    const child = card.children[i];
    const childLines = renderChild(child);

    if (childLines.length > 0) {
      lines.push(...childLines);

      // Add spacing between children (except last)
      if (i < card.children.length - 1) {
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

/**
 * Render a card child element to markdown lines.
 */
function renderChild(child: CardChild): string[] {
  switch (child.type) {
    case "text":
      return renderText(child);

    case "fields":
      return renderFields(child);

    case "actions":
      return renderActions(child);

    case "section":
      // Flatten section children
      return child.children.flatMap(renderChild);

    case "image":
      if (child.alt) {
        return [`![${escapeMarkdown(child.alt)}](${child.url})`];
      }
      return [`![](${child.url})`];

    case "divider":
      return ["---"];

    default:
      return [];
  }
}

/**
 * Render text element.
 */
function renderText(text: TextElement): string[] {
  const content = text.content;

  switch (text.style) {
    case "bold":
      return [`**${content}**`];
    case "muted":
      // Use italic for muted text
      return [`_${content}_`];
    default:
      return [content];
  }
}

/**
 * Render fields as key-value pairs.
 */
function renderFields(fields: FieldsElement): string[] {
  return fields.children.map(
    (field) =>
      `**${escapeMarkdown(field.label)}:** ${escapeMarkdown(field.value)}`,
  );
}

/**
 * Render actions (buttons) as markdown links or bold text.
 */
function renderActions(actions: ActionsElement): string[] {
  const buttonTexts = actions.children.map((button) => {
    if (button.type === "link-button") {
      // Link buttons become markdown links
      return `[${escapeMarkdown(button.label)}](${button.url})`;
    }
    // Action buttons become bold text (no interactivity in GitHub comments)
    // We could potentially use a special format that the bot recognizes
    return `**[${escapeMarkdown(button.label)}]**`;
  });

  // Join buttons with separator
  return [buttonTexts.join(" • ")];
}

/**
 * Escape special markdown characters in text.
 */
function escapeMarkdown(text: string): string {
  // Only escape characters that could break the formatting
  // We're deliberately light-handed to preserve intentional markdown
  return text
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

/**
 * Generate plain text fallback from a card (no markdown).
 * Used for alt text or plain text contexts.
 */
export function cardToPlainText(card: CardElement): string {
  const parts: string[] = [];

  if (card.title) {
    parts.push(card.title);
  }

  if (card.subtitle) {
    parts.push(card.subtitle);
  }

  for (const child of card.children) {
    const text = childToPlainText(child);
    if (text) {
      parts.push(text);
    }
  }

  return parts.join("\n");
}

/**
 * Convert card child to plain text.
 */
function childToPlainText(child: CardChild): string | null {
  switch (child.type) {
    case "text":
      return child.content;
    case "fields":
      return child.children.map((f) => `${f.label}: ${f.value}`).join("\n");
    case "actions":
      return child.children.map((b) => `[${b.label}]`).join(" ");
    case "section":
      return child.children.map(childToPlainText).filter(Boolean).join("\n");
    default:
      return null;
  }
}
