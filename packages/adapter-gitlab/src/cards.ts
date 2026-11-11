/**
 * Convert CardElement to GitLab Flavored Markdown.
 *
 * Since GitLab doesn't support rich cards natively, we render cards
 * as formatted markdown with bold text, dividers, and links.
 */

import { renderGfmTable } from "@chat-adapter/shared";
import type {
  ActionsElement,
  CardChild,
  CardElement,
  FieldsElement,
  TableElement,
  TextElement,
} from "chat";
import { cardChildToFallbackText } from "chat";

const BACKSLASH_PATTERN = /\\/g;
const ASTERISK_PATTERN = /\*/g;
const UNDERSCORE_PATTERN = /_/g;
const OPEN_BRACKET_PATTERN = /\[/g;
const CLOSE_BRACKET_PATTERN = /\]/g;
const URL_UNSAFE_PATTERN = /[\s()<>]/g;

/**
 * Convert a CardElement to GitLab Flavored Markdown.
 *
 * Cards are rendered as clean markdown with:
 * - Bold title and subtitle
 * - Text content
 * - Fields as key-value pairs
 * - Buttons as markdown links (action buttons become bold text since GitLab has no interactivity)
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
export function cardToGitLabMarkdown(card: CardElement): string {
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
    lines.push(`![](${escapeUrl(card.imageUrl)})`);
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
        return [`![${escapeMarkdown(child.alt)}](${escapeUrl(child.url)})`];
      }
      return [`![](${escapeUrl(child.url)})`];

    case "link":
      return [`[${escapeMarkdown(child.label)}](${escapeUrl(child.url)})`];

    case "divider":
      return ["---"];

    case "table":
      return renderTable(child);

    default: {
      const text = cardChildToFallbackText(child);
      if (text) {
        return [text];
      }
      return [];
    }
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
      `**${escapeMarkdown(field.label)}:** ${escapeMarkdown(field.value)}`
  );
}

/**
 * Render table as GFM markdown table.
 */
function renderTable(table: TableElement): string[] {
  return renderGfmTable(table);
}

/**
 * Render actions (buttons) as markdown links or bold text.
 */
function renderActions(actions: ActionsElement): string[] {
  const buttonTexts = actions.children.map((button) => {
    if (button.type === "link-button") {
      // Link buttons become markdown links
      return `[${escapeMarkdown(button.label)}](${escapeUrl(button.url)})`;
    }
    // Action buttons become bold text (no interactivity in GitLab comments)
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
  // Backslash must be escaped first to avoid double-escaping
  return text
    .replace(BACKSLASH_PATTERN, "\\\\")
    .replace(ASTERISK_PATTERN, "\\*")
    .replace(UNDERSCORE_PATTERN, "\\_")
    .replace(OPEN_BRACKET_PATTERN, "\\[")
    .replace(CLOSE_BRACKET_PATTERN, "\\]");
}

/**
 * Percent-encode characters that would end a markdown link destination early.
 */
function escapeUrl(url: string): string {
  return url.replace(
    URL_UNSAFE_PATTERN,
    (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`
  );
}
