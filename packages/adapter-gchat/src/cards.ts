/**
 * Google Chat Card converter for cross-platform cards.
 *
 * Converts CardElement to Google Chat Card v2 format.
 * @see https://developers.google.com/chat/api/reference/rest/v1/cards
 */

import {
  createEmojiConverter,
  cardToFallbackText as sharedCardToFallbackText,
} from "@chat-adapter/shared";
import type {
  ActionsElement,
  ButtonElement,
  CardChild,
  CardElement,
  DividerElement,
  FieldsElement,
  ImageElement,
  LinkButtonElement,
  SectionElement,
  TextElement,
} from "chat";

/**
 * Convert emoji placeholders in text to GChat format (Unicode).
 */
const convertEmoji = createEmojiConverter("gchat");

// Google Chat Card v2 types (simplified)
export interface GoogleChatCard {
  card: {
    header?: GoogleChatCardHeader;
    sections: GoogleChatCardSection[];
  };
  cardId?: string;
}

export interface GoogleChatCardHeader {
  imageType?: "CIRCLE" | "SQUARE";
  imageUrl?: string;
  subtitle?: string;
  title: string;
}

export interface GoogleChatCardSection {
  collapsible?: boolean;
  header?: string;
  widgets: GoogleChatWidget[];
}

export interface GoogleChatWidget {
  buttonList?: { buttons: (GoogleChatButton | GoogleChatLinkButton)[] };
  decoratedText?: {
    topLabel?: string;
    text: string;
    bottomLabel?: string;
    startIcon?: { knownIcon?: string };
  };
  divider?: Record<string, never>;
  image?: { imageUrl: string; altText?: string };
  textParagraph?: { text: string };
}

export interface GoogleChatButton {
  color?: { red: number; green: number; blue: number };
  onClick: {
    action: {
      function: string;
      parameters: Array<{ key: string; value: string }>;
    };
  };
  text: string;
}

export interface GoogleChatLinkButton {
  color?: { red: number; green: number; blue: number };
  onClick: {
    openLink: {
      url: string;
    };
  };
  text: string;
}

/**
 * Options for card conversion.
 */
export interface CardConversionOptions {
  /** Unique card ID for interactive cards */
  cardId?: string;
  /**
   * HTTP endpoint URL for button actions.
   * Required for HTTP endpoint apps - button clicks will be routed to this URL.
   */
  endpointUrl?: string;
}

/**
 * Convert a CardElement to Google Chat Card v2 format.
 */
export function cardToGoogleCard(
  card: CardElement,
  options?: CardConversionOptions | string
): GoogleChatCard {
  // Support legacy signature where second arg is cardId string
  const opts: CardConversionOptions =
    typeof options === "string" ? { cardId: options } : options || {};

  const sections: GoogleChatCardSection[] = [];

  // Build header
  let header: GoogleChatCardHeader | undefined;
  if (card.title || card.subtitle || card.imageUrl) {
    header = {
      title: convertEmoji(card.title || ""),
    };
    if (card.subtitle) {
      header.subtitle = convertEmoji(card.subtitle);
    }
    if (card.imageUrl) {
      header.imageUrl = card.imageUrl;
      header.imageType = "SQUARE";
    }
  }

  // Group children into sections
  // GChat cards require widgets to be inside sections
  let currentWidgets: GoogleChatWidget[] = [];

  for (const child of card.children) {
    if (child.type === "section") {
      // If we have pending widgets, flush them to a section
      if (currentWidgets.length > 0) {
        sections.push({ widgets: currentWidgets });
        currentWidgets = [];
      }
      // Convert section as its own section
      const sectionWidgets = convertSectionToWidgets(child, opts.endpointUrl);
      sections.push({ widgets: sectionWidgets });
    } else {
      // Add to current widgets
      const widgets = convertChildToWidgets(child, opts.endpointUrl);
      currentWidgets.push(...widgets);
    }
  }

  // Flush remaining widgets
  if (currentWidgets.length > 0) {
    sections.push({ widgets: currentWidgets });
  }

  // GChat requires at least one section with at least one widget
  if (sections.length === 0) {
    sections.push({
      widgets: [{ textParagraph: { text: "" } }],
    });
  }

  const googleCard: GoogleChatCard = {
    card: {
      sections,
    },
  };

  if (header) {
    googleCard.card.header = header;
  }

  if (opts.cardId) {
    googleCard.cardId = opts.cardId;
  }

  return googleCard;
}

/**
 * Convert a card child element to Google Chat widgets.
 */
function convertChildToWidgets(
  child: CardChild,
  endpointUrl?: string
): GoogleChatWidget[] {
  switch (child.type) {
    case "text":
      return [convertTextToWidget(child)];
    case "image":
      return [convertImageToWidget(child)];
    case "divider":
      return [convertDividerToWidget(child)];
    case "actions":
      return [convertActionsToWidget(child, endpointUrl)];
    case "section":
      return convertSectionToWidgets(child, endpointUrl);
    case "fields":
      return convertFieldsToWidgets(child);
    case "link":
      return [
        {
          textParagraph: {
            text: `<a href="${child.url}">${convertEmoji(child.label)}</a>`,
          },
        },
      ];
    default:
      return [];
  }
}

/** Convert standard Markdown formatting to Google Chat formatting */
function markdownToGChat(text: string): string {
  // **bold** → *bold*
  return text.replace(/\*\*(.+?)\*\*/g, "*$1*");
}

function convertTextToWidget(element: TextElement): GoogleChatWidget {
  let text = markdownToGChat(convertEmoji(element.content));

  // Apply style using Google Chat formatting
  if (element.style === "bold") {
    text = `*${text}*`;
  } else if (element.style === "muted") {
    // GChat doesn't have muted, use regular text
    text = convertEmoji(element.content);
  }

  return {
    textParagraph: { text },
  };
}

function convertImageToWidget(element: ImageElement): GoogleChatWidget {
  return {
    image: {
      imageUrl: element.url,
      altText: element.alt || "Image",
    },
  };
}

function convertDividerToWidget(_element: DividerElement): GoogleChatWidget {
  return { divider: {} };
}

function convertActionsToWidget(
  element: ActionsElement,
  endpointUrl?: string
): GoogleChatWidget {
  const buttons: (GoogleChatButton | GoogleChatLinkButton)[] = element.children
    .filter((child) => child.type === "button" || child.type === "link-button")
    .map((button) => {
      if (button.type === "link-button") {
        return convertLinkButtonToGoogleButton(button);
      }
      return convertButtonToGoogleButton(button, endpointUrl);
    });

  return {
    buttonList: { buttons },
  };
}

function convertButtonToGoogleButton(
  button: ButtonElement,
  endpointUrl?: string
): GoogleChatButton {
  // For HTTP endpoint apps, the function field must be the endpoint URL,
  // and the action ID is passed via parameters.
  // See: https://developers.google.com/workspace/add-ons/chat/dialogs
  const parameters: Array<{ key: string; value: string }> = [
    { key: "actionId", value: button.id },
  ];
  if (button.value) {
    parameters.push({ key: "value", value: button.value });
  }

  const googleButton: GoogleChatButton = {
    text: convertEmoji(button.label),
    onClick: {
      action: {
        // For HTTP endpoints, function must be the full URL
        // For other deployments (Apps Script, etc.), use just the action ID
        function: endpointUrl || button.id,
        parameters,
      },
    },
  };

  // Apply button style colors
  if (button.style === "primary") {
    // Blue color for primary
    googleButton.color = { red: 0.2, green: 0.5, blue: 0.9 };
  } else if (button.style === "danger") {
    // Red color for danger
    googleButton.color = { red: 0.9, green: 0.2, blue: 0.2 };
  }

  return googleButton;
}

function convertLinkButtonToGoogleButton(
  button: LinkButtonElement
): GoogleChatLinkButton {
  const googleButton: GoogleChatLinkButton = {
    text: convertEmoji(button.label),
    onClick: {
      openLink: {
        url: button.url,
      },
    },
  };

  // Apply button style colors
  if (button.style === "primary") {
    googleButton.color = { red: 0.2, green: 0.5, blue: 0.9 };
  } else if (button.style === "danger") {
    googleButton.color = { red: 0.9, green: 0.2, blue: 0.2 };
  }

  return googleButton;
}

function convertSectionToWidgets(
  element: SectionElement,
  endpointUrl?: string
): GoogleChatWidget[] {
  const widgets: GoogleChatWidget[] = [];
  for (const child of element.children) {
    widgets.push(...convertChildToWidgets(child, endpointUrl));
  }
  return widgets;
}

function convertFieldsToWidgets(element: FieldsElement): GoogleChatWidget[] {
  // Convert fields to decorated text widgets
  return element.children.map((field) => ({
    decoratedText: {
      topLabel: markdownToGChat(convertEmoji(field.label)),
      text: markdownToGChat(convertEmoji(field.value)),
    },
  }));
}

/**
 * Generate fallback text from a card element.
 * Used when cards aren't supported.
 */
export function cardToFallbackText(card: CardElement): string {
  return sharedCardToFallbackText(card, {
    boldFormat: "*",
    lineBreak: "\n",
    platform: "gchat",
  });
}
