import type { GoogleChatEvent, GoogleChatFormInputs } from "../webhook/types";
import type {
  GoogleChatButton,
  GoogleChatCard,
  GoogleChatCardElement,
  GoogleChatCardObject,
  GoogleChatInputRequest,
  GoogleChatWidget,
} from "./types";

export type {
  GoogleChatActionsElement,
  GoogleChatButton,
  GoogleChatButtonElement,
  GoogleChatCard,
  GoogleChatCardElement,
  GoogleChatCardHeader,
  GoogleChatCardObject,
  GoogleChatCardSection,
  GoogleChatDividerElement,
  GoogleChatImageElement,
  GoogleChatInputRequest,
  GoogleChatSectionElement,
  GoogleChatSelectElement,
  GoogleChatSelectionInput,
  GoogleChatTextElement,
  GoogleChatTextInput,
  GoogleChatTextInputElement,
  GoogleChatWidget,
} from "./types";

export const GOOGLE_CHAT_FREEFORM_INPUT_ID = "input-freeform";

export interface GoogleChatCardOptions {
  cardId?: string;
  endpointUrl?: string;
}

export interface GoogleChatInputResponse {
  requestId?: string;
  value?: string;
}

export function cardToGoogleChatCard(
  card: GoogleChatCardObject,
  options: GoogleChatCardOptions = {}
): GoogleChatCard {
  const widgets = card.children.flatMap((child) =>
    elementToWidgets(child, options.endpointUrl)
  );
  const sections =
    widgets.length > 0
      ? [{ widgets }]
      : [{ widgets: [{ textParagraph: { text: "" } }] }];

  return {
    card: {
      ...(card.title || card.subtitle || card.imageUrl
        ? {
            header: {
              ...(card.imageUrl
                ? { imageType: "SQUARE" as const, imageUrl: card.imageUrl }
                : {}),
              ...(card.subtitle ? { subtitle: card.subtitle } : {}),
              title: card.title ?? "",
            },
          }
        : {}),
      sections,
    },
    ...(options.cardId ? { cardId: options.cardId } : {}),
  };
}

export function cardToGoogleChatFallbackText(
  card: GoogleChatCardObject
): string {
  const lines: string[] = [];
  if (card.title) {
    lines.push(card.title);
  }
  if (card.subtitle) {
    lines.push(card.subtitle);
  }
  collectFallback(card.children, lines);
  return lines.join("\n").trim();
}

export function inputRequestToGoogleChatCard(
  request: GoogleChatInputRequest
): GoogleChatCard {
  const actionId = request.actionId ?? request.requestId;
  const widgets: GoogleChatWidget[] = [
    { textParagraph: { text: request.prompt } },
  ];

  if (request.options?.length) {
    widgets.push({
      selectionInput: {
        items: request.options.map((option) => ({
          text: option.label,
          value: option.value,
        })),
        label: request.prompt,
        name: actionId,
        type: "DROPDOWN",
      },
    });
  }

  if (request.allowFreeform || !request.options?.length) {
    widgets.push({
      textInput: {
        label: request.prompt,
        name: GOOGLE_CHAT_FREEFORM_INPUT_ID,
        type: "SINGLE_LINE",
      },
    });
  }

  widgets.push({
    buttonList: {
      buttons: [
        {
          onClick: {
            action: {
              function: actionId,
              parameters: [{ key: "requestId", value: request.requestId }],
            },
          },
          text: request.submitLabel ?? "Submit",
        },
      ],
    },
  });

  return { card: { sections: [{ widgets }] } };
}

export function parseGoogleChatInputResponse(
  eventOrInputs: GoogleChatEvent | GoogleChatFormInputs
): GoogleChatInputResponse {
  const isEvent = isGoogleChatEvent(eventOrInputs);
  const formInputs = isEvent
    ? eventOrInputs.commonEventObject?.formInputs
    : eventOrInputs;
  const parameters = isEvent
    ? eventOrInputs.commonEventObject?.parameters
    : undefined;
  const requestId = parameters?.requestId;
  const actionId = isEvent
    ? (eventOrInputs.commonEventObject?.invokedFunction ?? requestId)
    : requestId;

  const selectedValue = actionId
    ? formInputs?.[actionId]?.stringInputs?.value?.[0]
    : undefined;
  const freeformValue =
    formInputs?.[GOOGLE_CHAT_FREEFORM_INPUT_ID]?.stringInputs?.value?.[0];

  return {
    requestId,
    value: selectedValue ?? freeformValue,
  };
}

function elementToWidgets(
  element: GoogleChatCardElement,
  endpointUrl?: string
): GoogleChatWidget[] {
  switch (element.type) {
    case "text":
      return [{ textParagraph: { text: element.text } }];
    case "section":
      return element.children.flatMap((child) =>
        elementToWidgets(child, endpointUrl)
      );
    case "actions": {
      const buttons = element.children.filter(
        (child): child is Extract<GoogleChatCardElement, { type: "button" }> =>
          child.type === "button"
      );
      const selects = element.children.filter(
        (
          child
        ): child is Extract<
          GoogleChatCardElement,
          { type: "radio" | "select" }
        > => child.type === "select" || child.type === "radio"
      );
      return [
        {
          buttonList: {
            buttons: buttons.map((button) =>
              buttonToGoogleChatButton(button, endpointUrl)
            ),
          },
        },
        ...selects.map((select) => ({
          selectionInput: {
            items: select.options.map((option) => ({
              selected: option.value === select.value,
              text: option.label,
              value: option.value,
            })),
            label: select.label,
            name: select.actionId,
            onChangeAction: {
              function: select.actionId,
              parameters: [{ key: "actionId", value: select.actionId }],
            },
            type:
              select.type === "radio"
                ? ("RADIO_BUTTON" as const)
                : ("DROPDOWN" as const),
          },
        })),
      ];
    }
    case "button":
      return [
        {
          buttonList: {
            buttons: [buttonToGoogleChatButton(element, endpointUrl)],
          },
        },
      ];
    case "select":
    case "radio":
      return [
        {
          selectionInput: {
            items: element.options.map((option) => ({
              selected: option.value === element.value,
              text: option.label,
              value: option.value,
            })),
            label: element.label,
            name: element.actionId,
            type: element.type === "radio" ? "RADIO_BUTTON" : "DROPDOWN",
          },
        },
      ];
    case "textInput":
      return [
        {
          textInput: {
            label: element.label,
            name: element.actionId,
            type: element.multiline ? "MULTIPLE_LINE" : "SINGLE_LINE",
            value: element.value,
          },
        },
      ];
    case "divider":
      return [{ divider: {} }];
    case "image":
      return [
        { image: { altText: element.altText, imageUrl: element.imageUrl } },
      ];
    default:
      return [];
  }
}

function isGoogleChatEvent(
  value: GoogleChatEvent | GoogleChatFormInputs
): value is GoogleChatEvent {
  return "chat" in value || "commonEventObject" in value;
}

function buttonToGoogleChatButton(
  button: Extract<GoogleChatCardElement, { type: "button" }>,
  endpointUrl?: string
): GoogleChatButton {
  if (button.url) {
    return {
      onClick: { openLink: { url: button.url } },
      text: button.label,
    };
  }

  return {
    onClick: {
      action: {
        function: endpointUrl ?? button.actionId ?? button.label,
        parameters: [
          ...(button.actionId
            ? [{ key: "actionId", value: button.actionId }]
            : []),
          ...(button.value ? [{ key: "value", value: button.value }] : []),
        ],
      },
    },
    text: button.label,
  };
}

function collectFallback(
  elements: GoogleChatCardElement[],
  lines: string[]
): void {
  for (const element of elements) {
    switch (element.type) {
      case "text":
        lines.push(element.text);
        break;
      case "section":
      case "actions":
        collectFallback(element.children, lines);
        break;
      case "button":
      case "select":
      case "radio":
      case "textInput":
      case "divider":
      case "image":
        break;
      default:
        break;
    }
  }
}
