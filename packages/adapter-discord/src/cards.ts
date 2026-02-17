/**
 * Discord Embed and Component converter for cross-platform cards.
 *
 * Converts CardElement to Discord Embeds and Action Row Components.
 * @see https://discord.com/developers/docs/resources/message#embed-object
 * @see https://discord.com/developers/docs/interactions/message-components
 */

import type {
  ActionsElement,
  ButtonElement,
  CardChild,
  CardElement,
  FieldsElement,
  LinkButtonElement,
  SectionElement,
  TextElement,
} from "chat";
import { convertEmojiPlaceholders } from "chat";
import type { APIEmbed, APIEmbedField } from "discord-api-types/v10";
import { ButtonStyle } from "discord-api-types/v10";
import type { DiscordActionRow, DiscordButton } from "./types";

/**
 * Convert emoji placeholders to Discord format.
 */
function convertEmoji(text: string): string {
  return convertEmojiPlaceholders(text, "discord");
}

/**
 * Convert a CardElement to Discord message payload (embeds + components).
 */
export function cardToDiscordPayload(card: CardElement): {
  embeds: APIEmbed[];
  components: DiscordActionRow[];
} {
  const embed: APIEmbed = {};
  const fields: APIEmbedField[] = [];
  const components: DiscordActionRow[] = [];

  // Set title and description (with emoji conversion)
  if (card.title) {
    embed.title = convertEmoji(card.title);
  }

  if (card.subtitle) {
    embed.description = convertEmoji(card.subtitle);
  }

  // Set header image
  if (card.imageUrl) {
    embed.image = {
      url: card.imageUrl,
    };
  }

  // Set color (default to Discord blurple)
  embed.color = 0x5865f2;

  // Process children
  const textParts: string[] = [];

  for (const child of card.children) {
    processChild(child, textParts, fields, components);
  }

  // If we have text parts and no description, set them as description
  if (textParts.length > 0) {
    if (embed.description) {
      embed.description += `\n\n${textParts.join("\n\n")}`;
    } else {
      embed.description = textParts.join("\n\n");
    }
  }

  // Add fields if we have any
  if (fields.length > 0) {
    embed.fields = fields;
  }

  return {
    embeds: [embed],
    components,
  };
}

/**
 * Process a card child element.
 */
function processChild(
  child: CardChild,
  textParts: string[],
  fields: APIEmbedField[],
  components: DiscordActionRow[],
): void {
  switch (child.type) {
    case "text":
      textParts.push(convertTextElement(child));
      break;
    case "image":
      // Discord embeds can only have one image, handled at card level
      // Additional images could be added as separate embeds
      break;
    case "divider":
      // No direct equivalent, add a horizontal line marker
      textParts.push("───────────");
      break;
    case "actions":
      components.push(...convertActionsToRows(child));
      break;
    case "section":
      processSectionElement(child, textParts, fields, components);
      break;
    case "fields":
      convertFieldsElement(child, fields);
      break;
  }
}

/**
 * Convert a text element to Discord markdown.
 */
function convertTextElement(element: TextElement): string {
  let text = convertEmoji(element.content);

  // Apply style
  if (element.style === "bold") {
    text = `**${text}**`;
  } else if (element.style === "muted") {
    // Discord doesn't have muted, use italic as approximation
    text = `*${text}*`;
  }

  return text;
}

/**
 * Convert an actions element to Discord action rows.
 * Discord limits each action row to 5 components, so we chunk buttons.
 */
function convertActionsToRows(element: ActionsElement): DiscordActionRow[] {
  const buttons: DiscordButton[] = element.children
    .filter((child) => child.type === "button" || child.type === "link-button")
    .map((button) => {
      if (button.type === "link-button") {
        return convertLinkButtonElement(button);
      }
      return convertButtonElement(button);
    });

  // Discord allows max 5 buttons per action row
  const rows: DiscordActionRow[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push({
      type: 1, // Action Row
      components: buttons.slice(i, i + 5),
    });
  }
  return rows;
}

/**
 * Convert a button element to a Discord button.
 */
function convertButtonElement(button: ButtonElement): DiscordButton {
  const discordButton: DiscordButton = {
    type: 2, // Button
    style: getButtonStyle(button.style),
    label: button.label,
    custom_id: button.id,
  };

  return discordButton;
}

/**
 * Convert a link button element to a Discord link button.
 */
function convertLinkButtonElement(button: LinkButtonElement): DiscordButton {
  return {
    type: 2, // Button
    style: ButtonStyle.Link,
    label: button.label,
    url: button.url,
  };
}

/**
 * Map button style to Discord button style.
 */
function getButtonStyle(style?: ButtonElement["style"]): ButtonStyle {
  switch (style) {
    case "primary":
      return ButtonStyle.Primary;
    case "danger":
      return ButtonStyle.Danger;
    default:
      return ButtonStyle.Secondary;
  }
}

/**
 * Process a section element.
 */
function processSectionElement(
  element: SectionElement,
  textParts: string[],
  fields: APIEmbedField[],
  components: DiscordActionRow[],
): void {
  for (const child of element.children) {
    processChild(child, textParts, fields, components);
  }
}

/**
 * Convert fields element to Discord embed fields.
 */
function convertFieldsElement(
  element: FieldsElement,
  fields: APIEmbedField[],
): void {
  for (const field of element.children) {
    fields.push({
      name: convertEmoji(field.label),
      value: convertEmoji(field.value),
      inline: true, // Discord fields can be inline
    });
  }
}

/**
 * Generate fallback text from a card element.
 * Used when embeds aren't supported or for notifications.
 */
export function cardToFallbackText(card: CardElement): string {
  const parts: string[] = [];

  if (card.title) {
    parts.push(`**${convertEmoji(card.title)}**`);
  }

  if (card.subtitle) {
    parts.push(convertEmoji(card.subtitle));
  }

  for (const child of card.children) {
    const text = childToFallbackText(child);
    if (text) {
      parts.push(text);
    }
  }

  return parts.join("\n\n");
}

/**
 * Convert a card child element to fallback text.
 */
function childToFallbackText(child: CardChild): string | null {
  switch (child.type) {
    case "text":
      return convertEmoji(child.content);
    case "fields":
      return child.children
        .map((f) => `**${convertEmoji(f.label)}**: ${convertEmoji(f.value)}`)
        .join("\n");
    case "actions":
      // Actions are interactive-only — exclude from fallback text.
      // See: https://docs.slack.dev/reference/methods/chat.postMessage
      return null;
    case "section":
      return child.children
        .map((c) => childToFallbackText(c))
        .filter(Boolean)
        .join("\n");
    case "divider":
      return "---";
    default:
      return null;
  }
}
