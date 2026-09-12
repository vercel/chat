/**
 * Discord Embed and Component converter for cross-platform cards.
 *
 * Converts CardElement to Discord Embeds and Action Row Components.
 * @see https://discord.com/developers/docs/resources/message#embed-object
 * @see https://discord.com/developers/docs/interactions/message-components
 */

import { renderGfmTable, ValidationError } from "@chat-adapter/shared";
import type {
  ActionsElement,
  ButtonElement,
  CardChild,
  CardElement,
  FieldsElement,
  ImageElement,
  LinkButtonElement,
  LinkElement,
  RadioSelectElement,
  SectionElement,
  SelectElement,
  TableElement,
  TextElement,
} from "chat";
import {
  cardChildToFallbackText,
  convertEmojiPlaceholders,
  tableElementToAscii,
} from "chat";
import {
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIButtonComponentWithCustomId,
  type APIButtonComponentWithURL,
  type APIComponentInContainer,
  type APIEmbed,
  type APIEmbedField,
  type APIMediaGalleryComponent,
  type APIMessageTopLevelComponent,
  type APISectionComponent,
  type APIStringSelectComponent,
  type APITextDisplayComponent,
  type APIThumbnailComponent,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type RESTPostAPIChannelMessageJSONBody,
  SeparatorSpacingSize,
} from "discord-api-types/v10";
import { DiscordContentFormat } from "./types";

type DiscordActionRow = APIActionRowComponent<
  APIButtonComponent | APIStringSelectComponent
>;

const DISCORD_CUSTOM_ID_DELIMITER = "\n";
const DISCORD_CUSTOM_ID_MAX_LENGTH = 100;
const DISCORD_BLURPLE = 0x5865f2;
const DISCORD_MAX_BUTTONS_PER_ROW = 5;
const DISCORD_MAX_SELECT_OPTIONS = 25;
const DISCORD_MAX_SECTION_TEXT_DISPLAYS = 3;
const DISCORD_MAX_COMPONENTS_V2 = 40;
const DISCORD_MAX_TEXT_V2 = 4000;

interface DiscordCardPayloadOptions {
  contentFormat?: DiscordContentFormat;
}

type DiscordCardPayload = Required<
  Pick<RESTPostAPIChannelMessageJSONBody, "components" | "embeds">
> &
  Pick<RESTPostAPIChannelMessageJSONBody, "flags">;

interface DiscordEmbedCardPayload extends DiscordCardPayload {
  components: DiscordActionRow[];
}

interface DiscordComponentsV2CardPayload extends DiscordCardPayload {
  embeds: [];
  flags: MessageFlags;
}

function validateDiscordCustomId(customId: string): void {
  if (customId.length === 0 || customId.length > DISCORD_CUSTOM_ID_MAX_LENGTH) {
    throw new ValidationError(
      "discord",
      `Discord custom_id must be 1-${DISCORD_CUSTOM_ID_MAX_LENGTH} characters. Shorten the button id or value.`
    );
  }
}

export function encodeDiscordCustomId(
  actionId: string,
  value?: string
): string {
  if (value == null || value === "") {
    validateDiscordCustomId(actionId);
    return actionId;
  }
  const encoded = `${actionId}${DISCORD_CUSTOM_ID_DELIMITER}${value}`;
  validateDiscordCustomId(encoded);
  return encoded;
}

export function decodeDiscordCustomId(customId: string): {
  actionId: string;
  value: string | undefined;
} {
  const idx = customId.indexOf(DISCORD_CUSTOM_ID_DELIMITER);
  if (idx === -1) {
    return { actionId: customId, value: undefined };
  }
  return {
    actionId: customId.slice(0, idx),
    value: customId.slice(idx + 1),
  };
}

/**
 * Convert emoji placeholders to Discord format.
 */
function convertEmoji(text: string): string {
  return convertEmojiPlaceholders(text, "discord");
}

/**
 * Convert a CardElement to Discord message payload (embeds + components).
 */
export function cardToDiscordPayload(
  card: CardElement
): DiscordEmbedCardPayload;
export function cardToDiscordPayload(
  card: CardElement,
  options: { contentFormat: DiscordContentFormat.ComponentsV2 }
): DiscordComponentsV2CardPayload;
export function cardToDiscordPayload(
  card: CardElement,
  options: DiscordCardPayloadOptions
): DiscordCardPayload;
export function cardToDiscordPayload(
  card: CardElement,
  options: DiscordCardPayloadOptions = {}
): DiscordCardPayload {
  if (options.contentFormat === DiscordContentFormat.ComponentsV2) {
    return cardToDiscordComponentsV2Payload(card);
  }

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
  embed.color = DISCORD_BLURPLE;

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
 * Count every component in a Components v2 tree, including nested children and
 * section accessories. Discord caps a single message at 40 total components.
 */
function countComponentsV2(
  components: readonly APIMessageTopLevelComponent[]
): number {
  let total = 0;
  for (const component of components) {
    total += 1;
    switch (component.type) {
      case ComponentType.Container:
        total += countComponentsV2(component.components);
        break;
      case ComponentType.ActionRow:
        total += component.components.length;
        break;
      case ComponentType.Section:
        total += component.components.length + 1;
        break;
      default:
        break;
    }
  }
  return total;
}

/**
 * Sum the character length of every Text Display in a Components v2 tree.
 * Discord caps the combined text across all text displays at 4000 characters.
 */
function countTextV2(
  components: readonly APIMessageTopLevelComponent[]
): number {
  let total = 0;
  for (const component of components) {
    switch (component.type) {
      case ComponentType.TextDisplay:
        total += component.content.length;
        break;
      case ComponentType.Container:
        total += countTextV2(component.components);
        break;
      case ComponentType.Section:
        total += countTextV2(component.components);
        break;
      default:
        break;
    }
  }
  return total;
}

/**
 * Enforce Discord's Components v2 aggregate limits (40 total components and
 * 4000 characters across all text displays). Runs on the card tree during
 * conversion and again after file attachments are appended, so it catches
 * overflow from either source with a clear error instead of an opaque 400.
 */
export function validateComponentsV2(
  components: readonly APIMessageTopLevelComponent[]
): void {
  const componentCount = countComponentsV2(components);
  if (componentCount > DISCORD_MAX_COMPONENTS_V2) {
    throw new ValidationError(
      "discord",
      `Discord Components v2 messages allow up to ${DISCORD_MAX_COMPONENTS_V2} components, but this message produced ${componentCount}. Reduce the number of sections, fields, actions, images, or file attachments.`
    );
  }

  const textLength = countTextV2(components);
  if (textLength > DISCORD_MAX_TEXT_V2) {
    throw new ValidationError(
      "discord",
      `Discord Components v2 messages allow up to ${DISCORD_MAX_TEXT_V2} characters across all text, but this message produced ${textLength}. Shorten the card text.`
    );
  }
}

function cardToDiscordComponentsV2Payload(
  card: CardElement
): DiscordComponentsV2CardPayload {
  const children: APIComponentInContainer[] = [];

  if (card.title) {
    children.push(toTextDisplay(`# ${convertEmoji(card.title)}`));
  }

  if (card.subtitle) {
    children.push(toTextDisplay(convertEmoji(card.subtitle)));
  }

  if (card.imageUrl) {
    children.push(toMediaGallery({ url: card.imageUrl }));
  }

  for (const child of card.children) {
    children.push(...cardChildToComponentsV2(child));
  }

  const components: APIMessageTopLevelComponent[] = [
    {
      type: ComponentType.Container,
      accent_color: DISCORD_BLURPLE,
      components: children.length > 0 ? children : [toTextDisplay(" ")],
    },
  ];

  validateComponentsV2(components);

  return {
    embeds: [],
    flags: MessageFlags.IsComponentsV2,
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
  components: DiscordActionRow[]
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
    case "link":
      textParts.push(`[${convertEmoji(child.label)}](${child.url})`);
      break;
    case "table": {
      textParts.push(convertTableElement(child));
      break;
    }
    default: {
      const text = cardChildToFallbackText(child);
      if (text) {
        textParts.push(text);
      }
      break;
    }
  }
}

function cardChildToComponentsV2(child: CardChild): APIComponentInContainer[] {
  switch (child.type) {
    case "text":
      return [toTextDisplay(convertTextElement(child))];
    case "image":
      return [toMediaGallery(child)];
    case "divider":
      return [
        {
          type: ComponentType.Separator,
          divider: true,
          spacing: SeparatorSpacingSize.Small,
        },
      ];
    case "actions":
      return convertActionsToV2Rows(child);
    case "section":
      return convertSectionElementToV2(child);
    case "fields":
      return convertFieldsElementToV2(child);
    case "link":
      return [toTextDisplay(convertLinkElement(child))];
    case "table":
      return [toTextDisplay(convertTableElement(child))];
    default: {
      const text = cardChildToFallbackText(child);
      return text ? [toTextDisplay(text)] : [];
    }
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

function toTextDisplay(content: string): APITextDisplayComponent {
  return {
    type: ComponentType.TextDisplay,
    content,
  };
}

function toMediaGallery(
  image: ImageElement | { url: string }
): APIMediaGalleryComponent {
  return {
    type: ComponentType.MediaGallery,
    items: [
      {
        media: {
          url: image.url,
        },
        ...("alt" in image && image.alt
          ? { description: convertEmoji(image.alt) }
          : {}),
      },
    ],
  };
}

function toThumbnail(image: ImageElement): APIThumbnailComponent {
  return {
    type: ComponentType.Thumbnail,
    media: {
      url: image.url,
    },
    ...(image.alt ? { description: convertEmoji(image.alt) } : {}),
  };
}

function convertLinkElement(element: LinkElement): string {
  return `[${convertEmoji(element.label)}](${element.url})`;
}

function convertTableElement(element: TableElement): string {
  return renderGfmTable(element).join("\n");
}

/**
 * Convert an actions element to Discord action rows.
 * Discord limits each action row to 5 components, so we chunk buttons.
 */
function convertActionsToRows(element: ActionsElement): DiscordActionRow[] {
  const buttons: APIButtonComponent[] = element.children
    .filter((child) => child.type === "button" || child.type === "link-button")
    .map((button) => {
      if (button.type === "link-button") {
        return convertLinkButtonElement(button);
      }
      return convertButtonElement(button);
    });

  const rows: DiscordActionRow[] = [];
  for (let i = 0; i < buttons.length; i += DISCORD_MAX_BUTTONS_PER_ROW) {
    rows.push({
      type: ComponentType.ActionRow,
      components: buttons.slice(i, i + DISCORD_MAX_BUTTONS_PER_ROW),
    });
  }
  return rows;
}

function convertActionsToV2Rows(element: ActionsElement): DiscordActionRow[] {
  const rows: DiscordActionRow[] = [];
  let buttons: APIButtonComponent[] = [];

  const flushButtons = () => {
    for (let i = 0; i < buttons.length; i += DISCORD_MAX_BUTTONS_PER_ROW) {
      rows.push({
        type: ComponentType.ActionRow,
        components: buttons.slice(i, i + DISCORD_MAX_BUTTONS_PER_ROW),
      });
    }
    buttons = [];
  };

  for (const child of element.children) {
    if (child.type === "button") {
      buttons.push(convertButtonElement(child));
      continue;
    }

    if (child.type === "link-button") {
      buttons.push(convertLinkButtonElement(child));
      continue;
    }

    flushButtons();
    rows.push({
      type: ComponentType.ActionRow,
      components: [convertSelectElement(child)],
    });
  }

  flushButtons();
  return rows;
}

/**
 * Convert a button element to a Discord button.
 */
function convertButtonElement(
  button: ButtonElement
): APIButtonComponentWithCustomId {
  const discordButton: APIButtonComponentWithCustomId = {
    type: ComponentType.Button,
    style: getButtonStyle(button.style),
    label: button.label,
    custom_id: encodeDiscordCustomId(button.id, button.value),
  };

  if (button.disabled) {
    discordButton.disabled = true;
  }

  return discordButton;
}

/**
 * Convert a link button element to a Discord link button.
 */
function convertLinkButtonElement(
  button: LinkButtonElement
): APIButtonComponentWithURL {
  return {
    type: ComponentType.Button,
    style: ButtonStyle.Link,
    label: button.label,
    url: button.url,
  };
}

function convertSelectElement(
  select: SelectElement | RadioSelectElement
): APIStringSelectComponent {
  const options = select.options
    .slice(0, DISCORD_MAX_SELECT_OPTIONS)
    .map((option) => ({
      label: convertEmoji(option.label),
      value: option.value,
      ...(option.description
        ? { description: convertEmoji(option.description) }
        : {}),
      ...(option.value === select.initialOption ? { default: true } : {}),
    }));

  return {
    type: ComponentType.StringSelect,
    custom_id: encodeDiscordCustomId(select.id),
    options,
    max_values: 1,
    ...(select.optional ? { min_values: 0 } : {}),
    ...("placeholder" in select && select.placeholder
      ? { placeholder: convertEmoji(select.placeholder) }
      : { placeholder: convertEmoji(select.label) }),
  };
}

/**
 * Map button style to Discord button style.
 */
function getButtonStyle(
  style?: ButtonElement["style"]
): APIButtonComponentWithCustomId["style"] {
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
  components: DiscordActionRow[]
): void {
  for (const child of element.children) {
    processChild(child, textParts, fields, components);
  }
}

function convertSectionElementToV2(
  element: SectionElement
): APIComponentInContainer[] {
  const textDisplays: APITextDisplayComponent[] = [];
  const extraComponents: APIComponentInContainer[] = [];
  let accessory: APISectionComponent["accessory"] | undefined;

  for (const child of element.children) {
    switch (child.type) {
      case "text":
        textDisplays.push(toTextDisplay(convertTextElement(child)));
        break;
      case "image":
        if (accessory) {
          extraComponents.push(toMediaGallery(child));
        } else {
          accessory = toThumbnail(child);
        }
        break;
      case "fields":
        textDisplays.push(...convertFieldsElementToV2(child));
        break;
      case "link":
        textDisplays.push(toTextDisplay(convertLinkElement(child)));
        break;
      case "table":
        textDisplays.push(toTextDisplay(convertTableElement(child)));
        break;
      case "actions": {
        const sectionButton = getSectionAccessoryButton(child);
        if (sectionButton && !accessory) {
          accessory = sectionButton;
        } else {
          extraComponents.push(...convertActionsToV2Rows(child));
        }
        break;
      }
      case "divider":
        extraComponents.push({
          type: ComponentType.Separator,
          divider: true,
          spacing: SeparatorSpacingSize.Small,
        });
        break;
      case "section":
        extraComponents.push(...convertSectionElementToV2(child));
        break;
      default: {
        const text = cardChildToFallbackText(child);
        if (text) {
          textDisplays.push(toTextDisplay(text));
        }
        break;
      }
    }
  }

  if (!(accessory && textDisplays.length > 0)) {
    // A Discord Section requires text components to hold an accessory. When
    // there are no text displays, fall back to rendering the accessory as a
    // standalone component so its content isn't silently dropped.
    const accessoryComponents: APIComponentInContainer[] = [];
    if (accessory) {
      if (accessory.type === ComponentType.Thumbnail) {
        accessoryComponents.push({
          type: ComponentType.MediaGallery,
          items: [
            {
              media: { url: accessory.media.url },
              ...(accessory.description
                ? { description: accessory.description }
                : {}),
            },
          ],
        });
      } else {
        accessoryComponents.push({
          type: ComponentType.ActionRow,
          components: [accessory],
        });
      }
    }
    return [...textDisplays, ...accessoryComponents, ...extraComponents];
  }

  const section: APISectionComponent = {
    type: ComponentType.Section,
    components: textDisplays.slice(0, DISCORD_MAX_SECTION_TEXT_DISPLAYS),
    accessory,
  };

  return [
    section,
    ...textDisplays.slice(DISCORD_MAX_SECTION_TEXT_DISPLAYS),
    ...extraComponents,
  ];
}

function getSectionAccessoryButton(
  element: ActionsElement
): APIButtonComponent | undefined {
  if (element.children.length !== 1) {
    return undefined;
  }

  const [child] = element.children;
  if (!child) {
    return undefined;
  }

  if (child.type === "button") {
    return convertButtonElement(child);
  }

  if (child.type === "link-button") {
    return convertLinkButtonElement(child);
  }

  return undefined;
}

/**
 * Convert fields element to Discord embed fields.
 */
function convertFieldsElement(
  element: FieldsElement,
  fields: APIEmbedField[]
): void {
  for (const field of element.children) {
    fields.push({
      name: convertEmoji(field.label),
      value: convertEmoji(field.value),
      inline: true, // Discord fields can be inline
    });
  }
}

function convertFieldsElementToV2(
  element: FieldsElement
): APITextDisplayComponent[] {
  if (element.children.length === 0) {
    return [];
  }

  return [
    toTextDisplay(
      element.children
        .map(
          (field) =>
            `**${convertEmoji(field.label)}**\n${convertEmoji(field.value)}`
        )
        .join("\n\n")
    ),
  ];
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
    case "table":
      return `\`\`\`\n${tableElementToAscii(child.headers, child.rows)}\n\`\`\``;
    case "divider":
      return "---";
    default:
      return cardChildToFallbackText(child);
  }
}
